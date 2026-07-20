/**
 * VersionGuard v4.1 — Actualización forzada desde la nube (Conchos Digital)
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
 *
 * CANDADO ANTI-BUCLE (v4.1)
 * El candado original vivía en un useRef, que se resetea a `false` en cada
 * montaje — es decir, en CADA recarga. Si tras purgar y recargar el bundle
 * servido seguía comparando como "menor" (WebView de Android con caché de
 * app-shell fuera del control de `caches.delete()`, o el deploy nuevo aún no
 * asentado en el edge), el guardián volvía a purgar de inmediato: recarga en
 * bucle visible, sin nada que lo frene.
 *
 * Dos candados persistentes, en storages distintos a propósito:
 *  · CANDADO_KEY en sessionStorage — "hay una recarga en curso ahora mismo",
 *    se libera a los 4 s de un montaje exitoso. Sobrevive a location.replace
 *    dentro de la misma pestaña.
 *  · INTENTOS_KEY en localStorage — el CONTADOR de intentos. Si una PWA de
 *    Android reinicia el proceso de WebView en vez de solo navegar (algunos
 *    fabricantes lo hacen), sessionStorage puede perderse pero localStorage
 *    no. Es la red de seguridad real contra el bucle infinito: al 3er intento
 *    sin llegar a versión vigente, se rinde y deja pasar en vez de recargar
 *    para siempre.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

const CURRENT_VERSION = typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : '0.0.0';

const CANDADO_KEY = 'sica_vg_recargando';
const INTENTOS_KEY = 'sica_vg_intentos';
const MAX_INTENTOS = 3;

/** Storage puede no existir o lanzar (modo privado estricto) — nunca debe tumbar el guardián. */
const storageSeguro = (storage: Storage) => ({
    get(k: string): string | null { try { return storage.getItem(k); } catch { return null; } },
    set(k: string, v: string): void { try { storage.setItem(k, v); } catch { /* modo privado: seguimos sin candado/contador */ } },
    remove(k: string): void { try { storage.removeItem(k); } catch { /* noop */ } },
});
const persistente = storageSeguro(localStorage);   // sobrevive incluso a reinicio de proceso (WebView)
const sesion = storageSeguro(sessionStorage);       // se limpia al cerrar la pestaña/app

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
    // y el retorno a primer plano pueden encadenar dos recargas EN LA MISMA
    // carga de página. Los candados persistentes (sesión/localStorage, arriba)
    // son aparte: protegen ENTRE recargas distintas.
    const recargando = useRef(false);

    useEffect(() => {
        let vivo = true;

        // Arranque exitoso de este montaje: si llegamos aquí es porque el
        // bundle actual SÍ pudo ejecutarse. Se libera el candado tras un
        // respiro breve, no de inmediato — si esta misma carga vuelve a
        // desmontar en milisegundos (recarga en cadena real), el candado
        // seguido de MAX_INTENTOS sigue pudiendo cortar el bucle.
        const liberador = setTimeout(() => {
            sesion.remove(CANDADO_KEY);
        }, 4000);

        const consultar = async () => {
            if (!vivo || recargando.current || !navigator.onLine) return;
            // Ya hay una recarga en curso desde una carga anterior de la
            // página (candado persistente, sobrevive a location.replace):
            // no dispares una segunda mientras esa termina de asentarse.
            if (sesion.get(CANDADO_KEY)) return;

            try {
                const { data, error } = await supabase
                    .from('app_versions')
                    .select('version')
                    .eq('app_id', 'control-digital')
                    .single();

                if (!vivo || error || !data?.version) return;
                if (!esVersionMenor(CURRENT_VERSION, data.version)) {
                    // Alcanzamos versión vigente: limpiar el contador de intentos
                    // para que un futuro deploy vuelva a tener sus 3 chances.
                    persistente.remove(INTENTOS_KEY);
                    return;
                }

                const intentos = Number(persistente.get(INTENTOS_KEY) || '0') + 1;
                if (intentos > MAX_INTENTOS) {
                    // La purga no está resolviendo nada (SW/caché fuera de
                    // nuestro control, o el deploy aún no asienta en el edge).
                    // Mejor dejar operar con el bundle actual que recargar para
                    // siempre — un tablero en bucle es peor que uno atrasado.
                    console.error(
                        `[VersionGuard] ${MAX_INTENTOS} intentos de actualizar a ${data.version} sin éxito ` +
                        `(sigo en ${CURRENT_VERSION}). Me detengo para no recargar en bucle.`
                    );
                    return;
                }

                persistente.set(INTENTOS_KEY, String(intentos));
                sesion.set(CANDADO_KEY, '1');
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
            clearTimeout(liberador);
            clearInterval(id);
            document.removeEventListener('visibilitychange', alVolver);
        };
    }, []);

    return <>{children}</>;
};
