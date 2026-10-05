-- ═══════════════════════════════════════════════════════════════════════════
-- lecturas_presas_cila — Lecturas diarias oficiales CILA/USIBWC (Reservoir Report)
-- Fecha: 2026-10-05
--
-- Fuente externa aislada de lecturas_presas (captura de campo SICA). Cargada por la
-- Edge Function presas-cila-sync. UNIQUE (presa_id, fecha) → upsert idempotente.
-- Regla S/D: los valores ausentes ("N/A" en el reporte, p. ej. elevación) son NULL, nunca 0.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lecturas_presas_cila (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presa_id              text        NOT NULL,           -- 'PRE-001' Boquilla, 'PRE-002' Madero
  fecha                 date        NOT NULL,           -- día local (Chihuahua) del timestamp del reporte
  ts_reporte            timestamptz NOT NULL,
  almacenamiento_mm3    numeric,
  elevacion_msnm        numeric,                        -- el reporte la trae N/A → NULL
  extraccion_m3s        numeric,
  pct_conservacion      numeric,                        -- % sobre la capacidad de CONSERVACIÓN de CILA
  cap_conservacion_mm3  numeric,                        -- base del % (Boquilla 2846.78 ≠ NAMO SICA 2893.571)
  cap_inundacion_mm3    numeric,
  fuente                text        NOT NULL DEFAULT 'CILA-IBWC',
  archivo_last_modified timestamptz,
  payload_raw           text,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lecturas_presas_cila_presa_fecha_uk UNIQUE (presa_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_lecturas_presas_cila_presa_fecha
  ON public.lecturas_presas_cila (presa_id, fecha DESC);

ALTER TABLE public.lecturas_presas_cila ENABLE ROW LEVEL SECURITY;

-- Lectura pública (Monitor Público, anon). Escritura solo service_role (la Edge Function
-- omite RLS); no se crea política de escritura para anon/authenticated.
DROP POLICY IF EXISTS "Public Read Lecturas Presas CILA" ON public.lecturas_presas_cila;
CREATE POLICY "Public Read Lecturas Presas CILA" ON public.lecturas_presas_cila FOR SELECT USING (true);

COMMENT ON TABLE public.lecturas_presas_cila IS
  'Reservoir Report diario CILA/USIBWC (res_report.txt). Dato provisional sujeto a revisión.';
