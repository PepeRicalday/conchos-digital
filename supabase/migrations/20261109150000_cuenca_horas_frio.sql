-- Horas frío y extremos de temperatura para la Cuenca del Conchos.
-- Definición (igual que src/utils/horasFrio.ts): HORA FRÍO = hora local (America/Chihuahua) con temperatura ≤ umbral (7.2 °C por defecto);
-- HORA DE HELADA = hora local ≤ 0 °C. Se usa la MEDIA de cada hora local; un día con menos de 20 de 24 horas con dato devuelve horas = NULL (S/D, nunca 0).
-- No se estima nada desde la media diaria: sin serie horaria no hay horas frío.
-- Fuentes (no se mezclan; la columna `fuente` las distingue):
--   · 'propia': clima_estacion_lecturas (WeatherLink, ≈ cada 15 min), sin lecturas 'suspect' ni sensores no confiables.
--   · 'jcas'  : jcas_lecturas_horarias (portal JCAS ?mode=day). Solo existe desde que se activa el cron: NO hay histórico retroactivo.
-- PENDIENTE DE APLICAR: requiere visto bueno del usuario (NUNCA `supabase db push`; aplicar con MCP apply_migration tras revisar drift).

CREATE TABLE IF NOT EXISTS public.jcas_lecturas_horarias (
  estacion_id integer NOT NULL REFERENCES public.jcas_estaciones(id_jcas) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,           -- inicio de la hora (instante UTC de la hora local HH:00 de la estación)
  temp_c      numeric CHECK (temp_c IS NULL OR temp_c BETWEEN -35 AND 52),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estacion_id, ts)
);
CREATE INDEX IF NOT EXISTS jcas_horarias_ts_idx ON public.jcas_lecturas_horarias (ts);
ALTER TABLE public.jcas_lecturas_horarias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jcas_horarias_lectura ON public.jcas_lecturas_horarias;
CREATE POLICY jcas_horarias_lectura ON public.jcas_lecturas_horarias FOR SELECT USING (true);

-- Umbral editable como el resto de los umbrales climáticos (si la tabla/columnas difieren, el cliente usa 7.2 por defecto).
-- (La clave se agrega aparte tras revisar el esquema real de clima_umbrales.)

CREATE OR REPLACE FUNCTION public.fn_cuenca_horas_frio(p_desde date, p_hasta date DEFAULT NULL, p_umbral numeric DEFAULT 7.2)
RETURNS TABLE (fuente text, estacion_id text, fecha date, horas_frio integer, horas_helada integer, horas_con_dato integer, tmax numeric, tmin numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH propias AS (
    SELECT 'propia'::text AS fuente, e.id::text AS est,
           date_trunc('hour', l.ts AT TIME ZONE 'America/Chihuahua') AS hora, l.temp_c AS t
    FROM public.clima_estaciones e
    JOIN public.clima_estacion_lecturas l ON l.estacion_id = e.id
    WHERE e.activa
      AND NOT ('temp_c' = ANY (COALESCE(e.sensores_no_confiables, ARRAY[]::text[])))
      AND l.qa_status IS DISTINCT FROM 'suspect'
      AND l.temp_c BETWEEN -40 AND 55
      AND l.ts >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
      AND (p_hasta IS NULL OR l.ts < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
  ), jcas AS (
    SELECT 'jcas'::text AS fuente, h.estacion_id::text AS est,
           date_trunc('hour', h.ts AT TIME ZONE 'America/Chihuahua') AS hora, h.temp_c AS t
    FROM public.jcas_lecturas_horarias h
    WHERE h.temp_c IS NOT NULL
      AND h.ts >= (p_desde::timestamp AT TIME ZONE 'America/Chihuahua')
      AND (p_hasta IS NULL OR h.ts < ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Chihuahua'))
  ), horas AS (
    SELECT fuente, est, hora, avg(t) AS tm, max(t) AS tx, min(t) AS tn
    FROM (SELECT * FROM propias UNION ALL SELECT * FROM jcas) u
    GROUP BY fuente, est, hora
  )
  SELECT fuente, est, hora::date,
         CASE WHEN count(*) >= 20 THEN (count(*) FILTER (WHERE tm <= p_umbral))::integer END,
         CASE WHEN count(*) >= 20 THEN (count(*) FILTER (WHERE tm <= 0))::integer END,
         count(*)::integer, round(max(tx)::numeric, 1), round(min(tn)::numeric, 1)
  FROM horas
  GROUP BY fuente, est, hora::date;
$$;
GRANT EXECUTE ON FUNCTION public.fn_cuenca_horas_frio(date, date, numeric) TO anon, authenticated;

-- Cron del modo "horario" (APLICADO 2026-11-09 vía MCP): ventana de 24 h del portal, una corrida cada 4 h (cortesía: 1 página por estación, pausa de 1 s).
SELECT cron.unschedule('jcas-sync-horario') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jcas-sync-horario');
SELECT cron.schedule('jcas-sync-horario', '50 */4 * * *', $f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/jcas-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'jcas_sync')),
    body    := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 140000
  );$f$);
