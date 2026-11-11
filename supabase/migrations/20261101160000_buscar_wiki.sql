-- Búsqueda en la wiki (palabras en español sin acentos, OR entre términos). Solo service_role (la usa hydric-chat).
CREATE OR REPLACE FUNCTION public.buscar_wiki(consulta text, k integer DEFAULT 6)
RETURNS TABLE (slug text, titulo text, carpeta text, resumen text, verificado boolean, puntaje real)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    q tsquery;
    palabras text[];
BEGIN
    SELECT array_agg(DISTINCT w) INTO palabras
    FROM (
        SELECT regexp_replace(lower(public.f_unaccent(t)), '[^a-z0-9]', '', 'g') AS w
        FROM unnest(regexp_split_to_array(coalesce(consulta, ''), '\s+')) AS t
    ) s
    WHERE length(w) >= 3 OR w ~ '[0-9]';
    IF palabras IS NULL OR array_length(palabras, 1) = 0 THEN RETURN; END IF;
    q := to_tsquery('spanish', array_to_string(palabras, ' | '));

    RETURN QUERY
    SELECT p.slug, p.titulo, p.carpeta, p.resumen, p.verificado, ts_rank_cd(p.fts, q)
    FROM public.wiki_paginas p
    WHERE p.fts @@ q
    ORDER BY ts_rank_cd(p.fts, q) DESC
    LIMIT greatest(1, least(k, 15));
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_wiki(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_wiki(text, integer) TO service_role;
