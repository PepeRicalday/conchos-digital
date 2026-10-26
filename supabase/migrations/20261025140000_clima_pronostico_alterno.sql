-- Pronósticos de modelos/proveedores alternos (MET Norway + ECMWF/GFS/ICON vía Open-Meteo).
-- Tabla APARTE de clima_pronostico_horario: ahí la unicidad es (estación, instante, proveedor)
-- y todo el front/verificación asume una sola serie; mezclar proveedores duplicaría filas y sumas.
-- Se archiva por corrida (2 al día) para poder medir 7-24 h y 25-48 h antes de decidir un ensamble.

CREATE TABLE IF NOT EXISTS public.clima_pronostico_alterno (
  estacion_id  uuid NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
  proveedor    text NOT NULL,                 -- 'met-no' | 'open-meteo:ecmwf_ifs025' | 'open-meteo:gfs_seamless' | ...
  corrida_en   timestamptz NOT NULL,          -- hora de obtención truncada
  valido_en    timestamptz NOT NULL,
  horizonte_h  integer NOT NULL,
  temp_c       numeric,
  hum_rel_pct  numeric,
  viento_ms    numeric,
  precip_mm    numeric,
  nubosidad_total_pct numeric,
  PRIMARY KEY (estacion_id, proveedor, corrida_en, valido_en)
);
CREATE INDEX IF NOT EXISTS clima_pron_alt_valido_idx ON public.clima_pronostico_alterno (valido_en);
ALTER TABLE public.clima_pronostico_alterno ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clima_pron_alt_lectura ON public.clima_pronostico_alterno;
CREATE POLICY clima_pron_alt_lectura ON public.clima_pronostico_alterno FOR SELECT USING (true);

-- Comparación de proveedores contra las estaciones (mismo emparejamiento ±60 min que fn_clima_skill_variables).
-- 'consenso' = promedio de los proveedores disponibles para la misma corrida (mín. 3).
-- mae_centrado = error medio tras restar el sesgo propio de cada proveedor/estación: mide cuánto se
-- ganaría con corrección de sesgo, y sirve para decidir si conviene un ensamble.
CREATE OR REPLACE FUNCTION public.fn_clima_skill_proveedores(p_dias integer DEFAULT 14)
RETURNS TABLE(proveedor text, rango_horizonte text, variable text, n bigint, mae numeric, sesgo numeric, mae_centrado numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH fc AS (
    SELECT a.estacion_id, a.proveedor, a.corrida_en, a.valido_en, a.horizonte_h, a.temp_c, a.viento_ms
    FROM public.clima_pronostico_alterno a
    WHERE a.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias,1),60)) AND a.valido_en < now() - interval '1 hour'
    UNION ALL
    SELECT s.estacion_id, 'open-meteo:best_match', s.corrida_en, s.valido_en, s.horizonte_h, s.temp_c, s.viento_ms
    FROM public.clima_pronostico_snapshot s
    WHERE s.valido_en >= now() - make_interval(days => LEAST(GREATEST(p_dias,1),60)) AND s.valido_en < now() - interval '1 hour'
  ),
  cons AS (
    SELECT estacion_id, 'consenso'::text AS proveedor, corrida_en, valido_en, min(horizonte_h) AS horizonte_h,
           avg(temp_c) AS temp_c, avg(viento_ms) AS viento_ms
    FROM fc GROUP BY estacion_id, corrida_en, valido_en HAVING count(DISTINCT proveedor) >= 3
  ),
  todo AS (SELECT * FROM fc UNION ALL SELECT * FROM cons),
  par AS (
    SELECT f.estacion_id, f.proveedor, f.horizonte_h, f.temp_c AS t_fc, f.viento_ms AS v_fc, o.temp_c AS t_obs, o.viento_ms AS v_obs
    FROM todo f
    JOIN LATERAL (
      SELECT l.temp_c, l.viento_ms FROM public.clima_estacion_lecturas l
      WHERE l.estacion_id = f.estacion_id AND l.ts BETWEEN f.valido_en - interval '60 minutes' AND f.valido_en + interval '60 minutes'
        AND (l.temp_c IS NULL OR l.temp_c BETWEEN -25 AND 48) AND (l.viento_ms IS NULL OR l.viento_ms BETWEEN 0 AND 50)
      ORDER BY abs(EXTRACT(EPOCH FROM (l.ts - f.valido_en))) LIMIT 1
    ) o ON true
  ),
  largo AS (
    SELECT estacion_id, proveedor, CASE WHEN horizonte_h <= 6 THEN '0-6 h' WHEN horizonte_h <= 24 THEN '7-24 h' ELSE '25-48 h' END AS rg,
           'temperatura'::text AS variable, t_fc - t_obs AS err FROM par WHERE t_fc IS NOT NULL AND t_obs IS NOT NULL
    UNION ALL
    SELECT estacion_id, proveedor, CASE WHEN horizonte_h <= 6 THEN '0-6 h' WHEN horizonte_h <= 24 THEN '7-24 h' ELSE '25-48 h' END,
           'viento', v_fc - v_obs FROM par WHERE v_fc IS NOT NULL AND v_obs IS NOT NULL
  ),
  cen AS (
    SELECT *, err - avg(err) OVER (PARTITION BY proveedor, estacion_id, variable) AS err_c FROM largo
  )
  SELECT proveedor, rg, variable, count(*), round(avg(abs(err))::numeric, 2), round(avg(err)::numeric, 2), round(avg(abs(err_c))::numeric, 2)
  FROM cen GROUP BY proveedor, rg, variable ORDER BY variable, rg, proveedor;
$$;
GRANT EXECUTE ON FUNCTION public.fn_clima_skill_proveedores(integer) TO anon, authenticated;

-- La retención (60 días) la aplica la propia Edge Function en cada corrida.

-- Cron: 00:25 y 12:25 hora local (UTC-6) = 06:25 y 18:25 UTC, justo después del snapshot (00:20 / 12:20).
-- Mismo patrón que clima-pronostico-1h: la anon key es pública; la función usa el service_role internamente.
SELECT cron.unschedule('clima-pronostico-alterno')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clima-pronostico-alterno');
SELECT cron.schedule(
  'clima-pronostico-alterno', '25 6,18 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/clima-pronostico-alterno-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1bWZ5cmd3bnNoY2dlaWJmZnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODUyNTcsImV4cCI6MjA4NjI2MTI1N30.4vB-8b2nnyqXw6JDJdQYyzjOf4Lx-UJgAfaR7uRrCQY'
    ),
    body    := '{}'::jsonb
  );
  $$
);
