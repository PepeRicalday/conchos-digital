-- Consultoría IA — blindaje por rol (S.R.L.) de protocolos, chat y base de conocimiento.
-- Hallazgos de la auditoría 2026-10-18 (políticas reales leídas de pg_policies):
--   · sica_eventos_log: INSERT y UPDATE con `true` para el rol public (incluso anon) → cualquiera con la anon key
--     podía dictar o alterar el protocolo oficial (VACIADO/LLENADO).
--   · activar_protocolo_hidrico (SECURITY DEFINER) sin comprobar rol y ejecutable por anon/PUBLIC.
--   · chat_messages DELETE con `true`: cualquiera borraba mensajes ajenos; chat_conversations UPDATE sin USING.
--   · hydric_documents sin DELETE (el borrado de la UI fallaba en silencio) e INSERT abierto a cualquier autenticado.
--   · match_hydric_documents (RAG global, SECURITY DEFINER) ejecutable por anon/authenticated.
-- Escritores legítimos verificados: useHydricEvents/TransicionProtocolo/LlenadoTracker/EstabilizacionTracker
-- (pantalla de Control de Mando, solo SRL). Triggers y cron son SECURITY DEFINER/postgres y no pasan por RLS.

-- 1) Eventos oficiales: solo la S.R.L. escribe -----------------------------------------------------------------
DROP POLICY IF EXISTS "Inserción de protocolos por usuarios" ON public.sica_eventos_log;
DROP POLICY IF EXISTS "Usuarios autenticados pueden dictar eventos" ON public.sica_eventos_log;
DROP POLICY IF EXISTS "Actualización de protocolos por usuarios" ON public.sica_eventos_log;

CREATE POLICY "SRL dicta eventos oficiales" ON public.sica_eventos_log
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.auth_rol()) = 'SRL');

CREATE POLICY "SRL actualiza eventos oficiales" ON public.sica_eventos_log
    FOR UPDATE TO authenticated
    USING ((SELECT public.auth_rol()) = 'SRL')
    WITH CHECK ((SELECT public.auth_rol()) = 'SRL');

-- 2) RPC de protocolos: rol SRL + rangos + autor tomado del JWT -------------------------------------------------
-- Se permite la llamada sin JWT de usuario (cron/postgres/service_role); anon y authenticated deben ser SRL.
CREATE OR REPLACE FUNCTION public.activar_protocolo_hidrico(
    p_tipo text,
    p_notas text DEFAULT ''::text,
    p_autorizado_por uuid DEFAULT NULL::uuid,
    p_gasto_solicitado_m3s numeric DEFAULT NULL::numeric,
    p_porcentaje_apertura numeric DEFAULT NULL::numeric,
    p_valvulas_activas text[] DEFAULT NULL::text[],
    p_hora_apertura_real text DEFAULT NULL::text
)
 RETURNS sica_eventos_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_evento public.sica_eventos_log;
    v_autor  uuid := COALESCE(auth.uid(), p_autorizado_por);
BEGIN
    IF COALESCE(auth.role(), '') IN ('anon', 'authenticated')
       AND COALESCE(public.auth_rol(), '') <> 'SRL' THEN
        RAISE EXCEPTION 'FORBIDDEN: solo la S.R.L. puede dictar protocolos oficiales' USING ERRCODE = '42501';
    END IF;

    -- Capacidad de diseño del canal principal: 60 m3/s (hydric_knowledge_base).
    IF p_gasto_solicitado_m3s IS NOT NULL AND (p_gasto_solicitado_m3s < 0 OR p_gasto_solicitado_m3s > 60) THEN
        RAISE EXCEPTION 'GASTO_FUERA_DE_RANGO: el gasto solicitado debe estar entre 0 y 60 m3/s' USING ERRCODE = '22003';
    END IF;
    IF p_porcentaje_apertura IS NOT NULL AND (p_porcentaje_apertura < 0 OR p_porcentaje_apertura > 100) THEN
        RAISE EXCEPTION 'APERTURA_FUERA_DE_RANGO: el porcentaje de apertura debe estar entre 0 y 100' USING ERRCODE = '22003';
    END IF;

    UPDATE public.sica_eventos_log
    SET    esta_activo = false,
           fecha_fin   = COALESCE(fecha_fin, now())
    WHERE  esta_activo = true;

    INSERT INTO public.sica_eventos_log (
        evento_tipo, notas, esta_activo, autorizado_por,
        gasto_solicitado_m3s, porcentaje_apertura_presa,
        valvulas_activas, hora_apertura_real
    ) VALUES (
        p_tipo, COALESCE(p_notas, ''), true, v_autor,
        p_gasto_solicitado_m3s, p_porcentaje_apertura,
        p_valvulas_activas, NULLIF(p_hora_apertura_real, '')::timestamptz
    )
    RETURNING * INTO v_evento;

    RETURN v_evento;

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'PROTOCOL_CONFLICT: Otro protocolo fue activado simultáneamente. '
            'Recargue y verifique el estado actual antes de reintentar.';
    WHEN undefined_column THEN
        INSERT INTO public.sica_eventos_log (
            evento_tipo, notas, esta_activo, autorizado_por
        ) VALUES (
            p_tipo, COALESCE(p_notas, ''), true, v_autor
        )
        RETURNING * INTO v_evento;
        RETURN v_evento;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.activar_protocolo_hidrico(text, text, uuid, numeric, numeric, text[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.activar_protocolo_hidrico(text, text, uuid, numeric, numeric, text[], text) TO authenticated, service_role;

-- 3) RAG: la búsqueda vectorial es global; solo la edge function (service_role) la usa -----------------------------
REVOKE EXECUTE ON FUNCTION public.match_hydric_documents(vector, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.match_hydric_documents(vector, double precision, integer) TO service_role;

-- 4) Chat: cada quien solo toca lo suyo --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Usuarios eliminan sus mensajes" ON public.chat_messages;
CREATE POLICY "Usuarios eliminan sus mensajes" ON public.chat_messages
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id = chat_messages.conversation_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS "Usuarios eliminan sus conversaciones" ON public.chat_conversations;
CREATE POLICY "Usuarios eliminan sus conversaciones" ON public.chat_conversations
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuarios actualizan sus conversaciones" ON public.chat_conversations;
CREATE POLICY "Usuarios actualizan sus conversaciones" ON public.chat_conversations
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 5) Base de conocimiento: alta y baja de documentos solo S.R.L. (o su dueño para borrar) ----------------------------
DROP POLICY IF EXISTS "Usuarios insertan sus documentos" ON public.hydric_documents;
CREATE POLICY "SRL inserta documentos" ON public.hydric_documents
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = created_by AND (SELECT public.auth_rol()) = 'SRL');

DROP POLICY IF EXISTS "SRL o dueño elimina documentos" ON public.hydric_documents;
CREATE POLICY "SRL o dueño elimina documentos" ON public.hydric_documents
    FOR DELETE TO authenticated
    USING (auth.uid() = created_by OR (SELECT public.auth_rol()) = 'SRL');

-- 6) Storage: solo PDF (único formato que process-hydric-doc sabe extraer), hasta 30 MB, subida solo SRL ---------
UPDATE storage.buckets
SET    file_size_limit = 31457280,
       allowed_mime_types = ARRAY['application/pdf']
WHERE  id = 'hydric-knowledge';

DROP POLICY IF EXISTS "Activo_subir" ON storage.objects;
CREATE POLICY "Activo_subir" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'hydric-knowledge' AND (SELECT public.auth_rol()) = 'SRL');
