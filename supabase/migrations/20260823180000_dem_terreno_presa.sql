-- ═══════════════════════════════════════════════════════════════════════════
-- DEM DE TERRENO — relieve real alrededor de la cortina (Copernicus GLO-30)
-- Fecha: 2026-08-23
--
-- Persiste el resultado de dem-boquilla-sync: una grilla de elevaciones
-- (metros sobre el nivel del mar) del terreno alrededor de la cortina de la
-- presa, traída de Copernicus DEM vía OpenTopography. Complementa a
-- VasoVisor3D.tsx, que ya aproxima la profundidad del FONDO del vaso desde
-- curvas_capacidad — este DEM cubre el relieve de las LADERAS que rodean la
-- cortina, dato que la curva batimétrica (que solo describe el cuerpo de
-- agua) no tiene.
--
-- Grano: una fila por presa (no por fecha) — a diferencia de
-- vaso_geometria_historico (que cambia mes a mes con el nivel del agua), el
-- terreno sólido no cambia; no hace falta historial, solo la versión más
-- reciente. Re-sincronizar sobrescribe (upsert onConflict presa_id).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dem_terreno_presa (
    presa_id              TEXT PRIMARY KEY,
    fuente                TEXT NOT NULL,          -- 'Copernicus DEM GLO-30 (OpenTopography)'
    resolucion_m_nativa   INTEGER NOT NULL,        -- 30 (antes de downsample al guardar)
    bbox                  NUMERIC[4] NOT NULL,     -- [west, south, east, north]
    ncols                 INTEGER NOT NULL,
    nrows                 INTEGER NOT NULL,
    grid_elevaciones_msnm JSONB NOT NULL,           -- number[nrows][ncols], NaN → null en JSON
    actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dem_terreno_presa IS
  'Grilla de elevación de terreno (Copernicus DEM GLO-30) alrededor de la cortina de la presa, para el relieve de laderas en VasoVisor3D.tsx. No es el fondo del vaso (eso lo aproxima curvas_capacidad) — es el terreno sólido circundante.';
COMMENT ON COLUMN public.dem_terreno_presa.grid_elevaciones_msnm IS
  'Matriz [nrows][ncols] de elevación en msnm, fila 0 = borde norte del bbox, columna 0 = borde oeste. Celdas sin dato (NODATA del raster origen) llegan como null.';

ALTER TABLE public.dem_terreno_presa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read DEM Terreno" ON public.dem_terreno_presa;
CREATE POLICY "Public Read DEM Terreno" ON public.dem_terreno_presa
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write DEM Terreno" ON public.dem_terreno_presa;
CREATE POLICY "Auth Write DEM Terreno" ON public.dem_terreno_presa
  FOR ALL USING (true) WITH CHECK (true);

-- ── Verificación ────────────────────────────────────────────────────────────
-- Invocar la sincronización (requiere OPENTOPOGRAPHY_API_KEY configurada en
-- las variables de entorno de la Edge Function):
--   curl -X POST https://dumfyrgwnshcgeibffvr.supabase.co/functions/v1/dem-boquilla-sync \
--        -H "Authorization: Bearer <anon key>" -H "Content-Type: application/json" \
--        -d '{"presa_id":"PRE-001"}'
-- Ver metadatos guardados (sin traer la grilla completa):
--   SELECT presa_id, fuente, resolucion_m_nativa, ncols, nrows, actualizado_en
--   FROM dem_terreno_presa WHERE presa_id = 'PRE-001';
