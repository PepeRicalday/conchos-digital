-- Evaluación de proveedores: agrega 'consenso_3modelos' (ECMWF + GFS + ICON) y una función de decisión.
-- Backtest 2026-10-26 (Open-Meteo historical-forecast, 30 días, ~2,170 pares estación-hora, horizonte corto):
--   error tras quitar sesgo por estación: temperatura 1.18 → 1.08 °C (-8 %), viento 1.23 → 1.07 m/s (-13 %).
--   En esta región best_match == gfs_seamless (resultados idénticos).
-- No se adopta todavía: falta medir EN VIVO (incluido 25-48 h). fn_clima_ensamble_decision() dice cuándo cumple.

CREATE OR REPLACE FUNCTION public.fn_clima_skill_proveedores(p_dias integer DEFAULT 14)
RETURNS TABLE(proveedor text, rango_horizonte text, variable text, n bigint, mae numeric, sesgo numeric, mae_centrado numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH fc AS (
    SELECT a.estacion_id, a.proveedor, a.corrida_en, a.valido_en, a.horizonte_h, a.temp_c, a.viento_ms
    FROM public.clima_pronostico_alterno a
    WHERE a.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias,1),60)) AND a.valido_en < now() - interval '1 hour'
    UNION ALL
    SELECT s.estacion_id, 'open-meteo:best_match', s.corrida_en, s.valido_en, s.horizonte_h, s.temp_c, s.viento_ms
    FROM public.clima_pronostico_snapshot s
    WHERE s.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias,1),60)) AND s.valido_en < now() - interval '1 hour'
  ),
  cons_todos AS (
    SELECT estacion_id, 'consenso_todos'::text AS proveedor, corrida_en, valido_en, min(horizonte_h) AS horizonte_h,
           avg(temp_c) AS temp_c, avg(viento_ms) AS viento_ms
    FROM fc GROUP BY estacion_id, corrida_en, valido_en HAVING count(DISTINCT proveedor) >= 3
  ),
  cons3 AS (
    SELECT estacion_id, 'consenso_3modelos'::text AS proveedor, corrida_en, valido_en, min(horizonte_h) AS horizonte_h,
           avg(temp_c) AS temp_c, avg(viento_ms) AS viento_ms
    FROM fc WHERE proveedor IN ('open-meteo:ecmwf_ifs025','open-meteo:gfs_seamless','open-meteo:icon_seamless')
    GROUP BY estacion_id, corrida_en, valido_en HAVING count(DISTINCT proveedor) = 3
  ),
  todo AS (SELECT * FROM fc UNION ALL SELECT * FROM cons_todos UNION ALL SELECT * FROM cons3),
  par AS (
    SELECT f.estacion_id, f.proveedor, f.horizonte_h, f.temp_c AS t_fc, f.viento_ms AS v_fc, o.temp_c AS t_obs, o.viento_ms AS v_obs
    FROM todo f
    JOIN LATERAL (
      SELECT l.temp_c, l.viento_ms FROM public.clima_estacion_lecturas l
      WHERE l.estacion_id = f.estacion_id AND l.ts BETWEEN f.valido_en - interval '60 minutes' AND f.valido_en + interval '60 minutes'
        AND (l.temp_c IS NULL OR l.temp_c BETWEEN -25 AND 48) AND (l.viento_ms IS NULL OR l.viento_ms BETWEEN 0 AND 50)
      ORDER BY abs(EXTRACT(EPOCH FROM (l.ts - f.valido_en))) LIMIT 1
    ) o ON true
  ),
  largo AS (
    SELECT estacion_id, proveedor, CASE WHEN horizonte_h <= 6 THEN '0-6 h' WHEN horizonte_h <= 24 THEN '7-24 h' ELSE '25-48 h' END AS rg,
           'temperatura'::text AS variable, t_fc - t_obs AS err FROM par WHERE t_fc IS NOT NULL AND t_obs IS NOT NULL
    UNION ALL
    SELECT estacion_id, proveedor, CASE WHEN horizonte_h <= 6 THEN '0-6 h' WHEN horizonte_h <= 24 THEN '7-24 h' ELSE '25-48 h' END,
           'viento', v_fc - v_obs FROM par WHERE v_fc IS NOT NULL AND v_obs IS NOT NULL
  ),
  cen AS (
    SELECT *, err - avg(err) OVER (PARTITION BY proveedor, estacion_id, variable) AS err_c FROM largo
  )
  SELECT proveedor, rg, variable, count(*), round(avg(abs(err))::numeric, 2), round(avg(err)::numeric, 2), round(avg(abs(err_c))::numeric, 2)
  FROM cen GROUP BY proveedor, rg, variable ORDER BY variable, rg, proveedor;
$$;
GRANT EXECUTE ON FUNCTION public.fn_clima_skill_proveedores(integer) TO anon, authenticated;

-- El consenso se recomienda solo si mejora >= 5 % el error del modelo actual en AMBAS variables (tras quitar el sesgo de
-- cada estación) y hay >= 500 comparaciones por variable, medido en vivo.
CREATE OR REPLACE FUNCTION public.fn_clima_ensamble_decision(p_dias integer DEFAULT 14)
RETURNS TABLE(variable text, n bigint, mae_centrado_base numeric, mae_centrado_consenso numeric, mejora_pct numeric, cumple boolean)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH s AS (SELECT * FROM fn_clima_skill_proveedores(p_dias)),
  b AS (SELECT variable, sum(n) AS n, sum(mae_centrado * n) / NULLIF(sum(n), 0) AS m FROM s WHERE proveedor = 'open-meteo:best_match' GROUP BY 1),
  c AS (SELECT variable, sum(n) AS n, sum(mae_centrado * n) / NULLIF(sum(n), 0) AS m FROM s WHERE proveedor = 'consenso_3modelos' GROUP BY 1)
  SELECT b.variable, LEAST(b.n, c.n)::bigint, round(b.m, 2), round(c.m, 2), round(100 * (b.m - c.m) / b.m, 1),
         (LEAST(b.n, c.n) >= 500 AND (b.m - c.m) / b.m >= 0.05)
  FROM b JOIN c USING (variable);
$$;
GRANT EXECUTE ON FUNCTION public.fn_clima_ensamble_decision(integer) TO anon, authenticated;
