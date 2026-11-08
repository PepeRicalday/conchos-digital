-- v_aqwp_climatologia: distribución del ALMACENAMIENTO de cada presa para el MISMO día del año, años completos 2017-último.
-- Sirve para decir si el nivel de hoy es normal para la fecha (percentil, mediana, rango) en vez de depender solo de umbrales fijos.
--
-- Reglas (todas probadas contra los datos reales):
--  · Se usan Mm³, NO pct_namo: el NAMO de CONAGUA cambia en el tiempo (Luis L. León 292.5 → 284.4) y el % histórico no es comparable.
--  · Solo desde 2017: 2015-2016 son mensuales (1 dato por mes) y sesgarían la mediana hacia los días 1 de cada mes.
--  · Solo años COMPLETOS (año < año en curso): el año en curso se compara contra el pasado, no contra sí mismo.
--  · Se excluyen las lecturas atípicas de aqwp_lecturas_excluidas (fila corrupta 2020-09-08 y picos de un día).
--  · Ventana de ±3 días circular sobre el día del año (los datos de 2023 tienen huecos y los de Boquilla/Madero son
--    de lunes a viernes desde 2026): ~7 observaciones por año × 9 años ≈ 63. Están AUTOCORRELACIONADAS: la muestra efectiva
--    son los años (n_anios), no n_obs. El percentil resultante tiene resolución de ~11 puntos: rotular siempre "n = N años".
--  · `valores` (ordenados) permite calcular el percentil EXACTO del valor de hoy en el cliente; para la banda de las
--    mini-series conviene pedir solo las columnas p10/mediana/p90 (PostgREST ignora las demás).
CREATE OR REPLACE VIEW public.v_aqwp_climatologia WITH (security_invoker = true) AS
WITH base AS (
  SELECT d.ubicacion_id, l.fecha, l.valor
  FROM public.aqwp_lecturas_diarias l
  JOIN public.aqwp_datasets d ON d.id_number = l.dataset_id AND d.magnitud = 'almacenamiento'
  JOIN public.aqwp_ubicaciones u ON u.id_number = d.ubicacion_id AND u.tipo = 'presa'
  WHERE l.valor IS NOT NULL
    AND l.fecha >= DATE '2017-01-01'
    AND extract(year FROM l.fecha) < extract(year FROM CURRENT_DATE)
    AND NOT EXISTS (
      SELECT 1 FROM public.aqwp_lecturas_excluidas x WHERE x.ubicacion_id = d.ubicacion_id AND x.fecha = l.fecha)
),
expandida AS (
  SELECT b.ubicacion_id, b.valor, extract(year FROM b.fecha)::int AS anio,
         (((extract(doy FROM b.fecha)::int + o - 1 + 366) % 366) + 1) AS dia_anio
  FROM base b CROSS JOIN generate_series(-3, 3) AS o
)
SELECT ubicacion_id, dia_anio,
       count(DISTINCT anio)::int AS n_anios,
       count(*)::int             AS n_obs,
       min(valor)                AS minimo,
       percentile_cont(0.10) WITHIN GROUP (ORDER BY valor) AS p10,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY valor) AS p25,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY valor) AS mediana,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY valor) AS p75,
       percentile_cont(0.90) WITHIN GROUP (ORDER BY valor) AS p90,
       max(valor)                AS maximo,
       array_agg(valor ORDER BY valor) AS valores
FROM expandida
GROUP BY ubicacion_id, dia_anio;
