-- Mejora 5: Enriquecimiento de Protocolo de Llenado y Tránsito en Río
-- Incorpora variables de presa, cálculo de río y registro de arribos reales.

-- 1. Ampliar sica_eventos_log con campos técnicos
ALTER TABLE public.sica_eventos_log 
ADD COLUMN IF NOT EXISTS gasto_solicitado_m3s NUMERIC,
ADD COLUMN IF NOT EXISTS porcentaje_apertura_presa NUMERIC,
ADD COLUMN IF NOT EXISTS valvulas_activas TEXT[],
ADD COLUMN IF NOT EXISTS hora_apertura_real TIMESTAMP WITH TIME ZONE;

-- 2. Tabla para seguimiento de arribos por punto de control
CREATE TABLE IF NOT EXISTS public.sica_eventos_arribos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id UUID REFERENCES public.sica_eventos_log(id) ON DELETE CASCADE,
    punto_control_nombre TEXT NOT NULL, -- P.ej. 'KM 0', 'KM 23'
    km NUMERIC,
    hora_estimada TIMESTAMP WITH TIME ZONE,
    hora_real TIMESTAMP WITH TIME ZONE,
    diferencia_minutos NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Función para estimar tiempo de tránsito en el Río Conchos (36 Km)
-- L = 36000 m, H = 49 m -> S = 0.00136
-- Usa una aproximación de velocidad basada en el gasto Q
CREATE OR REPLACE FUNCTION public.get_river_transit_seconds(p_gasto_m3s NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
    v_velocidad NUMERIC;
    v_distancia NUMERIC := 36000; -- 36 Km
BEGIN
    -- Estimación empírica: v \approx 0.5 * Q^0.4 (aproximación para ríos en esta zona)
    -- O bien una constante conservadora basada en la pendiente si Q es bajo.
    IF p_gasto_m3s IS NULL OR p_gasto_m3s <= 0 THEN
        v_velocidad := 0.8; -- Velocidad base mínima
    ELSE
        v_velocidad := 0.5 * POW(p_gasto_m3s, 0.4) + 0.5; -- Incrementa con el gasto
    END IF;
    
    -- Limitar velocidad razonable (0.8 m/s a 3.0 m/s)
    v_velocidad := GREATEST(0.8, LEAST(3.0, v_velocidad));
    
    RETURN v_distancia / v_velocidad;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Actualizar vistas de predicción para incluir el "Offset de Río"
-- Si el evento activo tiene gasto_solicitado, sumamos el tiempo del río.

CREATE OR REPLACE VIEW public.vw_prediccion_arribo_escalas AS
WITH evento_actual AS (
    SELECT 
        id,
        fecha_inicio as hora_inicio_protocolo,
        COALESCE(hora_apertura_real, fecha_inicio) as hora_apertura,
        COALESCE(gasto_solicitado_m3s, 0) as q,
        evento_tipo
    FROM public.sica_eventos_log
    WHERE esta_activo = true AND evento_tipo = 'LLENADO'
    ORDER BY fecha_inicio DESC
    LIMIT 1
),
calculo_base AS (
    SELECT 
        e.id as evento_id,
        e.hora_apertura,
        public.get_river_transit_seconds(e.q) as river_seconds
    FROM evento_actual e
)
SELECT 
    esc.id,
    esc.nombre,
    esc.km,
    cb.hora_apertura as hora_presa,
    cb.river_seconds as segundos_rio,
    public.get_transit_time_seconds(esc.km) as segundos_canal,
    (cb.hora_apertura + (cb.river_seconds || ' seconds')::interval + (public.get_transit_time_seconds(esc.km) || ' seconds')::interval) as hora_arribo_estimada,
    ((cb.hora_apertura + (cb.river_seconds || ' seconds')::interval + (public.get_transit_time_seconds(esc.km) || ' seconds')::interval) - now()) as tiempo_restante
FROM public.escalas esc
CROSS JOIN calculo_base cb;

-- 5. Comentarios
COMMENT ON COLUMN public.sica_eventos_log.gasto_solicitado_m3s IS 'Gasto total de apertura solicitado a la presa (m3/s).';
COMMENT ON COLUMN public.sica_eventos_log.hora_apertura_real IS 'Hora exacta en que se abrieron las válvulas de la presa.';
COMMENT ON FUNCTION public.get_river_transit_seconds IS 'Calcula el tiempo de tránsito desde la Obra de Toma hasta KM 0 del canal (36km de río).';
