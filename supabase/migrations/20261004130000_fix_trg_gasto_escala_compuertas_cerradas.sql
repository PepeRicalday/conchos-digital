-- Fix: fn_trg_calcular_gasto_escala trataba gasto = 0 como "no ingresado" y lo
-- recalculaba por nivel (descarga libre, h2 = 0), fabricando caudal fantasma
-- (25-50 m3/s) en represas con TODAS las compuertas cerradas (vaciado, oct-2026).
-- Ahora, si hay radiales_json capturado, todas en 0 y la lectura está confirmada,
-- el gasto queda en 0. Resto del comportamiento sin cambios.
-- Aplicado en producción vía SQL (no db push: hay drift de migraciones).

CREATE OR REPLACE FUNCTION public.fn_trg_calcular_gasto_escala()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.gasto_calculado_m3s IS NULL OR NEW.gasto_calculado_m3s = 0 THEN
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
