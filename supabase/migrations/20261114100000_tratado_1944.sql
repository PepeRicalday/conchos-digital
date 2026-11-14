-- Tratado de Aguas de 1944 · avance del ciclo quinquenal (ciclo 37: 25-oct-2025 → 24-oct-2030).
-- Fuente EUA: USIBWC Water Data Portal (AQUARIUS), series públicas "Discharge Total.Preliminary-Daily-Volume-TCM"
-- de los seis afluentes mexicanos + corte semanal oficial (Current_Cycle.pdf). Fuente México: Sutron/Ojinaga (hidro_*)
-- y captura oficial CONAGUA/CILA (tratado_captura_mx). S/D = NULL, nunca 0.
-- Aplicar con autorización expresa (no usar db push).

CREATE TABLE IF NOT EXISTS public.tratado_ciclos (
  id               text PRIMARY KEY,
  nombre           text NOT NULL,
  inicio           date NOT NULL,
  fin              date NOT NULL,
  compromiso_af    numeric NOT NULL,            -- 350,000 AF/año × 5
  compromiso_anual_af numeric NOT NULL,
  deuda_previa_af  numeric,                     -- déficit con que cerró el ciclo anterior
  deuda_remanente_af numeric,                   -- deuda aún pendiente (último corte)
  nota             text
);

INSERT INTO public.tratado_ciclos (id, nombre, inicio, fin, compromiso_af, compromiso_anual_af, deuda_previa_af, deuda_remanente_af, nota)
VALUES ('C37', 'Ciclo 2025-2030', '2025-10-25', '2030-10-24', 1750000, 350000, 865139, 861980,
        'Ciclo anterior (25-oct-2020 → 24-oct-2025) cerrado con déficit de 865,139 AF según IBWC. Fecha de inicio oficial IBWC.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tratado_afluentes (
  clave          text PRIMARY KEY,
  nombre         text NOT NULL,
  estacion       text NOT NULL,
  dataset_titulo text NOT NULL,
  orden          smallint NOT NULL
);

INSERT INTO public.tratado_afluentes (clave, nombre, estacion, dataset_titulo, orden) VALUES
  ('conchos',   'Río Conchos',         '08373000', 'Discharge Total.Preliminary-Daily-Volume-TCM@08373000', 1),
  ('vacas',     'Arroyo Las Vacas',    '08452000', 'Discharge Total.Preliminary-Daily-Volume-TCM@08452000', 2),
  ('san_diego', 'Río San Diego',       '08455500', 'Discharge Total.Preliminary-Daily-Volume-TCM@08455500', 3),
  ('san_rodrigo','Río San Rodrigo',    '08457100', 'Discharge Total.Preliminary-Daily-Volume-TCM@08457100', 4),
  ('escondido', 'Río Escondido',       '08458150', 'Discharge Total.Preliminary-Daily-Volume-TCM@08458150', 5),
  ('salado',    'Río Salado',          '08-RSPC',  'Discharge Total.Preliminary-Daily-Volume-TCM@08-RSPC',  6)
ON CONFLICT (clave) DO NOTHING;

-- Volumen diario por afluente (miles de m³, TCM). Día = fecha del sello UTC-6 del portal.
CREATE TABLE IF NOT EXISTS public.tratado_entregas_diarias (
  afluente      text NOT NULL REFERENCES public.tratado_afluentes(clave),
  fecha         date NOT NULL,
  tcm           numeric CHECK (tcm >= 0),       -- NULL = S/D (hueco del portal)
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (afluente, fecha)
);
CREATE INDEX IF NOT EXISTS tratado_entregas_fecha ON public.tratado_entregas_diarias (fecha);

-- Corte semanal oficial del IBWC (leído de Current_Cycle.pdf). Una fila por fecha de corte.
CREATE TABLE IF NOT EXISTS public.tratado_cortes_oficiales (
  fecha_corte        date PRIMARY KEY,
  ciclo_id           text NOT NULL REFERENCES public.tratado_ciclos(id),
  acumulado_af       numeric NOT NULL,
  acumulado_mcm      numeric,
  deuda_remanente_af numeric,
  fuente             text NOT NULL DEFAULT 'IBWC Current_Cycle.pdf',
  capturado_en       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.tratado_cortes_oficiales (fecha_corte, ciclo_id, acumulado_af, acumulado_mcm, deuda_remanente_af, fuente)
VALUES ('2026-11-07', 'C37', 363679, 449, 861980, 'IBWC Current_Cycle.pdf (carga inicial)')
ON CONFLICT (fecha_corte) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tratado_sync_log (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  en        timestamptz NOT NULL DEFAULT now(),
  ok        boolean NOT NULL,
  filas     integer NOT NULL DEFAULT 0,
  corte     date,
  error     text,
  duracion_ms integer
);

-- Captura oficial CONAGUA/CILA (volumen entregado por periodo). Capa aparte, con autor; se anula, no se borra.
CREATE TABLE IF NOT EXISTS public.tratado_captura_mx (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ciclo_id          text NOT NULL REFERENCES public.tratado_ciclos(id) DEFAULT 'C37',
  periodo_desde     date NOT NULL,
  periodo_hasta     date NOT NULL,
  volumen_mm3       numeric NOT NULL CHECK (volumen_mm3 >= 0),
  fuente            text NOT NULL,
  comentario        text,
  anulada           boolean NOT NULL DEFAULT false,
  anulada_en        timestamptz,
  anulada_por       uuid,
  creado_por        uuid DEFAULT auth.uid(),
  creado_por_nombre text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tmx_periodo CHECK (periodo_hasta >= periodo_desde),
  CONSTRAINT tmx_fuente CHECK (length(btrim(fuente)) >= 3)
);

CREATE OR REPLACE FUNCTION public.fn_tratado_captura_mx_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.creado_por := auth.uid();
    NEW.creado_en := now();
    NEW.anulada := false; NEW.anulada_en := NULL; NEW.anulada_por := NULL;
    NEW.creado_por_nombre := (SELECT p.nombre FROM public.perfiles_usuario p WHERE p.id = auth.uid());
  ELSE
    IF OLD.anulada THEN RAISE EXCEPTION 'La captura ya está anulada' USING ERRCODE = '42501'; END IF;
    IF NOT NEW.anulada THEN RAISE EXCEPTION 'Una captura no se puede reactivar' USING ERRCODE = '42501'; END IF;
    NEW.anulada_en := now(); NEW.anulada_por := auth.uid();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_tratado_captura_mx_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_tratado_captura_mx_audit ON public.tratado_captura_mx;
CREATE TRIGGER trg_tratado_captura_mx_audit BEFORE INSERT OR UPDATE ON public.tratado_captura_mx
  FOR EACH ROW EXECUTE FUNCTION public.fn_tratado_captura_mx_audit();

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tratado_ciclos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tratado_afluentes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tratado_entregas_diarias  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tratado_cortes_oficiales  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tratado_sync_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tratado_captura_mx        ENABLE ROW LEVEL SECURITY;

-- Datos PÚBLICOS del IBWC (portal abierto): lectura también anónima, como el resto de las series AQWP del Monitor; la escritura es solo de
-- service_role vía la función. La captura de CONAGUA/CILA (autor, fuente) sí exige sesión.
DROP POLICY IF EXISTS tratado_ciclos_sel ON public.tratado_ciclos;
CREATE POLICY tratado_ciclos_sel ON public.tratado_ciclos FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS tratado_afluentes_sel ON public.tratado_afluentes;
CREATE POLICY tratado_afluentes_sel ON public.tratado_afluentes FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS tratado_entregas_sel ON public.tratado_entregas_diarias;
CREATE POLICY tratado_entregas_sel ON public.tratado_entregas_diarias FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS tratado_cortes_sel ON public.tratado_cortes_oficiales;
CREATE POLICY tratado_cortes_sel ON public.tratado_cortes_oficiales FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS tratado_log_sel ON public.tratado_sync_log;
CREATE POLICY tratado_log_sel ON public.tratado_sync_log FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS tratado_mx_select ON public.tratado_captura_mx;
CREATE POLICY tratado_mx_select ON public.tratado_captura_mx FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS tratado_mx_insert ON public.tratado_captura_mx;
CREATE POLICY tratado_mx_insert ON public.tratado_captura_mx FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() = ANY (ARRAY['SRL', 'ACU']) AND NOT public.auth_es_invitado());
DROP POLICY IF EXISTS tratado_mx_update ON public.tratado_captura_mx;
CREATE POLICY tratado_mx_update ON public.tratado_captura_mx FOR UPDATE TO authenticated
  USING (NOT public.auth_es_invitado() AND (public.auth_rol() = 'SRL' OR (public.auth_rol() = 'ACU' AND creado_por = auth.uid())))
  WITH CHECK (NOT public.auth_es_invitado() AND (public.auth_rol() = 'SRL' OR (public.auth_rol() = 'ACU' AND creado_por = auth.uid())));

REVOKE ALL ON public.tratado_ciclos, public.tratado_afluentes, public.tratado_entregas_diarias,
              public.tratado_cortes_oficiales, public.tratado_sync_log, public.tratado_captura_mx FROM anon;
GRANT SELECT ON public.tratado_ciclos, public.tratado_afluentes, public.tratado_entregas_diarias,
                public.tratado_cortes_oficiales, public.tratado_sync_log TO anon, authenticated;
GRANT SELECT ON public.tratado_captura_mx TO authenticated;
GRANT INSERT (ciclo_id, periodo_desde, periodo_hasta, volumen_mm3, fuente, comentario) ON public.tratado_captura_mx TO authenticated;
GRANT UPDATE (anulada) ON public.tratado_captura_mx TO authenticated;

COMMENT ON TABLE public.tratado_entregas_diarias IS 'Tratado 1944: volumen diario (TCM) de los seis afluentes, USIBWC Water Data (provisional). NULL = S/D.';
COMMENT ON TABLE public.tratado_cortes_oficiales IS 'Tratado 1944: acumulado oficial del ciclo según el corte semanal del IBWC (Current_Cycle.pdf).';
COMMENT ON TABLE public.tratado_captura_mx IS 'Tratado 1944: cifras oficiales mexicanas (CONAGUA/CILA) capturadas a mano para conciliar con IBWC.';

-- ── Cron: sincronización automática ───────────────────────────────────────────────────────────────────
-- El IBWC actualiza el corte semanal (Current_Cycle.pdf) y los volúmenes diarios cada día. 3 corridas al día.
INSERT INTO public.cron_secretos (nombre, valor)
VALUES ('tratado_sync', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
ON CONFLICT (nombre) DO NOTHING;

SELECT cron.unschedule(j) FROM unnest(ARRAY['tratado-sync-1','tratado-sync-2','tratado-sync-3']) AS j
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = j);

SELECT cron.schedule(n, h, format($f$
  SELECT net.http_post(
    url     := 'https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/tratado-sync',
    headers := jsonb_build_object('Content-Type','application/json',
               'x-cron-secret', (SELECT valor FROM public.cron_secretos WHERE nombre = 'tratado_sync')),
    body    := %L::jsonb,
    timeout_milliseconds := 140000
  );$f$, b))
FROM (VALUES
  ('tratado-sync-1', '40 14 * * *', '{"dias":45}'),
  ('tratado-sync-2', '40 19 * * *', '{"dias":45}'),
  ('tratado-sync-3', '40 1 * * *',  '{"dias":45}')
) AS t(n, h, b);
