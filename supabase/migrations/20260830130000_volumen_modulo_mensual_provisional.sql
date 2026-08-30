-- ═══════════════════════════════════════════════════════════════════════════
-- VOLUMEN MENSUAL POR MÓDULO — PROVISIONAL (IEHP institucional)
-- Fecha: 2026-08-30
--
-- Fuente SEPARADA de entregas_modulo (captura diaria operativa real, con RLS
-- por capturador/zona) — esta tabla guarda totales MENSUALES cargados desde
-- una fuente institucional externa (hoja "ACUMULADO GENERAL" de la SRL),
-- usada ÚNICAMENTE por el cálculo del IEHP en el plano general/informe NDVI
-- (src/utils/indicesSrl.ts, src/utils/informeNdviInstitucional.ts). No
-- reemplaza ni se concilia automáticamente con entregas_modulo — es un dato
-- provisional mientras se define el flujo definitivo de captura mensual.
--
-- Grano: una fila por (numero_modulo, mes calendario). volumen_miles_m3 es la
-- unidad tal como la maneja la hoja fuente ("2,476.440" = 2,476.440 miles de
-- m³ = 2.47644 hm³) — se guarda en esa unidad para poder cotejar visualmente
-- contra la hoja original sin conversión mental.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.volumen_modulo_mensual_provisional (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero_modulo       INTEGER NOT NULL,        -- número de Módulo SRL real (1,2,3,4,5,12) — mismo criterio que ndvi_modulo_historico
    mes                 TEXT NOT NULL,            -- 'YYYY-MM'
    volumen_miles_m3    NUMERIC NOT NULL CHECK (volumen_miles_m3 >= 0),
    es_mes_parcial      BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE para meses truncados (ej. "Ago 15" = agosto hasta el día 15, no el mes completo)
    fuente              TEXT NOT NULL DEFAULT 'hoja_acumulado_general_srl',
    notas               TEXT,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (numero_modulo, mes)
);

COMMENT ON TABLE public.volumen_modulo_mensual_provisional IS
  'Volumen mensual por módulo, carga provisional desde hoja institucional externa — solo alimenta el IEHP del panel/informe NDVI. NO reemplaza entregas_modulo (captura operativa diaria real).';
COMMENT ON COLUMN public.volumen_modulo_mensual_provisional.volumen_miles_m3 IS
  'Miles de m³, unidad tal cual la hoja fuente (ej. 2476.440 = 2,476,440 m³ = 2.47644 hm³).';
COMMENT ON COLUMN public.volumen_modulo_mensual_provisional.es_mes_parcial IS
  'TRUE cuando el total corresponde a una porción del mes (ej. "hasta el día 15"), no al mes calendario completo — evita comparar un mes truncado como si fuera equivalente a uno completo.';

CREATE INDEX IF NOT EXISTS idx_volumen_modulo_mensual_prov_modulo_mes
  ON public.volumen_modulo_mensual_provisional (numero_modulo, mes DESC);

ALTER TABLE public.volumen_modulo_mensual_provisional ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Volumen Modulo Mensual Provisional" ON public.volumen_modulo_mensual_provisional;
CREATE POLICY "Public Read Volumen Modulo Mensual Provisional" ON public.volumen_modulo_mensual_provisional
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Volumen Modulo Mensual Provisional" ON public.volumen_modulo_mensual_provisional;
CREATE POLICY "Auth Write Volumen Modulo Mensual Provisional" ON public.volumen_modulo_mensual_provisional
  FOR ALL USING (true) WITH CHECK (true);
