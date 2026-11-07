// ═══════════════════════════════════════════════════════════════════════════
// ibwc-telemetry-sync — Estaciones USIBWC (TelemetryTXT), p.ej. 08373000 Río Conchos cerca de Ojinaga
// ---------------------------------------------------------------------------
// Para cada hidro_estaciones activa con id 'IBWC-<sitio>':
//   1. Baja <BASE>/<sitio>.txt (ventana móvil de 30 días, 15 min, hora CST).
//   2. Upsert idempotente de nivel_m / gasto_m3s en hidro_lecturas, solo 1 lectura cada intervalo_min
//      (120 = horas pares) para no saturar la base. S/D se omite, nunca 0.
//   3. Registra UN "mensaje" por corrida en hidro_mensajes (ts_msg = última lectura publicada,
//      codigo_falla 'G') para que la UI mida frescura del enlace igual que con Sutron.
//   4. Alerta en registro_alertas si lleva >3 h sin lectura nueva.
// Auth: x-cron-secret (public.cron_secretos 'ibwc_telemetry_sync') o JWT de usuario rol SRL.
// Cuerpo opcional: { "estacion": "IBWC-08373000" }.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { BASE_IBWC, filtrarCadencia, parseTelemetriaIbwc } from "./parser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;
const ORIGEN_ALERTA = "IBWC-SYNC";
const HORAS_SIN_DATO = 4.5; // se guarda cada 2 h y el archivo publica con ~40 min de retraso: la última lectura llega a tener ~2 h 50 min
const LOTE = 1000;
const PREFIJO = "IBWC-";

async function autorizado(sb: Sb, req: Request): Promise<boolean> {
  const secreto = req.headers.get("x-cron-secret");
  if (secreto) {
    const { data: s } = await sb.from("cron_secretos").select("valor").eq("nombre", "ibwc_telemetry_sync").maybeSingle();
    if (!!s?.valor && s.valor === secreto) return true;
  }
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: u, error } = await sb.auth.getUser(jwt);
  if (error || !u?.user?.id) return false;
  const { data: perfil, error: eP } = await sb.from("perfiles_usuario").select("rol").eq("id", u.user.id).maybeSingle();
  return !eP && perfil?.rol === "SRL";
}

async function gestionarAlerta(sb: Sb, est: { id: string; nombre: string }, ultDato: string | null, motivo: string | null) {
  const origen = `${ORIGEN_ALERTA}:${est.id}`;
  const horas = ultDato ? (Date.now() - new Date(ultDato).getTime()) / 3_600_000 : Infinity;
  const sinDato = horas > HORAS_SIN_DATO;
  const { data: abiertas } = await sb.from("registro_alertas").select("id").eq("origen_id", origen).eq("resuelta", false);
  if (sinDato && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({
      tipo_riesgo: "warning", categoria: "fuente_datos", origen_id: origen,
      titulo: `Estación ${est.nombre} sin datos`,
      mensaje: `Sin lectura USIBWC de ${est.nombre} (${est.id}) desde ${ultDato ?? "nunca"}${motivo ? ` (${motivo})` : ""}. Se muestra S/D.`,
    });
  } else if (!sinDato && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() })
      .eq("origen_id", origen).eq("resuelta", false);
  }
}

async function sincronizarEstacion(sb: Sb, est: { id: string; nombre: string; intervalo_min: number }) {
  const sitio = est.id.slice(PREFIJO.length);
  const r = { estacion: est.id, filas_archivo: 0, lecturas: 0, mensajes: 0, descartadas: 0, errores: [] as string[] };
  let motivo: string | null = null;
  try {
    const resp = await fetch(`${BASE_IBWC}/${sitio}.txt`, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const p = parseTelemetriaIbwc(await resp.text());
    if (p.sitio && p.sitio !== sitio) throw new Error(`El archivo es del sitio ${p.sitio}, no ${sitio}`);
    r.filas_archivo = p.lineasDatos;
    r.descartadas = p.descartadas;
    if (p.lecturas.length === 0) throw new Error("Archivo sin lecturas válidas");

    // Cadencia de guardado = intervalo_min de la estación (120): una lectura cada 2 h para no saturar la base.
    const guardar = filtrarCadencia(p.lecturas, est.intervalo_min);
    if (guardar.length === 0) throw new Error("Sin lecturas en la cadencia de guardado");
    const filas = guardar.map((l, i) => ({
      estacion_id: est.id, ts_utc: l.ts_utc, variable: l.variable, valor: l.valor, ts_msg: l.ts_utc, idx: i % 2,
    }));
    for (let i = 0; i < filas.length; i += LOTE) {
      const { error } = await sb.from("hidro_lecturas").upsert(filas.slice(i, i + LOTE), { onConflict: "estacion_id,ts_utc,variable" });
      if (error) throw new Error(`lecturas: ${error.message}`);
    }
    r.lecturas = filas.length;

    // Un solo "mensaje" por corrida: la última lectura publicada (mide frescura del enlace aunque se guarde cada 2 h).
    const ultima = p.lecturas[p.lecturas.length - 1].ts_utc;
    const { error: eM } = await sb.from("hidro_mensajes").upsert(
      { estacion_id: est.id, ts_msg: ultima, codigo_falla: "G", senal_dbm: null, longitud: null, descartadas: null },
      { onConflict: "estacion_id,ts_msg" });
    if (eM) throw new Error(`mensajes: ${eM.message}`);
    r.mensajes = 1;
  } catch (e) {
    motivo = (e as Error).message;
    r.errores.push(motivo);
  }

  const { data: ult } = await sb.from("hidro_mensajes").select("ts_msg").eq("estacion_id", est.id)
    .eq("codigo_falla", "G").order("ts_msg", { ascending: false }).limit(1).maybeSingle();
  await sb.from("hidro_estaciones").update({ ult_sync_en: new Date().toISOString(), ult_dato_en: ult?.ts_msg ?? null }).eq("id", est.id);
  await gestionarAlerta(sb, est, ult?.ts_msg ?? null, motivo);
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb: Sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (!(await autorizado(sb, req))) return json({ ok: false, error: "No autorizado" }, 401);
    const body = await req.json().catch(() => ({}));
    let q = sb.from("hidro_estaciones").select("id, nombre, intervalo_min").eq("activa", true).like("id", `${PREFIJO}%`);
    if (body?.estacion) q = q.eq("id", String(body.estacion));
    const { data: estaciones, error } = await q;
    if (error) return json({ ok: false, error: error.message }, 500);

    const resultados = [];
    for (const est of estaciones ?? []) {
      try { resultados.push(await sincronizarEstacion(sb, est)); }
      catch (e) { resultados.push({ estacion: est.id, errores: [(e as Error).message] }); }
    }
    return json({ ok: true, resultados });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
