-- ===================================================================
-- Migración: Corregir Duplicados en Seguimiento de Llenado
-- Fecha: 2026-03-14 00:30
-- Soluciona: duplicate key value violates unique constraint
-- ===================================================================

-- 1. Limpiar duplicados físicos actuales (si existen)
-- Nos quedamos con el ID más reciente para cada combinación evento_id + km
DELETE FROM public.sica_llenado_seguimiento a
USING public.sica_llenado_seguimiento b
WHERE a.evento_id = b.evento_id 
  AND a.km = b.km
  AND a.created_at < b.created_at;

-- 2. Crear el índice de unicidad para evitar futuras colisiones
-- Esto garantiza que no pueda haber dos registros para el mismo KM en el mismo evento.
DROP INDEX IF EXISTS idx_llenado_seg_unique_event_km;
CREATE UNIQUE INDEX idx_llenado_seg_unique_event_km 
ON public.sica_llenado_seguimiento (evento_id, km);

-- 3. Optimizar política de inserción
-- Asegurar que el sistema use ON CONFLICT en el frontend o simplemente se base en este índice.

COMMENT ON INDEX idx_llenado_seg_unique_event_km IS 
'Garantiza integridad hidráulica: un punto de control solo puede existir una vez por evento de llenado.';
