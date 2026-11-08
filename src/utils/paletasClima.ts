// ═══════════════════════════════════════════════════════════════════════════
// Paletas y niveles fijos de los planos climáticos de la cuenca (isoyetas, temperatura, viento, humedad)
// ---------------------------------------------------------------------------
// Mismas rampas secuenciales de un solo tono que el Informe Geoclimático del distrito (nunca arcoíris), más una de humedad
// verde-azulada distinta del azul de lluvia. A diferencia de ese informe, los NIVELES son FIJOS: dos informes de fechas distintas se
// comparan a ojo (un rango dinámico haría que el mismo color significara cosas distintas).
// ═══════════════════════════════════════════════════════════════════════════

export type VariablePlano = 'lluvia' | 'temperatura' | 'viento' | 'humedad';

export interface ConfigVariable {
    clave: VariablePlano;
    titulo: string;
    unidad: string;
    decimales: number;
    /** 8 pasos de la rampa, de menor a mayor intensidad. */
    rampa: string[];
    /** Valor mínimo físico (lluvia, viento, humedad no bajan de 0) y máximo (humedad 100 %). */
    piso: number | null;
    techo: number | null;
}

export const VARIABLES_PLANO: Record<VariablePlano, ConfigVariable> = {
    lluvia: { clave: 'lluvia', titulo: 'Lluvia', unidad: 'mm', decimales: 0, piso: 0, techo: null,
        rampa: ['#eef1f4', '#dbe8f5', '#b3d3f0', '#7fb5e8', '#4a90da', '#2465b8', '#123f85', '#0a2456'] },
    temperatura: { clave: 'temperatura', titulo: 'Temperatura media', unidad: '°C', decimales: 0, piso: null, techo: null,
        rampa: ['#fff6e0', '#fde3ad', '#fbc178', '#f59349', '#e2622c', '#c13a1f', '#8f1f16', '#5c0f0f'] },
    viento: { clave: 'viento', titulo: 'Viento medio', unidad: 'km/h', decimales: 0, piso: 0, techo: null,
        rampa: ['#f5f0fa', '#ddc9ee', '#c19ee0', '#a06fcf', '#8247bd', '#652da0', '#481d78', '#2c0f4d'] },
    humedad: { clave: 'humedad', titulo: 'Humedad relativa', unidad: '%', decimales: 0, piso: 0, techo: 100,
        rampa: ['#f0f7f4', '#d3ebe3', '#a9d9cc', '#7cc5b4', '#4aa99a', '#2b8a7e', '#17675f', '#0b443f'] },
};

import { escalaDe } from './escalasCuenca';

/** Isoyetas: mm acumulados en la ventana (observada o pronosticada). 1 mm es el umbral de "día con lluvia". */
export const NIVELES_LLUVIA = [1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150];
export const NIVELES_VIENTO = [2, 4, 6, 8, 10, 15, 20];
export const NIVELES_HUMEDAD = [20, 30, 40, 50, 60, 70, 80, 90];

/** Temperatura: un nivel cada `paso` °C que cubra el rango del corte (los valores sí son fijos: múltiplos de 2 °C). */
export function nivelesTemperatura(min: number, max: number, paso = 2): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
    const ini = Math.floor(min / paso) * paso + paso, fin = Math.ceil(max / paso) * paso - paso;
    const out: number[] = [];
    for (let v = ini; v <= fin + 1e-9; v += paso) out.push(Math.round(v * 100) / 100);
    // Cinco niveles como mínimo: con un rango muy corto se agrega un nivel a cada lado para que el plano no quede en un solo color.
    while (out.length < 3) { out.unshift(out[0] - paso); out.push(out[out.length - 1] + paso); }
    return out;
}

/**
 * Cortes del plano: la ESCALA FIJA por variable derivada de lo registrado (utils/escalasCuenca.ts), la misma en pantalla, informes y lámina.
 * Para lluvia depende de los días que acumula el plano (hoy/ayer, 7 d, 30 d). Sin `dias` se usa la escala mensual.
 * `min`/`max` solo se usan si la escala registrada no aplica (compatibilidad): la temperatura ya no se ajusta al rango de cada plano.
 */
export function nivelesDe(v: VariablePlano, _min?: number, _max?: number, dias = 30): number[] {
    return escalaDe(v, dias).niveles;
}

const hexN = (h: string) => parseInt(h.slice(1), 16);
export function mezclaHex(h1: string, h2: string, t: number): string {
    const a = hexN(h1), b = hexN(h2);
    const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
    return `#${((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1)}`;
}

/** Color de la banda `k` (0 = por debajo del primer nivel) entre `n` niveles: posición proporcional en la rampa de 8 pasos. */
export function colorBanda(v: VariablePlano, k: number, n: number): string {
    const rampa = VARIABLES_PLANO[v].rampa;
    const t = n <= 0 ? 0 : Math.max(0, Math.min(1, k / n));
    const pos = t * (rampa.length - 1), i0 = Math.min(rampa.length - 2, Math.floor(pos));
    return mezclaHex(rampa[i0], rampa[i0 + 1], pos - i0);
}

/** Texto de un valor del plano, con su unidad: "50 mm", "18 °C". */
export const fmtNivel = (v: VariablePlano, x: number) => `${x.toFixed(VARIABLES_PLANO[v].decimales)} ${VARIABLES_PLANO[v].unidad}`;
