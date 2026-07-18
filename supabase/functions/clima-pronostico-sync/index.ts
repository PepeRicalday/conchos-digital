// ═══════════════════════════════════════════════════════════════════════════
// clima-pronostico-sync — Adaptador de pronóstico horario (nubosidad + lluvia)
// ---------------------------------------------------------------------------
// Aporta el dato que faltaba en el módulo agroclimático: COBERTURA NUBOSA real
// (total, baja, media y alta), pronosticada por modelo. Sin ella el sistema no
// puede afirmar el estado del cielo, y la regla del módulo es que la condición
// del cielo NO se infiere de la probabilidad de lluvia.
//
// El proveedor está aislado tras la interfaz `AdaptadorPronostico`: sustituirlo
// (Google Weather, AEMET, un WRF propio) no exige tocar el resto de SICA — solo
// añadir otro objeto que devuelva `FilaPronostico[]`.
//
// Proveedor actual: Open-Meteo. Sin API key, entrega cloud_cover por capas,
// precipitación con probabilidad y ETo FAO-56 horaria.
//
// Invocación: por cron (cada hora) o manual (POST). Sin body.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Horas de horizonte a persistir (el documento pide 24-72 h). */
const HORIZONTE_H = 48;

interface Estacion {
  id: string;
  station_id: number;
  nombre: string;
  latitud: number;
  longitud: number;
  elevacion_msnm: number | null;
}

/** Fila normalizada: contrato interno, independiente del proveedor. */
interface FilaPronostico {
  valido_en: string;
  fecha_local: string;
  horizonte_h: number;
  nubosidad_total_pct: number | null;
  nubosidad_baja_pct: number | null;
  nubosidad_media_pct: number | null;
  nubosidad_alta_pct: number | null;
  precip_prob_pct: number | null;
  precip_mm: number | null;
  weather_code: number | null;
  temp_c: number | null;
  hum_rel_pct: number | null;
  viento_ms: number | null;
  viento_rafaga_ms: number | null;
  rad_solar_wm2: number | null;
  eto_fc_mm: number | null;
}

interface AdaptadorPronostico {
  nombre: string;
  modelo: string;
  obtener(est: Estacion): Promise<{ filas: FilaPronostico[]; corridaEn: string | null }>;
}

// ── Adaptador Open-Meteo ───────────────────────────────────────────────────
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const openMeteo: AdaptadorPronostico = {
  nombre: "open-meteo",
  modelo: "best_match",

  async obtener(est) {
    const vars = [
      "temperature_2m", "relative_humidity_2m",
      "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
      "precipitation_probability", "precipitation", "weather_code",
      "wind_speed_10m", "wind_gusts_10m",
      "shortwave_radiation", "et0_fao_evapotranspiration",
    ].join(",");

    const url = `https://api.open-meteo.com/v1/forecast`
      + `?latitude=${est.latitud}&longitude=${est.longitud}`
      + `&hourly=${vars}`
      + `&forecast_days=3`
      + `&timezone=America%2FChihuahua`
      // m/s en vez de km/h: el resto de SICA trabaja en métrico SI.
      + `&wind_speed_unit=ms`
      + (est.elevacion_msnm != null ? `&elevation=${est.elevacion_msnm}` : "");

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}: ${await r.text()}`);
    const body = await r.json();

    const h = body?.hourly;
    if (!h?.time?.length) throw new Error("Open-Meteo: respuesta sin serie horaria");

    // `time` viene en hora local de la estación (timezone=America/Chihuahua) y
    // `utc_offset_seconds` permite reconstruir el instante UTC exacto.
    const offSec: number = num(body.utc_offset_seconds) ?? -21600;
    const ahora = Date.now();
    const filas: FilaPronostico[] = [];

    for (let i = 0; i < h.time.length; i++) {
      const local: string = h.time[i];                       // "2026-07-18T07:00"
      const validoMs = Date.parse(local + "Z") - offSec * 1000;
      if (!Number.isFinite(validoMs)) continue;
      // Solo hacia adelante y dentro del horizonte.
      const horizonte = (validoMs - ahora) / 3.6e6;
      if (horizonte < -1 || horizonte > HORIZONTE_H) continue;

      filas.push({
        valido_en: new Date(validoMs).toISOString(),
        fecha_local: local.slice(0, 10),
        horizonte_h: Math.round(horizonte),
        nubosidad_total_pct: num(h.cloud_cover?.[i]),
        nubosidad_baja_pct: num(h.cloud_cover_low?.[i]),
        nubosidad_media_pct: num(h.cloud_cover_mid?.[i]),
        nubosidad_alta_pct: num(h.cloud_cover_high?.[i]),
        precip_prob_pct: num(h.precipitation_probability?.[i]),
        precip_mm: num(h.precipitation?.[i]),
        weather_code: num(h.weather_code?.[i]),
        temp_c: num(h.temperature_2m?.[i]),
        hum_rel_pct: num(h.relative_humidity_2m?.[i]),
        viento_ms: num(h.wind_speed_10m?.[i]),
        viento_rafaga_ms: num(h.wind_gusts_10m?.[i]),
        rad_solar_wm2: num(h.shortwave_radiation?.[i]),
        eto_fc_mm: num(h.et0_fao_evapotranspiration?.[i]),
      });
    }

    // Open-Meteo no publica la hora de corrida; `generationtime` no lo es.
    // Usamos la hora de obtención truncada a la hora como referencia de versión.
    const corridaEn = new Date(Math.floor(ahora / 3.6e6) * 3.6e6).toISOString();
    return { filas, corridaEn };
  },
};

const ADAPTADOR: AdaptadorPronostico = openMeteo;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: estaciones, error: eEst } = await supabase
      .from("clima_estaciones")
      .select("id, station_id, nombre, latitud, longitud, elevacion_msnm")
      .eq("activa", true)
      .order("prioridad", { ascending: true });
    if (eEst) return json({ error: "clima_estaciones: " + eEst.message }, 500);
    if (!estaciones?.length) return json({ error: "No hay estaciones activas configuradas" }, 200);

    const resultados: Record<string, unknown>[] = [];
    const obtenidoEn = new Date().toISOString();

    for (const est of estaciones as Estacion[]) {
      try {
        const { filas, corridaEn } = await ADAPTADOR.obtener(est);
        if (!filas.length) {
          resultados.push({ estacion: est.nombre, ok: false, motivo: "sin filas en horizonte" });
          continue;
        }

        const registros = filas.map((f) => ({
          estacion_id: est.id,
          proveedor: ADAPTADOR.nombre,
          modelo: ADAPTADOR.modelo,
          corrida_en: corridaEn,
          obtenido_en: obtenidoEn,
          ...f,
          payload: null,
        }));

        // La corrida nueva sobrescribe la anterior para el mismo instante.
        const { error: eUp } = await supabase
          .from("clima_pronostico_horario")
          .upsert(registros, { onConflict: "estacion_id,valido_en,proveedor" });
        if (eUp) {
          resultados.push({ estacion: est.nombre, ok: false, motivo: eUp.message });
          continue;
        }

        const prox = filas[0];
        resultados.push({
          estacion: est.nombre, ok: true, horas: filas.length,
          nubosidad_proxima_pct: prox.nubosidad_total_pct,
          precip_prob_pct: prox.precip_prob_pct,
        });
      } catch (err) {
        resultados.push({ estacion: est.nombre, ok: false, motivo: String(err) });
      }
    }

    // Purga de pronósticos vencidos: la serie solo se consulta hacia adelante.
    await supabase
      .from("clima_pronostico_horario")
      .delete()
      .lt("valido_en", new Date(Date.now() - 14 * 86400000).toISOString());

    const okN = resultados.filter((x) => x.ok).length;
    return json({
      ok: true, proveedor: ADAPTADOR.nombre, modelo: ADAPTADOR.modelo,
      sincronizadas: okN, total: estaciones.length, resultados,
    }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
