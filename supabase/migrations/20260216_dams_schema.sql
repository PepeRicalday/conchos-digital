-- 1. Create Dams Catalog
CREATE TABLE IF NOT EXISTS public.presas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    nombre_corto TEXT,
    rio TEXT,
    municipio TEXT,
    capacidad_namo NUMERIC NOT NULL, -- Mn3
    capacidad_name NUMERIC NOT NULL,
    elevacion_namo NUMERIC NOT NULL, -- msnm
    elevacion_name NUMERIC,
    coord_lat NUMERIC,
    coord_lng NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Create Dam Daily Readings
CREATE TABLE IF NOT EXISTS public.registros_presas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presa_id UUID REFERENCES public.presas(id) NOT NULL,
    fecha DATE DEFAULT CURRENT_DATE,
    elevacion_actual NUMERIC, -- msnm
    almacenamiento_actual NUMERIC, -- Mm3
    extraccion_total NUMERIC, -- m3/s
    ingreso_estimado NUMERIC, -- m3/s
    vertedor_q NUMERIC DEFAULT 0,
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(presa_id, fecha) -- One record per dam per day
);

-- 3. Create Weather Stations Readings
CREATE TABLE IF NOT EXISTS public.registros_clima (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ubicacion TEXT NOT NULL, -- 'Boquilla', 'Madero', 'Delicias'
    fecha DATE DEFAULT CURRENT_DATE,
    temp_ambiente NUMERIC, -- C
    temp_max NUMERIC,
    temp_min NUMERIC,
    precipitacion NUMERIC, -- mm
    evaporacion NUMERIC, -- mm
    viento_dir TEXT,
    viento_vel NUMERIC,
    visibilidad TEXT,
    estado_tiempo TEXT, -- 'Soleado', 'Nublado', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(ubicacion, fecha)
);

-- 4. Enable RLS
ALTER TABLE public.presas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_presas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_clima ENABLE ROW LEVEL SECURITY;

-- 5. Policies (Public Read, Internal Write)
CREATE POLICY "Public Read Presas" ON public.presas FOR SELECT USING (true);
CREATE POLICY "Public Read Registros Presas" ON public.registros_presas FOR SELECT USING (true);
CREATE POLICY "Public Read Registros Clima" ON public.registros_clima FOR SELECT USING (true);

-- (Assuming authenticated users/admins can write - skipping complex auth for now, allowing anon insert for demo if needed, or stick to authenticated)
CREATE POLICY "Auth Write Presas" ON public.registros_presas FOR INSERT WITH CHECK (true); -- Simplistic for now
CREATE POLICY "Auth Update Presas" ON public.registros_presas FOR UPDATE USING (true);
CREATE POLICY "Auth Write Clima" ON public.registros_clima FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth Update Clima" ON public.registros_clima FOR UPDATE USING (true);

-- 6. Seed Data (Initial Dams)
INSERT INTO public.presas (nombre, nombre_corto, rio, municipio, capacidad_namo, capacidad_name, elevacion_namo, coord_lat, coord_lng)
VALUES 
('Presa La Boquilla', 'PLB', 'Río Conchos', 'San Francisco de Conchos', 2903, 3990, 1317.00, 27.5583, -105.4317),
('Presa Francisco I. Madero', 'PFM', 'Río San Pedro', 'Rosales', 333.320, 420, 1239.30, 28.0167, -105.5333)
ON CONFLICT DO NOTHING;
