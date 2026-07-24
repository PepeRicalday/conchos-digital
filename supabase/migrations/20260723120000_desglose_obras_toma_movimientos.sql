-- Desglose de obras de toma en movimientos_presas
-- Objetivo: permitir capturar y propagar el gasto por obra de toma
-- (Toma Baja, CFE, Toma Izq., Toma Der.) en vez de un solo total agregado.
--
-- Contexto: sica-capture solo enviaba gasto_m3s (total). Cuando la presa
-- tenía obras operando en distintos regímenes (ej. CFE generando y Toma
-- Baja con apertura parcial simultánea), el tablero público le atribuía
-- el 100% del total a Toma Baja y mostraba CFE en 0.00/CERRADA aunque
-- estuviera operando. Ver auditoría 2026-07-23.

ALTER TABLE public.movimientos_presas
    ADD COLUMN IF NOT EXISTS gasto_toma_baja_m3s NUMERIC,
    ADD COLUMN IF NOT EXISTS gasto_cfe_m3s NUMERIC,
    ADD COLUMN IF NOT EXISTS gasto_toma_izq_m3s NUMERIC,
    ADD COLUMN IF NOT EXISTS gasto_toma_der_m3s NUMERIC;

-- El trigger de sincronización diaria (sync_daily_dam_registry) solo
-- propagaba extraccion_total_m3s a lecturas_presas. Se extiende para
-- propagar también el desglose por obra de toma cuando el movimiento
-- lo trae, sin pisar el desglose con NULL si el movimiento es legacy
-- (COALESCE conserva el valor existente en lecturas_presas ese día).
CREATE OR REPLACE FUNCTION public.sync_daily_dam_registry()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.lecturas_presas (
        id, presa_id, fecha, extraccion_total_m3s,
        gasto_toma_baja_m3s, gasto_cfe_m3s, gasto_toma_izq_m3s, gasto_toma_der_m3s
    )
    VALUES (
        gen_random_uuid()::text, NEW.presa_id, NEW.fecha_hora::date, NEW.gasto_m3s,
        NEW.gasto_toma_baja_m3s, NEW.gasto_cfe_m3s, NEW.gasto_toma_izq_m3s, NEW.gasto_toma_der_m3s
    )
    ON CONFLICT (presa_id, fecha)
    DO UPDATE SET
        extraccion_total_m3s = EXCLUDED.extraccion_total_m3s,
        gasto_toma_baja_m3s = COALESCE(EXCLUDED.gasto_toma_baja_m3s, public.lecturas_presas.gasto_toma_baja_m3s),
        gasto_cfe_m3s = COALESCE(EXCLUDED.gasto_cfe_m3s, public.lecturas_presas.gasto_cfe_m3s),
        gasto_toma_izq_m3s = COALESCE(EXCLUDED.gasto_toma_izq_m3s, public.lecturas_presas.gasto_toma_izq_m3s),
        gasto_toma_der_m3s = COALESCE(EXCLUDED.gasto_toma_der_m3s, public.lecturas_presas.gasto_toma_der_m3s);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
