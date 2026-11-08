// ═══════════════════════════════════════════════════════════════════════════
// Escalas de color de los planos de la cuenca, derivadas de lo REGISTRADO — puro
// ---------------------------------------------------------------------------
// Antes: cortes genéricos (lluvia 1·5·10…150 mm para cualquier ventana; temperatura = múltiplos de 2 °C sobre el rango de cada plano, de modo que
// el mismo color significaba temperaturas distintas de un informe a otro). Ahora cada variable tiene UNA escala fija, calculada con todo lo que el
// sistema ha registrado, compartida por la pantalla, el informe de clima, la lámina y el Geoclimático: el mismo color es el mismo valor siempre.
//
// HONESTIDAD DE LA BASE: no hay historia climática multianual (JCAS ≈ 1 ciclo; estaciones propias desde jul-2026; GOES lluvia ≈ 2 ciclos en
// 3 pluviómetros). Por eso la escala NO es una climatología: nunca se dice «normal», anomalía ni percentil. Solo se declara la base
// («escala basada en n = N lecturas, periodo X»). Cuando haya ≥ 8 años de historia se podrá pasar a percentiles reales (regla n ≥ 8 años).
//
// Cómo se calcularon (consulta del 2026-11-08; reproducible con SQL sobre jcas_lecturas_diarias/mensuales, fn_cuenca_lluvia_propia y GOES):
//   · Lluvia: valores ≥ 1 mm de tres familias —día (lectura diaria), semana (suma móvil de 7 d, ≥ 6 días con dato) y mes (suma móvil de 30 d,
//     ≥ 24 días con dato)— sobre JCAS (Parral excluido), propias y GOES. Cortes en los deciles-cuartiles 10·25·40·55·70·80·90·95·99 y el máximo,
//     redondeados a números «bonitos» (nivelesDeCuantiles). El máximo registrado fija el último corte.
//   · Temperatura, viento y humedad: rango registrado de las medias diarias y mensuales de JCAS (p1–p99 y extremos), con cortes redondos.
// ═══════════════════════════════════════════════════════════════════════════

export type FamiliaLluvia = 'dia' | 'sem' | 'mes';
export type VariableEscala = 'lluvia' | 'temperatura' | 'viento' | 'humedad';

export interface EscalaDatos {
    niveles: number[];
    /** Texto de la base de la escala, para la leyenda («escala basada en…»). Nunca habla de «normal» ni de percentiles. */
    base: string;
}

export const ESCALA_VERSION = '2026-11-08';

/** Redondeo a números de lectura fácil: 1 por debajo de 2, enteros hasta 10, múltiplos de 5 hasta 100 y de 10 a partir de 100. */
export function redondeaBonito(x: number): number {
    if (!Number.isFinite(x) || x <= 0) return 0;
    if (x < 2) return Math.max(1, Math.round(x));
    if (x < 10) return Math.round(x);
    if (x < 50) return Math.round(x / 5) * 5;
    if (x < 100) return Math.round(x / 5) * 5;
    return Math.round(x / 10) * 10;
}

/** Cortes crecientes y sin repetir a partir de cuantiles de los valores registrados y su máximo. */
export function nivelesDeCuantiles(cuantiles: number[], maximo: number): number[] {
    const out: number[] = [];
    for (const q of [...cuantiles, maximo]) {
        const r = redondeaBonito(q);
        if (r > 0 && (out.length === 0 || r > out[out.length - 1])) out.push(r);
    }
    return out;
}

/** Cuantiles (deciles y cuartiles de los valores ≥ 1 mm) y máximo medidos el 2026-11-08, de los que salen las escalas de lluvia. */
export const CUANTILES_LLUVIA: Record<FamiliaLluvia, { q: number[]; max: number }> = {
    dia: { q: [1.33, 2.286, 4, 6.621, 10.16, 12.844, 22.672, 30.891, 57.8], max: 81.25 },
    sem: { q: [2, 4.745, 9, 13.8, 22.2, 31.6, 48.768, 63.323, 97.25], max: 134 },
    mes: { q: [4.75, 14.478, 26.75, 40.846, 65.69, 86.232, 107.239, 130.75, 171.75], max: 190.754 },
};

const BASE_LLUVIA = 'JCAS, estaciones propias y GOES, nov-2024 a nov-2026';
const ESCALAS_LLUVIA: Record<FamiliaLluvia, EscalaDatos> = {
    dia: { niveles: nivelesDeCuantiles(CUANTILES_LLUVIA.dia.q, CUANTILES_LLUVIA.dia.max), base: `lluvia de un día: n = 2,587 días-estación (374 con ≥ 1 mm), ${BASE_LLUVIA}; máximo registrado 81 mm` },
    sem: { niveles: nivelesDeCuantiles(CUANTILES_LLUVIA.sem.q, CUANTILES_LLUVIA.sem.max), base: `acumulado de 7 días: n = 2,457 ventanas, ${BASE_LLUVIA}; máximo registrado 134 mm` },
    mes: { niveles: nivelesDeCuantiles(CUANTILES_LLUVIA.mes.q, CUANTILES_LLUVIA.mes.max), base: `acumulado de 30 días: n = 2,048 ventanas, ${BASE_LLUVIA}; máximo registrado 191 mm` },
};

/** Temperatura media: cada 2 °C dentro del rango registrado de las medias diarias y mensuales de JCAS (0.3 a 33 °C). */
const NIVELES_TEMPERATURA = Array.from({ length: 17 }, (_, i) => 2 + i * 2); // 2 … 34 °C
const ESCALAS_FIJAS: Record<Exclude<VariableEscala, 'lluvia'>, EscalaDatos> = {
    temperatura: { niveles: NIVELES_TEMPERATURA, base: 'temperatura media: n = 713 medias (521 diarias y 192 mensuales de JCAS), nov-2025 a nov-2026; rango registrado 0.3 a 33 °C' },
    viento: { niveles: [1, 2, 3, 4, 5, 6, 8, 10, 12, 14], base: 'viento medio: n = 713 medias de JCAS, nov-2025 a nov-2026; 50 % de los días ≤ 3 km/h y máximo registrado 14 km/h' },
    humedad: { niveles: [20, 30, 40, 50, 60, 70, 80, 90], base: 'humedad relativa media: n = 713 medias de JCAS, nov-2025 a nov-2026; 90 % de los valores entre 18 y 90 %' },
};

/** Familia de la escala de lluvia según los días que acumula el plano (hoy y ayer = 1). */
export const familiaLluvia = (dias: number): FamiliaLluvia => (dias <= 1 ? 'dia' : dias <= 10 ? 'sem' : 'mes');

/** Escala de una variable; para lluvia depende de los días acumulados del plano. */
export function escalaDe(variable: VariableEscala, dias = 30): EscalaDatos {
    return variable === 'lluvia' ? ESCALAS_LLUVIA[familiaLluvia(dias)] : ESCALAS_FIJAS[variable];
}
