-- ═══════════════════════════════════════════════════════════════════════
-- FIX: Acceso público (anon) de lectura a entregas_modulo
--
-- Diagnóstico: PublicMonitor (conchos-digital) usa la anon key de Supabase.
-- La política SELECT en entregas_modulo exige auth.uid() → retorna 0 filas
-- para cualquier cliente no autenticado, incluyendo el monitor público.
--
-- Solución: Añadir política "SELECT USING (TRUE)" para anon.
-- Exposición aceptable: los datos son operativos (gastos/volúmenes por zona)
-- ya visibles en el Monitor Público — no contienen datos personales.
-- ═══════════════════════════════════════════════════════════════════════

-- Política de lectura pública (anon + authenticated)
CREATE POLICY "entregas_public_read"
    ON public.entregas_modulo
    FOR SELECT
    USING (TRUE);

-- Garantizar permiso de SELECT al rol anon
GRANT SELECT ON public.entregas_modulo TO anon;

-- Garantizar acceso anon a las vistas que dependen de entregas_modulo
GRANT SELECT ON public.volumenes_zona_diarios  TO anon;
GRANT SELECT ON public.volumenes_canal_diarios TO anon;
GRANT SELECT ON public.balance_volumen_modulo  TO anon;
