#!/usr/bin/env node
/**
 * Genera supabase/migrations/20261113120000_unifrut_estaciones.sql: esquema unifrut_* + catálogo de las 29 estaciones REM de UNIFRUT A.C.
 *   node scripts/unifrut_generar_seed.mjs
 * Zona (cuenca / salida / fuera) y distancia al límite se calculan contra public/geo/cuenca_conchos.geojson (misma regla que jcas_generar_seed.mjs).
 * Lee supabase/functions/unifrut-sync/fixtures/catalogo.json (copia de getInfo.php de cada estación, 2026-11-13).
 * La migración se aplica con el MCP de Supabase (apply_migration), NUNCA con `supabase db push`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(fs.readFileSync(path.join(raiz, 'supabase/functions/unifrut-sync/fixtures/catalogo.json'), 'utf8'));
const poli = JSON.parse(fs.readFileSync(path.join(raiz, 'public/geo/cuenca_conchos.geojson'), 'utf8')).features[0].geometry.coordinates;

const dentro = (anillo, x, y) => { let c = false; for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) { const [xi, yi] = anillo[i], [xj, yj] = anillo[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const km = (la1, lo1, la2, lo2) => { const r = Math.PI / 180, a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(a)); };
const vertices = poli.flatMap((p) => p[0]);
const zona = (lon, lat) => km(lat, lon, 29.55, -104.4) <= 30 ? 'salida' : poli.some((p) => dentro(p[0], lon, lat)) ? 'cuenca' : 'fuera';
// Distancia al vértice más cercano del contorno (1150 vértices: cota superior de la distancia al límite, suficiente para "cuán colindante es").
const distLimite = (lon, lat) => Math.round(Math.min(...vertices.map(([x, y]) => km(lat, lon, y, x))));
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

const filas = cat.map(([id, nombre, muni, tipo, lat, lon, alt]) => {
  const z = zona(lon, lat);
  return `  (${q(id)}, ${q(nombre)}, ${q(muni)}, ${q(tipo)}, ${lat}, ${lon}, ${alt ?? 'NULL'}, ${q(z)}, ${z === 'cuenca' ? 0 : distLimite(lon, lat)}, true)`;
});
const conteo = cat.reduce((a, e) => { const z = zona(e[5], e[4]); a[z] = (a[z] ?? 0) + 1; return a; }, {});

const sql = `-- UNIFRUT A.C. (Unión Agrícola Regional de Fruticultores del Estado de Chihuahua): Red de Estaciones Meteorológicas (REM), Cuauhtémoc, Chih.
-- Fuente TERCERA y solo contexto regional: tablas unifrut_* separadas de clima_estaciones (WeatherLink) y de jcas_*; nunca alimentan KPIs ni el IDW del distrito.
-- Catálogo generado por scripts/unifrut_generar_seed.mjs. Zona contra el contorno oficial INEGI-CONAGUA: ${JSON.stringify(conteo)}
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
${filas.join(',\n')}
ON CONFLICT (id_unifrut) DO UPDATE SET
  nombre = EXCLUDED.nombre, municipio = EXCLUDED.municipio, tipo = EXCLUDED.tipo, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud,
  altitud_m = EXCLUDED.altitud_m, zona = EXCLUDED.zona, dist_limite_km = EXCLUDED.dist_limite_km;

-- Estado por estación. El portal publica el día N hasta bien entrado el N+1: se tolera 3 días ("vigente"). Lo que no reporta hace > 3 días = sin dato (S/D).
CREATE OR REPLACE VIEW public.v_unifrut_estado WITH (security_invoker = true) AS
SELECT e.id_unifrut, e.nombre, e.municipio, e.tipo, e.latitud, e.longitud, e.altitud_m, e.zona, e.dist_limite_km, e.sincronizar, e.ult_fecha,
       ((now() AT TIME ZONE 'America/Chihuahua')::date - e.ult_fecha) AS dias_sin_dato,
       (e.ult_fecha IS NOT NULL AND ((now() AT TIME ZONE 'America/Chihuahua')::date - e.ult_fecha) <= 3) AS vigente
FROM public.unifrut_estaciones e;
`;

const out = path.join(raiz, 'supabase/migrations/20261113120000_unifrut_estaciones.sql');
fs.writeFileSync(out, sql);
console.log(`escrito ${path.relative(raiz, out)} · ${cat.length} estaciones`, conteo);
