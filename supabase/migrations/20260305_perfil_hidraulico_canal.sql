-- Migration to create canal_perfil_hidraulico table
-- Created at: 2026-03-05

CREATE TABLE IF NOT EXISTS public.perfil_hidraulico_canal (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    km_inicio NUMERIC NOT NULL,
    km_fin NUMERIC NOT NULL,
    nombre_tramo TEXT,
    plantilla_m NUMERIC, -- b (ancho de base)
    talud_z NUMERIC, -- z (relación horizontal:vertical)
    rugosidad_n NUMERIC DEFAULT 0.015, -- n de Manning
    pendiente_s0 NUMERIC, -- S0 (m/m)
    tirante_diseno_m NUMERIC, -- dn (tirante normal de diseño)
    capacidad_diseno_m3s NUMERIC, -- Q (gasto de diseño)
    ancho_corona_m NUMERIC, -- Ancho de la corona del bordo
    bordo_libre_m NUMERIC, -- Bordo libre
    velocidad_diseno_ms NUMERIC, -- V (velocidad de diseño)
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.perfil_hidraulico_canal ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public Access Canal Perfil') THEN
        CREATE POLICY "Public Access Canal Perfil" ON public.perfil_hidraulico_canal FOR ALL USING (true);
    END IF;
END $$;

-- Comentarios de tabla para documentación automática
COMMENT ON TABLE public.perfil_hidraulico_canal IS 'Especificaciones de ingeniería hidráulica por tramos del canal principal.';

-- Función para buscar características por KM
CREATE OR REPLACE FUNCTION public.get_perfil_hidraulico(p_km NUMERIC)
RETURNS SETOF public.perfil_hidraulico_canal AS $$
BEGIN
    RETURN QUERY 
    SELECT * FROM public.perfil_hidraulico_canal
    WHERE p_km >= km_inicio AND p_km < km_fin
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
