-- Fix: activar_protocolo_hidrico fallaba SIEMPRE con
--   column "hora_apertura_real" is of type timestamp with time zone but expression is of type text
-- porque p_hora_apertura_real (text) se insertaba sin cast. Además cierra
-- (fecha_fin) el evento anterior al desactivarlo. Firma sin cambios.
-- Aplicado en producción vía SQL (no db push: hay drift de migraciones).

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
BEGIN
    UPDATE public.sica_eventos_log
    SET    esta_activo = false,
           fecha_fin   = COALESCE(fecha_fin, now())
    WHERE  esta_activo = true;

    INSERT INTO public.sica_eventos_log (
        evento_tipo, notas, esta_activo, autorizado_por,
        gasto_solicitado_m3s, porcentaje_apertura_presa,
        valvulas_activas, hora_apertura_real
    ) VALUES (
        p_tipo, COALESCE(p_notas, ''), true, p_autorizado_por,
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
            p_tipo, COALESCE(p_notas, ''), true, p_autorizado_por
        )
        RETURNING * INTO v_evento;
        RETURN v_evento;
END;
$function$;
