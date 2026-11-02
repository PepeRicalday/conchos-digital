-- ═══════════════════════════════════════════════════════════════════════════
-- sentinel-ndwi-vaso-sync — el cron deja de usar la clave anon pública
-- Fecha: 2026-11-01
--
-- Antes el cron llamaba con la clave anon (la misma que trae la app en el
-- navegador): cualquiera podía disparar escrituras en vaso_geometria_historico y
-- gastar unidades de procesamiento de Sentinel Hub. Ahora la función solo acepta:
--   · usuarios con sesión (rol authenticated) — botón "Actualizar mes actual";
--   · el cron, con un secreto compartido guardado en Vault (header x-cron-secret).
-- El secreto se genera AQUÍ, dentro de la base: no aparece en ningún archivo ni log.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'vaso_sync_cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'vaso_sync_cron_secret',
      'Secreto compartido cron → edge function sentinel-ndwi-vaso-sync (header x-cron-secret).');
  END IF;
END $$;

-- Validación del secreto para la edge function (llamada con service_role). Comparación en la base: el secreto no viaja de vuelta.
CREATE OR REPLACE FUNCTION public.fn_vaso_sync_secreto_valido(p_secreto text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(p_secreto IS NOT NULL AND length(p_secreto) >= 32 AND p_secreto = (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vaso_sync_cron_secret'
  ), false);
$$;
REVOKE ALL ON FUNCTION public.fn_vaso_sync_secreto_valido(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_vaso_sync_secreto_valido(text) TO service_role;

-- Cron mensual (día 3, 07:00 UTC): mismo horario, ahora con el secreto leído de Vault al momento de ejecutar.
SELECT cron.unschedule('ndwi-vaso-sync-mensual') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndwi-vaso-sync-mensual');
SELECT cron.schedule(
  'ndwi-vaso-sync-mensual',
  '0 7 3 * *',
  $cmd$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-ndwi-vaso-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vaso_sync_cron_secret')
    ),
    body    := '{"presa_id": "PRE-001"}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cmd$
);
