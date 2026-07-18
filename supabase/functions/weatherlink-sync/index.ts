// ═══════════════════════════════════════════════════════════════════════════
// weatherlink-sync — Sincroniza estaciones climáticas WeatherLink (Davis)
// ---------------------------------------------------------------------------
// Consulta la API v2 de WeatherLink para cada estación ACTIVA de la tabla
// clima_estaciones, convierte las unidades imperiales a métrico, calcula ETo
// (FAO-56 Penman-Monteith) y GDD, y hace upsert en:
//   · clima_estacion_lecturas  (serie temporal por estación, en métrico)
//   · clima_presas             (compat con la página Clima existente)
//
// Auth WeatherLink v2: api-key en query string + api-secret en header X-Api-Secret.
// Secretos (Deno.env): WEATHERLINK_API_KEY, WEATHERLINK_API_SECRET,
//                      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Invocación: por cron (pg_cron / scheduled function) o manual (POST). Sin body.
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WL_BASE = "https://api.weatherlink.com/v2";

// ── Conversión de unidades (WeatherLink entrega imperial) ───────────────────
const fToC = (f: number | null | undefined) => (f == null ? null : +(((f - 32) * 5) / 9).toFixed(2));
const inToMm = (v: number | null | undefined) => (v == null ? null : +(v * 25.4).toFixed(2));
const mphToMs = (v: number | null | undefined) => (v == null ? null : +(v * 0.44704).toFixed(2));
const inHgToHpa = (v: number | null | undefined) => (v == null ? null : +(v * 33.8639).toFixed(1));
// solar_rad de Davis ya viene en W/m²; UV index adimensional.

// ── ETo de referencia FAO-56 Penman-Monteith ────────────────────────────────
// ADVERTENCIA: esto extrapola una lectura INSTANTÁNEA a un día completo, así que
// solo es una aproximación válida en horas de sol y alta radiación. De noche
// (radiación 0) el término aerodinámico sigue produciendo valores de 0.5-3 mm
// que NO son un ETo diario: son ruido. Por eso el llamador solo lo usa como
// respaldo diurno, nunca de madrugada. Devuelve mm/día.
function etoPenmanMonteith(
  tempC: number | null, humPct: number | null, vientoMs: number | null,
  radWm2: number | null, elevM: number, dewC: number | null,
): number | null {
  if (tempC == null || humPct == null) return null;
  // Sin radiación significativa el cálculo no representa un día: se descarta.
  if (radWm2 == null || radWm2 < 50) return null;
  const T = tempC;
  const P = 101.3 * Math.pow((293 - 0.0065 * elevM) / 293, 5.26);          // kPa (presión por altitud)
  const gamma = 0.000665 * P;                                             // constante psicrométrica
  const es = 0.6108 * Math.exp((17.27 * T) / (T + 237.3));                // presión saturación (kPa)
  const ea = dewC != null
    ? 0.6108 * Math.exp((17.27 * dewC) / (dewC + 237.3))                  // real desde punto de rocío
    : es * (humPct / 100);                                                // o desde HR
  const delta = (4098 * es) / Math.pow(T + 237.3, 2);                     // pendiente curva vapor
  const u2 = vientoMs != null ? vientoMs : 2;                             // viento a 2 m (m/s)
  const Rs = radWm2 * 0.0864;                                             // W/m² → MJ/m²·día
  const Rn = 0.77 * Rs * 0.408;                                           // radiación neta aprox (mm-equiv)
  const num = 0.408 * delta * Rn + gamma * (900 / (T + 273)) * u2 * (es - ea);
  const den = delta + gamma * (1 + 0.34 * u2);
  const eto = num / den;
  return eto > 0 && eto < 20 ? +eto.toFixed(2) : null;                    // sanidad
}

// Grados-día de crecimiento base 10 °C (nogal/alfalfa), desde máx/mín del día.
function gdd(tmaxC: number | null, tminC: number | null): number | null {
  if (tmaxC == null || tminC == null) return null;
  return +Math.max(0, (tmaxC + tminC) / 2 - 10).toFixed(1);
}

// Extrae el primer valor no nulo de un campo entre los data-records de sensores.
function pick(records: Record<string, unknown>[], ...keys: string[]): number | null {
  for (const k of keys) for (const r of records) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

interface WLStation { station_id: number; sensors: { data: Record<string, unknown>[] }[] }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const API_KEY = Deno.env.get("WEATHERLINK_API_KEY");
    const API_SECRET = Deno.env.get("WEATHERLINK_API_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!API_KEY || !API_SECRET) {
      return json({ error: "Faltan WEATHERLINK_API_KEY / WEATHERLINK_API_SECRET" }, 500);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Estaciones activas a sincronizar
    const { data: estaciones, error: eEst } = await supabase
      .from("clima_estaciones")
      .select("id, station_id, nombre, elevacion_msnm, presa_id, rol")
      .eq("activa", true)
      .order("prioridad", { ascending: true });
    if (eEst) return json({ error: "clima_estaciones: " + eEst.message }, 500);
    if (!estaciones?.length) return json({ error: "No hay estaciones activas configuradas" }, 200);

    const wlHeaders = { "X-Api-Secret": API_SECRET };
    const resultados: Record<string, unknown>[] = [];

    for (const est of estaciones) {
      try {
        const r = await fetch(`${WL_BASE}/current/${est.station_id}?api-key=${API_KEY}`, { headers: wlHeaders });
        if (!r.ok) { resultados.push({ estacion: est.nombre, ok: false, http: r.status }); continue; }
        const body = (await r.json()) as WLStation;
        const records = (body.sensors ?? []).flatMap((s) => s.data ?? []);
        if (!records.length) { resultados.push({ estacion: est.nombre, ok: false, motivo: "sin data" }); continue; }

        // ts más reciente entre todos los sensores
        const tsSec = Math.max(...records.map((d) => (typeof d.ts === "number" ? d.ts : 0)));
        if (!tsSec) { resultados.push({ estacion: est.nombre, ok: false, motivo: "sin ts" }); continue; }
        const ts = new Date(tsSec * 1000);
        // fecha local America/Chihuahua (UTC-6/-7); usamos offset del payload si viene.
        const tzOff = pick(records, "tz_offset") ?? -21600;
        const fecha = new Date((tsSec + tzOff) * 1000).toISOString().slice(0, 10);

        // Lectura cruda (imperial) → métrico. NOTA: /current no trae máx/mín del
        // día (solo temp instantánea); tmax/tmin se derivan del histórico en BD.
        const tempC = fToC(pick(records, "temp"));
        const humPct = pick(records, "hum");
        const dewC = fToC(pick(records, "dew_point"));
        const presHpa = inHgToHpa(pick(records, "bar_sea_level", "bar"));
        // Tendencia barométrica (inHg/3h de Davis) → hPa/3h. Predictor de tiempo:
        // sube = mejora/estable, baja = probable deterioro/lluvia.
        const barTrendHpa = inHgToHpa(pick(records, "bar_trend"));
        const vientoMs = mphToMs(pick(records, "wind_speed_last", "wind_speed_avg_last_10_min"));
        const vientoDir = pick(records, "wind_dir_last", "wind_dir_scalar_avg_last_10_min");
        const rafagaMs = mphToMs(pick(records, "wind_speed_hi_last_2_min", "wind_gust_10_min"));
        const lluviaDia = pick(records, "rainfall_day_mm");           // ya en mm si rain_size=2
        const lluvia24 = pick(records, "rainfall_last_24_hr_mm");
        const lluviaMes = pick(records, "rainfall_month_mm");
        const lluviaAnio = pick(records, "rainfall_year_mm");
        const radWm2 = pick(records, "solar_rad");
        const uv = pick(records, "uv_index");
        const etDiaMm = inToMm(pick(records, "et_day"));              // ETo de la estación (in→mm)
        const etMesMm = inToMm(pick(records, "et_month"));

        // Máx/mín del día: /current no los trae, así que se derivan del histórico
        // de HOY ya guardado en BD, combinado con la lectura actual (rolling min/max).
        let tmaxC = tempC, tminC = tempC;
        const { data: hoy } = await supabase
          .from("clima_estacion_lecturas")
          .select("temp_c")
          .eq("estacion_id", est.id).eq("fecha", fecha).not("temp_c", "is", null);
        if (hoy?.length) {
          const temps = hoy.map((h: { temp_c: number }) => Number(h.temp_c)).concat(tempC != null ? [tempC] : []);
          if (temps.length) { tmaxC = Math.max(...temps); tminC = Math.min(...temps); }
        }

        // ETo del día: se PRIORIZA el acumulado diario de la estación (et_day, ya
        // integrado en el tiempo) sobre el Penman-Monteith instantáneo.
        //
        // IMPORTANTE — semántica de eto_mm: es el ACUMULADO DEL DÍA HASTA LA HORA
        // DE LA LECTURA, no el total diario. A las 11:00 vale ~1.2 mm y al cierre
        // del día ~5 mm. Nunca debe compararse contra un total de 24 h (p. ej. el
        // ETo pronosticado) sin normalizar el periodo: son magnitudes distintas.
        //
        // El P-M solo actúa de respaldo DIURNO (devuelve null con radiación < 50
        // W/m²), porque de madrugada extrapolar una lectura instantánea a un día
        // completo produce valores espurios de 0.5-3 mm.
        const etoPM = etoPenmanMonteith(tempC, humPct, vientoMs, radWm2, Number(est.elevacion_msnm) || 1200, dewC);
        const eto = etDiaMm != null && etDiaMm > 0 ? etDiaMm : etoPM;
        const gddVal = gdd(tmaxC, tminC);

        // 2. Upsert lectura por estación
        const { error: eIns } = await supabase.from("clima_estacion_lecturas").upsert({
          estacion_id: est.id, station_id: est.station_id, fecha, ts: ts.toISOString(),
          temp_c: tempC, temp_max_c: tmaxC, temp_min_c: tminC, hum_rel_pct: humPct,
          punto_rocio_c: dewC, presion_hpa: presHpa, viento_ms: vientoMs, viento_dir_deg: vientoDir,
          viento_rafaga_ms: rafagaMs, lluvia_dia_mm: lluviaDia, lluvia_24h_mm: lluvia24,
          lluvia_mes_mm: lluviaMes, lluvia_anio_mm: lluviaAnio, rad_solar_wm2: radWm2, uv_index: uv,
          et_dia_mm: etDiaMm, et_mes_mm: etMesMm, eto_mm: eto, gdd: gddVal,
          bar_trend_hpa: barTrendHpa,
          payload: { ts: tsSec, records_count: records.length },
        }, { onConflict: "estacion_id,ts" });
        if (eIns) { resultados.push({ estacion: est.nombre, ok: false, motivo: eIns.message }); continue; }

        // 3. Compat: si la estación es de presa, alimenta clima_presas (página Clima)
        if (est.presa_id) {
          await supabase.from("clima_presas").upsert({
            presa_id: est.presa_id, fecha,
            temp_ambiente_c: tempC, temp_maxima_c: tmaxC ?? tempC, temp_minima_c: tminC ?? tempC,
            precipitacion_mm: lluviaDia, evaporacion_mm: etDiaMm,
            dir_viento: vientoDir != null ? String(Math.round(vientoDir)) + "°" : null,
            intensidad_viento: vientoMs != null ? vientoMs.toFixed(1) : null,
          }, { onConflict: "presa_id,fecha" });
        }

        // 4. Marca de sincronización en la estación
        await supabase.from("clima_estaciones").update({
          ult_sync_en: new Date().toISOString(), ult_dato_en: ts.toISOString(), actualizado_en: new Date().toISOString(),
        }).eq("id", est.id);

        resultados.push({ estacion: est.nombre, ok: true, fecha, temp_c: tempC, eto_mm: eto, lluvia_dia_mm: lluviaDia });
      } catch (err) {
        resultados.push({ estacion: est.nombre, ok: false, motivo: String(err) });
      }
    }

    const okN = resultados.filter((x) => x.ok).length;
    return json({ ok: true, sincronizadas: okN, total: estaciones.length, resultados }, 200);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
