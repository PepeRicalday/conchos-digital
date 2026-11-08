-- Cron de aqwp-sync (USIBWC AQWP). CONAGUA publica ~09:30 hora de Chihuahua (15:30 UTC):
--  · 16:30 y 18:30 UTC → export de 30 días (corrige valores tardíos y alimenta la detección de estancamiento)
--  · 23:30 UTC         → respaldo
--  · 17:00 UTC         → cruce de formato contra MexResScript
-- El secreto 'aqwp_sync' ya existe en cron_secretos (misma convención que ibwc_telemetry_sync).
-- PENDIENTE DE APLICAR: requiere visto bueno del usuario.

INSERT INTO public.cron_secretos (nombre, valor)
VALUES ('aqwp_sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (nombre) DO NOTHING;

SELECT cron.unschedule(j) FROM unnest(ARRAY['aqwp-sync-export-1','aqwp-sync-export-2','aqwp-sync-respaldo','aqwp-sync-tabla']) AS j
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);

SELECT cron.schedule(n, h, format($f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/aqwp-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'aqwp_sync')),
    body    := %L::jsonb,
    timeout_milliseconds := 140000
  );$f$, b))
FROM (VALUES
  ('aqwp-sync-export-1', '30 16 * * *', '{"modo":"export","dias":30}'),
  ('aqwp-sync-export-2', '30 18 * * *', '{"modo":"export","dias":30}'),
  ('aqwp-sync-respaldo', '30 23 * * *', '{"modo":"export","dias":30}'),
  ('aqwp-sync-tabla',    '0 17 * * *',  '{"modo":"tabla"}')
) AS t(n, h, b);
