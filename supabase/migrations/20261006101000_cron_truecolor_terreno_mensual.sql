-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: textura satelital (color real) del terreno de la presa, mensual
-- Fecha: 2026-10-06
--
-- sentinel-truecolor-terreno-sync no tenía cron: la textura del visor 3D envejecía sin aviso.
-- Se programa el día 3 a las 09:00 UTC, después del NDWI (07:00) y del NDVI (08:00), para no competir
-- por la cuota de Sentinel Hub. La anon key es pública (ya viaja en el frontend); la función usa service_role.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('sentinel-truecolor-terreno-mensual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sentinel-truecolor-terreno-mensual');

SELECT cron.schedule(
  'sentinel-truecolor-terreno-mensual',
  '0 9 3 * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-truecolor-terreno-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);
