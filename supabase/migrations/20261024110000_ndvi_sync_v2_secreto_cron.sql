-- Endurecimiento de sentinel-ndvi-modulo-sync-v2 (revisión de seguridad 2026-10-24).
-- La función escribe con service role y gasta cuota de Copernicus; la anon key es pública.
-- Ahora exige (a) el secreto del cron (cabecera x-cron-secret, guardado aquí) o (b) un JWT de
-- usuario real. El secreto vive en una tabla con RLS y SIN políticas: anon/authenticated no la
-- leen; la lee la función (service role) y el cron (postgres).

CREATE TABLE IF NOT EXISTS public.cron_secretos (
  nombre text PRIMARY KEY,
  valor  text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cron_secretos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_secretos FROM anon, authenticated;

INSERT INTO public.cron_secretos (nombre, valor)
VALUES ('ndvi_sync_v2', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (nombre) DO NOTHING;

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
      'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'ndvi_sync_v2')
    ),
    body    := '{}'::jsonb
  );
  $$
);
