-- Las alertas de calor/helada/viento comparaban contra el pronóstico CRUDO. El modelo sobrestima el viento en los
-- módulos (+1.8 a +2.4 m/s medidos en 14 días): con umbral de aviso de 6 m/s eso generaba avisos de más
-- (25-oct: Módulo 3 marcaba 6.8 m/s y corregido son 4.4). La vista pasa a leer *_corr (con respaldo al crudo).
-- La definición se reescribe a partir de la vigente para no duplicar ~250 líneas; si los fragmentos no existen, aborta.
DO $$
DECLARE d text; d2 text;
BEGIN
  d := pg_get_viewdef('public.v_clima_alertas_agro_eval'::regclass);
  d2 := d;
  d2 := replace(d2, 'min(clima_pronostico_horario.temp_c) AS tmin', 'min(COALESCE(clima_pronostico_horario.temp_c_corr, clima_pronostico_horario.temp_c)) AS tmin');
  d2 := replace(d2, 'max(clima_pronostico_horario.temp_c) AS tmax', 'max(COALESCE(clima_pronostico_horario.temp_c_corr, clima_pronostico_horario.temp_c)) AS tmax');
  d2 := replace(d2, 'max(clima_pronostico_horario.viento_ms) AS vmax', 'max(COALESCE(clima_pronostico_horario.viento_ms_corr, clima_pronostico_horario.viento_ms)) AS vmax');
  IF d2 = d OR position('viento_ms_corr' in d2) = 0 OR position('temp_c_corr' in d2) = 0 THEN
    RAISE EXCEPTION 'La definicion de la vista no contiene los fragmentos esperados; no se modifica nada';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_clima_alertas_agro_eval WITH (security_invoker=on) AS ' || d2;
END $$;
