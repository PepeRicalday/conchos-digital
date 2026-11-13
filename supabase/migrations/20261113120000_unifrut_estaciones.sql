-- UNIFRUT A.C. (Unión Agrícola Regional de Fruticultores del Estado de Chihuahua): Red de Estaciones Meteorológicas (REM), Cuauhtémoc, Chih.
-- Fuente TERCERA y solo contexto regional: tablas unifrut_* separadas de clima_estaciones (WeatherLink) y de jcas_*; nunca alimentan KPIs ni el IDW del distrito.
-- Catálogo generado por scripts/unifrut_generar_seed.mjs. Zona contra el contorno oficial INEGI-CONAGUA: {"fuera":29}
--   → NINGUNA cae dentro del contorno de la cuenca del Conchos; varias son colindantes (ver dist_limite_km). Sirven como contexto regional, no como red de la cuenca.
-- S/D = NULL, nunca 0. Datos provisionales. Fuente: https://www.unifrut.com.mx/rem/ (sin API; endpoints POST en /rem/includes/). Autorizado por UNIFRUT.
-- Radiación: se guarda en W/m² (CAMB imprime kW/m², ADCON W/m²). Presión: kPa del portal → hPa. Hora: etiqueta del reporte horario (1:00 … 24:00).

CREATE TABLE IF NOT EXISTS public.unifrut_estaciones (
  id_unifrut     text PRIMARY KEY,                 -- id del portal ("_qtl")
  nombre         text NOT NULL,
  municipio      text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('CAMB','ADCON')),  -- equipo; define la unidad de radiación
  latitud        numeric(9,6) NOT NULL,
  longitud       numeric(9,6) NOT NULL,
  altitud_m      numeric,
  zona           text NOT NULL CHECK (zona IN ('cuenca','salida','fuera')),
  dist_limite_km integer,                          -- distancia al contorno de la cuenca (0 si está dentro)
  sincronizar    boolean NOT NULL DEFAULT true,
  ult_fecha      date,                             -- último día completo guardado
  ult_sync_en    timestamptz,
  creada_en      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.unifrut_lecturas_diarias (
  estacion_id    text NOT NULL REFERENCES public.unifrut_estaciones(id_unifrut) ON DELETE CASCADE,
  fecha          date NOT NULL,                    -- día local COMPLETO (se omite el día en curso)
  tmax_c numeric, tmax_hora text, tmin_c numeric, tmin_hora text, tmed_c numeric,
  hr_max_pct numeric, hr_min_pct numeric,
  viento_kmh numeric, viento_max_kmh numeric, viento_dir text, viento_dir_deg numeric,
  rad_wm2        numeric,
  lluvia_mm      numeric CHECK (lluvia_mm IS NULL OR lluvia_mm >= 0),
  eto_mm         numeric CHECK (eto_mm IS NULL OR eto_mm >= 0),
  ingestado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, fecha)
);

CREATE TABLE IF NOT EXISTS public.unifrut_lecturas_horarias (
  estacion_id    text NOT NULL REFERENCES public.unifrut_estaciones(id_unifrut) ON DELETE CASCADE,
  ts             timestamptz NOT NULL,             -- fecha + etiqueta de hora en America/Chihuahua (24:00 = 00:00 del día siguiente)
  temp_c numeric, hr_pct numeric, rocio_c numeric, viento_kmh numeric, viento_max_kmh numeric, viento_dir_deg numeric,
  lluvia_mm      numeric CHECK (lluvia_mm IS NULL OR lluvia_mm >= 0),
  eto_mm numeric, rad_wm2 numeric, presion_hpa numeric,
  ingestado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, ts)
);

CREATE TABLE IF NOT EXISTS public.unifrut_sync_log (
  id          bigserial PRIMARY KEY,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  modo        text NOT NULL,
  ok          boolean NOT NULL,
  estaciones  integer NOT NULL DEFAULT 0,
  filas       integer NOT NULL DEFAULT 0,
  descartes   integer NOT NULL DEFAULT 0,
  error       text,
  duracion_ms integer
);

CREATE INDEX IF NOT EXISTS unifrut_lecturas_diarias_fecha_idx ON public.unifrut_lecturas_diarias (fecha DESC);
CREATE INDEX IF NOT EXISTS unifrut_lecturas_horarias_ts_idx ON public.unifrut_lecturas_horarias (ts DESC);

ALTER TABLE public.unifrut_estaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unifrut_lecturas_diarias   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unifrut_lecturas_horarias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unifrut_sync_log           ENABLE ROW LEVEL SECURITY;
-- Lectura pública como jcas_*; escritura solo service_role (no se crean políticas de escritura).
DROP POLICY IF EXISTS unifrut_estaciones_lectura ON public.unifrut_estaciones;
CREATE POLICY unifrut_estaciones_lectura ON public.unifrut_estaciones FOR SELECT USING (true);
DROP POLICY IF EXISTS unifrut_diarias_lectura ON public.unifrut_lecturas_diarias;
CREATE POLICY unifrut_diarias_lectura ON public.unifrut_lecturas_diarias FOR SELECT USING (true);
DROP POLICY IF EXISTS unifrut_horarias_lectura ON public.unifrut_lecturas_horarias;
CREATE POLICY unifrut_horarias_lectura ON public.unifrut_lecturas_horarias FOR SELECT USING (true);
DROP POLICY IF EXISTS unifrut_sync_log_lectura ON public.unifrut_sync_log;
CREATE POLICY unifrut_sync_log_lectura ON public.unifrut_sync_log FOR SELECT USING (true);

INSERT INTO public.unifrut_estaciones (id_unifrut, nombre, municipio, tipo, latitud, longitud, altitud_m, zona, dist_limite_km, sincronizar) VALUES
  ('_bac', 'Bachíniva, Chih.', 'BACHINIVA', 'CAMB', 28.775066, -107.246478, 1998, 'fuera', 48, true),
  ('_ojo', 'El Ojo', 'BACHINIVA', 'ADCON', 28.988626, -107.399887, NULL, 'fuera', 70, true),
  ('_lva', 'Las Varas', 'BACHINIVA', 'ADCON', 28.878828, -107.238432, 2038, 'fuera', 51, true),
  ('_bvt', 'Buena Vista', 'CARICHI', 'ADCON', 28.065187, -106.953283, NULL, 'fuera', 6, true),
  ('_101', 'Campo 101', 'CUAUHTEMOC', 'ADCON', 28.785487, -107.0058, 2021, 'fuera', 26, true),
  ('_rub', 'Col. Álvaro Obregón', 'CUAUHTEMOC', 'CAMB', 28.765722, -106.917662, 2034, 'fuera', 17, true),
  ('_hbu', 'Hacienda de Bustillos', 'CUAUHTEMOC', 'ADCON', 28.495174, -106.661162, NULL, 'fuera', 5, true),
  ('_lno', 'La Noria', 'CUAUHTEMOC', 'ADCON', 28.446138, -106.560364, NULL, 'fuera', 1, true),
  ('_qtl', 'Quinta Lupita', 'CUAUHTEMOC', 'CAMB', 28.444819, -106.87776, 2029, 'fuera', 7, true),
  ('_yam', 'San José de la Herradura', 'CUAUHTEMOC', 'CAMB', 28.432555, -107.021229, 2198, 'fuera', 19, true),
  ('_zdr', 'Zona Dorada', 'CUAUHTEMOC', 'CAMB', 28.413292, -106.828192, 2038, 'fuera', 1, true),
  ('_bas', 'Basuchil', 'GUERRERO', 'ADCON', 28.525962, -107.395839, NULL, 'fuera', 50, true),
  ('_ros', 'El Rosario', 'GUERRERO', 'CAMB', 28.453894, -107.226399, 2136, 'fuera', 36, true),
  ('_gue', 'Guerrero', 'GUERRERO', 'ADCON', 28.546587, -107.473239, NULL, 'fuera', 53, true),
  ('_lju', 'La Junta', 'GUERRERO', 'ADCON', 28.46602, -107.318928, 2098, 'fuera', 41, true),
  ('_mrc', 'Mesa Rancho Colorado', 'GUERRERO', 'ADCON', 28.60845, -107.542679, 2049, 'fuera', 58, true),
  ('_por', 'Pascual Orozco', 'GUERRERO', 'ADCON', 28.594343, -107.42873, 2106, 'fuera', 58, true),
  ('_rsa', 'Ranchos de Santiago', 'GUERRERO', 'ADCON', 28.372151, -107.246289, NULL, 'fuera', 28, true),
  ('_her', 'Tonachi', 'GUERRERO', 'CAMB', 28.388655, -107.524454, 2144, 'fuera', 35, true),
  ('_cho', 'Chopeque', 'CUSIHUIRIACHI', 'ADCON', 28.263053, -107.160844, NULL, 'fuera', 15, true),
  ('_lac', 'La Capilla', 'CUSIHUIRIACHI', 'CAMB', 28.125863, -106.936902, 2122, 'fuera', 6, true),
  ('_lmo', 'La Morenita', 'CUSIHUIRIACHI', 'ADCON', 28.290614, -106.974607, NULL, 'fuera', 10, true),
  ('_oso', 'El Oso', 'NAMIQUIPA', 'ADCON', 29.162548, -107.291774, NULL, 'fuera', 73, true),
  ('_fac', 'FACIATEC', 'NAMIQUIPA', 'ADCON', 28.95657, -107.541209, NULL, 'fuera', 81, true),
  ('_lbr', 'La Brecha "Felipe Angeles"', 'NAMIQUIPA', 'ADCON', 29.113241, -107.435031, NULL, 'fuera', 80, true),
  ('_lcr', 'Las Cruces', 'NAMIQUIPA', 'ADCON', 29.412483, -107.393557, 1881, 'fuera', 96, true),
  ('_nal', 'Namiquipa Alto "El Terrero"', 'NAMIQUIPA', 'CAMB', 29.183503, -107.376996, 1894, 'fuera', 81, true),
  ('_lal', 'Namiquipa Bajo "El Molino"', 'NAMIQUIPA', 'CAMB', 29.20442, -107.411685, 1860, 'fuera', 85, true),
  ('_osm', 'Óscar Soto Maynez', 'NAMIQUIPA', 'ADCON', 29.037127, -107.50185, NULL, 'fuera', 82, true)
ON CONFLICT (id_unifrut) DO UPDATE SET
  nombre = EXCLUDED.nombre, municipio = EXCLUDED.municipio, tipo = EXCLUDED.tipo, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
  altitud_m = EXCLUDED.altitud_m, zona = EXCLUDED.zona, dist_limite_km = EXCLUDED.dist_limite_km;

-- Estado por estación. El portal publica el día N hasta bien entrado el N+1: se tolera 3 días ("vigente"). Lo que no reporta hace > 3 días = sin dato (S/D).
CREATE OR REPLACE VIEW public.v_unifrut_estado WITH (security_invoker = true) AS
SELECT e.id_unifrut, e.nombre, e.municipio, e.tipo, e.latitud, e.longitud, e.altitud_m, e.zona, e.dist_limite_km, e.sincronizar, e.ult_fecha,
       ((now() AT TIME ZONE 'America/Chihuahua')::date - e.ult_fecha) AS dias_sin_dato,
       (e.ult_fecha IS NOT NULL AND ((now() AT TIME ZONE 'America/Chihuahua')::date - e.ult_fecha) <= 3) AS vigente
FROM public.unifrut_estaciones e;
