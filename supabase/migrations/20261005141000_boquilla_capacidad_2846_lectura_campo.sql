-- Boquilla: base oficial de % de llenado y lectura de campo del 2026-10-05.
-- Confirmado por campo: 1297.00 msnm, 702.47 Mm3, 24.68 % (= 702.466 / 2846.78 del levantamiento 2020).

-- 1) Base oficial de % de llenado = NAMO del levantamiento 2020: 2,846.782 Mm3 (1317.00 msnm).
UPDATE public.presas SET capacidad_max = 2846.782 WHERE id = 'PRE-001';

-- 2) Recalcula porcentajes ajustados en agosto contra 2,893.571 (reportes originales: 38.05 % y 22.72 %).
UPDATE public.lecturas_presas
SET porcentaje_llenado = ROUND((almacenamiento_mm3 / 2846.782 * 100)::numeric, 2)
WHERE presa_id = 'PRE-001' AND almacenamiento_mm3 IS NOT NULL
  AND fecha IN ('2026-03-07', '2026-08-19');

-- 3) Lectura de campo 2026-10-05: prevalece sobre CILA (sin la marca 'Nivel: CILA-IBWC').
UPDATE public.lecturas_presas
SET escala_msnm = 1297.00,
    almacenamiento_mm3 = 702.47,
    porcentaje_llenado = 24.68,
    responsable = 'Campo (Gerencia SRL Conchos)',
    notas = 'Lectura de campo 05-oct-2026: escala 1297.00 msnm, sube 8 cm/día, 24.68 % de capacidad (NAMO 2846.78 Mm3).'
WHERE presa_id = 'PRE-001' AND fecha = '2026-10-05';
