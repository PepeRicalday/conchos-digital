-- ═══════════════════════════════════════════════════════════════════════════
-- RATIFICACIÓN PERFIL HIDRÁULICO CANAL PRINCIPAL CONCHOS
-- Fecha: 2026-04-12
-- Problemas corregidos:
--   1. km_fin = 0 en tramo km 46.5 → corregido a 48 (causaba L negativa en FGV)
--   2. Filas CANAL AUXILIAR K-68+582 eliminadas (no corresponden al canal principal)
--   3. nombre_tramo normalizado a 'CANAL PRINCIPAL CONCHOS' en todos los tramos
--   4. Descripción de zona sifón km 68.72-70 añadida (tramo de estructura especial)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Corregir km_fin = 0 en el tramo 46.5 → 48 ────────────────────────────
UPDATE public.perfil_hidraulico_canal
SET
    km_fin          = 48,
    nombre_tramo    = 'CANAL PRINCIPAL CONCHOS'
WHERE
    km_inicio = 46.5
    AND km_fin = 0;

-- ── 2. Eliminar filas del Canal Auxiliar K-68+582 ───────────────────────────
DELETE FROM public.perfil_hidraulico_canal
WHERE nombre_tramo = 'CANAL AUXILIAR K-68+582';

-- ── 3. Normalizar nombre_tramo (por si quedaron restos de 'Tramo Canal') ─────
UPDATE public.perfil_hidraulico_canal
SET nombre_tramo = 'CANAL PRINCIPAL CONCHOS'
WHERE nombre_tramo IS DISTINCT FROM 'CANAL PRINCIPAL CONCHOS'
  AND nombre_tramo NOT IN ('SIFÓN K-68+720', 'TRANSICIÓN K-68+720');

-- ── 4. Etiquetar zona de sifón / estructura especial km 68.72–70.84 ─────────
--    (plantilla reducida de 3.2m y pendiente 4× mayor indican sección de sifón)
UPDATE public.perfil_hidraulico_canal
SET nombre_tramo = 'CANAL PRINCIPAL CONCHOS — SIFÓN K-68+720'
WHERE km_inicio >= 68.72 AND km_fin <= 70.1
  AND plantilla_m <= 4.0
  AND pendiente_s0 >= 0.0003;

-- Tramo de transición (reconexión al canal abierto)
UPDATE public.perfil_hidraulico_canal
SET nombre_tramo = 'CANAL PRINCIPAL CONCHOS — TRANSICIÓN K-70+100'
WHERE km_inicio >= 70.1 AND km_fin <= 70.84
  AND plantilla_m BETWEEN 4 AND 9
  AND pendiente_s0 BETWEEN 0.0001 AND 0.0003;

-- ── 5. Verificación final (audit) ────────────────────────────────────────────
DO $$
DECLARE
    v_count_bad_km_fin  INT;
    v_count_auxiliar    INT;
    v_count_gaps        INT;
    v_count_total       INT;
BEGIN
    -- Sin km_fin = 0
    SELECT COUNT(*) INTO v_count_bad_km_fin
    FROM public.perfil_hidraulico_canal
    WHERE km_fin = 0;

    -- Sin filas auxiliares
    SELECT COUNT(*) INTO v_count_auxiliar
    FROM public.perfil_hidraulico_canal
    WHERE nombre_tramo = 'CANAL AUXILIAR K-68+582';

    -- Total filas
    SELECT COUNT(*) INTO v_count_total
    FROM public.perfil_hidraulico_canal;

    -- Detectar huecos entre tramos del canal principal
    SELECT COUNT(*) INTO v_count_gaps
    FROM (
        SELECT
            km_fin,
            LEAD(km_inicio) OVER (ORDER BY km_inicio) AS sig_km_inicio
        FROM public.perfil_hidraulico_canal
        WHERE nombre_tramo LIKE 'CANAL PRINCIPAL CONCHOS%'
    ) gaps
    WHERE sig_km_inicio IS NOT NULL
      AND ABS(sig_km_inicio - km_fin) > 0.01;

    RAISE NOTICE '══ RATIFICACIÓN perfil_hidraulico_canal ══';
    RAISE NOTICE 'Total filas          : %', v_count_total;
    RAISE NOTICE 'Filas con km_fin=0   : % (esperado: 0)', v_count_bad_km_fin;
    RAISE NOTICE 'Filas AUXILIAR       : % (esperado: 0)', v_count_auxiliar;
    RAISE NOTICE 'Huecos entre tramos  : % (esperado: 0)', v_count_gaps;

    IF v_count_bad_km_fin > 0 THEN
        RAISE WARNING 'ALERTA: Aún existen filas con km_fin = 0';
    END IF;
    IF v_count_auxiliar > 0 THEN
        RAISE WARNING 'ALERTA: Aún existen filas del Canal Auxiliar';
    END IF;
    IF v_count_gaps > 0 THEN
        RAISE WARNING 'ALERTA: Existen huecos en la continuidad del perfil';
    END IF;

    RAISE NOTICE '══ Ratificación completa ══';
END;
$$;
