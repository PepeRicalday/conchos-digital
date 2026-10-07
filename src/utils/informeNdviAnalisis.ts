/**
 * informeNdviAnalisis — tendencia y comparaciones PURAS del informe NDVI (sin React ni red).
 * Reglas: S/D nunca es 0 (un mes sin fila entra como null y se descarta del cálculo, sin interpolar ni rellenar);
 * toda cifra lleva su n; con un solo ciclo disponible NO hay comparación entre años (todo es "dentro del ciclo").
 * Reutiliza estadisticaHistorica (regresión lineal, resumen de serie) e indicesSrl (ICV/IHR).
 */
import { resumenSerie, tendenciaLineal } from './estadisticaHistorica';
import { calcICV, calcIHR } from './indicesSrl';
import { MODULOS_SRL_IDS, COLOR_MODULO_SRL } from './modulosSRL';
import type { BasePromedio, ConfigInformeNdvi, RangoMes } from './informeNdviConfig';

/** Lo mínimo que se necesita de una fila de ndvi_modulo_historico (FilaNdviInforme la cumple). */
export interface FilaAnalisis {
    numero_modulo: number;
    nombre_modulo: string;
    mes: string;
    ndvi_medio: number;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    superficie_ha: number | null;
    fraccion_cobertura_activa: number | null;
}

const mesDe = (m: string) => (m ?? '').slice(0, 7);
const indiceMes = (mes: string) => { const m = /^(\d{4})-(\d{2})/.exec(mes); return m ? Number(m[1]) * 12 + Number(m[2]) : NaN; };
const enRango = (mes: string, r: RangoMes) => mesDe(mes) >= r.desde && mesDe(mes) <= r.hasta;

const media = (v: (number | null | undefined)[]): number | null => {
    const x = v.filter((n): n is number => n != null && Number.isFinite(n));
    return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
};

// ─────────────────────────── Tendencia ───────────────────────────

/** Umbrales para DECLARAR una tendencia (con un solo ciclo y pocos puntos, la estadística es frágil). */
export const TENDENCIA_MIN_N = 4;
export const TENDENCIA_MIN_R2 = 0.5;
export const TENDENCIA_MIN_PENDIENTE = 0.005; // NDVI por mes

export type ConfianzaTendencia = 'sd' | 'descriptiva' | 'sin-tendencia' | 'clara';
export type DireccionTendencia = 'sube' | 'baja' | 'estable' | null;

export interface TendenciaSerie {
    n: number;
    /** NDVI por mes (x = mes calendario, no la posición en el arreglo: los huecos no la distorsionan). */
    pendiente: number | null;
    r2: number | null;
    confianza: ConfianzaTendencia;
    /** Solo con confianza 'clara' (sube/baja) o 'sin-tendencia' (estable); null si es descriptiva/S-D. */
    direccion: DireccionTendencia;
    primero: { mes: string; valor: number } | null;
    ultimo: { mes: string; valor: number } | null;
    pico: { mes: string; valor: number } | null;
    minimo: { mes: string; valor: number } | null;
    /** Último − primero con dato. */
    variacion: number | null;
    /** Desviación entre meses / media; solo con n ≥ 3 y media > 0.05. */
    cv: number | null;
}

export function tendenciaDeSerie(meses: string[], valores: (number | null)[]): TendenciaSerie {
    const pts = meses.map((mes, i) => ({ mes, v: valores[i] ?? null })).filter((p): p is { mes: string; v: number } => p.v != null && Number.isFinite(p.v));
    const n = pts.length;
    const vacio: TendenciaSerie = { n, pendiente: null, r2: null, confianza: 'sd', direccion: null, primero: null, ultimo: null, pico: null, minimo: null, cv: null, variacion: null };
    if (!n) return vacio;
    const primero = { mes: pts[0].mes, valor: pts[0].v };
    const ultimo = { mes: pts[n - 1].mes, valor: pts[n - 1].v };
    const pico = pts.reduce((a, b) => (b.v > a.v ? b : a));
    const minimo = pts.reduce((a, b) => (b.v < a.v ? b : a));
    const base = { ...vacio, primero, ultimo, pico: { mes: pico.mes, valor: pico.v }, minimo: { mes: minimo.mes, valor: minimo.v }, variacion: n > 1 ? ultimo.valor - primero.valor : null };
    const t = tendenciaLineal(pts.map((p) => ({ x: indiceMes(p.mes), y: p.v })));
    if (!t) return base; // menos de 3 puntos: ni pendiente
    const r = resumenSerie(pts.map((p) => p.v));
    const cv = r && r.media > 0.05 ? r.desv / r.media : null;
    const conPend = { ...base, pendiente: t.pendiente, r2: t.r2, cv };
    if (n < TENDENCIA_MIN_N) return { ...conPend, confianza: 'descriptiva' };
    if (t.r2 >= TENDENCIA_MIN_R2 && Math.abs(t.pendiente) > TENDENCIA_MIN_PENDIENTE) return { ...conPend, confianza: 'clara', direccion: t.pendiente > 0 ? 'sube' : 'baja' };
    return { ...conPend, confianza: 'sin-tendencia', direccion: 'estable' };
}

export interface TendenciaModulo extends TendenciaSerie { id: number | 'srl'; etiqueta: string; color: string }

/** Tendencia por módulo del periodo + el promedio SRL (según la base elegida). */
export function tendenciasDelPeriodo(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): TendenciaModulo[] {
    const idx = new Map<string, FilaAnalisis>();
    for (const f of filas) idx.set(`${f.numero_modulo}|${mesDe(f.mes)}`, f);
    const ids = MODULOS_SRL_IDS.filter((m) => cfg.modulos.includes(m));
    const porModulo = ids.map((m): TendenciaModulo => ({
        id: m, etiqueta: `Módulo ${m}`, color: COLOR_MODULO_SRL[m] ?? '#64748b',
        ...tendenciaDeSerie(meses, meses.map((mes) => idx.get(`${m}|${mes}`)?.ndvi_medio ?? null)),
    }));
    if (ids.length < 2) return porModulo;
    const srl = meses.map((mes) => promedioDeMes(filas, ids, mes, cfg.basePromedio));
    return [...porModulo, { id: 'srl', etiqueta: `Promedio SRL (${cfg.basePromedio})`, color: '#1f2328', ...tendenciaDeSerie(meses, srl) }];
}

function promedioDeMes(filas: FilaAnalisis[], ids: number[], mes: string, base: BasePromedio): number | null {
    const f = ids.map((m) => filas.find((x) => x.numero_modulo === m && mesDe(x.mes) === mes)).filter((x): x is FilaAnalisis => !!x);
    if (!f.length) return null;
    if (base === 'ponderado') {
        let num = 0, den = 0;
        for (const x of f) if (x.superficie_ha != null && x.superficie_ha > 0) { num += x.ndvi_medio * x.superficie_ha; den += x.superficie_ha; }
        return den > 0 ? num / den : null;
    }
    return media(f.map((x) => x.ndvi_medio));
}

// ─────────────────────────── Comparación por periodos ───────────────────────────

export interface FilaComparacion { numero: number; nombre: string; a: number | null; b: number | null; delta: number | null; pct: number | null; nA: number; nB: number }

export interface ComparacionPeriodos {
    kind: 'periodos' | 'mesVsMes';
    etiquetaA: string;
    etiquetaB: string;
    mesesA: string[];
    mesesB: string[];
    filas: FilaComparacion[];
    promA: number | null;
    promB: number | null;
    delta: number | null;
    pct: number | null;
    mejor: FilaComparacion | null;
    peor: FilaComparacion | null;
    /** Los rangos A y B comparten meses. */
    traslapados: boolean;
}

const etq = (r: RangoMes) => (r.desde === r.hasta ? r.desde : `${r.desde} a ${r.hasta}`);
const pct = (a: number | null, d: number | null) => (a == null || d == null || a === 0 ? null : (d / Math.abs(a)) * 100);

export function compararPeriodos(filas: FilaAnalisis[], cfg: ConfigInformeNdvi): ComparacionPeriodos {
    const k = cfg.comparacion;
    const ids = MODULOS_SRL_IDS.filter((m) => cfg.modulos.includes(m));
    const mesesDe = (r: RangoMes) => Array.from(new Set(filas.filter((f) => enRango(f.mes, r)).map((f) => mesDe(f.mes)))).sort();
    const lado = (m: number, r: RangoMes) => {
        const f = filas.filter((x) => x.numero_modulo === m && enRango(x.mes, r));
        return { v: media(f.map((x) => x.ndvi_medio)), n: f.length, nombre: f[0]?.nombre_modulo ?? `Módulo ${m}`, sup: f[0]?.superficie_ha ?? null };
    };
    const filasCmp: FilaComparacion[] = ids.map((m) => {
        const A = lado(m, k.a), B = lado(m, k.b);
        const delta = A.v != null && B.v != null ? B.v - A.v : null;
        return { numero: m, nombre: A.nombre !== `Módulo ${m}` ? A.nombre : B.nombre, a: A.v, b: B.v, delta, pct: pct(A.v, delta), nA: A.n, nB: B.n };
    });
    const pesos = new Map(ids.map((m) => [m, lado(m, k.b).sup ?? lado(m, k.a).sup]));
    const prom = (sel: (f: FilaComparacion) => number | null): number | null => {
        if (cfg.basePromedio === 'ponderado') {
            let num = 0, den = 0;
            for (const f of filasCmp) { const v = sel(f), w = pesos.get(f.numero); if (v != null && w != null && w > 0) { num += v * w; den += w; } }
            return den > 0 ? num / den : null;
        }
        return media(filasCmp.map(sel));
    };
    const promA = prom((f) => f.a), promB = prom((f) => f.b);
    const delta = promA != null && promB != null ? promB - promA : null;
    const conDelta = filasCmp.filter((f) => f.delta != null).sort((x, y) => (y.delta as number) - (x.delta as number));
    const mesesA = mesesDe(k.a), mesesB = mesesDe(k.b);
    return {
        kind: k.tipo === 'mesVsMes' ? 'mesVsMes' : 'periodos',
        etiquetaA: etq(k.a), etiquetaB: etq(k.b), mesesA, mesesB, filas: filasCmp, promA, promB, delta, pct: pct(promA, delta),
        mejor: conDelta[0] ?? null, peor: conDelta.length > 1 ? conDelta[conDelta.length - 1] : null,
        traslapados: mesesA.some((m) => mesesB.includes(m)),
    };
}

// ─────────────────────────── Módulo contra módulo ───────────────────────────

export interface IndicadorPar { clave: 'ndvi' | 'icv' | 'ihr' | 'kc'; etiqueta: string; a: number | null; b: number | null; max: number; decimales: number }

export interface ComparacionModulos {
    kind: 'modulos';
    A: { numero: number; nombre: string; color: string };
    B: { numero: number; nombre: string; color: string };
    meses: string[];
    serieA: (number | null)[];
    serieB: (number | null)[];
    indicadores: IndicadorPar[];
    /** B − A del NDVI medio del periodo. */
    delta: number | null;
    /** Meses (con dato en ambos) en que A supera a B. */
    mesesAMayor: number;
    mesesComunes: number;
}

export function compararModulos(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ComparacionModulos {
    const { moduloA, moduloB } = cfg.comparacion;
    const sel = (m: number) => filas.filter((f) => f.numero_modulo === m && meses.includes(mesDe(f.mes)));
    const fA = sel(moduloA), fB = sel(moduloB);
    const serie = (f: FilaAnalisis[]) => meses.map((mes) => f.find((x) => mesDe(x.mes) === mes)?.ndvi_medio ?? null);
    const entrada = (f: FilaAnalisis) => ({ numeroModulo: f.numero_modulo, nombreModulo: f.nombre_modulo, ndviMedio: f.ndvi_medio, ndviDesv: f.ndvi_desv, fraccionCoberturaActiva: f.fraccion_cobertura_activa, superficieHa: f.superficie_ha, volumenAcumuladoHm3: null });
    const par = (clave: IndicadorPar['clave'], etiqueta: string, max: number, decimales: number, fn: (f: FilaAnalisis) => number | null): IndicadorPar =>
        ({ clave, etiqueta, a: media(fA.map(fn)), b: media(fB.map(fn)), max, decimales });
    const sA = serie(fA), sB = serie(fB);
    const comunes = meses.map((_, i) => (sA[i] != null && sB[i] != null ? i : -1)).filter((i) => i >= 0);
    const nombre = (m: number, f: FilaAnalisis[]) => f[0]?.nombre_modulo ?? `Módulo ${m}`;
    const nA = media(fA.map((f) => f.ndvi_medio)), nB = media(fB.map((f) => f.ndvi_medio));
    return {
        kind: 'modulos',
        A: { numero: moduloA, nombre: nombre(moduloA, fA), color: COLOR_MODULO_SRL[moduloA] ?? '#64748b' },
        B: { numero: moduloB, nombre: nombre(moduloB, fB), color: COLOR_MODULO_SRL[moduloB] ?? '#64748b' },
        meses, serieA: sA, serieB: sB,
        indicadores: [
            par('ndvi', 'NDVI', 0.8, 2, (f) => f.ndvi_medio),
            par('icv', 'ICV (0–100)', 100, 0, (f) => calcICV(entrada(f)).valor),
            par('ihr', 'IHR (0–100)', 100, 0, (f) => calcIHR(entrada(f)).valor),
            par('kc', 'Kc estimado', 1.05, 2, (f) => f.kc_estimado),
        ],
        delta: nA != null && nB != null ? nB - nA : null,
        mesesAMayor: comunes.filter((i) => (sA[i] as number) > (sB[i] as number)).length,
        mesesComunes: comunes.length,
    };
}

// ─────────────────────────── Módulo contra promedio SRL ───────────────────────────

export interface ComparacionVsSrl {
    kind: 'vsSRL';
    modulo: { numero: number; nombre: string; color: string };
    meses: string[];
    serie: (number | null)[];
    /** Promedio simple de los 6 módulos SRL por mes (referencia institucional, no depende del filtro de módulos). */
    srl: (number | null)[];
    diferencia: (number | null)[];
    difMedia: number | null;
    mesesPorEncima: number;
    mesesComunes: number;
}

export function compararVsSrl(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ComparacionVsSrl {
    const m = cfg.comparacion.moduloA;
    const serie = meses.map((mes) => filas.find((f) => f.numero_modulo === m && mesDe(f.mes) === mes)?.ndvi_medio ?? null);
    const srl = meses.map((mes) => media(MODULOS_SRL_IDS.map((id) => filas.find((f) => f.numero_modulo === id && mesDe(f.mes) === mes)?.ndvi_medio ?? null)));
    const dif = meses.map((_, i) => (serie[i] != null && srl[i] != null ? (serie[i] as number) - (srl[i] as number) : null));
    const conDif = dif.filter((d): d is number => d != null);
    const nombre = filas.find((f) => f.numero_modulo === m)?.nombre_modulo ?? `Módulo ${m}`;
    return {
        kind: 'vsSRL', modulo: { numero: m, nombre, color: COLOR_MODULO_SRL[m] ?? '#64748b' },
        meses, serie, srl, diferencia: dif, difMedia: media(dif),
        mesesPorEncima: conDif.filter((d) => d > 0).length, mesesComunes: conDif.length,
    };
}

// ─────────────────────────── Orquestación ───────────────────────────

export type ResultadoAnalisis =
    | { modo: 'tendencia'; tendencias: TendenciaModulo[]; meses: string[] }
    | { modo: 'comparativo'; comparacion: ComparacionPeriodos | ComparacionModulos | ComparacionVsSrl; meses: string[] };

export function construirAnalisis(filas: FilaAnalisis[], cfg: ConfigInformeNdvi, meses: string[]): ResultadoAnalisis | null {
    if (cfg.modo === 'tendencia') return { modo: 'tendencia', tendencias: tendenciasDelPeriodo(filas, cfg, meses), meses };
    if (cfg.modo !== 'comparativo') return null;
    const t = cfg.comparacion.tipo;
    if (t === 'modulos') return { modo: 'comparativo', comparacion: compararModulos(filas, cfg, meses), meses };
    if (t === 'vsSRL') return { modo: 'comparativo', comparacion: compararVsSrl(filas, cfg, meses), meses };
    return { modo: 'comparativo', comparacion: compararPeriodos(filas, cfg), meses };
}
