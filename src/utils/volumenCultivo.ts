/**
 * volumenCultivo — estadística del informe ACUM_INF (2020-2024) desglosada por cultivo.
 * Agua por hectárea, mezcla de cultivos, contraste entre años de más y de menos superficie y referencia del ciclo actual.
 * Reglas: S/D es null (nunca 0); los renglones atípicos del informe se cuentan y se avisan, no se corrigen ni se ocultan.
 * 2025 (presas cerradas) es «sin ciclo» (estadoAnio): se descarta de todo cálculo aunque llegara un renglón con 0.
 * Descriptivo: no atribuye causas.
 */
import type { FilaSupVol } from './ndviInteranual';
import type { VolumenActual } from './ndviVolumen';
import { ANIOS_CON_INFORME, ANIOS_SIN_CICLO, ANIO_PROVISIONAL, RANGO_INFORME, esAnioSinCiclo, listaAnios } from './estadoAnio';
import { CATALOGO_CULTIVOS, infoCultivo } from './cultivos';

/** Superficie mínima (ha) para que una lámina cuente como muestra firme; menos de eso se marca. */
export const UMBRAL_HA_MUESTRA = 50;
/** Años mínimos de un cultivo para juzgar si una lámina es atípica. */
export const MIN_ANIOS_ATIPICA = 4;
/** Desviaciones estándar (entre años del mismo cultivo) a partir de las cuales una lámina se marca. */
export const Z_ATIPICA = 1.5;

/** Agua entregada por hectárea (cm) = volumen / superficie. miles de m³ ÷ ha × 10. null si falta algún dato o la superficie es 0. */
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
/** Renglones útiles: los años sin ciclo (2025) se descartan siempre, incluso si la fuente trajera un renglón con 0. */
const utiles = (filas: FilaSupVol[]) => filas.filter(f => !esAnioSinCiclo(f.anio));
const sel = (filas: FilaSupVol[], modulo: number | null) => { const u = utiles(filas); return modulo == null ? u : u.filter(f => f.numero_modulo === modulo); };

export interface CeldaCultivo {
    anio: number;
    cultivo: string;
    superficieHa: number | null;
    volumenHm3: number | null;
    laminaCm: number | null;
    /** Algún renglón fuente marcado atípico. */
    atipicoFuente: boolean;
    /** Volumen 0 con superficie: captura atípica de la fuente. Se avisa y se excluye de la lámina y de la media (laminaCm = null). */
    capturaCero: boolean;
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
            const capturaCero = miles === 0 && ha != null && ha > 0;
            return [{
                anio, cultivo, superficieHa: ha, volumenHm3: miles != null ? miles / 1000 : null, laminaCm: capturaCero ? null : laminaCm(miles, ha),
                atipicoFuente: r.some(f => f.atipico), capturaCero, muestraChica: ha == null || ha < UMBRAL_HA_MUESTRA, laminaAtipica: false,
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
 * Separa los años en «de más superficie» (altos) y «de menos superficie» (bajos) por la superficie total (punto medio entre el mínimo y el máximo) y compara el peso de
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

/** Compara el volumen provisional del ciclo actual (hoja SRL) con el rango de los años con informe de cada módulo. Solo nivel módulo. 2025 (sin ciclo) no cuenta. */
export function referenciaCicloActual(filas: FilaSupVol[], actual: VolumenActual | null, modulos: number[]): ReferenciaModulo[] {
    filas = utiles(filas);
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
    const celdas = series.flatMap(s => s.celdas).filter(c => c.laminaCm != null || c.capturaCero);
    const alertas = celdas.filter(c => c.laminaAtipica || c.muestraChica || c.atipicoFuente || c.capturaCero).length;
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
            const motivos = [c.laminaAtipica && `lámina a más de ${Z_ATIPICA} desviaciones de los demás años del cultivo`, c.muestraChica && `superficie menor a ${UMBRAL_HA_MUESTRA} ha`, c.capturaCero && 'volumen 0 con superficie en el informe fuente: captura atípica, fuera de la lámina', c.atipicoFuente && !c.capturaCero && 'captura atípica en el informe fuente'].filter((m): m is string => !!m);
            if (motivos.length) out.push({ cultivo: s.cultivo, anio: c.anio, laminaCm: c.laminaCm, superficieHa: c.superficieHa, motivos });
        }
    }
    return out.sort((a, b) => a.anio - b.anio || a.cultivo.localeCompare(b.cultivo, 'es'));
}

export interface CeldaModuloAnio { anio: number; superficieHa: number | null; volumenHm3: number | null; laminaCm: number | null }

/** Superficie, volumen y lámina media (todos los cultivos) por módulo y año. Año sin renglones del módulo → celda con null (S/D). */
export function matrizModuloAnio(filas: FilaSupVol[], modulos: number[]): { modulo: number; celdas: CeldaModuloAnio[] }[] {
    filas = utiles(filas);
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

// ───────────────────────── Gráficas y frases de lectura (funciones puras) ─────────────────────────

export interface BarraAnio {
    anio: number;
    /** 'con-informe' barra sólida; 'sin-ciclo' hueco rotulado; 'provisional' barra con trama; 'sd' faltante real. */
    estado: 'con-informe' | 'sin-ciclo' | 'provisional' | 'sd';
    /** Valor de la barra (hm³ o ha). null en sin-ciclo (nunca 0) y en faltantes reales. */
    valor: number | null;
    /** Provisional con meses faltantes o parciales. */
    incompleto?: boolean;
}

/**
 * Volumen del distrito (o de un módulo) por año: años con informe, 2025 como hueco «sin ciclo» y 2026 provisional (hoja SRL).
 * Sin renglones del informe → lista vacía. `modulos` = módulos que suman el distrito en la hoja SRL.
 */
export function barrasVolumenAnual(filas: FilaSupVol[], actual: VolumenActual | null, modulo: number | null, modulos: number[]): BarraAnio[] {
    const base = sel(filas, modulo);
    const anios = [...new Set(base.map(f => f.anio))].sort((a, b) => a - b);
    if (!anios.length) return [];
    const out: BarraAnio[] = anios.map(anio => {
        const miles = suma(base.filter(f => f.anio === anio).map(f => f.volumen_miles_m3));
        return { anio, estado: miles != null ? 'con-informe' : 'sd', valor: miles != null ? miles / 1000 : null };
    });
    out.push({ anio: 2025, estado: 'sin-ciclo', valor: null });
    const ids = modulo == null ? modulos : [modulo];
    const vals = actual && !actual.error ? ids.map(m => actual.porModulo.get(m)).filter((v): v is number => v != null && Number.isFinite(v)) : [];
    const incompleto = !!actual && (actual.mesesParciales.length > 0 || ids.some(m => (actual.mesesPorModulo.get(m) ?? 0) < MESES_VENTANA));
    out.push({ anio: ANIO_PROVISIONAL, estado: vals.length ? 'provisional' : 'sd', valor: vals.length ? vals.reduce((a, b) => a + b, 0) : null, incompleto: vals.length ? incompleto : undefined });
    return out;
}

/** Superficie regada por año (ha): años con informe y 2025 como hueco «sin ciclo». 2026 no tiene superficie en la hoja SRL y no se dibuja. */
export function barrasSuperficieAnual(filas: FilaSupVol[], modulo: number | null): BarraAnio[] {
    const base = sel(filas, modulo);
    const anios = [...new Set(base.map(f => f.anio))].sort((a, b) => a - b);
    if (!anios.length) return [];
    const out: BarraAnio[] = anios.map(anio => {
        const ha = suma(base.filter(f => f.anio === anio).map(f => f.superficie_ha));
        return { anio, estado: ha != null ? 'con-informe' : 'sd', valor: ha };
    });
    out.push({ anio: 2025, estado: 'sin-ciclo', valor: null });
    return out;
}

export interface ParteTop { nombre: string; pct: number; valor: number | null; esOtros: boolean; cultivos: string[] }

/** Los `n` cultivos con más peso (por volumen o por superficie) y un renglón «Otros» con el resto. Un cultivo sin dato no se inventa: se omite. */
export function topConOtros(mezcla: ParticipacionCultivo[], campo: 'volumen' | 'superficie', n = 5): ParteTop[] {
    const v = (p: ParticipacionCultivo) => (campo === 'volumen' ? p.pctVolumen : p.pctSuperficie);
    const val = (p: ParticipacionCultivo) => (campo === 'volumen' ? p.volumenHm3 : p.superficieHa);
    const con = mezcla.filter(p => v(p) != null).sort((a, b) => (v(b) as number) - (v(a) as number));
    const top: ParteTop[] = con.slice(0, n).map(p => ({ nombre: p.cultivo, pct: v(p) as number, valor: val(p), esOtros: false, cultivos: [p.cultivo] }));
    const resto = con.slice(n);
    if (resto.length) {
        const vals = resto.map(val).filter((x): x is number => x != null);
        top.push({ nombre: resto.length === 1 ? resto[0].cultivo : `Otros ${resto.length} cultivos`, pct: resto.reduce((a, p) => a + (v(p) as number), 0), valor: vals.length ? vals.reduce((a, b) => a + b, 0) : null, esOtros: resto.length > 1, cultivos: resto.map(p => p.cultivo) });
    }
    return top;
}

const dec1 = (x: number) => x.toFixed(1);
/**
 * «En 2020 y 2023 se regó más del doble de superficie que en 2021, 2022 y 2024». Se deriva del contraste de los datos; null sin contraste claro.
 * Describe, no explica: no dice por qué cambió la superficie.
 */
export function fraseContrasteSuperficie(av: KpiMezcla['altosVsBajos']): string | null {
    if (!av) return null;
    const v = av.veces;
    const magnitud = v >= 2.15 ? 'más del doble de superficie' : v >= 1.85 ? 'el doble de superficie' : v >= 1.6 ? 'casi el doble de superficie' : `${dec1(v)} veces la superficie`;
    return `En ${listaAnios(av.altos)} se regó ${magnitud} que en ${listaAnios(av.bajos)}.`;
}

/** Palabra corta del contraste, para la cifra de la tarjeta: «Más del doble», «El doble», «Casi el doble», «1.6 veces». */
export function cifraContraste(av: KpiMezcla['altosVsBajos']): string | null {
    if (!av) return null;
    const v = av.veces;
    return v >= 2.15 ? 'Más del doble' : v >= 1.85 ? 'El doble' : v >= 1.6 ? 'Casi el doble' : `${dec1(v)} veces`;
}

export interface LecturaVsTipico { cifra: string; frase: string; tendencia: 'menos' | 'mas' | 'igual' }
/**
 * Lectura del ciclo actual frente a un año típico (la mediana de los años con informe). No dice si es ahorro, sequía ni causa.
 * 2025 no cuenta: las presas estuvieron cerradas. null sin comparación.
 */
export function lecturaVsTipico(pct: number | null): LecturaVsTipico | null {
    if (pct == null || !Number.isFinite(pct)) return null;
    const r = Math.round(Math.abs(pct));
    if (r === 0) return { cifra: 'Igual', frase: `Casi igual que un año típico ${RANGO_INFORME}. 2025 no cuenta: las presas estuvieron cerradas.`, tendencia: 'igual' };
    const menos = pct < 0;
    return { cifra: `${r} % ${menos ? 'menos' : 'más'}`, frase: `${menos ? 'Menos' : 'Más'} agua que un año típico ${RANGO_INFORME}. 2025 no cuenta: las presas estuvieron cerradas.`, tendencia: menos ? 'menos' : 'mas' };
}

/** Años con informe presentes en los datos (para rótulos que antes decían «2020-2024» a mano). */
export const aniosConInforme = (filas: FilaSupVol[]): number[] => [...new Set(utiles(filas).map(f => f.anio))].filter(a => ANIOS_CON_INFORME.includes(a)).sort((a, b) => a - b);

// ───────────────────────── Composición por año (barras apiladas al 100 %) ─────────────────────────

export interface ParteComposicion { nombre: string; clave: string; valor: number; pct: number; esOtros: boolean; cultivos: string[] }
export interface FilaComposicion {
    anio: number;
    /** 'con-informe' trae partes; 'sin-ciclo' (2025) es un hueco rotulado; 'sin-desglose' (2026: la hoja SRL no separa cultivos); 'sd' falta real en el ámbito. */
    estado: 'con-informe' | 'sin-ciclo' | 'sin-desglose' | 'sd';
    /** Suma de las partes (hm³ o ha). null si no hay dato (nunca 0 por falta de dato). */
    total: number | null;
    partes: ParteComposicion[];
    /** Cultivos (nombre del catálogo) que SÍ tienen renglón ese año pero con la cifra medida nula o 0: están en el informe, sin dato. No son «ausentes». */
    sinCifra: string[];
    /** Cultivos con algún renglón marcado atípico en la fuente. */
    atipicos: string[];
    /** true = algún renglón fuente sin cifra o atípico: el total y los porcentajes de esa barra son sobre datos incompletos. */
    incompleta: boolean;
}
export interface Composicion {
    campo: 'volumen' | 'superficie';
    unidad: 'hm³' | 'ha';
    /** Cultivos con color propio, en el ORDEN FIJO del catálogo (el color sigue al cultivo, no al ranking), y «Otros» al final si hace falta. */
    leyenda: { nombre: string; clave: string; esOtros: boolean; cultivos: string[] }[];
    filas: FilaComposicion[];
}

/**
 * Mezcla de cultivos año por año: los `n` cultivos que más pesan en todo el periodo van cada uno con su color y el resto se junta en «Otros».
 * Los cultivos se apilan siempre en el mismo orden (el del catálogo), para que se vea el cambio y no el reordenamiento.
 * 2025 es un hueco «sin ciclo» (nunca 0 ni S/D) y 2026 se marca «sin desglose»: la hoja SRL no separa cultivos.
 */
export function composicionAnual(filas: FilaSupVol[], modulo: number | null, campo: 'volumen' | 'superficie', n = 6): Composicion {
    const base = sel(filas, modulo);
    const anios = aniosConInforme(filas);
    const val = (f: FilaSupVol) => (campo === 'volumen' ? (f.volumen_miles_m3 != null ? f.volumen_miles_m3 / 1000 : null) : f.superficie_ha);
    const suma1 = (m: Map<string, number>, f: FilaSupVol) => { const v = val(f); if (v != null && Number.isFinite(v)) { const c = infoCultivo(f.cultivo).nombre; m.set(c, (m.get(c) ?? 0) + v); } };
    const peso = new Map<string, number>();
    for (const f of base) suma1(peso, f);
    const ordenCat = (nombre: string) => { const i = CATALOGO_CULTIVOS.findIndex(c => c.nombre === nombre); return i < 0 ? 999 : i; };
    const elegidos = new Set([...peso.entries()].filter(e => infoCultivo(e[0]).clave !== 'otros').sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]));
    const ordenados = [...elegidos].sort((a, b) => ordenCat(a) - ordenCat(b) || a.localeCompare(b, 'es'));
    const resto = [...peso.keys()].filter(c => !elegidos.has(c));
    const leyenda: Composicion['leyenda'] = ordenados.map(nombre => ({ nombre, clave: infoCultivo(nombre).clave, esOtros: false, cultivos: [nombre] }));
    if (resto.length) leyenda.push({ nombre: resto.length === 1 ? resto[0] : `Otros ${resto.length} cultivos`, clave: resto.length === 1 ? infoCultivo(resto[0]).clave : 'otros', esOtros: resto.length > 1, cultivos: resto });
    const out: FilaComposicion[] = anios.map(anio => {
        const porCultivo = new Map<string, number>();
        for (const f of base.filter(x => x.anio === anio)) suma1(porCultivo, f);
        const delAnio = base.filter(x => x.anio === anio);
        const total = porCultivo.size ? [...porCultivo.values()].reduce((a, b) => a + b, 0) : null;
        // Renglón presente con la cifra nula o 0 ≠ cultivo ausente: se distingue para no decir «no aparece» de lo que el informe sí trae.
        const sinCifra = [...new Set(delAnio.filter(x => { const v = val(x); return v == null || !Number.isFinite(v) || v <= 0; }).map(x => infoCultivo(x.cultivo).nombre))];
        const atipicos = [...new Set(delAnio.filter(x => x.atipico).map(x => infoCultivo(x.cultivo).nombre))];
        const incompleta = sinCifra.length > 0 || atipicos.length > 0;
        if (total == null || total <= 0) return { anio, estado: 'sd' as const, total: null, partes: [], sinCifra, atipicos, incompleta };
        const partes: ParteComposicion[] = [];
        for (const l of leyenda) {
            const v = l.cultivos.reduce((a, c) => a + (porCultivo.get(c) ?? 0), 0);
            if (v > 0) partes.push({ nombre: l.nombre, clave: l.clave, valor: v, pct: (v / total) * 100, esOtros: l.esOtros, cultivos: l.cultivos });
        }
        return { anio, estado: 'con-informe' as const, total, partes, sinCifra, atipicos, incompleta };
    });
    for (const a of ANIOS_SIN_CICLO) out.push({ anio: a, estado: 'sin-ciclo', total: null, partes: [], sinCifra: [], atipicos: [], incompleta: false });
    out.push({ anio: ANIO_PROVISIONAL, estado: 'sin-desglose', total: null, partes: [], sinCifra: [], atipicos: [], incompleta: false });
    out.sort((a, b) => a.anio - b.anio);
    return { campo, unidad: campo === 'volumen' ? 'hm³' : 'ha', leyenda, filas: out };
}

/** Cómo decir «sin cifra» según lo que se mide. */
export const textoSinCifra = (campo: 'volumen' | 'superficie'): string => (campo === 'volumen' ? 'sin volumen en el informe' : 'sin superficie en el informe');

/** Cómo se lee la parte de un cultivo en un año: «45 %», «sin volumen en el informe» (renglón presente sin cifra) o «no aparece» (no hay renglón). */
export function estadoCultivoEnAnio(f: FilaComposicion, l: Composicion['leyenda'][number]): { tipo: 'parte'; pct: number } | { tipo: 'sin-cifra' | 'ausente' } {
    const p = f.partes.find(x => x.clave === l.clave && x.nombre === l.nombre) ?? f.partes.find(x => x.clave === l.clave);
    if (p) return { tipo: 'parte', pct: p.pct };
    return l.cultivos.some(c => f.sinCifra.includes(c)) ? { tipo: 'sin-cifra' } : { tipo: 'ausente' };
}

/** Aviso de una barra con datos incompletos (⚠); null si la barra es completa. */
export function notaIncompleta(f: FilaComposicion, campo: 'volumen' | 'superficie'): string | null {
    if (!f.incompleta) return null;
    const lista = (v: string[]) => v.join(', ');
    const partes = [
        f.sinCifra.length ? `el informe trae ${lista(f.sinCifra)} sin ${campo === 'volumen' ? 'volumen' : 'superficie'}` : null,
        f.atipicos.length ? `${f.atipicos.length === 1 ? 'tiene' : 'tienen'} captura atípica en el informe: ${lista(f.atipicos)}` : null,
    ].filter(Boolean);
    return `⚠ ${f.anio}: ${partes.join('; ')}. El total y los porcentajes de ese año son sobre datos incompletos.`;
}

/**
 * Frase simple del cultivo líder del último año con informe: «Entre el primer y el último año con informe, Alfalfa recibió 45 % del agua entregada en 2020 y 41 % en 2024 (2025 sin ciclo).»
 * Describe, no explica. null sin datos.
 */
export function fraseCambioMezcla(c: Composicion): string | null {
    const con = c.filas.filter(f => f.estado === 'con-informe');
    if (!con.length) return null;
    const ult = con[con.length - 1], pri = con[0];
    const lider = [...ult.partes].filter(p => !p.esOtros).sort((a, b) => b.pct - a.pct)[0];
    if (!lider) return null;
    const verbo = c.campo === 'volumen' ? 'recibió' : 'ocupó';
    const de = c.campo === 'volumen' ? 'del agua entregada' : 'de la superficie regada';
    const sinCiclo = c.filas.filter(f => f.estado === 'sin-ciclo').map(f => f.anio);
    const nota = sinCiclo.length ? ` (${listaAnios(sinCiclo)} sin ciclo)` : '';
    const antes = pri.anio === ult.anio ? undefined : pri.partes.find(p => p.clave === lider.clave);
    if (!antes) return `${lider.nombre} ${verbo} ${Math.round(lider.pct)} % ${de} en ${ult.anio}${nota}.`;
    const a = Math.round(antes.pct), b = Math.round(lider.pct);
    const marco = 'Entre el primer y el último año con informe,';
    return a === b ? `${marco} ${lider.nombre} ${verbo} cerca de ${b} % ${de} en ${pri.anio} y en ${ult.anio}${nota}.` : `${marco} ${lider.nombre} ${verbo} ${a} % ${de} en ${pri.anio} y ${b} % en ${ult.anio}${nota}.`;
}
