-- Migración: Estructura de Módulos y Puntos de Entrega
-- Objetivos: Soportar la jerarquía Módulo -> Puntos de Entrega vista en Canales.tsx

-- 1. Tabla de Módulos (Unidades de Riego)
CREATE TABLE IF NOT EXISTS public.modules (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    name text NOT NULL, -- Ej: "Módulo 1"
    acu_name text, -- Nombre completo de la ACU
    logo_url text,
    authorized_vol numeric DEFAULT 0, -- Volumen autorizado anual/ciclo
    target_flow numeric DEFAULT 0 -- Gasto objetivo actual en L/s o m3/s
);

-- 2. Tabla de Puntos de Entrega (Infrastructure)
CREATE TABLE IF NOT EXISTS public.delivery_points (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    module_id uuid REFERENCES public.modules(id),
    name text NOT NULL, -- Ej: "Toma Directa Km 8"
    km numeric,
    type text CHECK (type IN ('toma', 'lateral', 'carcamo')),
    capacity numeric NOT NULL, -- Capacidad máxima de diseño
    coordinates_x numeric, -- Para el mapa esquemático (0-100%)
    coordinates_y numeric,
    zone text, -- Ej: "Zona Vírgenes"
    section text -- Ej: "Sección A"
);

-- 3. Actualizar Measurements para apuntar correctamente
-- (Ya tiene location_id uuid, así que es compatible polimórficamente)

-- 4. Habilitar RLS
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_points ENABLE ROW LEVEL SECURITY;

-- Policies (Permisivos por ahora para prototipo, ajustar en producción)
CREATE POLICY "Public read modules" ON public.modules FOR SELECT USING (true);
CREATE POLICY "Public read points" ON public.delivery_points FOR SELECT USING (true);
