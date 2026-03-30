-- ============================================================
-- fn_balance_hidrico_tramos
-- Balance de masa por tramo entre escalas consecutivas.
-- Detecta extracciones no registradas (fugas) comparando:
--   Q_entrada_tramo - Q_salida_tramo - Q_tomas_registradas
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_balance_hidrico_tramos(date);

CREATE OR REPLACE FUNCTION public.fn_balance_hidrico_tramos(
  p_fecha DATE DEFAULT NULL
)
RETURNS TABLE (
  fecha_dato           DATE,
  km_inicio            NUMERIC,
  km_fin               NUMERIC,
  escala_entrada       TEXT,
  escala_salida        TEXT,
  q_entrada_m3s        NUMERIC,
  q_salida_m3s         NUMERIC,
  q_tomas_registradas  NUMERIC,
  q_fuga_detectada     NUMERIC,
  estado_balance       TEXT
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_fecha_lectura DATE;
  v_fecha_tomas   DATE;
BEGIN
  -- Zona horaria local para tomas del dia
  IF p_fecha IS NULL THEN
    v_fecha_tomas := (NOW() AT TIME ZONE 'America/Chihuahua')::date;
  ELSE
    v_fecha_tomas := p_fecha;
  END IF;

  -- Lecturas: usar ultima fecha disponible con gasto calculado
  -- (evita el problema UTC vs Chihuahua en lecturas_escalas)
  SELECT MAX(le.fecha) INTO v_fecha_lectura
  FROM public.lecturas_escalas le
  WHERE le.gasto_calculado_m3s IS NOT NULL
    AND le.gasto_calculado_m3s > 0;

  IF v_fecha_lectura IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH lecturas AS (
    SELECT DISTINCT ON (le.escala_id)
      e.id,
      e.nombre,
      e.km,
      le.gasto_calculado_m3s AS q_m3s,
      le.fecha               AS f
    FROM public.escalas e
    JOIN public.lecturas_escalas le ON le.escala_id = e.id
    WHERE le.fecha = v_fecha_lectura
      AND le.gasto_calculado_m3s IS NOT NULL
      AND le.gasto_calculado_m3s > 0
      AND e.activa = true
      AND e.km BETWEEN 0 AND 104
    ORDER BY le.escala_id, le.hora_lectura DESC
  ),
  pares AS (
    SELECT
      a.km        AS km_ini,
      b.km        AS km_fin_p,
      a.nombre    AS esc_ent,
      b.nombre    AS esc_sal,
      a.q_m3s     AS q_ent,
      b.q_m3s     AS q_sal,
      a.f         AS fecha_d
    FROM lecturas a
    JOIN lecturas b ON b.km = (
      SELECT MIN(km) FROM lecturas WHERE km > a.km
    )
  ),
  tomas AS (
    SELECT
      pe.km,
      SUM(rd.caudal_promedio_m3s) AS q_reg
    FROM public.puntos_entrega pe
    JOIN public.reportes_diarios rd ON rd.punto_id = pe.id
    WHERE rd.fecha = v_fecha_tomas
      AND rd.estado IN ('inicio', 'continua', 'reabierto', 'modificacion')
      AND rd.hora_cierre IS NULL
      AND rd.caudal_promedio_m3s > 0
    GROUP BY pe.km
  ),
  balance AS (
    SELECT
      p.fecha_d,
      p.km_ini,
      p.km_fin_p,
      p.esc_ent,
      p.esc_sal,
      ROUND(p.q_ent::numeric, 3)                              AS q_e,
      ROUND(p.q_sal::numeric, 3)                              AS q_s,
      ROUND(COALESCE(SUM(t.q_reg), 0)::numeric, 3)           AS q_t,
      ROUND((p.q_ent - p.q_sal
        - COALESCE(SUM(t.q_reg), 0))::numeric, 3)            AS q_fuga
    FROM pares p
    LEFT JOIN tomas t ON t.km > p.km_ini AND t.km <= p.km_fin_p
    GROUP BY p.fecha_d, p.km_ini, p.km_fin_p,
             p.esc_ent, p.esc_sal, p.q_ent, p.q_sal
  )
  SELECT
    b.fecha_d,
    b.km_ini,
    b.km_fin_p,
    b.esc_ent,
    b.esc_sal,
    b.q_e,
    b.q_s,
    b.q_t,
    b.q_fuga,
    CASE
      WHEN b.q_fuga > 2.0  THEN 'FUGA_ALTA'
      WHEN b.q_fuga > 0.5  THEN 'FUGA_MEDIA'
      WHEN b.q_fuga < -0.5 THEN 'INCONSISTENCIA'
      ELSE                      'BALANCEADO'
    END
  FROM balance b
  ORDER BY b.km_ini;
END;
$$;

COMMENT ON FUNCTION public.fn_balance_hidrico_tramos(date) IS
  'Balance hidrico por tramo entre escalas consecutivas. '
  'q_fuga_detectada > 0 indica extraccion no registrada o perdida real en el tramo. '
  'Lecturas: usa ultima fecha disponible (evita UTC vs Chihuahua). '
  'Tomas: usa p_fecha (fecha local Chihuahua si NULL).';

GRANT EXECUTE ON FUNCTION public.fn_balance_hidrico_tramos(date) TO authenticated;
