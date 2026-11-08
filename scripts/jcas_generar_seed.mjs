#!/usr/bin/env node
/**
 * Genera supabase/migrations/20261108170000_jcas_estaciones.sql: esquema jcas_* + catálogo de estaciones con su zona
 * (cuenca / salida / fuera) calculada contra public/geo/cuenca_conchos.geojson.
 *   node scripts/jcas_generar_seed.mjs
 * Reproducible: lee supabase/functions/jcas-sync/fixtures/estaciones.json (copia saneada de /maps/get/estaciones).
 * La migración se aplica con el MCP de Supabase (apply_migration), NUNCA con `supabase db push`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const est = JSON.parse(fs.readFileSync(path.join(raiz, 'supabase/functions/jcas-sync/fixtures/estaciones.json'), 'utf8'));
const poli = JSON.parse(fs.readFileSync(path.join(raiz, 'public/geo/cuenca_conchos.geojson'), 'utf8')).features[0].geometry.coordinates;

const dentro = (anillo, x, y) => { let c = false; for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) { const [xi, yi] = anillo[i], [xj, yj] = anillo[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const km = (la1, lo1, la2, lo2) => { const r = Math.PI / 180, a = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(a)); };
// Misma regla que src/utils/geoCuenca.ts (zonaDeEstacion): la salida se evalúa primero.
const zona = (lon, lat) => km(lat, lon, 29.55, -104.4) <= 30 ? 'salida' : poli.some((p) => dentro(p[0], lon, lat)) ? 'cuenca' : 'fuera';
// Estaciones de una misma ciudad (mismo sitio físico con distintos equipos): pesan UNA vez en cualquier interpolación.
const grupo = (e) => (/^CHIH_|Centro de Justicia Chihuahua/.test(e.nombre) ? 'chihuahua' : null);
const q = (s) => (s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

const filas = est.map((e) => {
  const z = zona(+e.longitud, +e.latitud);
  const alt = e.altitud === '' || e.altitud == null ? 'NULL' : Number(e.altitud);
  return `  (${e.id}, ${q(e.nombre)}, ${+e.latitud}, ${+e.longitud}, ${alt}, ${q(z)}, ${q(grupo(e))}, ${e.pluviometro === 'SI'}, ${z !== 'fuera'})`;
});
const conteo = est.reduce((a, e) => { const z = zona(+e.longitud, +e.latitud); a[z] = (a[z] ?? 0) + 1; return a; }, {});

const sql = `-- JCAS (Junta Central de Agua y Saneamiento de Chihuahua / UACJ): estaciones climatológicas de la cuenca del Conchos.
-- Fuente TERCERA y solo contexto: tablas jcas_* separadas de clima_estaciones (WeatherLink); nunca alimentan KPIs ni el IDW del distrito.
-- Catálogo generado por scripts/jcas_generar_seed.mjs (zona calculada contra el contorno oficial INEGI-CONAGUA). ${JSON.stringify(conteo)}
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
${filas.join(',\n')}
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
`;
const destino = path.join(raiz, 'supabase/migrations/20261108170000_jcas_estaciones.sql');
fs.writeFileSync(destino, sql);
console.log(`Escrito ${path.relative(raiz, destino)} · ${est.length} estaciones · ${JSON.stringify(conteo)}`);
