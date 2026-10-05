// ═══════════════════════════════════════════════════════════════════════════
// presas-cila-sync — Ingesta diaria del Reservoir Report de la CILA/USIBWC
// ---------------------------------------------------------------------------
// 1. Descarga el reporte público (res_report.txt, validado contra el SHEF).
// 2. Upsert en lecturas_presas_cila (dato oficial tal cual, con su base de capacidad).
// 3. RESOLUTOR: vuelca almacenamiento / % (base NAMO SICA) / elevación calculada con la curva
//    a lecturas_presas, que es la tabla que leen todos los módulos. La medición de campo
//    prevalece; la extracción NO se toca (la manda SICA: movimientos y protocolo).
// 4. Bitácora (presas_cila_sync_log) y alerta en registro_alertas si el reporte se retrasa.
// El reporte sale entre 9:00 y 11:00 (Chihuahua); el cron reintenta y todo es idempotente.
// Secretos (Deno.env): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseReporte, parseShef, PRESAS_CILA } from "./parser.ts";
import { curvaValida, resolverNivel, type PuntoCurva } from "./resolver.ts";
import { estadoReporteCila } from "./vigencia.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE = "https://ibwcsftpstg.blob.core.windows.net/wad/ReservoirReports";
const ORIGEN_ALERTA = "CILA-SYNC";
// Incertidumbre (m) de la elevación derivada del almacenamiento. Boquilla: curva validada con lecturas de campo.
// Madero: batimetría 2004 ajustada al volumen oficial, sin lectura de escala de campo que la calibre.
const INCERTIDUMBRE_ELEV_M: Record<string, number> = { "PRE-002": 0.5 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function descargar(url: string): Promise<{ texto: string; lastModified: string | null }> {
  const r = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} al descargar ${url}`);
  const lm = r.headers.get("last-modified");
  return { texto: await r.text(), lastModified: lm ? new Date(lm).toISOString() : null };
}

// deno-lint-ignore no-explicit-any
type Sb = any;

// Dos puntos de la curva que enmarcan el volumen (la curva de Boquilla tiene 5,501 filas).
async function curvaAlrededor(sb: Sb, presaId: string, vol: number): Promise<PuntoCurva[]> {
  const [{ data: abajo }, { data: arriba }] = await Promise.all([
    sb.from("curvas_capacidad").select("elevacion_msnm, volumen_mm3").eq("presa_id", presaId)
      .lte("volumen_mm3", vol).order("volumen_mm3", { ascending: false }).limit(1),
    sb.from("curvas_capacidad").select("elevacion_msnm, volumen_mm3").eq("presa_id", presaId)
      .gte("volumen_mm3", vol).order("volumen_mm3", { ascending: true }).limit(1),
  ]);
  return [...(abajo ?? []), ...(arriba ?? [])].map((p: Record<string, unknown>) => ({
    elevacion_msnm: Number(p.elevacion_msnm), volumen_mm3: Number(p.volumen_mm3),
  }));
}

async function volcarALecturas(
  sb: Sb,
  l: { presa_id: string; fecha: string; almacenamiento_mm3: number | null; cap_conservacion_mm3: number | null; elev_conservacion_msnm: number | null },
  almCilaPrevio: number | null,
) {
  const [{ data: presa }, { data: existente }] = await Promise.all([
    sb.from("presas").select("capacidad_max").eq("id", l.presa_id).maybeSingle(),
    sb.from("lecturas_presas").select("id, almacenamiento_mm3, escala_msnm, porcentaje_llenado, notas")
      .eq("presa_id", l.presa_id).eq("fecha", l.fecha).maybeSingle(),
  ]);
  const num = (v: unknown) => (v == null ? null : Number(v));
  const ex = existente ? {
    almacenamiento_mm3: num(existente.almacenamiento_mm3), escala_msnm: num(existente.escala_msnm),
    porcentaje_llenado: num(existente.porcentaje_llenado), notas: existente.notas ?? null,
  } : null;
  let curva: PuntoCurva[] = [];
  if (l.almacenamiento_mm3 != null) {
    const enConservacion = l.cap_conservacion_mm3 != null ? await curvaAlrededor(sb, l.presa_id, l.cap_conservacion_mm3) : [];
    if (curvaValida(enConservacion, l.cap_conservacion_mm3, l.elev_conservacion_msnm)) {
      curva = await curvaAlrededor(sb, l.presa_id, l.almacenamiento_mm3);
    }
  }
  const r = resolverNivel(ex, l.almacenamiento_mm3, Number(presa?.capacidad_max ?? 0), curva, almCilaPrevio, INCERTIDUMBRE_ELEV_M[l.presa_id] ?? null);

  if (r.accion === "sin_dato" || r.accion === "campo_prevalece" || !r.valores) return { accion: r.accion };
  if (r.accion === "actualizar") {
    const { error } = await sb.from("lecturas_presas").update({ ...r.valores, notas: r.notas }).eq("id", existente.id);
    return error ? { accion: "error", detalle: error.message } : { accion: "actualizar", ...r.valores };
  }
  const { error } = await sb.from("lecturas_presas").insert({
    id: `CILA-${l.presa_id}-${l.fecha}`, presa_id: l.presa_id, fecha: l.fecha, ...r.valores,
    responsable: "CILA-IBWC", notas: r.notas,
  });
  return error ? { accion: "error", detalle: error.message } : { accion: "insertar", ...r.valores };
}

async function gestionarAlerta(sb: Sb, estado: string, fechaReporte: string | null) {
  const { data: abiertas } = await sb.from("registro_alertas").select("id")
    .eq("origen_id", ORIGEN_ALERTA).eq("resuelta", false);
  const retrasado = estado === "RETRASADO" || estado === "SIN_ACTUALIZACION";
  if (retrasado && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({
      tipo_riesgo: "warning", categoria: "fuente_datos", origen_id: ORIGEN_ALERTA,
      titulo: "Reporte CILA/USIBWC sin actualizar",
      mensaje: `El reporte de presas (La Boquilla y Fco. I. Madero) sigue con fecha ${fechaReporte ?? "S/D"} pasadas las 11:30 (hora Chihuahua). Se muestra el último dato conocido.`,
    });
  } else if (!retrasado && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() })
      .eq("origen_id", ORIGEN_ALERTA).eq("resuelta", false);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb: Sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let archivoLM: string | null = null;
  let fechaReporte: string | null = null;
  const bitacora = (resultado: string, estado: string | null, detalle: unknown) =>
    sb.from("presas_cila_sync_log").insert({
      resultado, estado_vigencia: estado, fecha_reporte: fechaReporte, archivo_last_modified: archivoLM, detalle,
    });

  try {
    const principal = await descargar(`${BASE}/res_report.txt`);
    archivoLM = principal.lastModified;
    const { lecturas, errores } = parseReporte(principal.texto);
    if (lecturas.length === 0) {
      await bitacora("error", null, { errores });
      return json({ ok: false, errores: errores.length ? errores : ["Sin lecturas"] }, 502);
    }
    fechaReporte = lecturas.map((l) => l.fecha).sort().at(-1)!;

    const advertencias: string[] = [];
    try {
      const shef = parseShef((await descargar(`${BASE}/res_report_shef.txt`)).texto);
      for (const l of lecturas) {
        const codigo = Object.values(PRESAS_CILA).find((p) => p.presa_id === l.presa_id)!.shef;
        const s = shef[codigo];
        if (!s) { advertencias.push(`${l.presa_id}: ${codigo} ausente en SHEF`); continue; }
        if (s.storage != null && l.almacenamiento_mm3 != null && Math.abs(s.storage - l.almacenamiento_mm3) > 0.01)
          advertencias.push(`${l.presa_id}: almacenamiento .txt=${l.almacenamiento_mm3} vs SHEF=${s.storage}`);
        if (s.release != null && l.extraccion_m3s != null && Math.abs(s.release - l.extraccion_m3s) > 0.001)
          advertencias.push(`${l.presa_id}: extracción .txt=${l.extraccion_m3s} vs SHEF=${s.release}`);
      }
    } catch (e) {
      advertencias.push(`SHEF no disponible: ${(e as Error).message}`);
    }

    const resultados: Record<string, unknown>[] = [];
    for (const l of lecturas) {
      const { data: previa } = await sb.from("lecturas_presas_cila")
        .select("ts_reporte, almacenamiento_mm3, extraccion_m3s")
        .eq("presa_id", l.presa_id).eq("fecha", l.fecha).maybeSingle();

      const igual = previa
        && new Date(previa.ts_reporte).getTime() === new Date(l.ts_reporte).getTime()
        && Number(previa.almacenamiento_mm3) === l.almacenamiento_mm3
        && Number(previa.extraccion_m3s) === l.extraccion_m3s;

      let estado = "skipped";
      if (!igual) {
        const { elev_conservacion_msnm: _omit, ...fila } = l;
        const { error } = await sb.from("lecturas_presas_cila").upsert(
          { ...fila, fuente: "CILA-IBWC", archivo_last_modified: principal.lastModified, actualizado_en: new Date().toISOString() },
          { onConflict: "presa_id,fecha" },
        );
        if (error) { resultados.push({ presa_id: l.presa_id, fecha: l.fecha, estado: "error", detalle: error.message }); continue; }
        estado = previa ? "updated" : "inserted";
      }
      // El volcado es idempotente y también repara si la fila oficial ya existía pero no se había volcado.
      const volcado = await volcarALecturas(sb, l, previa?.almacenamiento_mm3 != null ? Number(previa.almacenamiento_mm3) : null);
      resultados.push({ presa_id: l.presa_id, fecha: l.fecha, estado, almacenamiento_mm3: l.almacenamiento_mm3, extraccion_m3s: l.extraccion_m3s, lecturas_presas: volcado });
    }

    const { estado: vigencia } = estadoReporteCila(fechaReporte);
    const hayError = resultados.some((r) => r.estado === "error" || (r.lecturas_presas as { accion?: string })?.accion === "error");
    const hayNuevo = resultados.some((r) => r.estado === "inserted" || r.estado === "updated");
    await gestionarAlerta(sb, vigencia, fechaReporte);
    await bitacora(hayError ? "error" : hayNuevo ? "nuevo" : "sin_cambios", vigencia, { resultados, errores, advertencias });

    return json({ ok: !hayError && errores.length === 0, vigencia, fecha_reporte: fechaReporte,
      archivo_last_modified: principal.lastModified, resultados, errores, advertencias }, hayError ? 500 : 200);
  } catch (e) {
    await bitacora("sin_reporte", null, { error: (e as Error).message });
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
