/**
 * volumenCultivo — estadística del informe ACUM_INF (2020-2024) desglosada por cultivo.
 * Lámina, mezcla de cultivos, contraste entre años altos y bajos y referencia del ciclo actual.
 * Reglas: S/D es null (nunca 0); los renglones atípicos del informe se cuentan y se avisan, no se corrigen ni se ocultan.
 * Descriptivo: no atribuye causas.
 */
import type { FilaSupVol } from './ndviInteranual';
import type { VolumenActual } from './ndviVolumen';

/** Superficie mínima (ha) para que una lámina cuente como muestra firme; menos de eso se marca. */
export const UMBRAL_HA_MUESTRA = 50;
/** Años mínimos de un cultivo para juzgar si una lámina es atípica. */
export const MIN_ANIOS_ATIPICA = 4;
/** Desviaciones estándar (entre años del mismo cultivo) a partir de las cuales una lámina se marca. */
export const Z_ATIPICA = 1.5;

/** Lámina bruta (cm) = volumen / superficie. miles de m³ ÷ ha × 10. null si falta algún dato o la superficie es 0. */
export function laminaCm(volumenMilesM3: number | null | undefined, superficieHa: number | null | undefined): number | null {
    if (volumenMilesM3 == null || superficieHa == null || !Number.isFinite(volumenMilesM3) || !Number.isFinite(superficieHa) || superficieHa <= 0) return null;
    return (volumenMilesM3 / superficieHa) * 10;
}

const suma = (v: (number | null)[]): number | null => {
    const x = v.filter((n): n is number => n != null && Number.isFinite(n));
    return x.length ? x.reduce((a, b) => a + b, 0) : null;
};
const mediana = (v: number[]): number | null => {
    if (!v.length) return null;
    const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sel = (filas: FilaSupVol[], modulo: number | null) => (modulo == null ? filas : filas.filter(f => f.numero_modulo === modulo));

export interface CeldaCultivo {
    anio: number;
    cultivo: string;
    superficieHa: number | null;
    volumenHm3: number | null;
    laminaCm: number | null;
    /** Algún renglón fuente marcado atípico. */
    atipicoFuente: boolean;
    /** Superficie bajo el umbral: la lámina es poco representativa. */
    muestraChica: boolean;
    /** Lámina lejos de la de los demás años del mismo cultivo. */
    laminaAtipica: boolean;
}

export interface SerieCultivo {
    cultivo: string;
    celdas: CeldaCultivo[];
    /** Media y desviación de la lámina entre años con muestra firme; null si hay menos de 2 años. */
    mediaLaminaCm: number | null;
    desvLaminaCm: number | null;
    /** Volumen total del cultivo en todos los años (hm³), para ordenar. */
    volumenTotalHm3: number | null;
}

/** Lámina por cultivo y año. `modulo` null = todo el distrito (suma de los módulos). Ordenado por volumen total descendente. */
export function laminaPorCultivo(filas: FilaSupVol[], modulo: number | null): SerieCultivo[] {
    const base = sel(filas, modulo);
    const cultivos = [...new Set(base.map(f => f.cultivo))];
    const anios = [...new Set(base.map(f => f.anio))].sort((a, b) => a - b);
    const out: SerieCultivo[] = cultivos.map(cultivo => {
        const celdas: CeldaCultivo[] = anios.flatMap(anio => {
            const r = base.filter(f => f.cultivo === cultivo && f.anio === anio);
            if (!r.length) return [];
            const ha = suma(r.map(f => f.superficie_ha));
            const miles = suma(r.map(f => f.volumen_miles_m3));
            return [{
                anio, cultivo, superficieHa: ha, volumenHm3: miles != null ? miles / 1000 : null, laminaCm: laminaCm(miles, ha),
                atipicoFuente: r.some(f => f.atipico), muestraChica: ha == null || ha < UMBRAL_HA_MUESTRA, laminaAtipica: false,
            }];
        });
        const firmes = celdas.filter(c => !c.muestraChica && c.laminaCm != null).map(c => c.laminaCm as number);
        let media: number | null = null, desv: number | null = null;
        if (firmes.length >= 2) {
            media = firmes.reduce((a, b) => a + b, 0) / firmes.length;
            desv = Math.sqrt(firmes.reduce((a, b) => a + (b - media!) ** 2, 0) / (firmes.length - 1));
        }
        if (media != null && desv != null && desv > 0 && firmes.length >= MIN_ANIOS_ATIPICA) {
            for (const c of celdas) if (!c.muestraChica && c.laminaCm != null && Math.abs(c.laminaCm - media) / desv > Z_ATIPICA) c.laminaAtipica = true;
        }
        return { cultivo, celdas, mediaLaminaCm: media, desvLaminaCm: desv, volumenTotalHm3: suma(celdas.map(c => c.volumenHm3)) };
    });
    return out.sort((a, b) => (b.volumenTotalHm3 ?? -1) - (a.volumenTotalHm3 ?? -1));
}

export interface ParticipacionCultivo {
    cultivo: string;
    superficieHa: number | null;
    volumenHm3: number | null;
    /** Porcentaje del total de superficie / volumen del año; null si el total no existe. */
    pctSuperficie: number | null;
    pctVolumen: number | null;
}

/** Peso de cada cultivo en un año (o en el distrito si `modulo` es null). Ordenado por volumen descendente. */
export function mezclaCultivos(filas: FilaSupVol[], modulo: number | null, anio: number): ParticipacionCultivo[] {
    const base = sel(filas, modulo).filter(f => f.anio === anio);
    const cultivos = [...new Set(base.map(f => f.cultivo))];
    const filasC = cultivos.map(cultivo => {
        const r = base.filter(f => f.cultivo === cultivo);
        const ha = suma(r.map(f => f.superficie_ha)), miles = suma(r.map(f => f.volumen_miles_m3));
        return { cultivo, superficieHa: ha, volumenHm3: miles != null ? miles / 1000 : null };
    });
    const totHa = suma(filasC.map(c => c.superficieHa)), totVol = suma(filasC.map(c => c.volumenHm3));
    return filasC
        .map(c => ({
            ...c,
            pctSuperficie: totHa && c.superficieHa != null ? (c.superficieHa / totHa) * 100 : null,
            pctVolumen: totVol && c.volumenHm3 != null ? (c.volumenHm3 / totVol) * 100 : null,
        }))
        .sort((a, b) => (b.volumenHm3 ?? -1) - (a.volumenHm3 ?? -1));
}

export interface ContrasteRegimen {
    altos: number[];
    bajos: number[];
    /** Superficie total por año (ha) que se usó para separar. */
    superficiePorAnio: { anio: number; ha: number }[];
    cultivos: { cultivo: string; pctVolAltos: number | null; pctVolBajos: number | null; deltaPp: number | null }[];
}

/**
 * Separa los años en «altos» y «bajos» por la superficie total (punto medio entre el mínimo y el máximo) y compara el peso de
 * cada cultivo en el volumen de cada grupo. null si hay menos de 4 años o si no se pueden formar dos grupos (la serie no tiene
 * contraste claro: no se inventa uno). Descriptivo; no explica por qué.
 */
export function contrasteRegimenes(filas: FilaSupVol[], modulo: number | null): ContrasteRegimen | null {
    const base = sel(filas, modulo);
    const anios = [...new Set(base.map(f => f.anio))].sort((a, b) => a - b);
    const sup = anios.map(anio => ({ anio, ha: suma(base.filter(f => f.anio === anio).map(f => f.superficie_ha)) })).filter((s): s is { anio: number; ha: number } => s.ha != null);
    if (sup.length < 4) return null;
    const mn = Math.min(...sup.map(s => s.ha)), mx = Math.max(...sup.map(s => s.ha));
    // Contraste claro: el mayor año supera al menor al menos en 1.5 veces.
    if (mn <= 0 || mx / mn < 1.5) return null;
    const corte = (mn + mx) / 2;
    const altos = sup.filter(s => s.ha >= corte).map(s => s.anio), bajos = sup.filter(s => s.ha < corte).map(s => s.anio);
    if (!altos.length || !bajos.length) return null;
    const pctGrupo = (grupo: number[]) => {
        const r = base.filter(f => grupo.includes(f.anio));
        const tot = suma(r.map(f => f.volumen_miles_m3));
        return (cultivo: string): number | null => {
            const v = suma(r.filter(f => f.cultivo === cultivo).map(f => f.volumen_miles_m3));
            return tot && v != null ? (v / tot) * 100 : null;
        };
    };
    const pa = pctGrupo(altos), pb = pctGrupo(bajos);
    const cultivos = [...new Set(base.map(f => f.cultivo))].map(cultivo => {
        const a = pa(cultivo), b = pb(cultivo);
        return { cultivo, pctVolAltos: a, pctVolBajos: b, deltaPp: a != null && b != null ? a - b : null };
    }).sort((x, y) => Math.abs(y.deltaPp ?? 0) - Math.abs(x.deltaPp ?? 0));
    return { altos, bajos, superficiePorAnio: sup, cultivos };
}

export type PosicionCiclo = 'bajo-rango' | 'dentro' | 'sobre-rango' | 'sin-dato';

export interface ReferenciaModulo {
    modulo: number;
    historico: { anio: number; volumenHm3: number }[];
    minHm3: number | null;
    maxHm3: number | null;
    medianaHm3: number | null;
    actualHm3: number | null;
    /** Faltan meses o alguno es parcial: no comparable con un año completo. */
    actualIncompleto: boolean;
    posicion: PosicionCiclo;
    /** (actual − mediana) / mediana × 100. null sin dato. */
    pctVsMediana: number | null;
}

const MESES_VENTANA = 7; // mar–sep

/** Compara el volumen provisional del ciclo actual (hoja SRL) con el rango 2020-2024 de cada módulo. Solo nivel módulo. */
export function referenciaCicloActual(filas: FilaSupVol[], actual: VolumenActual | null, modulos: number[]): ReferenciaModulo[] {
    return modulos.map(modulo => {
        const historico = [...new Set(filas.filter(f => f.numero_modulo === modulo).map(f => f.anio))].sort((a, b) => a - b)
            .map(anio => ({ anio, miles: suma(filas.filter(f => f.numero_modulo === modulo && f.anio === anio).map(f => f.volumen_miles_m3)) }))
            .filter((h): h is { anio: number; miles: number } => h.miles != null)
            .map(h => ({ anio: h.anio, volumenHm3: h.miles / 1000 }));
        const vals = historico.map(h => h.volumenHm3);
        const minHm3 = vals.length ? Math.min(...vals) : null, maxHm3 = vals.length ? Math.max(...vals) : null;
        const med = mediana(vals);
        const act = actual && !actual.error ? actual.porModulo.get(modulo) ?? null : null;
        const incompleto = !!actual && (actual.mesesParciales.length > 0 || (actual.mesesPorModulo.get(modulo) ?? 0) < MESES_VENTANA);
        let posicion: PosicionCiclo = 'sin-dato';
        if (act != null && minHm3 != null && maxHm3 != null) posicion = act < minHm3 ? 'bajo-rango' : act > maxHm3 ? 'sobre-rango' : 'dentro';
        return {
            modulo, historico, minHm3, maxHm3, medianaHm3: med, actualHm3: act, actualIncompleto: act != null && incompleto, posicion,
            pctVsMediana: act != null && med ? ((act - med) / med) * 100 : null,
        };
    });
}

// ───────────────────────── KPI de cada vista (funciones puras) ─────────────────────────

const sinAcento = (t: string): string => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** Cultivos que concentran el volumen del distrito (el informe fuente los llama «Alfalfa» y «Nogal»). */
export const esAlfalfaNogal = (cultivo: string): boolean => { const c = sinAcento(cultivo); return c.startsWith('alfalfa') || c.startsWith('nogal'); };

export interface KpiLamina {
    /** Último año con renglones en el ámbito; null si no hay ninguno. */
    anio: number | null;
    /** Volumen total ÷ superficie total del año (solo renglones con ambos datos). null si falta alguno. */
    laminaMediaCm: number | null;
    /** Cultivo de mayor lámina del año, entre los de muestra firme (≥ UMBRAL_HA_MUESTRA). */
    cultivoMayor: { cultivo: string; laminaCm: number } | null;
    /** Celdas lámina-año con ⚠ (atípica, muestra chica o captura atípica en la fuente); es el mismo conteo que muestra la tabla. */
    alertas: number;
    /** Celdas con lámina calculable (denominador de las alertas). */
    celdas: number;
}

/** KPI de la vista «Lámina por cultivo». `modulo` null = todo el distrito. */
export function kpiLamina(filas: FilaSupVol[], modulo: number | null): KpiLamina {
    const base = sel(filas, modulo);
    const series = laminaPorCultivo(filas, modulo);
    const celdas = series.flatMap(s => s.celdas).filter(c => c.laminaCm != null);
    const alertas = celdas.filter(c => c.laminaAtipica || c.muestraChica || c.atipicoFuente).length;
    if (!base.length) return { anio: null, laminaMediaCm: null, cultivoMayor: null, alertas, celdas: celdas.length };
    const anio = Math.max(...base.map(f => f.anio));
    const completos = base.filter(f => f.anio === anio && f.superficie_ha != null && f.volumen_miles_m3 != null);
    const laminaMediaCm = laminaCm(suma(completos.map(f => f.volumen_miles_m3)), suma(completos.map(f => f.superficie_ha)));
    let cultivoMayor: KpiLamina['cultivoMayor'] = null;
    for (const s of series) {
        const c = s.celdas.find(x => x.anio === anio);
        if (c && !c.muestraChica && c.laminaCm != null && (cultivoMayor == null || c.laminaCm > cultivoMayor.laminaCm)) cultivoMayor = { cultivo: s.cultivo, laminaCm: c.laminaCm };
    }
    return { anio, laminaMediaCm, cultivoMayor, alertas, celdas: celdas.length };
}

export interface KpiMezcla {
    anio: number | null;
    /** % del volumen del año que suman alfalfa y nogal. null si el año no tiene volumen. */
    pctVolumenAlfalfaNogal: number | null;
    /** Superficie total del año (ha); null si ningún renglón la trae. */
    superficieTotalHa: number | null;
    /** Superficie media de los años altos y de los bajos, y cuántas veces es una de la otra. null sin contraste claro. */
    altosVsBajos: { altosHa: number; bajosHa: number; veces: number; altos: number[]; bajos: number[] } | null;
}

/** KPI de la vista «Mezcla de cultivos» para el año elegido. */
export function kpiMezcla(filas: FilaSupVol[], modulo: number | null, anio: number | null): KpiMezcla {
    if (anio == null) return { anio: null, pctVolumenAlfalfaNogal: null, superficieTotalHa: null, altosVsBajos: null };
    const mezcla = mezclaCultivos(filas, modulo, anio);
    const totVol = suma(mezcla.map(m => m.volumenHm3));
    const volAN = suma(mezcla.filter(m => esAlfalfaNogal(m.cultivo)).map(m => m.volumenHm3));
    const pct = totVol && volAN != null ? (volAN / totVol) * 100 : null;
    const c = contrasteRegimenes(filas, modulo);
    let altosVsBajos: KpiMezcla['altosVsBajos'] = null;
    if (c) {
        const prom = (g: number[]) => { const v = c.superficiePorAnio.filter(s => g.includes(s.anio)).map(s => s.ha); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
        const altosHa = prom(c.altos), bajosHa = prom(c.bajos);
        if (altosHa != null && bajosHa != null && bajosHa > 0) altosVsBajos = { altosHa, bajosHa, veces: altosHa / bajosHa, altos: c.altos, bajos: c.bajos };
    }
    return { anio, pctVolumenAlfalfaNogal: pct, superficieTotalHa: suma(mezcla.map(m => m.superficieHa)), altosVsBajos };
}

export interface KpiCiclo {
    dentro: number;
    sobre: number;
    bajo: number;
    sinDato: number;
    /** Volumen actual sumado solo de los módulos con dato (hm³), y la mediana 2020-2024 de ESOS mismos módulos. null si ninguno tiene dato. */
    actualHm3: number | null;
    medianaHm3: number | null;
    pctVsMediana: number | null;
    /** Módulos con volumen actual y módulos con alguna lectura incompleta: la suma no es de todo el distrito si modulosConDato < total. */
    modulosConDato: number;
    modulosTotal: number;
    incompletos: number;
}

/** KPI de la vista «Ciclo actual» a partir de la referencia por módulo. */
export function kpiCiclo(refs: ReferenciaModulo[]): KpiCiclo {
    const con = refs.filter(r => r.actualHm3 != null);
    const actualHm3 = suma(con.map(r => r.actualHm3));
    const conMed = con.filter(r => r.medianaHm3 != null);
    // La mediana se suma sobre los mismos módulos que aportan el actual; si a alguno le falta mediana no se compara (sería mezclar bases).
    const medianaHm3 = conMed.length === con.length ? suma(con.map(r => r.medianaHm3)) : null;
    return {
        dentro: refs.filter(r => r.posicion === 'dentro').length,
        sobre: refs.filter(r => r.posicion === 'sobre-rango').length,
        bajo: refs.filter(r => r.posicion === 'bajo-rango').length,
        sinDato: refs.filter(r => r.posicion === 'sin-dato').length,
        actualHm3, medianaHm3,
        pctVsMediana: actualHm3 != null && medianaHm3 ? ((actualHm3 - medianaHm3) / medianaHm3) * 100 : null,
        modulosConDato: con.length, modulosTotal: refs.length, incompletos: con.filter(r => r.actualIncompleto).length,
    };
}

/** Valores del anexo de atípicos del informe: renglones fuente marcados y celdas con lámina atípica o muestra chica, sin corregir. */
export interface AtipicoCelda { cultivo: string; anio: number; laminaCm: number | null; superficieHa: number | null; motivos: string[] }

export function listaAtipicos(filas: FilaSupVol[]): AtipicoCelda[] {
    const out: AtipicoCelda[] = [];
    for (const s of laminaPorCultivo(filas, null)) {
        for (const c of s.celdas) {
            const motivos = [c.laminaAtipica && `lámina a más de ${Z_ATIPICA} desviaciones de los demás años del cultivo`, c.muestraChica && `superficie menor a ${UMBRAL_HA_MUESTRA} ha`, c.atipicoFuente && 'captura atípica en el informe fuente'].filter((m): m is string => !!m);
            if (motivos.length) out.push({ cultivo: s.cultivo, anio: c.anio, laminaCm: c.laminaCm, superficieHa: c.superficieHa, motivos });
        }
    }
    return out.sort((a, b) => a.anio - b.anio || a.cultivo.localeCompare(b.cultivo, 'es'));
}

export interface CeldaModuloAnio { anio: number; superficieHa: number | null; volumenHm3: number | null; laminaCm: number | null }

/** Superficie, volumen y lámina media (todos los cultivos) por módulo y año. Año sin renglones del módulo → celda con null (S/D). */
export function matrizModuloAnio(filas: FilaSupVol[], modulos: number[]): { modulo: number; celdas: CeldaModuloAnio[] }[] {
    const anios = [...new Set(filas.map(f => f.anio))].sort((a, b) => a - b);
    return modulos.map(modulo => ({
        modulo,
        celdas: anios.map(anio => {
            const r = filas.filter(f => f.numero_modulo === modulo && f.anio === anio && f.superficie_ha != null && f.volumen_miles_m3 != null);
            const ha = suma(r.map(f => f.superficie_ha)), miles = suma(r.map(f => f.volumen_miles_m3));
            return { anio, superficieHa: ha, volumenHm3: miles != null ? miles / 1000 : null, laminaCm: laminaCm(miles, ha) };
        }),
    }));
}
