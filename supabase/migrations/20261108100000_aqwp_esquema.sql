-- ═══════════════════════════════════════════════════════════════════════════
-- AQWP — USIBWC AQUARIUS Web Portal (https://waterdata.ibwc.gov/AQWebportal/)
-- Fecha: 2026-11-08
--
-- Contexto de CUENCA del Conchos (presas CONAGUA de Chihuahua + aforo Ojinaga). Aislado de
-- presas / lecturas_presas / lecturas_presas_cila: AQWP es fuente TERCERA, solo lectura y
-- cruce de calidad. Nunca sobrescribe captura de campo ni CILA.
-- Regla S/D: valor ausente = NULL, jamás 0. 'estancada' marca series con el mismo valor
-- varios días mientras hay flujo (la UI debe mostrar S/D, no el valor repetido).
-- Cargada por la Edge Function aqwp-sync (service_role omite RLS).
-- Ojo zona horaria: el export usa UTC-6 FIJO; 'fecha' es el día del sello tal cual.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.aqwp_ubicaciones (
  id_number  integer PRIMARY KEY,             -- IDNumber del portal (GetDropDownAll)
  codigo     text    NOT NULL UNIQUE,         -- p. ej. 08-LBQCH-CONAGUA, 08373000
  nombre     text    NOT NULL,
  tipo       text    NOT NULL CHECK (tipo IN ('presa', 'aforo', 'precipitacion')),
  presa_id   text,                            -- enlace a presas.id si es operativa del distrito (PRE-001/002)
  activa     boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.aqwp_datasets (
  id_number    integer PRIMARY KEY,           -- IDNumber del dataset
  ubicacion_id integer NOT NULL REFERENCES public.aqwp_ubicaciones (id_number) ON DELETE CASCADE,
  titulo       text    NOT NULL,              -- Title EXACTO que exige el export ("Total Storage.…@…")
  magnitud     text    NOT NULL,              -- almacenamiento, aportacion, extraccion, vertido, …
  unidad       text    NOT NULL,
  desde        date,                          -- inicio del registro en el portal
  sincronizar  boolean NOT NULL DEFAULT true,
  ult_fecha    date,                          -- último día cargado
  ult_sync_en  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_aqwp_datasets_ubic ON public.aqwp_datasets (ubicacion_id, magnitud);

CREATE TABLE IF NOT EXISTS public.aqwp_lecturas_diarias (
  dataset_id   integer     NOT NULL REFERENCES public.aqwp_datasets (id_number) ON DELETE CASCADE,
  fecha        date        NOT NULL,
  valor        numeric,                       -- NULL = S/D (nunca 0)
  estancada    boolean     NOT NULL DEFAULT false,
  ingestado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_aqwp_lecturas_fecha ON public.aqwp_lecturas_diarias (fecha DESC);

CREATE TABLE IF NOT EXISTS public.aqwp_sync_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inicio       timestamptz NOT NULL DEFAULT now(),
  modo         text        NOT NULL,          -- tabla | export | catalogo
  ok           boolean     NOT NULL,
  datasets     integer     NOT NULL DEFAULT 0,
  filas        integer     NOT NULL DEFAULT 0,
  estancadas   integer     NOT NULL DEFAULT 0,
  error        text,
  duracion_ms  integer
);

ALTER TABLE public.aqwp_ubicaciones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aqwp_datasets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aqwp_lecturas_diarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aqwp_sync_log        ENABLE ROW LEVEL SECURITY;

-- Lectura pública (mismo criterio que lecturas_presas_cila). Escritura solo service_role.
DROP POLICY IF EXISTS "Public Read AQWP ubicaciones" ON public.aqwp_ubicaciones;
CREATE POLICY "Public Read AQWP ubicaciones" ON public.aqwp_ubicaciones FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public Read AQWP datasets" ON public.aqwp_datasets;
CREATE POLICY "Public Read AQWP datasets" ON public.aqwp_datasets FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public Read AQWP lecturas" ON public.aqwp_lecturas_diarias;
CREATE POLICY "Public Read AQWP lecturas" ON public.aqwp_lecturas_diarias FOR SELECT USING (true);
-- aqwp_sync_log: sin política = solo service_role.

-- Último valor por ubicación y magnitud (solo días con dato; 'fecha' deja ver si lleva atraso).
CREATE OR REPLACE VIEW public.v_aqwp_presas_estado WITH (security_invoker = true) AS
WITH ult AS (
  SELECT DISTINCT ON (d.ubicacion_id, d.magnitud)
         d.ubicacion_id, d.magnitud, l.fecha, l.valor, l.estancada
  FROM public.aqwp_lecturas_diarias l
  JOIN public.aqwp_datasets d ON d.id_number = l.dataset_id
  WHERE l.valor IS NOT NULL
  ORDER BY d.ubicacion_id, d.magnitud, l.fecha DESC
)
SELECT u.id_number AS ubicacion_id, u.codigo, u.nombre, u.tipo, u.presa_id,
       max(ult.fecha) FILTER (WHERE ult.magnitud = 'almacenamiento')           AS fecha,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'almacenamiento')           AS almacenamiento_mm3,
       bool_or(ult.estancada) FILTER (WHERE ult.magnitud = 'almacenamiento')   AS almacenamiento_estancado,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'namo')                     AS namo_mm3,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'almacenamiento_muerto')    AS muerto_mm3,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'pct_namo')                 AS pct_namo,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'aportacion')               AS aportacion_m3s,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'extraccion_total')         AS extraccion_total_m3s,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'vertido')                  AS vertido_m3s,
       max(ult.valor) FILTER (WHERE ult.magnitud = 'gasto')                    AS gasto_m3s
FROM public.aqwp_ubicaciones u
LEFT JOIN ult ON ult.ubicacion_id = u.id_number
WHERE u.activa
GROUP BY u.id_number, u.codigo, u.nombre, u.tipo, u.presa_id;

-- Cruce AQWP vs CILA (solo Boquilla/Madero). Diferencia relativa sobre el almacenamiento CILA.
CREATE OR REPLACE VIEW public.v_aqwp_vs_cila WITH (security_invoker = true) AS
SELECT u.presa_id, l.fecha,
       l.valor AS aqwp_mm3, c.almacenamiento_mm3 AS cila_mm3,
       round((l.valor - c.almacenamiento_mm3)::numeric, 3) AS dif_mm3,
       CASE WHEN c.almacenamiento_mm3 > 0
            THEN round(((l.valor - c.almacenamiento_mm3) / c.almacenamiento_mm3 * 100)::numeric, 2) END AS dif_pct
FROM public.aqwp_lecturas_diarias l
JOIN public.aqwp_datasets d ON d.id_number = l.dataset_id AND d.magnitud = 'almacenamiento'
JOIN public.aqwp_ubicaciones u ON u.id_number = d.ubicacion_id AND u.presa_id IS NOT NULL
JOIN public.lecturas_presas_cila c ON c.presa_id = u.presa_id AND c.fecha = l.fecha
WHERE l.valor IS NOT NULL AND c.almacenamiento_mm3 IS NOT NULL;

COMMENT ON TABLE public.aqwp_lecturas_diarias IS
  'Series diarias CONAGUA/USIBWC vía AQUARIUS Web Portal. Dato provisional sujeto a revisión; contexto de cuenca, no operativo.';
