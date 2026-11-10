import { useMapEvents, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import type { ViewportBounds } from './geoConfig';

/** Reporta zoom + bounds del mapa Leaflet al estado de React — usado para
 *  decidir qué módulos de lotes cargar bajo demanda sin montar un mapa nuevo. */
export function MapViewportWatcher({ onChange }: { onChange: (zoom: number, bounds: ViewportBounds) => void }) {
    const map = useMapEvents({
        zoomend: () => {
            const b = map.getBounds();
            onChange(map.getZoom(), { minLon: b.getWest(), minLat: b.getSouth(), maxLon: b.getEast(), maxLat: b.getNorth() });
        },
        moveend: () => {
            const b = map.getBounds();
            onChange(map.getZoom(), { minLon: b.getWest(), minLat: b.getSouth(), maxLon: b.getEast(), maxLat: b.getNorth() });
        },
    });
    // moveend/zoomend no disparan al montar — se reporta el viewport inicial
    // una vez para que la capa de lotes funcione sin que el usuario mueva el mapa antes.
    useEffect(() => {
        const b = map.getBounds();
        onChange(map.getZoom(), { minLon: b.getWest(), minLat: b.getSouth(), maxLon: b.getEast(), maxLat: b.getNorth() });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
}

/** Leaflet cachea el tamaño de su contenedor al montar y NO lo recalcula solo
 *  — al entrar/salir de pantalla completa (CSS-only: position:fixed;inset:0)
 *  el mapa sigue creyendo que mide lo de antes: tiles grises en la franja
 *  nueva, bounds reportados incorrectos a MapViewportWatcher (contamina qué
 *  lotes se cargan), y clics que caen desplazados del punto visible. Solo
 *  invalidateSize() fuerza el recálculo real (bug confirmado, auditoría
 *  GEO-MONITOR sep-2026). El pequeño delay espera a que la transición CSS del
 *  contenedor termine antes de medir. */
export function MapFullscreenInvalidator({ isFullscreen }: { isFullscreen: boolean }) {
    const map = useMap();
    useEffect(() => {
        const t = setTimeout(() => map.invalidateSize(), 150);
        return () => clearTimeout(t);
    }, [map, isFullscreen]);
    return null;
}
