-- ═══════════════════════════════════════════════════════════════════════════
-- CALIBRACIÓN CRUZADA — NASA POWER vs. estaciones WeatherLink — SICA-005
-- Fecha: 2026-08-08
--
-- clima_historico_satelital ya trae radiación/ETo por satélite en la misma
-- coordenada exacta de cada estación WeatherLink; clima_estacion_lecturas ya
-- trae lo que el sensor midió ese mismo día. Nadie las compara. Esta función
-- agrega ambas series a nivel diario (la estación reporta cada 2h, POWER es
-- diario) y calcula el error, para detectar sensores descalibrados o mal
-- orientados — problema de mantenimiento de campo, no solo de software.
--
-- rad_solar_wm2 de la estación es instantáneo (W/m²); rad_solar_sat_wm2 de
-- POWER ya viene convertido a promedio equivalente W/m² en el sync (ver
-- clima-historico-satelital-sync/index.ts). Promediar las lecturas del día de
-- la estación es la forma correcta de hacerlas comparables con el promedio
-- diario satelital — comparar un instante contra un promedio diario sería
-- inválido.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_clima_calibracion_cruzada(
  p_dias INT DEFAULT 30,
  p_estacion_id UUID DEFAULT NULL
)
RETURNS TABLE (
  estacion_id UUID,
  estacion_nombre TEXT,
  fecha DATE,
  rad_obs_wm2 NUMERIC,
  rad_sat_wm2 NUMERIC,
  error_rad_pct NUMERIC,
  eto_obs_mm NUMERIC,
  eto_sat_mm NUMERIC,
  error_eto_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH obs_diario AS (
    SELECT
      l.estacion_id, l.fecha,
      AVG(l.rad_solar_wm2) FILTER (WHERE l.rad_solar_wm2 > 0) AS rad_obs_wm2,
      MAX(l.eto_mm) AS eto_obs_mm  -- eto_mm es acumulado del día: el máximo del día es el total
    FROM public.clima_estacion_lecturas l
    WHERE l.fecha >= (CURRENT_DATE - p_dias)
      AND (p_estacion_id IS NULL OR l.estacion_id = p_estacion_id)
    GROUP BY l.estacion_id, l.fecha
  ),
  sat AS (
    SELECT
      ce.id AS estacion_id, h.fecha,
      h.rad_solar_sat_wm2, h.eto_sat_mm
    FROM public.clima_historico_satelital h
    JOIN public.clima_estaciones ce
      ON ce.latitud = h.latitud AND ce.longitud = h.longitud
    WHERE h.fecha >= (CURRENT_DATE - p_dias)
      AND (p_estacion_id IS NULL OR ce.id = p_estacion_id)
  )
  SELECT
    o.estacion_id, ce.nombre AS estacion_nombre, o.fecha,
    ROUND(o.rad_obs_wm2::numeric, 1) AS rad_obs_wm2,
    ROUND(s.rad_solar_sat_wm2::numeric, 1) AS rad_sat_wm2,
    CASE WHEN o.rad_obs_wm2 > 0 AND s.rad_solar_sat_wm2 IS NOT NULL
      THEN ROUND((100.0 * (o.rad_obs_wm2 - s.rad_solar_sat_wm2) / s.rad_solar_sat_wm2)::numeric, 1)
      ELSE NULL END AS error_rad_pct,
    ROUND(o.eto_obs_mm::numeric, 2) AS eto_obs_mm,
    ROUND(s.eto_sat_mm::numeric, 2) AS eto_sat_mm,
    CASE WHEN o.eto_obs_mm > 0 AND s.eto_sat_mm IS NOT NULL
      THEN ROUND((100.0 * (o.eto_obs_mm - s.eto_sat_mm) / s.eto_sat_mm)::numeric, 1)
      ELSE NULL END AS error_eto_pct
  FROM obs_diario o
  JOIN sat s ON s.estacion_id = o.estacion_id AND s.fecha = o.fecha
  JOIN public.clima_estaciones ce ON ce.id = o.estacion_id
  ORDER BY o.estacion_id, o.fecha DESC;
$$;

COMMENT ON FUNCTION public.fn_clima_calibracion_cruzada IS
  'Compara radiación/ETo observada (WeatherLink) contra la misma coordenada vía satélite (NASA POWER) día a día. Un error sostenido en una estación sugiere sensor descalibrado o mal orientado, no ruido del modelo.';

-- Resumen: error medio por estación en la ventana, para un vistazo rápido de
-- "qué estación necesita revisión de campo" sin recorrer el detalle diario.
CREATE OR REPLACE FUNCTION public.fn_clima_calibracion_resumen(
  p_dias INT DEFAULT 30
)
RETURNS TABLE (
  estacion_nombre TEXT,
  n_dias BIGINT,
  error_rad_medio_pct NUMERIC,
  error_eto_medio_pct NUMERIC,
  alerta BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    estacion_nombre,
    COUNT(*) AS n_dias,
    ROUND(AVG(error_rad_pct)::numeric, 1) AS error_rad_medio_pct,
    ROUND(AVG(error_eto_pct)::numeric, 1) AS error_eto_medio_pct,
    -- Umbral de alerta: >15% de sesgo sostenido en radiación es más de lo que
    -- explica variabilidad atmosférica normal entre punto y satélite.
    (ABS(AVG(error_rad_pct)) > 15) AS alerta
  FROM public.fn_clima_calibracion_cruzada(p_dias)
  WHERE error_rad_pct IS NOT NULL
  GROUP BY estacion_nombre
  ORDER BY ABS(AVG(error_rad_pct)) DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.fn_clima_calibracion_resumen IS
  'Error medio de radiación/ETo por estación vs. NASA POWER en la ventana. alerta=true cuando el sesgo de radiación supera 15%, señal de posible sensor descalibrado.';

GRANT EXECUTE ON FUNCTION public.fn_clima_calibracion_cruzada TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clima_calibracion_resumen TO anon, authenticated;
