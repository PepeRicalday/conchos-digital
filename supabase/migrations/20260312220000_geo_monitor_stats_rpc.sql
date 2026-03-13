-- Migration: Add operational statistics RPC for Geo-Monitor
-- Date: 2026-03-12

CREATE OR REPLACE FUNCTION public.get_today_operation_stats(p_fecha DATE DEFAULT NULL)
RETURNS TABLE (
    tomas_abiertas INTEGER,
    tomas_cerradas INTEGER,
    gasto_distribuido_m3s NUMERIC
) AS $$
DECLARE
    v_fecha DATE := COALESCE(p_fecha, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Chihuahua')::DATE);
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) FILTER (WHERE estado IN ('inicio', 'continua', 'reabierto', 'modificacion'))::INTEGER as tomas_abiertas,
        COUNT(*) FILTER (WHERE estado = 'cierre')::INTEGER as tomas_cerradas,
        COALESCE(SUM(caudal_promedio) FILTER (WHERE estado IN ('inicio', 'continua', 'reabierto', 'modificacion')), 0)::NUMERIC as gasto_distribuido_m3s
    FROM public.reportes_operacion
    WHERE fecha = v_fecha;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.get_today_operation_stats(DATE) TO anon, authenticated;
