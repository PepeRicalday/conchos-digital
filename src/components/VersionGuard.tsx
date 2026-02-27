import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert } from 'lucide-react';

interface VersionInfo {
    version: string;
    min_supported_version: string;
    update_url: string;
    build_hash: string;
}

const CURRENT_VERSION = __APP_VERSION__;

export const VersionGuard = ({ children }: { children: ReactNode }) => {
    const [status, setStatus] = useState<'checking' | 'ok' | 'hard_update' | 'error'>('checking');
    const [serverInfo, setServerInfo] = useState<VersionInfo | null>(null);

    useEffect(() => {
        const checkVersion = async () => {
            try {
                const { data, error } = await supabase
                    .from('app_versions')
                    .select('version, min_supported_version, update_url, build_hash')
                    .eq('app_id', 'control-digital')
                    .single();

                if (error) throw error;
                if (!data) return setStatus('ok');

                setServerInfo(data);

                if (isVersionLower(CURRENT_VERSION, data.min_supported_version)) {
                    setStatus('hard_update');
                    return;
                }

                setStatus('ok');
            } catch (err) {
                console.error('Failed to check version:', err);
                setStatus('ok');
            }
        };

        checkVersion();
    }, []);

    // Aggressive cache clearing on hard update
    useEffect(() => {
        if (status === 'hard_update') {
            const clearCaches = async () => {
                try {
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        for (let registration of registrations) {
                            await registration.unregister();
                        }
                    }
                    if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        for (let name of cacheNames) {
                            await caches.delete(name);
                        }
                    }
                    console.log('Caches cleared due to hard update requirement.');
                } catch (e) {
                    console.error('Error clearing caches:', e);
                }
            };
            clearCaches();
        }
    }, [status]);

    const isVersionLower = (current: string, min: string) => {
        const c = current.split('.').map(Number);
        const m = min.split('.').map(Number);
        for (let i = 0; i < 3; i++) {
            if (c[i] < m[i]) return true;
            if (c[i] > m[i]) return false;
        }
        return false;
    };

    if (status === 'checking') {
        return (
            <div className="min-h-screen bg-[#0b1120] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (status === 'hard_update' && serverInfo) {
        return (
            <>
                <div className="bg-red-600 text-white text-xs py-2 px-6 flex items-center justify-between font-bold uppercase tracking-wider sticky top-0 z-[9999] shadow-lg">
                    <div className="flex items-center gap-2">
                        <ShieldAlert size={14} />
                        <span>Plataforma Desactualizada (v{CURRENT_VERSION} &lt; v{serverInfo.min_supported_version}) - Se requiere actualización para integridad SRL.</span>
                    </div>
                    <a href={serverInfo.update_url} className="bg-white text-red-600 px-3 py-1 rounded-full hover:bg-slate-100 transition-colors text-[10px]">
                        Actualizar Ahora
                    </a>
                </div>
                {children}
            </>
        );
    }

    return <>{children}</>;
};
