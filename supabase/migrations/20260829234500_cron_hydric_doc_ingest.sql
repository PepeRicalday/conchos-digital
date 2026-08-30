-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: ingesta automática de documentos hídricos (process-hydric-doc)
-- Fecha: 2026-08-29
--
-- process-hydric-doc procesa un documento POR LOTES (extracción de PDF en una
-- invocación, luego BATCH_SIZE=5 embeddings por invocación siguiente — el
-- runtime de Supabase.ai se queda sin recursos si se piden ~20+ embeddings
-- seguidos en una sola invocación). Antes de este cron, alguien tenía que
-- invocar la función a mano repetidamente hasta que done=true.
--
-- Este job corre cada minuto: busca CUALQUIER documento con
-- estado_procesamiento en ('pendiente','procesando') y le dispara un lote más.
-- Si no hay documentos pendientes, el job no llama a la función (evita ruido
-- en cron.job_run_details y carga innecesaria en horas normales).
--
-- Requiere las extensiones pg_cron y pg_net (ya habilitadas por otros cron
-- del proyecto, ej. weatherlink-sync).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Elimina un job previo con el mismo nombre (idempotente).
SELECT cron.unschedule('hydric-doc-ingest-1min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hydric-doc-ingest-1min');

-- Cada minuto: si hay algún documento sin terminar, dispara un lote más.
SELECT cron.schedule(
  'hydric-doc-ingest-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/process-hydric-doc',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := jsonb_build_object('document_id', d.id)
  )
  FROM public.hydric_documents d
  WHERE d.estado_procesamiento IN ('pendiente', 'procesando')
  ORDER BY d.created_at ASC
  LIMIT 1;
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver el job creado:      SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'hydric-doc-ingest-1min';
-- Ver ejecuciones/errores: SELECT status, return_message, start_time
--                          FROM cron.job_run_details WHERE jobid =
--                            (SELECT jobid FROM cron.job WHERE jobname='hydric-doc-ingest-1min')
--                          ORDER BY start_time DESC LIMIT 10;
-- Ver documentos en cola:  SELECT id, titulo, estado_procesamiento, chunks_generados
--                          FROM hydric_documents WHERE estado_procesamiento IN ('pendiente','procesando');
