-- Migración: Soporte para Inteligencia Hídrica (Chat y Base de Conocimiento)
-- Objetivo: Asegurar la existencia de tablas para el Asistente IA y RAG

-- 0. Habilitar extensión vector si está disponible
CREATE EXTENSION IF NOT EXISTS vector;

-- LIMPIEZA PREVIA (Para asegurar que no hay restricciones antiguas de prototipos)
DROP TABLE IF EXISTS public.hydric_document_chunks CASCADE;
DROP TABLE IF EXISTS public.hydric_documents CASCADE;
DROP TABLE IF EXISTS public.hydric_knowledge_base CASCADE;
DROP TABLE IF EXISTS public.chat_messages CASCADE;
DROP TABLE IF EXISTS public.chat_conversations CASCADE;

-- 1. Base de Conocimiento (Manual/Curada)
CREATE TABLE public.hydric_knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    categoria TEXT DEFAULT 'general',
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Documentos Técnicos (RAG - Subidos por Usuario)
CREATE TABLE public.hydric_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    tipo_documento TEXT DEFAULT 'manual',
    url_storage TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid()
);

-- 3. Fragmentos de Documentos (Chunks para búsqueda semántica)
CREATE TABLE public.hydric_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES public.hydric_documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(1536), -- Para pgvector (OpenAI standard)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. Conversaciones del Chat
CREATE TABLE public.chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    titulo TEXT,
    contexto TEXT DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 5. Mensajes del Chat
CREATE TABLE public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 6. Habilitar RLS
ALTER TABLE public.hydric_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydric_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydric_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 7. Políticas (Siguiendo la Directiva de Hidro-Sincronía)

-- Knowledge Base: Lectura pública (usuarios autenticados), Escritura solo Admin (SRL)
CREATE POLICY "Lectura pública de conocimiento" ON public.hydric_knowledge_base FOR SELECT USING (true);

-- Documents: Usuarios ven lo que suben, SRL ve todo
-- Nota: Usamos perfiles_usuario que es el nombre final en el sistema
CREATE POLICY "Usuarios ven sus documentos" ON public.hydric_documents FOR SELECT 
USING (auth.uid() = created_by OR EXISTS (SELECT 1 FROM perfiles_usuario WHERE id = auth.uid() AND rol = 'SRL'));

CREATE POLICY "Usuarios insertan sus documentos" ON public.hydric_documents FOR INSERT 
WITH CHECK (auth.uid() = created_by);

-- Chat: Privacidad estricta por usuario
CREATE POLICY "Usuarios ven sus conversaciones" ON public.chat_conversations FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Usuarios insertan sus conversaciones" ON public.chat_conversations FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios ven sus mensajes" ON public.chat_messages FOR SELECT 
USING (EXISTS (SELECT 1 FROM chat_conversations WHERE id = conversation_id AND user_id = auth.uid()));

CREATE POLICY "Usuarios insertan sus mensajes" ON public.chat_messages FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM chat_conversations WHERE id = conversation_id AND user_id = auth.uid()));

-- 8. Seed inicial básico para pruebas
INSERT INTO public.hydric_knowledge_base (titulo, contenido, categoria)
VALUES ('Capacidad Canal Principal Conchos', 'El Canal Principal Conchos tiene una capacidad de diseño de 60 m3/s desde la presa La Boquilla.', 'general');
