// ═══════════════════════════════════════════════════════════════════════════
// clima-historico-satelital-sync — Adaptador de clima histórico por satélite
// ---------------------------------------------------------------------------
// Complementa (no sustituye) a clima-pronostico-sync: aquella trae pronóstico
// de corto plazo (horizonte 48 h, Open-Meteo); esta trae clima histórico /
// casi-tiempo-real por coordenada exacta, sin necesidad de estación física.
//
// Uso previsto:
//   1. Calibración cruzada: contrastar radiación/ET0 satelital contra lo que
//      miden las 4 estaciones WeatherLink en el mismo punto.
//   2. Relleno de huecos: si una estación estuvo caída N días, aquí hay una
//      estimación satelital de esos días (no un promedio ni una interpolación).
//   3. Clima en puntos del canal sin estación física instalada.
//
// Mismo espíritu que clima-pronostico-sync: proveedor aislado tras
// `AdaptadorHistorico` para poder sustituirlo sin tocar el resto de SICA.
//
// Proveedor actual: NASA POWER (power.larc.nasa.gov). Sin API key, gratuito.
// IMPORTANTE: POWER tiene rezago de días (datos "casi-tiempo-real" revisados
// hasta ~3 meses después) — por diseño NO se usa como fuente de pronóstico
// operativo, solo de referencia histórica.
//
// Invocación: por cron (diario) o manual (POST). Body opcional:
//   { "dias": 7 }  — cuántos días hacia atrás sincronizar (default 7).
// ═══════════════════════════════════════════════════════════════════════════
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DIAS_DEFAULT = 7;

interface Estacion {
  id: string;
  station_id: number;
  nombre: string;
  latitud: number;
  longitud: number;
  elevacion_msnm: number | null;
}

/** Fila normalizada: contrato interno, independiente del proveedor. */
interface FilaHistorico {
  fecha: string;                 // YYYY-MM-DD
  rad_solar_sat_wm2: number | null;
  temp_sat_c: number | null;
  hum_rel_sat_pct: number | null;
  viento_sat_ms: number | null;
  precip_sat_mm: number | null;
  eto_sat_mm: number | null;
}

interface AdaptadorHistorico {
  nombre: string;
  comunidad: string;
  obtener(lat: number, lon: number, inicio: string, fin: string): Promise<FilaHistorico[]>;
}

// ── Adaptador NASA POWER ───────────────────────────────────────────────────
const num = (v: unknown): number | null => {
  // POWER usa -999 como centinela de "sin dato".
  if (typeof v !== "number" || !Number.isFinite(v) || v <= -900) return null;
  return v;
};

const fechaCompacta = (iso: string) => iso.replaceAll("-", ""); // 2026-08-02 -> 20260802

const nasaPower: AdaptadorHistorico = {
  nombre: "nasa-power",
  comunidad: "AG",

  async obtener(lat, lon, inicio, fin) {
    const params = [
      "ALLSKY_SFC_SW_DWN", // radiación solar superficial, MJ/m²/día
      "T2M",               // temperatura a 2m, °C
      "RH2M",               // humedad relativa a 2m, %
      "WS2M",               // viento a 2m, m/s
      "PRECTOTCORR",        // precipitación corregida, mm/día
      "ET0",                 // evapotranspiración de referencia, mm/día (perfil AG)
    ].join(",");

    const url = `https://power.larc.nasa.gov/api/temporal/daily/point`
      + `?parameters=${params}`
      + `&community=AG`
      + `&latitude=${lat}&longitude=${lon}`
      + `&start=${fechaCompacta(inicio)}&end=${fechaCompacta(fin)}`
      + `&format=JSON`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`NASA POWER HTTP ${r.status}: ${await r.text()}`);
    const body = await r.json();

    const p = body?.properties?.parameter;
    if (!p) throw new Error("NASA POWER: respuesta sin 'properties.parameter'");

    const fechas: string[] = Object.keys(p.T2M ?? p.ALLSKY_SFC_SW_DWN ?? {});
    const filas: FilaHistorico[] = fechas.map((f) => {
      // POWER da radiación en MJ/m²/día; el resto de SICA trabaja W/m² (rad_solar_wm2
      // en clima_estacion_lecturas y clima_pronostico_horario) — se convierte al
      // promedio equivalente en W/m² para que sea comparable: 1 MJ/m²/día ≈ 11.574 W/m².
      const radMj = num(p.ALLSKY_SFC_SW_DWN?.[f]);
      return {
        fecha: `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`,
        rad_solar_sat_wm2: radMj != null ? Math.round(radMj * 11.574 * 100) / 100 : null,
        temp_sat_c: num(p.T2M?.[f]),
        hum_rel_sat_pct: num(p.RH2M?.[f]),
        viento_sat_ms: num(p.WS2M?.[f]),
        precip_sat_mm: num(p.PRECTOTCORR?.[f]),
        eto_sat_mm: num(p.ET0?.[f]),
      };
    });

    return filas;
  },
};

const ADAPTADOR: AdaptadorHistorico = nasaPower;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    let dias = DIAS_DEFAULT;
    try {
      const body = await req.json();
      if (Number.isFinite(body?.dias) && body.dias > 0) dias = Math.min(body.dias, 366);
    } catch {
      // Sin body o no-JSON: usa el default.
    }

    const hoy = new Date();
    // POWER "casi-tiempo-real" suele tener 2-3 días de rezago real; se pide
    // hasta hoy y el proveedor simplemente no devolverá fechas sin publicar.
    const fin = hoy.toISOString().slice(0, 10);
    const inicioDate = new Date(hoy.getTime() - dias * 86400000);
    const inicio = inicioDate.toISOString().slice(0, 10);

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
        const filas = await ADAPTADOR.obtener(est.latitud, est.longitud, inicio, fin);
        if (!filas.length) {
          resultados.push({ estacion: est.nombre, ok: false, motivo: "sin filas en el rango" });
          continue;
        }

        const registros = filas.map((f) => ({
          estacion_id: est.id,
          latitud: est.latitud,
          longitud: est.longitud,
          proveedor: ADAPTADOR.nombre,
          comunidad: ADAPTADOR.comunidad,
          obtenido_en: obtenidoEn,
          ...f,
          payload: null,
        }));

        const { error: eUp } = await supabase
          .from("clima_historico_satelital")
          .upsert(registros, { onConflict: "latitud,longitud,fecha,proveedor" });
        if (eUp) {
          resultados.push({ estacion: est.nombre, ok: false, motivo: eUp.message });
          continue;
        }

        resultados.push({ estacion: est.nombre, ok: true, dias: filas.length });
      } catch (err) {
        resultados.push({ estacion: est.nombre, ok: false, motivo: String(err) });
      }
    }

    const okN = resultados.filter((x) => x.ok).length;
    return json({
      ok: true, proveedor: ADAPTADOR.nombre, comunidad: ADAPTADOR.comunidad,
      rango: { inicio, fin }, sincronizadas: okN, total: estaciones.length, resultados,
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
