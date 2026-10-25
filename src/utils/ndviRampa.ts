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

/** Marcas del eje de NDVI (cada 0.2 dentro de NDVI_RANGO): una sola definición para gráficas y SVG de informes. */
export const NDVI_TICKS: number[] = Array.from({ length: Math.round((NDVI_RANGO[1] - NDVI_RANGO[0]) / 0.2) + 1 }, (_, i) => Number((NDVI_RANGO[0] + 0.2 * i).toFixed(1)));

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

/** Color DISCRETO de la clase de vigor (el mismo de la leyenda y del raster); null (S/D) → null: el llamador dibuja el hachurado. */
export function colorClaseNdvi(v: number | null | undefined): string | null {
    return claseNdvi(v)?.color ?? null;
}

/** Fondo y trazo del hachurado S/D (único en plano, tablas, barras y leyenda del informe). */
export const SD_FONDO = '#e9e7e2';
export const SD_TRAZO = '#a8afb7';

/** Color continuo (interpolado entre las clases) para la pantalla; null → el fondo neutro de S/D (ya no un slate oscuro). El informe usa colorClaseNdvi. */
export function colorNdvi(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return SD_FONDO;
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

/**
 * Tinta del texto sobre un fondo #RRGGBB: negro o blanco, el que dé más contraste. El cruce entre ambos está en L ≈ 0.179
 * (no 0.3): con 0.3 el texto sobre "Vigor alto" (L 0.197) saldría blanco con solo 4.25:1; en negro llega a 4.94:1.
 */
export const UMBRAL_LUMINANCIA_TINTA = 0.179;
export function tintaSobre(fondoHex: string): '#000000' | '#ffffff' {
    return luminancia(fondoHex) > UMBRAL_LUMINANCIA_TINTA ? '#000000' : '#ffffff';
}

/** Contraste WCAG entre dos colores #RRGGBB. */
export function contraste(a: string, b: string): number {
    const [x, y] = [luminancia(a), luminancia(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Gris percibido (0–255, BT.601) de un #RRGGBB: lo que queda al imprimir en escala de grises. */
export function grisPercibido(h: string): number {
    const [r, g, b] = hex(h);
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ── Clases discretas de ICV / IHR (0–100) para el coroplético: mismas etiquetas y cortes que indicesSrl.ts ──────────────────
export interface ClaseIndiceDiscreta { etiqueta: string; desde: number; hasta: number; color: string }
/** Cuatro pasos de una sola rampa (arena → verde oscuro, luminosidad decreciente): no depende del tono para distinguirse. */
const PASOS_INDICE = [CLASES_NDVI[0].color, CLASES_NDVI[2].color, CLASES_NDVI[3].color, CLASES_NDVI[4].color];
const clasesDe = (cortes: number[], etiquetas: string[]): ClaseIndiceDiscreta[] =>
    etiquetas.map((etiqueta, i) => ({ etiqueta, desde: i === 0 ? 0 : cortes[i - 1], hasta: i === cortes.length ? 100 : cortes[i], color: PASOS_INDICE[i] }));
export const CLASES_ICV = clasesDe([25, 50, 75], ['Crítico', 'Regular', 'Bueno', 'Óptimo']);
export const CLASES_IHR = clasesDe([40, 60, 80], ['Muy irregular', 'Irregular', 'Aceptable', 'Homogéneo']);

/** Clase de un valor ICV/IHR; null/NaN → null (S/D). El techo (100) cae en la última clase. */
export function claseIndice(clave: 'icv' | 'ihr', v: number | null | undefined): ClaseIndiceDiscreta | null {
    if (v == null || !Number.isFinite(v)) return null;
    const clases = clave === 'icv' ? CLASES_ICV : CLASES_IHR;
    return clases.find((c) => v >= c.desde && v < c.hasta) ?? clases[clases.length - 1];
}
