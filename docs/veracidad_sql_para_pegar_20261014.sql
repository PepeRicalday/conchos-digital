-- Veracidad: S/D en vez de datos inventados (auditoría 2026-10-14).
-- Corrige las definiciones VIVAS (leídas con pg_get_functiondef el 2026-10-14), solo estos cambios:
--  1) fn_trg_calcular_gasto_escala: escala con compuertas + apertura no reportada => gasto NULL (antes: Manning con apertura 0).
--  2) fn_verificar_escala_km: sin 50.0 m³/s inventados, entrada solo de PRE-001, y S/D si no hay entrada.
-- Pegar en el editor SQL de Supabase (NO db push). Firmas sin cambios: no rompe dependencias.

CREATE OR REPLACE FUNCTION public.fn_trg_calcular_gasto_escala()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Solo calcular si no fue ingresado manualmente
  IF NEW.gasto_calculado_m3s IS NULL OR NEW.gasto_calculado_m3s = 0 THEN
    -- Compuertas capturadas y TODAS cerradas => gasto 0 real (no recalcular por nivel,
    -- que supone descarga libre y fabrica caudal fantasma en represas cerradas).
    IF NEW.radiales_json IS NOT NULL
       AND jsonb_typeof(NEW.radiales_json) = 'array'
       AND jsonb_array_length(NEW.radiales_json) > 0
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(NEW.radiales_json) x
         WHERE COALESCE((x->>'apertura_m')::numeric, 0) > 0
       )
       AND COALESCE(NEW.confirmada, false) = true
    THEN
      NEW.gasto_calculado_m3s := 0;
    ELSIF NEW.apertura_radiales_m IS NULL
       AND (NEW.radiales_json IS NULL
            OR jsonb_typeof(NEW.radiales_json) <> 'array'
            OR jsonb_array_length(NEW.radiales_json) = 0)
       AND EXISTS (SELECT 1 FROM public.escalas e
                   WHERE e.id = NEW.escala_id AND COALESCE(e.pzas_radiales, 0) > 0)
    THEN
      -- Escala CON compuertas y apertura NO reportada: el gasto es desconocido (NULL, S/D).
      -- Antes se tomaba "apertura 0" y se calculaba por Manning, fabricando un caudal.
      NEW.gasto_calculado_m3s := NULL;
    ELSE
      NEW.gasto_calculado_m3s := public.fn_calcular_gasto_escala(
        NEW.escala_id
        , NEW.nivel_m
        , COALESCE(NEW.apertura_radiales_m, 0)
        , 0 -- h2: se asume descarga libre si no hay dato aguas abajo
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_verificar_escala_km(p_km numeric, p_nivel_m numeric, p_fecha date DEFAULT NULL::date)
 RETURNS TABLE(escala_id text, escala_nombre text, km numeric, nivel_leido_m numeric, q_desde_lectura_m3s numeric, q_balance_m3s numeric, diferencia_m3s numeric, diferencia_pct numeric, diagnostico text, b_m numeric, z_talud numeric, n_manning numeric, pendiente_s0 numeric)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    v_esc_id         TEXT;
    v_esc_nombre     TEXT;
    v_esc_km         NUMERIC;
    v_perf           RECORD;
    v_q_lectura      NUMERIC;
    v_q_balance      NUMERIC;
    v_dif            NUMERIC;
    v_q_entrada      NUMERIC;
    v_q_extraido     NUMERIC;
    v_nivel_max      NUMERIC;
    v_tirante_diseno NUMERIC;
    v_bordo_libre    NUMERIC;
BEGIN
    IF p_fecha IS NULL THEN
        p_fecha := (NOW() AT TIME ZONE 'America/Chihuahua')::date;
    END IF;
    -- Buscar escala más cercana al km indicado (incluir límites operativos)
    SELECT e.id, e.nombre, e.km,
           e.nivel_max_operativo,
           phc.tirante_diseno_m,
           phc.bordo_libre_m
    INTO v_esc_id, v_esc_nombre, v_esc_km,
         v_nivel_max, v_tirante_diseno, v_bordo_libre
    FROM public.escalas e
    LEFT JOIN public.perfil_hidraulico_canal phc
           ON p_km >= phc.km_inicio AND p_km < phc.km_fin
    WHERE ABS(e.km - p_km) < 2.0
      AND e.activa = true
    ORDER BY ABS(e.km - p_km) ASC
    LIMIT 1;

    -- Geometría del tramo
    SELECT phc.plantilla_m, phc.talud_z,
           COALESCE(phc.rugosidad_n, 0.014) AS rugosidad_n,
           phc.pendiente_s0,
           phc.tirante_diseno_m,
           phc.bordo_libre_m
    INTO v_perf
    FROM public.perfil_hidraulico_canal phc
    WHERE p_km >= phc.km_inicio AND p_km < phc.km_fin
    LIMIT 1;

    IF v_perf IS NULL THEN
        RAISE EXCEPTION 'No se encontró geometría para km = %', p_km;
    END IF;

    -- ── GUARDIA DE DESBORDAMIENTO ──────────────────────────────────────────────
    -- El cajón hidráulico tiene capacidad hasta tirante_diseno + bordo_libre.
    -- Si el nivel leído supera ese límite, la sección ya no es trapezoidal cerrada
    -- y Manning normal deja de aplicar. La lectura es válida como dato físico
    -- (el operador debe atender la alerta), pero NO se compara con el modelo.
    v_nivel_max := COALESCE(
        v_nivel_max,                                       -- nivel_max_operativo de la escala
        v_perf.tirante_diseno_m + v_perf.bordo_libre_m,   -- tirante diseño + bordo libre
        3.8                                                 -- fallback genérico (m)
    );

    IF p_nivel_m > v_nivel_max THEN
        RETURN QUERY SELECT
            COALESCE(v_esc_id,     'SIN-ESCALA'),
            COALESCE(v_esc_nombre, 'Km ' || p_km),
            COALESCE(v_esc_km,     p_km),
            p_nivel_m,
            NULL::NUMERIC,   -- q_desde_lectura: no calculable (fuera de cajón)
            NULL::NUMERIC,   -- q_balance: no aplica compararcon modelo
            NULL::NUMERIC,
            NULL::NUMERIC,
            '⚠ DESBORDAMIENTO — nivel ' || p_nivel_m
                || 'm supera el cajón hidráulico ('
                || ROUND(v_nivel_max::numeric,2) || 'm). '
                || 'Lectura válida como dato físico. '
                || 'Modelo Manning NO aplica. Verificar bordo libre.',
            v_perf.plantilla_m,
            v_perf.talud_z,
            v_perf.rugosidad_n,
            v_perf.pendiente_s0;
        RETURN;
    END IF;

    -- ── CONDICIÓN NORMAL: nivel dentro del cajón ───────────────────────────────
    -- Q desde la lectura (Manning directo)
    v_q_lectura := public.fn_q_manning(
        p_nivel_m, v_perf.plantilla_m, v_perf.talud_z,
        v_perf.rugosidad_n, v_perf.pendiente_s0);

    -- Q balance: entrada - extracciones hasta este km
    -- Gasto de entrada = extracción de La Boquilla (PRE-001, la que alimenta el Canal Conchos) del día.
    -- Sin COALESCE: si no hay dato queda NULL (S/D). Antes: 50.0 m³/s inventados y sin filtrar por presa.
    SELECT lp.extraccion_total_m3s
    INTO v_q_entrada
    FROM public.lecturas_presas lp
    WHERE lp.fecha = p_fecha
      AND lp.presa_id = 'PRE-001'
    ORDER BY lp.fecha DESC
    LIMIT 1;

    SELECT COALESCE(SUM(ro.caudal_promedio), 0)
    INTO v_q_extraido
    FROM public.reportes_operacion ro
    JOIN public.puntos_entrega pe ON pe.id = ro.punto_id
    WHERE pe.km < p_km
      AND ro.fecha = p_fecha
      AND ro.estado::text NOT IN ('cierre', 'suspension');

    IF v_q_entrada IS NULL THEN
        -- Sin gasto de entrada no hay balance que comparar: se informa S/D (GREATEST ignora NULL y daba 0).
        RETURN QUERY SELECT
            COALESCE(v_esc_id, 'SIN-ESCALA'),
            COALESCE(v_esc_nombre, 'Km ' || p_km),
            COALESCE(v_esc_km, p_km),
            p_nivel_m,
            ROUND(v_q_lectura::numeric, 3),
            NULL::numeric,
            NULL::numeric,
            NULL::numeric,
            'SIN DATO — no hay gasto de entrada registrado para la fecha; no se puede verificar contra balance'::text,
            v_perf.plantilla_m,
            v_perf.talud_z,
            v_perf.rugosidad_n,
            v_perf.pendiente_s0;
        RETURN;
    END IF;

    v_q_balance := GREATEST(v_q_entrada - v_q_extraido, 0);
    v_dif       := v_q_lectura - v_q_balance;

    RETURN QUERY SELECT
        COALESCE(v_esc_id, 'SIN-ESCALA'),
        COALESCE(v_esc_nombre, 'Km ' || p_km),
        COALESCE(v_esc_km, p_km),
        p_nivel_m,
        ROUND(v_q_lectura::numeric, 3),
        ROUND(v_q_balance::numeric, 3),
        ROUND(v_dif::numeric, 3),
        ROUND((v_dif / GREATEST(v_q_balance, 0.001) * 100.0)::numeric, 1),
        CASE
            WHEN ABS(v_dif) <= 1.0 THEN 'CONSISTENTE — lectura concuerda con balance (±1 m³/s)'
            WHEN v_dif > 1.0       THEN 'EXCEDENTE — la escala indica más Q del esperado (aportación/error)'
            ELSE                        'DÉFICIT — la escala indica menos Q del esperado (pérdida/error)'
        END,
        v_perf.plantilla_m,
        v_perf.talud_z,
        v_perf.rugosidad_n,
        v_perf.pendiente_s0;
END;
$function$;
