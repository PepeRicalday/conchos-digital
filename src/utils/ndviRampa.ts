/**
 * ndviRampa — fuente única de color y clase agronómica del NDVI (antes: dos semáforos rojo→verde duplicados que no
 * coincidían con la capa satelital). Rampa secuencial de UNA dirección (arena → verde oscuro), con luminosidad
 * monótona decreciente: se distingue sin depender del tono (daltonismo) y significa "más vegetación = más oscuro".
 */

export interface ClaseNdvi {
    clave: 'suelo' | 'bajo' | 'medio' | 'alto' | 'muyalto';
    etiqueta: string;
    /** Rango [desde, hasta) en NDVI. */
    desde: number;
    hasta: number;
    color: string;
    /** Texto para el operador. */
    significado: string;
}

export const CLASES_NDVI: ClaseNdvi[] = [
    { clave: 'suelo', etiqueta: 'Suelo desnudo', desde: -Infinity, hasta: 0.15, color: '#D9C9A0', significado: 'Sin cobertura vegetal o terreno en barbecho' },
    { clave: 'bajo', etiqueta: 'Vigor bajo', desde: 0.15, hasta: 0.3, color: '#B7C26E', significado: 'Cultivo en emergencia o con estrés' },
    { clave: 'medio', etiqueta: 'Vigor medio', desde: 0.3, hasta: 0.5, color: '#6FB15A', significado: 'Cobertura en desarrollo' },
    { clave: 'alto', etiqueta: 'Vigor alto', desde: 0.5, hasta: 0.7, color: '#2E8B57', significado: 'Cobertura plena y sana' },
    { clave: 'muyalto', etiqueta: 'Vigor muy alto', desde: 0.7, hasta: Infinity, color: '#14532D', significado: 'Biomasa máxima' },
];

/** NDVI agrícola real vive en ~0.1–0.8: la escala del mapa va de 0 a 0.8 (no de 0 a 1). */
export const NDVI_RANGO: [number, number] = [0, 0.8];

/** Clase de un valor; null/NaN → null (S/D, nunca "suelo desnudo"). */
export function claseNdvi(v: number | null | undefined): ClaseNdvi | null {
    if (v == null || !Number.isFinite(v)) return null;
    return CLASES_NDVI.find((c) => v >= c.desde && v < c.hasta) ?? CLASES_NDVI[CLASES_NDVI.length - 1];
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Paradas de la rampa continua (para el coroplético): valor NDVI → color de la clase.
const PARADAS: { v: number; rgb: [number, number, number] }[] = [
    { v: 0.05, rgb: hex(CLASES_NDVI[0].color) },
    { v: 0.225, rgb: hex(CLASES_NDVI[1].color) },
    { v: 0.4, rgb: hex(CLASES_NDVI[2].color) },
    { v: 0.6, rgb: hex(CLASES_NDVI[3].color) },
    { v: 0.8, rgb: hex(CLASES_NDVI[4].color) },
];

/** Color continuo (interpolado entre las clases) para rellenar un polígono; null → gris neutro. */
export function colorNdvi(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '#334155';
    if (v <= PARADAS[0].v) return `rgb(${PARADAS[0].rgb.join(',')})`;
    const ult = PARADAS[PARADAS.length - 1];
    if (v >= ult.v) return `rgb(${ult.rgb.join(',')})`;
    for (let i = 0; i < PARADAS.length - 1; i++) {
        const a = PARADAS[i], b = PARADAS[i + 1];
        if (v >= a.v && v <= b.v) {
            const f = (v - a.v) / (b.v - a.v);
            const c = a.rgb.map((x, k) => Math.round(x + (b.rgb[k] - x) * f));
            return `rgb(${c.join(',')})`;
        }
    }
    return `rgb(${ult.rgb.join(',')})`;
}

/** Luminancia relativa WCAG de un color #RRGGBB (para verificar que la rampa es monótona). */
export function luminancia(h: string): number {
    const [r, g, b] = hex(h).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
