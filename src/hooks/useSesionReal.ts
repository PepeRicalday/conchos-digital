import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * ¿Hay una sesión REAL de Supabase (JWT de usuario)? En localhost la app entra con un bypass de emergencia
 * (`local-token`) que NO es un JWT: el chat, el historial y la biblioteca (RLS por usuario) no pueden funcionar.
 * null = aún no se sabe.
 */
export function useSesionReal(): boolean | null {
    const [real, setReal] = useState<boolean | null>(null);
    useEffect(() => {
        let vivo = true;
        supabase.auth.getSession().then(({ data }) => { if (vivo) setReal(!!data.session?.access_token); }, () => { if (vivo) setReal(false); });
        const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (vivo) setReal(!!s?.access_token); });
        return () => { vivo = false; sub.subscription.unsubscribe(); };
    }, []);
    return real;
}
