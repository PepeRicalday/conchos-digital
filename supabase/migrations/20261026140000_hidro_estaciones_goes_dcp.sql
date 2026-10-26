-- Estaciones hidrométricas por telemetría satelital GOES/DCP (monitor Sutron, canal 74, 1 mensaje/h).
-- Cada mensaje trae 3-4 lecturas de 15 min (más antigua primero). Se guarda el mensaje (hidro_mensajes,
-- para no repetir descargas y medir salud del enlace) y las lecturas en forma larga (hidro_lecturas).
-- Escritura solo con service_role (goes-dcp-sync); lectura pública como el resto de series.

CREATE TABLE IF NOT EXISTS public.hidro_estaciones (
  id            text PRIMARY KEY,            -- dirección DCP, p.ej. C6301416
  nombre        text NOT NULL,
  presa_id      text REFERENCES public.presas(id),
  rol           text NOT NULL DEFAULT 'rio', -- presa | rio
  latitud       numeric,                     -- NULL hasta que el usuario aporte la ubicación
  longitud      numeric,
  intervalo_min integer NOT NULL DEFAULT 15, -- separación entre lecturas dentro del mensaje
  activa        boolean NOT NULL DEFAULT true,
  notas         text,
  ult_sync_en   timestamptz,
  ult_dato_en   timestamptz,                 -- ts_msg del último mensaje bueno
  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hidro_mensajes (
  estacion_id  text NOT NULL REFERENCES public.hidro_estaciones(id) ON DELETE CASCADE,
  ts_msg       timestamptz NOT NULL,         -- hora UTC de la transmisión
  codigo_falla text NOT NULL,                -- G bueno; ? paridad; resto ver leyenda Sutron
  senal_dbm    numeric,
  longitud     integer,
  descartadas  text[],                       -- códigos de línea dañada no almacenados
  PRIMARY KEY (estacion_id, ts_msg)
);

CREATE TABLE IF NOT EXISTS public.hidro_lecturas (
  estacion_id text NOT NULL REFERENCES public.hidro_estaciones(id) ON DELETE CASCADE,
  ts_utc      timestamptz NOT NULL,          -- hora derivada de la lectura (ver tsLectura en parser.ts)
  variable    text NOT NULL,                 -- nivel_m, gasto_m3s, velocidad_ms, temp_c, ...
  valor       numeric NOT NULL,
  ts_msg      timestamptz NOT NULL,          -- mensaje de origen
  idx         smallint NOT NULL,             -- posición en el mensaje (0 = más antigua)
  PRIMARY KEY (estacion_id, ts_utc, variable)
);
CREATE INDEX IF NOT EXISTS idx_hidro_lecturas_var_ts ON public.hidro_lecturas (estacion_id, variable, ts_utc DESC);

ALTER TABLE public.hidro_estaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidro_mensajes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hidro_lecturas   ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read Hidro Estaciones" ON public.hidro_estaciones;
DROP POLICY IF EXISTS "Public Read Hidro Mensajes"   ON public.hidro_mensajes;
DROP POLICY IF EXISTS "Public Read Hidro Lecturas"   ON public.hidro_lecturas;
CREATE POLICY "Public Read Hidro Estaciones" ON public.hidro_estaciones FOR SELECT USING (true);
CREATE POLICY "Public Read Hidro Mensajes"   ON public.hidro_mensajes   FOR SELECT USING (true);
CREATE POLICY "Public Read Hidro Lecturas"   ON public.hidro_lecturas   FOR SELECT USING (true);

-- Babisas y Boca del Río: aguas de La Boquilla; Francisco y Madero: Las Vírgenes (presa Madero).
-- Ojinaga sin presa asignada. Ubicación solo de Madero-Las Vírgenes por ahora (27°54'52.14"N 105°57'46.82"O).
INSERT INTO public.hidro_estaciones (id, nombre, presa_id, rol, latitud, longitud, notas) VALUES
  ('C6300760', 'Ojinaga',               NULL,      'rio',   NULL, NULL, 'Formato propio: N1/GR/VL, 4 lecturas por mensaje.'),
  ('C63009B2', 'Boca del Río',          'PRE-001', 'presa', NULL, NULL, NULL),
  ('C6301416', 'Babisas',               'PRE-001', 'presa', NULL, NULL, 'GR=0.00 con nivel ~6.2 m en varias horas: posible corte de curva de gasto, sin confirmar.'),
  ('C6301AC4', 'Francisco y Madero - Vírgenes', 'PRE-002', 'presa', 27.914483, -105.962994, NULL)
ON CONFLICT (id) DO NOTHING;

-- Secreto del cron (mismo patrón que sentinel-ndvi-modulo-sync-v2).
INSERT INTO public.cron_secretos (nombre, valor)
VALUES ('goes_dcp_sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (nombre) DO NOTHING;

SELECT cron.unschedule('goes-dcp-sync-horario')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'goes-dcp-sync-horario');

SELECT cron.schedule(
  'goes-dcp-sync-horario',
  '35 * * * *',   -- las estaciones transmiten en :28; margen para que Sutron compile el mensaje
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/goes-dcp-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'goes_dcp_sync')
    ),
    body    := '{}'::jsonb
  );
  $$
);
