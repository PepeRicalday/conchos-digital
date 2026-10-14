import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/**
 * Aviso de pérdida de conexión. Esta app no tiene cola local de sincronización (las capturas offline viven en
 * sica-capture), así que NO se muestra ningún contador de "registros pendientes": antes era un mock fijo de 3.
 */
const OfflineIndicator = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    if (isOnline) return null; // Invisible si hay conexión

    return (
        <div role="status" className="fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl backdrop-blur-md border transition-all duration-500 bg-amber-900/90 border-amber-500/50 text-amber-100">
            <WifiOff size={20} />
            <div className="flex flex-col">
                <span className="text-sm font-bold leading-none">Sin conexión</span>
                <span className="text-xs opacity-80 leading-tight">Los datos mostrados pueden no estar actualizados.</span>
            </div>
        </div>
    );
};

export default OfflineIndicator;
