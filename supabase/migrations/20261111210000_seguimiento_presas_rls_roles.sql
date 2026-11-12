-- Endurece seguimiento_presas: escribir solo SRL y ACU (AUDITORIA e INVITADO son de lectura), y que «capturado_por»
-- lo ponga el servidor desde el perfil del usuario, no el cliente.
DROP POLICY IF EXISTS seguimiento_presas_insert ON public.seguimiento_presas;
CREATE POLICY seguimiento_presas_insert ON public.seguimiento_presas FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() IN ('SRL', 'ACU'));
DROP POLICY IF EXISTS seguimiento_presas_update ON public.seguimiento_presas;
CREATE POLICY seguimiento_presas_update ON public.seguimiento_presas FOR UPDATE TO authenticated
  USING (public.auth_rol() IN ('SRL', 'ACU')) WITH CHECK (public.auth_rol() IN ('SRL', 'ACU'));

CREATE OR REPLACE FUNCTION public.fn_seguimiento_presas_autor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_nombre text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT nombre INTO v_nombre FROM public.perfiles_usuario WHERE id = auth.uid();
    NEW.capturado_por := COALESCE(NULLIF(btrim(v_nombre), ''), 'Usuario ' || left(auth.uid()::text, 8));
  END IF;
  NEW.actualizado_en := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seguimiento_presas_autor ON public.seguimiento_presas;
CREATE TRIGGER trg_seguimiento_presas_autor BEFORE INSERT OR UPDATE ON public.seguimiento_presas
  FOR EACH ROW EXECUTE FUNCTION public.fn_seguimiento_presas_autor();
