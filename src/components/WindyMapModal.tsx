import { useEffect } from 'react';
import { X, Satellite } from 'lucide-react';

interface WindyMapModalProps {
    abierto: boolean;
    onCerrar: () => void;
    lat: number;
    lon: number;
    /** Nivel de zoom de Windy (1-18 aprox). Default 8: encuadra el distrito. */
    zoom?: number;
    /** Capa por defecto del embed. */
    overlay?: 'rain' | 'clouds' | 'wind';
    titulo?: string;
}

/**
 * Mapa satelital animado (nubosidad/precipitación/viento) vía el embed público
 * de Windy.com — sin API key. Reutilizado en Clima.tsx y GeoMonitor.tsx: un solo
 * componente controlado por el estado `abierto` de cada página consumidora.
 */
export function WindyMapModal({
    abierto, onCerrar, lat, lon, zoom = 8, overlay = 'rain', titulo = 'Mapa animado de clima',
}: WindyMapModalProps) {
    // Comportamiento de diálogo modal: Escape cierra, el fondo no se desplaza
    // bajo el overlay mientras está abierto (mismo patrón de EstacionDetalle.tsx).
    useEffect(() => {
        if (!abierto) return;
        const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
        document.addEventListener('keydown', alPulsar);
        const overflowPrevio = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', alPulsar);
            document.body.style.overflow = overflowPrevio;
        };
    }, [abierto, onCerrar]);

    if (!abierto) return null;

    const src = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}`
        + `&detailLat=${lat}&detailLon=${lon}&width=650&height=450&zoom=${zoom}`
        + `&level=surface&overlay=${overlay}&product=ecmwf&menu=&message=true`
        + `&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=`
        + `&metricWind=default&metricTemp=default&radarRange=-1`;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
            onClick={onCerrar}
            role="presentation"
        >
            <div
                className="glass-card shadow-2xl p-4 w-full max-w-4xl border-white/10"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={titulo}
            >
                <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/5">
                    <div className="flex items-center gap-3">
                        <Satellite size={22} className="text-primary" />
                        <div>
                            <h2 className="text-lg font-black text-white uppercase tracking-wider">{titulo}</h2>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">
                                Nubosidad y precipitación en vivo · Windy.com
                            </p>
                        </div>
                    </div>
                    <button
                        className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
                        onClick={onCerrar}
                        title="Cerrar"
                    >
                        <X size={18} className="text-slate-400" />
                    </button>
                </div>
                <div className="h-[70vh] w-full">
                    <iframe
                        src={src}
                        width="100%"
                        height="100%"
                        loading="lazy"
                        title="Mapa animado Windy.com"
                        style={{ border: 0, borderRadius: 8 }}
                        allowFullScreen
                    />
                </div>
            </div>
        </div>
    );
}
