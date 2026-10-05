// Cotas oficiales por presa para la escala limnimétrica (separado del componente para no romper fast refresh).

export type TonoCota = 'muted' | 'warn' | 'alert' | 'info';

export interface CotaPresa {
    label: string;
    elev: number;
    tono: TonoCota;
}

export interface ConfigCotas {
    /** Elevación del fondo útil del vaso (inicio de la regla). */
    fondo: number;
    cotas: CotaPresa[];
    /** Procedencia de las cotas, para la nota al pie. */
    fuente: string;
}

/**
 * Cotas oficiales por presa, tomadas de las batimetrías vigentes:
 *  - Boquilla: levantamiento 2020 (hojas «Gráfica áreas-capacidades» y «Capacidad muerta»).
 *  - Madero: NAMO/NAME oficiales de CILA/SICA; fondo = inicio de la curva 2004 ajustada al volumen oficial.
 */
export const COTAS_OFICIALES: Record<string, ConfigCotas> = {
    'PRE-001': {
        fondo: 1265,
        fuente: 'Batimetría 2020 · CILA/USIBWC',
        cotas: [
            { label: 'Capacidad muerta', elev: 1278.9, tono: 'muted' },
            { label: 'NAMO', elev: 1317.0, tono: 'warn' },
            { label: 'NAME', elev: 1319.1, tono: 'alert' },
        ],
    },
    'PRE-002': {
        fondo: 1220.69,
        fuente: 'Batimetría 2004 ajustada al volumen oficial',
        cotas: [
            { label: 'NAMO', elev: 1239.3, tono: 'warn' },
            { label: 'NAME', elev: 1242.56, tono: 'alert' },
        ],
    },
};
