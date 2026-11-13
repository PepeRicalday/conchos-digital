-- C) JCAS: días LOCALES de Chihuahua reconstruidos desde la serie horaria.
-- Hallazgo 2026-11-13 (datos reales, ver supabase/functions/jcas-sync/fixtures/*_20261113.html y las pruebas «huso del portal»):
--   · el «día» de la serie mensual del portal es UTC (00:00 UTC = 18:00 de Chihuahua): la lluvia de 18:00-24:00 locales cae en el día siguiente;
--   · las etiquetas de la serie horaria van en UTC-7 (inicio de hora): jcas_lecturas_horarias.ts guardaba cada hora 1 h antes de lo real.
-- Solución: (1) la serie horaria guarda TODAS las variables con el huso correcto; (2) fn_jcas_dias_locales agrega días de Chihuahua (jcas_lecturas_diarias_local);
-- (3) fn_jcas_hoy_local calcula el parcial de hoy en hora local; (4) la vista v_jcas_lecturas_diarias prefiere el día local y, si no existe, el día UTC del portal
-- (la historia anterior queda en día UTC; en la transición hay una ventana de 6 h sin cubrir por ninguno de los dos).
-- S/D = NULL, nunca 0. Reglas: media con ≥ 20 de 24 horas con dato; lluvia con ≥ 22 de 24 horas y solo si la estación tiene pluviómetro.

-- 1) Todas las variables por hora + marca de huso corregido
ALTER TABLE public.jcas_lecturas_horarias
  ADD COLUMN IF NOT EXISTS hum_pct     numeric,
  ADD COLUMN IF NOT EXISTS viento_kmh  numeric,
  ADD COLUMN IF NOT EXISTS presion_hpa numeric,
  ADD COLUMN IF NOT EXISTS rocio_c     numeric,
  ADD COLUMN IF NOT EXISTS lluvia_mm   numeric,
  ADD COLUMN IF NOT EXISTS ts_v2       boolean NOT NULL DEFAULT false;  -- true = ts con el huso correcto del portal (UTC-7)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jcas_horarias_lluvia_chk') THEN
    ALTER TABLE public.jcas_lecturas_horarias ADD CONSTRAINT jcas_horarias_lluvia_chk CHECK (lluvia_mm IS NULL OR lluvia_mm >= 0);
  END IF;
END $$;

-- 2) Corrección ÚNICA del ts histórico (+1 h). Solo las filas con ts_v2 = false (las que escribió la versión anterior de la función); las nuevas ya traen true.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.jcas_lecturas_horarias WHERE NOT ts_v2) THEN
    ALTER TABLE public.jcas_lecturas_horarias DROP CONSTRAINT jcas_lecturas_horarias_pkey;
    UPDATE public.jcas_lecturas_horarias SET ts = ts + interval '1 hour', ts_v2 = true WHERE NOT ts_v2;
    ALTER TABLE public.jcas_lecturas_horarias ADD CONSTRAINT jcas_lecturas_horarias_pkey PRIMARY KEY (estacion_id, ts);
  END IF;
END $$;

-- 3) Días locales reconstruidos
CREATE TABLE IF NOT EXISTS public.jcas_lecturas_diarias_local (
  estacion_id    integer NOT NULL REFERENCES public.jcas_estaciones(id_jcas) ON DELETE CASCADE,
  fecha          date    NOT NULL,                 -- día LOCAL de Chihuahua (00:00 a 24:00 UTC-6), COMPLETO
  temp_c numeric, hum_pct numeric, viento_kmh numeric, presion_hpa numeric, rocio_c numeric,
  lluvia_mm      numeric CHECK (lluvia_mm IS NULL OR lluvia_mm >= 0),
  horas_con_dato integer NOT NULL DEFAULT 0,
  horas_lluvia   integer NOT NULL DEFAULT 0,
  ingestado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, fecha)
);
ALTER TABLE public.jcas_lecturas_diarias_local ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jcas_diarias_local_lectura ON public.jcas_lecturas_diarias_local;
CREATE POLICY jcas_diarias_local_lectura ON public.jcas_lecturas_diarias_local FOR SELECT USING (true);

-- 4) Vista: el día local manda; si no existe, el día UTC del portal (historia)
CREATE OR REPLACE VIEW public.v_jcas_lecturas_diarias WITH (security_invoker = true) AS
SELECT l.estacion_id, l.fecha, l.lluvia_mm, l.temp_c, l.hum_pct, l.viento_kmh, l.presion_hpa, l.rocio_c, 'local'::text AS origen
FROM public.jcas_lecturas_diarias_local l
UNION ALL
SELECT d.estacion_id, d.fecha, d.lluvia_mm, d.temp_c, d.hum_pct, d.viento_kmh, d.presion_hpa, d.rocio_c, 'portal_utc'::text
FROM public.jcas_lecturas_diarias d
WHERE NOT EXISTS (SELECT 1 FROM public.jcas_lecturas_diarias_local l WHERE l.estacion_id = d.estacion_id AND l.fecha = d.fecha);

-- 5) Agregación de días locales completos (los últimos p_dias antes de hoy local)
CREATE OR REPLACE FUNCTION public.fn_jcas_dias_locales(p_dias integer DEFAULT 4)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Chihuahua')::date;
  n integer;
BEGIN
  WITH h AS (
    SELECT estacion_id, (ts AT TIME ZONE 'America/Chihuahua')::date AS dia, temp_c, hum_pct, viento_kmh, presion_hpa, rocio_c, lluvia_mm
    FROM public.jcas_lecturas_horarias
    WHERE ts_v2
      AND ts >= ((v_hoy - p_dias)::timestamp AT TIME ZONE 'America/Chihuahua')
      AND ts <  (v_hoy::timestamp AT TIME ZONE 'America/Chihuahua')
  ), a AS (
    SELECT h.estacion_id, h.dia, e.tiene_pluviometro,
           count(h.temp_c) AS nt, avg(h.temp_c) AS t, count(h.hum_pct) AS nh, avg(h.hum_pct) AS hu,
           count(h.viento_kmh) AS nv, avg(h.viento_kmh) AS vi, count(h.presion_hpa) AS np, avg(h.presion_hpa) AS pr,
           count(h.rocio_c) AS nr, avg(h.rocio_c) AS ro, count(h.lluvia_mm) AS nl, sum(h.lluvia_mm) AS ll, count(*) AS nn
    FROM h JOIN public.jcas_estaciones e ON e.id_jcas = h.estacion_id
    GROUP BY h.estacion_id, h.dia, e.tiene_pluviometro
  )
  INSERT INTO public.jcas_lecturas_diarias_local AS d
    (estacion_id, fecha, temp_c, hum_pct, viento_kmh, presion_hpa, rocio_c, lluvia_mm, horas_con_dato, horas_lluvia, ingestado_en)
  SELECT estacion_id, dia,
         CASE WHEN nt >= 20 THEN round(t::numeric, 3) END, CASE WHEN nh >= 20 THEN round(hu::numeric, 3) END,
         CASE WHEN nv >= 20 THEN round(vi::numeric, 3) END, CASE WHEN np >= 20 THEN round(pr::numeric, 3) END,
         CASE WHEN nr >= 20 THEN round(ro::numeric, 3) END,
         CASE WHEN tiene_pluviometro AND nl >= 22 THEN round(ll::numeric, 2) END,
         nn::integer, nl::integer, now()
  FROM a
  WHERE nh >= 20 OR nv >= 20 OR nl >= 22          -- solo días cubiertos por la ingesta completa (los de solo temperatura no sustituyen al día del portal)
  ON CONFLICT (estacion_id, fecha) DO UPDATE SET
    temp_c = EXCLUDED.temp_c, hum_pct = EXCLUDED.hum_pct, viento_kmh = EXCLUDED.viento_kmh, presion_hpa = EXCLUDED.presion_hpa,
    rocio_c = EXCLUDED.rocio_c, lluvia_mm = EXCLUDED.lluvia_mm, horas_con_dato = EXCLUDED.horas_con_dato,
    horas_lluvia = EXCLUDED.horas_lluvia, ingestado_en = EXCLUDED.ingestado_en;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 6) «Hoy» parcial en hora local: lo acumulado/promediado de las horas completas desde las 00:00 de Chihuahua
CREATE OR REPLACE FUNCTION public.fn_jcas_hoy_local()
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Chihuahua')::date;
  n integer;
BEGIN
  INSERT INTO public.jcas_lecturas_hoy AS d (estacion_id, fecha, temp_c, hum_pct, viento_kmh, lluvia_mm, actualizado_en)
  SELECT h.estacion_id, v_hoy,
         round(avg(h.temp_c)::numeric, 3), round(avg(h.hum_pct)::numeric, 3), round(avg(h.viento_kmh)::numeric, 3),
         CASE WHEN e.tiene_pluviometro AND count(h.lluvia_mm) >= ceil(0.8 * count(*)) THEN round(sum(h.lluvia_mm)::numeric, 2) END,
         max(h.ts) + interval '1 hour'
  FROM public.jcas_lecturas_horarias h
  JOIN public.jcas_estaciones e ON e.id_jcas = h.estacion_id
  WHERE h.ts_v2 AND h.ts >= (v_hoy::timestamp AT TIME ZONE 'America/Chihuahua')
  GROUP BY h.estacion_id, e.tiene_pluviometro
  ON CONFLICT (estacion_id) DO UPDATE SET
    fecha = EXCLUDED.fecha, temp_c = EXCLUDED.temp_c, hum_pct = EXCLUDED.hum_pct, viento_kmh = EXCLUDED.viento_kmh,
    lluvia_mm = EXCLUDED.lluvia_mm, actualizado_en = EXCLUDED.actualizado_en;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.fn_jcas_dias_locales(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_jcas_hoy_local() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_jcas_dias_locales(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_jcas_hoy_local() TO service_role;

-- 7) La verificación del pronóstico (días locales de Open-Meteo) compara contra el día local cuando existe
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.fn_cuenca_verificacion(integer, numeric)'::regprocedure);
  IF position('jcas_lecturas_diarias o' IN d) > 0 THEN
    EXECUTE replace(d, 'jcas_lecturas_diarias o', 'v_jcas_lecturas_diarias o');
  END IF;
END $$;
