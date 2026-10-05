-- Fix: fn_clima_resumen_mensual filtraba l.ts::date en UTC en vez de hora
-- local de Chihuahua (America/Chihuahua, UTC-6/-7). Reportado 2026-09-19: el
-- Informe Geoclimático "Hoy" mostraba "sin lluvia" pese a que Módulo 1 y
-- San Rafael sí tenían lluvia capturada esa noche — la lectura, generada
-- después de ~18:00-19:00 hora local, ya cae en el día siguiente en UTC
-- (confirmado: 2026-09-19 20:51 local = 2026-09-20 02:51 UTC), así que
-- l.ts::date la contaba como "mañana" y quedaba fuera del rango
-- [p_desde, p_hasta] = ['2026-09-19','2026-09-19'] que el frontend calcula
-- en hora local (getTodayString() en Clima.tsx).
--
-- Fix: convertir l.ts a hora local ANTES de truncar a fecha, en las 3 CTEs
-- que comparan contra p_desde/p_hasta. clima_estacion_lecturas.ts es
-- timestamptz, así que `l.ts AT TIME ZONE 'America/Chihuahua'` da el
-- timestamp local correcto sin tocar cómo se almacena el dato.
CREATE OR REPLACE FUNCTION public.fn_clima_resumen_mensual(p_desde date, p_hasta date)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, n_muestras bigint, temp_c_prom numeric, viento_ms_prom numeric, viento_dir_deg_dominante numeric, rad_solar_wm2_prom numeric, lluvia_mm_acumulada numeric, dia_max_lluvia_fecha date, dia_max_lluvia_mm numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH ultima_del_dia AS (
    SELECT DISTINCT ON (l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date)
      l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia, l.lluvia_dia_mm
    FROM public.clima_estacion_lecturas l
    WHERE (l.ts AT TIME ZONE 'America/Chihuahua')::date >= p_desde
      AND (l.ts AT TIME ZONE 'America/Chihuahua')::date <= p_hasta
    ORDER BY l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date, l.ts DESC
  ),
  lluvia_mensual AS (
    SELECT estacion_id, SUM(lluvia_dia_mm) AS lluvia_mm_acumulada
    FROM ultima_del_dia
    GROUP BY estacion_id
  ),
  dia_max AS (
    -- Un día por estación con la mayor lámina registrada en el rango —
    -- DISTINCT ON con lluvia_dia_mm DESC toma el primer empate por fecha
    -- más reciente (ORDER BY secundario), consistente con el criterio de
    -- desempate ya usado arriba (ts DESC).
    SELECT DISTINCT ON (estacion_id)
      estacion_id, dia AS dia_max_lluvia_fecha, lluvia_dia_mm AS dia_max_lluvia_mm
    FROM ultima_del_dia
    WHERE lluvia_dia_mm IS NOT NULL AND lluvia_dia_mm > 0
    ORDER BY estacion_id, lluvia_dia_mm DESC, dia DESC
  )
  SELECT
    l.estacion_id,
    e.nombre AS estacion_nombre,
    COUNT(*) AS n_muestras,
    ROUND(AVG(l.temp_c)::numeric, 1) AS temp_c_prom,
    ROUND(AVG(l.viento_ms)::numeric, 2) AS viento_ms_prom,
    ROUND(
      (DEGREES(ATAN2(
        -AVG(SIN(RADIANS(l.viento_dir_deg))) ,
        -AVG(COS(RADIANS(l.viento_dir_deg)))
      )) + 360)::numeric % 360,
      0
    ) AS viento_dir_deg_dominante,
    ROUND(AVG(l.rad_solar_wm2)::numeric, 0) AS rad_solar_wm2_prom,
    ROUND(COALESCE(lm.lluvia_mm_acumulada, 0)::numeric, 1) AS lluvia_mm_acumulada,
    dm.dia_max_lluvia_fecha,
    ROUND(dm.dia_max_lluvia_mm::numeric, 1) AS dia_max_lluvia_mm
  FROM public.clima_estacion_lecturas l
  JOIN public.clima_estaciones e ON e.id = l.estacion_id
  LEFT JOIN lluvia_mensual lm ON lm.estacion_id = l.estacion_id
  LEFT JOIN dia_max dm ON dm.estacion_id = l.estacion_id
  WHERE (l.ts AT TIME ZONE 'America/Chihuahua')::date >= p_desde
    AND (l.ts AT TIME ZONE 'America/Chihuahua')::date <= p_hasta
  GROUP BY l.estacion_id, e.nombre, lm.lluvia_mm_acumulada, dm.dia_max_lluvia_fecha, dm.dia_max_lluvia_mm
  ORDER BY e.nombre;
$function$;
