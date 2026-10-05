/**
 * saludRed — estado de la red de estaciones (lectura de fn_clima_salud_red) y su presentación.
 *
 * Un solo criterio de frescura para toda la UI, alineado con el diseño del cron (WeatherLink se sincroniza cada
 * 2 h): VIGENTE ≤ 150 min · RETRASADA ≤ 6 h · SIN_SEÑAL > 6 h. Antes convivían dos umbrales distintos
 * (3 h en useClimaEstaciones y 20/60 min en cielo.ts) que con un cron de 2 h marcaban casi todo como vencido.
 */

export type EstadoRed = 'VIGENTE' | 'RETRASADA' | 'SIN_SEÑAL';

export const VIGENTE_MAX_MIN = 150;
export const RETRASADA_MAX_MIN = 360;

/** Fila tal como la devuelve fn_clima_salud_red(). */
export interface FilaSaludRed {
    estacion_id: string;
    nombre: string;
    rol: string | null;
    modulo_id: string | null;
    ultima_lectura: string | null;
    edad_min: number | null;
    bloques_con_dato: number;
    bloques_completos: number;
    cobertura_48h_pct: number | string | null;
    hueco_max_h_7d: number | string | null;
    lecturas_7d: number;
    bloques_2h: boolean[] | null;
    estado: EstadoRed;
    temp_ultima_c: number | string | null;
    desviacion_temp_c: number | string | null;
    sospechosa: boolean | null;
}

export interface EstacionSalud {
    id: string;
    nombre: string;
    rol: string | null;
    moduloId: string | null;
    ultimaLectura: string | null;
    edadMin: number | null;
    coberturaPct: number | null;
    huecoMaxH: number | null;
    lecturas7d: number;
    bloques: boolean[];
    estado: EstadoRed;
    sospechosa: boolean;
    desviacionTempC: number | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Clasifica por edad; igual que la función SQL (se usa para refrescar en el cliente sin volver a consultar). */
export function estadoPorEdad(edadMin: number | null): EstadoRed {
    if (edadMin == null || !Number.isFinite(edadMin)) return 'SIN_SEÑAL';
    return edadMin <= VIGENTE_MAX_MIN ? 'VIGENTE' : edadMin <= RETRASADA_MAX_MIN ? 'RETRASADA' : 'SIN_SEÑAL';
}

export function normalizaSalud(f: FilaSaludRed): EstacionSalud {
    return {
        id: f.estacion_id,
        nombre: f.nombre,
        rol: f.rol,
        moduloId: f.modulo_id,
        ultimaLectura: f.ultima_lectura,
        edadMin: f.edad_min,
        coberturaPct: num(f.cobertura_48h_pct),
        huecoMaxH: num(f.hueco_max_h_7d),
        lecturas7d: f.lecturas_7d,
        bloques: f.bloques_2h ?? [],
        estado: f.estado,
        sospechosa: !!f.sospechosa,
        desviacionTempC: num(f.desviacion_temp_c),
    };
}

/** "hace 16 min", "hace 2 h 10 min", "hace 3 d"; "sin lecturas" si no hay dato. */
export function textoEdad(edadMin: number | null): string {
    if (edadMin == null || !Number.isFinite(edadMin)) return 'sin lecturas';
    if (edadMin < 1) return 'hace instantes';
    if (edadMin < 60) return `hace ${Math.round(edadMin)} min`;
    if (edadMin < 24 * 60) {
        const h = Math.floor(edadMin / 60);
        const m = Math.round(edadMin - h * 60);
        return m > 0 ? `hace ${h} h ${m} min` : `hace ${h} h`;
    }
    return `hace ${Math.round(edadMin / 1440)} d`;
}

export const ETIQUETA_ESTADO: Record<EstadoRed, string> = {
    VIGENTE: 'Vigente',
    RETRASADA: 'Retrasada',
    SIN_SEÑAL: 'Sin señal',
};

export interface ResumenRed {
    total: number;
    vigentes: number;
    retrasadas: number;
    sinSenal: number;
    sospechosas: number;
    /** Promedio de cobertura 48 h de las estaciones que la reportan; null si ninguna. */
    coberturaMediaPct: number | null;
}

export function resumenRed(estaciones: EstacionSalud[]): ResumenRed {
    const cobs = estaciones.map(e => e.coberturaPct).filter((v): v is number => v != null);
    return {
        total: estaciones.length,
        vigentes: estaciones.filter(e => e.estado === 'VIGENTE').length,
        retrasadas: estaciones.filter(e => e.estado === 'RETRASADA').length,
        sinSenal: estaciones.filter(e => e.estado === 'SIN_SEÑAL').length,
        sospechosas: estaciones.filter(e => e.sospechosa).length,
        coberturaMediaPct: cobs.length ? cobs.reduce((a, b) => a + b, 0) / cobs.length : null,
    };
}

/** Frase de una línea para el encabezado de la red: "5 de 6 vigentes · 1 con lecturas sospechosas". */
export function fraseRed(r: ResumenRed): string {
    if (r.total === 0) return 'Sin estaciones configuradas';
    const partes = [`${r.vigentes} de ${r.total} vigentes`];
    if (r.retrasadas) partes.push(`${r.retrasadas} retrasada${r.retrasadas > 1 ? 's' : ''}`);
    if (r.sinSenal) partes.push(`${r.sinSenal} sin señal`);
    if (r.sospechosas) partes.push(`${r.sospechosas} con lecturas sospechosas`);
    return partes.join(' · ');
}
