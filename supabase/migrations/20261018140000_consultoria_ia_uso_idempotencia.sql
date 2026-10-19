-- Consultoría IA — ronda 1 de correcciones (revisión externa 2026-10-18).
-- H2: el límite de consultas se contaba sobre chat_messages, y el usuario puede BORRAR sus propios mensajes
--     (política DELETE por dueño) → el contador volvía a 0. Ahora se cuenta en una tabla que solo escribe el servidor.
-- H1: un `client_msg_id` repetido evitaba el insert del mensaje y, con él, el conteo; además el "buscar y luego
--     insertar" tenía carrera. Ahora la unicidad la garantiza un índice parcial y el uso se cuenta por invocación.

CREATE TABLE IF NOT EXISTS public.hydric_uso (
    id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid        NOT NULL,
    ts      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hydric_uso_user_ts ON public.hydric_uso (user_id, ts DESC);

-- RLS activo y SIN políticas: solo el service_role (edge function) lee y escribe; ni anon ni authenticated.
ALTER TABLE public.hydric_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hydric_uso FROM PUBLIC, anon, authenticated;

-- Un mismo client_msg_id no puede registrarse dos veces en la misma conversación (peticiones concurrentes).
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_msg_unico
    ON public.chat_messages (conversation_id, ((metadata ->> 'client_msg_id')))
    WHERE metadata ? 'client_msg_id';

-- Purga diaria: el conteo solo necesita la última hora.
SELECT cron.unschedule('hydric-uso-purga') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hydric-uso-purga');
SELECT cron.schedule('hydric-uso-purga', '30 4 * * *', $$DELETE FROM public.hydric_uso WHERE ts < now() - interval '2 days'$$);
