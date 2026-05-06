-- ═══════════════════════════════════════════════════════════════════════
-- FIX: modulo_zonas + entregas_modulo para soporte multizona completo
--
-- Cambios:
--   1. MOD-012: añadir Z1 (primaria) y bajar Z2 a secundaria
--      Antes: MOD-012 → Z2 única/primaria
--      Después: MOD-012 → Z1 primaria + Z2 secundaria
--
--   2. entregas_modulo UNIQUE constraint: incluir zona_id
--      Antes: UNIQUE(fecha, modulo_id, tipo_entrega)
--        → solo 1 base y 1 adicional por módulo por día (sin importar zona)
--        → bloquea registrar base en Z2 Y base en Z3 para MOD-002 el mismo día
--      Después: UNIQUE NULLS NOT DISTINCT (fecha, modulo_id, zona_id, tipo_entrega)
--        → 1 base + 1 adicional POR ZONA por día
--        → MOD-002 puede tener (fecha,Z2,base) + (fecha,Z3,base) independientes
--        → MOD-012 puede tener (fecha,Z1,base) + (fecha,Z2,base) independientes
--        → NULLS NOT DISTINCT: registros sin zona_id siguen colisionando entre sí
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. MOD-012: añadir Z1 como zona primaria ──────────────────────────
INSERT INTO public.modulo_zonas (modulo_id, zona_id, es_primaria)
SELECT 'MOD-012', z.id, TRUE
FROM public.zonas_canal z
WHERE z.codigo = 'Z1'
ON CONFLICT (modulo_id, zona_id) DO UPDATE SET es_primaria = TRUE;

-- ── 2. MOD-012: cambiar Z2 a zona secundaria ──────────────────────────
UPDATE public.modulo_zonas
SET es_primaria = FALSE
WHERE modulo_id = 'MOD-012'
  AND zona_id = (SELECT id FROM public.zonas_canal WHERE codigo = 'Z2');

-- ── 3. Sincronizar modulos.zona_id de MOD-012 con su nueva zona primaria
UPDATE public.modulos
SET zona_id = (
    SELECT mz.zona_id
    FROM public.modulo_zonas mz
    WHERE mz.modulo_id = 'MOD-012' AND mz.es_primaria = TRUE
    LIMIT 1
)
WHERE id = 'MOD-012';


-- ── 4. Backfill zona_id en entregas_modulo sin zona asignada ──────────
-- Registros históricos sin zona_id reciben la zona primaria de su módulo
UPDATE public.entregas_modulo em
SET zona_id = (
    SELECT mz.zona_id
    FROM public.modulo_zonas mz
    WHERE mz.modulo_id = em.modulo_id
      AND mz.es_primaria = TRUE
    LIMIT 1
)
WHERE em.zona_id IS NULL;


-- ── 5. Cambio de constraint: (fecha, modulo_id, tipo) → (fecha, modulo_id, zona_id, tipo)
ALTER TABLE public.entregas_modulo
    DROP CONSTRAINT IF EXISTS entregas_modulo_fecha_tipo_uq;

-- NULLS NOT DISTINCT (PG 15+): dos NULLs en zona_id siguen colisionando
-- → backward-compatible con registros históricos sin zona
ALTER TABLE public.entregas_modulo
    ADD CONSTRAINT entregas_modulo_fecha_zona_tipo_uq
    UNIQUE NULLS NOT DISTINCT (fecha, modulo_id, zona_id, tipo_entrega);


-- ── Validación ────────────────────────────────────────────────────────
-- Estructura final modulo_zonas:
--
-- SELECT mz.modulo_id, string_agg(zc.codigo || CASE WHEN mz.es_primaria THEN '*' ELSE '' END, ', ' ORDER BY zc.codigo) AS zonas
-- FROM public.modulo_zonas mz
-- JOIN public.zonas_canal zc ON mz.zona_id = zc.id
-- GROUP BY mz.modulo_id ORDER BY mz.modulo_id;
--
-- Resultado esperado:
--   MOD-001  Z1*
--   MOD-002  Z2*, Z3
--   MOD-003  Z3*
--   MOD-004  Z3*
--   MOD-005  Z4*
--   MOD-012  Z1*, Z2
