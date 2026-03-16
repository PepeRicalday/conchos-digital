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
import { ShieldAlert, X, Activity } from 'lucide-react';

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
        // En modo forzado, ya no permitimos descartar si la versión es crítica
        // setShowBanner(false);
        // sessionStorage.setItem('cd_version_dismissed', CURRENT_VERSION);
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
                <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-[99999] flex items-center justify-center p-6 text-center">
                    <div className="max-w-sm w-full bg-slate-900 border border-red-500/30 rounded-2xl p-8 shadow-2xl animate-in zoom-in duration-300">
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                            <ShieldAlert size={32} className="text-red-500 animate-pulse" />
                        </div>
                        
                        <h2 className="text-xl font-black text-white mb-2 tracking-tight">ACTUALIZACIÓN OBLIGATORIA</h2>
                        <p className="text-sm text-slate-400 mb-8 leading-relaxed">
                            Detectamos una versión antigua ({CURRENT_VERSION}). <br/>
                            Se requiere la <b>v{serverVersion}</b> para asegurar la integridad de los datos hidráulicos.
                        </p>

                        <button
                            onClick={handleUpdate}
                            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg active:scale-95 flex items-center justify-center gap-3"
                        >
                            <Activity size={18} />
                            ACTUALIZAR AHORA
                        </button>
                        
                        <div className="mt-6 text-[10px] text-slate-600 uppercase tracking-widest font-mono">
                            SICA 005 — DIGITAL SYNCHRONY
                        </div>
                    </div>
                </div>
            )}
            {children}
        </>
    );
};
