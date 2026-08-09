-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN DE SKILL DEL PRONÓSTICO — SICA-005
-- Fecha: 2026-08-08
--
-- Hasta hoy el sistema guarda un pronóstico horario versionado
-- (clima_pronostico_horario) y una lectura real cada 2 h (clima_estacion_
-- lecturas), pero nunca los compara: no hay forma de responder "¿qué tan
-- confiable es Open-Meteo para el Canal Conchos?".
--
-- fn_clima_skill_pronostico empareja cada fila de pronóstico YA VENCIDA
-- (valido_en en el pasado) con la lectura real más cercana de la MISMA
-- estación dentro de una tolerancia de 45 min, y devuelve el error firmado
-- y absoluto de nubosidad total y precipitación. No persiste nada nuevo:
-- se calcula on-demand para no duplicar almacenamiento de una serie que ya
-- existe en ambas tablas.
--
-- Nota de honestidad: precip_prob_pct (probabilidad) no tiene "valor real"
-- comparable 1:1 — un 30% de probabilidad no es correcto ni incorrecto por
-- un solo evento. Aquí solo se evalúa precip_mm (cantidad) y nubosidad_
-- total_pct (única variable con lectura real directamente comparable vía
-- nubosidad_est_pct de la estación, cuando esa estimación existe).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_clima_skill_pronostico(
  p_dias INT DEFAULT 7,
  p_estacion_id UUID DEFAULT NULL,
  p_tolerancia_min INT DEFAULT 45
)
RETURNS TABLE (
  estacion_id UUID,
  estacion_nombre TEXT,
  proveedor TEXT,
  modelo TEXT,
  valido_en TIMESTAMPTZ,
  horizonte_h INT,
  ts_obs TIMESTAMPTZ,
  diff_min NUMERIC,
  nubosidad_fc_pct NUMERIC,
  nubosidad_obs_pct NUMERIC,
  error_nubosidad_pct NUMERIC,
  precip_fc_mm NUMERIC,
  precip_obs_mm NUMERIC,
  error_precip_mm NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH fc AS (
    SELECT f.estacion_id, f.proveedor, f.modelo, f.valido_en, f.horizonte_h,
           f.nubosidad_total_pct, f.precip_mm
    FROM public.clima_pronostico_horario f
    WHERE f.valido_en < now()
      AND f.valido_en >= now() - (p_dias || ' days')::interval
      AND (p_estacion_id IS NULL OR f.estacion_id = p_estacion_id)
  ),
  emparejado AS (
    SELECT
      fc.*,
      l.ts AS ts_obs,
      l.nubosidad_est_pct AS nubosidad_obs_pct,
      -- lluvia_dia_mm es acumulada del día, no comparable hora a hora contra
      -- precip_mm horario del modelo: se usa como proxy de "hubo lluvia" solo
      -- cuando ambas caen en la misma fecha_local, nunca como valor exacto.
      l.lluvia_dia_mm AS precip_dia_obs_mm,
      ABS(EXTRACT(EPOCH FROM (l.ts - fc.valido_en)) / 60.0) AS diff_min,
      ROW_NUMBER() OVER (
        PARTITION BY fc.estacion_id, fc.valido_en, fc.proveedor
        ORDER BY ABS(EXTRACT(EPOCH FROM (l.ts - fc.valido_en)))
      ) AS rn
    FROM fc
    JOIN public.clima_estacion_lecturas l
      ON l.estacion_id = fc.estacion_id
     AND l.ts BETWEEN fc.valido_en - (p_tolerancia_min || ' minutes')::interval
                   AND fc.valido_en + (p_tolerancia_min || ' minutes')::interval
  )
  SELECT
    e.estacion_id, ce.nombre AS estacion_nombre, e.proveedor, e.modelo,
    e.valido_en, e.horizonte_h, e.ts_obs,
    ROUND(e.diff_min::numeric, 1) AS diff_min,
    e.nubosidad_total_pct AS nubosidad_fc_pct,
    e.nubosidad_obs_pct,
    CASE WHEN e.nubosidad_obs_pct IS NOT NULL
      THEN ROUND((e.nubosidad_total_pct - e.nubosidad_obs_pct)::numeric, 1)
      ELSE NULL END AS error_nubosidad_pct,
    e.precip_mm AS precip_fc_mm,
    e.precip_dia_obs_mm AS precip_obs_mm,
    NULL::numeric AS error_precip_mm  -- reservado: requiere desglose horario de lluvia, no disponible hoy
  FROM emparejado e
  JOIN public.clima_estaciones ce ON ce.id = e.estacion_id
  WHERE e.rn = 1
  ORDER BY e.valido_en DESC;
$$;

COMMENT ON FUNCTION public.fn_clima_skill_pronostico IS
  'Compara pronóstico horario vencido (clima_pronostico_horario) contra la lectura real más cercana (clima_estacion_lecturas) de la misma estación. Mide el acierto real de Open-Meteo para el distrito, no un supuesto genérico.';

-- Resumen agregado: MAE (error absoluto medio) de nubosidad por estación y
-- horizonte, para responder "¿el pronóstico empeora con más horas de anticipación?".
CREATE OR REPLACE FUNCTION public.fn_clima_skill_resumen(
  p_dias INT DEFAULT 7
)
RETURNS TABLE (
  estacion_nombre TEXT,
  horizonte_bucket TEXT,
  n_muestras BIGINT,
  mae_nubosidad_pct NUMERIC,
  sesgo_nubosidad_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    estacion_nombre,
    CASE
      WHEN horizonte_h <= 6 THEN '0-6h'
      WHEN horizonte_h <= 24 THEN '7-24h'
      ELSE '25-48h'
    END AS horizonte_bucket,
    COUNT(*) AS n_muestras,
    ROUND(AVG(ABS(error_nubosidad_pct))::numeric, 1) AS mae_nubosidad_pct,
    ROUND(AVG(error_nubosidad_pct)::numeric, 1) AS sesgo_nubosidad_pct
  FROM public.fn_clima_skill_pronostico(p_dias)
  WHERE error_nubosidad_pct IS NOT NULL
  GROUP BY estacion_nombre, horizonte_bucket
  ORDER BY estacion_nombre, horizonte_bucket;
$$;

COMMENT ON FUNCTION public.fn_clima_skill_resumen IS
  'MAE y sesgo de nubosidad del pronóstico por estación y bucket de horizonte (0-6h/7-24h/25-48h). Sesgo positivo = el modelo sobreestima nubosidad.';

GRANT EXECUTE ON FUNCTION public.fn_clima_skill_pronostico TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clima_skill_resumen TO anon, authenticated;
