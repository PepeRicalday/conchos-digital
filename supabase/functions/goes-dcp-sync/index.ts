// ═══════════════════════════════════════════════════════════════════════════
// goes-dcp-sync — Estaciones hidrométricas GOES/DCP (monitor Sutron)
// ---------------------------------------------------------------------------
// Por cada estación activa de hidro_estaciones:
//   1. Lista las transmisiones (dcpout.jsp, look back N días).
//   2. Salta las ya guardadas (hidro_mensajes) y las de falla distinta de G (se registran, sin lecturas).
//   3. Baja cada mensaje nuevo (msg-html.jsp), lo parsea y hace upsert en hidro_lecturas.
//   4. Alerta en registro_alertas si la estación lleva >3 h sin mensaje bueno.
// Cuerpo opcional: { "dias": 30 } para backfill (por defecto 1), { "estacion": "C6301416" }.
// Auth: cabecera x-cron-secret (public.cron_secretos 'goes_dcp_sync') o JWT de usuario rol SRL.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { BASE_DCPMON, parseListado, parseMensaje, tsLectura } from "./parser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Sb = any;
const ORIGEN_ALERTA = "GOES-DCP-SYNC";
const HORAS_SIN_DATO = 3;
const DIAS_VALIDOS = [0, 1, 2, 3, 5, 7, 15, 30];
const MAX_MENSAJES_POR_ESTACION = 800; // backfill de 30 días = ~720

// El sitio responde en ISO-8859-1; los mensajes dañados traen bytes binarios.
async function descargar(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return new TextDecoder("latin1").decode(await r.arrayBuffer());
}

async function autorizado(sb: Sb, req: Request): Promise<boolean> {
  const secreto = req.headers.get("x-cron-secret");
  if (secreto) {
    const { data: s } = await sb.from("cron_secretos").select("valor").eq("nombre", "goes_dcp_sync").maybeSingle();
    if (!!s?.valor && s.valor === secreto) return true;
  }
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: u, error } = await sb.auth.getUser(jwt);
  if (error || !u?.user?.id) return false;
  const { data: perfil, error: eP } = await sb.from("perfiles_usuario").select("rol").eq("id", u.user.id).maybeSingle();
  return !eP && perfil?.rol === "SRL";
}

async function gestionarAlerta(sb: Sb, est: { id: string; nombre: string }, ultDato: string | null) {
  const origen = `${ORIGEN_ALERTA}:${est.id}`;
  const horas = ultDato ? (Date.now() - new Date(ultDato).getTime()) / 3_600_000 : Infinity;
  const sinDato = horas > HORAS_SIN_DATO;
  const { data: abiertas } = await sb.from("registro_alertas").select("id").eq("origen_id", origen).eq("resuelta", false);
  if (sinDato && (abiertas ?? []).length === 0) {
    await sb.from("registro_alertas").insert({
      tipo_riesgo: "warning", categoria: "fuente_datos", origen_id: origen,
      titulo: `Estación ${est.nombre} sin transmisión`,
      mensaje: `Sin mensaje GOES válido de ${est.nombre} (${est.id}) desde ${ultDato ?? "nunca"}. Se muestra S/D.`,
    });
  } else if (!sinDato && (abiertas ?? []).length > 0) {
    await sb.from("registro_alertas").update({ resuelta: true, fecha_resolucion: new Date().toISOString() })
      .eq("origen_id", origen).eq("resuelta", false);
  }
}

async function sincronizarEstacion(sb: Sb, est: { id: string; nombre: string; intervalo_min: number }, dias: number) {
  const r = { estacion: est.id, transmisiones: 0, nuevas: 0, con_falla: 0, lecturas: 0, errores: [] as string[] };
  const listado = parseListado(await descargar(
    `${BASE_DCPMON}/dcpout.jsp?select_option=dcp_text&dcp_text=${est.id}&date_range=${dias}&get_report=Get+Report`));
  r.transmisiones = listado.length;

  const { data: ya } = await sb.from("hidro_mensajes").select("ts_msg").eq("estacion_id", est.id)
    .gte("ts_msg", new Date(Date.now() - (dias + 1) * 86_400_000).toISOString());
  const guardadas = new Set((ya ?? []).map((m: { ts_msg: string }) => new Date(m.ts_msg).toISOString()));
  const nuevas = listado.filter((t) => !guardadas.has(t.ts_msg)).slice(0, MAX_MENSAJES_POR_ESTACION);
  r.nuevas = nuevas.length;

  for (const t of nuevas) {
    const base = { estacion_id: est.id, ts_msg: t.ts_msg, codigo_falla: t.codigo_falla, senal_dbm: t.senal_dbm, longitud: t.longitud };
    try {
      if (t.codigo_falla !== "G") {
        r.con_falla++;
        await sb.from("hidro_mensajes").upsert({ ...base, descartadas: null });
        continue;
      }
      const { lecturas, descartadas } = parseMensaje(await descargar(`${BASE_DCPMON}/msg-html.jsp?msgfilename=${t.msgfilename}`));
      if (lecturas.length === 0) { r.errores.push(`${t.ts_msg}: sin lecturas`); continue; } // se reintenta en la próxima corrida
      const filas = lecturas.map((l) => ({
        estacion_id: est.id, ts_utc: tsLectura(t.ts_msg, l.idx, l.n, est.intervalo_min),
        variable: l.variable, valor: l.valor, ts_msg: t.ts_msg, idx: l.idx,
      }));
      const { error: eL } = await sb.from("hidro_lecturas").upsert(filas, { onConflict: "estacion_id,ts_utc,variable" });
      if (eL) { r.errores.push(`${t.ts_msg}: ${eL.message}`); continue; }
      await sb.from("hidro_mensajes").upsert({ ...base, descartadas: descartadas.length ? descartadas : null });
      r.lecturas += filas.length;
    } catch (e) {
      r.errores.push(`${t.ts_msg}: ${(e as Error).message}`);
    }
  }

  const { data: ult } = await sb.from("hidro_mensajes").select("ts_msg").eq("estacion_id", est.id)
    .eq("codigo_falla", "G").order("ts_msg", { ascending: false }).limit(1).maybeSingle();
  await sb.from("hidro_estaciones").update({ ult_sync_en: new Date().toISOString(), ult_dato_en: ult?.ts_msg ?? null }).eq("id", est.id);
  await gestionarAlerta(sb, est, ult?.ts_msg ?? null);
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb: Sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (!(await autorizado(sb, req))) return json({ ok: false, error: "No autorizado" }, 401);
    const body = await req.json().catch(() => ({}));
    const dias = DIAS_VALIDOS.includes(Number(body?.dias)) ? Number(body.dias) : 1;

    let q = sb.from("hidro_estaciones").select("id, nombre, intervalo_min").eq("activa", true);
    if (body?.estacion) q = q.eq("id", String(body.estacion));
    const { data: estaciones, error } = await q;
    if (error) return json({ ok: false, error: error.message }, 500);

    const resultados = [];
    for (const est of estaciones ?? []) {
      try { resultados.push(await sincronizarEstacion(sb, est, dias)); }
      catch (e) { resultados.push({ estacion: est.id, errores: [(e as Error).message] }); }
    }
    return json({ ok: true, dias, resultados });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
