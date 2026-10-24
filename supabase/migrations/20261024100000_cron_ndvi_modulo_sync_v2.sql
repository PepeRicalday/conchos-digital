-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: el NDVI mensual por módulo pasa a la serie v2 (máscara SCL + mediana)
-- Fecha: 2026-10-24 — autorizado por el usuario.
--
-- Todo el panel e informes de GEO-MONITOR leen ndvi_modulo_mensual_v2, así
-- que el cron mensual (día 3, 08:00 UTC) deja de alimentar la serie v1
-- (ndvi_modulo_historico, congelada desde sep-2026, sin borrar) y alimenta v2
-- con la función sentinel-ndvi-modulo-sync-v2. Mismo calendario y mismo body:
-- sin "mes" procesa el mes calendario anterior, con los 6 módulos SRL.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.unschedule('ndvi-modulo-sync-mensual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndvi-modulo-sync-mensual');

SELECT cron.unschedule('ndvi-modulo-sync-v2-mensual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndvi-modulo-sync-v2-mensual');

SELECT cron.schedule(
  'ndvi-modulo-sync-v2-mensual',
  '0 8 3 * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-ndvi-modulo-sync-v2',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);
