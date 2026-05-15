-- ═══════════════════════════════════════════════════════════════════════
-- FASE 3 — Pronóstico de Agotamiento de Dotación + Escenario de Compuerta
--
-- 3A: vw_pronostico_agotamiento_modulos
--       Proyecta cuándo cada módulo agota su volumen base al ritmo actual.
--       Tasa = vol_base_consumido / días_transcurridos_ciclo
--       Días restantes = vol_base_disponible / tasa_diaria
--
-- 3B: Acceso anon a fn_perfil_canal_completo
--       Permite al Monitor Público llamar la simulación de escenario
--       (qué pasa si llega Q = X m³/s desde la presa).
-- ═══════════════════════════════════════════════════════════════════════


-- ── 3A. VISTA PRONÓSTICO DE AGOTAMIENTO ──────────────────────────────

CREATE OR REPLACE VIEW public.vw_pronostico_agotamiento_modulos AS
WITH ciclo AS (
    SELECT
        id,
        fecha_inicio,
        GREATEST(1, (CURRENT_DATE - fecha_inicio)::INTEGER) AS dias_transcurridos
    FROM public.ciclos_agricolas
    WHERE activo = TRUE
    LIMIT 1
),
base AS (
    -- Una fila por módulo (zona primaria únicamente para no duplicar dotación)
    SELECT
        bvm.modulo_id,
        bvm.modulo_nombre,
        bvm.codigo_corto,
        bvm.zona_codigo,
        bvm.ciclo_id,
        COALESCE(bvm.vol_base_m3, 0)               AS vol_base_m3,
        COALESCE(bvm.vol_base_consumido_m3, 0)     AS vol_base_consumido_m3,
        COALESCE(bvm.vol_base_disponible_m3, 0)    AS vol_base_disponible_m3,
        COALESCE(bvm.pct_base_consumido, 0)        AS pct_base_consumido,
        bvm.estado_volumen
    FROM public.balance_volumen_modulo bvm
    WHERE bvm.es_primaria = TRUE
)
SELECT
    b.modulo_id,
    b.modulo_nombre,
    b.codigo_corto,
    b.zona_codigo,
    b.ciclo_id,
    c.fecha_inicio                                         AS ciclo_inicio,
    c.dias_transcurridos,

    b.vol_base_m3,
    b.vol_base_consumido_m3,
    b.vol_base_disponible_m3,
    b.pct_base_consumido,
    b.estado_volumen,

    -- Tasa de consumo diaria (m³/día)
    ROUND(b.vol_base_consumido_m3 / c.dias_transcurridos) AS tasa_diaria_m3,

    -- Días restantes al ritmo actual (NULL si no hay consumo registrado)
    CASE
        WHEN b.vol_base_consumido_m3 > 0 AND b.vol_base_disponible_m3 > 0
        THEN ROUND(
            b.vol_base_disponible_m3
            / (b.vol_base_consumido_m3::NUMERIC / c.dias_transcurridos)
        )
        WHEN b.vol_base_disponible_m3 <= 0 THEN 0
        ELSE NULL
    END                                                    AS dias_restantes,

    -- Fecha estimada de agotamiento
    CASE
        WHEN b.vol_base_consumido_m3 > 0 AND b.vol_base_disponible_m3 > 0
        THEN CURRENT_DATE + ROUND(
            b.vol_base_disponible_m3
            / (b.vol_base_consumido_m3::NUMERIC / c.dias_transcurridos)
        )::INTEGER
        ELSE NULL
    END                                                    AS fecha_agotamiento,

    -- Semáforo de urgencia
    CASE
        WHEN b.vol_base_disponible_m3 <= 0 THEN 'AGOTADO'
        WHEN b.vol_base_consumido_m3 <= 0  THEN 'SIN_DATOS'
        WHEN ROUND(
            b.vol_base_disponible_m3
            / (b.vol_base_consumido_m3::NUMERIC / c.dias_transcurridos)
        ) <= 15 THEN 'CRITICO'
        WHEN ROUND(
            b.vol_base_disponible_m3
            / (b.vol_base_consumido_m3::NUMERIC / c.dias_transcurridos)
        ) <= 30 THEN 'ALERTA'
        ELSE 'NORMAL'
    END                                                    AS urgencia

FROM base b
CROSS JOIN ciclo c
ORDER BY b.zona_codigo, b.codigo_corto;


-- ── 3B. ACCESO ANON A fn_perfil_canal_completo ────────────────────────
-- La función solo lee datos (STABLE) — sin riesgo de escritura.
-- Necesario para el Simulador de Escenario en el Monitor Público
-- (que usa la anon key de Supabase).

GRANT EXECUTE ON FUNCTION public.fn_perfil_canal_completo(date, numeric, jsonb)
    TO anon;


-- ── PERMISOS ──────────────────────────────────────────────────────────

GRANT SELECT ON public.vw_pronostico_agotamiento_modulos TO authenticated, anon;


-- ── Validación ────────────────────────────────────────────────────────
-- SELECT codigo_corto, zona_codigo, dias_transcurridos,
--        ROUND(tasa_diaria_m3/1000,1) AS tasa_dam3_dia,
--        dias_restantes,
--        fecha_agotamiento,
--        urgencia
-- FROM vw_pronostico_agotamiento_modulos
-- ORDER BY dias_restantes NULLS LAST;
