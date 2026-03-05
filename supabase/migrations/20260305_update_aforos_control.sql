-- Migration to update aforos_control table and points
-- Created at: 2026-03-05

-- 1. Ensure columns exist
ALTER TABLE public.aforos_control 
ADD COLUMN IF NOT EXISTS latitud NUMERIC,
ADD COLUMN IF NOT EXISTS longitud NUMERIC,
ADD COLUMN IF NOT EXISTS foto_url TEXT,
ADD COLUMN IF NOT EXISTS caracteristicas_hidraulicas JSONB DEFAULT '{}'::jsonb;

-- 2. Clear old points (as requested "sustituyendo los anteriores")
DELETE FROM public.aforos_control;

-- 3. Insert new points
INSERT INTO public.aforos_control (id, nombre_punto, latitud, longitud, fecha, caracteristicas_hidraulicas)
VALUES 
  (uuid_generate_v4(), 'K-0+630', 27.672117, -105.207161, CURRENT_DATE, '{"plantilla": 12.0, "talud": 1.5}'),
  (uuid_generate_v4(), 'K-1+000', 27.676056, -105.204117, CURRENT_DATE, '{"plantilla": 12.0, "talud": 1.5}'),
  (uuid_generate_v4(), 'K-2+476', 27.688214, -105.200753, CURRENT_DATE, '{"plantilla": 12.0, "talud": 1.5}'),
  (uuid_generate_v4(), 'K-48+410', 28.011992, -105.324069, CURRENT_DATE, '{"plantilla": 10.0, "talud": 1.25}'),
  (uuid_generate_v4(), 'K-48+430', 28.012244, -105.324386, CURRENT_DATE, '{"plantilla": 10.0, "talud": 1.25}'),
  (uuid_generate_v4(), 'K-68+245', 28.130531, -105.397508, CURRENT_DATE, '{"plantilla": 8.0, "talud": 1.25}'),
  (uuid_generate_v4(), 'K-0+110 DEL K-68', 28.134058, -105.398722, CURRENT_DATE, '{"plantilla": 4.0, "talud": 1.0}'),
  (uuid_generate_v4(), 'K-72+008', 28.129872, -105.433289, CURRENT_DATE, '{"plantilla": 6.0, "talud": 1.25}'),
  (uuid_generate_v4(), 'K-104+010', 28.158914, -105.618308, CURRENT_DATE, '{"plantilla": 5.0, "talud": 1.25}');

-- 4. Set RLS policies if not already set
ALTER TABLE public.aforos_control ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read for aforos_control" 
ON public.aforos_control FOR SELECT 
USING (true);

CREATE POLICY "Allow authenticated insert for aforos_control" 
ON public.aforos_control FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated update for aforos_control" 
ON public.aforos_control FOR UPDATE 
USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated delete for aforos_control" 
ON public.aforos_control FOR DELETE 
USING (auth.role() = 'authenticated');
