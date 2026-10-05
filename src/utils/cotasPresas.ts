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
 *  - Madero: NAMO/NAME oficiales de CILA/SICA; la curva es la tabla oficial derivada de 1,542 pares escala-volumen
 *    de los reportes mensuales de la SRL (fondo = menor escala observada).
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
        fondo: 1223.75,
        fuente: 'Tabla oficial SRL · reportes 2021–2025',
        cotas: [
            { label: 'NAMO', elev: 1239.3, tono: 'warn' },
            { label: 'NAME', elev: 1242.56, tono: 'alert' },
        ],
    },
};
