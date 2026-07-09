import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// ── Recuperación de caché envenenada ────────────────────────────────────────
// Tras un deploy, un Service Worker/caché viejo puede pedir un chunk JS con hash
// que ya no existe; el rewrite de Vercel respondía index.html (text/html) y el
// navegador lanzaba "'text/html' is not a valid JavaScript MIME type", dejando
// la app muerta en bucle (un reload normal reusa el mismo SW envenenado).
// Estas señales identifican ese caso para forzar una limpieza REAL.
function esErrorDeCacheViciada(msg: string): boolean {
    return /valid JavaScript MIME type|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unexpected token '<'|ChunkLoadError/i.test(msg);
}

// Limpia SW + caches + un flag de "ya limpié" para no entrar en bucle infinito,
// y redirige al limpiador brutal (nuke.html) que además purga IndexedDB.
async function limpiarYRecuperar(): Promise<void> {
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
        if ('caches' in window) {
            const names = await caches.keys();
            await Promise.all(names.map(n => caches.delete(n)));
        }
    } catch { /* seguimos al nuke igual */ }
    window.location.replace(`/nuke.html?from=mime&t=${Date.now()}`);
}

function ErrorFallback({ error, resetErrorBoundary }: any) {
    const msg: string = error?.message || String(error);
    const esCache = esErrorDeCacheViciada(msg);

    // Auto-recuperación: si es error de caché viciada y no lo intentamos ya en
    // esta pestaña, limpiamos y redirigimos sin que el usuario tenga que actuar.
    useEffect(() => {
        if (!esCache) return;
        if (sessionStorage.getItem('mime_recovery_done')) return; // ya intentado → evita bucle
        sessionStorage.setItem('mime_recovery_done', '1');
        limpiarYRecuperar();
    }, [esCache]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
            <div className="bg-red-500/10 p-4 rounded-full mb-4">
                <AlertTriangle className="text-red-400 w-12 h-12" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">
                {esCache ? 'Actualizando versión…' : 'Error Crítico de Renderizado'}
            </h2>
            <p className="text-slate-400 max-w-md mb-6 text-sm">
                {esCache
                    ? 'Se detectó una versión en caché desactualizada. Limpiando y recargando la aplicación automáticamente…'
                    : 'Se detectó una excepción inesperada. Hidro-Sincronía ha capturado el error para evitar el cierre completo.'}
            </p>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 w-full max-w-lg mb-6 overflow-auto text-left shadow-inner">
                <code className="text-red-400 text-xs font-mono">{msg}</code>
            </div>
            <button
                onClick={() => { void limpiarYRecuperar(); resetErrorBoundary?.(); }}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-blue-500/20"
            >
                <RefreshCw size={18} /> {esCache ? 'Limpiar caché y recargar' : 'Reintentar Carga'}
            </button>
        </div>
    );
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ReactErrorBoundary
            FallbackComponent={ErrorFallback}
            onReset={() => {
                window.location.reload();
            }}
        >
            {children}
        </ReactErrorBoundary>
    );
}
