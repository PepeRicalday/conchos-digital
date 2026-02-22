-- Migración: Lógica Hidráulica (Hydra Engine) en Base de Datos

-- 1. Función para validar que el gasto no supere la capacidad de diseño
CREATE OR REPLACE FUNCTION check_capacity_limit()
RETURNS TRIGGER AS $$
DECLARE
    limit_q NUMERIC;
BEGIN
    -- Obtener la capacidad de diseño según el tipo de ubicación
    IF NEW.location_type = 'canal' THEN
        SELECT design_capacity INTO limit_q FROM public.canals WHERE id = NEW.location_id;
    ELSIF NEW.location_type = 'dam' THEN
        -- Para presas, podríamos checar capacidad de extracción máxima si existiera esa columna
        -- Por ahora, permitimos, o definimos lógica específica
        LIMIT_Q := 999999; 
    END IF;

    -- Validar
    IF NEW.value_q > limit_q THEN
        RAISE EXCEPTION 'Hydraulic Integrity Violation: Flow rate (% m3/s) exceeds design capacity (% m3/s)', NEW.value_q, limit_q;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger para ejecutar la validación antes de insertar/actualizar
DROP TRIGGER IF EXISTS trg_check_capacity ON public.measurements;
CREATE TRIGGER trg_check_capacity
BEFORE INSERT OR UPDATE ON public.measurements
FOR EACH ROW EXECUTE FUNCTION check_capacity_limit();

-- 3. Función para calcular volumen automáticamente (Si no se provee)
-- Asume que value_q es m3/s y se está registrando un volumen diario (86400 seg) o instantáneo
-- Esta es una simplificación. En realidad, se integraría con el tiempo transcurrido.
CREATE OR REPLACE FUNCTION calculate_volume()
RETURNS TRIGGER AS $$
BEGIN
    -- Si no se provee volumen, calcularlo asumiento flujo constante por 24h (para registros diarios)
    -- O dejarlo null si es un check instantáneo. 
    -- Regla de Negocio: Si value_vol es NULL, calcular Q * 86400 / 1e6 (a Millones de m3)
    IF NEW.value_vol IS NULL THEN
        NEW.value_vol := (NEW.value_q * 86400) / 1000000;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger de cálculo
DROP TRIGGER IF EXISTS trg_calculate_vol ON public.measurements;
CREATE TRIGGER trg_calculate_vol
BEFORE INSERT ON public.measurements
FOR EACH ROW EXECUTE FUNCTION calculate_volume();
