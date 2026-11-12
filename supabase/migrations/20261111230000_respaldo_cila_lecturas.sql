-- REGLA: si por algún motivo no hay captura de un día (una semana, un mes), el dato de CILA ocupa su lugar en lecturas_presas,
-- tanto para el día actual como para los anteriores. La captura manual SIEMPRE prevalece: solo se toca un día sin lectura o
-- con lectura sin almacenamiento (p. ej. solo extracción). Nunca se sobrescribe una captura.
-- La ingesta CILA (edge function presas-cila-sync) ya lo hace día a día; esta función es la red de seguridad que lo repara
-- si esa ingesta falló o llegó tarde. La elevación queda sin calcular (S/D) hasta que la ingesta normal la complete.
CREATE OR REPLACE FUNCTION public.fn_respaldo_cila_lecturas(p_desde date DEFAULT NULL)
RETURNS TABLE (presa_id text, fecha date, accion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
#variable_conflict use_column
DECLARE
  v_marca constant text := 'Nivel: CILA-IBWC (respaldo: sin captura del día; elevación sin calcular)';
BEGIN
  -- 1) Días con dato CILA y sin ninguna lectura: se insertan.
  RETURN QUERY
  WITH nuevos AS (
    INSERT INTO lecturas_presas (id, presa_id, fecha, almacenamiento_mm3, porcentaje_llenado, responsable, notas)
    SELECT 'CILA-' || c.presa_id || '-' || c.fecha, c.presa_id, c.fecha, c.almacenamiento_mm3,
           round((c.almacenamiento_mm3 / p.capacidad_max * 100)::numeric, 2), 'CILA-IBWC', v_marca
    FROM lecturas_presas_cila c
    JOIN presas p ON p.id = c.presa_id AND p.capacidad_max > 0
    WHERE c.almacenamiento_mm3 IS NOT NULL
      AND c.fecha >= COALESCE(p_desde, date '2021-01-01')
      AND NOT EXISTS (SELECT 1 FROM lecturas_presas l WHERE l.presa_id = c.presa_id AND l.fecha = c.fecha)
    ON CONFLICT (presa_id, fecha) DO NOTHING
    RETURNING lecturas_presas.presa_id, lecturas_presas.fecha
  )
  SELECT n.presa_id, n.fecha, 'insertada'::text FROM nuevos n;

  -- 2) Días con lectura pero SIN almacenamiento (p. ej. solo gasto): se completa solo el nivel, sin tocar lo demás.
  RETURN QUERY
  WITH completados AS (
    UPDATE lecturas_presas l
       SET almacenamiento_mm3 = c.almacenamiento_mm3,
           porcentaje_llenado = round((c.almacenamiento_mm3 / p.capacidad_max * 100)::numeric, 2),
           notas = CASE WHEN l.notas IS NULL OR l.notas = '' THEN v_marca ELSE l.notas || ' · ' || v_marca END
      FROM lecturas_presas_cila c, presas p
     WHERE c.presa_id = l.presa_id AND c.fecha = l.fecha AND p.id = l.presa_id AND p.capacidad_max > 0
       AND l.almacenamiento_mm3 IS NULL AND c.almacenamiento_mm3 IS NOT NULL
       AND l.fecha >= COALESCE(p_desde, date '2021-01-01')
    RETURNING l.presa_id, l.fecha
  )
  SELECT k.presa_id, k.fecha, 'completada'::text FROM completados k;
END $$;

REVOKE ALL ON FUNCTION public.fn_respaldo_cila_lecturas(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_respaldo_cila_lecturas(date) TO service_role;

-- Después de la ingesta CILA de las 22:00 UTC (la de la mañana corre 15–17 UTC y 18:00).
SELECT cron.unschedule('presas-cila-respaldo-lecturas') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'presas-cila-respaldo-lecturas');
SELECT cron.schedule('presas-cila-respaldo-lecturas', '20 22 * * *', $cron$SELECT * FROM public.fn_respaldo_cila_lecturas();$cron$);
