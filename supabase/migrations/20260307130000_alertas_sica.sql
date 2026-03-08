-- 1. Tabla Principal de Registro de Alertas SICA
CREATE TABLE IF NOT EXISTS public.registro_alertas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_riesgo TEXT NOT NULL CHECK (tipo_riesgo IN ('critical', 'warning', 'info')),
    categoria TEXT NOT NULL CHECK (categoria IN ('caudal', 'infraestructura', 'evaporacion', 'nivel_critico')),
    titulo TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    origen_id TEXT, -- ID del modulo o presa
    resuelta BOOLEAN DEFAULT FALSE,
    fecha_deteccion TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    fecha_resolucion TIMESTAMP WITH TIME ZONE,
    coordenadas JSONB -- Ej. {"lat": 28.1, "lng": -105.4}
);

-- Habilitar RLS
ALTER TABLE public.registro_alertas ENABLE ROW LEVEL SECURITY;

-- Políticas de Acceso
CREATE POLICY "Lectura publica de alertas" 
    ON public.registro_alertas FOR SELECT 
    USING (true);

CREATE POLICY "Inserción de alertas (Triggers/Backend)" 
    ON public.registro_alertas FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Actualización de resolucion" 
    ON public.registro_alertas FOR UPDATE 
    USING (true);

-- =========================================================================
-- TRIGGER AUTOMÁTICO 1: Nivel Crítico en Presas (Menor a 20%)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.check_dam_critical_level()
RETURNS TRIGGER AS $$
DECLARE
    v_coords JSONB;
    v_nombre_presa TEXT;
BEGIN
    -- Obtener metadatos de la presa
    SELECT jsonb_build_object('lat', coord_lat, 'lng', coord_lng), nombre 
    INTO v_coords, v_nombre_presa
    FROM public.presas WHERE id::text = NEW.presa_id OR id = (SELECT id FROM public.presas WHERE nombre_corto = NEW.presa_id LIMIT 1);

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

-- Adjuntar trigger a la tabla lecturas_presas
DROP TRIGGER IF EXISTS trigger_analisis_presa_sica ON public.lecturas_presas;
CREATE TRIGGER trigger_analisis_presa_sica
    AFTER INSERT OR UPDATE ON public.lecturas_presas
    FOR EACH ROW
    EXECUTE FUNCTION public.check_dam_critical_level();
