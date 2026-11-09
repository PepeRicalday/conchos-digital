-- Horas frío de las estaciones PROPIAS: WeatherLink se sincroniza cada 2 h (cron weatherlink-sync-2h; ≈ 12 lecturas por día, hueco máximo observado 2.25 h),
-- así que la serie NO es horaria y la regla «≥ 20 de 24 horas con lectura» nunca se cumplía (horas_frio siempre NULL).
-- Solución declarada, no oculta: para las propias se interpola LINEALMENTE entre lecturas consecutivas separadas ≤ 3 h (huecos más largos no se rellenan) y
-- el resultado se marca `interpolada = true` («estimado»). JCAS sigue siendo medida horaria directa (interpolada = false). tmax/tmin son SIEMPRE las
-- lecturas reales (nunca interpoladas). Misma regla de cobertura: < 20 de 24 horas → horas = NULL (S/D, nunca 0).
DROP FUNCTION IF EXISTS public.fn_cuenca_horas_frio(date, date, numeric);
CREATE OR REPLACE FUNCTION public.fn_cuenca_horas_frio(p_desde date, p_hasta date DEFAULT NULL, p_umbral numeric DEFAULT 7.2)
RETURNS TABLE (fuente text, estacion_id text, fecha date, horas_frio integer, horas_helada integer, horas_con_dato integer, tmax numeric, tmin numeric, interpolada boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH lec AS (
    SELECT e.id::text AS est, l.ts, l.temp_c AS t,
           lead(l.ts) OVER w AS ts1, lead(l.temp_c) OVER w AS t1
    FROM public.clima_estaciones e
    JOIN public.clima_estacion_lecturas l ON l.estacion_id = e.id
    WHERE e.activa
      AND NOT ('temp_c' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])))
      AND l.qa_status IS DISTINCT FROM 'suspect'
      AND l.temp_c BETWEEN -40 AND 55
      AND l.ts >= ((p_desde::timestamp AT TIME ZONE 'America/Chihuahua') - interval '3 hours')
      AND (p_hasta IS NULL OR l.ts < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua') + interval '3 hours')
    WINDOW w AS (PARTITION BY e.id ORDER BY l.ts)
  ), interp AS (
    SELECT lec.est, hc, lec.t + (lec.t1 - lec.t) * extract(epoch FROM (hc - lec.ts)) / extract(epoch FROM (lec.ts1 - lec.ts)) AS ti
    FROM lec
    CROSS JOIN LATERAL generate_series(date_trunc('hour', lec.ts) + interval '30 minutes', lec.ts1, interval '1 hour') AS hc
    WHERE lec.ts1 IS NOT NULL AND lec.ts1 - lec.ts <= interval '3 hours' AND hc >= lec.ts AND hc < lec.ts1
  ), horas AS (
    -- una temperatura por hora local: la interpolada al centro de la hora (propias) o la media horaria medida (JCAS)
    SELECT 'propia'::text AS fuente, est, (date_trunc('hour', hc AT TIME ZONE 'America/Chihuahua')) AS hora, avg(ti) AS tm, true AS interp
    FROM interp GROUP BY est, date_trunc('hour', hc AT TIME ZONE 'America/Chihuahua')
    UNION ALL
    SELECT 'jcas', h.estacion_id::text, date_trunc('hour', h.ts AT TIME ZONE 'America/Chihuahua'), avg(h.temp_c), false
    FROM public.jcas_lecturas_horarias h
    WHERE h.temp_c IS NOT NULL
      AND h.ts >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
      AND (p_hasta IS NULL OR h.ts < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
    GROUP BY h.estacion_id, date_trunc('hour', h.ts AT TIME ZONE 'America/Chihuahua')
  ), agg AS (
    SELECT fuente, est, hora::date AS dia, bool_or(interp) AS interp, count(*) AS n,
           count(*) FILTER (WHERE tm <= p_umbral) AS frio, count(*) FILTER (WHERE tm <= 0) AS helada
    FROM horas GROUP BY fuente, est, hora::date
  ), ext AS (
    -- extremos: SIEMPRE lecturas reales
    SELECT 'propia'::text AS fuente, est, (ts AT TIME ZONE 'America/Chihuahua')::date AS dia, max(t) AS tx, min(t) AS tn
    FROM lec
    WHERE ts >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
      AND (p_hasta IS NULL OR ts < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
    GROUP BY est, (ts AT TIME ZONE 'America/Chihuahua')::date
    UNION ALL
    SELECT 'jcas', h.estacion_id::text, (h.ts AT TIME ZONE 'America/Chihuahua')::date, max(h.temp_c), min(h.temp_c)
    FROM public.jcas_lecturas_horarias h
    WHERE h.temp_c IS NOT NULL
      AND h.ts >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
      AND (p_hasta IS NULL OR h.ts < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
    GROUP BY h.estacion_id, (h.ts AT TIME ZONE 'America/Chihuahua')::date
  )
  SELECT x.fuente, x.est, x.dia,
         CASE WHEN a.n >= 20 THEN a.frio::integer END,
         CASE WHEN a.n >= 20 THEN a.helada::integer END,
         COALESCE(a.n, 0)::integer, round(x.tx::numeric, 1), round(x.tn::numeric, 1),
         COALESCE(a.interp, x.fuente = 'propia')
  FROM ext x
  LEFT JOIN agg a ON a.fuente = x.fuente AND a.est = x.est AND a.dia = x.dia;
$$;
GRANT EXECUTE ON FUNCTION public.fn_cuenca_horas_frio(date, date, numeric) TO anon, authenticated;
