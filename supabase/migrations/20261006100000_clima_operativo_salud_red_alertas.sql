-- ═══════════════════════════════════════════════════════════════════════════
-- CLIMA — nivel operativo: salud de la red, alertas agroclimáticas, RLS y crons
-- Fecha: 2026-10-06
--
-- 1) RLS: las tablas de clima las escriben solo las Edge Functions (service_role, que omite RLS). La política
--    «Auth Write … ALL USING (true)» permitía escritura anónima con la anon key pública → se elimina.
--    (clima_presas se queda como está: ImportReport la escribe con usuario autenticado.)
-- 2) clima_umbrales: umbrales de aviso/crítico editables (helada, calor, viento, lluvia, ETₒ).
-- 3) fn_clima_salud_red(): estado de cada estación (edad, cobertura 48 h por bloques de 2 h, hueco máx. 7 d).
-- 4) v_clima_alertas_agro_eval + fn_clima_alertas_agro(): evalúa lectura actual + pronóstico 48 h contra los
--    umbrales y mantiene registro_alertas (categoria 'agroclimatica'), con auto-resolución.
-- 5) fn_clima_vigilar_red(): alerta si una estación lleva > 6 h sin reportar (categoria 'fuente_datos').
-- 6) pg_cron cada 30 min (SQL directo, sin HTTP).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) Categorías de alerta ──────────────────────────────────────────────────
-- registro_alertas_categoria_check solo admitía 5 categorías: insertar 'agroclimatica' o 'fuente_datos' fallaba.
-- (La alerta de reporte CILA retrasado usa 'fuente_datos' y nunca pudo registrarse.)
ALTER TABLE public.registro_alertas DROP CONSTRAINT IF EXISTS registro_alertas_categoria_check;
ALTER TABLE public.registro_alertas ADD CONSTRAINT registro_alertas_categoria_check
  CHECK (categoria = ANY (ARRAY['caudal', 'infraestructura', 'evaporacion', 'nivel_critico', 'desviacion_batimetrica',
                                'agroclimatica', 'fuente_datos']));

-- ── 1) RLS ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Auth Write Clima Estaciones"          ON public.clima_estaciones;
DROP POLICY IF EXISTS "Auth Write Clima Lecturas"            ON public.clima_estacion_lecturas;
DROP POLICY IF EXISTS "Auth Write Clima Pronostico"          ON public.clima_pronostico_horario;
DROP POLICY IF EXISTS "Auth Write Clima Historico Satelital" ON public.clima_historico_satelital;

-- ── 2) Umbrales ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clima_umbrales (
  clave       text PRIMARY KEY,                       -- helada | calor | viento | lluvia | eto
  etiqueta    text    NOT NULL,
  comparador  text    NOT NULL CHECK (comparador IN ('mayor', 'menor')),
  aviso       numeric NOT NULL,
  critico     numeric NOT NULL,
  unidad      text    NOT NULL,
  accion      text    NOT NULL,                       -- qué hacer cuando se activa
  activo      boolean NOT NULL DEFAULT true,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.clima_umbrales (clave, etiqueta, comparador, aviso, critico, unidad, accion) VALUES
  ('helada', 'Riesgo de helada (T mín. en 48 h)',     'menor', 4,  2,  '°C',     'Proteger cultivos sensibles y posponer riegos nocturnos.'),
  ('calor',  'Calor extremo (T máx. en 48 h)',        'mayor', 36, 40, '°C',     'Programar riegos de madrugada y vigilar estrés hídrico.'),
  ('viento', 'Viento fuerte (máx. en 48 h)',          'mayor', 6,  10, 'm/s',    'Evitar riego por aspersión; revisar infraestructura expuesta.'),
  ('lluvia', 'Lluvia intensa (acumulada 24 h)',       'mayor', 10, 25, 'mm',     'Reducir entregas y revisar tomas y drenes.'),
  ('eto',    'Demanda evaporativa alta (ETₒ del día)','mayor', 7,  9,  'mm/día', 'Subir la lámina de riego y adelantar turnos.')
ON CONFLICT (clave) DO NOTHING;

ALTER TABLE public.clima_umbrales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read Clima Umbrales" ON public.clima_umbrales;
CREATE POLICY "Public Read Clima Umbrales" ON public.clima_umbrales FOR SELECT USING (true);

-- ── 3) Salud de la red ───────────────────────────────────────────────────────
-- La sincronización de WeatherLink corre cada 2 h, así que la cobertura se mide por BLOQUES DE 2 h completados
-- (un bloque «con dato» = al menos una lectura en esa ventana). Medirla por hora penalizaría el diseño del cron.
DROP FUNCTION IF EXISTS public.fn_clima_salud_red();
CREATE OR REPLACE FUNCTION public.fn_clima_salud_red()
RETURNS TABLE (
  estacion_id         uuid,
  nombre              text,
  rol                 text,
  modulo_id           text,
  ultima_lectura      timestamptz,
  edad_min            integer,
  bloques_con_dato    integer,        -- de los bloques de 2 h ya completados en las últimas 48 h
  bloques_completos   integer,
  cobertura_48h_pct   numeric,
  hueco_max_h_7d      numeric,
  lecturas_7d         integer,
  bloques_2h          boolean[],      -- 24 posiciones, la última es el bloque en curso
  estado              text,           -- VIGENTE (≤150 min) | RETRASADA (≤6 h) | SIN_SEÑAL
  temp_ultima_c       numeric,
  desviacion_temp_c   numeric,        -- T de la estación − mediana de la red (lecturas de las últimas 3 h)
  sospechosa          boolean         -- lectura inverosímil (fuera de −25…48 °C) o |desviación| > 8 °C
)
LANGUAGE sql
STABLE
AS $$
  SELECT e.id, e.nombre, e.rol, e.modulo_id,
         u.ultima,
         CASE WHEN u.ultima IS NULL THEN NULL ELSE round(EXTRACT(epoch FROM now() - u.ultima) / 60.0)::int END,
         COALESCE(h.con_dato, 0),
         COALESCE(h.completos, 0),
         CASE WHEN COALESCE(h.completos, 0) = 0 THEN NULL ELSE round(h.con_dato * 100.0 / h.completos, 1) END,
         round(GREATEST(COALESCE(g.hueco_h, 0), COALESCE(EXTRACT(epoch FROM now() - u.ultima) / 3600.0, 0))::numeric, 1),
         COALESCE(s.n7, 0),
         h.bloques,
         CASE WHEN u.ultima IS NULL THEN 'SIN_SEÑAL'
              WHEN now() - u.ultima <= interval '150 minutes' THEN 'VIGENTE'
              WHEN now() - u.ultima <= interval '6 hours' THEN 'RETRASADA'
              ELSE 'SIN_SEÑAL' END,
         lu.temp_c,
         CASE WHEN lu.temp_c IS NULL OR m.med IS NULL THEN NULL ELSE round((lu.temp_c - m.med)::numeric, 1) END,
         CASE WHEN lu.temp_c IS NULL THEN NULL
              ELSE (lu.temp_c NOT BETWEEN -25 AND 48) OR (m.med IS NOT NULL AND abs(lu.temp_c - m.med) > 8) END
  FROM public.clima_estaciones e
  LEFT JOIN LATERAL (SELECT max(ts) AS ultima FROM public.clima_estacion_lecturas WHERE estacion_id = e.id) u ON true
  LEFT JOIN LATERAL (SELECT temp_c FROM public.clima_estacion_lecturas WHERE estacion_id = e.id ORDER BY ts DESC LIMIT 1) lu ON true
  CROSS JOIN LATERAL (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x.temp_c) AS med
    FROM (SELECT DISTINCT ON (estacion_id) temp_c FROM public.clima_estacion_lecturas
          WHERE ts > now() - interval '3 hours' AND temp_c BETWEEN -25 AND 48 ORDER BY estacion_id, ts DESC) x
  ) m
  LEFT JOIN LATERAL (
    SELECT array_agg(t.tiene ORDER BY t.ini) AS bloques,
           count(*) FILTER (WHERE t.ini + interval '2 hours' <= now())::int AS completos,
           count(*) FILTER (WHERE t.ini + interval '2 hours' <= now() AND t.tiene)::int AS con_dato
    FROM (
      SELECT x AS ini, EXISTS (
               SELECT 1 FROM public.clima_estacion_lecturas l
               WHERE l.estacion_id = e.id AND l.ts >= x AND l.ts < x + interval '2 hours') AS tiene
      FROM generate_series(date_trunc('hour', now()) - interval '46 hours', date_trunc('hour', now()), interval '2 hours') x
    ) t
  ) h ON true
  LEFT JOIN LATERAL (
    SELECT max(EXTRACT(epoch FROM (ts - prev)) / 3600.0) AS hueco_h
    FROM (SELECT ts, lag(ts) OVER (ORDER BY ts) AS prev FROM public.clima_estacion_lecturas
          WHERE estacion_id = e.id AND ts >= now() - interval '7 days') z
  ) g ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS n7 FROM public.clima_estacion_lecturas WHERE estacion_id = e.id AND ts >= now() - interval '7 days') s ON true
  WHERE e.activa
  ORDER BY e.prioridad NULLS LAST, e.nombre;
$$;

GRANT EXECUTE ON FUNCTION public.fn_clima_salud_red() TO anon, authenticated;

-- ── 4) Alertas agroclimáticas ────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_clima_alertas_agro_eval WITH (security_invoker = true) AS
WITH plausibles AS (
  -- Lectura más reciente de cada estación que sea físicamente plausible (los sensores averiados dan 82 °C, etc.).
  SELECT e.id AS est, e.nombre, e.modulo_id, l.temp_c, l.viento_ms, l.lluvia_dia_mm
  FROM public.clima_estaciones e
  JOIN LATERAL (
    SELECT * FROM public.clima_estacion_lecturas
    WHERE estacion_id = e.id AND ts > now() - interval '6 hours'        -- lectura vencida: no se evalúa con ella
      AND (temp_c IS NULL OR temp_c BETWEEN -25 AND 48)
      AND (viento_ms IS NULL OR viento_ms BETWEEN 0 AND 50)
      AND (hum_rel_pct IS NULL OR hum_rel_pct BETWEEN 0 AND 100)
    ORDER BY ts DESC LIMIT 1
  ) l ON true
  WHERE e.activa
), red AS (
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY temp_c) AS med_temp FROM plausibles WHERE temp_c IS NOT NULL
), obs AS (
  -- Consistencia entre estaciones: una T que se aparta > 8 °C de la mediana de la red no se usa.
  SELECT p.est, p.nombre, p.modulo_id,
         CASE WHEN p.temp_c IS NOT NULL AND r.med_temp IS NOT NULL AND abs(p.temp_c - r.med_temp) > 8 THEN NULL ELSE p.temp_c END AS temp_c,
         p.viento_ms, p.lluvia_dia_mm
  FROM plausibles p CROSS JOIN red r
), fc AS (
  SELECT estacion_id AS est,
         min(temp_c) AS tmin, max(temp_c) AS tmax,
         max(viento_ms) AS vmax,                                       -- sostenido (las rachas no son comparables con el umbral)
         sum(precip_mm) FILTER (WHERE valido_en < now() + interval '24 hours') AS p24,
         sum(eto_fc_mm) FILTER (WHERE fecha_local = (now() AT TIME ZONE 'America/Chihuahua')::date) AS eto_hoy
  FROM public.clima_pronostico_horario
  WHERE valido_en BETWEEN now() AND now() + interval '48 hours'
  GROUP BY estacion_id
), medidas AS (
  -- LEAST/GREATEST ignoran NULL: si falta la observación o el pronóstico se usa el que haya.
  SELECT e.id AS est, e.nombre, e.modulo_id,
         LEAST(o.temp_c, fc.tmin)                      AS tmin,
         GREATEST(o.temp_c, fc.tmax)                   AS tmax,
         GREATEST(o.viento_ms, fc.vmax)                AS viento,
         GREATEST(o.lluvia_dia_mm, fc.p24)             AS lluvia,
         fc.eto_hoy                                    AS eto
  FROM public.clima_estaciones e
  LEFT JOIN obs o ON o.est = e.id
  LEFT JOIN fc ON fc.est = e.id
  WHERE e.activa
), largo AS (
  SELECT est, nombre, modulo_id, 'helada' AS clave, tmin   AS valor FROM medidas
  UNION ALL SELECT est, nombre, modulo_id, 'calor',  tmax   FROM medidas
  UNION ALL SELECT est, nombre, modulo_id, 'viento', viento FROM medidas
  UNION ALL SELECT est, nombre, modulo_id, 'lluvia', lluvia FROM medidas
  UNION ALL SELECT est, nombre, modulo_id, 'eto',    eto    FROM medidas
)
SELECT 'CLIMA-' || l.clave || '-' || l.est AS origen_id,
       l.est AS estacion_id, l.nombre AS estacion, l.modulo_id, l.clave,
       round(l.valor::numeric, 1) AS valor, u.unidad, u.etiqueta, u.comparador, u.aviso, u.critico, u.accion,
       CASE WHEN l.valor IS NULL THEN NULL
            WHEN u.comparador = 'menor' THEN CASE WHEN l.valor <= u.critico THEN 'critical' WHEN l.valor <= u.aviso THEN 'warning' END
            ELSE CASE WHEN l.valor >= u.critico THEN 'critical' WHEN l.valor >= u.aviso THEN 'warning' END
       END AS severidad
FROM largo l
JOIN public.clima_umbrales u ON u.clave = l.clave AND u.activo;

GRANT SELECT ON public.v_clima_alertas_agro_eval TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_clima_alertas_agro()
RETURNS TABLE (abiertas integer, actualizadas integer, resueltas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n_ab integer; n_up integer; n_re integer;
BEGIN
  -- Actualiza las alertas abiertas que siguen vigentes (valor y severidad actuales).
  WITH u AS (
    UPDATE public.registro_alertas a
    SET tipo_riesgo = e.severidad,
        titulo  = e.etiqueta || ' · ' || e.estacion,
        mensaje = e.etiqueta || ': ' || e.valor || ' ' || e.unidad
                  || CASE WHEN e.severidad = 'critical' THEN ' (umbral crítico ' ELSE ' (umbral de aviso ' END
                  || CASE WHEN e.comparador = 'menor' THEN '≤ ' ELSE '≥ ' END
                  || CASE WHEN e.severidad = 'critical' THEN e.critico ELSE e.aviso END || ' ' || e.unidad || '). ' || e.accion
    FROM public.v_clima_alertas_agro_eval e
    WHERE a.origen_id = e.origen_id AND NOT a.resuelta AND e.severidad IS NOT NULL
    RETURNING 1
  ) SELECT count(*) INTO n_up FROM u;

  -- Abre las que aún no existen.
  WITH i AS (
    INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id)
    SELECT e.severidad, 'agroclimatica',
           e.etiqueta || ' · ' || e.estacion,
           e.etiqueta || ': ' || e.valor || ' ' || e.unidad
             || CASE WHEN e.severidad = 'critical' THEN ' (umbral crítico ' ELSE ' (umbral de aviso ' END
             || CASE WHEN e.comparador = 'menor' THEN '≤ ' ELSE '≥ ' END
             || CASE WHEN e.severidad = 'critical' THEN e.critico ELSE e.aviso END || ' ' || e.unidad || '). ' || e.accion,
           e.origen_id
    FROM public.v_clima_alertas_agro_eval e
    WHERE e.severidad IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.registro_alertas a WHERE a.origen_id = e.origen_id AND NOT a.resuelta)
    RETURNING 1
  ) SELECT count(*) INTO n_ab FROM i;

  -- Cierra las que dejaron de cumplirse (o cuya estación ya no se evalúa).
  WITH r AS (
    UPDATE public.registro_alertas a
    SET resuelta = true, fecha_resolucion = now()
    WHERE a.categoria = 'agroclimatica' AND NOT a.resuelta
      AND a.origen_id NOT IN (SELECT e.origen_id FROM public.v_clima_alertas_agro_eval e WHERE e.severidad IS NOT NULL)
    RETURNING 1
  ) SELECT count(*) INTO n_re FROM r;

  RETURN QUERY SELECT n_ab, n_up, n_re;
END;
$$;

-- ── 5) Vigilancia de la red ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_clima_vigilar_red()
RETURNS TABLE (abiertas integer, resueltas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n_ab integer; n_re integer;
BEGIN
  WITH i AS (
    INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id)
    SELECT 'warning', 'fuente_datos',
           'Estación sin señal · ' || s.nombre,
           CASE WHEN s.ultima_lectura IS NULL THEN 'La estación no tiene lecturas registradas.'
                ELSE 'Sin lecturas desde el ' || to_char(s.ultima_lectura AT TIME ZONE 'America/Chihuahua', 'DD/MM HH24:MI')
                     || ' (hace ' || round(s.edad_min / 60.0, 1) || ' h). Revisar alimentación, enlace o la API de WeatherLink.' END,
           'CLIMA-RED-' || s.estacion_id
    FROM public.fn_clima_salud_red() s
    WHERE s.estado = 'SIN_SEÑAL'
      AND NOT EXISTS (SELECT 1 FROM public.registro_alertas a WHERE a.origen_id = 'CLIMA-RED-' || s.estacion_id AND NOT a.resuelta)
    RETURNING 1
  ) SELECT count(*) INTO n_ab FROM i;

  WITH r AS (
    UPDATE public.registro_alertas a
    SET resuelta = true, fecha_resolucion = now()
    WHERE a.origen_id LIKE 'CLIMA-RED-%' AND NOT a.resuelta
      AND a.origen_id NOT IN (SELECT 'CLIMA-RED-' || s.estacion_id FROM public.fn_clima_salud_red() s WHERE s.estado = 'SIN_SEÑAL')
    RETURNING 1
  ) SELECT count(*) INTO n_re FROM r;

  RETURN QUERY SELECT n_ab, n_re;
END;
$$;

-- ── 6) Cron (SQL directo; cada 30 min) ───────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('clima-vigilancia-30min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clima-vigilancia-30min');

SELECT cron.schedule(
  'clima-vigilancia-30min',
  '5,35 * * * *',
  $$ SELECT public.fn_clima_vigilar_red(); SELECT public.fn_clima_alertas_agro(); $$
);
