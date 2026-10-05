-- Bitácora de intentos de presas-cila-sync: permite medir la hora real de publicación del
-- reporte CILA, distinguir esperando de retrasado y auditar qué se volcó a lecturas_presas.
CREATE TABLE IF NOT EXISTS public.presas_cila_sync_log (
  id                    bigserial PRIMARY KEY,
  intento_ts            timestamptz NOT NULL DEFAULT now(),
  resultado             text        NOT NULL,   -- nuevo | sin_cambios | error | sin_reporte
  estado_vigencia       text,                   -- ACTUALIZADO | ESPERANDO | RETRASADO | SIN_ACTUALIZACION
  fecha_reporte         date,
  archivo_last_modified timestamptz,
  detalle               jsonb
);
CREATE INDEX IF NOT EXISTS idx_presas_cila_sync_log_ts ON public.presas_cila_sync_log (intento_ts DESC);
ALTER TABLE public.presas_cila_sync_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read Presas CILA Log" ON public.presas_cila_sync_log;
CREATE POLICY "Public Read Presas CILA Log" ON public.presas_cila_sync_log FOR SELECT USING (true);
