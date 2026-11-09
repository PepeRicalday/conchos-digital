-- Temperatura, humedad y viento diarios de las estaciones PROPIAS (WeatherLink) para la Cuenca del Conchos (tabla de la red, planos, informe).
-- Complementa fn_cuenca_lluvia_propia (que solo trae lluvia). Un renglón por (estación, día local America/Chihuahua) con medias de las lecturas del día
-- (≈ cada 15 min). El día en curso es PARCIAL (lo decide el cliente por fecha). S/D = NULL, nunca 0:
--   · un sensor declarado en sensores_no_confiables (p. ej. Riego San Rafael: temp/hum/viento) devuelve NULL en esa columna;
--   · se ignoran lecturas con qa_status = 'suspect' y valores fuera de rango físico.
-- Viento: m/s → km/h (JCAS reporta km/h), para que ambas fuentes comparen en la misma unidad.
CREATE OR REPLACE FUNCTION public.fn_cuenca_clima_propio(p_desde date, p_hasta date DEFAULT NULL)
RETURNS TABLE (estacion_id uuid, fecha date, temp_c numeric, temp_max_c numeric, temp_min_c numeric, hum_pct numeric, viento_kmh numeric, lecturas integer, ult_lectura timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH base AS (
    SELECT e.id AS est, (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia, l.ts,
           CASE WHEN 'temp_c' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])) THEN NULL
                WHEN l.temp_c BETWEEN -40 AND 55 THEN l.temp_c END AS t,
           CASE WHEN 'temp_max_c' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])) THEN NULL
                WHEN l.temp_max_c BETWEEN -40 AND 60 THEN l.temp_max_c END AS tmax,
           CASE WHEN 'temp_min_c' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])) THEN NULL
                WHEN l.temp_min_c BETWEEN -40 AND 55 THEN l.temp_min_c END AS tmin,
           CASE WHEN 'hum_rel_pct' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])) THEN NULL
                WHEN l.hum_rel_pct BETWEEN 0 AND 100 THEN l.hum_rel_pct END AS h,
           CASE WHEN 'viento_ms' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])) THEN NULL
                WHEN l.viento_ms BETWEEN 0 AND 80 THEN l.viento_ms * 3.6 END AS v
    FROM public.clima_estaciones e
    JOIN public.clima_estacion_lecturas l ON l.estacion_id = e.id
    WHERE e.activa
      AND l.qa_status IS DISTINCT FROM 'suspect'
      AND l.ts >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
      AND (p_hasta IS NULL OR l.ts < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
  )
  SELECT est, dia,
         round(avg(t)::numeric, 1), round(max(tmax)::numeric, 1), round(min(tmin)::numeric, 1),
         round(avg(h)::numeric, 1), round(avg(v)::numeric, 1),
         count(*)::integer, max(ts)
  FROM base
  GROUP BY est, dia;
$$;
GRANT EXECUTE ON FUNCTION public.fn_cuenca_clima_propio(date, date) TO anon, authenticated;
