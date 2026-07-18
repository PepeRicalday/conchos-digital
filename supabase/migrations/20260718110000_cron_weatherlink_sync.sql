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
-- ⚠️ Reemplaza <ANON_KEY> por la anon key del proyecto antes de aplicar, o usa
--    Vault (recomendado). Ver nota de despliegue al final.
SELECT cron.schedule(
  'weatherlink-sync-2h',
  '0 */2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/weatherlink-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.anon_key', true)
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Nota de despliegue ──────────────────────────────────────────────────────
-- Para que el header Authorization funcione sin exponer la anon key en el SQL,
-- define el parámetro una sola vez (ejecutar como superusuario / desde el panel):
--   ALTER DATABASE postgres SET app.settings.anon_key = '<ANON_KEY_DEL_PROYECTO>';
-- Alternativa: pegar la anon key directamente en el header del cron.schedule.
