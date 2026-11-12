-- Seguimiento de presas por texto plano (captura manual de la gerencia).
-- Una fila por presa y día. Es la fuente PRIORITARIA del informe de presas; CILA/AQUARIUS la complementan.
-- Las presas del distrito (PRE-001/002) además se vuelcan a lecturas_presas sin la marca de CILA, así la captura prevalece.
CREATE TABLE IF NOT EXISTS public.seguimiento_presas (
  clave             text        NOT NULL,
  fecha             date        NOT NULL,
  hora              time,
  nombre_reportado  text        NOT NULL,
  presa_id          text,
  cuerpo_id         text,
  aqwp_ubicacion_id integer,
  pct_reportado     numeric,
  elevacion_msnm    numeric,
  almacenamiento_mm3 numeric   NOT NULL CHECK (almacenamiento_mm3 >= 0),
  dif_namo_mm3      numeric,
  namo_msnm         numeric,
  namo_mm3          numeric,
  extraccion_m3s    numeric CHECK (extraccion_m3s IS NULL OR extraccion_m3s >= 0),
  ingreso_m3s       numeric CHECK (ingreso_m3s IS NULL OR ingreso_m3s >= 0),
  parrafo_origen    text,
  capturado_por     text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clave, fecha)
);
CREATE INDEX IF NOT EXISTS seguimiento_presas_fecha_idx ON public.seguimiento_presas (fecha DESC);

ALTER TABLE public.seguimiento_presas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seguimiento_presas_select ON public.seguimiento_presas;
CREATE POLICY seguimiento_presas_select ON public.seguimiento_presas FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS seguimiento_presas_insert ON public.seguimiento_presas;
CREATE POLICY seguimiento_presas_insert ON public.seguimiento_presas FOR INSERT TO authenticated WITH CHECK (NOT auth_es_invitado());
DROP POLICY IF EXISTS seguimiento_presas_update ON public.seguimiento_presas;
CREATE POLICY seguimiento_presas_update ON public.seguimiento_presas FOR UPDATE TO authenticated USING (NOT auth_es_invitado()) WITH CHECK (NOT auth_es_invitado());
