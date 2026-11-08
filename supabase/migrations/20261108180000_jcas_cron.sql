-- Cron de jcas-sync (JCAS/UACJ, contexto de la cuenca del Conchos). Cortesía con el portal: 2 corridas diarias + 1 semanal.
--  · 08:20 y 18:20 UTC → catálogo + últimos ~30 días (el día de ayer queda completo pasada la medianoche local)
--  · lunes 09:20 y 09:50 UTC → meses completos de los últimos 12 (la página anual tarda ~7 s por estación: dos pasadas reanudables)
-- Cada corrida = 1 consulta de catálogo + 1 página por estación (18 estaciones, pausa de 1 s).
-- PENDIENTE DE APLICAR: solo después de desplegar la edge function jcas-sync (requiere visto bueno del usuario).

INSERT INTO public.cron_secretos (nombre, valor)
VALUES ('jcas_sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (nombre) DO NOTHING;

SELECT cron.unschedule(j) FROM unnest(ARRAY['jcas-sync-diario-1','jcas-sync-diario-2','jcas-sync-anio','jcas-sync-anio-2']) AS j
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);

SELECT cron.schedule(n, h, format($f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/jcas-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'jcas_sync')),
    body    := %L::jsonb,
    timeout_milliseconds := 140000
  );$f$, b))
FROM (VALUES
  ('jcas-sync-diario-1', '20 8 * * *',  '{"modo":"diario"}'),
  ('jcas-sync-diario-2', '20 18 * * *', '{"modo":"diario"}'),
  ('jcas-sync-anio',     '20 9 * * 1',  '{"modo":"anio"}'),
  ('jcas-sync-anio-2',   '50 9 * * 1',  '{"modo":"anio"}')
) AS t(n, h, b);
