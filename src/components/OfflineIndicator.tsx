import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

const OfflineIndicator = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingSyncs, setPendingSyncs] = useState(0);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Simular chequeo de cola de sincronización (esto vendría de IndexedDB/SW)
        const checkSyncQueue = () => {
            // Mock
            setPendingSyncs(isOnline ? 0 : 3);
        };

        checkSyncQueue();
        const interval = setInterval(checkSyncQueue, 5000);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(interval);
        };
    }, [isOnline]);

    if (isOnline && pendingSyncs === 0) return null; // Invisible si todo está OK

    return (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl backdrop-blur-md border transition-all duration-500 ${isOnline ? 'bg-blue-900/80 border-blue-500/50 text-blue-100' : 'bg-amber-900/90 border-amber-500/50 text-amber-100'}`}>
            <div className="relative">
                {isOnline ? <RefreshCw size={20} className="animate-spin" /> : <WifiOff size={20} />}
                {pendingSyncs > 0 && !isOnline && (
                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-amber-900">
                        {pendingSyncs}
                    </span>
                )}
            </div>

            <div className='flex flex-col'>
                <span className="text-sm font-bold leading-none">
                    {isOnline ? 'Sincronizando...' : 'Modo Offline'}
                </span>
                <span className="text-xs opacity-80 leading-tight">
                    {isOnline
                        ? 'Actualizando base de datos...'
                        : `${pendingSyncs} registros pendientes`
                    }
                </span>
            </div>
        </div>
    );
};

export default OfflineIndicator;
