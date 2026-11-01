-- Corrección del ETo pronosticado por estación (mismo patrón que temperatura/viento/ráfaga,
-- ver 20261025120000_clima_sesgo_correccion.sql y 20261025180000_clima_sesgo_rafaga_y_respaldo.sql).
--
-- El ETo es una magnitud acumulada y proporcional a la demanda atmosférica: se corrige con un
-- FACTOR MULTIPLICATIVO (no un sesgo aditivo). En clima_sesgo_vigente, para variable='eto' la
-- columna `sesgo` guarda ese factor (obs/pron) y `mae_crudo` el error absoluto medio diario (mm).
--
-- Factor = Σ ET diario observado (WeatherLink et_dia_mm, máximo del día local con lectura ≥ 20 h)
--        / Σ ETo pronosticado del mismo día (suma de las 24 h de clima_pronostico_horario.eto_fc_mm),
-- últimos 30 días, por estación. Se aplica solo con ≥ 14 días y |1 − factor| ≥ 0.10.
-- Verificación 2026-11-01 (13 días): factores 0.90–1.04 → hoy ninguna estación lo aplica; el
-- pronóstico de ETo está bien calibrado. El mecanismo queda listo por si deriva.
-- Nota: las horas pasadas de clima_pronostico_horario conservan la última corrida antes de su
-- hora (horizonte corto), así que el factor mide sesgo del modelo, no error a 24 h.

ALTER TABLE public.clima_pronostico_horario ADD COLUMN IF NOT EXISTS eto_fc_mm_corr numeric;

ALTER TABLE public.clima_sesgo_vigente DROP CONSTRAINT IF EXISTS clima_sesgo_vigente_variable_check;
ALTER TABLE public.clima_sesgo_vigente ADD CONSTRAINT clima_sesgo_vigente_variable_check
  CHECK (variable = ANY (ARRAY['temperatura'::text, 'viento'::text, 'rafaga'::text, 'eto'::text]));

CREATE OR REPLACE FUNCTION public.fn_clima_aplica_sesgo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE s_t numeric; s_v numeric; s_g numeric; f_e numeric;
BEGIN
  SELECT sesgo INTO s_t FROM clima_sesgo_vigente WHERE estacion_id = NEW.estacion_id AND variable = 'temperatura' AND aplicar;
  SELECT sesgo INTO s_v FROM clima_sesgo_vigente WHERE estacion_id = NEW.estacion_id AND variable = 'viento' AND aplicar;
  SELECT sesgo INTO s_g FROM clima_sesgo_vigente WHERE estacion_id = NEW.estacion_id AND variable = 'rafaga' AND aplicar;
  SELECT sesgo INTO f_e FROM clima_sesgo_vigente WHERE estacion_id = NEW.estacion_id AND variable = 'eto' AND aplicar;
  NEW.temp_c_corr           := CASE WHEN NEW.temp_c IS NULL THEN NULL ELSE NEW.temp_c - COALESCE(s_t, 0) END;
  NEW.viento_ms_corr        := CASE WHEN NEW.viento_ms IS NULL THEN NULL ELSE GREATEST(0, NEW.viento_ms - COALESCE(s_v, 0)) END;
  NEW.viento_rafaga_ms_corr := CASE WHEN NEW.viento_rafaga_ms IS NULL THEN NULL ELSE GREATEST(0, NEW.viento_rafaga_ms - COALESCE(s_g, 0)) END;
  NEW.eto_fc_mm_corr        := CASE WHEN NEW.eto_fc_mm IS NULL THEN NULL ELSE GREATEST(0, NEW.eto_fc_mm * COALESCE(f_e, 1)) END;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_clima_actualizar_sesgo()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE filas integer;
BEGIN
  INSERT INTO clima_sesgo_vigente (estacion_id, variable, sesgo, n, mae_crudo, aplicar, actualizado_en, origen)
  SELECT estacion_id, variable,
         round((sum(sesgo * n) / sum(n))::numeric, 2), sum(n)::int, round((sum(mae * n) / sum(n))::numeric, 2),
         sum(n) >= 100 AND abs(sum(sesgo * n) / sum(n)) >= CASE variable WHEN 'temperatura' THEN 0.5 ELSE 0.8 END,
         now(), 'propio'
  FROM fn_clima_skill_variables(30) GROUP BY estacion_id, variable
  ON CONFLICT (estacion_id, variable) DO UPDATE
    SET sesgo = EXCLUDED.sesgo, n = EXCLUDED.n, mae_crudo = EXCLUDED.mae_crudo,
        aplicar = EXCLUDED.aplicar, actualizado_en = EXCLUDED.actualizado_en, origen = 'propio';
  GET DIAGNOSTICS filas = ROW_COUNT;

  INSERT INTO clima_sesgo_vigente (estacion_id, variable, sesgo, n, mae_crudo, aplicar, actualizado_en, origen)
  SELECT k.estacion_id, 'rafaga', round(avg(k.viento_rafaga_ms - o.g)::numeric, 2), count(*)::int,
         round(avg(abs(k.viento_rafaga_ms - o.g))::numeric, 2),
         count(*) >= 100 AND abs(avg(k.viento_rafaga_ms - o.g)) >= 0.8, now(), 'propio'
  FROM clima_pronostico_corridas k
  JOIN LATERAL (
    SELECT l.viento_rafaga_ms AS g FROM clima_estacion_lecturas l
    WHERE l.estacion_id = k.estacion_id AND l.viento_rafaga_ms BETWEEN 0 AND 60
      AND l.ts BETWEEN k.valido_en - interval '60 minutes' AND k.valido_en + interval '60 minutes'
    ORDER BY abs(EXTRACT(EPOCH FROM (l.ts - k.valido_en))) LIMIT 1
  ) o ON true
  WHERE k.viento_rafaga_ms IS NOT NULL AND k.valido_en >= now() - interval '30 days' AND k.valido_en < now() - interval '1 hour'
  GROUP BY k.estacion_id
  ON CONFLICT (estacion_id, variable) DO UPDATE
    SET sesgo = EXCLUDED.sesgo, n = EXCLUDED.n, mae_crudo = EXCLUDED.mae_crudo,
        aplicar = EXCLUDED.aplicar, actualizado_en = EXCLUDED.actualizado_en, origen = 'propio';

  -- ETo: factor multiplicativo diario (obs / pron), ver encabezado de la migración.
  INSERT INTO clima_sesgo_vigente (estacion_id, variable, sesgo, n, mae_crudo, aplicar, actualizado_en, origen)
  SELECT d.estacion_id, 'eto',
         round((sum(d.obs) / NULLIF(sum(d.fc), 0))::numeric, 3), count(*)::int,
         round(avg(abs(d.obs - d.fc))::numeric, 2),
         count(*) >= 14 AND sum(d.fc) > 0 AND abs(1 - sum(d.obs) / sum(d.fc)) >= 0.10,
         now(), 'propio'
  FROM (
    SELECT o.estacion_id, o.dia, o.obs, f.fc
    FROM (
      SELECT l.estacion_id, (l.ts AT TIME ZONE 'America/Chihuahua')::date AS dia, max(l.et_dia_mm) AS obs,
             max(EXTRACT(hour FROM l.ts AT TIME ZONE 'America/Chihuahua')) AS ult_h
      FROM clima_estacion_lecturas l
      WHERE l.ts >= now() - interval '31 days' AND l.et_dia_mm BETWEEN 0 AND 20
      GROUP BY 1, 2
    ) o
    JOIN (
      SELECT h.estacion_id, (h.valido_en AT TIME ZONE 'America/Chihuahua')::date AS dia, sum(h.eto_fc_mm) AS fc, count(*) AS horas
      FROM clima_pronostico_horario h
      WHERE h.valido_en >= now() - interval '31 days' AND h.valido_en < now() AND h.eto_fc_mm IS NOT NULL
      GROUP BY 1, 2
    ) f ON f.estacion_id = o.estacion_id AND f.dia = o.dia
    WHERE f.horas = 24 AND o.ult_h >= 20 AND o.dia < (now() AT TIME ZONE 'America/Chihuahua')::date
  ) d
  GROUP BY d.estacion_id
  ON CONFLICT (estacion_id, variable) DO UPDATE
    SET sesgo = EXCLUDED.sesgo, n = EXCLUDED.n, mae_crudo = EXCLUDED.mae_crudo,
        aplicar = EXCLUDED.aplicar, actualizado_en = EXCLUDED.actualizado_en, origen = 'propio';

  INSERT INTO clima_sesgo_vigente (estacion_id, variable, sesgo, n, mae_crudo, aplicar, actualizado_en, origen)
  SELECT e.id, m.variable, m.mediana, 0, NULL, true, now(), 'mediana_modulos'
  FROM clima_estaciones e
  CROSS JOIN (
    SELECT s.variable, round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.sesgo)::numeric, 2) AS mediana, count(*) AS k
    FROM clima_sesgo_vigente s JOIN clima_estaciones em ON em.id = s.estacion_id
    WHERE em.rol = 'modulo' AND s.aplicar AND s.origen = 'propio' AND s.variable IN ('viento','rafaga')
    GROUP BY s.variable
  ) m
  WHERE e.activa AND m.k >= 2
    AND NOT EXISTS (SELECT 1 FROM clima_sesgo_vigente p WHERE p.estacion_id = e.id AND p.variable = m.variable AND p.origen = 'propio')
  ON CONFLICT (estacion_id, variable) DO UPDATE
    SET sesgo = EXCLUDED.sesgo, aplicar = true, actualizado_en = EXCLUDED.actualizado_en, origen = 'mediana_modulos'
    WHERE clima_sesgo_vigente.origen = 'mediana_modulos';

  RETURN filas;
END $function$;

-- Calcular el factor ahora y rellenar eto_fc_mm_corr en las filas existentes.
SELECT public.fn_clima_actualizar_sesgo();
UPDATE public.clima_pronostico_horario h
   SET eto_fc_mm_corr = CASE WHEN h.eto_fc_mm IS NULL THEN NULL
       ELSE GREATEST(0, h.eto_fc_mm * COALESCE((SELECT s.sesgo FROM public.clima_sesgo_vigente s
             WHERE s.estacion_id = h.estacion_id AND s.variable = 'eto' AND s.aplicar), 1)) END
 WHERE h.valido_en >= now() - interval '2 days';
