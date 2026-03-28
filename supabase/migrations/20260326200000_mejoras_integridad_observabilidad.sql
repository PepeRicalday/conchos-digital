-- ============================================================
-- Mejoras de Integridad, Observabilidad y Optimización
-- Fecha: 2026-03-26
-- Bloques: A (Prevención) | B (Observabilidad) | C (Calidad)
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- BLOQUE A: PREVENCIÓN — Constraints para evitar datos inválidos
-- ════════════════════════════════════════════════════════════

-- A1: No permitir registros con fecha futura en reportes_operacion
ALTER TABLE public.reportes_operacion
DROP CONSTRAINT IF EXISTS no_fecha_futura;

ALTER TABLE public.reportes_operacion
ADD CONSTRAINT no_fecha_futura
CHECK (fecha <= CURRENT_DATE);

-- A2: No permitir mediciones con timestamp futuro (5 min de margen para latencia)
ALTER TABLE public.mediciones
DROP CONSTRAINT IF EXISTS no_timestamp_futuro;

ALTER TABLE public.mediciones
ADD CONSTRAINT no_timestamp_futuro
CHECK (fecha_hora <= (now() + INTERVAL '5 minutes'));

-- A3: hora_cierre solo puede existir en estado 'cierre'
ALTER TABLE public.reportes_operacion
DROP CONSTRAINT IF EXISTS hora_cierre_solo_en_cierre;

ALTER TABLE public.reportes_operacion
ADD CONSTRAINT hora_cierre_solo_en_cierre
CHECK (
    (estado = 'cierre' AND hora_cierre IS NOT NULL)
    OR
    (estado != 'cierre' AND hora_cierre IS NULL)
);

-- A4: hora_cierre no puede ser anterior a hora_apertura
ALTER TABLE public.reportes_operacion
DROP CONSTRAINT IF EXISTS hora_cierre_mayor_apertura;

ALTER TABLE public.reportes_operacion
ADD CONSTRAINT hora_cierre_mayor_apertura
CHECK (
    hora_cierre IS NULL
    OR hora_apertura IS NULL
    OR hora_cierre > hora_apertura
);


-- ════════════════════════════════════════════════════════════
-- BLOQUE B: OBSERVABILIDAD — Log de integridad y dashboard
-- ════════════════════════════════════════════════════════════

-- B1: Tabla de log diario del cron de integridad
CREATE TABLE IF NOT EXISTS public.sica_integrity_log (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    fecha           DATE NOT NULL,
    ejecutado_en    TIMESTAMPTZ DEFAULT now(),
    puntos_activos  INTEGER DEFAULT 0,
    registros_creados INTEGER DEFAULT 0,
    brechas_post    INTEGER DEFAULT 0,
    estado          TEXT DEFAULT 'ok'
        CHECK (estado IN ('ok', 'alerta', 'critico')),
    detalle         JSONB,
    UNIQUE(fecha)
);

COMMENT ON TABLE public.sica_integrity_log IS
'Registro diario del resultado del cron fn_generar_continuidad_diaria.
 Si estado != ok, revisar detalle para diagnóstico.';

-- B2: Columna origen en reportes_operacion para distinguir registros reales vs sintéticos
ALTER TABLE public.reportes_operacion
ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'operador'
    CHECK (origen IN ('operador', 'cron', 'backfill', 'correccion'));

COMMENT ON COLUMN public.reportes_operacion.origen IS
'operador = registrado por usuario | cron = generado por fn_generar_continuidad_diaria
 | backfill = corrección histórica | correccion = fix de integridad';

-- Marcar los registros sintéticos ya existentes
-- (continua con caudal=0 y hora_apertura exacta a medianoche Chihuahua = generados por cron)
UPDATE public.reportes_operacion
SET origen = 'cron'
WHERE estado = 'continua'
  AND caudal_promedio = 0
  AND EXTRACT(HOUR FROM hora_apertura AT TIME ZONE 'America/Chihuahua') = 0
  AND EXTRACT(MINUTE FROM hora_apertura AT TIME ZONE 'America/Chihuahua') = 0
  AND origen = 'operador';  -- solo los que aún no tienen origen asignado

-- B3: Vista de integridad actual (reemplaza ejecutar el script diagnóstico manualmente)
CREATE OR REPLACE VIEW public.v_integridad_reportes AS
WITH checks AS (
    SELECT 'R7: continua sin inicio previo'      AS check_id, count(*) AS total
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('continua', 'modificacion')
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion p
          WHERE p.punto_id = ro.punto_id AND p.fecha < ro.fecha
            AND p.estado IN ('inicio', 'reabierto')
      )
    UNION ALL
    SELECT 'R1+R6: Primer evento incorrecto',    count(*) FROM (
        SELECT DISTINCT ON (punto_id) estado
        FROM public.reportes_operacion
        ORDER BY punto_id, fecha ASC, hora_apertura ASC
    ) t WHERE estado IN ('cierre', 'suspension', 'continua', 'modificacion')
    UNION ALL
    SELECT 'R8: Brechas de continuidad',         count(*)
    FROM public.reportes_operacion ro
    WHERE ro.estado IN ('inicio', 'continua', 'modificacion', 'reabierto')
      AND ro.fecha < CURRENT_DATE
      AND NOT EXISTS (
          SELECT 1 FROM public.reportes_operacion s
          WHERE s.punto_id = ro.punto_id AND s.fecha = ro.fecha + 1
      )
    UNION ALL
    SELECT 'R2: Fechas futuras',                 count(*)
    FROM public.reportes_operacion WHERE fecha > CURRENT_DATE
    UNION ALL
    SELECT 'R3: hora_cierre < hora_apertura',    count(*)
    FROM public.reportes_operacion
    WHERE hora_cierre IS NOT NULL AND hora_apertura IS NOT NULL
      AND hora_cierre < hora_apertura
    UNION ALL
    SELECT 'Mismatch: hora_cierre timezone',     count(*)
    FROM public.reportes_operacion
    WHERE hora_cierre IS NOT NULL AND estado = 'cierre'
      AND (hora_cierre AT TIME ZONE 'America/Chihuahua')::date != fecha + 1
    UNION ALL
    SELECT 'Mismatch: hora_apertura continua',   count(*)
    FROM public.reportes_operacion
    WHERE estado = 'continua' AND hora_apertura IS NOT NULL
      AND EXTRACT(HOUR FROM hora_apertura AT TIME ZONE 'America/Chihuahua') != 0
)
SELECT
    check_id,
    total,
    CASE
        WHEN total = 0  THEN 'ok'
        WHEN total < 10 THEN 'alerta'
        ELSE                 'critico'
    END AS severidad,
    CURRENT_TIMESTAMP AS evaluado_en
FROM checks
ORDER BY total DESC, check_id;

COMMENT ON VIEW public.v_integridad_reportes IS
'Vista de integridad en tiempo real. Consultar diariamente.
 Uso: SELECT * FROM v_integridad_reportes;';

-- B4: Índice compuesto para acelerar queries del historial multi-día
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reportes_punto_fecha_estado
ON public.reportes_operacion (punto_id, fecha DESC, estado);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reportes_estado_fecha
ON public.reportes_operacion (estado, fecha DESC)
WHERE estado IN ('inicio', 'continua', 'reabierto');


-- ════════════════════════════════════════════════════════════
-- BLOQUE C: CALIDAD — Recuperar caudal real en registros sintéticos
-- ════════════════════════════════════════════════════════════

-- C1: Recalcular caudal_promedio en registros 'continua' con caudal=0
-- solo si existen mediciones reales para esa fecha y punto
UPDATE public.reportes_operacion ro
SET
    caudal_promedio = sub.caudal_calculado,
    actualizado_en  = now()
FROM (
    SELECT
        m.punto_id,
        (m.fecha_hora AT TIME ZONE 'America/Chihuahua')::date AS fecha_local,
        ROUND(AVG(m.valor_q)::numeric, 4) AS caudal_calculado
    FROM public.mediciones m
    WHERE m.valor_q IS NOT NULL AND m.valor_q > 0
    GROUP BY m.punto_id, (m.fecha_hora AT TIME ZONE 'America/Chihuahua')::date
) sub
WHERE ro.punto_id = sub.punto_id
  AND ro.fecha     = sub.fecha_local
  AND ro.estado    = 'continua'
  AND ro.caudal_promedio = 0
  AND sub.caudal_calculado > 0;


-- ════════════════════════════════════════════════════════════
-- VERIFICACIÓN FINAL
-- ════════════════════════════════════════════════════════════

-- Ver estado de integridad actual
SELECT * FROM public.v_integridad_reportes;

-- Cuántos registros continua tenían caudal=0 y ahora tienen valor real
SELECT
    origen,
    count(*) AS total_registros,
    count(*) FILTER (WHERE caudal_promedio = 0)   AS con_caudal_cero,
    count(*) FILTER (WHERE caudal_promedio > 0)   AS con_caudal_real,
    ROUND(AVG(caudal_promedio)::numeric, 4)        AS caudal_promedio_global
FROM public.reportes_operacion
WHERE estado = 'continua'
GROUP BY origen
ORDER BY origen;

-- Confirmar constraints creados
SELECT
    conname AS constraint,
    contype AS tipo,
    pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.reportes_operacion'::regclass
  AND conname IN (
      'no_fecha_futura',
      'hora_cierre_solo_en_cierre',
      'hora_cierre_mayor_apertura'
  );
