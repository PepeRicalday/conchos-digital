-- Migración: Optimización de Rendimiento con Índices SQL
-- Archivo: 20260222_db_performance_indexes.sql

-- 1. Índice para búsquedas temporales de mediciones
-- Crucial para acelerar la vista del Dashboard (por día) y los Triggers de cálculo de volumen (buscar el evento previo).
-- Se crea concurrentemente si la base de datos es grande para no bloquear inserts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mediciones_punto_fecha 
ON public.mediciones (punto_id, fecha_hora DESC);

-- 2. Índice para acelerar el cruce de reportes diarios
-- El dashboard y la app móvil constantemente leen los estados de los puntos en el día actual.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reportes_punto_fecha 
ON public.reportes_diarios (punto_id, fecha DESC);

-- 3. Índice para las escalas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escalas_lecturas_fecha 
ON public.lecturas_escalas (escala_id, fecha DESC);
