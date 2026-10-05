-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: ingesta diaria del Reservoir Report CILA/USIBWC
-- Fecha: 2026-10-05
--
-- El reporte se publica entre 9:00 y 11:00 hora de Chihuahua (UTC-6, sin horario de
-- verano) = 15:00–17:00 UTC. La función presas-cila-sync es idempotente, así que se
-- reintenta cada 30 min en la ventana y queda un respaldo vespertino.
--   · presas-cila-sync-ventana : */30 15-17 UTC (9:00–11:30 Chihuahua)
--   · presas-cila-sync-respaldo: 18:00 y 22:00 UTC (12:00 y 16:00 Chihuahua)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('presas-cila-sync-ventana')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'presas-cila-sync-ventana');
SELECT cron.unschedule('presas-cila-sync-respaldo')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'presas-cila-sync-respaldo');

-- La anon key es PÚBLICA (ya viaja en el frontend); la función usa service_role internamente.
SELECT cron.schedule(
  'presas-cila-sync-ventana',
  '*/30 15-17 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/presas-cila-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'presas-cila-sync-respaldo',
  '0 18,22 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/presas-cila-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- SELECT jobid, schedule, jobname FROM cron.job WHERE jobname LIKE 'presas-cila-sync%';
-- SELECT status, return_message, start_time FROM cron.job_run_details
--  WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'presas-cila-sync%')
--  ORDER BY start_time DESC LIMIT 10;
