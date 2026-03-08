-- =========================================================================
-- MOTOR SICA FASE 2: VIGILANCIA TÁCTICA DE SOBREGIROS EN CANALES
-- =========================================================================

CREATE OR REPLACE FUNCTION public.check_module_overdraft()
RETURNS TRIGGER AS $$
DECLARE
    v_modulo_id UUID;
    v_target_flow NUMERIC;
    v_current_total_flow NUMERIC;
    v_modulo_nombre TEXT;
    v_punto_capacidad NUMERIC;
    v_punto_nombre TEXT;
    v_coords JSONB;
BEGIN
    -- 1. Identificar a qué módulo pertenece y coordenadas
    SELECT m.id, m.caudal_objetivo, m.nombre, p.capacidad_max, p.nombre, jsonb_build_object('lat', p.coords_x, 'lng', p.coords_y)
    INTO v_modulo_id, v_target_flow, v_modulo_nombre, v_punto_capacidad, v_punto_nombre, v_coords
    FROM public.puntos_entrega p
    JOIN public.modulos m ON p.modulo_id = m.id
    WHERE p.id = NEW.punto_id;

    -- =================================================================
    -- A. ALERTA ÁMBAR: INFRAESTRUCTURA AL LÍMITE (>90% de capacidad)
    -- =================================================================
    IF v_punto_capacidad IS NOT NULL AND v_punto_capacidad > 0 THEN
        IF NEW.valor_q > (v_punto_capacidad * 0.90) THEN
            -- Revisar si ya existe la alerta ámbar
            IF NOT EXISTS (
                SELECT 1 FROM public.registro_alertas 
                WHERE origen_id = NEW.punto_id::text
                  AND resuelta = false 
                  AND tipo_riesgo = 'warning'
                  AND categoria = 'infraestructura'
            ) THEN
                INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id, coordenadas)
                VALUES (
                    'warning', 
                    'infraestructura', 
                    'Tensión en Red: ' || v_punto_nombre, 
                    'El canal está operando a ' || ROUND(NEW.valor_q::numeric, 2) || ' m³/s, superando el 90% de su capacidad máxima de diseño (' || ROUND(v_punto_capacidad::numeric, 2) || ' m³/s). Riesgo de desborde.',
                    NEW.punto_id::text,
                    v_coords
                );
            END IF;
        END IF;
    END IF;

    -- =================================================================
    -- B. ALERTA ROJA: SOBREGIRO MAYOR DEL MÓDULO (>15% extra)
    -- =================================================================
    IF v_modulo_id IS NOT NULL AND v_target_flow IS NOT NULL AND v_target_flow > 0 THEN
        -- Sumar el flujo ACTUAL de todos los puntos de este módulo
        -- (Agarrando solo la última medición de cada punto)
        SELECT COALESCE(SUM(latest_q), 0) INTO v_current_total_flow
        FROM (
            SELECT DISTINCT ON (punto_id) valor_q as latest_q
            FROM public.mediciones m_sub
            JOIN public.puntos_entrega p_sub ON m_sub.punto_id = p_sub.id
            WHERE p_sub.modulo_id = v_modulo_id
            ORDER BY punto_id, fecha_hora DESC
        ) sub;

        -- Check Overdraft (>15% sobre el autorizado)
        IF v_current_total_flow > (v_target_flow * 1.15) THEN
            -- Prender Alerta Roja si no existe
            IF NOT EXISTS (
                SELECT 1 FROM public.registro_alertas 
                WHERE origen_id = v_modulo_id::text
                  AND resuelta = false 
                  AND tipo_riesgo = 'critical'
                  AND categoria = 'caudal'
            ) THEN
                INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id, coordenadas)
                VALUES (
                    'critical', 
                    'caudal', 
                    'Sobregiro Mayor Detectado: ' || v_modulo_nombre, 
                    'Extracción global detectada de ' || ROUND(v_current_total_flow::numeric, 2) || ' m³/s. Excede el límite de diseño/autorizado de ' || ROUND(v_target_flow::numeric, 2) || ' m³/s en más del 15%. Posible falla operativa o toma irregular.',
                    v_modulo_id::text,
                    v_coords
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Adjuntar trigger a la tabla de mediciones (Aforos en el sol)
DROP TRIGGER IF EXISTS trigger_vigilancia_canales_sica ON public.mediciones;
CREATE TRIGGER trigger_vigilancia_canales_sica
    AFTER INSERT OR UPDATE ON public.mediciones
    FOR EACH ROW
    EXECUTE FUNCTION public.check_module_overdraft();
