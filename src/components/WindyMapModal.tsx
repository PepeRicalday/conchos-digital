import { Satellite } from 'lucide-react';
import { Modal } from './ui/base';

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
 * Usa el Modal base: foco atrapado, Escape, scroll bloqueado y el fondo deja libre el menú lateral.
 */
export function WindyMapModal({
    abierto, onCerrar, lat, lon, zoom = 8, overlay = 'rain', titulo = 'Mapa animado de clima',
}: WindyMapModalProps) {
    const src = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}`
        + `&detailLat=${lat}&detailLon=${lon}&width=650&height=450&zoom=${zoom}`
        + `&level=surface&overlay=${overlay}&product=ecmwf&menu=&message=true`
        + `&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=`
        + `&metricWind=default&metricTemp=default&radarRange=-1`;

    return (
        <Modal
            abierto={abierto} onCerrar={onCerrar} tamano="lg" cubreSidebar={false}
            titulo={titulo} kicker="Nubosidad y precipitación en vivo · Windy.com"
            icono={<Satellite size={22} aria-hidden="true" />}
        >
            <div style={{ height: '70vh', width: '100%' }}>
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
        </Modal>
    );
}
