-- ═══════════════════════════════════════════════════════════════════════════
-- Pronóstico: veracidad de alertas, plausibilidad en el resumen y verificación
-- Fecha: 2026-10-16
--
-- 1) Alertas agroclimáticas: la vista mezclaba "última lectura observada" y
--    "pronóstico 48 h" bajo la etiqueta "(máx. en 48 h)". Ahora expone ambos
--    valores por separado (valor_obs / valor_fc, columnas NUEVAS al final de la
--    vista) y el mensaje de la alerta dice de dónde viene la cifra. Las etiquetas
--    de clima_umbrales dejan de prometer un "máx. en 48 h" observado.
-- 2) fn_clima_resumen_mensual: los promedios ignoran lecturas físicamente
--    imposibles (sensor averiado, p. ej. 82 °C) — mismos rangos que la vista.
-- 3) Verificación del pronóstico: tabla de corridas conservadas
--    (clima_pronostico_snapshot, 2 por día) + fn_clima_skill_variables, que
--    compara temperatura y viento contra la lectura observada más cercana, por
--    rango de horizonte, y fn_clima_skill_lluvia_dia (lámina diaria).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Vista de evaluación de alertas con procedencia ───────────────────────
CREATE OR REPLACE VIEW public.v_clima_alertas_agro_eval AS
 WITH plausibles AS (
         SELECT e.id AS est, e.nombre, e.modulo_id, l_1.temp_c, l_1.viento_ms, l_1.lluvia_dia_mm
           FROM clima_estaciones e
             JOIN LATERAL ( SELECT clima_estacion_lecturas.id, clima_estacion_lecturas.estacion_id, clima_estacion_lecturas.station_id,
                    clima_estacion_lecturas.fecha, clima_estacion_lecturas.ts, clima_estacion_lecturas.temp_c, clima_estacion_lecturas.temp_max_c,
                    clima_estacion_lecturas.temp_min_c, clima_estacion_lecturas.hum_rel_pct, clima_estacion_lecturas.punto_rocio_c,
                    clima_estacion_lecturas.presion_hpa, clima_estacion_lecturas.viento_ms, clima_estacion_lecturas.viento_dir_deg,
                    clima_estacion_lecturas.viento_rafaga_ms, clima_estacion_lecturas.lluvia_dia_mm, clima_estacion_lecturas.lluvia_24h_mm,
                    clima_estacion_lecturas.lluvia_mes_mm, clima_estacion_lecturas.lluvia_anio_mm, clima_estacion_lecturas.rad_solar_wm2,
                    clima_estacion_lecturas.uv_index, clima_estacion_lecturas.et_dia_mm, clima_estacion_lecturas.et_mes_mm,
                    clima_estacion_lecturas.eto_mm, clima_estacion_lecturas.gdd, clima_estacion_lecturas.payload, clima_estacion_lecturas.creado_en,
                    clima_estacion_lecturas.bar_trend_hpa, clima_estacion_lecturas.clearness_index, clima_estacion_lecturas.nubosidad_est_pct,
                    clima_estacion_lecturas.elev_solar_deg, clima_estacion_lecturas.sky_state_local, clima_estacion_lecturas.qa_flags,
                    clima_estacion_lecturas.qa_status, clima_estacion_lecturas.edad_min
                   FROM clima_estacion_lecturas
                  WHERE clima_estacion_lecturas.estacion_id = e.id AND clima_estacion_lecturas.ts > (now() - '06:00:00'::interval)
                    AND (clima_estacion_lecturas.temp_c IS NULL OR clima_estacion_lecturas.temp_c >= '-25'::integer::numeric AND clima_estacion_lecturas.temp_c <= 48::numeric)
                    AND (clima_estacion_lecturas.viento_ms IS NULL OR clima_estacion_lecturas.viento_ms >= 0::numeric AND clima_estacion_lecturas.viento_ms <= 50::numeric)
                    AND (clima_estacion_lecturas.hum_rel_pct IS NULL OR clima_estacion_lecturas.hum_rel_pct >= 0::numeric AND clima_estacion_lecturas.hum_rel_pct <= 100::numeric)
                  ORDER BY clima_estacion_lecturas.ts DESC
                 LIMIT 1) l_1 ON true
          WHERE e.activa
        ), red AS (
         SELECT percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (plausibles.temp_c::double precision)) AS med_temp
           FROM plausibles WHERE plausibles.temp_c IS NOT NULL
        ), obs AS (
         SELECT p.est, p.nombre, p.modulo_id,
                CASE WHEN p.temp_c IS NOT NULL AND r.med_temp IS NOT NULL AND abs(p.temp_c::double precision - r.med_temp) > 8::double precision THEN NULL::numeric
                     ELSE p.temp_c END AS temp_c,
                p.viento_ms, p.lluvia_dia_mm
           FROM plausibles p CROSS JOIN red r
        ), fc AS (
         SELECT clima_pronostico_horario.estacion_id AS est,
                min(clima_pronostico_horario.temp_c) AS tmin,
                max(clima_pronostico_horario.temp_c) AS tmax,
                max(clima_pronostico_horario.viento_ms) AS vmax,
                sum(clima_pronostico_horario.precip_mm) FILTER (WHERE clima_pronostico_horario.valido_en < (now() + '24:00:00'::interval)) AS p24,
                sum(clima_pronostico_horario.eto_fc_mm) FILTER (WHERE clima_pronostico_horario.fecha_local = (now() AT TIME ZONE 'America/Chihuahua'::text)::date) AS eto_hoy
           FROM clima_pronostico_horario
          WHERE clima_pronostico_horario.valido_en >= now() AND clima_pronostico_horario.valido_en <= (now() + '48:00:00'::interval)
          GROUP BY clima_pronostico_horario.estacion_id
        ), medidas AS (
         SELECT e.id AS est, e.nombre, e.modulo_id,
                LEAST(o.temp_c, fc.tmin) AS tmin, GREATEST(o.temp_c, fc.tmax) AS tmax,
                GREATEST(o.viento_ms, fc.vmax) AS viento, GREATEST(o.lluvia_dia_mm, fc.p24) AS lluvia, fc.eto_hoy AS eto,
                o.temp_c AS t_obs, fc.tmin AS tmin_fc, fc.tmax AS tmax_fc,
                o.viento_ms AS v_obs, fc.vmax AS v_fc,
                o.lluvia_dia_mm AS l_obs, fc.p24 AS l_fc
           FROM clima_estaciones e
             LEFT JOIN obs o ON o.est = e.id
             LEFT JOIN fc ON fc.est = e.id
          WHERE e.activa
        ), largo AS (
         SELECT est, nombre, modulo_id, 'helada'::text AS clave, tmin AS valor, t_obs AS v_o, tmin_fc AS v_f FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'calor'::text, tmax, t_obs, tmax_fc FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'viento'::text, viento, v_obs, v_fc FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'lluvia'::text, lluvia, l_obs, l_fc FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'eto'::text, eto, NULL::numeric, eto FROM medidas
        )
 SELECT (('CLIMA-'::text || l.clave) || '-'::text) || l.est AS origen_id,
    l.est AS estacion_id, l.nombre AS estacion, l.modulo_id, l.clave,
    round(l.valor, 1) AS valor, u.unidad, u.etiqueta, u.comparador, u.aviso, u.critico, u.accion,
        CASE
            WHEN l.valor IS NULL THEN NULL::text
            WHEN u.comparador = 'menor'::text THEN
            CASE WHEN l.valor <= u.critico THEN 'critical'::text WHEN l.valor <= u.aviso THEN 'warning'::text ELSE NULL::text END
            ELSE
            CASE WHEN l.valor >= u.critico THEN 'critical'::text WHEN l.valor >= u.aviso THEN 'warning'::text ELSE NULL::text END
        END AS severidad,
    round(l.v_o, 1) AS valor_obs,
    round(l.v_f, 1) AS valor_fc
   FROM largo l
     JOIN clima_umbrales u ON u.clave = l.clave AND u.activo;

-- Etiquetas honestas: la cifra es el mayor entre lo observado ahora y lo pronosticado.
UPDATE public.clima_umbrales SET etiqueta = 'Viento fuerte (lectura actual o pronóstico 48 h)' WHERE clave = 'viento';
UPDATE public.clima_umbrales SET etiqueta = 'Riesgo de helada (lectura actual o pronóstico 48 h)' WHERE clave = 'helada';
UPDATE public.clima_umbrales SET etiqueta = 'Calor extremo (lectura actual o pronóstico 48 h)' WHERE clave = 'calor';
UPDATE public.clima_umbrales SET etiqueta = 'Lluvia intensa (del día o pronóstico 24 h)' WHERE clave = 'lluvia';

-- Mensaje con procedencia: "[ahora X · pronóstico Y]". `titulo` conserva el nombre de la estación.
CREATE OR REPLACE FUNCTION public.fn_clima_alertas_agro()
 RETURNS TABLE(abiertas integer, actualizadas integer, resueltas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n_ab integer; n_up integer; n_re integer;
BEGIN
  WITH u AS (
    UPDATE public.registro_alertas a
    SET tipo_riesgo = e.severidad,
        titulo  = e.etiqueta || ' · ' || e.estacion,
        mensaje = e.etiqueta || ': ' || e.valor || ' ' || e.unidad
                  || CASE WHEN e.severidad = 'critical' THEN ' (umbral crítico ' ELSE ' (umbral de aviso ' END
                  || CASE WHEN e.comparador = 'menor' THEN '≤ ' ELSE '≥ ' END
                  || CASE WHEN e.severidad = 'critical' THEN e.critico ELSE e.aviso END || ' ' || e.unidad || '). '
                  || CASE WHEN e.valor_obs IS NOT NULL OR e.valor_fc IS NOT NULL
                          THEN '[ahora: ' || COALESCE(e.valor_obs::text, 'S/D') || ' · pronóstico: ' || COALESCE(e.valor_fc::text, 'S/D') || ' ' || e.unidad || ']. ' ELSE '' END
                  || e.accion
    FROM public.v_clima_alertas_agro_eval e
    WHERE a.origen_id = e.origen_id AND NOT a.resuelta AND e.severidad IS NOT NULL
    RETURNING 1
  ) SELECT count(*) INTO n_up FROM u;

  WITH i AS (
    INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id)
    SELECT e.severidad, 'agroclimatica',
           e.etiqueta || ' · ' || e.estacion,
           e.etiqueta || ': ' || e.valor || ' ' || e.unidad
             || CASE WHEN e.severidad = 'critical' THEN ' (umbral crítico ' ELSE ' (umbral de aviso ' END
             || CASE WHEN e.comparador = 'menor' THEN '≤ ' ELSE '≥ ' END
             || CASE WHEN e.severidad = 'critical' THEN e.critico ELSE e.aviso END || ' ' || e.unidad || '). '
             || CASE WHEN e.valor_obs IS NOT NULL OR e.valor_fc IS NOT NULL
                     THEN '[ahora: ' || COALESCE(e.valor_obs::text, 'S/D') || ' · pronóstico: ' || COALESCE(e.valor_fc::text, 'S/D') || ' ' || e.unidad || ']. ' ELSE '' END
             || e.accion,
           e.origen_id
    FROM public.v_clima_alertas_agro_eval e
    WHERE e.severidad IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.registro_alertas a WHERE a.origen_id = e.origen_id AND NOT a.resuelta)
    RETURNING 1
  ) SELECT count(*) INTO n_ab FROM i;

  WITH r AS (
    UPDATE public.registro_alertas a
    SET resuelta = true, fecha_resolucion = now()
    WHERE a.categoria = 'agroclimatica' AND NOT a.resuelta
      AND a.origen_id NOT IN (SELECT e.origen_id FROM public.v_clima_alertas_agro_eval e WHERE e.severidad IS NOT NULL)
    RETURNING 1
  ) SELECT count(*) INTO n_re FROM r;

  RETURN QUERY SELECT n_ab, n_up, n_re;
END;
$function$;

-- ── 2) Resumen mensual/rango: promedios sin lecturas imposibles ─────────────
CREATE OR REPLACE FUNCTION public.fn_clima_resumen_mensual(p_desde date, p_hasta date)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, n_muestras bigint, temp_c_prom numeric, viento_ms_prom numeric, viento_dir_deg_dominante numeric, rad_solar_wm2_prom numeric, lluvia_mm_acumulada numeric, dia_max_lluvia_fecha date, dia_max_lluvia_mm numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH ultima_del_dia AS (
    SELECT DISTINCT ON (l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date)
      l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia, l.lluvia_dia_mm
    FROM public.clima_estacion_lecturas l
    WHERE (l.ts AT TIME ZONE 'America/Chihuahua')::date >= p_desde
      AND (l.ts AT TIME ZONE 'America/Chihuahua')::date <= p_hasta
    ORDER BY l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date, l.ts DESC
  ),
  lluvia_mensual AS (
    SELECT estacion_id, SUM(lluvia_dia_mm) AS lluvia_mm_acumulada
    FROM ultima_del_dia
    GROUP BY estacion_id
  ),
  dia_max AS (
    SELECT DISTINCT ON (estacion_id)
      estacion_id, dia AS dia_max_lluvia_fecha, lluvia_dia_mm AS dia_max_lluvia_mm
    FROM ultima_del_dia
    WHERE lluvia_dia_mm IS NOT NULL AND lluvia_dia_mm > 0
    ORDER BY estacion_id, lluvia_dia_mm DESC, dia DESC
  )
  SELECT
    l.estacion_id,
    e.nombre AS estacion_nombre,
    COUNT(*) AS n_muestras,
    -- Lecturas fuera de rango físico (sensor averiado) no entran al promedio.
    ROUND((AVG(l.temp_c) FILTER (WHERE l.temp_c BETWEEN -25 AND 48))::numeric, 1) AS temp_c_prom,
    ROUND((AVG(l.viento_ms) FILTER (WHERE l.viento_ms BETWEEN 0 AND 50))::numeric, 2) AS viento_ms_prom,
    ROUND(
      (DEGREES(ATAN2(
        -AVG(SIN(RADIANS(l.viento_dir_deg))) ,
        -AVG(COS(RADIANS(l.viento_dir_deg)))
      )) + 360)::numeric % 360,
      0
    ) AS viento_dir_deg_dominante,
    ROUND((AVG(l.rad_solar_wm2) FILTER (WHERE l.rad_solar_wm2 BETWEEN 0 AND 1500))::numeric, 0) AS rad_solar_wm2_prom,
    ROUND(COALESCE(lm.lluvia_mm_acumulada, 0)::numeric, 1) AS lluvia_mm_acumulada,
    dm.dia_max_lluvia_fecha,
    ROUND(dm.dia_max_lluvia_mm::numeric, 1) AS dia_max_lluvia_mm
  FROM public.clima_estacion_lecturas l
  JOIN public.clima_estaciones e ON e.id = l.estacion_id
  LEFT JOIN lluvia_mensual lm ON lm.estacion_id = l.estacion_id
  LEFT JOIN dia_max dm ON dm.estacion_id = l.estacion_id
  WHERE (l.ts AT TIME ZONE 'America/Chihuahua')::date >= p_desde
    AND (l.ts AT TIME ZONE 'America/Chihuahua')::date <= p_hasta
  GROUP BY l.estacion_id, e.nombre, lm.lluvia_mm_acumulada, dm.dia_max_lluvia_fecha, dm.dia_max_lluvia_mm
  ORDER BY e.nombre;
$function$;

-- ── 3) Corridas conservadas del pronóstico ──────────────────────────────────
-- clima_pronostico_horario se SOBRESCRIBE cada hora (llave estación+valido_en), así
-- que no guarda "lo que se pronosticó con 24/48 h de anticipación". Esta tabla sí:
-- 2 corridas al día (00:20 y 12:20 hora local), 48 h cada una, retención 120 días.
CREATE TABLE IF NOT EXISTS public.clima_pronostico_snapshot (
  estacion_id  uuid        NOT NULL REFERENCES public.clima_estaciones(id) ON DELETE CASCADE,
  corrida_en   timestamptz NOT NULL,
  valido_en    timestamptz NOT NULL,
  horizonte_h  integer     NOT NULL,
  proveedor    text        NOT NULL DEFAULT 'open-meteo',
  temp_c       numeric,
  viento_ms    numeric,
  precip_mm    numeric,
  PRIMARY KEY (estacion_id, corrida_en, valido_en, proveedor)
);
CREATE INDEX IF NOT EXISTS clima_pronostico_snapshot_valido_idx ON public.clima_pronostico_snapshot (estacion_id, valido_en);
ALTER TABLE public.clima_pronostico_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "snapshot_pronostico_lectura" ON public.clima_pronostico_snapshot;
CREATE POLICY "snapshot_pronostico_lectura" ON public.clima_pronostico_snapshot FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.fn_clima_snapshot_pronostico()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  WITH ins AS (
    INSERT INTO public.clima_pronostico_snapshot (estacion_id, corrida_en, valido_en, horizonte_h, proveedor, temp_c, viento_ms, precip_mm)
    SELECT p.estacion_id, date_trunc('hour', now()), p.valido_en,
           (EXTRACT(EPOCH FROM (p.valido_en - date_trunc('hour', now()))) / 3600)::int,
           p.proveedor, p.temp_c, p.viento_ms, p.precip_mm
    FROM public.clima_pronostico_horario p
    WHERE p.valido_en >= date_trunc('hour', now()) AND p.valido_en <= date_trunc('hour', now()) + interval '48 hours'
    ON CONFLICT DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO n FROM ins;
  DELETE FROM public.clima_pronostico_snapshot WHERE corrida_en < now() - interval '120 days';
  RETURN n;
END;
$function$;

-- Hora UTC 06:20 y 18:20 = 00:20 y 12:20 en Chihuahua (UTC-6 fijo desde 2022).
SELECT cron.unschedule('clima-snapshot-pronostico-12h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clima-snapshot-pronostico-12h');
SELECT cron.schedule('clima-snapshot-pronostico-12h', '20 6,18 * * *', $$ SELECT public.fn_clima_snapshot_pronostico(); $$);

-- Primera corrida de inmediato, para empezar a acumular hoy.
SELECT public.fn_clima_snapshot_pronostico();

-- ── Verificación: temperatura y viento contra la lectura observada más cercana ──
-- Fuentes: snapshots (horizontes reales 0-48 h) + las horas ya vencidas de
-- clima_pronostico_horario (corrida de ~1 h antes: horizonte 0-6 h). Lectura
-- observada = la más cercana dentro de ±60 min (las estaciones reportan cada ~90 min).
-- Lecturas físicamente imposibles se excluyen.
CREATE OR REPLACE FUNCTION public.fn_clima_skill_variables(p_dias integer DEFAULT 14)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, rango_horizonte text, variable text, n bigint, mae numeric, sesgo numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fc AS (
    SELECT s.estacion_id, s.valido_en, s.horizonte_h, s.temp_c, s.viento_ms
    FROM public.clima_pronostico_snapshot s
    WHERE s.valido_en >= now() - make_interval(days => p_dias) AND s.valido_en < now() - interval '1 hour'
    UNION ALL
    SELECT h.estacion_id, h.valido_en, GREATEST(h.horizonte_h, 0), h.temp_c, h.viento_ms
    FROM public.clima_pronostico_horario h
    WHERE h.valido_en >= now() - make_interval(days => p_dias) AND h.valido_en < now() - interval '1 hour'
  ),
  par AS (
    SELECT f.estacion_id, f.horizonte_h, f.temp_c AS t_fc, f.viento_ms AS v_fc, o.temp_c AS t_obs, o.viento_ms AS v_obs
    FROM fc f
    JOIN LATERAL (
      SELECT l.temp_c, l.viento_ms FROM public.clima_estacion_lecturas l
      WHERE l.estacion_id = f.estacion_id AND l.ts BETWEEN f.valido_en - interval '60 minutes' AND f.valido_en + interval '60 minutes'
        AND (l.temp_c IS NULL OR l.temp_c BETWEEN -25 AND 48) AND (l.viento_ms IS NULL OR l.viento_ms BETWEEN 0 AND 50)
      ORDER BY abs(EXTRACT(EPOCH FROM (l.ts - f.valido_en))) LIMIT 1
    ) o ON true
  ),
  rango AS (
    SELECT *, CASE WHEN horizonte_h <= 6 THEN '0-6 h' WHEN horizonte_h <= 24 THEN '7-24 h' ELSE '25-48 h' END AS rg FROM par
  ),
  largo AS (
    SELECT estacion_id, rg, 'temperatura'::text AS variable, t_fc - t_obs AS err FROM rango WHERE t_fc IS NOT NULL AND t_obs IS NOT NULL
    UNION ALL
    SELECT estacion_id, rg, 'viento'::text, v_fc - v_obs FROM rango WHERE v_fc IS NOT NULL AND v_obs IS NOT NULL
  )
  SELECT g.estacion_id, e.nombre, g.rg, g.variable, count(*), round(avg(abs(g.err))::numeric, 2), round(avg(g.err)::numeric, 2)
  FROM largo g JOIN public.clima_estaciones e ON e.id = g.estacion_id
  GROUP BY g.estacion_id, e.nombre, g.rg, g.variable
  ORDER BY e.nombre, g.variable, g.rg;
$function$;

-- Lluvia: lámina del día local pronosticada (suma horaria de la corrida) vs la observada
-- (último lluvia_dia_mm del día). Solo días completos y con ≥ 20 horas pronosticadas.
CREATE OR REPLACE FUNCTION public.fn_clima_skill_lluvia_dia(p_dias integer DEFAULT 14)
 RETURNS TABLE(estacion_id uuid, estacion_nombre text, dia date, mm_pronosticado numeric, mm_observado numeric, error numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fc AS (
    SELECT h.estacion_id, (h.valido_en AT TIME ZONE 'America/Chihuahua')::date AS dia, sum(h.precip_mm) AS mm, count(*) AS n
    FROM public.clima_pronostico_horario h
    WHERE h.valido_en >= now() - make_interval(days => p_dias)
      AND (h.valido_en AT TIME ZONE 'America/Chihuahua')::date < (now() AT TIME ZONE 'America/Chihuahua')::date
    GROUP BY 1, 2 HAVING count(*) >= 20
  ),
  ob AS (
    SELECT DISTINCT ON (l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date)
      l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia, l.lluvia_dia_mm AS mm
    FROM public.clima_estacion_lecturas l
    WHERE l.ts >= now() - make_interval(days => p_dias + 1) AND l.lluvia_dia_mm IS NOT NULL
    ORDER BY l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date, l.ts DESC
  )
  SELECT fc.estacion_id, e.nombre, fc.dia, round(fc.mm::numeric, 1), round(ob.mm::numeric, 1), round((fc.mm - ob.mm)::numeric, 1)
  FROM fc JOIN ob ON ob.estacion_id = fc.estacion_id AND ob.dia = fc.dia
  JOIN public.clima_estaciones e ON e.id = fc.estacion_id
  ORDER BY e.nombre, fc.dia;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_clima_skill_variables(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clima_skill_lluvia_dia(integer) TO anon, authenticated;
