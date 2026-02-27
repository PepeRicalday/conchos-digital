ALTER TABLE public.clima_presas
  ALTER COLUMN visibilidad TYPE TEXT USING visibilidad::text,
  ALTER COLUMN intensidad_viento TYPE TEXT USING intensidad_viento::text,
  ALTER COLUMN intensidad_24h TYPE TEXT USING intensidad_24h::text;

CREATE TABLE IF NOT EXISTS public.aforos_principales_diarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha DATE DEFAULT CURRENT_DATE NOT NULL,
    estacion TEXT NOT NULL, -- 'Km 0+580', 'Km 106', 'Km 104'
    escala NUMERIC,
    gasto_m3s NUMERIC,
    creado_en TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(fecha, estacion)
);

ALTER TABLE public.aforos_principales_diarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Aforos Diarios" ON public.aforos_principales_diarios FOR SELECT USING (true);
CREATE POLICY "Auth Write Aforos Diarios" ON public.aforos_principales_diarios FOR ALL USING (true);
