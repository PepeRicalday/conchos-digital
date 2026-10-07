import { useAuth } from '../../context/AuthContext';

export type Rol = 'SRL' | 'ACU' | 'AUDITORIA';

/** Rol del usuario en sesión: una sola comprobación en vez de `profile?.rol !== 'SRL'` copiada por pantalla. */
export function useRol() {
    const { profile, loading } = useAuth();
    return {
        rol: (profile?.rol ?? null) as Rol | null,
        esSRL: profile?.rol === 'SRL',
        cargando: loading,
    };
}
