-- ============================================================
-- Migración: Infraestructura para Modelación Hidráulica
-- Fecha: 2026-03-18 20:45
-- Enfocada en "Un dato, una sola verdad" (Normativa SICA)
-- ============================================================

-- 1. Tabla de Geometría del Canal Principal Conchos
CREATE TABLE IF NOT EXISTS public.canal_geometria (
    km NUMERIC PRIMARY KEY,                             -- Ubicación (Punto Kilométrico)
    nombre_seccion TEXT,                                -- Identificador (Ej: 'Sección Típica Km 15')
    pendiente_s0 NUMERIC NOT NULL DEFAULT 0.0001,       -- Pendiente del fondo (m/m)
    manning_n NUMERIC NOT NULL DEFAULT 0.014,           -- Coeficiente de Rugosidad
    
    -- Geometría (Por defecto Trapecial por ser canal principal)
    ancho_plantilla_b NUMERIC NOT NULL,                 -- Base (m)
    talud_z NUMERIC NOT NULL DEFAULT 1.5,               -- Pendiente talud (z:1)
    
    -- Datos de Diseño Oficiales
    tirante_diseno_y NUMERIC,                           -- Nivel normal de diseño (m)
    gasto_diseno_q NUMERIC,                             -- Capacidad máxima (m3/s)
    bordo_libre_m NUMERIC DEFAULT 0.5,                  -- Bordo libre de seguridad (m)
    
    -- Atributos Auditables
    tipo_recubrimiento TEXT DEFAULT 'CONCRETO',         -- CONCRETO, TIERRA, MAMPOSTERIA
    coordenadas_lat NUMERIC,                            -- Latitud GPS
    coordenadas_lng NUMERIC,                            -- Longitud GPS
    
    -- Metadatos
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Índices para búsqueda de tramos
CREATE INDEX IF NOT EXISTS idx_canal_geometria_km ON public.canal_geometria(km);

-- 3. Tabla para Escenarios de Simulación (Modelación)
CREATE TABLE IF NOT EXISTS public.sica_modelacion_escenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_escenario TEXT NOT NULL,
    km_inicio NUMERIC NOT NULL,
    km_fin NUMERIC NOT NULL,
    gasto_q_simulacion NUMERIC NOT NULL,               -- El "Q" que se quiere probar
    metodo_calculo TEXT DEFAULT 'PASO_ESTANDAR',       -- MANNING, PASO_ESTANDAR, EULER
    
    -- Resultados de la simulación (JSON con perfiles hídricos)
    datos_perfil_jsonb JSONB,                          -- Array de {km, y_tirante, energy_line}
    
    registrado_por UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Seguridad (RLS)
ALTER TABLE public.canal_geometria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sica_modelacion_escenarios ENABLE ROW LEVEL SECURITY;

-- Políticas para Geometría
DROP POLICY IF EXISTS "Lectura pública geometría" ON public.canal_geometria;
CREATE POLICY "Lectura pública geometría" 
    ON public.canal_geometria FOR SELECT USING (true);

DROP POLICY IF EXISTS "Gestión técnica de geometría" ON public.canal_geometria;
CREATE POLICY "Gestión técnica de geometría" 
    ON public.canal_geometria FOR ALL USING (auth.role() = 'authenticated');

-- Políticas para Escenarios
DROP POLICY IF EXISTS "Lectura pública escenarios" ON public.sica_modelacion_escenarios;
CREATE POLICY "Lectura pública escenarios" 
    ON public.sica_modelacion_escenarios FOR SELECT USING (true);

DROP POLICY IF EXISTS "Creación de escenarios" ON public.sica_modelacion_escenarios;
CREATE POLICY "Creación de escenarios" 
    ON public.sica_modelacion_escenarios FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.canal_geometria IS 'Base de datos de ingeniería del Canal Principal: un dato, una sola verdad hidrodinámica.';
COMMENT ON TABLE public.sica_modelacion_escenarios IS 'Historial de simulaciones y perfiles hídricos generados por el motor hidráulico.';
