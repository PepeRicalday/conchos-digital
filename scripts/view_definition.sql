 WITH daily_records AS (
         SELECT DISTINCT lecturas_escalas.escala_id,
            lecturas_escalas.fecha
           FROM lecturas_escalas
        )
 SELECT e.id AS escala_id,
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
            WHEN ((lpm.nivel_m IS NOT NULL) AND (lam.nivel_m IS NOT NULL)) THEN (lpm.nivel_m - lam.nivel_m)
            ELSE NULL::numeric
        END AS delta_12h,
        CASE
            WHEN (COALESCE(lpm.nivel_m, lam.nivel_m) < e.nivel_min_operativo) THEN 'bajo'::text
            WHEN (COALESCE(lpm.nivel_m, lam.nivel_m) > e.nivel_max_operativo) THEN 'alto'::text
            ELSE 'normal'::text
        END AS estado
   FROM ((((daily_records d
     JOIN escalas e ON ((e.id = d.escala_id)))
     LEFT JOIN secciones s ON ((e.seccion_id = s.id)))
     LEFT JOIN lecturas_escalas lam ON (((lam.escala_id = d.escala_id) AND (lam.fecha = d.fecha) AND (lam.turno = 'am'::turno_lectura))))
     LEFT JOIN lecturas_escalas lpm ON (((lpm.escala_id = d.escala_id) AND (lpm.fecha = d.fecha) AND (lpm.turno = 'pm'::turno_lectura))))
  WHERE (e.activa = true);