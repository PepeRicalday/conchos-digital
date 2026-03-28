-- ============================================================
-- Migración: Corrección de Integridad v4
-- Fecha: 2026-03-26
-- Pendientes: R1+R6 (56), R8 (7), R2 (2)
-- ============================================================


-- ── FIX R1+R6: Insertar 'inicio' el día anterior al primer cierre/suspension ──
-- Los 56 puntos tienen como primer registro un 'cierre' o 'suspension'.
-- La tabla tiene UNIQUE(punto_id, fecha), así que no podemos insertar inicio
-- en el mismo día. Insertamos un 'inicio' en fecha - 1 (día antes del primer
-- registro). Eso representa: el punto estaba abierto el día previo.

INSERT INTO public.reportes_operacion (
    punto_id,
    fecha,
    estado,
    hora_apertura,
    hora_cierre,
    caudal_promedio,
    actualizado_en
)
SELECT
    ro.punto_id,
    ro.fecha - 1 AS fecha_inicio,
    'inicio'::estado_reporte,
    timezone('America/Chihuahua', (ro.fecha - 1)::timestamp),
    NULL,
    0,
    now()
FROM public.reportes_operacion ro
WHERE (ro.punto_id, ro.fecha) IN (
    -- Primer registro de cada punto
    SELECT DISTINCT ON (punto_id) punto_id, fecha
    FROM public.reportes_operacion
    ORDER BY punto_id, fecha ASC, hora_apertura ASC
)
AND ro.estado IN ('cierre', 'suspension')
-- Garantizar que no existe ya un registro para fecha-1 (seguridad)
AND NOT EXISTS (
    SELECT 1 FROM public.reportes_operacion prev
    WHERE prev.punto_id = ro.punto_id
      AND prev.fecha = ro.fecha - 1
);


-- ── FIX R8: Llenar brechas en cadena de continuidad ──────────────────────────
-- 7 puntos con días activos sin registro al día siguiente.
-- Usa generate_series para cubrir gaps de múltiples días (hasta 30 días por gap).
-- Solo inserta si el día es pasado (< hoy) y no existe ya un registro.

INSERT INTO public.reportes_operacion (
    punto_id,
    fecha,
    estado,
    hora_apertura,
    hora_cierre,
    caudal_promedio,
    actualizado_en
)
SELECT DISTINCT ON (g.punto_id, gap_date::date)
    g.punto_id,
    gap_date::date,
    'continua'::estado_reporte,
    timezone('America/Chihuahua', gap_date::date::timestamp),
    NULL,
    0,
    now()
FROM (
    SELECT
        ro.punto_id,
        ro.fecha AS fecha_brecha,
        COALESCE(
            (
                SELECT MIN(nxt.fecha)
                FROM public.reportes_operacion nxt
                WHERE nxt.punto_id = ro.punto_id
                  AND nxt.fecha > ro.fecha
            ),
            CURRENT_DATE
        ) AS proxima_fecha
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
      AND ro.fecha < CURRENT_DATE
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion s
          WHERE s.punto_id = ro.punto_id AND s.fecha = ro.fecha + 1
      )
) g
CROSS JOIN generate_series(
    (g.fecha_brecha + INTERVAL '1 day'),
    (g.proxima_fecha - INTERVAL '1 day'),
    INTERVAL '1 day'
) AS gap_date
WHERE gap_date::date < CURRENT_DATE
  AND NOT EXISTS (
      SELECT 1 FROM public.reportes_operacion ex
      WHERE ex.punto_id = g.punto_id
        AND ex.fecha = gap_date::date
  );


-- ── FIX R2: Mostrar y eliminar registros con fecha futura ─────────────────────
-- Antes de borrar, mostrar qué se va a eliminar.

SELECT
    id,
    punto_id,
    fecha,
    estado,
    hora_apertura::text,
    hora_cierre::text,
    'SERA ELIMINADO' AS accion
FROM public.reportes_operacion
WHERE fecha > CURRENT_DATE
ORDER BY fecha;

DELETE FROM public.reportes_operacion
WHERE fecha > CURRENT_DATE;


-- ── VERIFICACIÓN FINAL ────────────────────────────────────────────────────────

WITH anomalias AS (
    SELECT 'R7: continua/modificacion sin inicio previo' AS tipo, count(*) AS total
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('continua', 'modificacion')
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion prev
          WHERE prev.punto_id = ro.punto_id AND prev.fecha < ro.fecha
            AND prev.estado IN ('inicio', 'reabierto')
      )
    UNION ALL
    SELECT 'R1+R6: Primer evento no es inicio/reabierto', count(*) FROM (
        SELECT DISTINCT ON (punto_id) punto_id, estado
        FROM public.reportes_operacion
        ORDER BY punto_id, fecha ASC, hora_apertura ASC
    ) t WHERE estado IN ('cierre', 'suspension', 'continua', 'modificacion')
    UNION ALL
    SELECT 'Mismatch: hora_cierre no coincide con fecha+1', count(*)
    FROM public.reportes_operacion
    WHERE hora_cierre IS NOT NULL AND estado = 'cierre'
      AND (hora_cierre AT TIME ZONE 'America/Chihuahua')::date != fecha + 1
    UNION ALL
    SELECT 'Mismatch: apertura de continua no es medianoche local', count(*)
    FROM public.reportes_operacion
    WHERE estado = 'continua' AND hora_apertura IS NOT NULL
      AND EXTRACT(HOUR FROM hora_apertura AT TIME ZONE 'America/Chihuahua') != 0
    UNION ALL
    SELECT 'R8: Brechas en cadena de continuidad', count(*)
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
      AND ro.fecha < CURRENT_DATE
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion s
          WHERE s.punto_id = ro.punto_id AND s.fecha = ro.fecha + 1
      )
    UNION ALL
    SELECT 'R2: Fecha futura en reportes_operacion', count(*)
    FROM public.reportes_operacion WHERE fecha > CURRENT_DATE
    UNION ALL
    SELECT 'R4: estado=cierre sin hora_cierre', count(*)
    FROM public.reportes_operacion WHERE estado = 'cierre' AND hora_cierre IS NULL
    UNION ALL
    SELECT 'R4: abierto con hora_cierre seteada', count(*)
    FROM public.reportes_operacion
    WHERE estado IN ('inicio', 'continua', 'modificacion', 'reabierto') AND hora_cierre IS NOT NULL
    UNION ALL
    SELECT 'R3: hora_cierre < hora_apertura', count(*)
    FROM public.reportes_operacion
    WHERE hora_cierre IS NOT NULL AND hora_apertura IS NOT NULL AND hora_cierre < hora_apertura
)
SELECT
    tipo,
    total,
    CASE WHEN total = 0 THEN '✓ RESUELTO' ELSE '✗ REVISAR' END AS estado
FROM anomalias
ORDER BY total DESC, tipo;
