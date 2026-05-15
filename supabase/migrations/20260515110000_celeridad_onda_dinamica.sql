-- ═══════════════════════════════════════════════════════════════════════
-- FASE 2 — Celeridad Dinámica de Onda + Auto-calibración en Llenado
--
-- Reemplaza velocidad_diseno_ms (escalar fijo) por Modelo A calibrado
-- empíricamente el 23/04/2026:
--   v_onda = 5.3 × Q^0.15  km/h  (error campo: ±12% en K-23, K-104)
--
-- Cadena:
--   fn_celeridad_onda_ms(Q)
--     ↓
--   fn_tiempo_transito_dinamico(km_ini, km_fin, Q)  →  segundos
--     ↓
--   vw_prediccion_arribo_escalas / vw_prediccion_arribo_tomas  (actualizadas)
--     ↓
--   trg_autocalibracion_onda  →  v_observada_ms en sica_llenado_seguimiento
--                             →  recalcula ETAs aguas abajo en tiempo real
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. MODELO A — celeridad de onda empírica ─────────────────────────
-- Fuente: ModelingDashboard + calibración campo 23/04/2026
-- Anchors: K-23 → 180 min obs / 158 min Modelo A (-12%)
--          K-104 → 820 min obs / 714 min Modelo A (-13%)
-- Dominio físico acotado: [0.50, 3.50] m/s (Q entre 5 y 60 m³/s)

CREATE OR REPLACE FUNCTION public.fn_celeridad_onda_ms(p_q_m3s NUMERIC)
RETURNS NUMERIC
LANGUAGE sql IMMUTABLE STRICT
SET search_path = public
AS $$
    SELECT GREATEST(0.50, LEAST(3.50,
        (5.3 * POWER(GREATEST(p_q_m3s, 0.5), 0.15)) / 3.6
    ));
$$;

COMMENT ON FUNCTION public.fn_celeridad_onda_ms(NUMERIC) IS
    'Celeridad de onda de avenida en m/s. Modelo A calibrado campo 23/04/2026. '
    'v = 5.3 × Q^0.15 km/h (±12% error histórico K-23 y K-104). '
    'Dominio: [0.50, 3.50] m/s para Q en [5, 60] m³/s.';


-- ── 2. TIEMPO DE TRÁNSITO DINÁMICO ───────────────────────────────────
-- Recorre segmentos del perfil y aplica fn_celeridad_onda_ms por tramo.
-- Retorna segundos. Con Modelo A la velocidad es constante por Q;
-- la estructura de tramos permite extensión futura (Manning por tramo, Fase 3).

CREATE OR REPLACE FUNCTION public.fn_tiempo_transito_dinamico(
    p_km_inicio NUMERIC,
    p_km_fin    NUMERIC,
    p_q_m3s     NUMERIC DEFAULT 20.0
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_s NUMERIC := 0;
    v_tramo   RECORD;
    v_dist_m  NUMERIC;
    v_vel_ms  NUMERIC;
BEGIN
    IF p_km_fin <= p_km_inicio OR p_q_m3s <= 0 THEN RETURN 0; END IF;

    v_vel_ms := public.fn_celeridad_onda_ms(p_q_m3s);

    FOR v_tramo IN
        SELECT km_inicio, km_fin
        FROM   public.perfil_hidraulico_canal
        WHERE  km_inicio <  p_km_fin
          AND  km_fin    >  p_km_inicio
          AND  km_inicio <  km_fin
        ORDER  BY km_inicio
    LOOP
        v_dist_m := (LEAST(v_tramo.km_fin, p_km_fin) - GREATEST(v_tramo.km_inicio, p_km_inicio)) * 1000.0;
        IF v_dist_m > 0 THEN
            v_total_s := v_total_s + v_dist_m / v_vel_ms;
        END IF;
    END LOOP;

    RETURN ROUND(v_total_s);
END;
$$;

COMMENT ON FUNCTION public.fn_tiempo_transito_dinamico(NUMERIC,NUMERIC,NUMERIC) IS
    'Segundos de tránsito entre km_inicio y km_fin para un gasto Q dado. '
    'Usa fn_celeridad_onda_ms(Q) — Modelo A. '
    'Estructura por tramos del perfil hidráulico para extensión futura.';


-- ── 3. HELPER — Q actual en K-0 (fuente de la predicción dinámica) ───

CREATE OR REPLACE FUNCTION public.fn_q_actual_k0()
RETURNS NUMERIC
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT le.gasto_calculado_m3s
         FROM   public.lecturas_escalas le
         JOIN   public.escalas e ON e.id = le.escala_id
         WHERE  e.km = 0
           AND  le.gasto_calculado_m3s > 0
         ORDER  BY le.fecha DESC, le.hora_lectura DESC
         LIMIT  1),
        20.0   -- fallback operativo si no hay lectura disponible
    );
$$;


-- ── 4. VISTAS DE PREDICCIÓN — actualizadas con celeridad dinámica ────
-- DROP previo obligatorio: CREATE OR REPLACE VIEW no permite renombrar columnas
-- (error 42P16 si la vista ya existe con nombres de columna distintos)

DROP VIEW IF EXISTS public.vw_prediccion_arribo_tomas   CASCADE;
DROP VIEW IF EXISTS public.vw_prediccion_arribo_escalas CASCADE;

CREATE VIEW public.vw_prediccion_arribo_escalas AS
WITH evento_actual AS (
    SELECT fecha_inicio AS hora_presa
    FROM   public.sica_eventos_log
    WHERE  esta_activo  = TRUE
      AND  evento_tipo IN ('LLENADO', 'VACIADO')
    ORDER  BY fecha_inicio DESC
    LIMIT  1
),
q_k0 AS (SELECT public.fn_q_actual_k0() AS q_m3s)
SELECT
    esc.id,
    esc.nombre,
    esc.km,
    e.hora_presa,
    q.q_m3s                                                          AS q_entrada_m3s,
    ROUND(public.fn_celeridad_onda_ms(q.q_m3s) * 3.6, 2)           AS v_onda_kmh,
    ROUND(public.fn_celeridad_onda_ms(q.q_m3s), 4)                  AS v_onda_ms,
    ROUND(public.fn_tiempo_transito_dinamico(0, esc.km, q.q_m3s))   AS transit_seconds,
    (e.hora_presa
        + (public.fn_tiempo_transito_dinamico(0, esc.km, q.q_m3s)::TEXT || ' seconds')::INTERVAL
    )                                                                 AS hora_arribo_estimada,
    ((e.hora_presa
        + (public.fn_tiempo_transito_dinamico(0, esc.km, q.q_m3s)::TEXT || ' seconds')::INTERVAL
    ) - NOW())                                                        AS tiempo_restante
FROM public.escalas esc
CROSS JOIN evento_actual e
CROSS JOIN q_k0 q;


CREATE OR REPLACE VIEW public.vw_prediccion_arribo_tomas AS
WITH evento_actual AS (
    SELECT fecha_inicio AS hora_presa
    FROM   public.sica_eventos_log
    WHERE  esta_activo  = TRUE
      AND  evento_tipo IN ('LLENADO', 'VACIADO')
    ORDER  BY fecha_inicio DESC
    LIMIT  1
),
q_k0 AS (SELECT public.fn_q_actual_k0() AS q_m3s)
SELECT
    dp.id                                                             AS punto_id,
    dp.nombre,
    dp.km,
    m.codigo_corto                                                    AS modulo_code,
    e.hora_presa,
    q.q_m3s                                                          AS q_entrada_m3s,
    ROUND(public.fn_celeridad_onda_ms(q.q_m3s) * 3.6, 2)           AS v_onda_kmh,
    ROUND(public.fn_tiempo_transito_dinamico(0, dp.km, q.q_m3s))    AS transit_seconds,
    (e.hora_presa
        + (public.fn_tiempo_transito_dinamico(0, dp.km, q.q_m3s)::TEXT || ' seconds')::INTERVAL
    )                                                                 AS hora_arribo_estimada,
    ((e.hora_presa
        + (public.fn_tiempo_transito_dinamico(0, dp.km, q.q_m3s)::TEXT || ' seconds')::INTERVAL
    ) - NOW())                                                        AS tiempo_restante
FROM   public.puntos_entrega dp
JOIN   public.modulos m ON dp.modulo_id = m.id
CROSS  JOIN evento_actual e
CROSS  JOIN q_k0 q
WHERE  dp.km IS NOT NULL;


-- ── 5. AUTO-CALIBRACIÓN: columna + trigger ────────────────────────────
-- Cuando el operador confirma hora_real en una escala:
--   a) Calcula v_observada entre ese punto y el confirmado anterior
--   b) Si Δt ≥ 5 min (calidad de timestamp), guarda v_observada_ms
--   c) Recalcula ETAs de todos los puntos pendientes aguas abajo

ALTER TABLE public.sica_llenado_seguimiento
    ADD COLUMN IF NOT EXISTS v_observada_ms NUMERIC;

COMMENT ON COLUMN public.sica_llenado_seguimiento.v_observada_ms IS
    'Velocidad de onda observada en campo (m/s), calculada como Δkm/Δt '
    'entre este punto y el inmediatamente anterior confirmado. '
    'Requiere Δt ≥ 5 min entre puntos para garantizar calidad de timestamp. '
    'NULL si es el primer punto confirmado o el intervalo es insuficiente.';


CREATE OR REPLACE FUNCTION public.trg_fn_autocalibracion_onda()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_prev    RECORD;
    v_dt_s    NUMERIC;
    v_dist_m  NUMERIC;
    v_vel_ms  NUMERIC;
BEGIN
    -- Solo cuando hora_real se asigna por primera vez
    IF NEW.hora_real IS NULL OR OLD.hora_real IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Punto confirmado inmediatamente anterior en el mismo evento
    SELECT km, hora_real, punto_nombre
    INTO   v_prev
    FROM   public.sica_llenado_seguimiento
    WHERE  evento_id = NEW.evento_id
      AND  km        < NEW.km
      AND  hora_real IS NOT NULL
    ORDER  BY km DESC
    LIMIT  1;

    IF NOT FOUND THEN RETURN NEW; END IF;  -- primer punto del evento

    -- Calidad de timestamp: mínimo 5 minutos entre confirmaciones
    v_dt_s := EXTRACT(EPOCH FROM (NEW.hora_real - v_prev.hora_real));
    IF v_dt_s < 300 THEN RETURN NEW; END IF;

    -- Velocidad observada, acotada al dominio físico del canal
    v_dist_m  := (NEW.km - v_prev.km) * 1000.0;
    v_vel_ms  := GREATEST(0.30, LEAST(3.50, v_dist_m / v_dt_s));
    NEW.v_observada_ms := ROUND(v_vel_ms::NUMERIC, 4);

    -- Recalcular ETAs de todos los puntos pendientes aguas abajo
    UPDATE public.sica_llenado_seguimiento
    SET
        hora_estimada_actual = NEW.hora_real
            + (((km - NEW.km) * 1000.0 / v_vel_ms)::TEXT || ' seconds')::INTERVAL,
        recalculado_desde    = NEW.punto_nombre
    WHERE evento_id = NEW.evento_id
      AND km        > NEW.km
      AND estado   IN ('PENDIENTE', 'EN_TRANSITO');

    RETURN NEW;
END;
$$;

-- DROP IF EXISTS para re-ejecución segura
DROP TRIGGER IF EXISTS trg_autocalibracion_onda ON public.sica_llenado_seguimiento;

CREATE TRIGGER trg_autocalibracion_onda
    BEFORE UPDATE OF hora_real ON public.sica_llenado_seguimiento
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fn_autocalibracion_onda();

COMMENT ON TRIGGER trg_autocalibracion_onda ON public.sica_llenado_seguimiento IS
    'Al confirmar hora_real: calcula v_observada desde el punto anterior confirmado '
    'y recalcula ETAs (hora_estimada_actual) de todos los puntos pendientes aguas abajo.';


-- ── 6. PERMISOS ───────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.fn_celeridad_onda_ms(NUMERIC)                 TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fn_tiempo_transito_dinamico(NUMERIC,NUMERIC,NUMERIC) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fn_q_actual_k0()                              TO authenticated, anon;
GRANT SELECT  ON public.vw_prediccion_arribo_escalas                           TO authenticated, anon;
GRANT SELECT  ON public.vw_prediccion_arribo_tomas                             TO authenticated, anon;


-- ── Validación (ejecutar después del deploy) ──────────────────────────
-- SELECT nombre, km, ROUND(v_onda_kmh,2) AS v_kmh, transit_seconds,
--        TO_CHAR(hora_arribo_estimada AT TIME ZONE 'America/Chihuahua', 'HH24:MI') AS eta_local
-- FROM vw_prediccion_arribo_escalas ORDER BY km;
--
-- Para Q=28 m³/s:  v_onda ≈ 8.74 km/h → K-23 en ~158 min · K-104 en ~714 min
