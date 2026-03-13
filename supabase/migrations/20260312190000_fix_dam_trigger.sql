-- Fix for dam critical level trigger to use correct column names
-- Date: 2026-03-12

CREATE OR REPLACE FUNCTION public.check_dam_critical_level()
RETURNS TRIGGER AS $$
DECLARE
    v_coords JSONB;
    v_nombre_presa TEXT;
BEGIN
    -- Obtener metadatos de la presa (usando nombres de columna corregidos)
    -- latitud y longitud son los nombres actuales en la tabla public.presas
    SELECT jsonb_build_object('lat', latitud, 'lng', longitud), nombre 
    INTO v_coords, v_nombre_presa
    FROM public.presas 
    WHERE id::text = NEW.presa_id 
       OR id = (SELECT id FROM public.presas WHERE nombre_corto = NEW.presa_id LIMIT 1)
       OR codigo = NEW.presa_id;

    -- Si el nivel de llenado cae por debajo del 20%, crear alerta
    IF NEW.porcentaje_llenado IS NOT NULL AND NEW.porcentaje_llenado <= 20.0 THEN
        -- Verificar que no haya una alerta no resuelta para esta misma presa hoy
        IF NOT EXISTS (
            SELECT 1 FROM public.registro_alertas 
            WHERE origen_id = NEW.presa_id 
              AND resuelta = false 
              AND tipo_riesgo = 'warning'
              AND categoria = 'nivel_critico'
        ) THEN
            INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id, coordenadas)
            VALUES (
                'warning', 
                'nivel_critico', 
                'Almacenamiento Bajo el Mínimo Operativo', 
                'La presa ' || COALESCE(v_nombre_presa, NEW.presa_id) || ' ha registrado un porcentaje crítico de ' || ROUND(NEW.porcentaje_llenado::numeric, 1) || '%',
                NEW.presa_id,
                v_coords
            );
        END IF;
    END IF;

    -- Si cae por debajo del 5% es CRÍTICO MUY ALTO
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
                'La presa ' || COALESCE(v_nombre_presa, NEW.presa_id) || ' ha colapsado a un porcentaje de sobrevivencia de ' || ROUND(NEW.porcentaje_llenado::numeric, 1) || '%.',
                NEW.presa_id,
                v_coords
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
