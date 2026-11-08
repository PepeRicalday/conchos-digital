// ═══════════════════════════════════════════════════════════════════════════
// aqwp-sync — USIBWC AQUARIUS Web Portal: presas CONAGUA de Chihuahua + aforo Ojinaga (contexto de cuenca)
// ---------------------------------------------------------------------------
// Fuente TERCERA, solo lectura: nunca toca lecturas_presas ni lecturas_presas_cila.
// Modos (body.modo):
//   "export" (default) Export CSV por dataset de aqwp_datasets(sincronizar). Ventana body.dias (default 30,
//                      máx 400) hacia atrás: CONAGUA corrige valores tarde y la detección de estancamiento
//                      necesita tramo. Upsert idempotente (dataset_id, fecha). S/D = NULL, nunca 0.
//   "tabla"            GetTable MexResScript: valida el formato y cruza el almacenamiento contra lo cargado.
// Opcional: body.ubicacion (id_number), body.historico=true (EntirePeriodOfRecord; usar con ubicacion).
// Alertas (registro_alertas, categoria 'fuente_datos', origen 'AQWP-…'): sin dato nuevo, serie estancada,
// diferencia > 2 % contra CILA (Boquilla/Madero), cambio de formato.
// Auth: x-cron-secret (cron_secretos 'aqwp_sync') o JWT de usuario SRL.
// Datos provisionales de CONAGUA vía USIBWC; sin garantía.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { exigirRol } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  aFecha, BASE_AQWP, detectarEstancamiento, diasIgualFinal, type FilaDiaria, parseCsvExport, parseCsvRaw, parseMexResScript,
  precipitacionDiaria, urlExport,
} from "./parser.ts";
import { descomprimirPrimero } from "./zip.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;
const UA = "SICA005-aqwp-sync/1.0 (monitoreo DR-005 Delicias)";
const UMBRAL_CILA_PCT = 2;      // alerta si |AQWP − CILA| > 2 % del almacenamiento CILA
const DIAS_SIN_DATO = 3;        // CONAGUA publica a diario; 3 días sin día nuevo = fuente caída
const CONCURRENCIA = 4;
const LOTE = 1000;

interface Dataset { id_number: number; ubicacion_id: number; titulo: string; magnitud: string }

async function descargar(titulo: string, desde?: string, hasta?: string): Promise<FilaDiaria[]> {
  const resp = await fetch(urlExport(titulo, desde, hasta), {
    headers: { "User-Agent": UA, "Accept-Language": "en-US" }, signal: AbortSignal.timeout(45_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return parseCsvExport(await descomprimirPrimero(new Uint8Array(await resp.arrayBuffer())));
}

/** Hoy en UTC-6 fijo (el portal sella así; Chihuahua no tiene horario de verano desde 2022). */
const hoyLocal = (): string => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Lluvia GOES: baja el acumulado sub-diario (10–15 min) de la ventana y lo convierte a mm por día. Nunca el histórico completo (memoria). */
async function descargarLluvia(titulo: string, desde: string, hasta: string): Promise<FilaDiaria[]> {
  const resp = await fetch(urlExport(titulo, desde, hasta), {
    headers: { "User-Agent": UA, "Accept-Language": "en-US" }, signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const muestras = parseCsvRaw(await descomprimirPrimero(new Uint8Array(await resp.arrayBuffer())));
  // El día que corta la ventana (fecha ≥ hasta) solo trae las muestras de las 00:00: parcial. Se omite para que no pise
  // (con S/D) el día completo que carga la ventana siguiente — causaba huecos en los límites de un backfill por tramos.
  return precipitacionDiaria(muestras, hoyLocal()).filter((f: FilaDiaria) => f.fecha < hasta);
}

async function conConcurrencia<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) { const i = k++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function gestionarAlerta(
  sb: Sb, origen: string, activa: boolean, titulo: string, mensaje: string, tipo: "warning" | "critical" = "warning",
) {
  const { data: abiertas } = await sb.from("registro_alertas").select("id").eq("origen_id", origen).eq("resuelta", false);
  if (activa && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({ tipo_riesgo: tipo, categoria: "fuente_datos", origen_id: origen, titulo, mensaje });
  } else if (!activa && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() })
      .eq("origen_id", origen).eq("resuelta", false);
  }
}

async function modoExport(sb: Sb, body: Record<string, unknown>) {
  const historico = body.historico === true;
  const dias = Math.min(Math.max(Number(body.dias) || 30, 1), 400);
  const hoy = new Date();
  const hastaDefecto = aFecha(new Date(hoy.getTime() + 86_400_000));
  // body.desde / body.hasta (YYYY-MM-DD) fijan la ventana: backfill por tramos de las series de 10 min.
  const desde = typeof body.desde === "string" && FECHA_RE.test(body.desde) ? body.desde : aFecha(new Date(hoy.getTime() - dias * 86_400_000));
  const hasta = typeof body.hasta === "string" && FECHA_RE.test(body.hasta) ? body.hasta : hastaDefecto;

  let q = sb.from("aqwp_datasets").select("id_number, ubicacion_id, titulo, magnitud").eq("sincronizar", true);
  if (body.ubicacion) q = q.eq("ubicacion_id", Number(body.ubicacion));
  // Subconjunto de datasets (backfill de series muy largas, p. ej. el vertido de Boquilla desde 1993, que agota los
  // recursos de una sola corrida). OJO: la detección de estancamiento necesita almacenamiento + aportación +
  // extracción total EN LA MISMA corrida; si falta alguna, no se marca estancamiento.
  if (Array.isArray(body.datasets) && body.datasets.length) q = q.in("id_number", body.datasets.map(Number));
  const { data: datasets, error } = await q;
  if (error) throw new Error(`datasets: ${error.message}`);

  const porUbic = new Map<number, Dataset[]>();
  for (const d of (datasets ?? []) as Dataset[]) porUbic.set(d.ubicacion_id, [...(porUbic.get(d.ubicacion_id) ?? []), d]);
  const { data: ubics } = await sb.from("aqwp_ubicaciones").select("id_number, codigo, nombre, tipo, presa_id").eq("activa", true);
  const infoU = new Map<number, { codigo: string; nombre: string; tipo: string; presa_id: string | null }>(
    (ubics ?? []).map((u: { id_number: number; codigo: string; nombre: string; tipo: string; presa_id: string | null }) => [u.id_number, u]));

  const resumen = { datasets: 0, filas: 0, estancadas: 0, errores: [] as string[], ubicaciones: [] as unknown[] };

  await conConcurrencia([...porUbic.entries()], CONCURRENCIA, async ([ubicId, dsets]) => {
    const u = infoU.get(ubicId);
    if (!u) return;
    const series = new Map<number, FilaDiaria[]>();
    for (const d of dsets) {
      try {
        series.set(d.id_number, d.magnitud === "precipitacion_dia"
          ? await descargarLluvia(d.titulo, desde, hasta) // sub-diaria: siempre por ventana
          : historico ? await descargar(d.titulo) : await descargar(d.titulo, desde, hasta));
      } catch (e) {
        resumen.errores.push(`${u.codigo} ${d.magnitud}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 250)); // trato cortés con el portal
    }
    const dePor = (mag: string) => dsets.find((d) => d.magnitud === mag);
    const serieDe = (mag: string) => { const d = dePor(mag); return d ? (series.get(d.id_number) ?? []) : []; };

    const dsAlm = dePor("almacenamiento");
    const marcadas = dsAlm
      ? detectarEstancamiento(serieDe("almacenamiento"), serieDe("aportacion"), serieDe("extraccion_total"))
      : new Set<string>();

    for (const d of dsets) {
      const filas = series.get(d.id_number);
      if (!filas) continue;
      const registros = filas.map((f) => ({
        dataset_id: d.id_number, fecha: f.fecha, valor: f.valor,
        estancada: d.magnitud === "almacenamiento" && marcadas.has(f.fecha), ingestado_en: new Date().toISOString(),
      }));
      for (let i = 0; i < registros.length; i += LOTE) {
        const { error: eU } = await sb.from("aqwp_lecturas_diarias").upsert(registros.slice(i, i + LOTE), { onConflict: "dataset_id,fecha" });
        if (eU) { resumen.errores.push(`${u.codigo} ${d.magnitud}: ${eU.message}`); break; }
      }
      const conDato = filas.filter((f) => f.valor !== null);
      const ult = conDato.length ? conDato[conDato.length - 1].fecha : null;
      await sb.from("aqwp_datasets").update({ ult_sync_en: new Date().toISOString(), ...(ult ? { ult_fecha: ult } : {}) }).eq("id_number", d.id_number);
      resumen.datasets++;
      resumen.filas += registros.length;
    }
    resumen.estancadas += marcadas.size;

    // Alertas por ubicación (solo presas; el aforo no tiene almacenamiento)
    if (dsAlm) {
      const alm = serieDe("almacenamiento").filter((f) => f.valor !== null);
      const ultFecha = alm.length ? alm[alm.length - 1].fecha : null;
      const dias = ultFecha ? (Date.now() - new Date(`${ultFecha}T00:00:00-06:00`).getTime()) / 86_400_000 : Infinity;
      await gestionarAlerta(sb, `AQWP-DATO:${u.codigo}`, dias > DIAS_SIN_DATO,
        `AQWP: ${u.nombre} sin dato nuevo`,
        `Sin almacenamiento nuevo de ${u.nombre} en el portal USIBWC desde ${ultFecha ?? "nunca"}. Se muestra S/D.`);
      const estancadaHoy = !!ultFecha && marcadas.has(ultFecha);
      const diasIg = diasIgualFinal(serieDe("almacenamiento"));
      await gestionarAlerta(sb, `AQWP-ESTANCADA:${u.codigo}`, estancadaHoy,
        `AQWP: lectura sin actualizar en ${u.nombre}`,
        `El almacenamiento de ${u.nombre} no cambia desde hace ${diasIg} días aunque hay aportación/extracción activas: la fuente no está actualizando la lectura. Se excluye de los totales de la cuenca.`);
    }
    // Pluviómetros GOES: alerta si lleva más de 3 días sin un día completo con dato (transmiten cada 10–15 min).
    const dsLluvia = dePor("precipitacion_dia");
    if (dsLluvia && series.has(dsLluvia.id_number) && !body.desde) {
      const conDato = serieDe("precipitacion_dia").filter((f) => f.valor !== null);
      const ultLluvia = conDato.length ? conDato[conDato.length - 1].fecha : null;
      const atraso = ultLluvia ? (Date.parse(`${hoyLocal()}T00:00:00Z`) - Date.parse(`${ultLluvia}T00:00:00Z`)) / 86_400_000 : Infinity;
      await gestionarAlerta(sb, `AQWP-LLUVIA:${u.codigo}`, atraso > 3,
        `AQWP: pluviómetro de ${u.nombre} sin dato`,
        `Sin lluvia diaria completa de ${u.nombre} (telemetría GOES vía USIBWC) desde ${ultLluvia ?? "nunca"}. Se muestra S/D.`);
    }
    resumen.ubicaciones.push({ codigo: u.codigo, datasets: dsets.length });
  });

  // Cruce contra CILA (Boquilla/Madero), último día comparable
  const { data: cruce } = await sb.from("v_aqwp_vs_cila").select("presa_id, fecha, aqwp_mm3, cila_mm3, dif_pct")
    .order("fecha", { ascending: false }).limit(20);
  const ultimoPorPresa = new Map<string, { fecha: string; aqwp_mm3: number; cila_mm3: number; dif_pct: number }>();
  for (const c of cruce ?? []) if (!ultimoPorPresa.has(c.presa_id)) ultimoPorPresa.set(c.presa_id, c);
  const cila: unknown[] = [];
  for (const [presa, c] of ultimoPorPresa) {
    const fuera = c.dif_pct != null && Math.abs(Number(c.dif_pct)) > UMBRAL_CILA_PCT;
    cila.push({ presa, ...c, fuera });
    await gestionarAlerta(sb, `AQWP-CILA:${presa}`, fuera,
      `AQWP vs CILA: diferencia en ${presa}`,
      `Almacenamiento ${presa} al ${c.fecha}: AQWP ${c.aqwp_mm3} Mm³ vs CILA ${c.cila_mm3} Mm³ (${c.dif_pct} %, umbral ${UMBRAL_CILA_PCT} %). Revisar qué fuente está desfasada.`);
  }
  return { ...resumen, cruce_cila: cila };
}

async function modoTabla(sb: Sb) {
  let filas;
  try {
    const resp = await fetch(`${BASE_AQWP}/Data/GetTable?id=MexResScript&arguments=&take=50&skip=0&page=1&pageSize=50`,
      { headers: { "User-Agent": UA, "Accept-Language": "en-US" }, signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    filas = parseMexResScript(await resp.json());
    await gestionarAlerta(sb, "AQWP-FORMATO", false, "", "");
  } catch (e) {
    await gestionarAlerta(sb, "AQWP-FORMATO", true, "AQWP: tabla MexResScript no disponible o cambió",
      `No se pudo leer MexResScript del portal USIBWC: ${(e as Error).message}. Se conserva lo ya cargado.`);
    throw e;
  }
  // Cruce con lo cargado por export (almacenamiento diario)
  const { data: ubs } = await sb.from("aqwp_ubicaciones").select("id_number, codigo").eq("tipo", "presa");
  const idPorSigla = new Map<string, number>(); // 08-LBQCH-CONAGUA → LBQCH
  for (const u of ubs ?? []) idPorSigla.set(String(u.codigo).split("-")[1], u.id_number);
  const out: unknown[] = [];
  for (const f of filas) {
    const ubic = idPorSigla.get(f.id);
    if (!ubic || !f.fecha) continue;
    const { data: ds } = await sb.from("aqwp_datasets").select("id_number").eq("ubicacion_id", ubic).eq("magnitud", "almacenamiento").maybeSingle();
    const { data: l } = ds ? await sb.from("aqwp_lecturas_diarias").select("valor").eq("dataset_id", ds.id_number).eq("fecha", f.fecha).maybeSingle() : { data: null };
    const guardado = l?.valor != null ? Number(l.valor) : null;
    out.push({ presa: f.presa, fecha: f.fecha, tabla_mm3: f.almacenamiento_mm3, cargado_mm3: guardado,
      coincide: guardado != null && f.almacenamiento_mm3 != null ? Math.abs(guardado - f.almacenamiento_mm3) < 0.01 : null });
  }
  return { filas_tabla: filas.length, cruce: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb: Sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const t0 = Date.now();
  let modo = "export";
  try {
    const auth = await exigirRol(req, ["SRL"], { nombreSecreto: "aqwp_sync" }, sb);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    modo = body?.modo === "tabla" ? "tabla" : "export";
    const r = modo === "tabla" ? await modoTabla(sb) : await modoExport(sb, body ?? {});
    const errores = (r as { errores?: string[] }).errores ?? [];
    await sb.from("aqwp_sync_log").insert({
      modo, ok: errores.length === 0, datasets: (r as { datasets?: number }).datasets ?? 0,
      filas: (r as { filas?: number }).filas ?? 0, estancadas: (r as { estancadas?: number }).estancadas ?? 0,
      error: errores.length ? errores.slice(0, 5).join(" | ") : null, duracion_ms: Date.now() - t0,
    });
    return json({ ok: true, modo, ...r });
  } catch (e) {
    await sb.from("aqwp_sync_log").insert({ modo, ok: false, error: (e as Error).message, duracion_ms: Date.now() - t0 });
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
