-- ═══════════════════════════════════════════════════════════════════════════
-- Medición satelital de todos los vasos + recálculo automático de cierres y balance   Fecha: 2026-11-11
--
-- 1) vaso_sync_log: bitácora de cada intento de la edge function sentinel-ndwi-vaso-sync (resultado y unidades de
--    procesamiento estimadas de Sentinel Hub: sirve para vigilar la cuota).
-- 2) fn_vaso_sync_siguiente(): el siguiente cuerpo de agua activo sin escena vigente v2 en los últimos 30 días y sin intento
--    en las últimas 20 h. El cron procesa UNO por corrida (no 9 a la vez) y los meses nublados se reintentan en la
--    siguiente ventana (días 3, 13 y 23).
-- 3) El cron fijo de La Boquilla (ndwi-vaso-sync-mensual, día 3) se reemplaza por ndwi-vaso-sync-siguiente
--    (cada 15 min entre 07:00 y 08:45 UTC de los días 3, 13 y 23). Boquilla entra por el mismo selector.
-- 4) Recálculo diario del cierre mensual y del balance (fuente: lo que sincroniza AQUARIUS cada día) para los últimos 4
--    meses: una lectura tardía o corregida de CONAGUA se refleja sola. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vaso_sync_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cuerpo_id     text        NOT NULL,                 -- id_serie del cuerpo (PRE-001, CA-LLNCH…)
  mes           text        NOT NULL,                 -- AAAA-MM de la ventana pedida
  resultado     text        NOT NULL,                 -- guardada | sin_escena | sin_escena_limpia | error_analisis | toca_borde | error_guardado
  mensaje       text,
  pu_estimadas  numeric,                              -- píxeles / 512² × 4/3 por petición (estimación)
  creado_en     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vaso_sync_log_cuerpo ON public.vaso_sync_log (cuerpo_id, creado_en DESC);
ALTER TABLE public.vaso_sync_log ENABLE ROW LEVEL SECURITY;
-- Sin política: solo service_role (la edge function) y el dueño (el cron).

CREATE OR REPLACE FUNCTION public.fn_vaso_sync_siguiente() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT c.id_serie
  FROM public.cuerpos_agua c
  WHERE c.activo AND c.satelite_activo
    AND NOT EXISTS (
      SELECT 1 FROM public.vaso_geometria_historico g
      WHERE g.presa_id = c.id_serie AND g.vigente AND g.metodo = 'v2' AND NOT g.es_referencia_historica
        AND g.fecha_escena >= now() - interval '30 days')
    AND NOT EXISTS (
      SELECT 1 FROM public.vaso_sync_log l
      WHERE l.cuerpo_id = c.id_serie AND l.creado_en >= now() - interval '20 hours')
  ORDER BY c.orden_red
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.fn_vaso_sync_siguiente() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_vaso_sync_siguiente() TO service_role;

SELECT cron.unschedule('ndwi-vaso-sync-mensual') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndwi-vaso-sync-mensual');
SELECT cron.unschedule('ndwi-vaso-sync-siguiente') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndwi-vaso-sync-siguiente');
SELECT cron.schedule(
  'ndwi-vaso-sync-siguiente',
  '*/15 7-8 3,13,23 * *',
  $cmd$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-ndwi-vaso-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vaso_sync_cron_secret')
    ),
    body    := jsonb_build_object('presa_id', s.id),
    timeout_milliseconds := 300000
  )
  FROM (SELECT public.fn_vaso_sync_siguiente() AS id) s
  WHERE s.id IS NOT NULL;
  $cmd$
);

SELECT cron.unschedule('cierres-balance-recalcular') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cierres-balance-recalcular');
SELECT cron.schedule(
  'cierres-balance-recalcular',
  '30 0 * * *',
  $cmd$
  SELECT public.fn_cierre_mensual_recalcular(date_trunc('month', current_date - interval '4 months')::date, NULL, NULL);
  SELECT public.fn_balance_mensual_recalcular(date_trunc('month', current_date - interval '4 months')::date, NULL, NULL);
  $cmd$
);
