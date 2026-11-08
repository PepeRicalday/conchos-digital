-- Cron de cuenca-pronostico-sync: 4 corridas al día (00:40, 06:40, 12:40, 18:40 UTC). Cada una = 3 peticiones a Open-Meteo con 24 puntos
-- (≈ 300 llamadas de cuota al día). Uso no comercial. El secreto 'cuenca_pronostico' ya existe en cron_secretos.
SELECT cron.unschedule(j) FROM unnest(ARRAY['cuenca-pronostico-1','cuenca-pronostico-2','cuenca-pronostico-3','cuenca-pronostico-4']) AS j
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);

SELECT cron.schedule(n, h, $f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/cuenca-pronostico-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'cuenca_pronostico')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 100000
  );$f$)
FROM (VALUES
  ('cuenca-pronostico-1', '40 0 * * *'),
  ('cuenca-pronostico-2', '40 6 * * *'),
  ('cuenca-pronostico-3', '40 12 * * *'),
  ('cuenca-pronostico-4', '40 18 * * *')
) AS t(n, h);
