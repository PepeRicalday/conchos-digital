-- FIX: Columna faltante en sica_llenado_seguimiento
-- Esta columna es necesaria para persistir el modelo hidráulico del canal.

ALTER TABLE sica_llenado_seguimiento 
ADD COLUMN IF NOT EXISTS segundos_modelo NUMERIC;

-- Comentario para auditoría
COMMENT ON COLUMN sica_llenado_seguimiento.segundos_modelo IS 'Segundos teóricos de tránsito desde el origen según el modelo hidráulico.';
