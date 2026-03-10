-- Mejora 2: Micro-Balances Hídricos por Tramo de Canal
-- Este script crea una vista para el Dashboard que detecta fugas en tiempo real por segmento.

-- 1. Vista de Segmentos del Canal (Basada en Escalas)
CREATE OR REPLACE VIEW public.vw_segmentos_canal AS
WITH escalas_cte AS (
    SELECT 
        id, 
        nombre, 
        km,
        LEAD(id) OVER (ORDER BY km ASC) as next_id,
        LEAD(nombre) OVER (ORDER BY km ASC) as next_nombre,
        LEAD(km) OVER (ORDER BY km ASC) as next_km
    FROM public.escalas
)
SELECT * FROM escalas_cte WHERE next_km IS NOT NULL;

-- 2. Función para obtener el Gasto (Q) actual de una Escala
CREATE OR REPLACE FUNCTION public.get_q_actual_escala(p_escala_id TEXT)
RETURNS NUMERIC AS $$
DECLARE
    v_q NUMERIC;
BEGIN
    SELECT COALESCE(gasto_calculado_m3s, 0) INTO v_q
    FROM public.lecturas_escalas
    WHERE escala_id = p_escala_id
    ORDER BY fecha DESC, hora_lectura DESC
    LIMIT 1;
    
    RETURN COALESCE(v_q, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Vista de Balance por Tramo (TIEMPO REAL)
CREATE OR REPLACE VIEW public.vw_balance_tramos_tiempo_real AS
SELECT 
    s.id as escala_inicio_id,
    s.nombre as escala_inicio_nombre,
    s.km as km_inicio,
    s.next_id as escala_fin_id,
    s.next_nombre as escala_fin_nombre,
    s.next_km as km_fin,
    -- Flujo de entrada (Escala inicial)
    public.get_q_actual_escala(s.id) as q_entrada_m3s,
    -- Flujo de salida (Escala final)
    public.get_q_actual_escala(s.next_id) as q_salida_m3s,
    -- Suma de extracciones activas en este tramo
    (
        SELECT COALESCE(SUM(ro.caudal_promedio), 0)
        FROM public.reportes_operacion ro
        JOIN public.puntos_entrega dp ON ro.punto_id = dp.id
        WHERE dp.km >= s.km AND dp.km < s.next_km
          AND ro.fecha = CURRENT_DATE
          AND ro.estado NOT IN ('cierre', 'suspension')
    ) as q_extracciones_m3s,
    -- Cálculo de Pérdida/Ganancia
    (
        public.get_q_actual_escala(s.id) - 
        public.get_q_actual_escala(s.next_id) - 
        (
            SELECT COALESCE(SUM(ro.caudal_promedio), 0)
            FROM public.reportes_operacion ro
            JOIN public.puntos_entrega dp ON ro.punto_id = dp.id
            WHERE dp.km >= s.km AND dp.km < s.next_km
              AND ro.fecha = CURRENT_DATE
              AND ro.estado NOT IN ('cierre', 'suspension')
        )
    ) as q_perdida_m3s
FROM public.vw_segmentos_canal s;

-- 4. Enriquecimiento con % de Eficiencia y Alertas
CREATE OR REPLACE VIEW public.dashboard_vulnerabilidad_fugas AS
SELECT 
    *,
    CASE 
        WHEN q_entrada_m3s > 0 THEN 
            ROUND(((q_salida_m3s + q_extracciones_m3s) / q_entrada_m3s) * 100, 2)
        ELSE 100 
    END as eficiencia_pct,
    CASE
        WHEN q_entrada_m3s > 0 AND ((q_entrada_m3s - q_salida_m3s - q_extracciones_m3s) / q_entrada_m3s) > 0.10 THEN 'CRÍTICA (Fuga/Toma Clandestina)'
        WHEN q_entrada_m3s > 0 AND ((q_entrada_m3s - q_salida_m3s - q_extracciones_m3s) / q_entrada_m3s) > 0.05 THEN 'PREVENTIVA (Pérdida por Infiltración)'
        ELSE 'ESTABLE'
    END as estatus_hidraulico
FROM public.vw_balance_tramos_tiempo_real;

-- Comentarios para documentación automática
COMMENT ON VIEW public.dashboard_vulnerabilidad_fugas IS 'Monitor de balances hídricos por segmento para detección de anomalías y tomas clandestinas.';

