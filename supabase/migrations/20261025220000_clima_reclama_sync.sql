-- Reclamo ATÓMICO del turno de sincronización: un solo INSERT ... ON CONFLICT DO UPDATE ... WHERE bloquea la fila, así
-- que de varias llamadas simultáneas solo una obtiene TRUE (el chequeo leer-y-luego-escribir dejaba pasar a todas).
CREATE OR REPLACE FUNCTION public.fn_clima_reclama_sync(p_bloque text, p_horas integer DEFAULT 3)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE filas integer;
BEGIN
  INSERT INTO clima_sync_estado (bloque, intento_en) VALUES (p_bloque, now())
  ON CONFLICT (bloque) DO UPDATE SET intento_en = now()
    WHERE clima_sync_estado.intento_en < now() - make_interval(hours => GREATEST(p_horas, 1));
  GET DIAGNOSTICS filas = ROW_COUNT;
  RETURN filas > 0;
END $$;
-- Solo la Edge Function (service_role) la usa.
REVOKE ALL ON FUNCTION public.fn_clima_reclama_sync(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clima_reclama_sync(text, integer) TO service_role;
