-- Migración: Corrección de Políticas RLS para Inteligencia Hídrica
-- Objetivo: Permitir la eliminación y actualización de conversaciones por parte de sus dueños.

-- 1. Políticas para chat_conversations
DO $$ 
BEGIN
    -- Eliminar si existen (para limpieza)
    DROP POLICY IF EXISTS "Usuarios eliminan sus conversaciones" ON public.chat_conversations;
    DROP POLICY IF EXISTS "Usuarios actualizan sus conversaciones" ON public.chat_conversations;
    
    -- Crear política de DELETE
    CREATE POLICY "Usuarios eliminan sus conversaciones" ON public.chat_conversations 
    FOR DELETE USING (auth.uid() = user_id);

    -- Crear política de UPDATE (para rernombrar títulos o actualizar timestamps)
    CREATE POLICY "Usuarios actualizan sus conversaciones" ON public.chat_conversations 
    FOR UPDATE WITH CHECK (auth.uid() = user_id);
    
END $$;

-- 2. Políticas para chat_messages (Opcional pero recomendado por seguridad)
-- La tabla chat_messages tiene ON DELETE CASCADE, por lo que al borrar la conversación se borran los mensajes automáticamente a nivel DB.
-- Aun así, es bueno permitir que el usuario borre mensajes individuales si lo desea.
DO $$
BEGIN
    DROP POLICY IF EXISTS "Usuarios eliminan sus mensajes" ON public.chat_messages;
    
    CREATE POLICY "Usuarios eliminan sus mensajes" ON public.chat_messages 
    FOR DELETE USING (EXISTS (SELECT 1 FROM chat_conversations WHERE id = conversation_id AND user_id = auth.uid()));
END $$;

-- COMENTARIOS
COMMENT ON POLICY "Usuarios eliminan sus conversaciones" ON public.chat_conversations IS 'Permite a los usuarios borrar sus propios historiales de chat.';
COMMENT ON POLICY "Usuarios actualizan sus conversaciones" ON public.chat_conversations IS 'Permite a los usuarios cambiar el título de sus conversaciones.';
