-- ═══════════════════════════════════════════════════════════════════════════
-- TEXTURA SATELITAL DEL TERRENO — Sentinel-2 TRUE_COLOR sobre el bbox del DEM
-- Fecha: 2026-08-23
--
-- Persiste el resultado de sentinel-truecolor-terreno-sync: una imagen de
-- color natural (Sentinel-2 TRUE_COLOR) recortada al MISMO bbox que
-- dem_terreno_presa, subida a Supabase Storage (bucket 'dem-texturas') — el
-- binario de imagen vive en Storage, no en la base de datos; esta tabla solo
-- guarda la URL pública y metadatos de procedencia.
--
-- Consumida por VasoVisor3D.tsx para "vestir" TerrenoMesh con textura
-- satelital real en vez de solo color por elevación/pendiente (hillshade) —
-- mismo principio visual que el "drape" de imagen sobre relieve de Google
-- Earth, con la fuente satelital que el proyecto ya usa para NDWI/NDVI.
--
-- Grano: una fila por presa (igual que dem_terreno_presa) — re-sincronizar
-- sobrescribe la fila y sube un nuevo archivo a Storage.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('dem-texturas', 'dem-texturas', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public Read Dem Texturas" ON storage.objects;
CREATE POLICY "Public Read Dem Texturas" ON storage.objects
  FOR SELECT USING (bucket_id = 'dem-texturas');
DROP POLICY IF EXISTS "Service Write Dem Texturas" ON storage.objects;
CREATE POLICY "Service Write Dem Texturas" ON storage.objects
  FOR ALL USING (bucket_id = 'dem-texturas') WITH CHECK (bucket_id = 'dem-texturas');

CREATE TABLE IF NOT EXISTS public.textura_satelital_terreno (
    presa_id        TEXT PRIMARY KEY,
    fuente          TEXT NOT NULL,          -- 'Sentinel-2 TRUE_COLOR (Sentinel Hub)'
    fecha_escena    TIMESTAMPTZ,             -- fecha real de la escena (Catalog API), NULL si no se pudo resolver
    nubosidad_pct   NUMERIC,
    bbox            NUMERIC[4] NOT NULL,     -- [west, south, east, north] — MISMO bbox que dem_terreno_presa
    ancho_px        INTEGER NOT NULL,
    alto_px         INTEGER NOT NULL,
    url_storage     TEXT NOT NULL,           -- ruta dentro del bucket 'dem-texturas'
    url_publica     TEXT NOT NULL,           -- URL pública completa, lista para <img>/textura Three.js
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.textura_satelital_terreno IS
  'Imagen de color natural (Sentinel-2 TRUE_COLOR) recortada al bbox de dem_terreno_presa, subida a Storage. Usada por VasoVisor3D.tsx para texturizar el terreno 3D con imagen satelital real en vez de solo color por elevación.';

ALTER TABLE public.textura_satelital_terreno ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Textura Satelital" ON public.textura_satelital_terreno;
CREATE POLICY "Public Read Textura Satelital" ON public.textura_satelital_terreno
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Textura Satelital" ON public.textura_satelital_terreno;
CREATE POLICY "Auth Write Textura Satelital" ON public.textura_satelital_terreno
  FOR ALL USING (true) WITH CHECK (true);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Invocar la sincronización:
--   curl -X POST https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/sentinel-truecolor-terreno-sync \
--        -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" -d '{"presa_id":"PRE-001"}'
-- Ver metadatos guardados:
--   SELECT presa_id, fecha_escena, nubosidad_pct, ancho_px, alto_px, url_publica
--   FROM textura_satelital_terreno WHERE presa_id = 'PRE-001';
