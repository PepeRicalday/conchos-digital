-- Repara la migración 20260429100000_rag_vectorial_gte_small.sql, que quedó
-- registrada como aplicada en schema_migrations pero se ejecutó solo a medias
-- en producción: la columna embedding sí quedó en vector(384), pero la función
-- match_hydric_documents(), el índice HNSW y la política de lectura nunca se
-- crearon (el DROP POLICY viejo corrió; el CREATE POLICY nuevo no).
--
-- Esto dejaba a hydric-chat llamando una RPC inexistente (falla silenciosa,
-- capturada por try/catch → RAG devuelve [] siempre) y a la tabla con RLS
-- activo sin ninguna política (bloqueo total de lectura).

-- 1. Índice HNSW para búsqueda coseno (faltante)
CREATE INDEX IF NOT EXISTS hydric_chunks_embedding_hnsw_idx
    ON public.hydric_document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 2. Función de búsqueda semántica (faltante — causa raíz del RAG roto)
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

-- 3. Política de lectura para chunks (faltante — RLS activo sin políticas bloqueaba todo)
DROP POLICY IF EXISTS "Usuarios ven chunks de sus documentos" ON public.hydric_document_chunks;
CREATE POLICY "Usuarios ven chunks de sus documentos" ON public.hydric_document_chunks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.hydric_documents d
            WHERE d.id = document_id
              AND (d.created_by = auth.uid()
                   OR EXISTS (SELECT 1 FROM perfiles_usuario WHERE id = auth.uid() AND rol = 'SRL'))
        )
    );
