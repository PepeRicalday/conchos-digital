/**
 * cultivosCiclo — resumen de los cultivos sembrados del ciclo y su volumen, para la tarjeta Ciclo del Dashboard.
 * Fuente: ACUM_INF (superficie_volumen_anual_modulo), el mismo dato del panel «Más agua, más vegetación» de Geo-Monitor.
 * Reglas: S/D es null (nunca 0); un año sin ciclo de riego (presas cerradas) es «sin-ciclo», no S/D ni 0.
 */
import type { FilaSupVol } from './ndviInteranual';
import { ANIO_INFORME_FIN, esAnioSinCiclo } from './estadoAnio';
import { mezclaCultivos, topConOtros, type ParteTop } from './volumenCultivo';

export interface ResumenCultivosCiclo {
    anio: number;
    estado: 'ok' | 'sin-ciclo' | 'sd';
    superficieHa: number | null;
    volumenHm3: number | null;
    /** Cultivos distintos con volumen (los compuestos del informe cuentan como «Otros»). */
    nCultivos: number;
    /** Los 3 cultivos con más volumen y «Otros» con el resto. */
    partes: ParteTop[];
    /** Cultivo con más volumen; null si no hay dato. */
    lider: ParteTop | null;
}

/** Año del informe que corresponde al ciclo: el año en que termina (ciclo 2025-2026 → 2026). Sin fecha de fin, el último año del informe. */
export function anioDelCiclo(fechaFin: string | null | undefined): number {
    const y = fechaFin ? Number(String(fechaFin).slice(0, 4)) : NaN;
    return Number.isFinite(y) && y > 2000 ? y : ANIO_INFORME_FIN;
}

const suma = (v: (number | null)[]): number | null => {
    const x = v.filter((n): n is number => n != null && Number.isFinite(n));
    return x.length ? x.reduce((a, b) => a + b, 0) : null;
};

export function resumenCultivosCiclo(filas: FilaSupVol[] | null | undefined, anio: number, n = 3): ResumenCultivosCiclo {
    const vacio = (estado: 'sin-ciclo' | 'sd'): ResumenCultivosCiclo => ({ anio, estado, superficieHa: null, volumenHm3: null, nCultivos: 0, partes: [], lider: null });
    if (esAnioSinCiclo(anio)) return vacio('sin-ciclo');
    if (!filas) return vacio('sd');
    const mezcla = mezclaCultivos(filas, null, anio);
    const partes = topConOtros(mezcla, 'volumen', n);
    if (!partes.length) return vacio('sd');
    return {
        anio, estado: 'ok',
        superficieHa: suma(mezcla.map(m => m.superficieHa)),
        volumenHm3: suma(mezcla.map(m => m.volumenHm3)),
        nCultivos: mezcla.filter(m => m.volumenHm3 != null).length,
        partes, lider: partes[0],
    };
}
