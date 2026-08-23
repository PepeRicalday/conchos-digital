-- ═══════════════════════════════════════════════════════════════════════════
-- MANEJO DE VASO — HISTÓRICO GEOMÉTRICO MENSUAL — SICA-005
-- Fecha: 2026-08-23
--
-- Persiste el resultado de sentinel-ndwi-vaso-sync: una fila por corrida
-- mensual por presa, con el polígono de agua ya vectorizado (marching squares
-- + tabla de Bourke, validado en sentinel-ndwi-vaso-test — 0 fragmentos
-- abiertos, 0 colisiones de ensamblado, resolución nativa 10m de Sentinel-2
-- B03/B08). Antes de esta tabla, el NDWI de PresaVasoMonitor.tsx se
-- recalculaba en el cliente cada vez que se abría el modal, sin histórico —
-- esta tabla es la que habilita la comparativa marzo→actual y la serie
-- mensual de área/perímetro.
--
-- Grano: una fila por (presa_id, fecha_escena) — NO por mes calendario. La
-- fecha de la escena real (resuelta vía Catalog API, ordenada por menor
-- nubosidad) puede no coincidir con el día 1 del mes en que corrió el cron;
-- guardar la fecha real, no la de ejecución, es lo que permite saber
-- "de qué día es esta medición" sin ambigüedad.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.vaso_geometria_historico (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    presa_id            TEXT NOT NULL,          -- 'PRE-001' — mismo patrón texto que lecturas_presas, no UUID
    fecha_escena        TIMESTAMPTZ NOT NULL,    -- fecha REAL de la imagen Sentinel-2 (Catalog API), no la del cron
    nubosidad_pct       NUMERIC,                 -- de la escena elegida — señal de confiabilidad del mes

    -- ── Geometría cruda ─────────────────────────────────────────────────────
    area_km2            NUMERIC NOT NULL,        -- agua neta: islas ya excluidas del conteo de píxeles
    perimetro_km        NUMERIC NOT NULL,        -- exterior + todos los anillos de isla, en metros reales proyectados
    num_islas           NUMERIC NOT NULL DEFAULT 0,
    area_isla_mayor_km2 NUMERIC,                 -- NULL si num_islas = 0

    -- ── KPI derivados (calculados en la Edge Function, no recalculados en cliente) ──
    -- Índice de compacidad isoperimétrica: 4π×área/perímetro². 1.0 = círculo
    -- perfecto (máxima eficiencia de forma), cae hacia 0 conforme el borde se
    -- vuelve más irregular/fragmentado. Es el estándar de morfometría de
    -- cuerpos de agua (Shape Index / Polsby-Popper) — permite distinguir
    -- "el vaso bajó parejo" (compacidad estable) de "el vaso se fragmentó en
    -- más islas al bajar de nivel" (compacidad cae aunque el área baje poco).
    indice_compacidad   NUMERIC,
    -- Lectura equivalente más intuitiva del mismo dato: cuántas veces más
    -- perímetro tiene el vaso respecto al círculo de su misma área
    -- (perímetro_real / perímetro_círculo_equivalente). 1.0 = tan compacto
    -- como un círculo; en un embalse dendrítico como La Boquilla ronda 7-8x
    -- — "el vaso tiene 7.8 veces más borde que si fuera compacto" se lee sin
    -- entrenamiento previo, a diferencia de indice_compacidad (0.0166).
    ratio_elongacion    NUMERIC,
    -- Variación respecto a la fila anterior de la MISMA presa (por fecha_escena
    -- ascendente) — evita que el frontend tenga que traer 2 filas y restar.
    delta_area_km2      NUMERIC,       -- área_actual - área_mes_anterior
    delta_perimetro_km  NUMERIC,
    -- % del área respecto al máximo histórico registrado para esta presa
    -- hasta la fecha de esta fila (inclusive) — normaliza para lectura rápida
    -- ("estamos al 78% del máximo visto este ciclo") sin exponer NAMO/curva
    -- de capacidad, que vive en otra tabla y puede no estar sincronizada.
    pct_del_maximo_ciclo NUMERIC,

    -- ── Procedencia técnica ──────────────────────────────────────────────────
    resolucion_m        INTEGER NOT NULL DEFAULT 10,
    bbox                NUMERIC[4],              -- [minLon, minLat, maxLon, maxLat] usado en esa corrida
    contorno_geojson    JSONB NOT NULL,           -- Polygon completo: [0]=exterior, [1..]=islas (RFC 7946)

    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Una fila por presa/escena: un reintento o corrida manual sobre la misma
    -- fecha de escena actualiza en vez de duplicar (mismo patrón de
    -- idempotencia que weatherlink-sync: upsert onConflict).
    UNIQUE (presa_id, fecha_escena)
);

COMMENT ON TABLE public.vaso_geometria_historico IS
  'Histórico mensual de área/perímetro/forma del vaso por presa, vía NDWI de Sentinel-2. Alimenta el comparador y la serie mensual de Manejo de Vaso en PresaVasoMonitor.tsx.';
COMMENT ON COLUMN public.vaso_geometria_historico.fecha_escena IS
  'Fecha real de la imagen satelital (Catalog API), NO la fecha en que corrió el cron mensual.';
COMMENT ON COLUMN public.vaso_geometria_historico.indice_compacidad IS
  '4π×área/perímetro² (Polsby-Popper). 1.0=círculo perfecto; cae con fragmentación/irregularidad del borde.';
COMMENT ON COLUMN public.vaso_geometria_historico.ratio_elongacion IS
  'perímetro_real / perímetro_de_un_círculo_de_igual_área. Lectura intuitiva del mismo dato que indice_compacidad — 1.0=compacto, sube con forma dendrítica/alargada.';
COMMENT ON COLUMN public.vaso_geometria_historico.area_km2 IS
  'Agua neta — píxeles de islas ya excluidos del conteo, no requiere restarlas en el cliente.';
COMMENT ON COLUMN public.vaso_geometria_historico.pct_del_maximo_ciclo IS
  'area_km2 / MAX(area_km2) histórico de esta presa hasta esta fecha inclusive — normaliza sin depender de NAMO/curva de capacidad.';

CREATE INDEX IF NOT EXISTS idx_vaso_geometria_presa_fecha
  ON public.vaso_geometria_historico (presa_id, fecha_escena DESC);

-- RLS: mismo patrón del proyecto — lectura pública, escritura autenticada
-- (la Edge Function usa service_role internamente, ver 20260808120000).
ALTER TABLE public.vaso_geometria_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Vaso Geometria Historico" ON public.vaso_geometria_historico;
CREATE POLICY "Public Read Vaso Geometria Historico" ON public.vaso_geometria_historico
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Vaso Geometria Historico" ON public.vaso_geometria_historico;
CREATE POLICY "Auth Write Vaso Geometria Historico" ON public.vaso_geometria_historico
  FOR ALL USING (true) WITH CHECK (true);
