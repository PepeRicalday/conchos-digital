-- Lluvia diaria de las estaciones PROPIAS (WeatherLink) para sumarla a la lluvia observada de la cuenca (planos, areal, tabla).
-- lluvia_dia_mm es un contador del día local: el valor del día = la ÚLTIMA lectura de ese día (America/Chihuahua). El día en curso es parcial.
-- Solo estaciones activas con pluviómetro confiable. S/D = NULL, nunca 0 (una estación sin lectura ese día simplemente no trae fila).
CREATE OR REPLACE FUNCTION public.fn_cuenca_lluvia_propia(p_desde date)
RETURNS TABLE (estacion_id uuid, nombre text, latitud numeric, longitud numeric, fecha date, lluvia_mm numeric, ult_lectura timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT e.id, e.nombre, e.latitud, e.longitud,
         (l.ts AT TIME ZONE 'America/Chihuahua')::date AS fecha,
         (array_agg(l.lluvia_dia_mm ORDER BY l.ts DESC) FILTER (WHERE l.lluvia_dia_mm IS NOT NULL))[1] AS lluvia_mm,
         max(l.ts) AS ult_lectura
  FROM public.clima_estaciones e
  JOIN public.clima_estacion_lecturas l ON l.estacion_id = e.id
  WHERE e.activa
    AND NOT ('lluvia_dia_mm' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])))
    AND l.ts >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
  GROUP BY e.id, e.nombre, e.latitud, e.longitud, (l.ts AT TIME ZONE 'America/Chihuahua')::date
  HAVING (array_agg(l.lluvia_dia_mm ORDER BY l.ts DESC) FILTER (WHERE l.lluvia_dia_mm IS NOT NULL))[1] BETWEEN 0 AND 150;
$$;
GRANT EXECUTE ON FUNCTION public.fn_cuenca_lluvia_propia(date) TO anon, authenticated;
