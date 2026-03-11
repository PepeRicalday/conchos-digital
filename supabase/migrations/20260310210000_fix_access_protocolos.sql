-- Migración: Reparación Total de Acceso a Protocolos
-- Objetivo: Resolver el error PGRST116 (múltiples activos) y habilitar permisos de edición.

-- 1. LIMPIEZA DRÁSTICA: Desactivar todo lo que no sea el registro más nuevo
UPDATE public.sica_eventos_log
SET esta_activo = false
WHERE id NOT IN (
    SELECT id 
    FROM public.sica_eventos_log 
    ORDER BY fecha_inicio DESC 
    LIMIT 1
);

-- 2. HABILITAR RLS (Si no estaba)
ALTER TABLE public.sica_eventos_log ENABLE ROW LEVEL SECURITY;

-- 3. POLÍTICAS DE ACCESO
DO $$ 
BEGIN
    -- Borrar políticas antiguas para evitar duplicados
    DROP POLICY IF EXISTS "Lectura pública de protocolos" ON public.sica_eventos_log;
    DROP POLICY IF EXISTS "Inserción de protocolos por usuarios" ON public.sica_eventos_log;
    DROP POLICY IF EXISTS "Actualización de protocolos por usuarios" ON public.sica_eventos_log;

    -- Crear nuevas políticas
    CREATE POLICY "Lectura pública de protocolos" 
        ON public.sica_eventos_log FOR SELECT 
        USING (true);

    CREATE POLICY "Inserción de protocolos por usuarios" 
        ON public.sica_eventos_log FOR INSERT 
        WITH CHECK (true); -- En un entorno real, filtraríamos por rol 'SRL' o 'ACU'

    CREATE POLICY "Actualización de protocolos por usuarios" 
        ON public.sica_eventos_log FOR UPDATE 
        USING (true);
END $$;

-- 4. RE-VINCULAR TRIGGER DE SEGURIDAD (Garantía de Hidro-Sincronía)
-- Esto asegura que si el usuario logra insertar uno nuevo, el anterior se apague.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS ensure_single_active_event ON public.sica_eventos_log;
CREATE TRIGGER ensure_single_active_event
BEFORE INSERT OR UPDATE ON public.sica_eventos_log
FOR EACH ROW
EXECUTE FUNCTION public.tr_ensure_single_active_event();

COMMENT ON TABLE public.sica_eventos_log IS 'Bitácora oficial de protocolos hidráulicos. RLS y Trigger configurados para Hidro-Sincronía.';
