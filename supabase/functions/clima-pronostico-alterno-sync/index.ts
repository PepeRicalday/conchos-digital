// ═══════════════════════════════════════════════════════════════════════════
// clima-pronostico-alterno-sync — pronósticos de modelos/proveedores alternos
// ---------------------------------------------------------------------------
// Guarda, por corrida (2 al día), el pronóstico de otros modelos para medir
// cuál acierta más sobre las estaciones de SICA ANTES de ensamblar nada:
//   · MET Norway Locationforecast 2.0 (gratis, CC BY 4.0, exige User-Agent propio)
//   · ECMWF IFS, GFS e ICON vía Open-Meteo (`models=`), misma API que el principal.
// No toca clima_pronostico_horario (serie principal de la que depende el front).
// Cada proveedor falla de forma independiente: un caído no bloquea a los demás.
//
// Invocación: cron (06:25 y 18:25 UTC) o POST manual sin body.
// Secreto opcional MET_USER_AGENT: identificación con contacto (la exige MET Norway).
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HORIZONTE_H = 48;
const TIMEOUT_MS = 20000;
const MODELOS_OM = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"];
const UA = Deno.env.get("MET_USER_AGENT") ?? "SICA005-SRL-Conchos/1.0 (sistema de riego Distrito 005 Delicias)";

interface Estacion { id: string; nombre: string; latitud: number; longitud: number; elevacion_msnm: number | null }
interface Fila {
  proveedor: string; valido_en: string; horizonte_h: number;
  temp_c: number | null; hum_rel_pct: number | null; viento_ms: number | null;
  precip_mm: number | null; nubosidad_total_pct: number | null;
}

const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

const horizonte = (validoMs: number, ahora: number) => (validoMs - ahora) / 3.6e6;

/** Open-Meteo con varios modelos: las variables llegan con sufijo `_<modelo>`. */
async function openMeteoModelos(est: Estacion, ahora: number): Promise<Fila[]> {
  const vars = ["temperature_2m", "relative_humidity_2m", "precipitation", "wind_speed_10m", "cloud_cover"];
  // Con `models=` las variables se piden sin sufijo; la respuesta las devuelve como `<var>_<modelo>`.
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${est.latitud}&longitude=${est.longitud}`
    + `&hourly=${vars.join(",")}&models=${MODELOS_OM.join(",")}&forecast_days=3&timezone=America%2FChihuahua&wind_speed_unit=ms`
    + (est.elevacion_msnm != null ? `&elevation=${est.elevacion_msnm}` : "");
  const body = await fetchJson(url);
  const h = body?.hourly;
  if (!h?.time?.length) throw new Error("Open-Meteo: respuesta sin serie horaria");
  const offSec: number = num(body.utc_offset_seconds) ?? -21600;
  const filas: Fila[] = [];
  for (const m of MODELOS_OM) {
    // Un modelo sin cobertura devuelve todo null: se omite en vez de guardarse como 0.
    if (!h[`temperature_2m_${m}`]?.some((x: unknown) => x != null)) continue;
    for (let i = 0; i < h.time.length; i++) {
      const validoMs = Date.parse(h.time[i] + "Z") - offSec * 1000;
      const hz = horizonte(validoMs, ahora);
      if (!Number.isFinite(validoMs) || hz < 0 || hz > HORIZONTE_H) continue;
      filas.push({
        proveedor: `open-meteo:${m}`, valido_en: new Date(validoMs).toISOString(), horizonte_h: Math.round(hz),
        temp_c: num(h[`temperature_2m_${m}`]?.[i]), hum_rel_pct: num(h[`relative_humidity_2m_${m}`]?.[i]),
        viento_ms: num(h[`wind_speed_10m_${m}`]?.[i]), precip_mm: num(h[`precipitation_${m}`]?.[i]),
        nubosidad_total_pct: num(h[`cloud_cover_${m}`]?.[i]),
      });
    }
  }
  return filas;
}

/** MET Norway: instantáneo (T, HR, viento, nubes) + precipitación de la hora siguiente. */
async function metNoruega(est: Estacion, ahora: number): Promise<Fila[]> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact`
    + `?lat=${Number(est.latitud).toFixed(4)}&lon=${Number(est.longitud).toFixed(4)}`
    + (est.elevacion_msnm != null ? `&altitude=${Math.round(est.elevacion_msnm)}` : "");
  const body = await fetchJson(url, { "User-Agent": UA });
  const serie = body?.properties?.timeseries;
  if (!Array.isArray(serie) || !serie.length) throw new Error("MET Norway: respuesta sin serie");
  const filas: Fila[] = [];
  for (const p of serie) {
    const validoMs = Date.parse(p.time);
    const hz = horizonte(validoMs, ahora);
    if (!Number.isFinite(validoMs) || hz < 0 || hz > HORIZONTE_H) continue;
    // Pasada la parte horaria solo hay bloques de 6 h: sin pronóstico de 1 h → precipitación null (S/D), no 0.
    const d = p.data?.instant?.details ?? {};
    const mm = p.data?.next_1_hours?.details?.precipitation_amount;
    filas.push({
      proveedor: "met-no", valido_en: new Date(validoMs).toISOString(), horizonte_h: Math.round(hz),
      temp_c: num(d.air_temperature), hum_rel_pct: num(d.relative_humidity), viento_ms: num(d.wind_speed),
      precip_mm: num(mm), nubosidad_total_pct: num(d.cloud_area_fraction),
    });
  }
  return filas;
}

/** Pronóstico diario a 7 días (Open-Meteo, modelo por defecto). Orientativo: la precisión cae después del día 3. */
async function pronosticoDiario(est: Estacion) {
  const vars = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max",
    "wind_speed_10m_max", "wind_gusts_10m_max", "et0_fao_evapotranspiration"].join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${est.latitud}&longitude=${est.longitud}`
    + `&daily=${vars}&forecast_days=7&timezone=America%2FChihuahua&wind_speed_unit=ms`
    + (est.elevacion_msnm != null ? `&elevation=${est.elevacion_msnm}` : "");
  const body = await fetchJson(url);
  const d = body?.daily;
  if (!d?.time?.length) throw new Error("Open-Meteo: respuesta sin serie diaria");
  const obtenidoEn = new Date().toISOString();
  return (d.time as string[]).map((fecha, i) => ({
    estacion_id: est.id, fecha, obtenido_en: obtenidoEn,
    temp_max_c: num(d.temperature_2m_max?.[i]), temp_min_c: num(d.temperature_2m_min?.[i]),
    precip_mm: num(d.precipitation_sum?.[i]), precip_prob_pct: num(d.precipitation_probability_max?.[i]),
    viento_max_ms: num(d.wind_speed_10m_max?.[i]), rafaga_max_ms: num(d.wind_gusts_10m_max?.[i]),
    eto_mm: num(d.et0_fao_evapotranspiration?.[i]),
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: estaciones, error: eEst } = await supabase
      .from("clima_estaciones").select("id, nombre, latitud, longitud, elevacion_msnm")
      .eq("activa", true).order("prioridad", { ascending: true });
    if (eEst) return json({ error: "clima_estaciones: " + eEst.message }, 500);
    if (!estaciones?.length) return json({ error: "No hay estaciones activas configuradas" }, 200);

    const ahora = Date.now();
    // Freno anti-abuso: la función acepta la anon key (pública, igual que sus hermanas) y cada llamada consume cuota
    // de Open-Meteo y de MET Norway (que bloquea a quien abusa). El cron corre cada 12 h; con datos de las
    // últimas 3 h se omite cada bloque (alternos y diario tienen su propio freno).
    const reciente = async (tabla: string, col: string) => {
      const { data } = await supabase.from(tabla).select(col).order(col, { ascending: false }).limit(1);
      const v = (data?.[0] as Record<string, string> | undefined)?.[col];
      return v ? ahora - Date.parse(v) < 3 * 3.6e6 : false;
    };
    const omiteAlternos = await reciente("clima_pronostico_alterno", "corrida_en");
    const omiteDiario = await reciente("clima_pronostico_diario", "obtenido_en");
    if (omiteAlternos && omiteDiario) return json({ ok: true, omitido: true, motivo: "corrida reciente" }, 200);
    const corridaEn = new Date(Math.floor(ahora / 3.6e6) * 3.6e6).toISOString();
    const resultados: Record<string, unknown>[] = [];

    for (const est of estaciones as Estacion[]) {
      // Cada fuente en su propio try: el fallo de una no descarta a la otra.
      const fuentes: [string, () => Promise<Fila[]>][] = [
        ["open-meteo-modelos", () => openMeteoModelos(est, ahora)],
        ["met-no", () => metNoruega(est, ahora)],
      ];
      for (const [nombre, obtener] of omiteAlternos ? [] : fuentes) {
        try {
          const filas = await obtener();
          if (!filas.length) { resultados.push({ estacion: est.nombre, fuente: nombre, ok: false, motivo: "sin filas en horizonte" }); continue; }
          const registros = filas.map((f) => ({ estacion_id: est.id, corrida_en: corridaEn, ...f }));
          const { error } = await supabase.from("clima_pronostico_alterno")
            .upsert(registros, { onConflict: "estacion_id,proveedor,corrida_en,valido_en" });
          resultados.push(error
            ? { estacion: est.nombre, fuente: nombre, ok: false, motivo: error.message }
            : { estacion: est.nombre, fuente: nombre, ok: true, filas: registros.length });
        } catch (err) {
          resultados.push({ estacion: est.nombre, fuente: nombre, ok: false, motivo: String(err) });
        }
      }
      if (!omiteDiario) {
        try {
          const dias = await pronosticoDiario(est);
          const { error } = await supabase.from("clima_pronostico_diario").upsert(dias, { onConflict: "estacion_id,fecha" });
          resultados.push(error
            ? { estacion: est.nombre, fuente: "diario", ok: false, motivo: error.message }
            : { estacion: est.nombre, fuente: "diario", ok: true, filas: dias.length });
        } catch (err) {
          resultados.push({ estacion: est.nombre, fuente: "diario", ok: false, motivo: String(err) });
        }
      }
    }

    await supabase.from("clima_pronostico_alterno").delete()
      .lt("corrida_en", new Date(ahora - 60 * 86400000).toISOString());
    await supabase.from("clima_pronostico_diario").delete()
      .lt("fecha", new Date(ahora - 7 * 86400000).toISOString().slice(0, 10));

    const ok = resultados.filter((r) => r.ok).length;
    return json({ ok: true, corrida_en: corridaEn, alternos_omitidos: omiteAlternos, diario_omitido: omiteDiario, fuentes_ok: ok, fuentes_total: resultados.length, resultados }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
