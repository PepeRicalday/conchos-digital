-- Registro en el repo de fn_clima_skill_lluvia_cat, que se creó directo en la BD (commit 2ac79dd, v2.47.0) y nunca tuvo migración.
-- El SQL es IDÉNTICO al vigente en producción (leído con pg_get_functiondef el 2026-10-26): no cambia comportamiento.
-- Tabla de contingencia diaria (umbral p_umbral_mm, 1 mm por defecto) del pronóstico EMITIDO ANTES de que empezara el día local
-- (clima_pronostico_corridas) contra el último acumulado del día de la estación.
-- Aplicarla es opcional (CREATE OR REPLACE sobre una función igual); su fin es que el repo pueda reconstruir la BD.

CREATE OR REPLACE FUNCTION public.fn_clima_skill_lluvia_cat(p_dias integer DEFAULT 30, p_umbral_mm numeric DEFAULT 1)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, dias integer, aciertos integer, omisiones integer, falsas_alarmas integer, correctos_negativos integer, pod numeric, far numeric, brier numeric, mm_fc_medio numeric, mm_obs_medio numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT k.estacion_id, (k.valido_en AT TIME ZONE 'America/Chihuahua')::date AS dia, k.corrida_en,
           sum(k.precip_mm) AS mm, max(k.precip_prob_pct) AS pmax, count(*) AS n
    FROM public.clima_pronostico_corridas k
    WHERE k.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias,1),120))
      AND (k.valido_en AT TIME ZONE 'America/Chihuahua')::date < (now() AT TIME ZONE 'America/Chihuahua')::date
      AND k.corrida_en < ((k.valido_en AT TIME ZONE 'America/Chihuahua')::date)::timestamp AT TIME ZONE 'America/Chihuahua'
    GROUP BY 1,2,3 HAVING count(*) >= 12
  ),
  u AS (SELECT DISTINCT ON (estacion_id, dia) * FROM c ORDER BY estacion_id, dia, corrida_en DESC),
  ob AS (
    SELECT DISTINCT ON (l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date)
      l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia, l.lluvia_dia_mm AS mm
    FROM public.clima_estacion_lecturas l
    WHERE l.ts >= now() - make_interval(days => LEAST(GREATEST(p_dias,1),120) + 1) AND l.lluvia_dia_mm IS NOT NULL
    ORDER BY l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date, l.ts DESC
  ),
  j AS (SELECT u.estacion_id, u.mm AS fc, ob.mm AS o, u.pmax FROM u JOIN ob USING (estacion_id, dia))
  SELECT j.estacion_id, e.nombre, count(*)::int,
    count(*) FILTER (WHERE fc >= p_umbral_mm AND o >= p_umbral_mm)::int,
    count(*) FILTER (WHERE fc <  p_umbral_mm AND o >= p_umbral_mm)::int,
    count(*) FILTER (WHERE fc >= p_umbral_mm AND o <  p_umbral_mm)::int,
    count(*) FILTER (WHERE fc <  p_umbral_mm AND o <  p_umbral_mm)::int,
    CASE WHEN count(*) FILTER (WHERE o >= p_umbral_mm) > 0
      THEN round((count(*) FILTER (WHERE fc >= p_umbral_mm AND o >= p_umbral_mm))::numeric / count(*) FILTER (WHERE o >= p_umbral_mm), 2) END,
    CASE WHEN count(*) FILTER (WHERE fc >= p_umbral_mm) > 0
      THEN round((count(*) FILTER (WHERE fc >= p_umbral_mm AND o <  p_umbral_mm))::numeric / count(*) FILTER (WHERE fc >= p_umbral_mm), 2) END,
    round(avg(power(COALESCE(pmax,0)/100.0 - (o >= p_umbral_mm)::int, 2))::numeric, 3),
    round(avg(fc)::numeric, 2), round(avg(o)::numeric, 2)
  FROM j JOIN public.clima_estaciones e ON e.id = j.estacion_id
  GROUP BY j.estacion_id, e.nombre ORDER BY e.nombre;
$function$;
