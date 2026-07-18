-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: sincronización horaria del pronóstico (nubosidad + precipitación)
-- Fecha: 2026-07-18
--
-- Programa clima-pronostico-sync cada hora vía pg_cron + pg_net. El documento
-- técnico pide refrescar el pronóstico "cada 1 h o cuando exista nueva corrida";
-- una cadencia horaria cubre ambos casos sin depender de avisos del proveedor.
--
-- Mismo patrón que weatherlink-sync (20260718110000): la anon key es PÚBLICA
-- (rol 'anon', ya viaja en el frontend); la Edge Function usa el service_role
-- internamente para escribir.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Elimina un job previo con el mismo nombre (idempotente).
SELECT cron.unschedule('clima-pronostico-1h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clima-pronostico-1h');

-- Al minuto 10 de cada hora: desfasado del sync de estaciones (minuto 0) para no
-- competir por la misma ventana de ejecución.
SELECT cron.schedule(
  'clima-pronostico-1h',
  '10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/clima-pronostico-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver el job creado:      SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'clima-pronostico-1h';
-- Ver ejecuciones/errores: SELECT status, return_message, start_time
--                          FROM cron.job_run_details WHERE jobid =
--                            (SELECT jobid FROM cron.job WHERE jobname='clima-pronostico-1h')
--                          ORDER BY start_time DESC LIMIT 5;
-- Ver pronóstico vigente:  SELECT nombre, fc_nubosidad_total_pct, fc_precip_prob_pct
--                          FROM v_clima_estacion_actual;
