-- ═══════════════════════════════════════════════════════════════════════════
-- Manejo de vaso — umbral de desviación satélite vs. curva: 10/20 % → 15/25 %
-- Fecha: 2026-11-01
--
-- Las 7 escenas v2 (10 m) de 2026 con nivel del día miden 83-95 % del área de la
-- curva 2020 (media −11.6 % ± 4): sesgo sistemático del píxel en la orilla somera
-- y la cola con vegetación, no azolve. Con aviso < 90 % la alerta se dispararía cada
-- mes sin información nueva. Mismos valores que src/utils/vasoUmbrales.ts.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_desviacion_vaso_ndwi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_dias        CONSTANT INTEGER := 2;     -- nivel del mismo día (±2)
    v_nubes_max   CONSTANT NUMERIC := 5.0;   -- escena con más nube sobre el vaso no se valida
    v_pct_aviso   CONSTANT NUMERIC := 85.0;  -- desvío > 15 % → warning (DESVIO_ATENCION_PCT)
    v_pct_critico CONSTANT NUMERIC := 75.0;  -- desvío > 25 % → critical (DESVIO_CRITICO_PCT)
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

