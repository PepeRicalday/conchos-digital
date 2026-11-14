-- Tratado 1944 · gasto diario del Sutron de Ojinaga (C6300760): media por día de Chihuahua + número de lecturas.
-- Para conciliar la medición propia de SICA contra el IBWC sin bajar las lecturas de 15 min al navegador.
-- La media del gasto × 0.0864 = Mm³ del día. SECURITY INVOKER: respeta la RLS de hidro_lecturas.
CREATE OR REPLACE FUNCTION public.fn_tratado_sutron_diario(p_desde date DEFAULT '2025-10-25')
RETURNS TABLE (fecha date, gasto_medio_m3s numeric, lecturas integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT (l.ts_utc AT TIME ZONE 'America/Chihuahua')::date AS fecha,
         avg(l.valor)::numeric AS gasto_medio_m3s,
         count(*)::integer AS lecturas
  FROM public.hidro_lecturas l
  WHERE l.estacion_id = 'C6300760' AND l.variable = 'gasto_m3s' AND l.valor IS NOT NULL
    AND l.ts_utc >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
  GROUP BY 1 ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_tratado_sutron_diario(date) TO authenticated;
