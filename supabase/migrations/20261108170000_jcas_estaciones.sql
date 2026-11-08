-- JCAS (Junta Central de Agua y Saneamiento de Chihuahua / UACJ): estaciones climatológicas de la cuenca del Conchos.
-- Fuente TERCERA y solo contexto: tablas jcas_* separadas de clima_estaciones (WeatherLink); nunca alimentan KPIs ni el IDW del distrito.
-- Catálogo generado por scripts/jcas_generar_seed.mjs (zona calculada contra el contorno oficial INEGI-CONAGUA). {"fuera":24,"cuenca":17,"salida":1}
-- S/D = NULL, nunca 0. Datos provisionales; fuente: portal público proyectojcas.uacj.mx (sin API oficial ni términos publicados).

CREATE TABLE IF NOT EXISTS public.jcas_estaciones (
  id_jcas          integer PRIMARY KEY,
  nombre           text NOT NULL,
  latitud          numeric(9,6) NOT NULL,
  longitud         numeric(9,6) NOT NULL,
  altitud_m        numeric,
  zona             text NOT NULL CHECK (zona IN ('cuenca','salida','fuera')),
  grupo_ciudad     text,
  tiene_pluviometro boolean NOT NULL DEFAULT false,
  sincronizar      boolean NOT NULL DEFAULT false,
  activa           boolean NOT NULL DEFAULT false,
  actualizada_portal timestamp without time zone,   -- reloj de la estación según el portal (sin zona declarada)
  ult_fecha        date,                            -- último día completo guardado
  ult_sync_en      timestamptz,
  creada_en        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jcas_lecturas_diarias (
  estacion_id  integer NOT NULL REFERENCES public.jcas_estaciones(id_jcas) ON DELETE CASCADE,
  fecha        date NOT NULL,                       -- día local de la estación, COMPLETO (se omite el día en curso)
  temp_c       numeric, hum_pct numeric, viento_kmh numeric, presion_hpa numeric, rocio_c numeric,
  lluvia_mm    numeric CHECK (lluvia_mm IS NULL OR lluvia_mm >= 0),
  ingestado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, fecha)
);

CREATE TABLE IF NOT EXISTS public.jcas_lecturas_mensuales (
  estacion_id  integer NOT NULL REFERENCES public.jcas_estaciones(id_jcas) ON DELETE CASCADE,
  mes          date NOT NULL,                       -- primer día del mes; solo meses COMPLETOS
  temp_c       numeric, hum_pct numeric, viento_kmh numeric, presion_hpa numeric, rocio_c numeric,
  lluvia_mm    numeric CHECK (lluvia_mm IS NULL OR lluvia_mm >= 0),
  ingestado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, mes)
);

CREATE TABLE IF NOT EXISTS public.jcas_sync_log (
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

CREATE INDEX IF NOT EXISTS jcas_lecturas_diarias_fecha_idx ON public.jcas_lecturas_diarias (fecha DESC);

ALTER TABLE public.jcas_estaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jcas_lecturas_diarias   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jcas_lecturas_mensuales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jcas_sync_log           ENABLE ROW LEVEL SECURITY;
-- Lectura pública como el resto de aqwp_*; escritura solo service_role (no se crean políticas de escritura).
DROP POLICY IF EXISTS jcas_estaciones_lectura ON public.jcas_estaciones;
CREATE POLICY jcas_estaciones_lectura ON public.jcas_estaciones FOR SELECT USING (true);
DROP POLICY IF EXISTS jcas_diarias_lectura ON public.jcas_lecturas_diarias;
CREATE POLICY jcas_diarias_lectura ON public.jcas_lecturas_diarias FOR SELECT USING (true);
DROP POLICY IF EXISTS jcas_mensuales_lectura ON public.jcas_lecturas_mensuales;
CREATE POLICY jcas_mensuales_lectura ON public.jcas_lecturas_mensuales FOR SELECT USING (true);
DROP POLICY IF EXISTS jcas_sync_log_lectura ON public.jcas_sync_log;
CREATE POLICY jcas_sync_log_lectura ON public.jcas_sync_log FOR SELECT USING (true);

INSERT INTO public.jcas_estaciones (id_jcas, nombre, latitud, longitud, altitud_m, zona, grupo_ciudad, tiene_pluviometro, sincronizar) VALUES
  (1, 'IIT 01', 31.743289, -106.431446, 1102, 'fuera', NULL, true, false),
  (2, 'CHIH_JCAS', 28.64, -106.078, 1415, 'cuenca', 'chihuahua', true, true),
  (3, 'Satevó', 27.956, -106.107, NULL, 'cuenca', NULL, true, true),
  (4, 'Coronado', 26.738, -105.162, 1728, 'cuenca', NULL, true, true),
  (5, 'Camargo', 27.696, -105.174, 1250, 'cuenca', NULL, true, true),
  (6, 'Parral', 26.931, -105.688, 1620, 'cuenca', NULL, true, true),
  (7, 'Valle de Zaragoza', 27.456, -105.81, 1335, 'cuenca', NULL, true, true),
  (8, 'Jiménez', 27.116, -104.898, 1680, 'cuenca', NULL, true, true),
  (9, 'Balleza', 26.953, -106.346, 2902, 'cuenca', NULL, true, true),
  (10, 'Juárez', 31.68, -106.429, 1137, 'fuera', NULL, true, false),
  (11, 'Práxedis', 31.371, -106.007, 1100, 'fuera', NULL, true, false),
  (12, 'Palomas', 31.766, -107.626, 1200, 'fuera', NULL, true, false),
  (13, 'CHIH_Potb', 28.624, -106.099, 1450, 'cuenca', 'chihuahua', true, true),
  (14, 'Ricardo F Magón', 29.947, -106.961, 1458, 'fuera', NULL, true, false),
  (15, 'Ahumada', 30.619, -106.511, 1698, 'fuera', NULL, true, false),
  (16, 'Ascensión', 31.09, -107.997, 1301, 'fuera', NULL, true, false),
  (17, 'NCG', 30.409, -107.915, 1457, 'fuera', NULL, true, false),
  (18, 'Aldama', 28.835, -105.911, 1262, 'cuenca', NULL, true, true),
  (19, 'Coyame', 29.461, -105.094, 1220, 'cuenca', NULL, true, true),
  (20, 'El Terrero', 29.18, -107.387, 1853, 'fuera', NULL, true, false),
  (21, 'Cuauhtémoc', 28.393, -106.878, 2060, 'fuera', NULL, true, false),
  (22, 'Guerrero', 28.548, -107.48, 2660, 'fuera', NULL, true, false),
  (23, 'Temósachi', 28.952, -107.829, 1360, 'fuera', NULL, false, false),
  (24, 'Madera', 29.194, -108.141, 2112, 'fuera', NULL, true, false),
  (25, 'San Juanito', 27.973, -107.6, NULL, 'cuenca', NULL, true, true),
  (26, 'Creel', 27.754, -107.635, 2350, 'fuera', NULL, true, false),
  (27, 'Témoris', 27.276, -108.279, 1420, 'fuera', NULL, true, false),
  (28, 'San Fco. de Borja', 27.901, -106.684, 1666, 'cuenca', NULL, true, true),
  (29, 'Manuel Benavides', 29.107, -103.907, 1620, 'fuera', NULL, true, false),
  (30, 'Ojinaga', 29.566, -104.406, 800, 'salida', NULL, true, true),
  (31, 'CHIH_Pcivil', 28.683, -106.082, 1415, 'cuenca', 'chihuahua', true, true),
  (32, 'Juárez Conejos Médanos', 31.723, -106.749, 1137, 'fuera', NULL, true, false),
  (33, 'Santa Isabel', 28.341, -106.399, 1619, 'cuenca', NULL, true, true),
  (34, 'Don Bosco', 31.7266667, -106.5286111111111, 1199, 'fuera', NULL, false, false),
  (35, 'UABCS CGN', 27.981667, -114.019722, NULL, 'fuera', NULL, false, false),
  (37, 'Clínica Nutrición UACJ', 31.654921, -106.466372, 1200, 'fuera', NULL, false, false),
  (38, 'San Antonio', 28.60344, -105.815866, 1587, 'cuenca', NULL, false, true),
  (39, 'Bomberos 9 Anapra', 31.773608, -106.561436, 1179, 'fuera', NULL, false, false),
  (41, 'Babicora Distrito Sur', 31.645684, -106.384297, 1108, 'fuera', NULL, false, false),
  (42, 'Campus Cuahutémoc', 28.450735, -106.794464, 2095, 'fuera', NULL, false, false),
  (44, 'Centro de Justicia Chihuahua', 28.6347778, -106.0815833, 1425, 'cuenca', 'chihuahua', false, true),
  (45, 'El Regalo', 31.511099, -107.717995, 1210, 'fuera', NULL, false, false)
ON CONFLICT (id_jcas) DO UPDATE SET
  nombre = EXCLUDED.nombre, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, altitud_m = EXCLUDED.altitud_m,
  zona = EXCLUDED.zona, grupo_ciudad = EXCLUDED.grupo_ciudad, tiene_pluviometro = EXCLUDED.tiene_pluviometro, sincronizar = EXCLUDED.sincronizar;

-- Estado por estación: último día guardado, edad del dato y si cuenta para el cálculo (dato de ≤ 48 h).
CREATE OR REPLACE VIEW public.v_jcas_estado WITH (security_invoker = true) AS
SELECT e.id_jcas, e.nombre, e.latitud, e.longitud, e.altitud_m, e.zona, e.grupo_ciudad, e.tiene_pluviometro, e.activa,
       e.sincronizar, e.actualizada_portal, e.ult_fecha,
       (CURRENT_DATE - e.ult_fecha) AS dias_sin_dato,
       (e.ult_fecha IS NOT NULL AND (CURRENT_DATE - e.ult_fecha) <= 2) AS vigente
FROM public.jcas_estaciones e;
