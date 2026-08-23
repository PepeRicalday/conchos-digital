-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: recalibración mensual de curva batimétrica (vs. CONAGUA)
-- Fecha: 2026-08-23
--
-- Programa recalibra-curva-batimetrica para ejecutarse el día 4 de cada mes
-- vía pg_cron + pg_net — mismo patrón que ndwi-vaso-sync-mensual
-- (20260823100000). Corre UN DÍA DESPUÉS de ese cron (día 3) a propósito:
-- necesita que la escena NDWI del mes ya esté insertada en
-- vaso_geometria_historico antes de recalcular los factores de corrección,
-- si no tendría un mes de retraso hasta la siguiente corrida.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT cron.unschedule('recalibra-curva-batimetrica-mensual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recalibra-curva-batimetrica-mensual');

SELECT cron.schedule(
  'recalibra-curva-batimetrica-mensual',
  '0 8 4 * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/recalibra-curva-batimetrica',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{"presa_id": "PRE-001"}'::jsonb
  );
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver el job creado:      SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'recalibra-curva-batimetrica-mensual';
-- Ver ejecuciones/errores: SELECT status, return_message, start_time
--                          FROM cron.job_run_details WHERE jobid =
--                            (SELECT jobid FROM cron.job WHERE jobname='recalibra-curva-batimetrica-mensual')
--                          ORDER BY start_time DESC LIMIT 5;
-- Ver factores vigentes:   SELECT banda_elevacion_msnm, factor_area, desviacion_pct_prom, n_observaciones
--                          FROM curva_batimetrica_correccion WHERE presa_id='PRE-001' ORDER BY banda_elevacion_msnm;
