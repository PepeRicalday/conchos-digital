-- ═══════════════════════════════════════════════════════════════════════════
-- CRON: sincronización mensual de geometría de vaso (NDWI Sentinel-2)
-- Fecha: 2026-08-23
--
-- Programa sentinel-ndwi-vaso-sync para ejecutarse el día 1 de cada mes vía
-- pg_cron + pg_net, mismo patrón que weatherlink-sync (20260718110000) y
-- clima-historico-satelital-sync (20260808120000).
--
-- Cadencia MENSUAL, no diaria: el área/perímetro del vaso no cambia de forma
-- perceptible día a día (a diferencia de clima o niveles de escala), y cada
-- corrida consume processing units de Sentinel Hub. El backfill marzo-julio
-- 2026 ya se corrió a mano invocando la función con { mes: "2026-0N" }; este
-- cron cubre agosto en adelante sin intervención manual, usando la ventana
-- de "últimos 30 días" (sin parámetro "mes") en cada corrida.
--
-- Corre el día 3 (no el 1) a las 07:00 UTC — 2 días de margen sobre el cierre
-- del mes para que el Catalog API de Sentinel Hub tenga tiempo de indexar
-- escenas de los últimos días del mes anterior, mismo criterio de holgura
-- que clima-historico-satelital-sync usó para NASA POWER.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Elimina un job previo con el mismo nombre (idempotente).
SELECT cron.unschedule('ndwi-vaso-sync-mensual')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndwi-vaso-sync-mensual');

-- Día 3 de cada mes, 07:00 UTC (~01:00 hora Chihuahua). Presa fija PRE-001
-- (La Boquilla) por ahora — al agregar Las Vírgenes a BBOXES_PRESA, agregar
-- un segundo cron.schedule con su propio presa_id, no modificar este.
SELECT cron.schedule(
  'ndwi-vaso-sync-mensual',
  '0 7 3 * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-ndwi-vaso-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{"presa_id": "PRE-001"}'::jsonb
  );
  $$
);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver el job creado:      SELECT jobid, schedule, jobname FROM cron.job WHERE jobname = 'ndwi-vaso-sync-mensual';
-- Ver ejecuciones/errores: SELECT status, return_message, start_time
--                          FROM cron.job_run_details WHERE jobid =
--                            (SELECT jobid FROM cron.job WHERE jobname='ndwi-vaso-sync-mensual')
--                          ORDER BY start_time DESC LIMIT 5;
-- Ver histórico reciente:  SELECT fecha_escena, area_km2, perimetro_km, ratio_elongacion, pct_del_maximo_ciclo
--                          FROM vaso_geometria_historico WHERE presa_id='PRE-001' ORDER BY fecha_escena DESC LIMIT 6;
