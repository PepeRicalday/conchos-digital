-- Endurece lecturas_presas: antes cualquier usuario autenticado (incluido AUDITORIA, de solo lectura) podía insertar,
-- actualizar y BORRAR. Ahora escriben SRL y ACU (importación, captura de campo y seguimiento de presas) y solo SRL borra.
-- Se conservan las políticas RESTRICTIVAS de INVITADO y la lectura pública. La ingesta CILA y AQUARIUS usan service_role (no pasan por RLS).
DROP POLICY IF EXISTS "Lecturas Presas: INSERT for authenticated" ON public.lecturas_presas;
DROP POLICY IF EXISTS "Lecturas Presas: UPDATE for authenticated" ON public.lecturas_presas;
DROP POLICY IF EXISTS lecturas_presas_delete ON public.lecturas_presas;

CREATE POLICY lecturas_presas_insert ON public.lecturas_presas FOR INSERT TO authenticated
  WITH CHECK (public.auth_rol() IN ('SRL', 'ACU'));
CREATE POLICY lecturas_presas_update ON public.lecturas_presas FOR UPDATE TO authenticated
  USING (public.auth_rol() IN ('SRL', 'ACU')) WITH CHECK (public.auth_rol() IN ('SRL', 'ACU'));
CREATE POLICY lecturas_presas_delete ON public.lecturas_presas FOR DELETE TO authenticated
  USING (public.auth_rol() = 'SRL');
