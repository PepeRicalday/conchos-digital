-- Reparación de Protocolos de Inteligencia Hídrica
-- Objetivo: Garantizar que solo exista UN evento activo a la vez.

-- 1. Limpieza: Desactivar todos los eventos excepto el más reciente
UPDATE public.sica_eventos_log
SET esta_activo = false
WHERE id NOT IN (
    SELECT id 
    FROM public.sica_eventos_log 
    ORDER BY fecha_inicio DESC 
    LIMIT 1
);

-- 2. Función Trigger para Auto-Cierre de Protocolos
CREATE OR REPLACE FUNCTION public.fn_exclusividad_evento_sica()
RETURNS trigger AS $$
BEGIN
    -- Si el nuevo evento viene activo, desactivamos todos los demás
    IF NEW.esta_activo = true THEN
        UPDATE public.sica_eventos_log
        SET esta_activo = false
        WHERE id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Crear el Disparador
DROP TRIGGER IF EXISTS tr_exclusividad_evento ON public.sica_eventos_log;
CREATE TRIGGER tr_exclusividad_evento
BEFORE INSERT OR UPDATE OF esta_activo ON public.sica_eventos_log
FOR EACH ROW
WHEN (NEW.esta_activo = true)
EXECUTE FUNCTION public.fn_exclusividad_evento_sica();

COMMENT ON FUNCTION public.fn_exclusividad_evento_sica IS 'Garantiza la Hidro-Sincronía: Solo un protocolo operativo puede estar activo en la Red Mayor.';
