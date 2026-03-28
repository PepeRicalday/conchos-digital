-- ============================================================
-- Migración: Corrección de Integridad Lógica de Registros (v2)
-- Fecha: 2026-03-25
-- Basada en diagnóstico_integridad_registros.sql
--
-- v2: Condiciones corregidas en FIX-A, FIX-B, FIX-C
--   FIX-A v1 bug: solo buscaba puntos con CERO inicios → ahora usa la lógica
--                 exacta de R7 (continua sin inicio PREVIO, incluso si tiene
--                 inicio posterior)
--   FIX-B v1 bug: comparación de igualdad exacta podía fallar → ahora usa
--                 EXTRACT(HOUR) + comparación de fecha UTC
--   FIX-C v1 bug: condición de fecha en zona local excluía registros buggy
--                 (00:00 UTC = 18:00 día anterior en Chihuahua → fecha no coincide)
--                 → eliminada esa condición
-- ============================================================


-- ── FIX-A v2: Convertir primer registro R7 a 'inicio' ────────────────────────
-- Problema: registros 'continua'/'modificacion' sin ningún 'inicio' previo.
-- El error de v1 fue filtrar solo puntos con CERO inicios. Muchos puntos sí
-- tienen un 'inicio' pero tienen registros 'continua' ANTERIORES a ese 'inicio'.
-- Solución: buscar directamente los que fallan R7 y convertir el más antiguo
-- de cada punto a 'inicio'.

WITH ranked_r7 AS (
    SELECT
        ro.id,
        ROW_NUMBER() OVER (
            PARTITION BY ro.punto_id
            ORDER BY ro.fecha ASC, ro.hora_apertura ASC NULLS LAST
        ) AS rn
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('continua', 'modificacion')
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion prev
          WHERE prev.punto_id = ro.punto_id
            AND prev.fecha < ro.fecha
            AND prev.estado IN ('inicio', 'reabierto')
      )
)
UPDATE public.reportes_operacion ro
SET
    estado = 'inicio',
    actualizado_en = timezone('utc'::text, now())
FROM ranked_r7 rr
WHERE ro.id = rr.id
  AND rr.rn = 1;


-- ── FIX-B v2: Corregir hora_cierre en UTC midnight ────────────────────────────
-- Problema: 96+ registros con hora_cierre = medianoche UTC (00:00+00) en lugar
-- de medianoche Chihuahua (06:00+00). Bug del cron antiguo.
-- Detección robusta: busca hora que sea exactamente medianoche UTC del día fecha+1,
-- sin depender de igualdad exacta con valor calculado.

UPDATE public.reportes_operacion
SET
    hora_cierre = timezone('America/Chihuahua', (fecha + 1)::timestamp),
    actualizado_en = timezone('utc'::text, now())
WHERE estado = 'cierre'
  AND hora_cierre IS NOT NULL
  -- Es exactamente medianoche UTC (hora entera, sin minutos/segundos)
  AND hora_cierre = DATE_TRUNC('hour', hora_cierre)
  AND EXTRACT(HOUR FROM hora_cierre AT TIME ZONE 'UTC') = 0
  -- La fecha UTC de hora_cierre corresponde a fecha+1
  AND (hora_cierre AT TIME ZONE 'UTC')::date = fecha + 1;


-- ── FIX-C v2: Corregir hora_apertura en 'continua' ≠ medianoche local ─────────
-- Problema: 8 registros 'continua' con hora_apertura = 00:00 UTC en lugar de
-- 06:00 UTC (medianoche Chihuahua). Bug del cron antiguo.
-- Error de v1: condición de fecha en zona local excluía los registros buggy
-- porque 00:00 UTC = 18:00 del día anterior en Chihuahua → fecha no coincidía.
-- Solución v2: solo verificar que la hora en Chihuahua no sea medianoche.

UPDATE public.reportes_operacion
SET
    hora_apertura = timezone('America/Chihuahua', fecha::timestamp),
    actualizado_en = timezone('utc'::text, now())
WHERE estado = 'continua'
  AND hora_apertura IS NOT NULL
  -- La hora local NO es medianoche (indica bug de timezone)
  AND EXTRACT(HOUR FROM hora_apertura AT TIME ZONE 'America/Chihuahua') != 0;


-- ── FIX-R3: Corregir hora_cierre ANTERIOR a hora_apertura ───────────────────
-- (sin cambios respecto a v1 — condición correcta)

UPDATE public.reportes_operacion
SET
    hora_cierre = timezone('America/Chihuahua', CAST(fecha + 1 AS timestamp)),
    actualizado_en = timezone('utc'::text, now())
WHERE hora_cierre IS NOT NULL
  AND hora_apertura IS NOT NULL
  AND hora_cierre < hora_apertura
  AND estado = 'cierre';


-- ── FIX-D: Mostrar registros con fecha futura para revisión manual ────────────
-- NO se borran automáticamente. Revisar antes de decidir.

SELECT
    'REVISAR MANUALMENTE — FECHA FUTURA' AS accion,
    'reportes_operacion' AS tabla,
    id::text,
    punto_id,
    fecha::text,
    estado::text,
    hora_apertura::text,
    hora_cierre::text
FROM public.reportes_operacion
WHERE fecha > CURRENT_DATE

UNION ALL

SELECT
    'REVISAR MANUALMENTE — TIMESTAMP FUTURO',
    'mediciones',
    id::text,
    punto_id,
    fecha_hora::text,
    estado_evento::text,
    NULL,
    NULL
FROM public.mediciones
WHERE fecha_hora > now()
ORDER BY tabla, fecha;


-- ── VERIFICACIÓN POST-FIX ─────────────────────────────────────────────────────

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
