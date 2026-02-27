import type { ReactNode } from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { AlertTriangle, RefreshCw } from 'lucide-react';

function ErrorFallback({ error, resetErrorBoundary }: any) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
            <div className="bg-red-500/10 p-4 rounded-full mb-4">
                <AlertTriangle className="text-red-400 w-12 h-12" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Error Crítico de Renderizado</h2>
            <p className="text-slate-400 max-w-md mb-6 text-sm">
                Se detectó una excepción inesperada. Hidro-Sincronía ha capturado el error para evitar el cierre completo.
            </p>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 w-full max-w-lg mb-6 overflow-auto text-left shadow-inner">
                <code className="text-red-400 text-xs font-mono">{error.message}</code>
            </div>
            <button
                onClick={resetErrorBoundary}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition-colors shadow-lg shadow-blue-500/20"
            >
                <RefreshCw size={18} /> Reintentar Carga
            </button>
        </div>
    );
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
    return (
        <ReactErrorBoundary
            FallbackComponent={ErrorFallback}
            onReset={() => {
                // Posible limpieza central
                window.location.reload();
            }}
        >
            {children}
        </ReactErrorBoundary>
    );
}
