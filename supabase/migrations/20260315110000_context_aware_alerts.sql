-- =========================================================================
-- MOTOR SICA FASE 3: ALERTAS SENSIBLES AL CONTEXTO (PROTOCOLO LLENADO)
-- =========================================================================
-- Actualiza la vigilancia de presas para que no genere alertas redundantes
-- si se ha autorizado una extracción extraordinaria por protocolo.

CREATE OR REPLACE FUNCTION public.check_dam_critical_level()
RETURNS TRIGGER AS $$
DECLARE
    v_coords JSONB;
    v_nombre_presa TEXT;
    v_protocolo_activo TEXT;
BEGIN
    -- 1. Identificar protocolo activo
    SELECT evento_tipo INTO v_protocolo_activo 
    FROM public.sica_eventos_log 
    WHERE esta_activo = true 
    LIMIT 1;

    -- 2. Obtener metadatos de la presa
    SELECT jsonb_build_object('lat', latitud, 'lng', longitud), nombre 
    INTO v_coords, v_nombre_presa
    FROM public.presas 
    WHERE id::text = NEW.presa_id 
       OR id = (SELECT id FROM public.presas WHERE nombre_corto = NEW.presa_id LIMIT 1)
       OR codigo = NEW.presa_id;

    -- 3. ALERTA ÁMBAR: Almacenamiento Bajo el Mínimo (20%)
    IF NEW.porcentaje_llenado IS NOT NULL AND NEW.porcentaje_llenado <= 20.0 THEN
        -- Durante LLENADO, esta alerta es INFORMATIVA si está autorizado el gasto
        -- Pero si cae por debajo de 10%, sigue siendo Warning.
        DECLARE
            v_tipo_alerta TEXT := 'warning';
            v_titulo TEXT := 'Almacenamiento Bajo el Mínimo Operativo';
            v_msg_prefix TEXT := 'La presa ';
        BEGIN
            IF v_protocolo_activo = 'LLENADO' AND NEW.porcentaje_llenado > 10.0 THEN
                v_tipo_alerta := 'info';
                v_titulo := 'Extracción en Progreso (Protocolo LLENADO)';
                v_msg_prefix := '[PROTOCOLO ACTIVO] La presa ';
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM public.registro_alertas 
                WHERE origen_id = NEW.presa_id 
                  AND resuelta = false 
                  AND tipo_riesgo = v_tipo_alerta
                  AND categoria = 'nivel_critico'
                  AND titulo = v_titulo
            ) THEN
                INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id, coordenadas)
                VALUES (
                    v_tipo_alerta, 
                    'nivel_critico', 
                    v_titulo, 
                    v_msg_prefix || COALESCE(v_nombre_presa, NEW.presa_id) || ' registra ' || ROUND(NEW.porcentaje_llenado::numeric, 1) || '%. Operación vigilada bajo protocolo.',
                    NEW.presa_id,
                    v_coords
                );
            END IF;
        END;
    END IF;

    -- 4. ALERTA ROJA: COLAPSO HIDRICÓ (5%)
    -- Esta alerta SIEMPRE es crítica independientemente del protocolo
    IF NEW.porcentaje_llenado IS NOT NULL AND NEW.porcentaje_llenado <= 5.0 THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.registro_alertas 
            WHERE origen_id = NEW.presa_id 
              AND resuelta = false 
              AND tipo_riesgo = 'critical'
              AND categoria = 'nivel_critico'
        ) THEN
            INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id, coordenadas)
            VALUES (
                'critical', 
                'nivel_critico', 
                'COLAPSO HIDRÍCO INMINENTE', 
                'Vigilancia extrema requerida: ' || COALESCE(v_nombre_presa, NEW.presa_id) || ' ha colapsado a ' || ROUND(NEW.porcentaje_llenado::numeric, 1) || '%.',
                NEW.presa_id,
                v_coords
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
