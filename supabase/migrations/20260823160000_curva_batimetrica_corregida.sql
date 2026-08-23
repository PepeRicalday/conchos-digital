-- ═══════════════════════════════════════════════════════════════════════════
-- CURVA BATIMÉTRICA CORREGIDA — recalibración dinámica vs. CONAGUA
-- Fecha: 2026-08-23
--
-- La curva oficial CONAGUA (curvas_capacidad, 5501 puntos a 1cm, migración
-- 20260823110000) es la fuente de verdad legal/contractual y NUNCA se
-- sobreescribe. Pero la validación cruzada (PresaVasoMonitor.tsx,
-- validacionCruzada) ya viene mostrando desviaciones mes a mes entre el área
-- que esa curva predice para una elevación dada y el área que el satélite
-- realmente mide ahí — probable señal de azolve acumulado desde que se
-- levantó la curva oficial. Esta tabla guarda un FACTOR DE CORRECCIÓN
-- derivado empíricamente de esas desviaciones, sin tocar el dato oficial.
--
-- Grano: un factor por presa y por banda de elevación (no punto a punto,
-- como la curva de 1cm) — con pocos meses de histórico satelital (a lo sumo
-- 1 escena/mes) no hay suficiente densidad de observaciones para calibrar a
-- resolución de centímetro; se agrupa en bandas de 1m, suficientes para
-- capturar tendencia de azolve sin sobreajustar a 1-2 puntos por banda.
--
-- El factor se aplica multiplicativamente sobre area_ha/volumen_mm3 de la
-- curva oficial en esa banda: area_corregida = area_oficial * factor_area.
-- factor 1.00 = sin desviación detectada (curva oficial se mantiene tal
-- cual); < 1.00 = el vaso mide menos área real de la que la curva oficial
-- predice a esa elevación (azolve / pérdida de capacidad).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.curva_batimetrica_correccion (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    presa_id            TEXT NOT NULL,
    banda_elevacion_msnm NUMERIC NOT NULL, -- piso de la banda de 1m (ej. 1290 agrupa 1290.00-1290.99)

    -- ── Factor de corrección ────────────────────────────────────────────────
    factor_area         NUMERIC NOT NULL,  -- area_ha_real_promedio / area_ha_oficial_promedio en esta banda
    n_observaciones      INTEGER NOT NULL, -- cuántas escenas NDWI con lectura de campo cercana aportaron a este factor
    desviacion_pct_prom  NUMERIC NOT NULL, -- (factor_area - 1) * 100, para lectura directa en UI/informe

    -- ── Procedencia ──────────────────────────────────────────────────────────
    ultima_fecha_escena  TIMESTAMPTZ NOT NULL, -- escena más reciente que contribuyó a este factor
    actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (presa_id, banda_elevacion_msnm)
);

COMMENT ON TABLE public.curva_batimetrica_correccion IS
  'Factor de corrección empírico por banda de elevación (1m), derivado de comparar área NDWI real (vaso_geometria_historico) contra el área que predice la curva oficial CONAGUA (curvas_capacidad) en cada lectura de campo. La curva oficial nunca se modifica; este es un ajuste sugerido, no un reemplazo.';
COMMENT ON COLUMN public.curva_batimetrica_correccion.factor_area IS
  'area_ha real (NDWI) / area_ha oficial (CONAGUA interpolada) promedio en esta banda. 1.00 = sin desviación; <1.00 = azolve/pérdida de área respecto a lo esperado.';

ALTER TABLE public.curva_batimetrica_correccion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Curva Correccion" ON public.curva_batimetrica_correccion;
CREATE POLICY "Public Read Curva Correccion" ON public.curva_batimetrica_correccion
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Curva Correccion" ON public.curva_batimetrica_correccion;
CREATE POLICY "Auth Write Curva Correccion" ON public.curva_batimetrica_correccion
  FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIÓN DE RECALIBRACIÓN — recalcula todos los factores de una presa
--
-- Se invoca desde la Edge Function recalibra-curva-batimetrica (job mensual,
-- corre después de sentinel-ndwi-vaso-sync) en vez de vivir solo en un
-- trigger: un trigger por-fila no puede promediar "todas las observaciones
-- de esta banda" de forma limpia sin recalcular la banda completa de todas
-- formas, así que se expone como función invocable que SÍ recalcula la
-- banda entera cada vez — simple y sin necesidad de acumuladores incrementales.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_recalibra_curva_batimetrica(p_presa_id TEXT)
RETURNS TABLE (banda_elevacion_msnm NUMERIC, factor_area NUMERIC, n_observaciones INTEGER) AS $$
DECLARE
    v_umbral_dias CONSTANT INTEGER := 20;
BEGIN
    RETURN QUERY
    WITH observaciones AS (
        -- Para cada escena NDWI (no-referencia), la lectura de campo más
        -- cercana en fecha (±20 días, mismo umbral que la validación cruzada
        -- del frontend y el trigger de alerta) y el área oficial esperada
        -- interpolada sobre esa elevación.
        SELECT
            g.fecha_escena,
            g.area_km2,
            lp.escala_msnm,
            FLOOR(lp.escala_msnm) AS banda,
            (
                WITH curva AS (
                    SELECT elevacion_msnm, area_ha FROM public.curvas_capacidad
                    WHERE presa_id = p_presa_id AND area_ha IS NOT NULL
                    ORDER BY elevacion_msnm
                ), acotado AS (
                    SELECT
                        (SELECT area_ha FROM curva WHERE elevacion_msnm <= lp.escala_msnm ORDER BY elevacion_msnm DESC LIMIT 1) AS area_inf,
                        (SELECT elevacion_msnm FROM curva WHERE elevacion_msnm <= lp.escala_msnm ORDER BY elevacion_msnm DESC LIMIT 1) AS elev_inf,
                        (SELECT area_ha FROM curva WHERE elevacion_msnm >= lp.escala_msnm ORDER BY elevacion_msnm ASC LIMIT 1) AS area_sup,
                        (SELECT elevacion_msnm FROM curva WHERE elevacion_msnm >= lp.escala_msnm ORDER BY elevacion_msnm ASC LIMIT 1) AS elev_sup
                )
                SELECT CASE
                    WHEN elev_inf IS NULL OR elev_sup IS NULL THEN NULL
                    WHEN elev_inf = elev_sup THEN area_inf
                    ELSE area_inf + (lp.escala_msnm - elev_inf) / (elev_sup - elev_inf) * (area_sup - area_inf)
                END
                FROM acotado
            ) AS area_ha_oficial
        FROM public.vaso_geometria_historico g
        JOIN LATERAL (
            SELECT fecha, escala_msnm FROM public.lecturas_presas
            WHERE presa_id = p_presa_id AND escala_msnm IS NOT NULL
              AND ABS(EXTRACT(EPOCH FROM (fecha::timestamptz - g.fecha_escena)) / 86400.0) <= v_umbral_dias
            ORDER BY ABS(EXTRACT(EPOCH FROM (fecha::timestamptz - g.fecha_escena)))
            LIMIT 1
        ) lp ON true
        WHERE g.presa_id = p_presa_id AND g.es_referencia_historica = false
    ),
    validas AS (
        SELECT banda, fecha_escena, area_km2, (area_ha_oficial / 100.0) AS area_km2_oficial
        FROM observaciones
        WHERE area_ha_oficial IS NOT NULL AND area_ha_oficial > 0
    )
    SELECT
        v.banda AS banda_elevacion_msnm,
        AVG(v.area_km2 / v.area_km2_oficial) AS factor_area,
        COUNT(*)::INTEGER AS n_observaciones
    FROM validas v
    GROUP BY v.banda
    HAVING COUNT(*) >= 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.fn_recalibra_curva_batimetrica(TEXT) IS
  'Recalcula, por banda de elevación de 1m, el factor de corrección (área NDWI real / área CONAGUA oficial esperada) promediando todas las observaciones disponibles de esta presa. Llamada por la Edge Function recalibra-curva-batimetrica; no escribe por sí sola en curva_batimetrica_correccion (eso lo hace el caller vía upsert, para poder limpiar bandas que ya no tienen observaciones).';

-- ── Verificación ────────────────────────────────────────────────────────────
-- Probar el cálculo sin escribir nada:
--   SELECT * FROM fn_recalibra_curva_batimetrica('PRE-001') ORDER BY banda_elevacion_msnm;
-- Ver factores ya guardados:
--   SELECT banda_elevacion_msnm, factor_area, desviacion_pct_prom, n_observaciones
--   FROM curva_batimetrica_correccion WHERE presa_id = 'PRE-001' ORDER BY banda_elevacion_msnm;
