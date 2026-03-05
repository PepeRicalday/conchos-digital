/**
 * VersionGuard v3.0 — Sistema Robusto de Control de Versiones (Conchos Digital)
 * 
 * REGLAS:
 * 1. NUNCA bloquea la app completamente — siempre permite el uso.
 * 2. Solo muestra un banner informativo (no-bloqueante) si la versión
 *    local es MENOR que min_supported_version en Supabase.
 * 3. Si no hay conexión o falla la consulta → pasa silenciosamente.
 * 4. El banner se puede cerrar y no vuelve a aparecer en esa sesión.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert, X } from 'lucide-react';

const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

const isVersionLower = (current: string, min: string): boolean => {
    const c = current.split('.').map(Number);
    const m = min.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((c[i] || 0) < (m[i] || 0)) return true;
        if ((c[i] || 0) > (m[i] || 0)) return false;
    }
    return false;
};

export const VersionGuard = ({ children }: { children: ReactNode }) => {
    const [showBanner, setShowBanner] = useState(false);
    const [serverVersion, setServerVersion] = useState('');

    useEffect(() => {
        const SESSION_KEY = 'cd_version_dismissed';
        if (sessionStorage.getItem(SESSION_KEY) === CURRENT_VERSION) return;

        const checkVersion = async () => {
            try {
                if (!navigator.onLine) return;

                const { data, error } = await supabase
                    .from('app_versions')
                    .select('version, min_supported_version')
                    .eq('app_id', 'control-digital')
                    .single();

                if (error || !data) return;

                if (isVersionLower(CURRENT_VERSION, data.min_supported_version)) {
                    setServerVersion(data.min_supported_version);
                    setShowBanner(true);
                }
            } catch {
                // Fail-safe: NUNCA bloquear por error de red
            }
        };

        checkVersion();
    }, []);

    const handleDismiss = () => {
        setShowBanner(false);
        sessionStorage.setItem('cd_version_dismissed', CURRENT_VERSION);
    };

    const handleUpdate = async () => {
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
            console.warn('Cache clear partial:', e);
        }
        window.location.replace(window.location.origin + '?v=' + Date.now());
    };

    return (
        <>
            {showBanner && (
                <div className="bg-red-600 text-white text-xs py-2 px-4 flex items-center justify-between font-bold uppercase tracking-wider sticky top-0 z-[9999] shadow-lg">
                    <div className="flex items-center gap-2">
                        <ShieldAlert size={14} />
                        <span>Versión {CURRENT_VERSION} → Se requiere {serverVersion}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleUpdate}
                            className="bg-white text-red-600 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors text-[10px]"
                        >
                            Actualizar
                        </button>
                        <button onClick={handleDismiss} className="p-1 hover:bg-red-700 rounded">
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}
            {children}
        </>
    );
};
