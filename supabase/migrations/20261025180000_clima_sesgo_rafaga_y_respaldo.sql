-- 1) Ráfaga: el sesgo se mide por estación (antes constantes fijas 3.2 m/s módulos / 1.1 presas en la vista de alertas;
--    medido en 30 días: módulos 2.9-3.5, Boquilla 1.7, Las Vírgenes 0.8).
-- 2) Respaldo para estaciones sin sesgo propio (Riego San Rafael: su viento observado es S/D por sensor roto): se usa la
--    MEDIANA de los módulos, rotulada origen='mediana_modulos'. Mismo modelo, misma región, sesgos de módulos coherentes
--    entre sí (1.8-2.4 m/s). Solo viento y ráfaga; la temperatura de esa estación no se corrige (no hay base).

ALTER TABLE public.clima_sesgo_vigente DROP CONSTRAINT IF EXISTS clima_sesgo_vigente_variable_check;
ALTER TABLE public.clima_sesgo_vigente ADD CONSTRAINT clima_sesgo_vigente_variable_check
  CHECK (variable IN ('temperatura','viento','rafaga'));
ALTER TABLE public.clima_sesgo_vigente ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'propio';

ALTER TABLE public.clima_pronostico_horario ADD COLUMN IF NOT EXISTS viento_rafaga_ms_corr numeric;

CREATE OR REPLACE FUNCTION public.fn_clima_aplica_sesgo()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE s_t numeric; s_v numeric; s_g numeric;
BEGIN
  SELECT sesgo INTO s_t FROM clima_sesgo_vigente WHERE estacion_id = NEW.estacion_id AND variable = 'temperatura' AND aplicar;
  SELECT sesgo INTO s_v FROM clima_sesgo_vigente WHERE estacion_id = NEW.estacion_id AND variable = 'viento' AND aplicar;
  SELECT sesgo INTO s_g FROM clima_sesgo_vigente WHERE estacion_id = NEW.estacion_id AND variable = 'rafaga' AND aplicar;
  NEW.temp_c_corr           := CASE WHEN NEW.temp_c IS NULL THEN NULL ELSE NEW.temp_c - COALESCE(s_t, 0) END;
  NEW.viento_ms_corr        := CASE WHEN NEW.viento_ms IS NULL THEN NULL ELSE GREATEST(0, NEW.viento_ms - COALESCE(s_v, 0)) END;
  NEW.viento_rafaga_ms_corr := CASE WHEN NEW.viento_rafaga_ms IS NULL THEN NULL ELSE GREATEST(0, NEW.viento_rafaga_ms - COALESCE(s_g, 0)) END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_clima_actualizar_sesgo()
RETURNS integer LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE filas integer;
BEGIN
  -- Sesgo propio de temperatura y viento (desde la verificación horaria).
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

  -- Sesgo propio de ráfaga (corridas conservadas contra la ráfaga observada, ±60 min).
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

  -- Respaldo: estaciones activas sin sesgo propio de viento/ráfaga usan la mediana de los módulos (si hay ≥ 2).
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
END $$;

-- La vista de alertas deja de restar constantes: lee la ráfaga corregida (con respaldo al crudo).
DO $$
DECLARE d text; d2 text;
BEGIN
  d := pg_get_viewdef('public.v_clima_alertas_agro_eval'::regclass);
  d2 := replace(d, 'max(clima_pronostico_horario.viento_rafaga_ms) AS gmax',
                   'max(COALESCE(clima_pronostico_horario.viento_rafaga_ms_corr, clima_pronostico_horario.viento_rafaga_ms)) AS gmax');
  d2 := regexp_replace(d2, '\(fc\.gmax -\s+CASE\s+WHEN \(e\.rol = ''presa''::text\) THEN 1\.1\s+ELSE 3\.2\s+END\)', 'fc.gmax', 'g');
  IF d2 = d OR position('viento_rafaga_ms_corr' in d2) = 0 OR position('THEN 1.1' in d2) > 0 THEN
    RAISE EXCEPTION 'La definicion de la vista no contiene los fragmentos esperados; no se modifica nada';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_clima_alertas_agro_eval WITH (security_invoker=on) AS ' || d2;
END $$;

SELECT public.fn_clima_actualizar_sesgo();
-- Recalcula *_corr de todo lo guardado con el trigger nuevo (no cambia corrida_en, así que no genera corridas extra).
UPDATE public.clima_pronostico_horario SET temp_c = temp_c;
