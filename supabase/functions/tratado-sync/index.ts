// ═══════════════════════════════════════════════════════════════════════════
// tratado-sync — Tratado de Aguas de 1944: volúmenes del ciclo quinquenal desde el USIBWC Water Data Portal.
// ---------------------------------------------------------------------------
// 1) Export CSV de "Discharge Total.Preliminary-Daily-Volume-TCM@<estación>" de los seis afluentes
//    (ventana body.dias, default 45; body.historico=true desde el inicio del ciclo). Upsert idempotente.
// 2) Corte semanal oficial: Current_Cycle.pdf (acumulado, deuda, fecha). Una fila por fecha de corte.
// Auth: x-cron-secret (cron_secretos 'tratado_sync') o JWT de usuario SRL. S/D = NULL, nunca 0.
// Fuente tercera, solo lectura. Datos provisionales del IBWC; sin garantía.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { exigirRol } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { aFecha, parseCsvExport, urlExport } from "../aqwp-sync/parser.ts";
import { descomprimirPrimero } from "../aqwp-sync/zip.ts";
import { parseCorte, textoDePdf } from "./parser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;
const UA = "SICA005-tratado-sync/1.0 (monitoreo DR-005 Delicias)";
const URL_CORTE = "https://ibwcsftpstg.blob.core.windows.net/wad/WeeklyReports/Current_Cycle.pdf";
const INICIO_CICLO = "2025-10-25";
const LOTE = 500;

async function descargar(titulo: string, desde: string, hasta: string) {
  const resp = await fetch(urlExport(titulo, desde, hasta), {
    headers: { "User-Agent": UA, "Accept-Language": "en-US" }, signal: AbortSignal.timeout(45_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return parseCsvExport(await descomprimirPrimero(new Uint8Array(await resp.arrayBuffer())));
}

async function gestionarAlerta(sb: Sb, activa: boolean, titulo: string, mensaje: string) {
  const origen = "TRATADO-SYNC";
  const { data: abiertas } = await sb.from("registro_alertas").select("id").eq("origen_id", origen).eq("resuelta", false);
  if (activa && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({ tipo_riesgo: "warning", categoria: "fuente_datos", origen_id: origen, titulo, mensaje });
  } else if (!activa && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() })
      .eq("origen_id", origen).eq("resuelta", false);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb: Sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const t0 = Date.now();
  let filas = 0;
  let corteFecha: string | null = null;
  const errores: string[] = [];
  try {
    const auth = await exigirRol(req, ["SRL"], { nombreSecreto: "tratado_sync" }, sb);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    const body = await req.json().catch(() => ({}));
    const dias = Math.min(Math.max(Number(body?.dias) || 45, 1), 500);
    const hoy = new Date();
    const hasta = aFecha(new Date(hoy.getTime() + 86_400_000));
    const desde = body?.historico === true ? INICIO_CICLO : aFecha(new Date(hoy.getTime() - dias * 86_400_000));

    // 1) volúmenes diarios de los seis afluentes
    const { data: afl, error: eA } = await sb.from("tratado_afluentes").select("clave, dataset_titulo");
    if (eA) throw new Error(`afluentes: ${eA.message}`);
    for (const a of (afl ?? []) as { clave: string; dataset_titulo: string }[]) {
      try {
        const serie = (await descargar(a.dataset_titulo, desde, hasta)).filter((f) => f.fecha >= INICIO_CICLO && f.fecha < hasta);
        const registros = serie.map((f) => ({ afluente: a.clave, fecha: f.fecha, tcm: f.valor, actualizado_en: new Date().toISOString() }));
        for (let i = 0; i < registros.length; i += LOTE) {
          const { error } = await sb.from("tratado_entregas_diarias").upsert(registros.slice(i, i + LOTE), { onConflict: "afluente,fecha" });
          if (error) throw new Error(error.message);
        }
        filas += registros.length;
      } catch (e) {
        errores.push(`${a.clave}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    // 2) corte semanal oficial
    try {
      const resp = await fetch(URL_CORTE, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const corte = parseCorte(await textoDePdf(new Uint8Array(await resp.arrayBuffer())));
      if (!corte) throw new Error("el PDF cambió de formato: no se halló el acumulado del ciclo");
      if (corte.cicloInicio && corte.cicloInicio !== INICIO_CICLO) throw new Error(`el IBWC reporta otro inicio de ciclo (${corte.cicloInicio})`);
      const { error } = await sb.from("tratado_cortes_oficiales").upsert({
        fecha_corte: corte.fechaCorte, ciclo_id: "C37", acumulado_af: corte.acumuladoAf, acumulado_mcm: corte.acumuladoMcm,
        deuda_remanente_af: corte.deudaRemanenteAf, fuente: "IBWC Current_Cycle.pdf", capturado_en: new Date().toISOString(),
      }, { onConflict: "fecha_corte" });
      if (error) throw new Error(error.message);
      if (corte.deudaRemanenteAf != null) await sb.from("tratado_ciclos").update({ deuda_remanente_af: corte.deudaRemanenteAf }).eq("id", "C37");
      corteFecha = corte.fechaCorte;
    } catch (e) {
      errores.push(`corte: ${(e as Error).message}`);
    }

    // Alerta si el corte oficial lleva > 10 días sin cambiar (se publica cada semana) o hubo errores.
    const { data: ult } = await sb.from("tratado_cortes_oficiales").select("fecha_corte").order("fecha_corte", { ascending: false }).limit(1);
    const edad = ult?.[0] ? Math.floor((hoy.getTime() - new Date(`${ult[0].fecha_corte}T00:00:00Z`).getTime()) / 86_400_000) : 999;
    const mal = errores.length > 0 || edad > 10;
    await gestionarAlerta(sb, mal, "Tratado 1944: fuente IBWC sin actualizar",
      errores.length ? `La sincronización del Tratado tuvo errores: ${errores.slice(0, 3).join(" | ")}` : `El corte oficial del IBWC lleva ${edad} días sin cambiar.`);

    await sb.from("tratado_sync_log").insert({ ok: errores.length === 0, filas, corte: corteFecha, error: errores.length ? errores.slice(0, 5).join(" | ") : null, duracion_ms: Date.now() - t0 });
    return json({ ok: errores.length === 0, filas, corte: corteFecha, errores });
  } catch (e) {
    await sb.from("tratado_sync_log").insert({ ok: false, error: (e as Error).message, duracion_ms: Date.now() - t0 });
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
