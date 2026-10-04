-- La vista resumen_escalas_diario no tenía gasto_calculado_m3s, pero Balance Hidráulico y Modelación
-- se lo pedían (HTTP 400 en cada carga). Se agrega la columna AL FINAL (orden de columnas intacto):
-- gasto del último registro CONFIRMADO del día (pm, si no am). NULL si no hay lectura confirmada,
-- para no heredar los gastos de relleno de medianoche (SICA Chronos, confirmada = false).
-- Aplicado en producción vía SQL (no db push: hay drift de migraciones). 2026-10-04.

CREATE OR REPLACE VIEW public.resumen_escalas_diario AS
 WITH reading_ranks AS (
         SELECT lecturas_escalas.escala_id,
            lecturas_escalas.fecha,
            lecturas_escalas.turno,
            lecturas_escalas.nivel_m,
            lecturas_escalas.hora_lectura,
            CASE WHEN lecturas_escalas.confirmada THEN lecturas_escalas.gasto_calculado_m3s ELSE NULL::numeric END AS gasto_conf,
            row_number() OVER (PARTITION BY lecturas_escalas.escala_id, lecturas_escalas.fecha, lecturas_escalas.turno ORDER BY lecturas_escalas.hora_lectura DESC) AS rn
           FROM lecturas_escalas
        ), daily_summary AS (
         SELECT reading_ranks.escala_id,
            reading_ranks.fecha,
            max(CASE WHEN reading_ranks.turno = 'am'::turno_lectura AND reading_ranks.rn = 1 THEN reading_ranks.nivel_m ELSE NULL::numeric END) AS lectura_am,
            max(CASE WHEN reading_ranks.turno = 'am'::turno_lectura AND reading_ranks.rn = 1 THEN reading_ranks.hora_lectura ELSE NULL::time without time zone END) AS hora_am,
            max(CASE WHEN reading_ranks.turno = 'pm'::turno_lectura AND reading_ranks.rn = 1 THEN reading_ranks.nivel_m ELSE NULL::numeric END) AS lectura_pm,
            max(CASE WHEN reading_ranks.turno = 'pm'::turno_lectura AND reading_ranks.rn = 1 THEN reading_ranks.hora_lectura ELSE NULL::time without time zone END) AS hora_pm,
            max(CASE WHEN reading_ranks.turno = 'am'::turno_lectura AND reading_ranks.rn = 1 THEN reading_ranks.gasto_conf ELSE NULL::numeric END) AS gasto_am,
            max(CASE WHEN reading_ranks.turno = 'pm'::turno_lectura AND reading_ranks.rn = 1 THEN reading_ranks.gasto_conf ELSE NULL::numeric END) AS gasto_pm
           FROM reading_ranks
          WHERE reading_ranks.rn = 1
          GROUP BY reading_ranks.escala_id, reading_ranks.fecha
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
    d.lectura_am,
    d.hora_am,
    d.lectura_pm,
    d.hora_pm,
    COALESCE(d.lectura_pm, d.lectura_am) AS nivel_actual,
        CASE
            WHEN d.lectura_pm IS NOT NULL AND d.lectura_am IS NOT NULL THEN d.lectura_pm - d.lectura_am
            ELSE NULL::numeric
        END AS delta_12h,
        CASE
            WHEN COALESCE(d.lectura_pm, d.lectura_am) < e.nivel_min_operativo THEN 'bajo'::text
            WHEN COALESCE(d.lectura_pm, d.lectura_am) > e.nivel_max_operativo THEN 'alto'::text
            ELSE 'normal'::text
        END AS estado,
    COALESCE(d.gasto_pm, d.gasto_am) AS gasto_calculado_m3s
   FROM daily_summary d
     JOIN escalas e ON e.id = d.escala_id
     LEFT JOIN secciones s ON e.seccion_id = s.id
  WHERE e.activa = true;

COMMENT ON COLUMN public.resumen_escalas_diario.gasto_calculado_m3s IS
'Gasto del último registro CONFIRMADO del día (pm, si no am). NULL si no hay lectura confirmada: no usa filas de relleno de medianoche.';
