-- Cron de unifrut-sync (UNIFRUT A.C., Red de Estaciones Meteorológicas, contexto regional). Cortesía con el portal: 1 corrida diaria + 1 horaria.
--  · 14:10 UTC (08:10 Chihuahua) → catálogo no; últimos 14 días completos (el portal publica el día N en la madrugada del N+1)
--  · 14:40 UTC → horario de las estaciones vigentes (últimas ~48 h)
-- Cada corrida = 1 petición por estación (29, pausa de 1 s; las apagadas responden vacío al instante).
-- APLICADA 2026-11-13 (MCP apply_migration) tras aplicar 20261113120000_unifrut_estaciones.sql y desplegar la edge function unifrut-sync.

INSERT INTO public.cron_secretos (nombre, valor)
VALUES ('unifrut_sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (nombre) DO NOTHING;

SELECT cron.unschedule(j) FROM unnest(ARRAY['unifrut-sync-diario','unifrut-sync-horario']) AS j
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);

SELECT cron.schedule(n, h, format($f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/unifrut-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'unifrut_sync')),
    body    := %L::jsonb,
    timeout_milliseconds := 140000
  );$f$, b))
FROM (VALUES
  ('unifrut-sync-diario',  '10 14 * * *', '{"modo":"diario"}'),
  ('unifrut-sync-horario', '40 14 * * *', '{"modo":"horario"}')
) AS t(n, h, b);
