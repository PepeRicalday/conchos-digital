
-- Final robust fix for resumen_escalas_diario
CREATE OR REPLACE VIEW public.resumen_escalas_diario AS
WITH reading_ranks AS (
    SELECT 
        escala_id, 
        fecha, 
        turno,
        nivel_m,
        hora_lectura,
        ROW_NUMBER() OVER(PARTITION BY escala_id, fecha, turno ORDER BY hora_lectura DESC) as rn
    FROM public.lecturas_escalas
),
daily_summary AS (
    SELECT 
        escala_id, 
        fecha,
        MAX(CASE WHEN turno = 'am' AND rn = 1 THEN nivel_m END) as lectura_am,
        MAX(CASE WHEN turno = 'am' AND rn = 1 THEN hora_lectura END) as hora_am,
        MAX(CASE WHEN turno = 'pm' AND rn = 1 THEN nivel_m END) as lectura_pm,
        MAX(CASE WHEN turno = 'pm' AND rn = 1 THEN hora_lectura END) as hora_pm
    FROM reading_ranks
    WHERE rn = 1
    GROUP BY escala_id, fecha
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
    d.lectura_am,
    d.hora_am,
    d.lectura_pm,
    d.hora_pm,
    COALESCE(d.lectura_pm, d.lectura_am) AS nivel_actual,
    CASE
        WHEN d.lectura_pm IS NOT NULL AND d.lectura_am IS NOT NULL THEN (d.lectura_pm - d.lectura_am)
        ELSE NULL
    END AS delta_12h,
    CASE
        WHEN COALESCE(d.lectura_pm, d.lectura_am) < e.nivel_min_operativo THEN 'bajo'
        WHEN COALESCE(d.lectura_pm, d.lectura_am) > e.nivel_max_operativo THEN 'alto'
        ELSE 'normal'
    END AS estado
FROM daily_summary d
JOIN public.escalas e ON e.id = d.escala_id
LEFT JOIN public.secciones s ON e.seccion_id = s.id
WHERE e.activa = true;
