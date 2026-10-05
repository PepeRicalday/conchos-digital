/**
 * agronomia — constantes y fórmulas ÚNICAS de demanda de riego del DR-005.
 *
 * Antes estas cifras vivían como literales sueltos en Clima.tsx, exportClimaReport.ts y exportClimaInfografia.ts,
 * y ya habían divergido (el Kc del maíz era 0.70 en la infografía y 0.75 en el informe). Cualquier pantalla o
 * informe que muestre una lámina de riego debe leerla de aquí.
 *
 * Regla "S/D nunca cero": sin ETₒ (null) no hay lámina; un 0 mm/día solo existe si la ETₒ medida es 0.
 */

/** Eficiencia de aplicación en riego rodado (fracción). */
export const EFICIENCIA_RODADO = 0.70;

/** 1 mm de lámina sobre 1 ha = 10 m³. */
export const M3_POR_HA_POR_MM = 10;

/** Kc tabular de referencia del cultivo predominante (nogal en brotación). */
export const KC_REFERENCIA = 0.85;

/** Lluvia diaria mínima (mm) que se considera aprovechable por el cultivo. */
export const LLUVIA_MIN_EFECTIVA_MM = 5;

/** Fracción de la lluvia aprovechable que se descuenta de la demanda (método simplificado). */
export const FRACCION_LLUVIA_EFECTIVA = 0.8;

export interface Cultivo {
    nombre: string;
    /** Kc tabular en la etapa vigente. */
    kc: number;
    etapa: string;
}

/** Cultivos de referencia del distrito con su Kc en la etapa vigente. */
export const CULTIVOS_REFERENCIA: readonly Cultivo[] = [
    { nombre: 'Nogal', kc: 0.85, etapa: 'brotación' },
    { nombre: 'Alfalfa', kc: 0.95, etapa: 'corte medio' },
    { nombre: 'Maíz', kc: 0.75, etapa: 'desarrollo' },
    { nombre: 'Chile', kc: 0.80, etapa: 'floración' },
];

const valido = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** ETc = ETₒ × Kc (lámina neta, mm/día). */
export function laminaNeta(etoMm: number | null | undefined, kc: number = KC_REFERENCIA): number | null {
    return valido(etoMm) ? etoMm * kc : null;
}

/** Lámina bruta (mm/día) = neta / eficiencia de aplicación: la cifra que se entrega en campo. */
export function laminaBruta(etoMm: number | null | undefined, kc: number = KC_REFERENCIA, eficiencia: number = EFICIENCIA_RODADO): number | null {
    const neta = laminaNeta(etoMm, kc);
    return neta == null || !(eficiencia > 0) ? null : neta / eficiencia;
}

/** mm/día → m³/ha·día. */
export function m3PorHa(laminaMm: number | null | undefined): number | null {
    return valido(laminaMm) ? laminaMm * M3_POR_HA_POR_MM : null;
}

/** Lluvia efectiva (mm): 0 por debajo del mínimo aprovechable; por encima, el 80 %. */
export function lluviaEfectivaMm(lluviaMm: number | null | undefined): number | null {
    if (!valido(lluviaMm)) return null;
    return lluviaMm < LLUVIA_MIN_EFECTIVA_MM ? 0 : lluviaMm * FRACCION_LLUVIA_EFECTIVA;
}

export interface LaminaCultivo extends Cultivo {
    netaMm: number | null;
    brutaMm: number | null;
    m3Ha: number | null;
}

/** Lámina por cultivo de referencia para una ETₒ dada. */
export function laminasPorCultivo(etoMm: number | null | undefined): LaminaCultivo[] {
    return CULTIVOS_REFERENCIA.map(c => {
        const bruta = laminaBruta(etoMm, c.kc);
        return { ...c, netaMm: laminaNeta(etoMm, c.kc), brutaMm: bruta, m3Ha: m3PorHa(bruta) };
    });
}
