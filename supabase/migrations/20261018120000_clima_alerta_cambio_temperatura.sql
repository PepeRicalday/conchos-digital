-- ═══════════════════════════════════════════════════════════════════════════
-- Clima: alerta de CAMBIO BRUSCO de temperatura (descenso / ascenso en 24 h)
-- Fecha: 2026-10-18
--
-- Motivo: el temporal del 16-oct-2026 bajó la temperatura ~15-20 °C en las 6
-- estaciones y el modelo ya lo pronosticaba desde el 15-oct 12:00 (caída de
-- 19.7 °C en 24 h), pero ninguna alerta lo mostró: todas las reglas comparaban
-- un valor contra un umbral fijo (helada ≤4 °C, calor ≥36 °C), nunca el CAMBIO.
--
-- Regla: cambio = T(t) − T(t−24 h) a la MISMA hora del día (neutraliza el ciclo
-- diurno). Se evalúa sobre lo observado (última lectura plausible vs. la de hace
-- 24 h) y sobre el pronóstico horario de 48 h. Alerta DE RED: solo se abre si
-- ≥2 estaciones coinciden (un sensor solo no basta: San Rafael llegó a reportar
-- 82 °C y 25 °C de madrugada). La lectura observada con >8 °C de desviación
-- contra la mediana de la red se descarta, igual que en el resto de la vista.
--
-- Calibración (lecturas jul-oct 2026, 5 estaciones sin San Rafael): caída ≤ −8 °C
-- en 24 h ocurre en ~2 % de las lecturas, concentradas en 6 episodios de red
-- (7-ago, 17-ago, 19-sep, 22/23-sep, 16-oct); ascensos ≥ 8 °C son raros.
-- Umbrales editables en clima_umbrales: aviso 8 °C, crítico 12 °C.
--
-- La vista conserva las mismas columnas y orden; solo suma filas de red.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.clima_umbrales (clave, etiqueta, comparador, aviso, critico, unidad, accion) VALUES
  ('descenso', 'Descenso brusco de temperatura (cambio en 24 h, observado o pronóstico 48 h)', 'mayor', 8, 12, '°C',
   'Proteger cultivos sensibles al frío, vigilar heladas en los días siguientes y revisar la programación de riegos y aspersión.'),
  ('ascenso',  'Ascenso brusco de temperatura (cambio en 24 h, observado o pronóstico 48 h)',  'mayor', 8, 12, '°C',
   'Anticipar mayor demanda evaporativa y vigilar estrés hídrico en cultivos.')
ON CONFLICT (clave) DO NOTHING;

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
        ), cambio_obs AS (
         -- Cambio observado a la misma hora del día: última lectura plausible vs. la más cercana a 24 h antes.
         -- Solo cuenta si la lectura actual pasó el filtro de desviación contra la red (obs.temp_c no nulo).
         SELECT e.id AS est, p.temp_c - b.temp_c AS alza
           FROM clima_estaciones e
             JOIN obs o ON o.est = e.id AND o.temp_c IS NOT NULL
             JOIN LATERAL ( SELECT lc.ts, lc.temp_c FROM clima_estacion_lecturas lc
                             WHERE lc.estacion_id = e.id AND lc.ts > (now() - '06:00:00'::interval) AND lc.temp_c >= '-25'::integer::numeric AND lc.temp_c <= 48::numeric
                             ORDER BY lc.ts DESC LIMIT 1) p ON true
             JOIN LATERAL ( SELECT lb.temp_c FROM clima_estacion_lecturas lb
                             WHERE lb.estacion_id = e.id AND lb.temp_c >= '-25'::integer::numeric AND lb.temp_c <= 48::numeric
                               AND lb.ts BETWEEN p.ts - '26:00:00'::interval AND p.ts - '22:00:00'::interval
                             ORDER BY abs(EXTRACT(epoch FROM (p.ts - '24:00:00'::interval - lb.ts))) LIMIT 1) b ON true
          WHERE e.activa
        ), cambio_fc AS (
         -- Cambio pronosticado: T(h) − T(h−24 h) para cada hora de las próximas 48 h.
         SELECT f.estacion_id AS est, max(f0.temp_c - f.temp_c) AS caida, max(f.temp_c - f0.temp_c) AS alza
           FROM clima_pronostico_horario f
             JOIN clima_pronostico_horario f0 ON f0.estacion_id = f.estacion_id AND f0.proveedor = f.proveedor AND f0.valido_en = f.valido_en - '24:00:00'::interval
          WHERE f.valido_en > now() AND f.valido_en <= (now() + '48:00:00'::interval) AND f.temp_c IS NOT NULL AND f0.temp_c IS NOT NULL
          GROUP BY f.estacion_id
        ), cambio_v AS (
         SELECT e.id AS est, 'descenso'::text AS clave, GREATEST(-co.alza, cf.caida) AS v, -co.alza AS vo, cf.caida AS vf
           FROM clima_estaciones e LEFT JOIN cambio_obs co ON co.est = e.id LEFT JOIN cambio_fc cf ON cf.est = e.id WHERE e.activa
        UNION ALL
         SELECT e.id, 'ascenso'::text, GREATEST(co.alza, cf.alza), co.alza, cf.alza
           FROM clima_estaciones e LEFT JOIN cambio_obs co ON co.est = e.id LEFT JOIN cambio_fc cf ON cf.est = e.id WHERE e.activa
        ), red_cambio AS (
         -- Alerta de red: mediana del cambio entre las estaciones que superan el umbral de aviso, si coinciden ≥ 2.
         SELECT c.clave, count(*) AS n,
                (percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (c.v::double precision)))::numeric AS valor,
                (percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (c.vo::double precision)))::numeric AS v_o,
                (percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (c.vf::double precision)))::numeric AS v_f
           FROM cambio_v c JOIN clima_umbrales u ON u.clave = c.clave AND u.activo
          WHERE c.v >= u.aviso
          GROUP BY c.clave HAVING count(*) >= 2
        ), largo AS (
         SELECT est, nombre, modulo_id, 'helada'::text AS clave, tmin AS valor, t_obs AS v_o, tmin_fc AS v_f FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'calor'::text, tmax, t_obs, tmax_fc FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'viento'::text, viento, v_obs, v_fc FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'lluvia'::text, lluvia, l_obs, l_fc FROM medidas
        UNION ALL SELECT est, nombre, modulo_id, 'eto'::text, eto, NULL::numeric, eto FROM medidas
        UNION ALL SELECT '00000000-0000-0000-0000-000000000000'::uuid, 'Red de estaciones (' || r.n || ' coinciden)', NULL::text, r.clave, r.valor, r.v_o, r.v_f FROM red_cambio r
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
