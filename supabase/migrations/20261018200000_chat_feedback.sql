-- Valoración "útil / no útil" de las respuestas del asistente (Consultoría IA).
-- Tabla aparte: chat_messages no tiene política UPDATE a propósito (el usuario no debe poder reescribir respuestas).
create table if not exists public.chat_feedback (
    message_id uuid primary key references public.chat_messages(id) on delete cascade,
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    valor smallint not null check (valor in (-1, 1)),
    created_at timestamptz not null default now()
);
alter table public.chat_feedback enable row level security;

create policy "Usuario ve su valoración" on public.chat_feedback for select to authenticated
    using (user_id = auth.uid());
create policy "Usuario valora respuestas de sus conversaciones" on public.chat_feedback for insert to authenticated
    with check (user_id = auth.uid() and exists (
        select 1 from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
        where m.id = message_id and c.user_id = auth.uid() and m.role = 'assistant'));
create policy "Usuario cambia su valoración" on public.chat_feedback for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Usuario retira su valoración" on public.chat_feedback for delete to authenticated
    using (user_id = auth.uid());
revoke all on public.chat_feedback from anon;

-- Endurecimiento (revisión de seguridad): el UPDATE solo puede cambiar `valor`; si pudiera cambiar message_id,
-- una valoración propia podría reapuntarse a un mensaje ajeno sin pasar por la comprobación del INSERT.
create or replace function public.chat_feedback_inmutable() returns trigger
language plpgsql set search_path = public as $$
begin
    if new.message_id is distinct from old.message_id or new.user_id is distinct from old.user_id then
        raise exception 'chat_feedback: message_id y user_id no se pueden modificar';
    end if;
    return new;
end $$;
revoke all on function public.chat_feedback_inmutable() from public, anon, authenticated;
create trigger chat_feedback_inmutable before update on public.chat_feedback
    for each row execute function public.chat_feedback_inmutable();
