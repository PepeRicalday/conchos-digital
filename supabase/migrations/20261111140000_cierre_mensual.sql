-- ═══════════════════════════════════════════════════════════════════════════
-- Cierre mensual de almacenamiento por cuerpo de agua   Fecha: 2026-11-11
--
-- Un renglón por cuerpo y mes con el VALOR ELEGIDO, la fuente y la calidad, congelados para que la
-- pantalla no recalcule ("mostrar cuál se usó"). Los valores de cada fuente quedan en `detalle`.
--
-- PRECEDENCIA (la misma que se rotula en la pantalla «Cómo se lee»):
--   1. Presas del distrito (presa_id): reporte SRL/CILA/campo (v_presas_serie_diaria, calidad OK) →
--      SINA → AQWP.  Se usa el almacenamiento «reportado» (homogéneo con las demás presas), no el normalizado.
--   2. Las demás: SINA → AQWP (sin lecturas excluidas por atípicas).
--   3. Dato del último día del mes; si falta, el más reciente hasta 3 días antes (calidad DESFASADO).
--      El 2025-04-23 de SINA NO es cierre de abril.
--   4. REPETIDO  = idéntico al cierre del mes anterior (el portal repite el último dato cuando no llega uno nuevo).
--   5. DIFIERE   = dos fuentes difieren más de max(0.5 Mm³, 0.5 %).
--   6. SD        = ninguna fuente: todo NULL, jamás 0.
--   Prioridad de la etiqueta: SD > DIFIERE > REPETIDO > DESFASADO > OK.
-- El % se calcula contra cuerpos_agua.namo_ref_mm3 (NAMO declarado), no contra el % crudo de cada fuente.
-- Solo meses COMPLETOS: el mes en curso se ve con las vistas en vivo.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cuerpos_agua_cierre_mensual (
  cuerpo_id            text    NOT NULL REFERENCES public.cuerpos_agua (id) ON DELETE CASCADE,
  mes                  date    NOT NULL,                  -- primer día del mes
  fecha_cierre         date    NOT NULL,                  -- último día del mes
  fecha_dato           date,                              -- día del dato elegido (≤ fecha_cierre)
  almacenamiento_mm3   numeric,                           -- NULL = S/D
  elevacion_msnm       numeric,
  fuente_alm           text    CHECK (fuente_alm IN ('SRL', 'SINA', 'AQWP')),
  fuente_elev          text    CHECK (fuente_elev IN ('SRL', 'SINA', 'AQWP')),
  calidad              text    NOT NULL CHECK (calidad IN ('OK', 'DESFASADO', 'REPETIDO', 'DIFIERE', 'SD')),
  namo_ref_mm3         numeric,
  pct_namo             numeric,
  n_fuentes            integer NOT NULL DEFAULT 0,
  dif_max_fuentes_mm3  numeric,
  area_sat_km2         numeric,                           -- espejo NDWI vigente más reciente del mes
  fecha_escena         timestamptz,
  detalle              jsonb   NOT NULL DEFAULT '{}'::jsonb,
  calculado_en         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cuerpo_id, mes)
);
CREATE INDEX IF NOT EXISTS idx_cierre_mensual_mes ON public.cuerpos_agua_cierre_mensual (mes DESC);

ALTER TABLE public.cuerpos_agua_cierre_mensual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read cierre mensual" ON public.cuerpos_agua_cierre_mensual;
CREATE POLICY "Public Read cierre mensual" ON public.cuerpos_agua_cierre_mensual FOR SELECT USING (true);

COMMENT ON TABLE public.cuerpos_agua_cierre_mensual IS
  'Cierre de mes por cuerpo de agua con fuente y calidad por dato. Precedencia: SRL>SINA>AQWP (presas del distrito) y SINA>AQWP (resto). S/D = NULL, nunca 0. Ver encabezado de la migración 20261111140000.';

CREATE OR REPLACE FUNCTION public.fn_cierre_mensual_recalcular(
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
    SELECT c.id AS cuerpo_id, c.presa_id, c.clave_sih, c.aqwp_ubicacion_id, c.id_serie, c.namo_ref_mm3,
           m::date AS mes, (m + interval '1 month - 1 day')::date AS fin
    FROM public.cuerpos_agua c
    CROSS JOIN generate_series(date_trunc('month', p_desde::timestamp), date_trunc('month', p_hasta::timestamp), interval '1 month') AS m
    WHERE c.activo AND (p_cuerpo IS NULL OR c.id = p_cuerpo)
      AND (m + interval '1 month - 1 day')::date <= p_hasta
  ),
  srl AS (
    SELECT DISTINCT ON (me.cuerpo_id, me.mes)
           me.cuerpo_id, me.mes, s.fecha, s.almacenamiento_reportado_mm3 AS alm, s.escala_msnm AS elev, s.fuente AS origen
    FROM meses me
    JOIN public.v_presas_serie_diaria s ON s.presa_id = me.presa_id AND s.fecha BETWEEN me.fin - 3 AND me.fin
    WHERE s.calidad = 'OK' AND s.almacenamiento_reportado_mm3 IS NOT NULL
    ORDER BY me.cuerpo_id, me.mes, s.fecha DESC
  ),
  sina AS (
    SELECT DISTINCT ON (me.cuerpo_id, me.mes)
           me.cuerpo_id, me.mes, s.fecha, s.almacenamiento_mm3 AS alm, s.elevacion_msnm AS elev
    FROM meses me
    JOIN public.sina_presas_diario s ON s.clave_sih = me.clave_sih AND s.fecha BETWEEN me.fin - 3 AND me.fin
    WHERE s.almacenamiento_mm3 IS NOT NULL
    ORDER BY me.cuerpo_id, me.mes, s.fecha DESC
  ),
  aqwp AS (
    SELECT DISTINCT ON (me.cuerpo_id, me.mes)
           me.cuerpo_id, me.mes, l.fecha, l.valor AS alm, l.estancada
    FROM meses me
    JOIN public.aqwp_datasets d ON d.ubicacion_id = me.aqwp_ubicacion_id AND d.magnitud = 'almacenamiento'
    JOIN public.aqwp_lecturas_diarias l ON l.dataset_id = d.id_number AND l.fecha BETWEEN me.fin - 3 AND me.fin
    WHERE l.valor IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.aqwp_lecturas_excluidas x WHERE x.ubicacion_id = me.aqwp_ubicacion_id AND x.fecha = l.fecha)
    ORDER BY me.cuerpo_id, me.mes, l.fecha DESC
  ),
  comb AS (
    SELECT me.cuerpo_id, me.mes, me.fin, me.id_serie, me.namo_ref_mm3, me.presa_id,
           r.fecha AS r_f, r.alm AS r_a, r.elev AS r_e, r.origen AS r_o,
           s.fecha AS s_f, s.alm AS s_a, s.elev AS s_e,
           a.fecha AS a_f, a.alm AS a_a, a.estancada AS a_x
    FROM meses me
    LEFT JOIN srl  r ON r.cuerpo_id = me.cuerpo_id AND r.mes = me.mes
    LEFT JOIN sina s ON s.cuerpo_id = me.cuerpo_id AND s.mes = me.mes
    LEFT JOIN aqwp a ON a.cuerpo_id = me.cuerpo_id AND a.mes = me.mes
  ),
  elegido AS (
    SELECT k.*,
      -- almacenamiento: primera fuente con dato según la precedencia
      CASE WHEN r_a IS NOT NULL THEN 'SRL' WHEN s_a IS NOT NULL THEN 'SINA' WHEN a_a IS NOT NULL THEN 'AQWP' END AS f_alm,
      COALESCE(r_a, s_a, a_a) AS alm,
      CASE WHEN r_a IS NOT NULL THEN r_f WHEN s_a IS NOT NULL THEN s_f WHEN a_a IS NOT NULL THEN a_f END AS f_dato,
      -- elevación: primera fuente con elevación (AQWP no la trae)
      CASE WHEN r_e IS NOT NULL THEN 'SRL' WHEN s_e IS NOT NULL THEN 'SINA' END AS f_elev,
      COALESCE(r_e, s_e) AS elev,
      (r_a IS NOT NULL)::int + (s_a IS NOT NULL)::int + (a_a IS NOT NULL)::int AS n_f,
      GREATEST(r_a, s_a, a_a) - LEAST(r_a, s_a, a_a) AS dif
    FROM comb k
  ),
  calc AS (
    SELECT e.*,
      CASE WHEN e.alm IS NULL THEN 'SD'
           WHEN e.n_f >= 2 AND e.dif > GREATEST(0.5, 0.005 * e.alm) THEN 'DIFIERE'
           WHEN e.f_dato < e.fin THEN 'DESFASADO'
           ELSE 'OK' END AS cal,
      v.area_km2 AS area_sat, v.fecha_escena AS f_escena
    FROM elegido e
    LEFT JOIN LATERAL (
      SELECT g.area_km2, g.fecha_escena FROM public.vaso_geometria_historico g
      WHERE g.presa_id = e.id_serie AND g.vigente AND g.fecha_escena >= e.mes AND g.fecha_escena < e.fin + 1
      ORDER BY g.fecha_escena DESC LIMIT 1
    ) v ON true
  )
  INSERT INTO public.cuerpos_agua_cierre_mensual AS t
    (cuerpo_id, mes, fecha_cierre, fecha_dato, almacenamiento_mm3, elevacion_msnm, fuente_alm, fuente_elev, calidad,
     namo_ref_mm3, pct_namo, n_fuentes, dif_max_fuentes_mm3, area_sat_km2, fecha_escena, detalle, calculado_en)
  SELECT c.cuerpo_id, c.mes, c.fin, c.f_dato, c.alm, c.elev, c.f_alm, c.f_elev, c.cal,
         c.namo_ref_mm3,
         CASE WHEN c.alm IS NOT NULL AND c.namo_ref_mm3 > 0 THEN round(c.alm / c.namo_ref_mm3 * 100, 2) END,
         c.n_f, CASE WHEN c.n_f >= 2 THEN round(c.dif, 3) END,
         c.area_sat, c.f_escena,
         jsonb_strip_nulls(jsonb_build_object(
           'srl',  CASE WHEN c.r_a IS NOT NULL THEN jsonb_build_object('fecha', c.r_f, 'almacenamiento', c.r_a, 'elevacion', c.r_e, 'origen', c.r_o) END,
           'sina', CASE WHEN c.s_a IS NOT NULL THEN jsonb_build_object('fecha', c.s_f, 'almacenamiento', c.s_a, 'elevacion', c.s_e) END,
           'aqwp', CASE WHEN c.a_a IS NOT NULL THEN jsonb_build_object('fecha', c.a_f, 'almacenamiento', c.a_a, 'estancada', c.a_x) END)),
         now()
  FROM calc c
  ON CONFLICT (cuerpo_id, mes) DO UPDATE SET
    fecha_cierre = EXCLUDED.fecha_cierre, fecha_dato = EXCLUDED.fecha_dato, almacenamiento_mm3 = EXCLUDED.almacenamiento_mm3,
    elevacion_msnm = EXCLUDED.elevacion_msnm, fuente_alm = EXCLUDED.fuente_alm, fuente_elev = EXCLUDED.fuente_elev,
    calidad = EXCLUDED.calidad, namo_ref_mm3 = EXCLUDED.namo_ref_mm3, pct_namo = EXCLUDED.pct_namo, n_fuentes = EXCLUDED.n_fuentes,
    dif_max_fuentes_mm3 = EXCLUDED.dif_max_fuentes_mm3, area_sat_km2 = EXCLUDED.area_sat_km2, fecha_escena = EXCLUDED.fecha_escena,
    detalle = EXCLUDED.detalle, calculado_en = now();
  GET DIAGNOSTICS n = ROW_COUNT;

  -- REPETIDO: idéntico al cierre del mes anterior (solo etiqueta; DIFIERE y SD conservan la suya).
  UPDATE public.cuerpos_agua_cierre_mensual t SET calidad = 'REPETIDO'
  FROM public.cuerpos_agua_cierre_mensual p
  WHERE p.cuerpo_id = t.cuerpo_id AND p.mes = (t.mes - interval '1 month')::date
    AND p.almacenamiento_mm3 IS NOT NULL AND t.almacenamiento_mm3 = p.almacenamiento_mm3
    AND t.calidad IN ('OK', 'DESFASADO')
    AND t.mes >= date_trunc('month', p_desde::timestamp)::date AND t.mes <= p_hasta
    AND (p_cuerpo IS NULL OR t.cuerpo_id = p_cuerpo);

  RETURN n;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_cierre_mensual_recalcular(date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cierre_mensual_recalcular(date, date, text) TO service_role;
COMMENT ON FUNCTION public.fn_cierre_mensual_recalcular(date, date, text) IS
  'Recalcula cuerpos_agua_cierre_mensual (idempotente) para meses completos entre p_desde y p_hasta (por omisión hasta el mes anterior). Solo service_role.';

-- Cuadre: una fila por cuerpo, mes y fuente, con el valor de cada fuente lado a lado.
CREATE OR REPLACE VIEW public.v_cierre_mensual_fuentes WITH (security_invoker = true) AS
SELECT c.cuerpo_id, c.mes, upper(f.key) AS fuente,
       (f.value->>'fecha')::date                AS fecha,
       (f.value->>'almacenamiento')::numeric    AS almacenamiento_mm3,
       (f.value->>'elevacion')::numeric         AS elevacion_msnm,
       (upper(f.key) = c.fuente_alm)            AS elegida,
       round(((f.value->>'almacenamiento')::numeric - c.almacenamiento_mm3), 3) AS dif_vs_elegida_mm3
FROM public.cuerpos_agua_cierre_mensual c
CROSS JOIN LATERAL jsonb_each(c.detalle) AS f(key, value);
COMMENT ON VIEW public.v_cierre_mensual_fuentes IS 'Valores de cada fuente (srl/sina/aqwp) por cuerpo y mes, con la elegida marcada.';
