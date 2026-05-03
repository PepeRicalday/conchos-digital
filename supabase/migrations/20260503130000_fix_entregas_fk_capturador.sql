-- ═══════════════════════════════════════════════════════════════════════
-- CORRECCIÓN: FK capturador_id referenciaba public.perfiles (inexistente)
-- La tabla real de perfiles del sistema es public.perfiles_usuario.
--
-- El error al sincronizar desde sica-capture era:
--   "insert or update on table 'entregas_modulo' violates foreign key
--    constraint 'entregas_modulo_capturador_id_fkey'"
-- porque el usuario existe en perfiles_usuario pero no en perfiles.
-- ═══════════════════════════════════════════════════════════════════════

-- Eliminar FK incorrecta (apuntaba a perfiles que no existe)
ALTER TABLE public.entregas_modulo
    DROP CONSTRAINT IF EXISTS entregas_modulo_capturador_id_fkey;

-- Re-crear FK apuntando a perfiles_usuario (tabla real del sistema)
ALTER TABLE public.entregas_modulo
    ADD CONSTRAINT entregas_modulo_capturador_id_fkey
    FOREIGN KEY (capturador_id)
    REFERENCES public.perfiles_usuario(id)
    ON DELETE SET NULL;

-- ── Test ─────────────────────────────────────────────────────────────
-- SELECT conname, confrelid::regclass AS tabla_referenciada
-- FROM pg_constraint
-- WHERE conrelid = 'public.entregas_modulo'::regclass
--   AND contype = 'f'
--   AND conname LIKE '%capturador%';
-- Debe mostrar: tabla_referenciada = perfiles_usuario
