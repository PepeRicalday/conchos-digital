-- Registro Histórico de Movimientos de Presa ( releases / gastos )
-- Objetivo: Comparar extracciones en presa vs llegada al KM 0+000

CREATE TABLE IF NOT EXISTS public.movimientos_presas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    presa_id TEXT REFERENCES public.presas(id) NOT NULL,
    fecha_hora TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    gasto_m3s NUMERIC NOT NULL,
    responsable TEXT,
    fuente_dato TEXT DEFAULT 'ADMIN', -- 'SICA_CAPTURE' o 'ADMIN'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Habilitar RLS
ALTER TABLE public.movimientos_presas ENABLE ROW LEVEL SECURITY;

-- Políticas de Acceso (Idempotentes)
DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Public Read Movimientos Presas" ON public.movimientos_presas;
    CREATE POLICY "Public Read Movimientos Presas" ON public.movimientos_presas FOR SELECT USING (true);
    
    DROP POLICY IF EXISTS "Insert Movimientos Presas" ON public.movimientos_presas;
    CREATE POLICY "Insert Movimientos Presas" ON public.movimientos_presas FOR INSERT WITH CHECK (true);
END $$;

-- Función para actualizar el registro diario automático
CREATE OR REPLACE FUNCTION public.sync_daily_dam_registry()
RETURNS TRIGGER AS $$
BEGIN
    -- Actualizar el valor 'extraccion_total_m3s' en la tabla de lecturas_presas
    -- Usando el gasto más reciente del día
    INSERT INTO public.lecturas_presas (id, presa_id, fecha, extraccion_total_m3s)
    VALUES (gen_random_uuid()::text, NEW.presa_id, NEW.fecha_hora::date, NEW.gasto_m3s)
    ON CONFLICT (presa_id, fecha) 
    DO UPDATE SET 
        extraccion_total_m3s = EXCLUDED.extraccion_total_m3s;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger (Idempotente)
DROP TRIGGER IF EXISTS trigger_update_daily_dam_flow ON public.movimientos_presas;
CREATE TRIGGER trigger_update_daily_dam_flow
AFTER INSERT ON public.movimientos_presas
FOR EACH ROW EXECUTE FUNCTION public.sync_daily_dam_registry();
