/**
 * VersionGuard v4.0 — Actualización forzada desde la nube (Conchos Digital)
 *
 * QUÉ RESUELVE
 * Las capas del PWA (epoch, sw-purge, polling del SW) viven DENTRO del bundle:
 * solo las ejecuta quien ya bajó la versión nueva. Un dispositivo anclado en
 * una versión vieja nunca las corre — es circular. Este guardián rompe el
 * círculo porque consulta Supabase, que responde igual sea cual sea el bundle
 * que el dispositivo esté ejecutando.
 *
 * CÓMO DECIDE
 * Compara la versión compilada contra `version` en app_versions (no contra
 * `min_supported_version`: el deploy iguala mínimo y versión, así que ese campo
 * nunca dispara nada). Si la nube va adelante, purga y recarga SOLA.
 *
 * A diferencia de SICA Capture, aquí no hay guarda por captura en curso: esta
 * app es de consulta y operación, no de captura de campo, así que una recarga
 * no destruye trabajo irrecuperable.
 *
 * NUNCA bloquea por error de red o falta de conexión.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

const CURRENT_VERSION = typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : '0.0.0';

/** ¿`a` es una versión menor que `b`? Compara major.minor.patch. */
const esVersionMenor = (a: string, b: string): boolean => {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) < (y[i] || 0)) return true;
        if ((x[i] || 0) > (y[i] || 0)) return false;
    }
    return false;
};

/** Purga SW + cachés y recarga contra el origen, sorteando la caché del navegador. */
const purgarYRecargar = async (): Promise<void> => {
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
    } catch (e) {
        // Purga parcial: recargamos igual — mejor intentarlo que quedar anclado.
        console.warn('Purga de caché incompleta:', e);
    }
    window.location.replace(`${window.location.origin}?v=${Date.now()}`);
};

const INTERVALO_SONDEO_MS = 10 * 60 * 1000;   // 10 min

export const VersionGuard = ({ children }: { children: ReactNode }) => {
    // window.location.replace no es instantáneo: sin este candado, el sondeo
    // y el retorno a primer plano pueden encadenar dos recargas.
    const recargando = useRef(false);

    useEffect(() => {
        let vivo = true;

        const consultar = async () => {
            if (!vivo || recargando.current || !navigator.onLine) return;
            try {
                const { data, error } = await supabase
                    .from('app_versions')
                    .select('version')
                    .eq('app_id', 'control-digital')
                    .single();

                if (!vivo || error || !data?.version) return;
                if (!esVersionMenor(CURRENT_VERSION, data.version)) return;

                recargando.current = true;
                void purgarYRecargar();
            } catch {
                // Fail-safe: NUNCA interrumpir la operación por un fallo de red.
            }
        };

        void consultar();
        const id = setInterval(consultar, INTERVALO_SONDEO_MS);

        // Un tablero puede quedar días abierto en pantalla; al retomarlo debe
        // revisar de inmediato, sin esperar al siguiente intervalo.
        const alVolver = () => {
            if (document.visibilityState === 'visible') void consultar();
        };
        document.addEventListener('visibilitychange', alVolver);

        return () => {
            vivo = false;
            clearInterval(id);
            document.removeEventListener('visibilitychange', alVolver);
        };
    }, []);

    return <>{children}</>;
};
