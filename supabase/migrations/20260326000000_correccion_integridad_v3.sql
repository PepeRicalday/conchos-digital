-- ============================================================
-- Migración: Corrección de Integridad v3
-- Fecha: 2026-03-26
-- Pendientes después de v2: FIX-B, FIX-R4b, diagnóstico R8
-- ============================================================


-- ── FIX-B v3: Corregir hora_cierre incorrecta ────────────────────────────────
-- v2 falló porque la condición de igualdad era demasiado estricta.
-- v3: usa directamente la misma condición que el diagnóstico para garantizar
-- que cualquier registro que falla el check quede corregido.

UPDATE public.reportes_operacion
SET
    hora_cierre = timezone('America/Chihuahua', (fecha + 1)::timestamp),
    actualizado_en = timezone('utc'::text, now())
WHERE estado = 'cierre'
  AND hora_cierre IS NOT NULL
  AND (hora_cierre AT TIME ZONE 'America/Chihuahua')::date != fecha + 1;


-- ── FIX-R4b: Limpiar hora_cierre en registros que NO son 'cierre' ────────────
-- 1 registro con estado abierto (inicio/continua/modificacion/reabierto)
-- tiene hora_cierre seteada — inconsistencia lógica.

UPDATE public.reportes_operacion
SET
    hora_cierre = NULL,
    actualizado_en = timezone('utc'::text, now())
WHERE estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
  AND hora_cierre IS NOT NULL;


-- ── DIAGNÓSTICO R8: Brechas en cadena ────────────────────────────────────────
-- Mostrar los 7 puntos con brechas para entender si son esperadas o errores.

SELECT
    ro.punto_id,
    ro.fecha AS ultimo_dia_activo,
    ro.estado AS estado_ultimo,
    ro.fecha + 1 AS dia_faltante,
    EXISTS (
        SELECT 1 FROM public.reportes_operacion next
        WHERE next.punto_id = ro.punto_id
          AND next.fecha > ro.fecha
    ) AS tiene_registros_posteriores
FROM public.reportes_operacion ro
WHERE ro.estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
  AND ro.fecha < CURRENT_DATE
  AND NOT EXISTS (
      SELECT 1 FROM public.reportes_operacion s
      WHERE s.punto_id = ro.punto_id AND s.fecha = ro.fecha + 1
  )
ORDER BY ro.punto_id, ro.fecha;


-- ── DIAGNÓSTICO R1+R6: Detalle de 56 primeros eventos incorrectos ─────────────
-- Estos 56 puntos tienen como primer evento 'cierre' o 'suspension'.
-- No se pueden auto-corregir sin crear un registro 'inicio' artificial.
-- Se muestran para revisión manual.

SELECT
    ro.punto_id,
    ro.fecha AS fecha_primer_registro,
    ro.estado AS estado_primer_registro,
    ro.hora_apertura::text,
    ro.hora_cierre::text
FROM public.reportes_operacion ro
WHERE (ro.punto_id, ro.fecha) IN (
    SELECT DISTINCT ON (punto_id) punto_id, fecha
    FROM public.reportes_operacion
    ORDER BY punto_id, fecha ASC, hora_apertura ASC
)
AND ro.estado IN ('cierre', 'suspension', 'continua', 'modificacion')
ORDER BY ro.estado, ro.punto_id;


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
