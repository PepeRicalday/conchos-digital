-- ============================================================
-- Migración: Sincronización Automática Hydra (Lecturas -> Seguimiento)
-- Fecha: 2026-03-16 10:00
-- Objetivo: "Un dato, una sola verdad". 
-- Cuando el canalero captura un nivel en SICA Capture,
-- el Tracker de Llenado se actualiza automáticamente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_sync_lectura_to_llenado()
RETURNS TRIGGER AS $$
DECLARE
    v_evento_id UUID;
    v_punto_id UUID;
BEGIN
    -- 1. Buscar si hay un evento de LLENADO activo
    SELECT id INTO v_evento_id 
    FROM public.sica_eventos_log 
    WHERE esta_activo = true AND evento_tipo = 'LLENADO'
    LIMIT 1;

    -- Si no hay evento activo, no hacemos nada
    IF v_evento_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- 2. Buscar si esta escala es un punto de control en el seguimiento del llenado actual
    -- Nota: Solo actualizamos si el punto está PENDIENTE o EN_TRANSITO
    SELECT id INTO v_punto_id
    FROM public.sica_llenado_seguimiento
    WHERE evento_id = v_evento_id 
      AND escala_id = NEW.escala_id
      AND estado IN ('PENDIENTE', 'EN_TRANSITO')
    LIMIT 1;

    -- 3. Si existe el punto, actualizar con los datos de la lectura
    IF v_punto_id IS NOT NULL THEN
        UPDATE public.sica_llenado_seguimiento
        SET 
            hora_real = (NEW.fecha || ' ' || NEW.hora_lectura)::timestamp, -- Combinar fecha y hora
            nivel_arribo_m = NEW.nivel_m,
            gasto_paso_m3s = NEW.gasto_calculado_m3s,
            estado = 'CONFIRMADO',
            notas = COALESCE(notas, '') || ' [Auto-Sync SICA Capture]',
            updated_at = NOW()
        WHERE id = v_punto_id;
        
        -- El trigger de cascada en sica_llenado_seguimiento (si existe) 
        -- se encargará de recalcular ETAs de los puntos siguientes.
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para lecturas nuevas
DROP TRIGGER IF EXISTS trg_sync_lectura_to_llenado ON public.lecturas_escalas;
CREATE TRIGGER trg_sync_lectura_to_llenado
AFTER INSERT ON public.lecturas_escalas
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_lectura_to_llenado();

COMMENT ON FUNCTION public.fn_sync_lectura_to_llenado IS 'Sincroniza lecturas de campo con el seguimiento de llenado en tiempo real.';
