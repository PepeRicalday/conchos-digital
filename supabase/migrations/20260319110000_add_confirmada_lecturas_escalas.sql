-- Migración: Añadir columna confirmada a lecturas_escalas
-- Permite que el sistema reconozca un bypass gerencial explícito desde el payload.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lecturas_escalas' AND column_name = 'confirmada') THEN
        ALTER TABLE public.lecturas_escalas ADD COLUMN confirmada BOOLEAN DEFAULT false;
    END IF;
END
$$;

COMMENT ON COLUMN public.lecturas_escalas.confirmada IS 'Indica si la lectura ha sido ratificada/confirmada mediante bypass gerencial para ignorar validaciones físicas restrictivas.';

-- Actualizar la función del gatillo para considerar también esta columna
CREATE OR REPLACE FUNCTION public.fn_validar_seguridad_estructural()
RETURNS TRIGGER AS $$
DECLARE
    v_ultima_lectura RECORD;
    v_tasa_vaciado_cm_dia NUMERIC;
    v_horas_transcurridas NUMERIC;
    v_escala_nombre TEXT;
BEGIN
    -- 1. Verificar si existe un bypass gerencial (vía columna confirmada o vía notas)
    IF NEW.confirmada = true OR NEW.notas LIKE '%[AUTORIZADO:%' THEN
        RETURN NEW;
    END IF;

    -- 2. Obtener la última lectura para esta escala
    SELECT * INTO v_ultima_lectura
    FROM public.lecturas_escalas
    WHERE escala_id = NEW.escala_id
      AND id != NEW.id
      AND (fecha < NEW.fecha OR (fecha = NEW.fecha AND hora_lectura < NEW.hora_lectura))
    ORDER BY fecha DESC, hora_lectura DESC
    LIMIT 1;

    -- 3. Si no hay lectura previa, no podemos validar tasa de cambio
    IF v_ultima_lectura IS NULL THEN
        RETURN NEW;
    END IF;

    -- 4. Calcular diferencial de tiempo en horas
    v_horas_transcurridas := EXTRACT(EPOCH FROM (
        (NEW.fecha || ' ' || NEW.hora_lectura)::TIMESTAMP - 
        (v_ultima_lectura.fecha || ' ' || v_ultima_lectura.hora_lectura)::TIMESTAMP
    )) / 3600;

    -- 5. Validar tasa de vaciado si ha pasado > 1h
    IF v_horas_transcurridas > 0.5 AND NEW.nivel_m < v_ultima_lectura.nivel_m THEN
        -- Tasa = (delta_m * 100 cm) / (horas / 24h)
        v_tasa_vaciado_cm_dia := ((v_ultima_lectura.nivel_m - NEW.nivel_m) * 100) / (v_horas_transcurridas / 24);

        -- Límite de Seguridad: 30cm / día
        IF v_tasa_vaciado_cm_dia > 30 THEN
            SELECT nombre INTO v_escala_nombre FROM public.escalas WHERE id = NEW.escala_id;
            
            RAISE EXCEPTION 'ESTRUCTURAL: Tasa de vaciado peligrosa detectada en % (% cm/día). Excede límite de 30cm/día. Se requiere Bypass Gerencial.', 
                COALESCE(v_escala_nombre, NEW.escala_id), 
                ROUND(v_tasa_vaciado_cm_dia, 2);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
