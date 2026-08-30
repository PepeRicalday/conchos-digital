-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: sincronización mensual de NDVI por módulo (polígono exacto)
-- Fecha: 2026-08-30
--
-- Programa sentinel-ndvi-modulo-sync para ejecutarse el día 3 de cada mes vía
-- pg_cron + pg_net, mismo patrón que ndwi-vaso-sync-mensual (20260823100000)
-- y weatherlink-sync (20260718110000).
--
-- Un solo job (no seis): la Edge Function ya procesa los 6 módulos SRL en una
-- sola invocación cuando el body no trae numero_modulo — ver comentario en
-- sentinel-ndvi-modulo-sync/index.ts.
--
-- Corre a las 08:00 UTC, 1h después del cron del vaso (07:00 UTC) — mismo
-- criterio de holgura sobre el cierre del mes para que el Catalog/Statistical
-- API de Sentinel Hub tenga escenas indexadas, y desfasado del cron del vaso
-- para no competir por cuota de Sentinel Hub en la misma ventana.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Elimina un job previo con el mismo nombre (idempotente).
SELECT cron.unschedule('ndvi-modulo-sync-mensual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndvi-modulo-sync-mensual');

-- Día 3 de cada mes, 08:00 UTC (~02:00 hora Chihuahua). Sin numero_modulo en
-- el body: procesa los 6 módulos SRL (1,2,3,4,5,12) en esta sola corrida.
SELECT cron.schedule(
  'ndvi-modulo-sync-mensual',
  '0 8 3 * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-ndvi-modulo-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver el job creado:      SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'ndvi-modulo-sync-mensual';
-- Ver ejecuciones/errores: SELECT status, return_message, start_time
--                          FROM cron.job_run_details WHERE jobid =
--                            (SELECT jobid FROM cron.job WHERE jobname='ndvi-modulo-sync-mensual')
--                          ORDER BY start_time DESC LIMIT 5;
-- Ver histórico reciente:  SELECT numero_modulo, mes, ndvi_medio, delta_ndvi, kc_estimado
--                          FROM ndvi_modulo_historico ORDER BY mes DESC, numero_modulo LIMIT 12;
