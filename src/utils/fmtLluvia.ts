import { formatearNumero } from './historicoPresas';

/**
 * Formato único de milímetros de lluvia en toda la cuenca: 1 decimal por debajo de 10 mm (0.3 mm no debe leerse «0», que sería un día seco
 * medido) y entero desde 10 mm. null/NaN = S/D, nunca 0.
 */
export function fmtLluvia(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return 'S/D';
    return formatearNumero(v, Math.abs(v) < 10 ? 1 : 0);
}
