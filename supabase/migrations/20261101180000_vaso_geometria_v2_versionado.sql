-- ═══════════════════════════════════════════════════════════════════════════
-- Manejo de vaso — método v2 de delimitación NDWI y versionado de escenas
-- Fecha: 2026-11-01
--
-- Auditoría (hidráulica + geomática + Playwright vaso-precision-bordes.mjs):
--  · Las escenas v1 se guardaban con la fecha "más reciente" del Catalog, pero
--    los píxeles venían de un mosaico leastCC de 30 días (20-ago y 09-sep:
--    98-100 % nublado en la fecha guardada) → fecha_escena ≠ píxeles.
--  · La validación curva↔NDWI emparejaba con la lectura de captura más cercana
--    a ±20 días (hasta 18 d de diferencia con el vaso moviéndose). Ahora se usa
--    el nivel DEL DÍA: presas_historico_diario (calidad OK) y, de respaldo,
--    lecturas_presas, a ±2 días.
--
-- Versionado: las filas v1 se conservan (vigente=false al reprocesar) para
-- poder comparar y revertir; solo las vigentes alimentan pantalla, alerta y
-- recalibración. Una escena vigente por presa y mes del ciclo.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.vaso_geometria_historico
  ADD COLUMN IF NOT EXISTS metodo text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS fecha_pixeles timestamptz,
  ADD COLUMN IF NOT EXISTS cobertura_nubes_vaso_pct numeric,
  ADD COLUMN IF NOT EXISTS vigente boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS parametros_metodo jsonb;

COMMENT ON COLUMN public.vaso_geometria_historico.metodo IS 'v1: NDWI McFeeters 20 m, umbral 0.2, mosaico leastCC 30 d, Chaikin. v2: NDWI∪MNDWI 10 m con Otsu, un solo día de píxeles, nubes SCL, conectividad 8, Douglas-Peucker.';
COMMENT ON COLUMN public.vaso_geometria_historico.fecha_pixeles IS 'Fecha real de adquisición de los píxeles analizados (v2: un único día). NULL en v1 (desconocida: mosaico de 30 días).';
COMMENT ON COLUMN public.vaso_geometria_historico.cobertura_nubes_vaso_pct IS '% de la huella del vaso sin dato válido (nube SCL 8/9/10 o sin cobertura) en la fecha de los píxeles. NULL = no medido (v1).';
COMMENT ON COLUMN public.vaso_geometria_historico.vigente IS 'Solo las filas vigentes alimentan la interfaz, la alerta de desviación y la recalibración.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vaso_geometria_metodo_chk') THEN
    ALTER TABLE public.vaso_geometria_historico
      ADD CONSTRAINT vaso_geometria_metodo_chk CHECK (metodo IN ('v1', 'v2'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vaso_geometria_historico_presa_id_fecha_escena_key') THEN
    ALTER TABLE public.vaso_geometria_historico
      DROP CONSTRAINT vaso_geometria_historico_presa_id_fecha_escena_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vaso_geometria_presa_fecha_metodo_key') THEN
    ALTER TABLE public.vaso_geometria_historico
      ADD CONSTRAINT vaso_geometria_presa_fecha_metodo_key UNIQUE (presa_id, fecha_escena, metodo);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_vaso_geometria_vigente
  ON public.vaso_geometria_historico (presa_id, fecha_escena) WHERE vigente;
CREATE INDEX IF NOT EXISTS idx_vaso_geometria_vigente_fecha
  ON public.vaso_geometria_historico (presa_id, fecha_escena DESC) WHERE vigente AND NOT es_referencia_historica;

-- ── Nivel del embalse en una fecha (±p_dias) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_nivel_presa_en_fecha(p_presa_id text, p_ts timestamptz, p_dias integer DEFAULT 2)
RETURNS TABLE (fecha date, escala_msnm numeric, fuente text, dias numeric)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH dia AS (SELECT (p_ts AT TIME ZONE 'America/Chihuahua')::date AS d),
  candidatas AS (
    SELECT h.fecha, h.escala_msnm::numeric, 'presas_historico_diario'::text AS fuente, 0 AS prioridad
    FROM public.presas_historico_diario h, dia
    WHERE h.presa_id = p_presa_id AND h.calidad = 'OK' AND h.escala_msnm IS NOT NULL
      AND abs(h.fecha - dia.d) <= p_dias
    UNION ALL
    SELECT l.fecha, l.escala_msnm::numeric, 'lecturas_presas', 1
    FROM public.lecturas_presas l, dia
    WHERE l.presa_id = p_presa_id AND l.escala_msnm IS NOT NULL
      AND abs(l.fecha - dia.d) <= p_dias
  )
  SELECT c.fecha, c.escala_msnm, c.fuente, abs(c.fecha - dia.d)::numeric
  FROM candidatas c, dia
  ORDER BY abs(c.fecha - dia.d), c.prioridad
  LIMIT 1;
$$;

-- ── Área de la curva oficial (km²) a una elevación; NULL fuera de rango ─────
CREATE OR REPLACE FUNCTION public.fn_area_curva_km2(p_presa_id text, p_elev numeric)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH inf AS (
    SELECT elevacion_msnm e, area_ha a FROM public.curvas_capacidad
    WHERE presa_id = p_presa_id AND area_ha IS NOT NULL AND elevacion_msnm <= p_elev
    ORDER BY elevacion_msnm DESC LIMIT 1
  ), sup AS (
    SELECT elevacion_msnm e, area_ha a FROM public.curvas_capacidad
    WHERE presa_id = p_presa_id AND area_ha IS NOT NULL AND elevacion_msnm >= p_elev
    ORDER BY elevacion_msnm ASC LIMIT 1
  )
  SELECT CASE
    WHEN inf.e IS NULL OR sup.e IS NULL THEN NULL
    WHEN inf.e = sup.e THEN inf.a / 100.0
    ELSE (inf.a + (p_elev - inf.e) / (sup.e - inf.e) * (sup.a - inf.a)) / 100.0
  END
  FROM inf FULL JOIN sup ON true;
$$;

-- ── Alerta de desviación: nivel del día, solo vigentes y sin nubes ──────────
CREATE OR REPLACE FUNCTION public.check_desviacion_vaso_ndwi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_dias        CONSTANT INTEGER := 2;     -- nivel del mismo día (±2)
    v_nubes_max   CONSTANT NUMERIC := 5.0;   -- escena con más nube sobre el vaso no se valida
    v_pct_aviso   CONSTANT NUMERIC := 90.0;  -- desvío > 10 % → warning (DESVIO_ATENCION_PCT)
    v_pct_critico CONSTANT NUMERIC := 80.0;  -- desvío > 20 % → critical (DESVIO_CRITICO_PCT)
    v_nombre_presa TEXT;
    v_coords JSONB;
    v_nivel RECORD;
    v_area_esperada_km2 NUMERIC;
    v_pct NUMERIC;
BEGIN
    IF NEW.es_referencia_historica OR NOT NEW.vigente THEN
        RETURN NEW;
    END IF;
    IF COALESCE(NEW.cobertura_nubes_vaso_pct, NEW.nubosidad_pct, 0) > v_nubes_max THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_nivel FROM public.fn_nivel_presa_en_fecha(NEW.presa_id, COALESCE(NEW.fecha_pixeles, NEW.fecha_escena), v_dias);
    IF v_nivel IS NULL OR v_nivel.escala_msnm IS NULL THEN
        RETURN NEW;
    END IF;

    v_area_esperada_km2 := public.fn_area_curva_km2(NEW.presa_id, v_nivel.escala_msnm);
    IF v_area_esperada_km2 IS NULL OR v_area_esperada_km2 <= 0 THEN
        RETURN NEW;
    END IF;

    v_pct := (NEW.area_km2 / v_area_esperada_km2) * 100.0;

    IF v_pct < v_pct_aviso THEN
        SELECT jsonb_build_object('lat', latitud, 'lng', longitud), nombre
        INTO v_coords, v_nombre_presa
        FROM public.presas WHERE id::text = NEW.presa_id;

        IF NOT EXISTS (
            SELECT 1 FROM public.registro_alertas
            WHERE origen_id = NEW.presa_id AND resuelta = false AND categoria = 'desviacion_batimetrica'
        ) THEN
            INSERT INTO public.registro_alertas (tipo_riesgo, categoria, titulo, mensaje, origen_id, coordenadas)
            VALUES (
                CASE WHEN v_pct < v_pct_critico THEN 'critical' ELSE 'warning' END,
                'desviacion_batimetrica',
                'Desviación: área satelital vs. curva batimétrica oficial',
                'El área del vaso medida por Sentinel-2 (' || ROUND(NEW.area_km2::numeric, 1) || ' km², píxeles del '
                    || to_char(COALESCE(NEW.fecha_pixeles, NEW.fecha_escena) AT TIME ZONE 'America/Chihuahua', 'DD/MM/YYYY')
                    || ', método ' || NEW.metodo || ') es ' || ROUND(v_pct::numeric, 0)
                    || '% del área de la curva oficial a la cota del día (' || ROUND(v_area_esperada_km2::numeric, 1)
                    || ' km² a ' || v_nivel.escala_msnm || ' msnm, ' || to_char(v_nivel.fecha, 'DD/MM/YYYY') || ', ' || v_nivel.fuente
                    || '). Revisar escena y, si persiste, solicitar verificación en sitio en '
                    || COALESCE(v_nombre_presa, NEW.presa_id) || '.',
                NEW.presa_id,
                v_coords
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_desviacion_vaso_ndwi ON public.vaso_geometria_historico;
CREATE TRIGGER trigger_desviacion_vaso_ndwi
  AFTER INSERT OR UPDATE OF area_km2, fecha_escena, vigente ON public.vaso_geometria_historico
  FOR EACH ROW
  WHEN (NEW.vigente AND NOT NEW.es_referencia_historica)
  EXECUTE FUNCTION public.check_desviacion_vaso_ndwi();

-- ── Recalibración por banda: nivel del día, solo vigentes y sin nubes ───────
CREATE OR REPLACE FUNCTION public.fn_recalibra_curva_batimetrica(p_presa_id text)
RETURNS TABLE(banda_elevacion_msnm numeric, factor_area numeric, n_observaciones integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN QUERY
    WITH observaciones AS (
        SELECT g.area_km2, n.escala_msnm,
               FLOOR(n.escala_msnm) AS banda,
               public.fn_area_curva_km2(p_presa_id, n.escala_msnm) AS area_oficial_km2
        FROM public.vaso_geometria_historico g
        JOIN LATERAL public.fn_nivel_presa_en_fecha(p_presa_id, COALESCE(g.fecha_pixeles, g.fecha_escena), 2) n ON true
        WHERE g.presa_id = p_presa_id
          AND g.vigente
          AND NOT g.es_referencia_historica
          AND COALESCE(g.cobertura_nubes_vaso_pct, g.nubosidad_pct, 0) <= 5
    )
    SELECT o.banda, AVG(o.area_km2 / o.area_oficial_km2), COUNT(*)::INTEGER
    FROM observaciones o
    WHERE o.area_oficial_km2 IS NOT NULL AND o.area_oficial_km2 > 0
    GROUP BY o.banda
    HAVING COUNT(*) >= 1;
END;
$function$;

-- ── Guardado transaccional de una escena (lo usa sentinel-ndwi-vaso-sync) ───
-- Una escena vigente por presa y mes: al guardar, las demás vigentes del mismo
-- mes (cualquier método) pasan a vigente=false; la fila nueva queda vigente.
CREATE OR REPLACE FUNCTION public.fn_vaso_geometria_guardar(p_fila jsonb)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
    r public.vaso_geometria_historico%ROWTYPE;
    v_id bigint;
BEGIN
    r := jsonb_populate_record(NULL::public.vaso_geometria_historico, p_fila);
    IF r.presa_id IS NULL OR r.fecha_escena IS NULL OR r.metodo IS NULL THEN
        RAISE EXCEPTION 'fila incompleta (presa_id, fecha_escena, metodo)';
    END IF;

    UPDATE public.vaso_geometria_historico g
       SET vigente = false
     WHERE g.presa_id = r.presa_id
       AND g.vigente
       AND g.es_referencia_historica = COALESCE(r.es_referencia_historica, false)
       AND NOT (g.fecha_escena = r.fecha_escena AND g.metodo = r.metodo)
       AND (
         (NOT COALESCE(r.es_referencia_historica, false)
           AND date_trunc('month', g.fecha_escena AT TIME ZONE 'America/Chihuahua') = date_trunc('month', r.fecha_escena AT TIME ZONE 'America/Chihuahua'))
         OR g.fecha_escena = r.fecha_escena
       );

    INSERT INTO public.vaso_geometria_historico (
        presa_id, fecha_escena, nubosidad_pct, area_km2, perimetro_km, num_islas, area_isla_mayor_km2,
        indice_compacidad, ratio_elongacion, delta_area_km2, delta_perimetro_km, pct_del_maximo_ciclo,
        resolucion_m, bbox, contorno_geojson, es_referencia_historica,
        metodo, fecha_pixeles, cobertura_nubes_vaso_pct, vigente, parametros_metodo)
    VALUES (
        r.presa_id, r.fecha_escena, r.nubosidad_pct, r.area_km2, r.perimetro_km, r.num_islas, r.area_isla_mayor_km2,
        r.indice_compacidad, r.ratio_elongacion, r.delta_area_km2, r.delta_perimetro_km, r.pct_del_maximo_ciclo,
        r.resolucion_m, r.bbox, r.contorno_geojson, COALESCE(r.es_referencia_historica, false),
        r.metodo, r.fecha_pixeles, r.cobertura_nubes_vaso_pct, true, r.parametros_metodo)
    ON CONFLICT (presa_id, fecha_escena, metodo) DO UPDATE SET
        nubosidad_pct = EXCLUDED.nubosidad_pct, area_km2 = EXCLUDED.area_km2, perimetro_km = EXCLUDED.perimetro_km,
        num_islas = EXCLUDED.num_islas, area_isla_mayor_km2 = EXCLUDED.area_isla_mayor_km2,
        indice_compacidad = EXCLUDED.indice_compacidad, ratio_elongacion = EXCLUDED.ratio_elongacion,
        delta_area_km2 = EXCLUDED.delta_area_km2, delta_perimetro_km = EXCLUDED.delta_perimetro_km,
        pct_del_maximo_ciclo = EXCLUDED.pct_del_maximo_ciclo, resolucion_m = EXCLUDED.resolucion_m,
        bbox = EXCLUDED.bbox, contorno_geojson = EXCLUDED.contorno_geojson,
        fecha_pixeles = EXCLUDED.fecha_pixeles, cobertura_nubes_vaso_pct = EXCLUDED.cobertura_nubes_vaso_pct,
        vigente = true, parametros_metodo = EXCLUDED.parametros_metodo
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_vaso_geometria_guardar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_vaso_geometria_guardar(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_nivel_presa_en_fecha(text, timestamptz, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_area_curva_km2(text, numeric) TO anon, authenticated;
