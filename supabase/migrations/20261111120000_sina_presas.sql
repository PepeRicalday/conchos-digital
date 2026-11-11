-- ═══════════════════════════════════════════════════════════════════════════
-- SINA CONAGUA — «Monitoreo de las principales presas de México»
-- https://sinav30.conagua.gob.mx:8080/Presas/   Fecha: 2026-11-11
--
-- Fuente CRUDA, separada del catálogo (sin FK): un reporte nacional por día,
--   GET /PresasPG/presas/reporte/AAAA-MM-DD  y  GET /SINA45/fechaMonitoreo/ultimo
-- Aquí solo se guardan cierres de mes de las presas de Chihuahua (cuenca del Conchos + las tres de
-- las otras cuencas del estado). El portal dejó de actualizarse el 2025-04-23.
--
-- Qué aporta frente a AQWP: ELEVACIÓN, ficha oficial, Piedras Azules y verificación independiente.
-- El almacenamiento es el mismo dato de CONAGUA que publica AQWP. NAMO/NAME vienen en cada fila
-- porque el portal los cambió con el tiempo (Boquilla 2893.571 → 2846.78 en ago-2021).
-- Regla S/D: ausente = NULL, jamás 0. Fuente tercera: nunca sobrescribe campo ni CILA.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sina_presas (
  clave_sih         text PRIMARY KEY,
  nombre_oficial    text NOT NULL,
  nombre_comun      text,
  estado            text,
  municipio         text,
  region_cna        text,
  latitud           numeric,
  longitud          numeric,
  uso               text,
  corriente         text,
  tipo_vertedor     text,
  inicio_operacion  integer,
  elev_corona_msnm  numeric,
  bordo_libre_m     numeric,
  altura_cortina_m  numeric,
  actualizado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sina_presas_diario (
  clave_sih          text    NOT NULL,
  fecha              date    NOT NULL,
  elevacion_msnm     numeric,
  almacenamiento_mm3 numeric,
  llenado_frac       numeric,                 -- almacenamiento / NAMO del día, tal como lo publica el portal
  namo_mm3           numeric,
  namo_msnm          numeric,
  name_mm3           numeric,
  name_msnm          numeric,
  id_monitoreo       bigint,                  -- idmonitoreodiario del portal
  consultado_en      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clave_sih, fecha)
);
CREATE INDEX IF NOT EXISTS idx_sina_presas_diario_fecha ON public.sina_presas_diario (fecha DESC);

CREATE TABLE IF NOT EXISTS public.sina_sync_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inicio        timestamptz NOT NULL DEFAULT now(),
  ok            boolean     NOT NULL,
  fecha_portal  date,                         -- lo que respondió /fechaMonitoreo/ultimo
  fechas        integer     NOT NULL DEFAULT 0,
  filas         integer     NOT NULL DEFAULT 0,
  error         text,
  duracion_ms   integer
);

ALTER TABLE public.sina_presas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sina_presas_diario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sina_sync_log      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read SINA presas" ON public.sina_presas;
CREATE POLICY "Public Read SINA presas" ON public.sina_presas FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public Read SINA diario" ON public.sina_presas_diario;
CREATE POLICY "Public Read SINA diario" ON public.sina_presas_diario FOR SELECT USING (true);
-- sina_sync_log: sin política = solo service_role.

COMMENT ON TABLE public.sina_presas_diario IS
  'Reportes diarios del SINA CONAGUA (solo cierres de mes cargados). Dato provisional de CONAGUA; el portal repite el último valor cuando no llega uno nuevo.';
