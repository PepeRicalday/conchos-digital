-- ═══════════════════════════════════════════════════════════════════════════
-- Catálogo de cuencas y cuerpos de agua (macromedición de cuenca, etapa 1)
-- Fecha: 2026-11-11
--
-- Hasta hoy las presas colgaban del distrito 005 (tabla `presas`, PRE-001/002) o del portal
-- AQWP (`aqwp_ubicaciones`). Este catálogo las cuelga de una CUENCA y da a cada cuerpo de agua
-- un id propio con UNA COLUMNA POR SISTEMA EXTERNO (SINA, AQWP, inventario/KMZ, presa operativa).
-- El resto del estado entra después como filas nuevas, no como código nuevo.
--
-- No sustituye ni modifica `presas`, `aqwp_*`, `presas_historico_diario` ni `lecturas_presas*`.
-- Regla S/D: lo que no tiene fuente es NULL, jamás 0.
-- Sin PostGIS: los polígonos van en JSONB (GeoJSON), igual que vaso_geometria_historico.contorno_geojson.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cuencas (
  id                  text PRIMARY KEY,                 -- 'RH24-CONCHOS', 'RH24-CONCHOS-FLORIDO'
  nombre              text NOT NULL,
  nivel               text NOT NULL CHECK (nivel IN ('cuenca', 'subcuenca')),
  padre_id            text REFERENCES public.cuencas (id),
  region_hidrologica  text,                             -- 'RH24 Bravo-Conchos'
  estados             text[] NOT NULL DEFAULT '{}',
  salida              text,                             -- a dónde descarga
  geojson_url         text,                             -- contorno estático en /public (si existe)
  orden               integer NOT NULL DEFAULT 0,
  nota                text
);

CREATE TABLE IF NOT EXISTS public.cuerpos_agua (
  id                  text PRIMARY KEY,                 -- 'CA-LBQCH' (clave SIH si existe; si no, nombre: 'CA-COLINA')
  nombre              text NOT NULL,                    -- nombre corto de interfaz
  nombre_oficial      text,
  tambien_llamada     text,
  etiqueta            text NOT NULL,                    -- lleva el estado solo si no es Chihuahua ("San Gabriel, Dgo.")
  rol                 text NOT NULL DEFAULT 'almacenamiento' CHECK (rol IN ('almacenamiento', 'reguladora', 'derivadora')),
  cuenca_id           text NOT NULL REFERENCES public.cuencas (id),
  corriente           text,
  estado              text,
  municipio           text,
  uso                 text,                             -- clave SINA: RI riego, GH generación, AP agua potable
  distrito_riego      text,
  latitud             numeric,                          -- cortina (SINA) o centroide del vaso
  longitud            numeric,
  coordenadas_fuente  text,
  -- Una columna por sistema externo (todas opcionales).
  clave_sih           text UNIQUE,                      -- SINA / SIH CONAGUA: LBQCH
  clave_inventario    text UNIQUE,                      -- 4 dígitos del inventario de presas (nombre del KMZ): 0750
  aqwp_ubicacion_id   integer UNIQUE REFERENCES public.aqwp_ubicaciones (id_number),
  presa_id            text UNIQUE REFERENCES public.presas (id),   -- solo presas operativas del distrito
  -- Clave bajo la que viven sus series satelitales y de curva (vaso_geometria_historico, curvas_capacidad):
  -- las presas del distrito conservan PRE-00x y no hay que migrar nada.
  id_serie            text GENERATED ALWAYS AS (COALESCE(presa_id, id)) STORED,
  -- Red de nodos mínima: a qué cuerpo de agua descarga (NULL = descarga a la salida de la cuenca).
  aguas_abajo_id      text REFERENCES public.cuerpos_agua (id),
  orden_red           integer NOT NULL DEFAULT 0,       -- de aguas arriba a aguas abajo, para ordenar
  -- NAMO declarado: el denominador de TODOS los % de este cuerpo en las vistas de cuenca.
  namo_ref_mm3        numeric,
  namo_ref_fuente     text,
  -- Medición satelital del espejo (edge function sentinel-ndwi-vaso-sync).
  satelite_activo     boolean NOT NULL DEFAULT false,
  ndwi_bbox           jsonb,                            -- [oeste, sur, este, norte]
  ndwi_ancla_lon      numeric,                          -- punto con agua casi siempre (junto a la cortina)
  ndwi_ancla_lat      numeric,
  huella_modo         text NOT NULL DEFAULT 'kmz' CHECK (huella_modo IN ('kmz', 'escena_max')),
  dilatacion_huella_m integer NOT NULL DEFAULT 150,
  activo              boolean NOT NULL DEFAULT true,
  nota                text,
  creado_en           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cuerpos_agua_cuenca ON public.cuerpos_agua (cuenca_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cuerpos_agua_id_serie ON public.cuerpos_agua (id_serie);

-- NAMO / NAME por fuente y vigencia (las fuentes difieren y cambian con cada batimetría).
CREATE TABLE IF NOT EXISTS public.cuerpos_agua_caracteristicas (
  cuerpo_id     text NOT NULL REFERENCES public.cuerpos_agua (id) ON DELETE CASCADE,
  fuente        text NOT NULL CHECK (fuente IN ('SINA', 'AQWP', 'SRL', 'KMZ')),
  vigente_desde date NOT NULL,
  namo_mm3      numeric,
  namo_msnm     numeric,
  name_mm3      numeric,
  name_msnm     numeric,
  muerto_mm3    numeric,
  corona_msnm   numeric,
  nota          text,
  PRIMARY KEY (cuerpo_id, fuente, vigente_desde)
);

-- Polígonos del vaso. 'huella_maxima' = contorno a nivel de diseño (NAME), tope del NDWI; NO es el espejo de hoy.
CREATE TABLE IF NOT EXISTS public.cuerpos_agua_geometria (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cuerpo_id          text NOT NULL REFERENCES public.cuerpos_agua (id) ON DELETE CASCADE,
  tipo               text NOT NULL DEFAULT 'huella_maxima' CHECK (tipo IN ('huella_maxima')),
  fuente             text NOT NULL,
  archivo            text,
  sha256             text NOT NULL,
  descripcion_origen text,                              -- <description> del KMZ, tal cual
  geojson            jsonb NOT NULL,                    -- Polygon; anillo exterior antihorario + islas como huecos
  area_km2           numeric NOT NULL,                  -- agua: exterior menos islas
  perimetro_km       numeric,
  vertices           integer,
  num_islas          integer NOT NULL DEFAULT 0,
  area_islas_km2     numeric NOT NULL DEFAULT 0,
  bbox               jsonb NOT NULL,                    -- [oeste, sur, este, norte]
  centroide_lon      numeric,
  centroide_lat      numeric,
  vigente            boolean NOT NULL DEFAULT true,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cuerpo_id, tipo, sha256)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cuerpos_agua_geometria_vigente
  ON public.cuerpos_agua_geometria (cuerpo_id, tipo) WHERE vigente;

ALTER TABLE public.cuencas                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuerpos_agua                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuerpos_agua_caracteristicas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuerpos_agua_geometria        ENABLE ROW LEVEL SECURITY;

-- Lectura pública (mismo criterio que aqwp_*). Escritura solo service_role (sin política).
DROP POLICY IF EXISTS "Public Read cuencas" ON public.cuencas;
CREATE POLICY "Public Read cuencas" ON public.cuencas FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public Read cuerpos_agua" ON public.cuerpos_agua;
CREATE POLICY "Public Read cuerpos_agua" ON public.cuerpos_agua FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public Read cuerpos_agua_caracteristicas" ON public.cuerpos_agua_caracteristicas;
CREATE POLICY "Public Read cuerpos_agua_caracteristicas" ON public.cuerpos_agua_caracteristicas FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public Read cuerpos_agua_geometria" ON public.cuerpos_agua_geometria;
CREATE POLICY "Public Read cuerpos_agua_geometria" ON public.cuerpos_agua_geometria FOR SELECT USING (true);

COMMENT ON TABLE public.cuerpos_agua IS
  'Catálogo único de cuerpos de agua por cuenca. Una columna por sistema externo (clave_sih, clave_inventario, aqwp_ubicacion_id, presa_id). id_serie = clave de sus series satelitales y de curva.';
COMMENT ON COLUMN public.cuerpos_agua.namo_ref_mm3 IS
  'NAMO declarado para el % de llenado en vistas de cuenca. Las pantallas operativas del distrito siguen usando presas.capacidad_max.';
COMMENT ON COLUMN public.cuerpos_agua.aguas_abajo_id IS
  'Cuerpo de agua al que descarga. Topología inicial por confirmar con CONAGUA; NULL = descarga a la salida de la cuenca (aforo Ojinaga).';

-- ── Siembra ────────────────────────────────────────────────────────────────
INSERT INTO public.cuencas (id, nombre, nivel, padre_id, region_hidrologica, estados, salida, geojson_url, orden, nota) VALUES
('RH24-CONCHOS',           'Río Conchos',                 'cuenca',    NULL,           'RH24 Bravo-Conchos', '{Chihuahua,Durango}', 'Río Bravo en Ojinaga', '/geo/cuenca_conchos.geojson', 1, 'Única cuenca de Chihuahua que entrega al Tratado de 1944.'),
('RH24-CONCHOS-PRINCIPAL', 'Conchos (cauce principal)',   'subcuenca', 'RH24-CONCHOS', 'RH24 Bravo-Conchos', '{Chihuahua}',         'Río Bravo en Ojinaga', NULL, 1, 'Agrupación operativa, no la subdivisión oficial INEGI.'),
('RH24-CONCHOS-FLORIDO',   'Río Florido',                 'subcuenca', 'RH24-CONCHOS', 'RH24 Bravo-Conchos', '{Chihuahua,Durango}', 'Río Conchos',          NULL, 2, 'Agrupación operativa, no la subdivisión oficial INEGI.'),
('RH24-CONCHOS-PARRAL',    'Río Parral',                  'subcuenca', 'RH24-CONCHOS', 'RH24 Bravo-Conchos', '{Chihuahua}',         'Río Florido',          NULL, 3, 'Agrupación operativa, no la subdivisión oficial INEGI.'),
('RH24-CONCHOS-SANPEDRO',  'Río San Pedro',               'subcuenca', 'RH24-CONCHOS', 'RH24 Bravo-Conchos', '{Chihuahua}',         'Río Conchos',          NULL, 4, 'Agrupación operativa, no la subdivisión oficial INEGI.'),
('RH24-CONCHOS-CHUVISCAR', 'Río Chuvíscar',               'subcuenca', 'RH24-CONCHOS', 'RH24 Bravo-Conchos', '{Chihuahua}',         'Río Conchos',          NULL, 5, 'Agrupación operativa, no la subdivisión oficial INEGI.')
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, nivel = EXCLUDED.nivel, padre_id = EXCLUDED.padre_id,
  estados = EXCLUDED.estados, salida = EXCLUDED.salida, geojson_url = EXCLUDED.geojson_url, orden = EXCLUDED.orden, nota = EXCLUDED.nota;

-- Ficha: SINA CONAGUA (reporte del 2025-04-23) salvo La Colina, que no está en SINA ni en AQWP.
-- NAMO declarado = el vigente que publican AQWP y SINA (coinciden desde 2023); Piedras Azules solo SINA.
-- Se insertan primero sin aguas_abajo_id (autorreferencia) y luego se enlaza la red.
INSERT INTO public.cuerpos_agua
  (id, nombre, nombre_oficial, tambien_llamada, etiqueta, rol, cuenca_id, corriente, estado, municipio, uso, distrito_riego,
   latitud, longitud, coordenadas_fuente, clave_sih, clave_inventario, aqwp_ubicacion_id, presa_id, orden_red,
   namo_ref_mm3, namo_ref_fuente, huella_modo, nota)
VALUES
('CA-SGBDR', 'San Gabriel', 'San Gabriel, Dgo.', 'Federalismo Mexicano', 'San Gabriel, Dgo.', 'almacenamiento', 'RH24-CONCHOS-FLORIDO', 'Río Florido', 'Durango', 'Ocampo', 'RI', 'DR-103 Río Florido',
  26.436667, -105.560833, 'SINA (cortina)', 'SGBDR', '1035', 541, NULL, 10, 245.431, 'AQWP/SINA vigente', 'kmz', NULL),
('CA-PAGCH', 'Pico del Águila', 'Pico del Águila, Chih.', NULL, 'Pico del Águila', 'almacenamiento', 'RH24-CONCHOS-FLORIDO', 'Río Florido', 'Chihuahua', 'Coronado', 'RI', 'DR-103 Río Florido',
  26.546389, -105.254167, 'SINA (cortina)', 'PAGCH', '0867', 540, NULL, 20, 48.276, 'AQWP/SINA vigente', 'kmz', NULL),
('CA-PAZCH', 'Piedras Azules', 'Piedras Azules, Chih.', NULL, 'Piedras Azules', 'almacenamiento', 'RH24-CONCHOS-PARRAL', 'Río Parral', 'Chihuahua', 'Allende', 'RI', NULL,
  27.249167, -105.211111, 'SINA (cortina)', 'PAZCH', '4297', NULL, NULL, 30, 8.712, 'SINA', 'kmz', 'Sin serie en AQWP: almacenamiento S/D desde mayo de 2025 (el portal SINA dejó de actualizarse el 2025-04-23).'),
('CA-LBQCH', 'La Boquilla', 'La Boquilla, Chih.', 'Lago Toronto', 'La Boquilla', 'almacenamiento', 'RH24-CONCHOS-PRINCIPAL', 'Río Conchos', 'Chihuahua', 'San Francisco de Conchos', 'GH/RI', 'DR-005 Delicias',
  27.544722, -105.414167, 'SINA (cortina)', 'LBQCH', '0750', 536, 'PRE-001', 40, 2846.78, 'AQWP/SINA vigente', 'escena_max', 'Huella satelital en modo escena_max hasta validar la huella KMZ contra sus escenas v2.'),
('CA-COLINA', 'La Colina', 'Ing. Andrew Weiss', 'Lago Colina', 'La Colina', 'reguladora', 'RH24-CONCHOS-PRINCIPAL', 'Río Conchos', 'Chihuahua', NULL, NULL, 'DR-005 Delicias',
  NULL, NULL, NULL, NULL, '0783', NULL, NULL, 50, NULL, NULL, 'kmz', 'Sin telemetría: no está en SINA ni en AQWP. Almacenamiento y elevación S/D; solo área satelital.'),
('CA-FIMCH', 'Francisco I. Madero', 'Las Vírgenes, Chih.', 'Las Vírgenes', 'F. I. Madero', 'almacenamiento', 'RH24-CONCHOS-SANPEDRO', 'Río San Pedro', 'Chihuahua', 'Rosales', 'RI', 'DR-005 Delicias',
  28.166111, -105.628889, 'SINA (cortina)', 'FIMCH', '0813', 537, 'PRE-002', 60, 333.318, 'AQWP/SINA vigente', 'kmz', NULL),
('CA-CHUCH', 'Chihuahua', 'Chihuahua, Chih.', NULL, 'Chihuahua', 'almacenamiento', 'RH24-CONCHOS-CHUVISCAR', 'Río Chuvíscar', 'Chihuahua', 'Chihuahua', 'AP', NULL,
  28.570556, -106.167778, 'SINA (cortina)', 'CHUCH', '0777', 538, NULL, 70, 23.383, 'AQWP/SINA vigente', 'kmz', NULL),
('CA-ERECH', 'El Rejón', 'El Rejón, Chih.', NULL, 'El Rejón', 'almacenamiento', 'RH24-CONCHOS-CHUVISCAR', 'Arroyo El Rejón', 'Chihuahua', 'Chihuahua', 'AP', NULL,
  28.614722, -106.119444, 'SINA (cortina)', 'ERECH', '0881', 539, NULL, 80, 6.528, 'AQWP/SINA vigente', 'kmz', NULL),
('CA-LLNCH', 'Luis L. León', 'El Granero, Chih.', 'El Granero', 'Luis L. León', 'almacenamiento', 'RH24-CONCHOS-PRINCIPAL', 'Río Conchos', 'Chihuahua', 'Aldama', 'RI', 'DR-090 Bajo Río Conchos',
  28.984444, -105.28, 'SINA (cortina)', 'LLNCH', '0825', 526, NULL, 90, 284.382, 'AQWP/SINA vigente', 'kmz', 'Última presa antes de la salida de la cuenca (aforo Ojinaga, AQWP 230).')
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre, nombre_oficial = EXCLUDED.nombre_oficial, tambien_llamada = EXCLUDED.tambien_llamada, etiqueta = EXCLUDED.etiqueta,
  rol = EXCLUDED.rol, cuenca_id = EXCLUDED.cuenca_id, corriente = EXCLUDED.corriente, estado = EXCLUDED.estado, municipio = EXCLUDED.municipio,
  uso = EXCLUDED.uso, distrito_riego = EXCLUDED.distrito_riego, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
  coordenadas_fuente = EXCLUDED.coordenadas_fuente, clave_sih = EXCLUDED.clave_sih, clave_inventario = EXCLUDED.clave_inventario,
  aqwp_ubicacion_id = EXCLUDED.aqwp_ubicacion_id, presa_id = EXCLUDED.presa_id, orden_red = EXCLUDED.orden_red,
  namo_ref_mm3 = EXCLUDED.namo_ref_mm3, namo_ref_fuente = EXCLUDED.namo_ref_fuente, nota = EXCLUDED.nota;

-- Red (por confirmar con CONAGUA): Florido y Parral entran al Conchos aguas abajo de La Colina;
-- San Pedro y Chuvíscar, antes de Luis L. León. Ninguna presa del catálogo alimenta a La Boquilla.
UPDATE public.cuerpos_agua c SET aguas_abajo_id = r.abajo
FROM (VALUES
  ('CA-SGBDR', 'CA-PAGCH'), ('CA-PAGCH', 'CA-LLNCH'), ('CA-PAZCH', 'CA-LLNCH'),
  ('CA-LBQCH', 'CA-COLINA'), ('CA-COLINA', 'CA-LLNCH'), ('CA-FIMCH', 'CA-LLNCH'),
  ('CA-CHUCH', 'CA-LLNCH'), ('CA-ERECH', 'CA-LLNCH')
) AS r(id, abajo)
WHERE c.id = r.id;
