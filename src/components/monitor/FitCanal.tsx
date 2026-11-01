import { useCallback, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * Encuadra el canal en el ÁREA LIBRE del mapa: mide cada elemento marcado con
 * `data-pm-overlay` que se superpone al mapa (pill de estado, leyenda, panel
 * inferior en tableta…) y lo convierte en padding de `fitBounds`, de modo que
 * ninguna ventana tape el trazo y éste quede centrado en lo que se ve.
 *
 * Se vuelve a ejecutar cuando cambia el tamaño del mapa o de cualquier overlay
 * (ResizeObserver) y cuando cambia `trigger` (panel abierto/cerrado, pestaña).
 * No se vuelve a encuadrar mientras el usuario hace zoom/arrastre: solo ante
 * cambios de distribución, o con el botón "Centrar canal" (`recentrarRef`).
 */
interface Props {
    puntos: [number, number][];
    activo: boolean;
    trigger: string;
    recentrarRef?: { current: (() => void) | null };
}

const MARGEN = 24; // px de aire alrededor del trazo

export default function FitCanal({ puntos, activo, trigger, recentrarRef }: Props) {
    const map = useMap();
    const raf = useRef<number | null>(null);

    const encuadrar = useCallback((animar = false) => {
        if (!activo || puntos.length < 2) return;
        const cont = map.getContainer();
        map.invalidateSize({ animate: false });
        const m = cont.getBoundingClientRect();
        if (m.width < 50 || m.height < 50) return;

        let top = 0, bottom = 0, left = 0, right = 0;
        const raiz = cont.closest('.public-monitor-container') ?? document;
        raiz.querySelectorAll<HTMLElement>('[data-pm-overlay], .leaflet-control-zoom').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            const ix = Math.min(r.right, m.right) - Math.max(r.left, m.left);
            const iy = Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top);
            if (ix <= 0 || iy <= 0) return; // no se superpone
            const cy = (r.top + r.bottom) / 2, cx = (r.left + r.right) / 2;
            const arriba = cy < m.top + m.height / 2;
            const derecha = cx > m.left + m.width / 2;
            // Reservar el lado que "cuesta" menos (fracción del alto o del ancho
            // que se pierde): una franja ancha reserva arriba/abajo, una columna
            // alta reserva izquierda/derecha y un elemento de esquina (leyenda,
            // zoom) el que le quite menos espacio al trazo.
            const pV = arriba ? r.bottom - m.top : m.bottom - r.top;
            const pH = derecha ? m.right - r.left : r.right - m.left;
            if (pV / m.height <= pH / m.width) {
                if (arriba) top = Math.max(top, pV); else bottom = Math.max(bottom, pV);
            } else {
                if (derecha) right = Math.max(right, pH); else left = Math.max(left, pH);
            }
        });

        // Nunca dejar menos del 35% del alto/ancho para el trazo
        const maxV = m.height * 0.65, maxH = m.width * 0.65;
        if (top + bottom > maxV) { const k = maxV / (top + bottom); top *= k; bottom *= k; }
        if (left + right > maxH) { const k = maxH / (left + right); left *= k; right *= k; }

        map.fitBounds(L.latLngBounds(puntos), {
            paddingTopLeft: [left + MARGEN, top + MARGEN],
            paddingBottomRight: [right + MARGEN, bottom + MARGEN],
            animate: animar,
            maxZoom: 12,
        });
    }, [map, puntos, activo]);

    const programar = useCallback((animar = false) => {
        if (raf.current !== null) cancelAnimationFrame(raf.current);
        // dos frames: deja que el layout (transiciones de panel) se asiente
        raf.current = requestAnimationFrame(() => {
            raf.current = requestAnimationFrame(() => { raf.current = null; encuadrar(animar); });
        });
    }, [encuadrar]);

    useEffect(() => {
        if (recentrarRef) recentrarRef.current = () => programar(true);
        return () => { if (recentrarRef) recentrarRef.current = null; };
    }, [recentrarRef, programar]);

    useEffect(() => { programar(false); }, [programar, trigger]);

    useEffect(() => {
        if (!activo || typeof ResizeObserver === 'undefined') return;
        const cont = map.getContainer();
        const raiz = cont.closest('.public-monitor-container');
        const ro = new ResizeObserver(() => programar(false));
        ro.observe(cont);
        raiz?.querySelectorAll('[data-pm-overlay]').forEach(el => ro.observe(el));
        return () => { ro.disconnect(); if (raf.current !== null) cancelAnimationFrame(raf.current); };
    }, [map, activo, programar, trigger]);

    return null;
}
