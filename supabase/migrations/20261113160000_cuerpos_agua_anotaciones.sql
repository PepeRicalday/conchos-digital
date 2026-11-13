-- Cuenca del Conchos · edición (C7 del plan de auditoría 2026-11-13).
-- Anotaciones sobre los cuerpos de agua: captura manual de vasos sin telemetría (La Colina, Piedras Azules),
-- revisión de un cierre mensual y marca de lectura sospechosa. NO modifica cierres ni balances: es una capa aparte,
-- con autor y fecha, que la pantalla muestra junto al dato. Nunca se borra: una anotación equivocada se anula.
-- Aplicar con autorización expresa (no usar db push).

CREATE TABLE IF NOT EXISTS public.cuerpos_agua_anotaciones (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cuerpo_id          text NOT NULL REFERENCES public.cuerpos_agua(id),
  tipo               text NOT NULL CHECK (tipo IN ('captura', 'revision', 'sospechosa')),
  -- captura y sospechosa: día de la lectura. revision: primer día del mes del cierre revisado.
  fecha              date NOT NULL,
  almacenamiento_mm3 numeric CHECK (almacenamiento_mm3 >= 0),
  elevacion_msnm     numeric CHECK (elevacion_msnm > 0),
  origen             text,
  comentario         text,
  anulada            boolean NOT NULL DEFAULT false,
  anulada_en         timestamptz,
  creado_por         uuid DEFAULT auth.uid(),
  creado_por_nombre  text,
  creado_en          timestamptz NOT NULL DEFAULT now(),
  -- Una captura sin cifra no es una captura (S/D no se guarda como 0 ni como fila vacía).
  CONSTRAINT anot_captura_con_valor CHECK (tipo <> 'captura' OR almacenamiento_mm3 IS NOT NULL OR elevacion_msnm IS NOT NULL),
  CONSTRAINT anot_captura_con_origen CHECK (tipo <> 'captura' OR length(btrim(coalesce(origen, ''))) >= 3),
  CONSTRAINT anot_nota_con_comentario CHECK (tipo = 'captura' OR length(btrim(coalesce(comentario, ''))) >= 3),
  CONSTRAINT anot_fecha_no_futura CHECK (fecha <= ((creado_en AT TIME ZONE 'America/Chihuahua')::date + 1))
);

CREATE INDEX IF NOT EXISTS cuerpos_agua_anotaciones_cuerpo_fecha ON public.cuerpos_agua_anotaciones (cuerpo_id, fecha DESC) WHERE NOT anulada;

ALTER TABLE public.cuerpos_agua_anotaciones ENABLE ROW LEVEL SECURITY;

-- Lectura: solo usuarios con sesión (lleva el nombre del autor; el Monitor Público anónimo no la ve).
DROP POLICY IF EXISTS anot_select ON public.cuerpos_agua_anotaciones;
CREATE POLICY anot_select ON public.cuerpos_agua_anotaciones FOR SELECT TO authenticated USING (true);

-- Alta: SRL y ACU; el invitado es de solo lectura.
DROP POLICY IF EXISTS anot_insert ON public.cuerpos_agua_anotaciones;
CREATE POLICY anot_insert ON public.cuerpos_agua_anotaciones FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() = ANY (ARRAY['SRL', 'ACU']) AND NOT public.auth_es_invitado() AND creado_por = auth.uid());

-- Cambio: solo para anular; SRL cualquiera, ACU las propias.
DROP POLICY IF EXISTS anot_update ON public.cuerpos_agua_anotaciones;
CREATE POLICY anot_update ON public.cuerpos_agua_anotaciones FOR UPDATE TO authenticated
  USING (NOT public.auth_es_invitado() AND (public.auth_rol() = 'SRL' OR (public.auth_rol() = 'ACU' AND creado_por = auth.uid())))
  WITH CHECK (NOT public.auth_es_invitado() AND (public.auth_rol() = 'SRL' OR (public.auth_rol() = 'ACU' AND creado_por = auth.uid())));

REVOKE ALL ON public.cuerpos_agua_anotaciones FROM anon;
GRANT SELECT, INSERT ON public.cuerpos_agua_anotaciones TO authenticated;
-- Solo las columnas de anulación se pueden cambiar: la cifra y el comentario quedan como se capturaron.
GRANT UPDATE (anulada, anulada_en) ON public.cuerpos_agua_anotaciones TO authenticated;

COMMENT ON TABLE public.cuerpos_agua_anotaciones IS 'Cuenca del Conchos: captura manual de vasos sin telemetría, revisión de cierres y lecturas sospechosas. Capa aparte: no alimenta fn_cierre_mensual_recalcular.';
