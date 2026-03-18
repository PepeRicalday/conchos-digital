-- Migración: Estructura para Análisis de Eficiencia de Entrega Semanal
-- Objetivo: Comparar Volumen Solicitado vs Volumen Entregado (Lunes a Domingo)

-- 0. Asegurar extensión para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Crear tabla de Solicitudes Semanales
CREATE TABLE IF NOT EXISTS public.solicitudes_riego_semanal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    modulo_id TEXT NOT NULL REFERENCES public.modulos(id) ON DELETE CASCADE,
    fecha_inicio DATE NOT NULL, -- Lunes
    fecha_fin DATE NOT NULL,    -- Domingo
    volumen_solicitado_mm3 NUMERIC NOT NULL DEFAULT 0 CHECK (volumen_solicitado_mm3 >= 0),
    semana_no INTEGER,
    creado_en TIMESTAMPTZ DEFAULT now(),
    actualizado_en TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_modulo_semana UNIQUE(modulo_id, fecha_inicio)
);

-- 2. Habilitar RLS
ALTER TABLE public.solicitudes_riego_semanal ENABLE ROW LEVEL SECURITY;

-- 3. Políticas de Acceso
DROP POLICY IF EXISTS "Lectura pública de solicitudes" ON public.solicitudes_riego_semanal;
CREATE POLICY "Lectura pública de solicitudes"
  ON public.solicitudes_riego_semanal FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Admin/Operator/SRL pueden gestionar solicitudes" ON public.solicitudes_riego_semanal;
CREATE POLICY "Admin/Operator/SRL pueden gestionar solicitudes"
  ON public.solicitudes_riego_semanal FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles_usuario
      WHERE perfiles_usuario.id = auth.uid()
        AND perfiles_usuario.rol IN ('SRL', 'ACU', 'AUDITORIA')
    )
  );

-- 4. Función y Trigger para timestamp
CREATE OR REPLACE FUNCTION public.fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_solicitudes_timestamp ON public.solicitudes_riego_semanal;
CREATE TRIGGER trg_update_solicitudes_timestamp
BEFORE UPDATE ON public.solicitudes_riego_semanal
FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

-- 5. Comentarios
COMMENT ON TABLE public.solicitudes_riego_semanal IS 'Almacena la programación semanal de riego (Lunes-Domingo).';
