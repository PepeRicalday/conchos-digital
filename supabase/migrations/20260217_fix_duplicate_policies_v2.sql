-- ============================================================
-- Fix: Eliminar FOR ALL duplicado → usar solo INSERT/UPDATE/DELETE
-- para evitar doble SELECT con la política pública
-- ============================================================

-- PRESAS
DROP POLICY IF EXISTS "Admin/Operator pueden modificar presas" ON public.presas;
CREATE POLICY "Admin/Operator escriben presas"
  ON public.presas FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );
CREATE POLICY "Admin/Operator actualizan presas"
  ON public.presas FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );
CREATE POLICY "Admin/Operator eliminan presas"
  ON public.presas FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );

-- CANALS
DROP POLICY IF EXISTS "Admin/Operator pueden modificar canals" ON public.canals;
CREATE POLICY "Admin/Operator escriben canals"
  ON public.canals FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );
CREATE POLICY "Admin/Operator actualizan canals"
  ON public.canals FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );
CREATE POLICY "Admin/Operator eliminan canals"
  ON public.canals FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );

-- SECCIONES
DROP POLICY IF EXISTS "Admin/Operator pueden modificar secciones" ON public.secciones;
CREATE POLICY "Admin/Operator escriben secciones"
  ON public.secciones FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );
CREATE POLICY "Admin/Operator actualizan secciones"
  ON public.secciones FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );
CREATE POLICY "Admin/Operator eliminan secciones"
  ON public.secciones FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role IN ('admin', 'operator')
    )
  );
