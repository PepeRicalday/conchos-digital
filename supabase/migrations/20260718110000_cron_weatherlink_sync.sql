-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: sincronización automática de estaciones WeatherLink
-- Fecha: 2026-07-18
--
-- Programa la Edge Function weatherlink-sync para ejecutarse cada 2 horas vía
-- pg_cron + pg_net. Las estaciones EnviroMonitor reportan cada 15 min, pero un
-- sync cada 2 h es suficiente para el tablero agroclimático y evita saturar la
-- cuota de la API WeatherLink.
--
-- Requiere las extensiones pg_cron y pg_net (habilitadas por defecto en Supabase).
-- El anon key va en el header; la función usa el service_role internamente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Elimina un job previo con el mismo nombre (idempotente).
SELECT cron.unschedule('weatherlink-sync-2h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weatherlink-sync-2h');

-- Cada 2 horas: invoca la Edge Function.
-- La anon key es PÚBLICA (rol 'anon', ya viaja en el frontend), así que es seguro
-- embeberla aquí. La Edge Function usa el service_role internamente para escribir.
SELECT cron.schedule(
  'weatherlink-sync-2h',
  '0 */2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/weatherlink-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver el job creado:      SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'weatherlink-sync-2h';
-- Ver ejecuciones/errores: SELECT status, return_message, start_time
--                          FROM cron.job_run_details WHERE jobid =
--                            (SELECT jobid FROM cron.job WHERE jobname='weatherlink-sync-2h')
--                          ORDER BY start_time DESC LIMIT 5;
