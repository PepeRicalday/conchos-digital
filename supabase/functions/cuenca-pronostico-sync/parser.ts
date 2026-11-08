// ═══════════════════════════════════════════════════════════════════════════
// Parser de la respuesta diaria de Open-Meteo para varios puntos de la cuenca — puro (se prueba con vitest)
// ---------------------------------------------------------------------------
// Una petición con N coordenadas devuelve un ARREGLO de N objetos en el mismo orden; con una sola coordenada devuelve un OBJETO.
// Estricto: si el orden/cantidad no cuadra o falta `daily.time`, lanza FormatoOpenMeteoError y no se guarda nada (no se adivina).
// S/D = null, nunca 0: un valor ausente o no finito es null.
// ═══════════════════════════════════════════════════════════════════════════

export class FormatoOpenMeteoError extends Error {}

export const MODELOS_CUENCA = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"] as const;
export const VARIABLES_DIARIAS = [
  "precipitation_sum", "precipitation_probability_max", "temperature_2m_mean", "temperature_2m_max", "temperature_2m_min",
  "relative_humidity_2m_mean", "wind_speed_10m_mean",
] as const;

export interface FilaDia {
  fecha: string;
  precip_mm: number | null; precip_prob_pct: number | null;
  temp_media_c: number | null; temp_max_c: number | null; temp_min_c: number | null;
  hum_media_pct: number | null; viento_medio_kmh: number | null;
}
export interface PuntoRespuesta { elevacion: number | null; dias: FilaDia[] }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** URL de una petición con todos los puntos y un solo modelo. */
export function urlPronostico(puntos: { lat: number; lon: number }[], modelo: string, dias = 7): string {
  const lat = puntos.map((p) => p.lat.toFixed(4)).join(","), lon = puntos.map((p) => p.lon.toFixed(4)).join(",");
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${VARIABLES_DIARIAS.join(",")}` +
    `&models=${modelo}&timezone=America%2FChihuahua&forecast_days=${dias}&wind_speed_unit=kmh`;
}

export function parseRespuesta(json: unknown, nPuntos: number): PuntoRespuesta[] {
  const lista = Array.isArray(json) ? json : [json];
  if (lista.length !== nPuntos) throw new FormatoOpenMeteoError(`se pidieron ${nPuntos} puntos y llegaron ${lista.length}`);
  return lista.map((r, k) => {
    const o = r as { elevation?: unknown; daily?: Record<string, unknown>; error?: unknown; reason?: unknown } | null;
    if (!o || o.error || !o.daily) throw new FormatoOpenMeteoError(`punto ${k}: ${o?.reason ?? "sin bloque daily"}`);
    const t = o.daily.time;
    if (!Array.isArray(t) || t.length === 0 || t.some((x) => typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x))) {
      throw new FormatoOpenMeteoError(`punto ${k}: daily.time ilegible`);
    }
    const col = (nombre: string): unknown[] => {
      const a = o.daily![nombre];
      if (!Array.isArray(a) || a.length !== t.length) throw new FormatoOpenMeteoError(`punto ${k}: ${nombre} ausente o de otra longitud`);
      return a;
    };
    const c = Object.fromEntries(VARIABLES_DIARIAS.map((v) => [v, col(v)])) as Record<(typeof VARIABLES_DIARIAS)[number], unknown[]>;
    const dias: FilaDia[] = (t as string[]).map((fecha, i) => {
      const mm = num(c.precipitation_sum[i]), vi = num(c.wind_speed_10m_mean[i]);
      return {
        fecha,
        precip_mm: mm != null && mm >= 0 ? mm : null,
        precip_prob_pct: num(c.precipitation_probability_max[i]),
        temp_media_c: num(c.temperature_2m_mean[i]), temp_max_c: num(c.temperature_2m_max[i]), temp_min_c: num(c.temperature_2m_min[i]),
        hum_media_pct: num(c.relative_humidity_2m_mean[i]),
        viento_medio_kmh: vi != null && vi >= 0 ? vi : null,
      };
    });
    return { elevacion: num(o.elevation), dias };
  });
}
