-- NDVI mensual por módulo, metodología homogénea (SCL + mediana) para serie
-- interanual marzo 2021 → hoy. NO reemplaza ndvi_modulo_historico (serie v1,
-- sigue alimentando el panel actual hasta validar la v2).
-- Un mes sin píxeles válidos se guarda con ndvi_* = NULL (hueco explícito),
-- nunca con 0.

CREATE TABLE IF NOT EXISTS public.ndvi_modulo_mensual_v2 (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero_modulo             int  NOT NULL,
  nombre_modulo             text NOT NULL,
  mes                       text NOT NULL CHECK (mes ~ '^\d{4}-\d{2}$'),
  metodo                    text NOT NULL DEFAULT 'scl-mediana-v1',
  ventana_desde             timestamptz NOT NULL,
  ventana_hasta             timestamptz NOT NULL,
  ndvi_mediana              numeric(6,4),
  ndvi_medio                numeric(6,4),
  ndvi_min                  numeric(6,4),
  ndvi_max                  numeric(6,4),
  ndvi_desv                 numeric(6,4),
  ndvi_p10                  numeric(6,4),
  ndvi_p90                  numeric(6,4),
  fraccion_cobertura_activa numeric(6,4),
  muestras_validas          int,
  pct_pixeles_validos       numeric(6,4),
  n_escenas                 int,
  obs_media_pixel           numeric(6,2),
  nubosidad_max_pct         int,
  resolucion_m              int,
  superficie_ha             numeric(10,2),
  kc_estimado               numeric(4,2),
  proveedor                 text,
  fuente_geometria          text NOT NULL DEFAULT 'poligono_exacto',
  creado_en                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (numero_modulo, mes, metodo)
);

CREATE INDEX IF NOT EXISTS idx_ndvi_v2_modulo_mes ON public.ndvi_modulo_mensual_v2 (numero_modulo, mes);

ALTER TABLE public.ndvi_modulo_mensual_v2 ENABLE ROW LEVEL SECURITY;

-- Lectura pública (mismo criterio que ndvi_modulo_historico); escritura solo
-- service_role (que ignora RLS), sin política de escritura.
DROP POLICY IF EXISTS "ndvi_v2_lectura_publica" ON public.ndvi_modulo_mensual_v2;
CREATE POLICY "ndvi_v2_lectura_publica" ON public.ndvi_modulo_mensual_v2 FOR SELECT USING (true);

-- delta vs. mes anterior CON DATO del mismo módulo y método (no depende del
-- orden de carga).
CREATE OR REPLACE VIEW public.ndvi_modulo_mensual_v2_delta
WITH (security_invoker = true) AS
SELECT t.*,
       (t.ndvi_mediana - (
         SELECT p.ndvi_mediana FROM public.ndvi_modulo_mensual_v2 p
         WHERE p.numero_modulo = t.numero_modulo AND p.metodo = t.metodo
           AND p.mes < t.mes AND p.ndvi_mediana IS NOT NULL
         ORDER BY p.mes DESC LIMIT 1
       ))::numeric(6,4) AS delta_ndvi
FROM public.ndvi_modulo_mensual_v2 t;
