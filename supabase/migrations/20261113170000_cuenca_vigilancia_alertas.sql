-- Cuenca del Conchos · alertas persistidas (punto 4 del plan de auditoría 2026-11-13).
-- Misma regla que utils/alertasCuenca.ts del Dashboard, pero guardada en registro_alertas para que también salga en el
-- Centro de Alertas (/alertas) y en el menú. Patrón de fn_clima_vigilar_red: abre si no hay una abierta con ese origen_id,
-- actualiza el texto mientras siga vigente y la resuelve sola cuando la condición desaparece. origen_id = 'CUENCA:<clave>'
-- (la app usa el id 'cuenca-<clave>' y así no duplica la alerta viva con la persistida).
-- Aplicar con autorización expresa (no usar db push).

CREATE OR REPLACE FUNCTION public.fn_cuenca_vigilar()
RETURNS TABLE (abiertas integer, actualizadas integer, resueltas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n_ab integer := 0; n_up integer := 0; n_re integer := 0; r record;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _cuenca_alertas (clave text, tipo_riesgo text, categoria text, titulo text, mensaje text) ON COMMIT DROP;
  DELETE FROM _cuenca_alertas;

  -- 1. Presas de la cuenca fuera del distrito con menos de 20 % del NAMO (las del distrito ya tienen su alerta de nivel).
  INSERT INTO _cuenca_alertas
  SELECT 'presa-critica', 'warning', 'nivel_critico', 'Presas de la cuenca con almacenamiento crítico',
         string_agg(nombre || ' ' || to_char(round(pct_namo::numeric, 1), 'FM990.0') || ' %', ', ' ORDER BY pct_namo)
           || ' del NAMO (menos de 20 %). Afecta el escurrimiento hacia el distrito.'
  FROM public.v_aqwp_presas_estado
  WHERE tipo = 'presa' AND presa_id IS NULL AND pct_namo IS NOT NULL AND pct_namo < 20 AND COALESCE(NOT almacenamiento_estancado, true)
  HAVING count(*) > 0;

  -- 2. CONAGUA repite el último dato de una presa (aunque hay aportación o extracción).
  INSERT INTO _cuenca_alertas
  SELECT 'lectura-repetida', 'warning', 'fuente_datos', 'CONAGUA repite el último dato de una presa',
         string_agg(nombre || COALESCE(' (' || almacenamiento_dias_igual || ' d igual)', ''), ', ' ORDER BY nombre)
           || ': el almacenamiento no cambia aunque hay aportación o extracción. Se muestra el último dato obtenido.'
  FROM public.v_aqwp_presas_estado
  WHERE tipo = 'presa' AND almacenamiento_estancado IS TRUE
  HAVING count(*) > 0;

  -- 3. Fuentes de la cuenca sin actualizar (más de 3 veces su cadencia). Las GOES tienen su propia alerta (GOES-DCP-SYNC).
  INSERT INTO _cuenca_alertas
  SELECT 'fuente-sin-actualizar', 'warning', 'fuente_datos',
         CASE WHEN count(*) = 1 THEN 'Fuente de la cuenca sin actualizar' ELSE 'Fuentes de la cuenca sin actualizar' END,
         string_agg(nombre || ' (' || CASE WHEN edad_min < 1440 THEN round(edad_min / 60.0)::text || ' h' ELSE round(edad_min / 1440.0)::text || ' d' END || ')', '; ' ORDER BY edad_min DESC)
           || '. Lleva más de 3 veces su cadencia normal sin dato nuevo.'
  FROM (
    SELECT nombre, EXTRACT(EPOCH FROM (now() - ultimo_en)) / 60.0 AS edad_min, esperado_min
    FROM public.v_cuenca_salud_fuentes
    WHERE clave NOT LIKE 'goes:%' AND ultimo_en IS NOT NULL AND esperado_min > 0
  ) f
  WHERE f.edad_min > 3 * f.esperado_min
  HAVING count(*) > 0;

  -- 4. Cierres de los 2 últimos meses cuyas fuentes discrepan.
  INSERT INTO _cuenca_alertas
  SELECT 'cierres-difieren', 'info', 'fuente_datos', 'Cierres de la cuenca con fuentes que difieren',
         string_agg(c.etiqueta || ' (' || to_char(m.mes, 'YYYY-MM') || COALESCE(', ' || to_char(round(m.dif_max_fuentes_mm3::numeric, 1), 'FM990.0') || ' Mm³', '') || ')', ', ' ORDER BY m.mes DESC, m.dif_max_fuentes_mm3 DESC NULLS LAST)
           || ': dos fuentes discrepan más de 0.5 Mm³ o 0.5 %. Revise el cuadre en Cuenca → Balance → Cierres mensuales.'
  FROM public.cuerpos_agua_cierre_mensual m
  JOIN public.cuerpos_agua c ON c.id = m.cuerpo_id
  WHERE m.calidad = 'DIFIERE' AND m.mes >= (date_trunc('month', now() AT TIME ZONE 'America/Chihuahua') - interval '2 months')::date
  HAVING count(*) > 0;

  -- Abrir lo nuevo y mantener al día el texto de lo que sigue vigente.
  FOR r IN SELECT * FROM _cuenca_alertas LOOP
    IF EXISTS (SELECT 1 FROM public.registro_alertas a WHERE a.origen_id = 'CUENCA:' || r.clave AND NOT a.resuelta) THEN
      UPDATE public.registro_alertas a SET titulo = r.titulo, mensaje = r.mensaje, tipo_riesgo = r.tipo_riesgo
      WHERE a.origen_id = 'CUENCA:' || r.clave AND NOT a.resuelta AND (a.mensaje IS DISTINCT FROM r.mensaje OR a.titulo IS DISTINCT FROM r.titulo);
      IF FOUND THEN n_up := n_up + 1; END IF;
    ELSE
      INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id)
      VALUES (r.tipo_riesgo, r.categoria, r.titulo, r.mensaje, 'CUENCA:' || r.clave);
      n_ab := n_ab + 1;
    END IF;
  END LOOP;

  -- Resolver lo que ya no aplica.
  UPDATE public.registro_alertas a SET resuelta = true, fecha_resolucion = now()
  WHERE a.origen_id LIKE 'CUENCA:%' AND NOT a.resuelta
    AND a.origen_id NOT IN (SELECT 'CUENCA:' || clave FROM _cuenca_alertas);
  GET DIAGNOSTICS n_re = ROW_COUNT;

  RETURN QUERY SELECT n_ab, n_up, n_re;
END $$;

REVOKE ALL ON FUNCTION public.fn_cuenca_vigilar() FROM PUBLIC, anon, authenticated;

-- Cada 30 min, entre las corridas de vigilancia de clima (:05 y :35).
SELECT cron.schedule('cuenca-vigilancia-30min', '20,50 * * * *', $c$ SELECT public.fn_cuenca_vigilar(); $c$);
