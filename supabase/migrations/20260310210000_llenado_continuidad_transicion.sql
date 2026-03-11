-- ===================================================================
-- Migración: Continuidad Diaria de Llenado + Transición a Estabilización
-- Fecha: 2026-03-10 21:00
-- Coherente con fn_generar_continuidad_diaria (Midnight Rollover)
-- ===================================================================

-- 1. Tabla de Snapshots Diarios del Llenado
-- Cada medianoche se congela el estado de todos los puntos de control.
-- Esto alimenta reportes y da coherencia con los reportes de escalas/tomas.
CREATE TABLE IF NOT EXISTS public.sica_llenado_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_id UUID NOT NULL REFERENCES public.sica_eventos_log(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    dia_llenado INT NOT NULL DEFAULT 1,  -- Día 1, Día 2, Día 3...
    punto_nombre TEXT NOT NULL,
    km NUMERIC NOT NULL,
    estado TEXT DEFAULT 'PENDIENTE',
    hora_estimada TIMESTAMPTZ,
    hora_real TIMESTAMPTZ,
    nivel_m NUMERIC,
    gasto_m3s NUMERIC,
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(evento_id, fecha, km)
);

COMMENT ON TABLE public.sica_llenado_snapshots IS 
'Snapshot diario del estado de cada punto de control durante el evento de llenado. 
Se genera automáticamente a medianoche para dar continuidad a los reportes.';

-- 2. Tabla de Transiciones de Protocolo
-- Registra cada cambio de protocolo con metadata de quién, cuándo y por qué.
CREATE TABLE IF NOT EXISTS public.sica_transiciones_protocolo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evento_origen_id UUID REFERENCES public.sica_eventos_log(id),
    evento_destino_id UUID REFERENCES public.sica_eventos_log(id),
    tipo_origen TEXT NOT NULL,    -- 'LLENADO'
    tipo_destino TEXT NOT NULL,   -- 'ESTABILIZACION'
    fecha_transicion TIMESTAMPTZ DEFAULT NOW(),
    autorizado_por UUID REFERENCES auth.users(id),
    motivo TEXT,
    -- Condiciones cumplidas al momento de la transición
    puntos_confirmados INT DEFAULT 0,
    puntos_totales INT DEFAULT 0,
    gasto_promedio_m3s NUMERIC,
    nivel_promedio_m NUMERIC,
    criterios_cumplidos JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.sica_transiciones_protocolo IS 
'Historial de transiciones entre protocolos. Registra condiciones y autorización.';

-- 3. RLS para ambas tablas
ALTER TABLE public.sica_llenado_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sica_transiciones_protocolo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sica_llenado_snapshots_select" ON public.sica_llenado_snapshots
    FOR SELECT USING (true);
CREATE POLICY "sica_llenado_snapshots_all" ON public.sica_llenado_snapshots
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "sica_transiciones_select" ON public.sica_transiciones_protocolo
    FOR SELECT USING (true);
CREATE POLICY "sica_transiciones_all" ON public.sica_transiciones_protocolo
    FOR ALL USING (auth.role() = 'authenticated');

-- 4. Actualizar fn_generar_continuidad_diaria para incluir LLENADO
-- Agregar Bloque C: Continuidad de Llenado
CREATE OR REPLACE FUNCTION public.fn_generar_continuidad_diaria()
RETURNS void AS $$
DECLARE
    r RECORD;
    fecha_ayer DATE := (timezone('America/Chihuahua'::text, now()) - INTERVAL '1 day')::date;
    fecha_hoy DATE := timezone('America/Chihuahua'::text, now())::date;
    midnight_at TIMESTAMP WITH TIME ZONE := date_trunc('day', timezone('America/Chihuahua'::text, now()));
    v_dia_llenado INT;
BEGIN
    -- A. CONTINUIDAD DE TOMAS (reportes_operacion)
    FOR r IN 
        SELECT punto_id, caudal_promedio, volumen_acumulado, ciclo_id
        FROM public.reportes_operacion
        WHERE fecha = fecha_ayer 
          AND estado::text NOT IN ('cierre', 'suspension') 
          AND caudal_promedio > 0
    LOOP
        UPDATE public.reportes_operacion
        SET estado = 'cierre',
            hora_cierre = midnight_at,
            actualizado_en = timezone('utc'::text, now())
        WHERE punto_id = r.punto_id AND fecha = fecha_ayer;

        INSERT INTO public.reportes_operacion (
            punto_id, fecha, estado, caudal_promedio, num_mediciones, hora_apertura, volumen_acumulado, ciclo_id
        ) VALUES (
            r.punto_id, fecha_hoy, 'continua', r.caudal_promedio, 1, midnight_at, 0, r.ciclo_id
        ) ON CONFLICT (punto_id, fecha) DO NOTHING;

        INSERT INTO public.mediciones (
            punto_id, valor_q, fecha_hora, notas
        ) VALUES (
            r.punto_id, r.caudal_promedio, midnight_at,
            'Evento automático: Continuidad de medianoche (Rollover)'
        );
    END LOOP;

    -- B. CONTINUIDAD DE ESCALAS (lecturas_escalas)
    FOR r IN 
        SELECT DISTINCT ON (escala_id) escala_id, nivel_m, ciclo_id
        FROM public.lecturas_escalas
        WHERE fecha = fecha_ayer
        ORDER BY escala_id, fecha DESC, hora_lectura DESC
    LOOP
        INSERT INTO public.lecturas_escalas (
            id, escala_id, fecha, turno, nivel_m, hora_lectura, responsable, notas, ciclo_id
        ) VALUES (
            gen_random_uuid(), r.escala_id, fecha_hoy, 'am', r.nivel_m, '00:00:00',
            'SICA Chronos',
            'Autogenerado (Continuidad de Medianoche - Última lectura del ' || fecha_ayer || ')',
            r.ciclo_id
        ) ON CONFLICT (escala_id, fecha, turno) DO NOTHING;
    END LOOP;

    -- C. CONTINUIDAD DE LLENADO (sica_llenado_seguimiento)
    -- Si hay un evento LLENADO activo, genera snapshot diario de cada punto
    FOR r IN 
        SELECT ls.evento_id, ls.punto_nombre, ls.km, ls.estado,
               ls.hora_estimada_actual, ls.hora_real, ls.nivel_arribo_m, ls.gasto_paso_m3s,
               el.fecha_inicio
        FROM public.sica_llenado_seguimiento ls
        JOIN public.sica_eventos_log el ON ls.evento_id = el.id
        WHERE el.esta_activo = true AND el.evento_tipo = 'LLENADO'
    LOOP
        -- Calcular día de llenado (Día 1, Día 2, etc.)
        v_dia_llenado := GREATEST(1, (fecha_hoy - r.fecha_inicio::date) + 1);

        INSERT INTO public.sica_llenado_snapshots (
            evento_id, fecha, dia_llenado, punto_nombre, km, estado,
            hora_estimada, hora_real, nivel_m, gasto_m3s
        ) VALUES (
            r.evento_id, fecha_hoy, v_dia_llenado, r.punto_nombre, r.km, r.estado,
            r.hora_estimada_actual, r.hora_real, r.nivel_arribo_m, r.gasto_paso_m3s
        ) ON CONFLICT (evento_id, fecha, km) DO UPDATE SET
            estado = EXCLUDED.estado,
            hora_real = EXCLUDED.hora_real,
            nivel_m = EXCLUDED.nivel_m,
            gasto_m3s = EXCLUDED.gasto_m3s,
            dia_llenado = EXCLUDED.dia_llenado;
    END LOOP;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Vista para evaluar condiciones de transición LLENADO → ESTABILIZACIÓN
CREATE OR REPLACE VIEW public.vw_condiciones_transicion AS
SELECT 
    el.id AS evento_id,
    el.evento_tipo,
    el.gasto_solicitado_m3s,
    COUNT(ls.id) AS puntos_totales,
    COUNT(ls.id) FILTER (WHERE ls.estado IN ('CONFIRMADO', 'ESTABILIZADO')) AS puntos_confirmados,
    COUNT(ls.id) FILTER (WHERE ls.estado = 'ESTABILIZADO') AS puntos_estabilizados,
    ROUND(AVG(ls.nivel_arribo_m) FILTER (WHERE ls.nivel_arribo_m IS NOT NULL), 3) AS nivel_promedio_m,
    ROUND(AVG(ls.gasto_paso_m3s) FILTER (WHERE ls.gasto_paso_m3s IS NOT NULL), 3) AS gasto_promedio_m3s,
    -- Criterios booleanos
    (COUNT(ls.id) FILTER (WHERE ls.estado IN ('CONFIRMADO', 'ESTABILIZADO')) = COUNT(ls.id)) AS todos_confirmados,
    CASE 
        WHEN el.gasto_solicitado_m3s > 0 THEN
            ABS(COALESCE(AVG(ls.gasto_paso_m3s) FILTER (WHERE ls.gasto_paso_m3s IS NOT NULL), 0) - el.gasto_solicitado_m3s) 
            / el.gasto_solicitado_m3s < 0.10
        ELSE false
    END AS gasto_dentro_tolerancia,
    -- Día operacional del llenado
    GREATEST(1, CURRENT_DATE - el.fecha_inicio::date + 1) AS dia_llenado
FROM public.sica_eventos_log el
LEFT JOIN public.sica_llenado_seguimiento ls ON ls.evento_id = el.id
WHERE el.esta_activo = true AND el.evento_tipo = 'LLENADO'
GROUP BY el.id, el.evento_tipo, el.gasto_solicitado_m3s, el.fecha_inicio;

GRANT SELECT ON public.vw_condiciones_transicion TO anon, authenticated;
GRANT SELECT ON public.sica_llenado_snapshots TO anon, authenticated;
GRANT SELECT ON public.sica_transiciones_protocolo TO anon, authenticated;

COMMENT ON VIEW public.vw_condiciones_transicion IS 
'Evalúa en tiempo real si se cumplen las condiciones para transicionar de LLENADO a ESTABILIZACIÓN.';
