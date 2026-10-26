-- fn_clima_skill_lluvia_dia: "pronosticado" = lo que SE EMITIÓ ANTES de que empezara el día local.
-- Antes sumaba clima_pronostico_horario (el valor más reciente de cada hora, casi una medición): el 25 oct 2026 daba 0.0 mm
-- y escondía que la corrida emitida el día previo tampoco avisó 21.8 mm en Módulo 1. Ahora usa la misma definición que
-- fn_clima_skill_lluvia_cat: última corrida de clima_pronostico_corridas anterior a las 00:00 locales del día, con ≥ 12 horas.
-- Mismas columnas y firma: el cliente no cambia. Solo hay corridas guardadas desde 2026-10-23; los días anteriores ya no
-- salen (sin corrida emitida no hay verificación honesta).

CREATE OR REPLACE FUNCTION public.fn_clima_skill_lluvia_dia(p_dias integer DEFAULT 14)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, dia date, mm_pronosticado numeric, mm_observado numeric, error numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT k.estacion_id, (k.valido_en AT TIME ZONE 'America/Chihuahua')::date AS dia, k.corrida_en,
           sum(k.precip_mm) AS mm, count(*) AS n
    FROM public.clima_pronostico_corridas k
    WHERE k.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias, 1), 60))
      AND (k.valido_en AT TIME ZONE 'America/Chihuahua')::date < (now() AT TIME ZONE 'America/Chihuahua')::date
      AND k.corrida_en < ((k.valido_en AT TIME ZONE 'America/Chihuahua')::date)::timestamp AT TIME ZONE 'America/Chihuahua'
    GROUP BY 1, 2, 3 HAVING count(*) >= 12
  ),
  fc AS (SELECT DISTINCT ON (estacion_id, dia) * FROM c ORDER BY estacion_id, dia, corrida_en DESC),
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
