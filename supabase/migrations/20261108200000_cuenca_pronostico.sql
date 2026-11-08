-- Pronóstico de toda la cuenca del Conchos (contexto, fuente TERCERA: Open-Meteo con 3 modelos).
-- Tablas APARTE de clima_* (WeatherLink): clima_pronostico_* tienen FK a clima_estaciones y alimentan hook, alertas agro e informes del distrito.
-- Un punto = una estación JCAS o una estación propia; el pronóstico se pide en SUS coordenadas y se verifica contra lo que midió JCAS.
-- Snapshot por corrida (retención 120 días en la función) para verificar con la anticipación real. S/D = NULL, nunca 0.

CREATE TABLE IF NOT EXISTS public.cuenca_puntos (
  id               text PRIMARY KEY,                -- 'jcas:5' | 'wl:<uuid>'
  nombre           text NOT NULL,
  fuente           text NOT NULL CHECK (fuente IN ('jcas','weatherlink')),
  latitud          numeric(9,6) NOT NULL,
  longitud         numeric(9,6) NOT NULL,
  elevacion_dem_m  numeric,
  grupo_ciudad     text,
  zona             text NOT NULL DEFAULT 'cuenca' CHECK (zona IN ('cuenca','salida')),
  activo           boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.cuenca_pronostico_diario (
  punto_id          text NOT NULL REFERENCES public.cuenca_puntos(id) ON DELETE CASCADE,
  modelo            text NOT NULL,                  -- ecmwf_ifs025 | gfs_seamless | icon_seamless
  corrida_en        timestamptz NOT NULL,           -- hora de la consulta, truncada a la hora
  fecha             date NOT NULL,                  -- día local America/Chihuahua
  precip_mm         numeric CHECK (precip_mm IS NULL OR precip_mm >= 0),
  precip_prob_pct   numeric,
  temp_media_c      numeric, temp_max_c numeric, temp_min_c numeric,
  hum_media_pct     numeric,
  viento_medio_kmh  numeric CHECK (viento_medio_kmh IS NULL OR viento_medio_kmh >= 0),
  PRIMARY KEY (punto_id, modelo, corrida_en, fecha)
);
CREATE INDEX IF NOT EXISTS cuenca_pronostico_fecha_idx ON public.cuenca_pronostico_diario (fecha, punto_id);

CREATE TABLE IF NOT EXISTS public.cuenca_pronostico_log (
  id bigserial PRIMARY KEY,
  creado_en timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL, puntos integer NOT NULL DEFAULT 0, modelos integer NOT NULL DEFAULT 0, filas integer NOT NULL DEFAULT 0,
  error text, duracion_ms integer
);

ALTER TABLE public.cuenca_puntos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuenca_pronostico_diario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuenca_pronostico_log     ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cuenca_puntos_lectura ON public.cuenca_puntos;
CREATE POLICY cuenca_puntos_lectura ON public.cuenca_puntos FOR SELECT USING (true);
DROP POLICY IF EXISTS cuenca_pron_lectura ON public.cuenca_pronostico_diario;
CREATE POLICY cuenca_pron_lectura ON public.cuenca_pronostico_diario FOR SELECT USING (true);
DROP POLICY IF EXISTS cuenca_pron_log_lectura ON public.cuenca_pronostico_log;
CREATE POLICY cuenca_pron_log_lectura ON public.cuenca_pronostico_log FOR SELECT USING (true);

-- Puntos: las estaciones JCAS sincronizadas y las estaciones propias activas.
INSERT INTO public.cuenca_puntos (id, nombre, fuente, latitud, longitud, elevacion_dem_m, grupo_ciudad, zona)
SELECT 'jcas:' || id_jcas, nombre, 'jcas', latitud, longitud, elevacion_dem_m, grupo_ciudad, CASE WHEN zona = 'salida' THEN 'salida' ELSE 'cuenca' END
FROM public.jcas_estaciones WHERE sincronizar
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
  elevacion_dem_m = COALESCE(EXCLUDED.elevacion_dem_m, public.cuenca_puntos.elevacion_dem_m), grupo_ciudad = EXCLUDED.grupo_ciudad, zona = EXCLUDED.zona;

INSERT INTO public.cuenca_puntos (id, nombre, fuente, latitud, longitud)
SELECT 'wl:' || id, nombre, 'weatherlink', latitud, longitud FROM public.clima_estaciones WHERE activa AND latitud IS NOT NULL AND longitud IS NOT NULL
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud;

-- Pronóstico vigente: la última corrida de cada punto y modelo, de hoy en adelante.
CREATE OR REPLACE VIEW public.v_cuenca_pronostico_vigente WITH (security_invoker = true) AS
SELECT DISTINCT ON (d.punto_id, d.modelo, d.fecha) d.*
FROM public.cuenca_pronostico_diario d
WHERE d.fecha >= (now() AT TIME ZONE 'America/Chihuahua')::date
ORDER BY d.punto_id, d.modelo, d.fecha, d.corrida_en DESC;

-- Verificación contra lo observado por JCAS (promedios diarios). Se usa el pronóstico "de víspera": la última corrida emitida ANTES de que
-- empezara el día local; el consenso es la mediana de los modelos y la probabilidad de lluvia la proporción de modelos con ≥ umbral.
-- Lluvia: tabla de contingencia (POD, FAR, Brier). Temperatura media y viento medio: MAE y sesgo (pronóstico − observado).
-- No se verifican máximas/mínimas (JCAS no las da) ni nubosidad.
CREATE OR REPLACE FUNCTION public.fn_cuenca_verificacion(p_dias integer DEFAULT 30, p_umbral_mm numeric DEFAULT 1)
RETURNS TABLE (
  punto_id text, nombre text, n_dias integer, aciertos integer, omisiones integer, falsas_alarmas integer, correctos_negativos integer,
  pod numeric, far numeric, brier numeric, mm_fc_medio numeric, mm_obs_medio numeric,
  n_temp integer, temp_mae numeric, temp_sesgo numeric, n_viento integer, viento_mae numeric, viento_sesgo numeric
)
LANGUAGE sql STABLE SET search_path = public AS $$
WITH fc AS (
  SELECT DISTINCT ON (d.punto_id, d.modelo, d.fecha) d.punto_id, d.modelo, d.fecha, d.precip_mm, d.temp_media_c, d.viento_medio_kmh
  FROM cuenca_pronostico_diario d
  WHERE d.fecha >= (now() AT TIME ZONE 'America/Chihuahua')::date - p_dias
    AND d.corrida_en < ((d.fecha::timestamp) AT TIME ZONE 'America/Chihuahua')
  ORDER BY d.punto_id, d.modelo, d.fecha, d.corrida_en DESC
), cons AS (
  SELECT punto_id, fecha,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY precip_mm))::numeric AS mm,
    avg((precip_mm >= p_umbral_mm)::int) AS prob,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY temp_media_c))::numeric AS t,
    (percentile_cont(0.5) WITHIN GROUP (ORDER BY viento_medio_kmh))::numeric AS w
  FROM fc GROUP BY punto_id, fecha
), par AS (
  SELECT c.punto_id, c.fecha, c.mm, c.prob, c.t, c.w, o.lluvia_mm, o.temp_c, o.viento_kmh
  FROM cons c JOIN jcas_lecturas_diarias o ON 'jcas:' || o.estacion_id = c.punto_id AND o.fecha = c.fecha
)
SELECT p.punto_id, pu.nombre,
  count(*) FILTER (WHERE p.lluvia_mm IS NOT NULL AND p.mm IS NOT NULL)::int,
  count(*) FILTER (WHERE p.lluvia_mm >= p_umbral_mm AND p.mm >= p_umbral_mm)::int,
  count(*) FILTER (WHERE p.lluvia_mm >= p_umbral_mm AND p.mm < p_umbral_mm)::int,
  count(*) FILTER (WHERE p.lluvia_mm < p_umbral_mm AND p.mm >= p_umbral_mm)::int,
  count(*) FILTER (WHERE p.lluvia_mm < p_umbral_mm AND p.mm < p_umbral_mm)::int,
  round((count(*) FILTER (WHERE p.lluvia_mm >= p_umbral_mm AND p.mm >= p_umbral_mm))::numeric
    / NULLIF(count(*) FILTER (WHERE p.lluvia_mm >= p_umbral_mm AND p.mm IS NOT NULL), 0), 3),
  round((count(*) FILTER (WHERE p.lluvia_mm < p_umbral_mm AND p.mm >= p_umbral_mm))::numeric
    / NULLIF(count(*) FILTER (WHERE p.mm >= p_umbral_mm AND p.lluvia_mm IS NOT NULL), 0), 3),
  round(avg(power(p.prob - (p.lluvia_mm >= p_umbral_mm)::int, 2)) FILTER (WHERE p.lluvia_mm IS NOT NULL AND p.prob IS NOT NULL), 4),
  round(avg(p.mm) FILTER (WHERE p.lluvia_mm IS NOT NULL), 2), round(avg(p.lluvia_mm), 2),
  count(*) FILTER (WHERE p.temp_c IS NOT NULL AND p.t IS NOT NULL)::int,
  round(avg(abs(p.t - p.temp_c)) FILTER (WHERE p.temp_c IS NOT NULL AND p.t IS NOT NULL), 2),
  round(avg(p.t - p.temp_c) FILTER (WHERE p.temp_c IS NOT NULL AND p.t IS NOT NULL), 2),
  count(*) FILTER (WHERE p.viento_kmh IS NOT NULL AND p.w IS NOT NULL)::int,
  round(avg(abs(p.w - p.viento_kmh)) FILTER (WHERE p.viento_kmh IS NOT NULL AND p.w IS NOT NULL), 2),
  round(avg(p.w - p.viento_kmh) FILTER (WHERE p.viento_kmh IS NOT NULL AND p.w IS NOT NULL), 2)
FROM par p JOIN cuenca_puntos pu ON pu.id = p.punto_id
GROUP BY p.punto_id, pu.nombre
ORDER BY pu.nombre;
$$;
