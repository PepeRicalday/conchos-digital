import { useAuth } from '../../context/AuthContext';

export type Rol = 'SRL' | 'ACU' | 'AUDITORIA' | 'INVITADO';

/** Rol del usuario en sesión: una sola comprobación en vez de `profile?.rol !== 'SRL'` copiada por pantalla. */
export function useRol() {
    const { profile, loading } = useAuth();
    const rol = (profile?.rol ?? null) as Rol | null;
    return {
        rol,
        esSRL: rol === 'SRL',
        esInvitado: rol === 'INVITADO',
        /** Solo SRL y ACU escriben; AUDITORIA e INVITADO son de lectura. La BD lo impone por RLS, esto solo oculta botones. */
        puedeEscribir: rol === 'SRL' || rol === 'ACU',
        cargando: loading,
    };
}
