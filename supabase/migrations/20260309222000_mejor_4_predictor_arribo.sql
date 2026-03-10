-- Mejora 4: Predictor de Arribo de Gasto (IA Hidráulica)
-- Calcula el tiempo de tránsito acumulado desde la Presa (KM 0) hasta cualquier punto del canal.

-- 1. Función para calcular segundos de tránsito hasta un KM específico
CREATE OR REPLACE FUNCTION public.get_transit_time_seconds(p_km_target NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
    v_total_seconds NUMERIC := 0;
    v_tramo RECORD;
    v_dist_tramo NUMERIC;
BEGIN
    FOR v_tramo IN 
        SELECT km_inicio, km_fin, velocidad_diseno_ms 
        FROM public.perfil_hidraulico_canal 
        WHERE km_inicio < p_km_target
        ORDER BY km_inicio ASC
    LOOP
        -- Calcular cuántos KM de este tramo están dentro del rango (0 a km_target)
        v_dist_tramo := (LEAST(v_tramo.km_fin, p_km_target) - v_tramo.km_inicio) * 1000; -- metros
        
        IF v_tramo.velocidad_diseno_ms > 0 THEN
            v_total_seconds := v_total_seconds + (v_dist_tramo / v_tramo.velocidad_diseno_ms);
        END IF;
    END LOOP;
    
    RETURN v_total_seconds;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Vista de Predicción de Arribo para Puntos de Entrega (Módulos)
CREATE OR REPLACE VIEW public.vw_prediccion_arribo_tomas AS
WITH evento_actual AS (
    SELECT fecha_inicio as hora_presa
    FROM public.sica_eventos_log
    WHERE esta_activo = true AND evento_tipo IN ('LLENADO', 'VACIADO')
    ORDER BY fecha_inicio DESC
    LIMIT 1
)
SELECT 
    dp.id as punto_id,
    dp.nombre,
    dp.km,
    m.codigo_corto as modulo_code,
    e.hora_presa,
    public.get_transit_time_seconds(dp.km) as transit_seconds,
    (e.hora_presa + (public.get_transit_time_seconds(dp.km) || ' seconds')::interval) as hora_arribo_estimada,
    -- Calcular cuánto tiempo falta desde AHORA
    ((e.hora_presa + (public.get_transit_time_seconds(dp.km) || ' seconds')::interval) - now()) as tiempo_restante
FROM public.puntos_entrega dp
JOIN public.modulos m ON dp.modulo_id = m.id
CROSS JOIN evento_actual e
WHERE dp.km IS NOT NULL;

-- 3. Vista de Predicción para Escalas (Control)
CREATE OR REPLACE VIEW public.vw_prediccion_arribo_escalas AS
WITH evento_actual AS (
    SELECT fecha_inicio as hora_presa
    FROM public.sica_eventos_log
    WHERE esta_activo = true AND evento_tipo IN ('LLENADO', 'VACIADO')
    ORDER BY fecha_inicio DESC
    LIMIT 1
)
SELECT 
    esc.id,
    esc.nombre,
    esc.km,
    e.hora_presa,
    public.get_transit_time_seconds(esc.km) as transit_seconds,
    (e.hora_presa + (public.get_transit_time_seconds(esc.km) || ' seconds')::interval) as hora_arribo_estimada,
    ((e.hora_presa + (public.get_transit_time_seconds(esc.km) || ' seconds')::interval) - now()) as tiempo_restante
FROM public.escalas esc
CROSS JOIN evento_actual e;

COMMENT ON VIEW public.vw_prediccion_arribo_tomas IS 'Predicción de llegada de agua por punto de entrega basada en modelo hidráulico de velocidades de diseño.';
