-- ═══════════════════════════════════════════════════════════════════════════
-- Cola reanudable de backfill de escenas NDWI por cuerpo de agua y mes   Fecha: 2026-11-11
--
-- fn_vaso_backfill_siguiente(desde, hasta): el siguiente par (cuerpo, mes) SIN escena vigente v2 ese mes, del mes más
-- reciente al más antiguo. Un par que acaba de fallar por falta de escena limpia no se repite en 7 días; uno en curso
-- no se repite en 1 h. La Boquilla queda fuera (ya tiene sus escenas; su método no se toca).
-- El cron temporal ndwi-vaso-backfill (cada 3 min) lo consume de a UNO: no satura Sentinel ni la función.
-- Cuando la cola se vacía el cron no hace nada; se desprograma con cron.unschedule('ndwi-vaso-backfill').
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_vaso_backfill_siguiente(p_desde date, p_hasta date)
RETURNS TABLE (id_serie text, mes text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT c.id_serie, to_char(m, 'YYYY-MM')
  FROM public.cuerpos_agua c
  CROSS JOIN generate_series(date_trunc('month', p_hasta::timestamp), date_trunc('month', p_desde::timestamp), interval '-1 month') AS m
  WHERE c.activo AND c.satelite_activo AND c.id_serie <> 'PRE-001'
    AND NOT EXISTS (
      SELECT 1 FROM public.vaso_geometria_historico g
      WHERE g.presa_id = c.id_serie AND g.vigente AND g.metodo = 'v2' AND NOT g.es_referencia_historica
        AND g.fecha_escena >= m AND g.fecha_escena < m + interval '1 month')
    AND NOT EXISTS (
      SELECT 1 FROM public.vaso_sync_log l
      WHERE l.cuerpo_id = c.id_serie AND l.mes = to_char(m, 'YYYY-MM')
        AND ((l.resultado IN ('sin_escena', 'sin_escena_limpia', 'toca_borde', 'error_analisis') AND l.creado_en >= now() - interval '7 days')
             OR l.creado_en >= now() - interval '1 hour'))
  ORDER BY m DESC, c.orden_red
  LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.fn_vaso_backfill_siguiente(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_vaso_backfill_siguiente(date, date) TO service_role;

SELECT cron.unschedule('ndwi-vaso-backfill') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ndwi-vaso-backfill');
SELECT cron.schedule(
  'ndwi-vaso-backfill',
  '*/3 * * * *',
  $cmd$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-ndwi-vaso-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'vaso_sync_cron_secret')
    ),
    body    := jsonb_build_object('presa_id', s.id_serie, 'mes', s.mes),
    timeout_milliseconds := 150000
  )
  FROM public.fn_vaso_backfill_siguiente(DATE '2026-03-01', DATE '2026-10-01') s;
  $cmd$
);
