-- ═══════════════════════════════════════════════════════════════════════════
-- Balance mensual por vaso (entradas, salidas, ΔS, residuo)   Fecha: 2026-11-11
--
-- Guarda, no recalcula en pantalla. Fuente de los flujos: AQWP (CONAGUA vía USIBWC), por lo que solo hay
-- balance para los cuerpos con aqwp_ubicacion_id (7 de 9; La Colina y Piedras Azules quedan sin fila = S/D).
--
--   ΔS       = almacenamiento de cierre del mes − cierre del mes anterior (cuerpos_agua_cierre_mensual).
--   entradas = aportación media × días del mes   (m³/s × 0.0864 = Mm³/día)
--   salida   = extracción TOTAL media × días     (extraccion_total YA incluye el vertido: en todos los días
--              con vertido de las 7 presas, extraccion_total = extraccion + vertido. NO se resta dos veces.)
--   residuo  = entradas − salida − ΔS            (evaporación + filtraciones + error; ver advertencia)
--
-- ADVERTENCIA: la aportación de CONAGUA suele deducirse de la operación del vaso, de modo que el residuo mide
-- CONSISTENCIA entre series, no un error independiente. La evaporación (evap_mm3), su método y el error de
-- cierre quedan S/D en esta etapa: no se inventan.
-- Cobertura: media sobre los días con dato; con < 50 % de días el flujo es S/D. OK ≥ 90 %, PARCIAL 50-90 %.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cuerpos_agua_balance_mensual (
  cuerpo_id         text    NOT NULL REFERENCES public.cuerpos_agua (id) ON DELETE CASCADE,
  mes               date    NOT NULL,                 -- primer día del mes
  fecha_cierre      date    NOT NULL,
  s_ini_mm3         numeric,                          -- cierre del mes anterior
  s_fin_mm3         numeric,                          -- cierre de este mes
  delta_s_mm3       numeric,
  entradas_mm3      numeric,
  salida_total_mm3  numeric,                          -- extracción total (incluye vertido)
  extraccion_mm3    numeric,                          -- salida controlada (sin vertido)
  vertido_mm3       numeric,
  dias_mes          integer NOT NULL,
  dias_aportacion   integer NOT NULL DEFAULT 0,
  dias_salida       integer NOT NULL DEFAULT 0,
  cobertura_pct     numeric,                          -- el menor de los dos flujos
  evap_mm3          numeric,                          -- S/D en esta etapa
  evap_metodo       text,
  residuo_mm3       numeric,
  error_cierre_mm3  numeric,                          -- residuo − evaporación; S/D mientras no haya evaporación
  calidad           text    NOT NULL CHECK (calidad IN ('OK', 'PARCIAL', 'SD')),
  fuente            text    NOT NULL DEFAULT 'AQWP',
  calculado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cuerpo_id, mes)
);
CREATE INDEX IF NOT EXISTS idx_balance_mensual_mes ON public.cuerpos_agua_balance_mensual (mes DESC);

ALTER TABLE public.cuerpos_agua_balance_mensual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read balance mensual" ON public.cuerpos_agua_balance_mensual;
CREATE POLICY "Public Read balance mensual" ON public.cuerpos_agua_balance_mensual FOR SELECT USING (true);

COMMENT ON TABLE public.cuerpos_agua_balance_mensual IS
  'Balance mensual por vaso con flujos AQWP. residuo = entradas − salida − ΔS (mide consistencia, no error independiente). Evaporación y error de cierre: S/D.';

CREATE OR REPLACE FUNCTION public.fn_balance_mensual_recalcular(
  p_desde  date DEFAULT DATE '2021-01-01',
  p_hasta  date DEFAULT NULL,
  p_cuerpo text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  n integer;
BEGIN
  p_hasta := COALESCE(p_hasta, (date_trunc('month', current_date) - interval '1 day')::date);

  WITH meses AS (
    SELECT c.id AS cuerpo_id, c.aqwp_ubicacion_id AS ub, m::date AS mes,
           (m + interval '1 month - 1 day')::date AS fin,
           extract(day FROM (m + interval '1 month - 1 day'))::int AS dias
    FROM public.cuerpos_agua c
    CROSS JOIN generate_series(date_trunc('month', p_desde::timestamp), date_trunc('month', p_hasta::timestamp), interval '1 month') AS m
    WHERE c.activo AND c.aqwp_ubicacion_id IS NOT NULL AND (p_cuerpo IS NULL OR c.id = p_cuerpo)
      AND (m + interval '1 month - 1 day')::date <= p_hasta
  ),
  dia AS (
    SELECT me.cuerpo_id, me.mes, l.fecha,
           max(l.valor) FILTER (WHERE d.magnitud = 'aportacion')       AS apo,
           max(l.valor) FILTER (WHERE d.magnitud = 'extraccion')       AS ext,
           max(l.valor) FILTER (WHERE d.magnitud = 'extraccion_total') AS tot,
           max(l.valor) FILTER (WHERE d.magnitud = 'vertido')          AS ver
    FROM meses me
    JOIN public.aqwp_datasets d ON d.ubicacion_id = me.ub AND d.magnitud IN ('aportacion', 'extraccion', 'extraccion_total', 'vertido')
    JOIN public.aqwp_lecturas_diarias l ON l.dataset_id = d.id_number AND l.fecha BETWEEN me.mes AND me.fin AND l.valor IS NOT NULL
    GROUP BY me.cuerpo_id, me.mes, l.fecha
  ),
  agg AS (
    SELECT cuerpo_id, mes,
           count(apo)::int AS n_apo, avg(apo) AS m_apo,
           count(*) FILTER (WHERE tot IS NOT NULL OR ext IS NOT NULL)::int AS n_sal,
           avg(COALESCE(tot, ext + COALESCE(ver, 0))) AS m_sal,
           avg(ext) AS m_ext, avg(ver) AS m_ver
    FROM dia GROUP BY cuerpo_id, mes
  ),
  base AS (
    SELECT me.cuerpo_id, me.mes, me.fin, me.dias,
           COALESCE(a.n_apo, 0) AS n_apo, COALESCE(a.n_sal, 0) AS n_sal,
           CASE WHEN COALESCE(a.n_apo, 0)::numeric / me.dias >= 0.5 THEN a.m_apo * me.dias * 0.0864 END AS entradas,
           CASE WHEN COALESCE(a.n_sal, 0)::numeric / me.dias >= 0.5 THEN a.m_sal * me.dias * 0.0864 END AS salida,
           CASE WHEN COALESCE(a.n_sal, 0)::numeric / me.dias >= 0.5 THEN a.m_ext * me.dias * 0.0864 END AS ext_mm3,
           CASE WHEN COALESCE(a.n_sal, 0)::numeric / me.dias >= 0.5 THEN a.m_ver * me.dias * 0.0864 END AS ver_mm3,
           c1.almacenamiento_mm3 AS s_fin, c0.almacenamiento_mm3 AS s_ini
    FROM meses me
    LEFT JOIN agg a ON a.cuerpo_id = me.cuerpo_id AND a.mes = me.mes
    LEFT JOIN public.cuerpos_agua_cierre_mensual c1 ON c1.cuerpo_id = me.cuerpo_id AND c1.mes = me.mes
    LEFT JOIN public.cuerpos_agua_cierre_mensual c0 ON c0.cuerpo_id = me.cuerpo_id AND c0.mes = (me.mes - interval '1 month')::date
  ),
  calc AS (
    SELECT b.*,
           CASE WHEN b.s_fin IS NOT NULL AND b.s_ini IS NOT NULL THEN b.s_fin - b.s_ini END AS dS,
           round(LEAST(b.n_apo, b.n_sal)::numeric / b.dias * 100, 1) AS cob
    FROM base b
  )
  INSERT INTO public.cuerpos_agua_balance_mensual AS t
    (cuerpo_id, mes, fecha_cierre, s_ini_mm3, s_fin_mm3, delta_s_mm3, entradas_mm3, salida_total_mm3, extraccion_mm3, vertido_mm3,
     dias_mes, dias_aportacion, dias_salida, cobertura_pct, residuo_mm3, calidad, calculado_en)
  SELECT c.cuerpo_id, c.mes, c.fin,
         round(c.s_ini, 3), round(c.s_fin, 3), round(c.dS, 3),
         round(c.entradas, 3), round(c.salida, 3), round(c.ext_mm3, 3), round(c.ver_mm3, 3),
         c.dias, c.n_apo, c.n_sal, c.cob,
         CASE WHEN c.entradas IS NOT NULL AND c.salida IS NOT NULL AND c.dS IS NOT NULL THEN round(c.entradas - c.salida - c.dS, 3) END,
         CASE WHEN c.entradas IS NULL OR c.salida IS NULL OR c.dS IS NULL THEN 'SD'
              WHEN c.cob >= 90 THEN 'OK' ELSE 'PARCIAL' END,
         now()
  FROM calc c
  ON CONFLICT (cuerpo_id, mes) DO UPDATE SET
    fecha_cierre = EXCLUDED.fecha_cierre, s_ini_mm3 = EXCLUDED.s_ini_mm3, s_fin_mm3 = EXCLUDED.s_fin_mm3, delta_s_mm3 = EXCLUDED.delta_s_mm3,
    entradas_mm3 = EXCLUDED.entradas_mm3, salida_total_mm3 = EXCLUDED.salida_total_mm3, extraccion_mm3 = EXCLUDED.extraccion_mm3,
    vertido_mm3 = EXCLUDED.vertido_mm3, dias_mes = EXCLUDED.dias_mes, dias_aportacion = EXCLUDED.dias_aportacion,
    dias_salida = EXCLUDED.dias_salida, cobertura_pct = EXCLUDED.cobertura_pct, residuo_mm3 = EXCLUDED.residuo_mm3,
    calidad = EXCLUDED.calidad, calculado_en = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_balance_mensual_recalcular(date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_balance_mensual_recalcular(date, date, text) TO service_role;
COMMENT ON FUNCTION public.fn_balance_mensual_recalcular(date, date, text) IS
  'Recalcula cuerpos_agua_balance_mensual (idempotente). Requiere el cierre mensual calculado antes. Solo service_role.';
