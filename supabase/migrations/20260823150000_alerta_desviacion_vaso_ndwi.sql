-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTA DE DESVIACIÓN CRÍTICA — validación cruzada NDWI vs. curva batimétrica
-- Fecha: 2026-08-23
--
-- Mismo patrón que check_dam_critical_level (20260307130000): trigger AFTER
-- INSERT/UPDATE sobre la tabla fuente, que calcula la condición en SQL y
-- escribe en registro_alertas si aplica. Aquí la tabla fuente es
-- vaso_geometria_historico (nueva fila = nueva escena NDWI mensual, poblada
-- por sentinel-ndwi-vaso-sync) en vez de lecturas_presas.
--
-- Por qué en SQL y no en el cliente: PresaVasoMonitor.tsx ya calcula esta
-- misma validación cruzada (validacionCruzada, useMemo) para pintarla en
-- pantalla, pero eso solo corre si un operador abre el modal de esa presa
-- ese día — una desviación real bajo el 90% podría pasar semanas sin que
-- nadie la vea. El trigger la detecta apenas el cron mensual inserta el dato,
-- sin depender de que alguien abra la UI.
--
-- Lógica de coincidencia (replica areaPorElevacion + pctCoincidencia del
-- frontend): para la fila nueva, busca en lecturas_presas la lectura de
-- campo (escala_msnm) más cercana en fecha (máx. 20 días, mismo umbral que
-- UMBRAL_DIAS_VALIDACION en PresaVasoMonitor.tsx), interpola el área
-- esperada sobre curvas_capacidad, y compara contra el área_km2 medida por
-- NDWI. Si el % de coincidencia cae por debajo de 90%, inserta alerta.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_desviacion_vaso_ndwi()
RETURNS TRIGGER AS $$
DECLARE
    v_umbral_dias CONSTANT INTEGER := 20;
    v_umbral_pct  CONSTANT NUMERIC := 90.0;
    v_nombre_presa TEXT;
    v_coords JSONB;
    v_lectura RECORD;
    v_area_esperada_ha NUMERIC;
    v_area_esperada_km2 NUMERIC;
    v_pct_coincidencia NUMERIC;
BEGIN
    -- Filas de referencia puntual (ej. máxima extensión histórica 2017) no
    -- participan de la validación cruzada del ciclo — mismo criterio que
    -- opcionesSerieMensual en el frontend, que las excluye de la tendencia.
    IF NEW.es_referencia_historica THEN
        RETURN NEW;
    END IF;

    -- Lectura de campo más cercana en fecha a la escena NDWI (±20 días).
    SELECT fecha, escala_msnm INTO v_lectura
    FROM public.lecturas_presas
    WHERE presa_id = NEW.presa_id
      AND escala_msnm IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (fecha::timestamptz - NEW.fecha_escena)) / 86400.0) <= v_umbral_dias
    ORDER BY ABS(EXTRACT(EPOCH FROM (fecha::timestamptz - NEW.fecha_escena)))
    LIMIT 1;

    -- Sin lectura de campo cercana: no hay referencia contra la cual validar
    -- (mismo caso "sinReferencia" del frontend) — no se genera alerta.
    IF v_lectura IS NULL THEN
        RETURN NEW;
    END IF;

    -- Interpolación lineal de área (ha) sobre curvas_capacidad para la
    -- elevación de la lectura de campo — misma lógica que areaPorElevacion
    -- en PresaVasoMonitor.tsx, resuelta aquí con una subconsulta de los dos
    -- puntos de la curva oficial que acotan la elevación.
    WITH curva AS (
        SELECT elevacion_msnm, area_ha
        FROM public.curvas_capacidad
        WHERE presa_id = NEW.presa_id AND area_ha IS NOT NULL
        ORDER BY elevacion_msnm
    ),
    acotado AS (
        SELECT
            (SELECT area_ha FROM curva WHERE elevacion_msnm <= v_lectura.escala_msnm ORDER BY elevacion_msnm DESC LIMIT 1) AS area_inf,
            (SELECT elevacion_msnm FROM curva WHERE elevacion_msnm <= v_lectura.escala_msnm ORDER BY elevacion_msnm DESC LIMIT 1) AS elev_inf,
            (SELECT area_ha FROM curva WHERE elevacion_msnm >= v_lectura.escala_msnm ORDER BY elevacion_msnm ASC LIMIT 1) AS area_sup,
            (SELECT elevacion_msnm FROM curva WHERE elevacion_msnm >= v_lectura.escala_msnm ORDER BY elevacion_msnm ASC LIMIT 1) AS elev_sup
    )
    SELECT
        CASE
            WHEN elev_inf IS NULL OR elev_sup IS NULL THEN NULL
            WHEN elev_inf = elev_sup THEN area_inf
            ELSE area_inf + (v_lectura.escala_msnm - elev_inf) / (elev_sup - elev_inf) * (area_sup - area_inf)
        END
    INTO v_area_esperada_ha
    FROM acotado;

    IF v_area_esperada_ha IS NULL OR v_area_esperada_ha <= 0 THEN
        RETURN NEW; -- sin curva batimétrica cargada para esta presa: no se puede validar
    END IF;

    v_area_esperada_km2 := v_area_esperada_ha / 100.0;
    v_pct_coincidencia := (NEW.area_km2 / v_area_esperada_km2) * 100.0;

    IF v_pct_coincidencia < v_umbral_pct THEN
        SELECT jsonb_build_object('lat', latitud, 'lng', longitud), nombre
        INTO v_coords, v_nombre_presa
        FROM public.presas WHERE id::text = NEW.presa_id;

        -- Anti-duplicado: una alerta no resuelta por presa/categoría ya
        -- cubre el caso de varios meses seguidos por debajo del umbral —
        -- no se apila una alerta nueva por cada corrida mensual del cron
        -- mientras la anterior siga abierta.
        IF NOT EXISTS (
            SELECT 1 FROM public.registro_alertas
            WHERE origen_id = NEW.presa_id
              AND resuelta = false
              AND categoria = 'desviacion_batimetrica'
        ) THEN
            INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id, coordenadas)
            VALUES (
                CASE WHEN v_pct_coincidencia < 80 THEN 'critical' ELSE 'warning' END,
                'desviacion_batimetrica',
                'Desviación Crítica: Área NDWI vs. Curva Batimétrica Oficial',
                'El área de vaso medida por satélite (' || ROUND(NEW.area_km2::numeric, 1) || ' km², escena del '
                    || to_char(NEW.fecha_escena, 'DD/MM/YYYY') || ') coincide solo en ' || ROUND(v_pct_coincidencia::numeric, 0)
                    || '% con el área esperada por la curva batimétrica oficial CONAGUA ('
                    || ROUND(v_area_esperada_km2::numeric, 1) || ' km², interpolada sobre la lectura de campo del '
                    || to_char(v_lectura.fecha, 'DD/MM/YYYY') || '). Se solicita verificación topográfica en sitio en '
                    || COALESCE(v_nombre_presa, NEW.presa_id) || '.',
                NEW.presa_id,
                v_coords
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_desviacion_vaso_ndwi ON public.vaso_geometria_historico;
CREATE TRIGGER trigger_desviacion_vaso_ndwi
    AFTER INSERT OR UPDATE ON public.vaso_geometria_historico
    FOR EACH ROW
    EXECUTE FUNCTION public.check_desviacion_vaso_ndwi();

-- 'desviacion_batimetrica' es una categoría nueva no contemplada en el CHECK
-- original de registro_alertas.categoria (20260307130000: 'caudal',
-- 'infraestructura', 'evaporacion', 'nivel_critico') — se amplía el
-- constraint en vez de forzar la alerta dentro de una categoría que no la
-- describe.
ALTER TABLE public.registro_alertas DROP CONSTRAINT IF EXISTS registro_alertas_categoria_check;
ALTER TABLE public.registro_alertas ADD CONSTRAINT registro_alertas_categoria_check
    CHECK (categoria IN ('caudal', 'infraestructura', 'evaporacion', 'nivel_critico', 'desviacion_batimetrica'));

COMMENT ON FUNCTION public.check_desviacion_vaso_ndwi() IS
  'Al insertar una escena mensual de vaso_geometria_historico, valida el área NDWI contra la curva batimétrica oficial (CONAGUA) interpolada sobre la lectura de campo más cercana (±20 días). Genera registro_alertas si la coincidencia cae bajo 90% (warning) u 80% (critical).';

-- ── Verificación ────────────────────────────────────────────────────────────
-- Ver alertas de este tipo:
--   SELECT titulo, mensaje, tipo_riesgo, fecha_deteccion FROM registro_alertas
--   WHERE categoria = 'desviacion_batimetrica' ORDER BY fecha_deteccion DESC;
-- Forzar una prueba (requiere una fila real en lecturas_presas cercana en fecha):
--   UPDATE vaso_geometria_historico SET area_km2 = area_km2 * 0.7
--   WHERE presa_id = 'PRE-001' AND fecha_escena = (SELECT MAX(fecha_escena) FROM vaso_geometria_historico WHERE presa_id='PRE-001');
