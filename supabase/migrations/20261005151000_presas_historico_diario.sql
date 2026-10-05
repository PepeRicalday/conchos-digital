-- ═══════════════════════════════════════════════════════════════════════════
-- Histórico diario de presas (reportes mensuales SRL 2021-2025) — esquema
-- Fecha: 2026-10-05
--
-- Tabla propia e inmutable (no se mezcla con lecturas_presas: evita el trigger de alertas de nivel
-- crítico y mantiene limpia la tabla operativa). Guarda el valor ORIGINAL del reporte y una versión
-- NORMALIZADA (volumen y % recalculados desde la escala con la curva vigente) para poder comparar años
-- aunque la curva de capacidad haya cambiado (Madero jul-2021, Boquilla sept-2021).
-- ═══════════════════════════════════════════════════════════════════════════

-- Volumen (Mm3) por interpolación lineal de curvas_capacidad; NULL si la escala cae fuera de la curva.
CREATE INDEX IF NOT EXISTS idx_curvas_capacidad_presa_elev ON public.curvas_capacidad (presa_id, elevacion_msnm);

CREATE OR REPLACE FUNCTION public.fn_vol_desde_escala(p_presa text, p_escala numeric)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  WITH lo AS (
    SELECT elevacion_msnm AS e, volumen_mm3 AS v FROM public.curvas_capacidad
    WHERE presa_id = p_presa AND elevacion_msnm <= p_escala ORDER BY elevacion_msnm DESC LIMIT 1
  ), hi AS (
    SELECT elevacion_msnm AS e, volumen_mm3 AS v FROM public.curvas_capacidad
    WHERE presa_id = p_presa AND elevacion_msnm >= p_escala ORDER BY elevacion_msnm ASC LIMIT 1
  )
  SELECT CASE WHEN hi.e = lo.e THEN lo.v
              ELSE lo.v + (p_escala - lo.e) / (hi.e - lo.e) * (hi.v - lo.v) END
  FROM lo, hi;
$$;

CREATE TABLE IF NOT EXISTS public.presas_historico_diario (
  id                           bigserial PRIMARY KEY,
  presa_id                     text    NOT NULL REFERENCES public.presas(id),
  fecha                        date    NOT NULL,
  escala_msnm                  numeric,                 -- medida (dato primario del reporte)
  almacenamiento_reportado_mm3 numeric,                 -- tal como se reportó (curva de su época)
  pct_reportado                numeric,                 -- en %, base de capacidad de su época
  dif_mts_reportada            numeric,
  dif_mm3_reportada            numeric,
  cap_base_reportada_mm3       numeric,                 -- capacidad del encabezado del reporte
  curva_epoca                  text,                    -- CEAC-2893 | LEV-2020 | LEV-2004 | TABLA-SRL
  almacenamiento_norm_mm3      numeric,                 -- recalculado desde la escala con la curva vigente
  pct_norm                     numeric,                 -- sobre presas.capacidad_max vigente
  calidad                      text    NOT NULL DEFAULT 'OK'
                               CHECK (calidad IN ('OK', 'SIN_DATO', 'REVISAR', 'FUERA_DE_RANGO')),
  archivo_origen               text,
  creado_en                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presas_historico_diario_presa_fecha_uk UNIQUE (presa_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_presas_historico_presa_fecha ON public.presas_historico_diario (presa_id, fecha);

ALTER TABLE public.presas_historico_diario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read Presas Historico" ON public.presas_historico_diario;
CREATE POLICY "Public Read Presas Historico" ON public.presas_historico_diario FOR SELECT USING (true);

COMMENT ON TABLE public.presas_historico_diario IS
  'Reportes mensuales SRL 2021-2025 (Boquilla y Madero). *_reportado = original; *_norm = recalculado con la curva vigente.';

-- Serie diaria unificada: lo operativo (campo/CILA) prevalece; el histórico completa las fechas sin lectura.
CREATE OR REPLACE VIEW public.v_presas_serie_diaria WITH (security_invoker = true) AS
SELECT l.presa_id,
       l.fecha::date AS fecha,
       l.escala_msnm,
       l.almacenamiento_mm3,
       l.porcentaje_llenado AS pct,
       CASE WHEN l.notas ILIKE '%Nivel: CILA-IBWC%' THEN 'CILA' ELSE 'CAMPO' END AS fuente,
       'OK'::text AS calidad,
       l.almacenamiento_mm3 AS almacenamiento_reportado_mm3,
       l.porcentaje_llenado AS pct_reportado
FROM public.lecturas_presas l
WHERE l.almacenamiento_mm3 IS NOT NULL OR l.escala_msnm IS NOT NULL
UNION ALL
SELECT h.presa_id,
       h.fecha,
       h.escala_msnm,
       h.almacenamiento_norm_mm3,
       h.pct_norm,
       'HISTORICO',
       h.calidad,
       h.almacenamiento_reportado_mm3,
       h.pct_reportado
FROM public.presas_historico_diario h
WHERE NOT EXISTS (
  SELECT 1 FROM public.lecturas_presas l
  WHERE l.presa_id = h.presa_id AND l.fecha = h.fecha
    AND (l.almacenamiento_mm3 IS NOT NULL OR l.escala_msnm IS NOT NULL)
);

GRANT SELECT ON public.v_presas_serie_diaria TO anon, authenticated;
