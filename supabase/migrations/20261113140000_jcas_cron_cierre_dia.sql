-- A) Cierre del día del portal JCAS: el "día" del portal es UTC (00:00 UTC = 18:00 Chihuahua) y SICA lo da por cerrado a las 07:00 UTC (hoyConservador, UTC-7).
-- La única corrida diaria de la madrugada era 08:20 UTC, así que de 07:00 a 08:20 UTC «hoy» y «ayer» salían S/D en todas las JCAS. Esta corrida (07:10 UTC) cierra el hueco.
-- APLICADA 2026-11-13 (MCP apply_migration).
SELECT cron.unschedule('jcas-sync-diario-0') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jcas-sync-diario-0');
SELECT cron.schedule('jcas-sync-diario-0', '10 7 * * *', $f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/jcas-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'jcas_sync')),
    body    := '{"modo":"diario"}'::jsonb,
    timeout_milliseconds := 140000
  );$f$);
