/**
 * SICA NUCLEAR RESET — FORCED v2.0.0
 * Este script corre antes que cualquier otra cosa para garantizar la unificación.
 */
if (typeof window !== 'undefined') {
    const EPOCH_ID = 'sica_epoch_200_unified';
    if (localStorage.getItem('sica_active_epoch') !== EPOCH_ID) {
        console.log("NUCLEAR RESET: New Epoch Detected. Clearing everything...");
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('sica_active_epoch', EPOCH_ID);
        
        // Desregistrar SW y limpiar cachés
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
                for (let reg of regs) reg.unregister();
                window.location.reload();
            });
        } else {
            window.location.reload();
        }
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

