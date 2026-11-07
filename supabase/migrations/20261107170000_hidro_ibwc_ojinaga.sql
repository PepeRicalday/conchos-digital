-- Estación «Water Data USA» = USIBWC 08373000 Rio Conchos near Ojinaga (TelemetryTXT, 15 min, CST). Se guarda 1 lectura cada 2 h (intervalo_min=120).
-- Misma tabla hidro_* que las estaciones Sutron; ingesta propia: edge function ibwc-telemetry-sync.
-- id = 'IBWC-<sitio>' (la función deduce la URL del sitio por el prefijo). Sin presa, rol 'rio'.
-- Coordenadas pendientes de confirmar (el sitio coincide con Ojinaga Sutron C6300760).

INSERT INTO public.hidro_estaciones (id, nombre, presa_id, rol, latitud, longitud, intervalo_min, notas) VALUES
  ('IBWC-08373000', 'Water Data USA', NULL, 'rio', NULL, NULL, 120,
   'Fuente oficial USIBWC (TelemetryTXT), nivel y gasto, ventana móvil 30 d, hora CST, datos provisionales. Mismo sitio que Ojinaga Sutron C6300760: el gasto de Sutron difiere mucho (06-nov-2026: 89.9 vs 1.6 m3/s).')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cron_secretos (nombre, valor)
VALUES ('ibwc_telemetry_sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (nombre) DO NOTHING;

SELECT cron.unschedule('ibwc-telemetry-sync-2h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ibwc-telemetry-sync-2h');

SELECT cron.schedule(
  'ibwc-telemetry-sync-2h',
  '10 */2 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/ibwc-telemetry-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'ibwc_telemetry_sync')
    ),
    body    := '{}'::jsonb
  );
  $$
);
