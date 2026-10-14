-- Veracidad: lecturas «de medianoche» (cron) ya no se tratan como mediciones de gasto.  2026-10-14
-- Causa (leída de la BD viva): fn_generar_continuidad_diaria (jobs 2 y 4, 06:00 UTC = 00:00 Chihuahua) copia el NIVEL del
-- último día a lecturas_escalas (hora 00:00:00, responsable 'SICA Chronos', 1020 filas desde 2026-03-27); el trigger
-- trg_gasto_escala_auto les calculaba un gasto (959 con valor) y get_q_actual_escala devolvía la ÚLTIMA lectura de
-- cualquier fecha, con COALESCE(...,0): balances «en tiempo real» con datos viejos, 0 por S/D, eficiencias de 306 %/3037 %.
-- Cambios (hacia adelante; NO se reescribe el histórico):
--  1) trigger fn_trg_calcular_gasto_escala: filas 'SICA Chronos' quedan con gasto NULL.
--  2) get_q_actual_escala: ignora filas 'SICA Chronos', exige lectura con gasto en las últimas 4 h (240 min, igual que el
--     front) y devuelve NULL (S/D) en vez de 0.
--  3) vista dashboard_vulnerabilidad_fugas: sin dato => eficiencia NULL y estatus 'SIN DATO' (antes 100 % y 'ESTABLE').
-- La copia de nivel de medianoche se conserva (otras vistas la usan para la línea base del día).
-- Pegar en el editor SQL de Supabase (NO db push).

CREATE OR REPLACE FUNCTION public.fn_trg_calcular_gasto_escala()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Solo calcular si no fue ingresado manualmente
  IF NEW.gasto_calculado_m3s IS NULL OR NEW.gasto_calculado_m3s = 0 THEN
    -- Compuertas capturadas y TODAS cerradas => gasto 0 real (no recalcular por nivel,
    -- que supone descarga libre y fabrica caudal fantasma en represas cerradas).
    IF COALESCE(NEW.responsable, '') = 'SICA Chronos' THEN
      -- Copia automática de medianoche (solo arrastra el NIVEL): no hay medición de gasto, queda NULL (S/D).
      NEW.gasto_calculado_m3s := NULL;
    ELSIF NEW.radiales_json IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.get_q_actual_escala(p_escala_id text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_q NUMERIC;
BEGIN
    SELECT l.gasto_calculado_m3s INTO v_q
    FROM public.lecturas_escalas l
    WHERE l.escala_id = p_escala_id
      AND COALESCE(l.responsable, '') <> 'SICA Chronos'      -- copia de medianoche: no es medición
      AND l.gasto_calculado_m3s IS NOT NULL
      AND (l.fecha + l.hora_lectura) AT TIME ZONE 'America/Chihuahua' >= now() - interval '240 minutes'
    ORDER BY l.fecha DESC, l.hora_lectura DESC
    LIMIT 1;

    RETURN v_q;   -- NULL = S/D (sin lectura vigente); un 0 aquí es una medición real de gasto 0
END;
$function$;

CREATE OR REPLACE VIEW public.dashboard_vulnerabilidad_fugas AS
SELECT escala_inicio_id,
    escala_inicio_nombre,
    km_inicio,
    escala_fin_id,
    escala_fin_nombre,
    km_fin,
    q_entrada_m3s,
    q_salida_m3s,
    q_extracciones_m3s,
    q_perdida_m3s,
        CASE
            WHEN (q_entrada_m3s > (0)::numeric) THEN round((((q_salida_m3s + q_extracciones_m3s) / q_entrada_m3s) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS eficiencia_pct,
        CASE
            WHEN ((q_entrada_m3s > (0)::numeric) AND ((((q_entrada_m3s - q_salida_m3s) - q_extracciones_m3s) / q_entrada_m3s) > 0.10)) THEN 'CRÍTICA (Fuga/Toma Clandestina)'::text
            WHEN ((q_entrada_m3s > (0)::numeric) AND ((((q_entrada_m3s - q_salida_m3s) - q_extracciones_m3s) / q_entrada_m3s) > 0.05)) THEN 'PREVENTIVA (Pérdida por Infiltración)'::text
            WHEN ((q_entrada_m3s IS NULL) OR (q_salida_m3s IS NULL)) THEN 'SIN DATO'::text
            ELSE 'ESTABLE'::text
        END AS estatus_hidraulico
   FROM vw_balance_tramos_tiempo_real;
