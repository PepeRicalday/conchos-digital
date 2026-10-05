import { KC_REFERENCIA, EFICIENCIA_RODADO, M3_POR_HA_POR_MM, lluviaEfectivaMm } from './agronomia';

/**
 * balanceModulo — demanda de riego estimada contra lo entregado, por módulo y por día.
 *
 *   demanda (m³) = máx(0, ETₒ × Kc − lluvia efectiva) / eficiencia × 10 × ha_riego
 *   cobertura (%) = entregado / demanda × 100
 *
 * Regla "S/D nunca cero": si falta ETₒ, superficie o entrega → S/D. Un día SIN registro de entrega NO es una
 * entrega de 0 m³ (puede ser que no se capturó): solo hay 0 cuando existe un registro con volumen 0.
 */

export type EstadoBalance = 'SUPERAVIT' | 'EQUILIBRADO' | 'DEFICIT' | 'SD';

export const UMBRAL_DEFICIT_PCT = 90;
export const UMBRAL_SUPERAVIT_PCT = 110;

export interface EntradaBalance {
    etoMm: number | null;
    haRiego: number | null;
    /** m³ entregados en el día; null = sin registro de entrega (S/D). */
    entregadoM3: number | null;
    kc?: number;
    eficiencia?: number;
    /** Lluvia observada del día (mm); null = sin dato (no se descuenta nada). */
    lluviaMm?: number | null;
}

export interface BalanceModulo {
    demandaM3: number | null;
    entregadoM3: number | null;
    /** entregado − demanda (negativo = déficit). */
    saldoM3: number | null;
    coberturaPct: number | null;
    estado: EstadoBalance;
}

export function demandaDiariaM3(e: Pick<EntradaBalance, 'etoMm' | 'haRiego' | 'kc' | 'eficiencia' | 'lluviaMm'>): number | null {
    const { etoMm, haRiego } = e;
    if (etoMm == null || !Number.isFinite(etoMm) || etoMm < 0) return null;
    if (haRiego == null || !Number.isFinite(haRiego) || haRiego <= 0) return null;
    const kc = e.kc ?? KC_REFERENCIA;
    const ef = e.eficiencia ?? EFICIENCIA_RODADO;
    if (!(ef > 0)) return null;
    const pe = lluviaEfectivaMm(e.lluviaMm) ?? 0;
    const neta = Math.max(0, etoMm * kc - pe);
    return (neta / ef) * M3_POR_HA_POR_MM * haRiego;
}

export function estadoPorCobertura(coberturaPct: number | null): EstadoBalance {
    if (coberturaPct == null || !Number.isFinite(coberturaPct)) return 'SD';
    if (coberturaPct < UMBRAL_DEFICIT_PCT) return 'DEFICIT';
    if (coberturaPct > UMBRAL_SUPERAVIT_PCT) return 'SUPERAVIT';
    return 'EQUILIBRADO';
}

export function balanceModulo(e: EntradaBalance): BalanceModulo {
    const demandaM3 = demandaDiariaM3(e);
    const entregadoM3 = e.entregadoM3 != null && Number.isFinite(e.entregadoM3) && e.entregadoM3 >= 0 ? e.entregadoM3 : null;
    if (demandaM3 == null || entregadoM3 == null) {
        return { demandaM3, entregadoM3, saldoM3: null, coberturaPct: null, estado: 'SD' };
    }
    // Demanda cero (llovió lo suficiente): no se puede dividir; se considera cubierta si no se entregó nada que sobrara.
    const coberturaPct = demandaM3 === 0 ? (entregadoM3 === 0 ? 100 : null) : (entregadoM3 / demandaM3) * 100;
    return {
        demandaM3, entregadoM3, saldoM3: entregadoM3 - demandaM3, coberturaPct,
        estado: demandaM3 === 0 && entregadoM3 > 0 ? 'SUPERAVIT' : estadoPorCobertura(coberturaPct),
    };
}

/** Suma de entregas del día de un módulo; null si no hay ningún registro (≠ 0). */
export function entregadoDelDia(filas: { volumen_m3: number | string | null }[]): number | null {
    const vals = filas.map(f => (f.volumen_m3 == null ? NaN : Number(f.volumen_m3))).filter(Number.isFinite);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}
