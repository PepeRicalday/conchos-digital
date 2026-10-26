-- Último INTENTO (no solo último éxito) de cada bloque de clima-pronostico-alterno-sync: el freno anti-abuso de la
-- función (anon key pública) se apoya en esto, así un proveedor caído tampoco permite insistir en bucle.
CREATE TABLE IF NOT EXISTS public.clima_sync_estado (
  bloque     text PRIMARY KEY,
  intento_en timestamptz NOT NULL DEFAULT now()
);
-- RLS activo y sin políticas: solo la usa la función con service_role.
ALTER TABLE public.clima_sync_estado ENABLE ROW LEVEL SECURITY;
