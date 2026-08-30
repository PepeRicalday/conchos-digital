-- ═══════════════════════════════════════════════════════════════════════════
-- NDVI MENSUAL POR MÓDULO — HISTÓRICO — SICA-005
-- Fecha: 2026-08-30
--
-- Persiste el resultado de sentinel-ndvi-modulo-sync: una fila por módulo SRL
-- por ventana mensual, calculada con el POLÍGONO EXACTO del módulo (no el
-- bbox rectangular que usa el NDVI puntual bajo-demanda de
-- sentinel-ndvi-modulo / consultarNdviModulo en GeoMonitor.tsx) vía la
-- Statistical API de Sentinel Hub. Antes de esta tabla, el NDVI por módulo
-- solo existía como consulta puntual sin memoria — cada clic en el mapa volvía
-- a pagar la consulta y no había forma de ver la evolución mes a mes del
-- vigor vegetativo. Esta tabla habilita esa serie histórica comparativa entre
-- los 6 módulos SRL (NdviModulosPanel.tsx).
--
-- Grano: una fila por (numero_modulo, mes calendario) — NO por fecha de
-- escena real como vaso_geometria_historico. A diferencia del NDWI del vaso
-- (una sola imagen vectorizada por corrida), el NDVI aquí es un AGREGADO de
-- la Statistical API sobre múltiples escenas Sentinel-2 dentro de una
-- ventana de 30 días (aggregationInterval P30D) — no hay una única fecha de
-- captura que anclar, así que se guarda la ventana (ventana_desde/hasta) y el
-- mes calendario de la corrida (backfill manual o cron), que es lo que se usa
-- para la unicidad de la fila.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ndvi_modulo_historico (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero_modulo       INTEGER NOT NULL,        -- número de Módulo SRL real (1,2,3,4,5,12) — NO modulos.id (que es TEXT 'MOD-001')
    nombre_modulo       TEXT NOT NULL,            -- 'Módulo 2' — redundante pero evita un join para listados/gráficos
    mes                 TEXT NOT NULL,            -- 'YYYY-MM', mes calendario de la corrida (backfill o cron), usado para UNIQUE
    ventana_desde       TIMESTAMPTZ NOT NULL,     -- inicio real de la ventana de agregación devuelta por la Statistical API
    ventana_hasta       TIMESTAMPTZ NOT NULL,     -- fin real de esa ventana

    -- ── Estadísticas NDVI (Statistical API, agregado del polígono exacto) ───
    ndvi_medio          NUMERIC NOT NULL,
    ndvi_min            NUMERIC,
    ndvi_max            NUMERIC,
    ndvi_desv           NUMERIC,
    muestras_validas    INTEGER,                 -- sampleCount del intervalo — señal de confiabilidad del mes
    nubosidad_max_pct   INTEGER NOT NULL DEFAULT 40, -- maxCloudCoverage usado como filtro en esa corrida

    -- ── Derivados calculados en la Edge Function (no recalculados en cliente) ──
    superficie_ha       NUMERIC,                 -- área real del polígono exacto (shoelace), no del bbox
    kc_estimado         NUMERIC,                 -- misma fórmula lineal NDVI→Kc de src/utils/kcNdvi.ts (ndviAKc), duplicada server-side
    delta_ndvi          NUMERIC,                 -- ndvi_medio de este mes − ndvi_medio del mes calendario anterior con dato, mismo módulo

    fuente_geometria    TEXT NOT NULL DEFAULT 'poligono_exacto', -- distingue de futuras filas que pudieran venir de bbox
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Una fila por módulo/mes: un reintento o corrida manual sobre el mismo
    -- mes actualiza en vez de duplicar (mismo patrón de idempotencia que
    -- weatherlink-sync / sentinel-ndwi-vaso-sync).
    UNIQUE (numero_modulo, mes)
);

COMMENT ON TABLE public.ndvi_modulo_historico IS
  'Histórico mensual de NDVI (vigor vegetativo) por módulo de riego SRL, calculado con el polígono exacto del módulo vía Statistical API de Sentinel Hub. Alimenta NdviModulosPanel.tsx en GEO-MONITOR.';
COMMENT ON COLUMN public.ndvi_modulo_historico.numero_modulo IS
  'Número de Módulo SRL real (1,2,3,4,5,12), NO modulos.id de Supabase (TEXT tipo MOD-001). Mismo criterio de clave que MODULOS_BBOX en src/utils/modulosBbox.ts.';
COMMENT ON COLUMN public.ndvi_modulo_historico.mes IS
  'Mes calendario (YYYY-MM) de la corrida — backfill manual o cron. La ventana real de escenas agregadas es ventana_desde/ventana_hasta, que puede no alinearse exactamente al mes calendario cuando la corrida usa "últimos 30 días" en vez de mes explícito.';
COMMENT ON COLUMN public.ndvi_modulo_historico.kc_estimado IS
  'Kc ≈ clamp(0.15 + 1.10·ndvi_medio, 0.15, 1.05) — misma fórmula que ndviAKc() en src/utils/kcNdvi.ts, duplicada server-side para que la fila histórica sea autocontenida. Si se ajusta la fórmula, actualizar ambos lugares.';
COMMENT ON COLUMN public.ndvi_modulo_historico.delta_ndvi IS
  'Variación respecto al mes calendario anterior CON DATO del mismo módulo (no necesariamente el mes inmediato si hubo un hueco sin escena utilizable) — evita que el frontend traiga 2 filas y reste.';

CREATE INDEX IF NOT EXISTS idx_ndvi_modulo_historico_modulo_mes
  ON public.ndvi_modulo_historico (numero_modulo, mes DESC);

-- RLS: mismo patrón del proyecto — lectura pública, escritura autenticada
-- (la Edge Function usa service_role internamente, ver sentinel-ndvi-modulo-sync).
ALTER TABLE public.ndvi_modulo_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Ndvi Modulo Historico" ON public.ndvi_modulo_historico;
CREATE POLICY "Public Read Ndvi Modulo Historico" ON public.ndvi_modulo_historico
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Auth Write Ndvi Modulo Historico" ON public.ndvi_modulo_historico;
CREATE POLICY "Auth Write Ndvi Modulo Historico" ON public.ndvi_modulo_historico
  FOR ALL USING (true) WITH CHECK (true);
