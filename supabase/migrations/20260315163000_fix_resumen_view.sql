
-- Fix resumen_escalas_diario to handle multiple readings per turno by taking the latest one
CREATE OR REPLACE VIEW public.resumen_escalas_diario AS
WITH latest_readings AS (
    SELECT 
        escala_id, 
        fecha, 
        turno,
        nivel_m,
        hora_lectura,
        ROW_NUMBER() OVER(PARTITION BY escala_id, fecha, turno ORDER BY hora_lectura DESC) as rn
    FROM public.lecturas_escalas
),
latest_am AS (
    SELECT * FROM latest_readings WHERE turno = 'am' AND rn = 1
),
latest_pm AS (
    SELECT * FROM latest_readings WHERE turno = 'pm' AND rn = 1
),
daily_base AS (
    SELECT DISTINCT escala_id, fecha FROM public.lecturas_escalas
)
SELECT 
    e.id AS escala_id,
    e.nombre,
    e.km,
    s.id AS seccion_id,
    s.nombre AS seccion_nombre,
    s.color AS seccion_color,
    e.nivel_min_operativo,
    e.nivel_max_operativo,
    e.capacidad_max,
    d.fecha,
    lam.nivel_m AS lectura_am,
    lam.hora_lectura AS hora_am,
    lpm.nivel_m AS lectura_pm,
    lpm.hora_lectura AS hora_pm,
    COALESCE(lpm.nivel_m, lam.nivel_m) AS nivel_actual,
    CASE
        WHEN lpm.nivel_m IS NOT NULL AND lam.nivel_m IS NOT NULL THEN (lpm.nivel_m - lam.nivel_m)
        ELSE NULL
    END AS delta_12h,
    CASE
        WHEN COALESCE(lpm.nivel_m, lam.nivel_m) < e.nivel_min_operativo THEN 'bajo'
        WHEN COALESCE(lpm.nivel_m, lam.nivel_m) > e.nivel_max_operativo THEN 'alto'
        ELSE 'normal'
    END AS estado
FROM daily_base d
JOIN public.escalas e ON e.id = d.escala_id
LEFT JOIN public.secciones s ON e.seccion_id = s.id
LEFT JOIN latest_am lam ON lam.escala_id = d.escala_id AND lam.fecha = d.fecha
LEFT JOIN latest_pm lpm ON lpm.escala_id = d.escala_id AND lpm.fecha = d.fecha
WHERE e.activa = true;
