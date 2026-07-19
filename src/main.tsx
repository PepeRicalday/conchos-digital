/**
 * SICA NUCLEAR RESET — FORCED v2.0.0
 * Este script corre antes que cualquier otra cosa para garantizar la unificación.
 */
if (typeof window !== 'undefined') {
    // Cambiar EPOCH_ID fuerza un reset único en TODOS los dispositivos la
    // próxima vez que abran la app: limpia almacenamiento, desregistra el SW,
    // purga cachés y recarga. Solo corre una vez por dispositivo por epoch.
    //
    // v2.10.2 — integridad de datos de presas (S/D, umbral de fuga, Capa 3).
    const EPOCH_ID = 'sica_epoch_2102_presas';
    if (localStorage.getItem('sica_active_epoch') !== EPOCH_ID) {
        console.log("NUCLEAR RESET: New Epoch Detected. Clearing everything...");
        // Preservar la sesión: limpiar todo obliga a reingresar credenciales en
        // campo, donde el operador puede no tenerlas a la mano.
        const authKeys: [string, string][] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.startsWith('sb-') || k.includes('supabase.auth'))) {
                const v = localStorage.getItem(k);
                if (v != null) authKeys.push([k, v]);
            }
        }

        localStorage.clear();
        sessionStorage.clear();
        for (const [k, v] of authKeys) localStorage.setItem(k, v);
        localStorage.setItem('sica_active_epoch', EPOCH_ID);

        // Desregistrar SW y limpiar cachés
        const resetTotal = async () => {
            try {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map(r => r.unregister()));
                }
                // Purga explícita de cachés: desregistrar el SW no las borra,
                // y un chunk viejo cacheado reintroduce el bundle anterior.
                if ('caches' in window) {
                    const names = await caches.keys();
                    await Promise.all(names.map(n => caches.delete(n)));
                }
            } catch { /* si falla, recargamos igual */ }
            window.location.reload();
        };
        void resetTotal();
    }

    // ── Búsqueda periódica de nueva versión ─────────────────────────────────
    // registerSW.js solo registra el SW en el evento `load`. Una tableta que
    // permanece abierta días (caso típico en campo) nunca vuelve a preguntar
    // si hay versión nueva y sigue ejecutando el bundle viejo indefinidamente.
    //
    // Con skipWaiting + clientsClaim, basta con que update() encuentre un SW
    // nuevo para que tome control; recargamos al detectar el cambio.
    if ('serviceWorker' in navigator) {
        const INTERVALO_MS = 15 * 60 * 1000;   // 15 min

        const buscarActualizacion = async () => {
            if (!navigator.onLine) return;
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.update()));
            } catch { /* sin conexión o SW no disponible: reintenta luego */ }
        };

        // Al cambiar el SW controlador, el bundle en memoria quedó obsoleto.
        //
        // CUIDADO: en la PRIMERA carga tras un nuke no hay SW controlando la
        // página. Cuando el SW recién registrado toma control, dispara
        // `controllerchange` — y recargar ahí aborta la descarga de los chunks
        // lazy a medio vuelo, dejando el Suspense colgado en "Cargando módulo…"
        // para siempre. Solo se recarga si YA había un controlador antes, que
        // es el caso real de "llegó una versión nueva".
        const habiaControlador = !!navigator.serviceWorker.controller;
        let recargando = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!habiaControlador) return;   // primera toma de control: no tocar
            if (recargando) return;          // evita bucle de recarga
            recargando = true;
            window.location.reload();
        });

        setInterval(buscarActualizacion, INTERVALO_MS);
        // También al volver a primer plano: el operador retoma la tableta y
        // debe ver la versión vigente sin esperar al siguiente intervalo.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void buscarActualizacion();
        });
    }

    // ── Guardián global de caché envenenada ─────────────────────────────────
    // Un chunk lazy con hash muerto (tras deploy) puede fallar ANTES de que
    // React monte, por lo que el ErrorBoundary no lo vería. Este listener global
    // detecta el error de MIME/chunk y fuerza limpieza + nuke una sola vez.
    const recuperarCacheViciada = () => {
        if (sessionStorage.getItem('mime_recovery_done')) return;
        sessionStorage.setItem('mime_recovery_done', '1');
        const purgar = async () => {
            try {
                if ('serviceWorker' in navigator) {
                    const regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map(r => r.unregister()));
                }
                if ('caches' in window) {
                    const names = await caches.keys();
                    await Promise.all(names.map(n => caches.delete(n)));
                }
            } catch { /* seguimos */ }
            window.location.replace(`/nuke.html?from=mime-global&t=${Date.now()}`);
        };
        void purgar();
    };
    const patronCache = /valid JavaScript MIME type|dynamically imported module|Importing a module script failed|Unexpected token '<'|ChunkLoadError/i;
    window.addEventListener('error', (e) => {
        const msg = (e as ErrorEvent).message || '';
        // Error de carga de <script>/módulo: e.target es el elemento que falló
        const tgt = e.target as HTMLElement | null;
        const esScript = tgt && (tgt.tagName === 'SCRIPT' || tgt.tagName === 'LINK');
        if (patronCache.test(msg) || esScript) recuperarCacheViciada();
    }, true);
    window.addEventListener('unhandledrejection', (e) => {
        const msg = String((e as PromiseRejectionEvent).reason?.message || (e as PromiseRejectionEvent).reason || '');
        if (patronCache.test(msg)) recuperarCacheViciada();
    });
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Subconjunto latin únicamente — elimina ~1.5 MB de variantes cyrillic/greek/vietnamese
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-800.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import './index.css'
import App from './App.tsx'

// C-01: ErrorBoundary real vive en components/ErrorBoundary.tsx (usa react-error-boundary con UI premium)
// Se usa dentro de App.tsx — no duplicar aquí.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Arranque exitoso: liberar el candado de recuperación para permitir un futuro
// intento si más adelante ocurre otra vez (tras el próximo deploy).
requestAnimationFrame(() => {
  setTimeout(() => sessionStorage.removeItem('mime_recovery_done'), 4000);
})

