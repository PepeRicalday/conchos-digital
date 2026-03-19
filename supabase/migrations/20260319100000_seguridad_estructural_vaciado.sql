-- Migración: Seguridad Estructural - Control de Tasa de Vaciado
-- Implementa la regla física de Hidro-Sincronía para evitar daños por supresión en losas de concreto.

CREATE OR REPLACE FUNCTION public.fn_validar_seguridad_estructural()
RETURNS TRIGGER AS $$
DECLARE
    v_ultima_lectura RECORD;
    v_tasa_vaciado_cm_dia NUMERIC;
    v_horas_transcurridas NUMERIC;
    v_escala_nombre TEXT;
BEGIN
    -- 1. Verificar si existe un bypass gerencial en las notas
    IF NEW.notas LIKE '%[AUTORIZADO: Bypass Gerencial SRL]%' THEN
        RETURN NEW;
    END IF;

    -- 2. Obtener la última lectura para esta escala (excluyendo la actual si es update)
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

    -- 5. Solo validamos si ha pasado un tiempo razonable (ej. > 1h) para evitar picos por ruido
    -- Y si el nivel está bajando (vaciado)
    IF v_horas_transcurridas > 1 AND NEW.nivel_m < v_ultima_lectura.nivel_m THEN
        -- Tasa = (delta_m * 100 cm) / (horas / 24h)
        v_tasa_vaciado_cm_dia := ((v_ultima_lectura.nivel_m - NEW.nivel_m) * 100) / (v_horas_transcurridas / 24);

        -- Límite de Seguridad: 30cm / día
        IF v_tasa_vaciado_cm_dia > 30 THEN
            SELECT nombre INTO v_escala_nombre FROM public.escalas WHERE id = NEW.escala_id;
            
            RAISE EXCEPTION 'ERROR DE SEGURIDAD ESTRUCTURAL en %: La tasa de vaciado detectada (% cm/día) excede el límite de 30cm/día. Riesgo de supresión y daño en losas de concreto. Se requiere Autorización Gerencial.', 
                COALESCE(v_escala_nombre, NEW.escala_id), 
                ROUND(v_tasa_vaciado_cm_dia, 2);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar el gatillo a la tabla de lecturas
DROP TRIGGER IF EXISTS trg_seguridad_estructural_escalas ON public.lecturas_escalas;
CREATE TRIGGER trg_seguridad_estructural_escalas
BEFORE INSERT OR UPDATE ON public.lecturas_escalas
FOR EACH ROW EXECUTE PROCEDURE public.fn_validar_seguridad_estructural();

COMMENT ON FUNCTION public.fn_validar_seguridad_estructural() IS 'Gatillo de Hidro-Sincronía para validar la integridad física del canal mediante el control de la tasa de abatimiento.';
