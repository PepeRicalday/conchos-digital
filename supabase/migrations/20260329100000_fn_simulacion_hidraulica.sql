-- ============================================================
-- Migración: Funciones de Simulación Hidráulica del Canal
-- Fecha: 2026-03-29
--
-- Propósito:
--   Proveer RPCs server-side para análisis de escenarios:
--   1. fn_q_manning        — Manning directo: dado y → Q (sin iteración)
--   2. fn_tirante_normal   — Manning inverso: dado Q → y (Newton-Raphson)
--   3. fn_simular_escenario_canal — Perfil hidráulico completo K-0 → K-104
--   4. fn_verificar_escala — Compara lectura de escala vs tirante calculado
--
-- Escenarios soportados:
--   A) Base: condición actual (lecturas_presas + reportes_operacion del día)
--   B) Modificado: cerrar/cambiar tomas específicas y ver efecto en todo el canal
--   Salida: Q y tirante por tramo + escalas + tiempo de tránsito + K-104 final
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- FN 1: MANNING DIRECTO — dado y (tirante), calcula Q
-- ════════════════════════════════════════════════════════════
-- Sección trapezoidal: A = (b + z·y)·y, P = b + 2y√(1+z²)
-- Q = (1/n) · A · R^(2/3) · √S0

CREATE OR REPLACE FUNCTION public.fn_q_manning(
    p_y  NUMERIC,   -- Tirante (m)
    p_b  NUMERIC,   -- Plantilla / ancho de base (m)
    p_z  NUMERIC,   -- Talud z:1 (horizontal:vertical)
    p_n  NUMERIC,   -- Manning n
    p_S0 NUMERIC    -- Pendiente longitudinal (m/m)
)
RETURNS NUMERIC AS $$
DECLARE
    v_A  NUMERIC;
    v_P  NUMERIC;
    v_R  NUMERIC;
    v_Q  NUMERIC;
BEGIN
    IF p_y <= 0 OR p_b <= 0 OR p_n <= 0 OR p_S0 <= 0 THEN
        RETURN 0;
    END IF;
    v_A := (p_b + p_z * p_y) * p_y;
    v_P := p_b + 2.0 * p_y * SQRT(1.0 + p_z * p_z);
    v_R := v_A / v_P;
    v_Q := (1.0 / p_n) * v_A * POWER(v_R, 2.0/3.0) * SQRT(p_S0);
    RETURN ROUND(v_Q, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ════════════════════════════════════════════════════════════
-- FN 2: MANNING INVERSO — dado Q, calcula tirante normal y_n
-- ════════════════════════════════════════════════════════════
-- Iteración: y_(n+1) = y_n × (Q_objetivo / Q_calculado)^0.375
-- Converge en ~15 iteraciones con precisión 0.1 mm

CREATE OR REPLACE FUNCTION public.fn_tirante_normal(
    p_Q  NUMERIC,   -- Gasto objetivo (m³/s)
    p_b  NUMERIC,   -- Plantilla (m)
    p_z  NUMERIC,   -- Talud
    p_n  NUMERIC,   -- Manning n
    p_S0 NUMERIC    -- Pendiente (m/m)
)
RETURNS NUMERIC AS $$
DECLARE
    v_y     NUMERIC;
    v_y_new NUMERIC;
    v_Q_calc NUMERIC;
    v_iter   INTEGER := 0;
    v_A      NUMERIC;
    v_P      NUMERIC;
    v_R      NUMERIC;
BEGIN
    IF p_Q <= 0 OR p_b <= 0 OR p_n <= 0 OR p_S0 <= 0 THEN
        RETURN 0;
    END IF;
    -- Estimación inicial: canal rectangular ancho (buena aproximación para trapezoidal)
    v_y := POWER((p_Q * p_n) / (p_b * SQRT(p_S0)), 0.6);
    IF v_y <= 0 THEN v_y := 0.5; END IF;

    LOOP
        v_A     := (p_b + p_z * v_y) * v_y;
        v_P     := p_b + 2.0 * v_y * SQRT(1.0 + p_z * p_z);
        v_R     := v_A / v_P;
        v_Q_calc := (1.0 / p_n) * v_A * POWER(v_R, 2.0/3.0) * SQRT(p_S0);

        EXIT WHEN ABS(v_Q_calc - p_Q) < 0.001;
        EXIT WHEN v_iter > 60;

        -- Ratio iteration con exponente 0.375 (≈ 3/8, derivado de Q ∝ y^(8/3))
        v_y_new := v_y * POWER(p_Q / GREATEST(v_Q_calc, 0.0001), 0.375);

        EXIT WHEN ABS(v_y_new - v_y) < 0.0001;
        v_y    := GREATEST(v_y_new, 0.001);
        v_iter := v_iter + 1;
    END LOOP;

    RETURN ROUND(v_y, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ════════════════════════════════════════════════════════════
-- FN 3: SIMULACIÓN DE ESCENARIO COMPLETO K-0 → K-104
-- ════════════════════════════════════════════════════════════
-- Parámetros:
--   p_fecha          — Fecha a analizar (default: hoy)
--   p_q_entrada_m3s  — Gasto de entrada en K-0 (NULL = usar lecturas_presas)
--   p_modificaciones — JSONB [{punto_id, nuevo_caudal_m3s}]
--                      Ejemplo: '[{"punto_id":"PE-058","nuevo_caudal_m3s":0}]'
--                      nuevo_caudal_m3s = 0 → cierra la toma
--
-- Retorna una fila por tramo de perfil_hidraulico_canal (≈50 filas)
-- más filas de escalas intermedias y el punto final K-104.

CREATE OR REPLACE FUNCTION public.fn_simular_escenario_canal(
    p_fecha          DATE    DEFAULT NULL,
    p_q_entrada_m3s  NUMERIC DEFAULT NULL,
    p_modificaciones JSONB   DEFAULT '[]'::jsonb
)
RETURNS TABLE (
    -- Identificación del punto
    km_ref             NUMERIC,
    nombre_tramo       TEXT,
    tipo_punto         TEXT,       -- 'tramo_inicio' | 'escala' | 'k104'

    -- Gasto
    q_entrada_m3s      NUMERIC,    -- Q al inicio del tramo
    q_salida_m3s       NUMERIC,    -- Q al final del tramo
    q_extraido_m3s     NUMERIC,    -- Suma de extracciones en este tramo
    q_extraido_base_m3s NUMERIC,   -- Extracciones sin modificaciones (base)
    delta_q_m3s        NUMERIC,    -- Diferencia escenario - base en este tramo

    -- Hidráulica
    y_normal_m         NUMERIC,    -- Tirante normal calculado (Manning)
    y_base_m           NUMERIC,    -- Tirante base (sin modificaciones)
    delta_y_cm         NUMERIC,    -- Diferencia en cm (escenario - base)
    velocidad_ms       NUMERIC,    -- Velocidad media V = Q/A
    froude             NUMERIC,    -- Número de Froude Fr = V/√(g·D)
    b_m                NUMERIC,    -- Plantilla del tramo
    z                  NUMERIC,    -- Talud del tramo
    n_manning          NUMERIC,    -- Coeficiente Manning

    -- Escala real (si existe lectura del día)
    escala_id          TEXT,
    escala_nombre      TEXT,
    nivel_real_m       NUMERIC,    -- Lectura real de la escala
    delta_real_m       NUMERIC,    -- Tirante calculado - lectura real (calibración)

    -- Tiempo de tránsito
    tiempo_tramo_min   NUMERIC,    -- Minutos para recorrer este tramo
    tiempo_acum_h      NUMERIC,    -- Tiempo acumulado desde K-0 (horas)
    hora_arribo        TEXT        -- Hora estimada de arribo (base: ahora)
) AS $$
DECLARE
    v_q_base_entrada   NUMERIC;
    v_q_escenario_entrada NUMERIC;
    v_tiempo_acum_s    NUMERIC := 0;
    v_hora_inicio      TIMESTAMP WITH TIME ZONE := now();

    v_tramo            RECORD;
    v_q_base_acum      NUMERIC;   -- Q acumulado en escenario base
    v_q_esc_acum       NUMERIC;   -- Q acumulado en escenario modificado

    v_q_ext_base       NUMERIC;   -- Extracciones base en tramo
    v_q_ext_esc        NUMERIC;   -- Extracciones escenario en tramo

    v_y_base           NUMERIC;
    v_y_esc            NUMERIC;
    v_velocidad        NUMERIC;
    v_A                NUMERIC;
    v_froude           NUMERIC;
    v_T                NUMERIC;   -- Ancho superficial

    v_tiempo_tramo_s   NUMERIC;
    v_dist_m           NUMERIC;

    v_escala_id        TEXT;
    v_escala_nombre    TEXT;
    v_nivel_real       NUMERIC;
BEGIN
    -- Zona horaria: si no se pasa fecha, usar fecha local Chihuahua (no UTC)
    IF p_fecha IS NULL THEN
        p_fecha := (NOW() AT TIME ZONE 'America/Chihuahua')::date;
    END IF;

    -- ── 1. OBTENER GASTO DE ENTRADA (K-0) ─────────────────────────────────────
    -- El gasto en K-0 viene del río, no directamente de la presa.
    -- La presa mantiene su último gasto hasta que haya un nuevo movimiento.
    IF p_q_entrada_m3s IS NOT NULL AND p_q_entrada_m3s > 0 THEN
        v_q_base_entrada := p_q_entrada_m3s;
    ELSE
        -- Tier 1: Aforo de campo en K-1+000 del día (medición directa más precisa)
        SELECT af.gasto_calculado_m3s
        INTO v_q_base_entrada
        FROM public.aforos af
        JOIN public.puntos_entrega pe ON pe.id = af.punto_control_id
        WHERE af.fecha = p_fecha
          AND pe.km BETWEEN 0 AND 2.0
        ORDER BY af.hora_inicio DESC
        LIMIT 1;

        -- Tier 2: Compuerta K-0 (nivel_arriba + nivel_abajo + apertura → Q)
        IF v_q_base_entrada IS NULL THEN
            SELECT public.fn_calcular_gasto_escala(
                le.escala_id, le.nivel_m,
                COALESCE(le.apertura_radiales_m, 0),
                COALESCE(le.nivel_abajo_m, 0)
            ) INTO v_q_base_entrada
            FROM public.lecturas_escalas le
            JOIN public.escalas e ON e.id = le.escala_id
            WHERE e.km BETWEEN 0 AND 1.5
              AND le.fecha = p_fecha
              AND le.apertura_radiales_m > 0
              AND e.activa = true
            ORDER BY le.hora_lectura DESC
            LIMIT 1;
            -- Q=0 de compuerta no es válido — si geometría no encontrada devuelve 0, ignorar
            IF v_q_base_entrada IS NOT NULL AND v_q_base_entrada <= 0 THEN
                v_q_base_entrada := NULL;
            END IF;
        END IF;

        -- Tier 3: Último movimiento de presa vigente (se mantiene hasta nuevo movimiento)
        -- Comportamiento "continua": si no hubo cambio hoy, aplica el último registrado
        IF v_q_base_entrada IS NULL THEN
            SELECT gasto_m3s INTO v_q_base_entrada
            FROM public.movimientos_presas
            WHERE fecha_hora::date <= p_fecha
              AND gasto_m3s IS NOT NULL
              AND gasto_m3s > 0
            ORDER BY fecha_hora DESC
            LIMIT 1;
        END IF;

        -- Tier 4: Última lectura_presas disponible (extraccion_total como proxy)
        IF v_q_base_entrada IS NULL THEN
            SELECT extraccion_total_m3s INTO v_q_base_entrada
            FROM public.lecturas_presas
            WHERE fecha <= p_fecha
              AND extraccion_total_m3s IS NOT NULL
              AND extraccion_total_m3s > 0
            ORDER BY fecha DESC
            LIMIT 1;
        END IF;

        -- Sin datos reales: no usar número arbitrario
        -- El perfil calculará con Q=0 y fuente_q señalará el problema
        IF v_q_base_entrada IS NULL THEN
            v_q_base_entrada := 0;
        END IF;
    END IF;

    v_q_base_acum    := v_q_base_entrada;
    v_q_esc_acum     := v_q_base_entrada;

    -- ── 2. RECORRER TRAMOS DE perfil_hidraulico_canal ─────────────────────────
    FOR v_tramo IN
        SELECT
            phc.km_inicio,
            phc.km_fin,
            phc.nombre_tramo,
            phc.plantilla_m     AS b,
            phc.talud_z         AS z,
            COALESCE(phc.rugosidad_n, 0.014) AS n_val,
            phc.pendiente_s0    AS S0
        FROM public.perfil_hidraulico_canal phc
        ORDER BY phc.km_inicio ASC
    LOOP
        -- Distancia del tramo en metros
        v_dist_m := (v_tramo.km_fin - v_tramo.km_inicio) * 1000.0;

        -- ── Extracciones BASE en este tramo ────────────────────────────────────
        SELECT COALESCE(SUM(ro.caudal_promedio), 0)
        INTO v_q_ext_base
        FROM public.reportes_operacion ro
        JOIN public.puntos_entrega pe ON pe.id = ro.punto_id
        WHERE pe.km >= v_tramo.km_inicio
          AND pe.km <  v_tramo.km_fin
          AND ro.fecha = p_fecha
          AND ro.estado::text NOT IN ('cierre', 'suspension');

        -- ── Extracciones ESCENARIO (aplica modificaciones) ────────────────────
        SELECT COALESCE(SUM(
            CASE
                -- Override: usar nuevo_caudal_m3s del JSONB si existe para este punto
                WHEN (p_modificaciones @> jsonb_build_array(jsonb_build_object('punto_id', ro.punto_id::text)))
                     THEN (
                         SELECT (elem->>'nuevo_caudal_m3s')::numeric
                         FROM jsonb_array_elements(p_modificaciones) elem
                         WHERE elem->>'punto_id' = ro.punto_id::text
                         LIMIT 1
                     )
                ELSE ro.caudal_promedio
            END
        ), 0)
        INTO v_q_ext_esc
        FROM public.reportes_operacion ro
        JOIN public.puntos_entrega pe ON pe.id = ro.punto_id
        WHERE pe.km >= v_tramo.km_inicio
          AND pe.km <  v_tramo.km_fin
          AND ro.fecha = p_fecha
          AND ro.estado::text NOT IN ('cierre', 'suspension');

        -- ── Q salida del tramo ─────────────────────────────────────────────────
        -- Base
        v_q_base_acum := GREATEST(v_q_base_acum - v_q_ext_base, 0);
        -- Escenario
        v_q_esc_acum  := GREATEST(v_q_esc_acum  - v_q_ext_esc,  0);

        -- ── Tirante normal ─────────────────────────────────────────────────────
        v_y_base := public.fn_tirante_normal(
            v_q_base_acum, v_tramo.b, v_tramo.z, v_tramo.n_val, v_tramo.S0);
        v_y_esc  := public.fn_tirante_normal(
            v_q_esc_acum,  v_tramo.b, v_tramo.z, v_tramo.n_val, v_tramo.S0);

        -- ── Velocidad y Froude (usando Q escenario) ───────────────────────────
        v_A        := GREATEST((v_tramo.b + v_tramo.z * v_y_esc) * v_y_esc, 0.001);
        v_T        := v_tramo.b + 2.0 * v_tramo.z * v_y_esc;
        v_velocidad := v_q_esc_acum / v_A;
        v_froude   := v_velocidad / SQRT(9.81 * (v_A / GREATEST(v_T, 0.001)));

        -- ── Tiempo de tránsito ────────────────────────────────────────────────
        v_tiempo_tramo_s := CASE
            WHEN v_velocidad > 0 THEN v_dist_m / v_velocidad
            ELSE 0
        END;
        v_tiempo_acum_s  := v_tiempo_acum_s + v_tiempo_tramo_s;

        -- ── Escala en este tramo (si existe lectura del día) ──────────────────
        SELECT
            e.id,
            e.nombre,
            le.nivel_m
        INTO v_escala_id, v_escala_nombre, v_nivel_real
        FROM public.escalas e
        LEFT JOIN public.lecturas_escalas le ON le.escala_id = e.id
            AND le.fecha = p_fecha
        WHERE e.km >= v_tramo.km_inicio
          AND e.km <  v_tramo.km_fin
          AND e.activa = true
        ORDER BY le.hora_lectura DESC NULLS LAST
        LIMIT 1;

        -- ── Emitir fila ────────────────────────────────────────────────────────
        km_ref              := v_tramo.km_fin;
        nombre_tramo        := v_tramo.nombre_tramo
                               || ' (Km ' || v_tramo.km_inicio || '–' || v_tramo.km_fin || ')';
        tipo_punto          := CASE WHEN v_tramo.km_fin >= 98 THEN 'k104'
                                    WHEN v_escala_id IS NOT NULL THEN 'escala'
                                    ELSE 'tramo' END;

        q_entrada_m3s       := ROUND((v_q_esc_acum + v_q_ext_esc)::numeric, 3);
        q_salida_m3s        := ROUND(v_q_esc_acum::numeric,  3);
        q_extraido_m3s      := ROUND(v_q_ext_esc::numeric,   3);
        q_extraido_base_m3s := ROUND(v_q_ext_base::numeric,  3);
        delta_q_m3s         := ROUND((v_q_esc_acum - v_q_base_acum)::numeric, 3);

        y_normal_m          := v_y_esc;
        y_base_m            := v_y_base;
        delta_y_cm          := ROUND(((v_y_esc - v_y_base) * 100.0)::numeric, 1);
        velocidad_ms        := ROUND(v_velocidad::numeric, 3);
        froude              := ROUND(v_froude::numeric, 3);
        b_m                 := v_tramo.b;
        z                   := v_tramo.z;
        n_manning           := v_tramo.n_val;

        escala_id           := v_escala_id;
        escala_nombre       := v_escala_nombre;
        nivel_real_m        := v_nivel_real;
        delta_real_m        := CASE
                                   WHEN v_nivel_real IS NOT NULL
                                   THEN ROUND((v_y_esc - v_nivel_real)::numeric, 3)
                                   ELSE NULL
                               END;

        tiempo_tramo_min    := ROUND((v_tiempo_tramo_s / 60.0)::numeric, 1);
        tiempo_acum_h       := ROUND((v_tiempo_acum_s / 3600.0)::numeric, 2);
        hora_arribo         := TO_CHAR(
                                   (v_hora_inicio + make_interval(secs => v_tiempo_acum_s::float8))
                                   AT TIME ZONE 'America/Chihuahua',
                                   'HH24:MI'
                               );

        RETURN NEXT;

        -- Limpiar escala para el siguiente tramo
        v_escala_id     := NULL;
        v_escala_nombre := NULL;
        v_nivel_real    := NULL;
    END LOOP;

END;
$$ LANGUAGE plpgsql STABLE;


-- ════════════════════════════════════════════════════════════
-- FN 4: VERIFICAR UNA ESCALA — lectura real vs tirante Manning
-- ════════════════════════════════════════════════════════════
-- Responde: "La escala en K-54 marca 4.42m — ¿qué Q corresponde
-- y cuánto difiere del Q calculado por el balance?"
--
-- Uso: SELECT * FROM fn_verificar_escala('ESC-054', 4.42);
--      O con km:  SELECT * FROM fn_verificar_escala_km(54, 4.42, CURRENT_DATE);

CREATE OR REPLACE FUNCTION public.fn_verificar_escala_km(
    p_km      NUMERIC,
    p_nivel_m NUMERIC,
    p_fecha   DATE DEFAULT NULL
)
RETURNS TABLE (
    escala_id       TEXT,
    escala_nombre   TEXT,
    km              NUMERIC,
    nivel_leido_m   NUMERIC,
    -- Tirante → Q (Manning directo con el nivel leído)
    q_desde_lectura_m3s NUMERIC,
    -- Q balance del canal hasta este km
    q_balance_m3s       NUMERIC,
    -- Diferencia (positivo = más Q del esperado → posible aportación o error)
    diferencia_m3s      NUMERIC,
    diferencia_pct      NUMERIC,
    diagnostico         TEXT,
    -- Geometría usada
    b_m             NUMERIC,
    z_talud         NUMERIC,
    n_manning       NUMERIC,
    pendiente_s0    NUMERIC
) AS $$
DECLARE
    v_esc_id         TEXT;
    v_esc_nombre     TEXT;
    v_esc_km         NUMERIC;
    v_perf           RECORD;
    v_q_lectura      NUMERIC;
    v_q_balance      NUMERIC;
    v_dif            NUMERIC;
    v_q_entrada      NUMERIC;
    v_q_extraido     NUMERIC;
    v_nivel_max      NUMERIC;
    v_tirante_diseno NUMERIC;
    v_bordo_libre    NUMERIC;
BEGIN
    IF p_fecha IS NULL THEN
        p_fecha := (NOW() AT TIME ZONE 'America/Chihuahua')::date;
    END IF;
    -- Buscar escala más cercana al km indicado (incluir límites operativos)
    SELECT e.id, e.nombre, e.km,
           e.nivel_max_operativo,
           phc.tirante_diseno_m,
           phc.bordo_libre_m
    INTO v_esc_id, v_esc_nombre, v_esc_km,
         v_nivel_max, v_tirante_diseno, v_bordo_libre
    FROM public.escalas e
    LEFT JOIN public.perfil_hidraulico_canal phc
           ON p_km >= phc.km_inicio AND p_km < phc.km_fin
    WHERE ABS(e.km - p_km) < 2.0
      AND e.activa = true
    ORDER BY ABS(e.km - p_km) ASC
    LIMIT 1;

    -- Geometría del tramo
    SELECT phc.plantilla_m, phc.talud_z,
           COALESCE(phc.rugosidad_n, 0.014) AS rugosidad_n,
           phc.pendiente_s0,
           phc.tirante_diseno_m,
           phc.bordo_libre_m
    INTO v_perf
    FROM public.perfil_hidraulico_canal phc
    WHERE p_km >= phc.km_inicio AND p_km < phc.km_fin
    LIMIT 1;

    IF v_perf IS NULL THEN
        RAISE EXCEPTION 'No se encontró geometría para km = %', p_km;
    END IF;

    -- ── GUARDIA DE DESBORDAMIENTO ──────────────────────────────────────────────
    -- El cajón hidráulico tiene capacidad hasta tirante_diseno + bordo_libre.
    -- Si el nivel leído supera ese límite, la sección ya no es trapezoidal cerrada
    -- y Manning normal deja de aplicar. La lectura es válida como dato físico
    -- (el operador debe atender la alerta), pero NO se compara con el modelo.
    v_nivel_max := COALESCE(
        v_nivel_max,                                       -- nivel_max_operativo de la escala
        v_perf.tirante_diseno_m + v_perf.bordo_libre_m,   -- tirante diseño + bordo libre
        3.8                                                 -- fallback genérico (m)
    );

    IF p_nivel_m > v_nivel_max THEN
        RETURN QUERY SELECT
            COALESCE(v_esc_id,     'SIN-ESCALA'),
            COALESCE(v_esc_nombre, 'Km ' || p_km),
            COALESCE(v_esc_km,     p_km),
            p_nivel_m,
            NULL::NUMERIC,   -- q_desde_lectura: no calculable (fuera de cajón)
            NULL::NUMERIC,   -- q_balance: no aplica compararcon modelo
            NULL::NUMERIC,
            NULL::NUMERIC,
            '⚠ DESBORDAMIENTO — nivel ' || p_nivel_m
                || 'm supera el cajón hidráulico ('
                || ROUND(v_nivel_max::numeric,2) || 'm). '
                || 'Lectura válida como dato físico. '
                || 'Modelo Manning NO aplica. Verificar bordo libre.',
            v_perf.plantilla_m,
            v_perf.talud_z,
            v_perf.rugosidad_n,
            v_perf.pendiente_s0;
        RETURN;
    END IF;

    -- ── CONDICIÓN NORMAL: nivel dentro del cajón ───────────────────────────────
    -- Q desde la lectura (Manning directo)
    v_q_lectura := public.fn_q_manning(
        p_nivel_m, v_perf.plantilla_m, v_perf.talud_z,
        v_perf.rugosidad_n, v_perf.pendiente_s0);

    -- Q balance: entrada - extracciones hasta este km
    SELECT COALESCE(lp.extraccion_total_m3s, 50.0)
    INTO v_q_entrada
    FROM public.lecturas_presas lp
    WHERE lp.fecha = p_fecha
    ORDER BY lp.fecha DESC
    LIMIT 1;

    SELECT COALESCE(SUM(ro.caudal_promedio), 0)
    INTO v_q_extraido
    FROM public.reportes_operacion ro
    JOIN public.puntos_entrega pe ON pe.id = ro.punto_id
    WHERE pe.km < p_km
      AND ro.fecha = p_fecha
      AND ro.estado::text NOT IN ('cierre', 'suspension');

    v_q_balance := GREATEST(v_q_entrada - v_q_extraido, 0);
    v_dif       := v_q_lectura - v_q_balance;

    RETURN QUERY SELECT
        COALESCE(v_esc_id, 'SIN-ESCALA'),
        COALESCE(v_esc_nombre, 'Km ' || p_km),
        COALESCE(v_esc_km, p_km),
        p_nivel_m,
        ROUND(v_q_lectura::numeric, 3),
        ROUND(v_q_balance::numeric, 3),
        ROUND(v_dif::numeric, 3),
        ROUND((v_dif / GREATEST(v_q_balance, 0.001) * 100.0)::numeric, 1),
        CASE
            WHEN ABS(v_dif) <= 1.0 THEN 'CONSISTENTE — lectura concuerda con balance (±1 m³/s)'
            WHEN v_dif > 1.0       THEN 'EXCEDENTE — la escala indica más Q del esperado (aportación/error)'
            ELSE                        'DÉFICIT — la escala indica menos Q del esperado (pérdida/error)'
        END,
        v_perf.plantilla_m,
        v_perf.talud_z,
        v_perf.rugosidad_n,
        v_perf.pendiente_s0;
END;
$$ LANGUAGE plpgsql STABLE;


-- ════════════════════════════════════════════════════════════
-- FN 5: RESUMEN RÁPIDO DE ESCENARIO — solo puntos clave
-- ════════════════════════════════════════════════════════════
-- Retorna solo K-0, escalas con lectura, y K-104 (sin el perfil completo)
-- Útil para mostrar en dashboard sin sobrecargar la UI

CREATE OR REPLACE FUNCTION public.fn_resumen_escenario_canal(
    p_fecha          DATE    DEFAULT NULL,
    p_q_entrada_m3s  NUMERIC DEFAULT NULL,
    p_modificaciones JSONB   DEFAULT '[]'::jsonb
)
RETURNS TABLE (
    km_ref          NUMERIC,
    nombre          TEXT,
    tipo_punto      TEXT,
    q_m3s           NUMERIC,
    q_lps           NUMERIC,
    y_m             NUMERIC,
    delta_y_cm      NUMERIC,
    nivel_real_m    NUMERIC,
    delta_real_m    NUMERIC,
    velocidad_ms    NUMERIC,
    tiempo_acum_h   NUMERIC,
    hora_arribo     TEXT,
    q_base_m3s      NUMERIC,
    tomas_activas   INTEGER
) AS $$
BEGIN
    IF p_fecha IS NULL THEN
        p_fecha := (NOW() AT TIME ZONE 'America/Chihuahua')::date;
    END IF;
    RETURN QUERY
    SELECT
        s.km_ref,
        s.nombre_tramo,
        s.tipo_punto,
        s.q_salida_m3s,
        ROUND((s.q_salida_m3s * 1000.0)::numeric, 1),  -- m³/s → L/s
        s.y_normal_m,
        s.delta_y_cm,
        s.nivel_real_m,
        s.delta_real_m,
        s.velocidad_ms,
        s.tiempo_acum_h,
        s.hora_arribo,
        s.y_base_m,   -- reutilizamos columna para q_base (renombrado conceptualmente)
        (
            SELECT COUNT(*)::integer
            FROM public.reportes_operacion ro
            JOIN public.puntos_entrega pe ON pe.id = ro.punto_id
            WHERE pe.km < s.km_ref
              AND ro.fecha = p_fecha
              AND ro.estado::text NOT IN ('cierre', 'suspension')
        )
    FROM public.fn_simular_escenario_canal(p_fecha, p_q_entrada_m3s, p_modificaciones) s
    WHERE s.escala_id IS NOT NULL   -- Solo tramos con escala
       OR s.tipo_punto = 'k104'     -- Siempre incluir K-104
       OR s.km_ref <= 2             -- Incluir inicio del canal
    ORDER BY s.km_ref;
END;
$$ LANGUAGE plpgsql STABLE;


-- ════════════════════════════════════════════════════════════
-- CONSULTAS DE VERIFICACIÓN Y USO
-- ════════════════════════════════════════════════════════════

-- ── A. Verificar lectura actual K-54 = 4.42m ──────────────────────────────────
-- SELECT * FROM fn_verificar_escala_km(54, 4.42, CURRENT_DATE);

-- ── B. Simulación base (condición actual del día) ─────────────────────────────
-- SELECT km_ref, nombre_tramo, q_salida_m3s, y_normal_m, nivel_real_m,
--        delta_real_m, tiempo_acum_h, hora_arribo
-- FROM fn_simular_escenario_canal()
-- ORDER BY km_ref;

-- ── C. Escenario: cerrar PE-058 y PE-152 → ¿qué pasa en K-104? ───────────────
-- SELECT km_ref, nombre_tramo, q_salida_m3s, delta_q_m3s, y_normal_m, delta_y_cm,
--        tiempo_acum_h, hora_arribo
-- FROM fn_simular_escenario_canal(
--     CURRENT_DATE,
--     NULL,
--     '[{"punto_id":"PE-058","nuevo_caudal_m3s":0},
--       {"punto_id":"PE-152","nuevo_caudal_m3s":0}]'::jsonb
-- )
-- ORDER BY km_ref;

-- ── D. ¿Cuánto llega al K-104 con las entregas actuales? ─────────────────────
-- SELECT q_salida_m3s AS q_k104_m3s,
--        ROUND(q_salida_m3s * 1000) AS q_k104_lps,
--        y_normal_m, tiempo_acum_h, hora_arribo
-- FROM fn_simular_escenario_canal()
-- WHERE tipo_punto = 'k104'
-- LIMIT 1;

-- ── E. Resumen rápido (solo escalas + K-104) ──────────────────────────────────
-- SELECT * FROM fn_resumen_escenario_canal()
-- ORDER BY km_ref;
