-- Migración: RAG Vectorial con gte-small (384 dims)
-- Reemplaza la columna vector(1536) vacía por vector(384) compatible con Supabase AI
-- Agrega índice HNSW y función de búsqueda semántica

-- 1. Reemplazar columna embedding (era vector(1536), nunca poblada)
ALTER TABLE public.hydric_document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.hydric_document_chunks ADD COLUMN embedding vector(384);

-- 2. Agregar campo de estado al documento para rastrear procesamiento
ALTER TABLE public.hydric_documents ADD COLUMN IF NOT EXISTS estado_procesamiento TEXT DEFAULT 'pendiente';
ALTER TABLE public.hydric_documents ADD COLUMN IF NOT EXISTS chunks_generados INT DEFAULT 0;

-- 3. Índice HNSW para búsqueda coseno (mejor que IVFFLAT para tablas pequeñas)
CREATE INDEX IF NOT EXISTS hydric_chunks_embedding_hnsw_idx
    ON public.hydric_document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 4. Función de búsqueda semántica
CREATE OR REPLACE FUNCTION match_hydric_documents(
    query_embedding vector(384),
    match_threshold float DEFAULT 0.40,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    id uuid,
    content text,
    metadata jsonb,
    similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        hdc.id,
        hdc.content,
        hdc.metadata,
        (1.0 - (hdc.embedding <=> query_embedding))::float AS similarity
    FROM public.hydric_document_chunks hdc
    WHERE hdc.embedding IS NOT NULL
      AND (1.0 - (hdc.embedding <=> query_embedding)) > match_threshold
    ORDER BY hdc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 5. Política de lectura para chunks (service role la usa en Edge Functions)
DROP POLICY IF EXISTS "Service role lee chunks" ON public.hydric_document_chunks;
CREATE POLICY "Usuarios ven chunks de sus documentos" ON public.hydric_document_chunks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.hydric_documents d
            WHERE d.id = document_id
              AND (d.created_by = auth.uid()
                   OR EXISTS (SELECT 1 FROM perfiles_usuario WHERE id = auth.uid() AND rol = 'SRL'))
        )
    );
