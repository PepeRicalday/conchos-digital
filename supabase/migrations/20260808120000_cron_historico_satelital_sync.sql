-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: sincronización diaria del histórico satelital (NASA POWER)
-- Fecha: 2026-08-08
--
-- clima-historico-satelital-sync existe desde el 2026-08-02 pero, a diferencia
-- de weatherlink-sync (cron 2h) y clima-pronostico-sync (cron 1h), nunca tuvo
-- job de pg_cron — su llenado dependía de invocación manual. Sin sincronización
-- regular, la calibración cruzada (fn_clima_calibracion_cruzada) y la
-- climatología (climatologia.ts) se quedan sin datos frescos.
--
-- Cadencia diaria (no horaria): NASA POWER "casi-tiempo-real" tiene 2-7 días
-- de rezago real — pedirlo más seguido no trae dato nuevo, solo gasta cuota.
-- Body { "dias": 5 } para cubrir el rezago típico sin pedir de más; el upsert
-- en clima-historico-satelital-sync ya es idempotente por (lat,lon,fecha,proveedor).
--
-- Mismo patrón que weatherlink-sync/clima-pronostico-sync: la anon key es
-- PÚBLICA (rol 'anon', ya viaja en el frontend); la Edge Function usa el
-- service_role internamente para escribir.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Elimina un job previo con el mismo nombre (idempotente).
SELECT cron.unschedule('clima-historico-satelital-1d')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clima-historico-satelital-1d');

-- 04:20 UTC (≈22:20 hora Chihuahua del día anterior): después de que POWER
-- suele publicar la revisión del día previo, y desfasado de los otros cron de
-- clima (minuto 0 y minuto 10) para no competir por la misma ventana.
SELECT cron.schedule(
  'clima-historico-satelital-1d',
  '20 4 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/clima-historico-satelital-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{"dias": 5}'::jsonb
  );
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver el job creado:      SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'clima-historico-satelital-1d';
-- Ver ejecuciones/errores: SELECT status, return_message, start_time
--                          FROM cron.job_run_details WHERE jobid =
--                            (SELECT jobid FROM cron.job WHERE jobname='clima-historico-satelital-1d')
--                          ORDER BY start_time DESC LIMIT 5;
-- Ver histórico reciente:  SELECT fecha, rad_solar_sat_wm2, eto_sat_mm
--                          FROM clima_historico_satelital ORDER BY fecha DESC LIMIT 10;
