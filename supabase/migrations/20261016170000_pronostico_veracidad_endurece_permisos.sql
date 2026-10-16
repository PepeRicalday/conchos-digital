-- Endurece 20261016160000 (revision de seguridad automatica del commit 3e36586):
--  1) fn_clima_snapshot_pronostico (SECURITY DEFINER, escribe/borra) solo la ejecuta pg_cron (postgres).
--  2) fn_clima_skill_variables / fn_clima_skill_lluvia_dia: SECURITY INVOKER (las tablas ya son legibles por RLS
--     para anon) y p_dias acotado a 1-60 para que una llamada publica no fuerce un escaneo ilimitado.
-- Aplicada con apply_migration; este archivo es el SQL completo aplicado (reproducible desde cero).
REVOKE ALL ON FUNCTION public.fn_clima_snapshot_pronostico() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_clima_skill_variables(p_dias integer DEFAULT 14)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, rango_horizonte text, variable text, n bigint, mae numeric, sesgo numeric)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH fc AS (
    SELECT s.estacion_id, s.valido_en, s.horizonte_h, s.temp_c, s.viento_ms
    FROM public.clima_pronostico_snapshot s
    WHERE s.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias, 1), 60)) AND s.valido_en < now() - interval '1 hour'
    UNION ALL
    SELECT h.estacion_id, h.valido_en, GREATEST(h.horizonte_h, 0), h.temp_c, h.viento_ms
    FROM public.clima_pronostico_horario h
    WHERE h.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias, 1), 60)) AND h.valido_en < now() - interval '1 hour'
  ),
  par AS (
    SELECT f.estacion_id, f.horizonte_h, f.temp_c AS t_fc, f.viento_ms AS v_fc, o.temp_c AS t_obs, o.viento_ms AS v_obs
    FROM fc f
    JOIN LATERAL (
      SELECT l.temp_c, l.viento_ms FROM public.clima_estacion_lecturas l
      WHERE l.estacion_id = f.estacion_id AND l.ts BETWEEN f.valido_en - interval '60 minutes' AND f.valido_en + interval '60 minutes'
        AND (l.temp_c IS NULL OR l.temp_c BETWEEN -25 AND 48) AND (l.viento_ms IS NULL OR l.viento_ms BETWEEN 0 AND 50)
      ORDER BY abs(EXTRACT(EPOCH FROM (l.ts - f.valido_en))) LIMIT 1
    ) o ON true
  ),
  rango AS (
    SELECT *, CASE WHEN horizonte_h <= 6 THEN '0-6 h' WHEN horizonte_h <= 24 THEN '7-24 h' ELSE '25-48 h' END AS rg FROM par
  ),
  largo AS (
    SELECT estacion_id, rg, 'temperatura'::text AS variable, t_fc - t_obs AS err FROM rango WHERE t_fc IS NOT NULL AND t_obs IS NOT NULL
    UNION ALL
    SELECT estacion_id, rg, 'viento'::text, v_fc - v_obs FROM rango WHERE v_fc IS NOT NULL AND v_obs IS NOT NULL
  )
  SELECT g.estacion_id, e.nombre, g.rg, g.variable, count(*), round(avg(abs(g.err))::numeric, 2), round(avg(g.err)::numeric, 2)
  FROM largo g JOIN public.clima_estaciones e ON e.id = g.estacion_id
  GROUP BY g.estacion_id, e.nombre, g.rg, g.variable
  ORDER BY e.nombre, g.variable, g.rg;
$function$;

CREATE OR REPLACE FUNCTION public.fn_clima_skill_lluvia_dia(p_dias integer DEFAULT 14)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, dia date, mm_pronosticado numeric, mm_observado numeric, error numeric)
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH fc AS (
    SELECT h.estacion_id, (h.valido_en AT TIME ZONE 'America/Chihuahua')::date AS dia, sum(h.precip_mm) AS mm, count(*) AS n
    FROM public.clima_pronostico_horario h
    WHERE h.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias, 1), 60))
      AND (h.valido_en AT TIME ZONE 'America/Chihuahua')::date < (now() AT TIME ZONE 'America/Chihuahua')::date
    GROUP BY 1, 2 HAVING count(*) >= 20
  ),
  ob AS (
    SELECT DISTINCT ON (l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date)
      l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia, l.lluvia_dia_mm AS mm
    FROM public.clima_estacion_lecturas l
    WHERE l.ts >= now() - make_interval(days => LEAST(GREATEST(p_dias, 1), 60) + 1) AND l.lluvia_dia_mm IS NOT NULL
    ORDER BY l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date, l.ts DESC
  )
  SELECT fc.estacion_id, e.nombre, fc.dia, round(fc.mm::numeric, 1), round(ob.mm::numeric, 1), round((fc.mm - ob.mm)::numeric, 1)
  FROM fc JOIN ob ON ob.estacion_id = fc.estacion_id AND ob.dia = fc.dia
  JOIN public.clima_estaciones e ON e.id = fc.estacion_id
  ORDER BY e.nombre, fc.dia;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_clima_skill_variables(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clima_skill_lluvia_dia(integer) TO anon, authenticated;
