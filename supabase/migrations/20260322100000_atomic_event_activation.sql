-- ============================================================
-- Migración: Activación Atómica de Protocolos Hidráulicos
-- Fecha: 2026-03-22
-- Autor: SICA 005 — Corrección P0-2 Auditoría Técnica
--
-- Problema resuelto:
--   Los triggers BEFORE INSERT no previenen condiciones de carrera
--   cuando dos transacciones concurrentes ven el estado ANTES de
--   que la otra haga commit (READ COMMITTED). Resultado: dos
--   protocolos activos simultáneos (ej. LLENADO + VACIADO).
--
-- Solución (3 capas):
--   1. Índice único parcial  → motor rechaza segundo activo
--   2. Función RPC atómica   → una sola transacción desde frontend
--   3. Trigger existente     → tercera capa de defensa en profundidad
-- ============================================================


-- ── CAPA 1: Índice único parcial ────────────────────────────
-- Garantiza a nivel de motor de BD que SOLO UNA fila puede tener
-- esta_activo = true. Si dos transacciones concurrentes intentan
-- insertar/actualizar a true, la segunda falla con constraintError
-- en lugar de crear un segundo evento activo silencioso.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_protocol
    ON public.sica_eventos_log ((esta_activo))
    WHERE esta_activo = true;

COMMENT ON INDEX public.idx_unique_active_protocol IS
    'Restricción de exclusividad: máximo 1 evento puede tener '
    'esta_activo = true en cualquier momento. Red de seguridad '
    'complementaria al trigger tr_ensure_single_active_event.';


-- ── CAPA 2: Función RPC atómica ─────────────────────────────
-- Reemplaza la secuencia de 3 llamadas del frontend:
--   [UPDATE activos=false] → [INSERT nuevo] → [UPDATE tech fields]
-- por una ÚNICA transacción PostgreSQL.
--
-- Al ser una sola transacción:
--   - Todo o nada (sin estados parciales)
--   - PostgreSQL serializa el acceso concurrente
--   - Si dos usuarios activan simultáneamente, uno gana limpiamente;
--     el otro recibe un error capturado por el frontend
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.activar_protocolo_hidrico(
    p_tipo                    text,
    p_notas                   text    DEFAULT '',
    p_autorizado_por          uuid    DEFAULT NULL,
    p_gasto_solicitado_m3s    numeric DEFAULT NULL,
    p_porcentaje_apertura     numeric DEFAULT NULL,
    p_valvulas_activas        text[]  DEFAULT NULL,
    p_hora_apertura_real      text    DEFAULT NULL
)
RETURNS public.sica_eventos_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_evento public.sica_eventos_log;
BEGIN
    -- Paso 1: Desactivar TODOS los eventos activos.
    --         Ocurre dentro de esta transacción — si el commit falla,
    --         esta operación también se revierte automáticamente.
    UPDATE public.sica_eventos_log
    SET    esta_activo = false
    WHERE  esta_activo = true;

    -- Paso 2: Insertar el nuevo evento activo en la misma transacción.
    --         El índice idx_unique_active_protocol rechazará cualquier
    --         segunda inserción concurrente que llegue aquí.
    INSERT INTO public.sica_eventos_log (
        evento_tipo,
        notas,
        esta_activo,
        autorizado_por,
        gasto_solicitado_m3s,
        porcentaje_apertura_presa,
        valvulas_activas,
        hora_apertura_real
    ) VALUES (
        p_tipo,
        COALESCE(p_notas, ''),
        true,
        p_autorizado_por,
        p_gasto_solicitado_m3s,
        p_porcentaje_apertura,
        p_valvulas_activas,
        p_hora_apertura_real
    )
    RETURNING * INTO v_evento;

    RETURN v_evento;

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'PROTOCOL_CONFLICT: Otro protocolo fue activado simultáneamente. '
            'Recargue y verifique el estado actual antes de reintentar.';
    WHEN undefined_column THEN
        -- Columnas técnicas opcionales aún no migradas — insertar solo base
        INSERT INTO public.sica_eventos_log (
            evento_tipo, notas, esta_activo, autorizado_por
        ) VALUES (
            p_tipo, COALESCE(p_notas, ''), true, p_autorizado_por
        )
        RETURNING * INTO v_evento;
        RETURN v_evento;
END;
$$;

-- ── Permisos ─────────────────────────────────────────────────
-- Solo usuarios autenticados pueden activar protocolos.
-- El rol anon (lectura pública) no puede invocar esta función.
REVOKE ALL ON FUNCTION public.activar_protocolo_hidrico(
    text, text, uuid, numeric, numeric, text[], text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.activar_protocolo_hidrico(
    text, text, uuid, numeric, numeric, text[], text
) TO authenticated;

COMMENT ON FUNCTION public.activar_protocolo_hidrico IS
    'Activación atómica de protocolo hidráulico SICA 005. '
    'Garantiza exclusividad Hidro-Sincronía: desactiva eventos previos '
    'e inserta el nuevo en una sola transacción PostgreSQL. '
    'Elimina condición de carrera P0-2 identificada en auditoría 2026-03-22.';


-- ── Verificación de integridad post-migración ────────────────
-- Asegura que no existan eventos duplicados activos previos a la migración.
-- Si hay más de uno, deja activo solo el más reciente.
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.sica_eventos_log
    WHERE esta_activo = true;

    IF v_count > 1 THEN
        RAISE NOTICE 'LIMPIEZA: Se encontraron % eventos activos simultáneos. Desactivando todos excepto el más reciente.', v_count;
        UPDATE public.sica_eventos_log
        SET    esta_activo = false
        WHERE  esta_activo = true
          AND  id NOT IN (
              SELECT id FROM public.sica_eventos_log
              WHERE  esta_activo = true
              ORDER  BY fecha_inicio DESC
              LIMIT  1
          );
    END IF;
END;
$$;
