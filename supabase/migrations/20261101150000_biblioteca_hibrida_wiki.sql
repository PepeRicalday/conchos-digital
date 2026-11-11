-- Biblioteca documental de SICA: metadatos por documento, páginas/secciones por fragmento, búsqueda híbrida
-- (vectorial multilingüe + palabras en español con RRF) y tabla de wiki (bóveda de Obsidian).
-- Aditiva: no toca `embedding` (gte-small) ni match_hydric_documents; se retiran después de re-indexar.

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- unaccent() no es IMMUTABLE; este envoltorio sí, para poder usarlo en columnas generadas e índices.
CREATE OR REPLACE FUNCTION public.f_unaccent(texto text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public, extensions
AS $$ SELECT extensions.unaccent('extensions.unaccent'::regdictionary, texto) $$;

-- ── Documentos ──────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.hydric_documents
    ADD COLUMN IF NOT EXISTS tipo        text,
    ADD COLUMN IF NOT EXISTS anio        integer,
    ADD COLUMN IF NOT EXISTS vigente     boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS sha256      text,
    ADD COLUMN IF NOT EXISTS origen      text NOT NULL DEFAULT 'ui',
    ADD COLUMN IF NOT EXISTS ruta_local  text,
    ADD COLUMN IF NOT EXISTS paginas     integer,
    ADD COLUMN IF NOT EXISTS estado_ocr  text,
    ADD COLUMN IF NOT EXISTS equipo      text;

ALTER TABLE public.hydric_documents DROP CONSTRAINT IF EXISTS hydric_documents_tipo_check;
ALTER TABLE public.hydric_documents ADD CONSTRAINT hydric_documents_tipo_check
    CHECK (tipo IS NULL OR tipo IN ('norma', 'anexo', 'manual_tecnico', 'especificacion', 'estudio'));
ALTER TABLE public.hydric_documents DROP CONSTRAINT IF EXISTS hydric_documents_origen_check;
ALTER TABLE public.hydric_documents ADD CONSTRAINT hydric_documents_origen_check CHECK (origen IN ('ui', 'local'));
ALTER TABLE public.hydric_documents DROP CONSTRAINT IF EXISTS hydric_documents_estado_ocr_check;
ALTER TABLE public.hydric_documents ADD CONSTRAINT hydric_documents_estado_ocr_check
    CHECK (estado_ocr IS NULL OR estado_ocr IN ('no_requerido', 'parcial', 'pendiente'));

CREATE UNIQUE INDEX IF NOT EXISTS hydric_documents_sha256_uidx ON public.hydric_documents (sha256) WHERE sha256 IS NOT NULL;

-- ── Fragmentos ──────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.hydric_document_chunks
    ADD COLUMN IF NOT EXISTS pagina_ini   integer,
    ADD COLUMN IF NOT EXISTS pagina_fin   integer,
    ADD COLUMN IF NOT EXISTS seccion      text,
    ADD COLUMN IF NOT EXISTS embedding_v2 vector(1024);

-- Columna generada: palabras en español sin acentos (sección + contenido). Se mantiene sola al insertar/actualizar.
ALTER TABLE public.hydric_document_chunks
    ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('spanish', public.f_unaccent(coalesce(seccion, '') || ' ' || content))) STORED;

CREATE INDEX IF NOT EXISTS hydric_chunks_fts_gin_idx ON public.hydric_document_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS hydric_chunks_embedding_v2_hnsw_idx
    ON public.hydric_document_chunks USING hnsw (embedding_v2 vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS hydric_chunks_doc_orden_idx ON public.hydric_document_chunks (document_id, pagina_ini);

-- ── Búsqueda híbrida (RRF) ──────────────────────────────────────────────────────────────────────────────────
-- Une dos rankings: el de palabras (ts_rank_cd) y el vectorial (coseno). Cada ranking aporta 1/(60+posición).
-- Bono pequeño por tipo: la norma pesa más que un estudio. Si `consulta_vec` es NULL solo se usan palabras
-- (así la búsqueda sigue funcionando si el servicio de embeddings falla).
CREATE OR REPLACE FUNCTION public.buscar_documentos_hibrido(
    consulta     text,
    consulta_vec vector(1024) DEFAULT NULL,
    tipos        text[]  DEFAULT NULL,
    solo_vigentes boolean DEFAULT true,
    k            integer DEFAULT 8
)
RETURNS TABLE (
    id uuid, document_id uuid, titulo text, tipo text, anio integer, vigente boolean, equipo text,
    pagina_ini integer, pagina_fin integer, seccion text, content text, puntaje double precision,
    en_palabras boolean, en_vector boolean
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    q tsquery;
    palabras text[];
BEGIN
    -- OR entre palabras (≥3 letras o con dígito): una pregunta en lenguaje natural no debe exigir TODAS las palabras.
    SELECT array_agg(DISTINCT w) INTO palabras
    FROM (
        SELECT regexp_replace(lower(public.f_unaccent(t)), '[^a-z0-9]', '', 'g') AS w
        FROM unnest(regexp_split_to_array(coalesce(consulta, ''), '\s+')) AS t
    ) s
    WHERE length(w) >= 3 OR w ~ '[0-9]';
    IF palabras IS NOT NULL AND array_length(palabras, 1) > 0 THEN
        q := to_tsquery('spanish', array_to_string(palabras, ' | '));
    END IF;

    RETURN QUERY
    WITH base AS (
        SELECT c.id, c.document_id, d.titulo, d.tipo, d.anio, d.vigente, d.equipo,
               c.pagina_ini, c.pagina_fin, c.seccion, c.content, c.fts, c.embedding_v2
        FROM public.hydric_document_chunks c
        JOIN public.hydric_documents d ON d.id = c.document_id
        WHERE (tipos IS NULL OR d.tipo = ANY (tipos))
          AND (NOT solo_vigentes OR d.vigente)
    ),
    por_palabras AS (
        SELECT b.id, row_number() OVER (ORDER BY ts_rank_cd(b.fts, q) DESC) AS pos
        FROM base b
        WHERE q IS NOT NULL AND b.fts @@ q
        ORDER BY ts_rank_cd(b.fts, q) DESC
        LIMIT 30
    ),
    por_vector AS (
        SELECT b.id, row_number() OVER (ORDER BY b.embedding_v2 <=> consulta_vec) AS pos
        FROM base b
        WHERE consulta_vec IS NOT NULL AND b.embedding_v2 IS NOT NULL
        ORDER BY b.embedding_v2 <=> consulta_vec
        LIMIT 30
    ),
    fusion AS (
        SELECT coalesce(p.id, v.id) AS id,
               coalesce(1.0 / (60 + p.pos), 0) + coalesce(1.0 / (60 + v.pos), 0) AS rrf,
               (p.id IS NOT NULL) AS en_palabras, (v.id IS NOT NULL) AS en_vector
        FROM por_palabras p FULL OUTER JOIN por_vector v ON v.id = p.id
    )
    SELECT b.id, b.document_id, b.titulo, b.tipo, b.anio, b.vigente, b.equipo,
           b.pagina_ini, b.pagina_fin, b.seccion, b.content,
           (f.rrf + CASE b.tipo WHEN 'norma' THEN 0.004 WHEN 'anexo' THEN 0.003 WHEN 'manual_tecnico' THEN 0.002 ELSE 0 END)::double precision,
           f.en_palabras, f.en_vector
    FROM fusion f JOIN base b ON b.id = f.id
    ORDER BY 12 DESC
    LIMIT greatest(1, least(k, 20));
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_documentos_hibrido(text, vector, text[], boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_documentos_hibrido(text, vector, text[], boolean, integer) TO service_role;

-- ── Wiki (bóveda de Obsidian) ───────────────────────────────────────────────────────────────────────────────
-- Notas sintetizadas por IA a partir de fuentes. NO son evidencia: son apoyo para explicar. Solo service_role
-- (la lee hydric-chat); el script de sincronización la escribe con la service key.
CREATE TABLE IF NOT EXISTS public.wiki_paginas (
    slug          text PRIMARY KEY,
    titulo        text NOT NULL,
    carpeta       text NOT NULL,
    tipo          text,
    resumen       text,
    contenido     text NOT NULL,
    enlaces       text[] NOT NULL DEFAULT '{}',
    fuentes       jsonb  NOT NULL DEFAULT '[]'::jsonb,
    verificado    boolean NOT NULL DEFAULT false,
    sha256        text NOT NULL,
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    fts           tsvector GENERATED ALWAYS AS (to_tsvector('spanish', public.f_unaccent(titulo || ' ' || coalesce(resumen, '') || ' ' || contenido))) STORED
);
CREATE INDEX IF NOT EXISTS wiki_paginas_fts_gin_idx ON public.wiki_paginas USING gin (fts);
ALTER TABLE public.wiki_paginas ENABLE ROW LEVEL SECURITY;   -- sin políticas: solo service_role
