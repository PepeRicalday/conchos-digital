-- ============================================================
-- Migración: Sistema de Seguimiento de Tránsito de Llenado
-- Fecha: 2026-03-10 20:06
-- Coherente con leyes hidráulicas: no cronometrar sin apertura,
-- recálculo en cascada con datos reales.
-- ============================================================

-- 1. Tabla principal de seguimiento por punto de control
CREATE TABLE IF NOT EXISTS public.sica_llenado_seguimiento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id UUID NOT NULL REFERENCES public.sica_eventos_log(id) ON DELETE CASCADE,
    ciclo_id UUID REFERENCES public.ciclos_agricolas(id),
    
    -- Punto de control (ligado a escalas reales)
    escala_id TEXT REFERENCES public.escalas(id),
    punto_nombre TEXT NOT NULL,          -- 'KM 0+000', 'K-23', 'K-29', etc.
    km NUMERIC NOT NULL,
    orden_secuencial INT NOT NULL,       -- 0, 1, 2, 3... para ordenar en cascada
    
    -- Estimación del modelo teórico (calculada al confirmar apertura)
    hora_estimada_original TIMESTAMPTZ,  -- ETA del modelo puro (nunca cambia)
    segundos_modelo NUMERIC,             -- Segundos teóricos desde apertura
    
    -- Estimación recalculada (cascada desde último dato real)
    hora_estimada_actual TIMESTAMPTZ,    -- ETA recalculada por cascada
    recalculado_desde TEXT,              -- punto_nombre del ancla que disparó recálculo
    
    -- Captura manual del operador
    hora_real TIMESTAMPTZ,               -- Hora real de arribo confirmada
    
    -- Diferencia calculada automáticamente
    diferencia_minutos NUMERIC GENERATED ALWAYS AS (
        CASE WHEN hora_real IS NOT NULL AND hora_estimada_actual IS NOT NULL
            THEN EXTRACT(EPOCH FROM (hora_real - hora_estimada_actual)) / 60.0
            ELSE NULL
        END
    ) STORED,
    
    -- Nivel del canal en ese punto al momento del arribo
    nivel_arribo_m NUMERIC,
    nivel_objetivo_m NUMERIC,
    esta_estabilizado BOOLEAN DEFAULT false,
    hora_estabilizacion TIMESTAMPTZ,
    
    -- Gasto medido al paso (desde radiales)
    gasto_paso_m3s NUMERIC,
    
    -- Notas del operador
    notas TEXT,
    
    -- Estado del punto
    estado TEXT DEFAULT 'PENDIENTE' CHECK (estado IN (
        'PENDIENTE',       -- Esperando apertura
        'EN_TRANSITO',     -- Cronómetro activo
        'CONFIRMADO',      -- Arribo real registrado
        'ESTABILIZADO'     -- Nivel estable alcanzado
    )),
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_llenado_seg_evento 
    ON public.sica_llenado_seguimiento(evento_id, orden_secuencial);
CREATE INDEX IF NOT EXISTS idx_llenado_seg_ciclo 
    ON public.sica_llenado_seguimiento(ciclo_id, km);
CREATE INDEX IF NOT EXISTS idx_llenado_seg_estado 
    ON public.sica_llenado_seguimiento(evento_id, estado);

-- 3. Tabla de arribos históricos para comparación entre ciclos
CREATE TABLE IF NOT EXISTS public.sica_eventos_arribos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id UUID NOT NULL REFERENCES public.sica_eventos_log(id) ON DELETE CASCADE,
    punto_control_nombre TEXT NOT NULL,
    km NUMERIC NOT NULL,
    hora_estimada TIMESTAMPTZ,
    hora_real TIMESTAMPTZ,
    diferencia_minutos NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Vista de estadísticas históricas para análisis inter-ciclos
CREATE OR REPLACE VIEW public.vw_estadisticas_llenado AS
SELECT 
    ca.nombre as ciclo_nombre,
    ca.clave as ciclo_clave,
    sel.evento_tipo,
    sel.gasto_solicitado_m3s as q_solicitado,
    sel.fecha_inicio as fecha_evento,
    ls.punto_nombre,
    ls.km,
    ls.orden_secuencial,
    ls.hora_estimada_original as eta_modelo,
    ls.hora_estimada_actual as eta_recalculada,
    ls.hora_real,
    ls.diferencia_minutos,
    ls.nivel_arribo_m,
    ls.gasto_paso_m3s,
    ls.esta_estabilizado,
    ls.estado
FROM public.sica_llenado_seguimiento ls
JOIN public.sica_eventos_log sel ON ls.evento_id = sel.id
LEFT JOIN public.ciclos_agricolas ca ON ls.ciclo_id = ca.id
ORDER BY ca.fecha_inicio DESC, ls.orden_secuencial ASC;

-- 5. RLS
ALTER TABLE public.sica_llenado_seguimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sica_eventos_arribos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura pública seguimiento llenado" 
    ON public.sica_llenado_seguimiento FOR SELECT USING (true);
CREATE POLICY "Inserción autenticada seguimiento llenado" 
    ON public.sica_llenado_seguimiento FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Actualización autenticada seguimiento llenado" 
    ON public.sica_llenado_seguimiento FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Lectura pública arribos" 
    ON public.sica_eventos_arribos FOR SELECT USING (true);
CREATE POLICY "Inserción autenticada arribos" 
    ON public.sica_eventos_arribos FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.sica_llenado_seguimiento IS 'Seguimiento punto a punto del tránsito de llenado del canal. Cada fila es un represo/escala con su ETA teórica, recalculada y arribo real.';
COMMENT ON TABLE public.sica_eventos_arribos IS 'Registro histórico de arribos para comparación entre ciclos agrícolas.';
