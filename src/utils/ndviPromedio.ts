/**
 * ndviPromedio — UNA sola regla del "NDVI de la SRL" para todo el informe: promedio simple (cada módulo pesa igual) o
 * ponderado por la superficie del polígono. La base que elige el usuario se respeta en todos los cálculos (anomalía,
 * evolución año a año, comparaciones, interanual) y se imprime junto a cada cifra.
 * S/D nunca es 0: se ignoran los módulos sin valor; sin ninguno, el resultado es null.
 */
import { media } from './estadisticaBasica';

export type BasePromedio = 'simple' | 'ponderado';

export interface ParPeso { valor: number | null | undefined; peso: number | null | undefined }

/** Promedio ponderado por peso (superficie); ignora pares sin valor o sin peso positivo. */
export function promedioPonderado(pares: ParPeso[]): number | null {
    let num = 0, den = 0;
    for (const p of pares) {
        if (p.valor == null || !Number.isFinite(p.valor) || p.peso == null || !(p.peso > 0)) continue;
        num += p.valor * p.peso; den += p.peso;
    }
    return den > 0 ? num / den : null;
}

/** Promedio según la base elegida. Ponderado sin ningún peso utilizable devuelve null (no cae en silencio al simple). */
export function promedioConBase(base: BasePromedio, pares: ParPeso[]): number | null {
    return base === 'ponderado' ? promedioPonderado(pares) : media(pares.map((p) => p.valor));
}

/** Superficie (ha) de cada módulo = la del registro más reciente con superficie; sirve de peso constante en todo el informe. */
export function pesosSuperficie(filas: { numero_modulo: number; mes: string; superficie_ha: number | null }[]): Map<number, number> {
    const ultimo = new Map<number, { mes: string; ha: number }>();
    for (const f of filas) {
        if (f.superficie_ha == null || !(f.superficie_ha > 0)) continue;
        const prev = ultimo.get(f.numero_modulo);
        if (!prev || f.mes.slice(0, 7) >= prev.mes) ultimo.set(f.numero_modulo, { mes: f.mes.slice(0, 7), ha: f.superficie_ha });
    }
    return new Map([...ultimo].map(([m, x]) => [m, x.ha]));
}

/** Rótulo único del promedio, igual en tablas, frases y gráficas. */
export const rotuloBase = (base: BasePromedio): string => (base === 'ponderado' ? 'ponderado por superficie' : 'simple');

/** Definición rotulada de "NDVI de la SRL" (una por informe): qué se promedia y con qué base. */
export function definicionNdviSrl(base: BasePromedio, nModulos: number): string {
    const quienes = `${nModulos} ${nModulos === 1 ? 'módulo' : 'módulos'} del periodo`;
    return base === 'ponderado'
        ? `NDVI de la SRL = promedio de ${quienes} ponderado por la superficie de su polígono (los módulos sin dato no entran).`
        : `NDVI de la SRL = promedio simple de ${quienes} (cada módulo pesa igual; los módulos sin dato no entran).`;
}
