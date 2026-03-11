-- Migración: Limpieza de Protocolos Duplicados
-- Objetivo: Asegurar que solo exista un evento activo a la vez (Garantía de Hidro-Sincronía)

-- 1. Desactivar todos los eventos antiguos excepto el más reciente
UPDATE public.sica_eventos_log
SET esta_activo = false
WHERE id NOT IN (
    SELECT id 
    FROM public.sica_eventos_log 
    WHERE esta_activo = true 
    ORDER BY fecha_inicio DESC 
    LIMIT 1
);

-- 2. Asegurar que el último evento realmente esté activo si es que se desea
-- (Opcional, deja solo 1 activo si había más de uno)

-- 3. Trigger de Seguridad (Preventivo)
-- Evita que en el futuro entren dos filas con esta_activo = true
CREATE OR REPLACE FUNCTION public.tr_ensure_single_active_event()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.esta_activo = true THEN
        UPDATE public.sica_eventos_log
        SET esta_activo = false
        WHERE id <> NEW.id AND esta_activo = true;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ensure_single_active_event ON public.sica_eventos_log;
CREATE TRIGGER ensure_single_active_event
BEFORE INSERT OR UPDATE ON public.sica_eventos_log
FOR EACH ROW
EXECUTE FUNCTION public.tr_ensure_single_active_event();

COMMENT ON FUNCTION public.tr_ensure_single_active_event() IS 'Garantiza que solo un protocolo hidráulico sea oficial a la vez en el Control de Mando.';
