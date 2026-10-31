/**
 * suficiencia — modelo PURO de la tarjeta "Suficiencia" del Dashboard.
 *
 * Responde, según el momento, dos preguntas distintas:
 *  · PRE-CICLO (presas sin extracción): ¿con lo que hay alcanza para el próximo ciclo y cómo voy frente a años anteriores?
 *  · TEMPORADA (presas abiertas): ¿el volumen útil alcanza hasta el 30-sep al ritmo de extracción actual?
 *
 * Reglas: S/D (null) nunca 0; el volumen útil descuenta el volumen muerto (Boquilla: curva en la cota muerta oficial;
 * Madero: PISO de la curva, que NO es un muerto oficial → se marca "estimado"); una presa sin lectura no se suma
 * (el total es S/D, no una suma parcial); la proyección y la demanda de referencia son PROVISIONALES y se rotulan.
 */
import { cotasDePresa, volumenPorElevacion, type PuntoCurva } from './presaNiveles';
import {
    anioInicioCiclo, bandaCiclos, coberturaSerie, diaDeCiclo, rellenarHuecos, ritmoActual, serieCiclo, ultimoDiaCiclo,
    COBERTURA_MIN_CICLO, DIAS_CICLO, MIN_CICLOS, etiquetaCiclo, type CicloHistorico, type RitmoActual,
} from './analiticaPresas';
import { posicionEnCiclos } from './analiticaPresas';
import type { Indice } from './historicoPresas';
import type { EstadoKpi } from './dashboardKpisEjecutivos';

/** Demanda de referencia sobre las presas (Mm³). PROVISIONAL: descenso neto del almacenamiento 1-mar → 29-sep-2026 (≈ salida bruta). Validar con operación. */
export const DEMANDA_REF_PROVISIONAL_MM3 = 506;
/** Cobertura (útil / demanda de referencia): ≥1.5 suficiente, 1.0–1.5 atención, <1.0 crítico. PROVISIONAL. */
export const COBERTURA_OK = 1.5;
export const COBERTURA_CRIT = 1.0;
const M3S_A_MM3_DIA = 0.0864;
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

export type ModoSuficiencia = 'preciclo' | 'temporada';

export interface PresaEntrada {
    id: 'PRE-001' | 'PRE-002' | string;
    nombre: string;
    almacenadoMm3: number | null;
    capacidadMm3: number;
    curva: PuntoCurva[];
}

export interface PresaSuficiencia {
    id: string; nombre: string;
    almacenadoMm3: number | null; capacidadMm3: number;
    muertoMm3: number | null;
    /** false = piso de la curva (no es un volumen muerto oficial): rotular "estimado". */
    muertoOficial: boolean;
    utilMm3: number | null;
}

export interface BandaHistorica {
    ciclosUsados: number;
    etiquetas: string[];
    min: (number | null)[]; mediana: (number | null)[]; max: (number | null)[];
    actual: (number | null)[];
    diaHoy: number;
    posicion: { posicion: number; de: number } | null;
    vsMedianaPct: number | null;
    ritmo: RitmoActual | null;
}

export interface ModeloSuficiencia {
    modo: ModoSuficiencia;
    estado: EstadoKpi;
    utilTotalMm3: number | null;
    almacenadoTotalMm3: number | null;
    muertoTotalMm3: number | null;
    presas: PresaSuficiencia[];
    demanda: { mm3: number | null; provisional: boolean };
    cobertura: number | null;
    /** Solo temporada: días que alcanza el útil al ritmo actual y días que faltan al 30-sep. */
    diasAlcance: number | null;
    diasRestantes: number | null;
    banda: BandaHistorica | null;
    aviso: string[];
}

/** Volumen muerto de una presa: curva en la cota muerta oficial; sin cota oficial, el piso (mínimo) de la curva. */
export function muertoDePresa(id: string, curva: PuntoCurva[]): { mm3: number | null; oficial: boolean } {
    const cotaMuerta = cotasDePresa(id).muerta;
    if (cotaMuerta != null) {
        const v = volumenPorElevacion(curva, cotaMuerta);
        if (fin(v)) return { mm3: v, oficial: true };
    }
    const vols = curva.map((p) => p.volumen_mm3).filter(fin);
    return vols.length ? { mm3: Math.min(...vols), oficial: false } : { mm3: null, oficial: false };
}

export function presaSuficiencia(p: PresaEntrada): PresaSuficiencia {
    const m = muertoDePresa(p.id, p.curva);
    const util = fin(p.almacenadoMm3) && m.mm3 != null ? Math.max(0, p.almacenadoMm3 - m.mm3) : null;
    return { id: p.id, nombre: p.nombre, almacenadoMm3: p.almacenadoMm3, capacidadMm3: p.capacidadMm3, muertoMm3: m.mm3, muertoOficial: m.oficial, utilMm3: util };
}

// ── Histórico del total (Boquilla + Madero) ──────────────────────────────────
/** Serie del TOTAL por día del ciclo: solo cuenta el día si AMBAS presas tienen dato (sumar una sola daría una caída falsa). */
export function serieTotalCiclo(indice: Indice, anioInicio: number): (number | null)[] {
    const a = serieCiclo(indice['PRE-001'], anioInicio), b = serieCiclo(indice['PRE-002'], anioInicio);
    return Array.from({ length: DIAS_CICLO }, (_, d) => (fin(a[d]) && fin(b[d]) ? (a[d] as number) + (b[d] as number) : null));
}

/** Ciclos pasados comparables del total: cobertura suficiente; los huecos cortos se interpolan solo en los pasados. */
export function ciclosTotales(indice: Indice, anioActual: number, aniosAtras = 8): CicloHistorico[] {
    const out: CicloHistorico[] = [];
    for (let a = anioActual - aniosAtras; a < anioActual; a++) {
        const cruda = serieTotalCiclo(indice, a);
        const cobertura = coberturaSerie(cruda, a);
        if (cobertura < COBERTURA_MIN_CICLO) continue;
        out.push({ anioInicio: a, etiqueta: etiquetaCiclo(a), serie: rellenarHuecos(cruda), cobertura });
    }
    return out;
}

export function bandaHistorica(indice: Indice | null, hoyISO: string): BandaHistorica | null {
    if (!indice) return null;
    const anio = anioInicioCiclo(hoyISO);
    const ciclos = ciclosTotales(indice, anio);
    if (ciclos.length < MIN_CICLOS) return null;
    const diaHoy = diaDeCiclo(hoyISO, anio);
    const actual = serieTotalCiclo(indice, anio);
    let valorHoy: number | null = null;
    for (let d = Math.min(diaHoy, actual.length - 1); d >= 0; d--) if (actual[d] != null) { valorHoy = actual[d]; break; }
    const banda = bandaCiclos(ciclos);
    const mediana = banda[diaHoy]?.mediana ?? null;
    return {
        ciclosUsados: ciclos.length, etiquetas: ciclos.map((c) => c.etiqueta),
        min: banda.map((b) => b.min), mediana: banda.map((b) => b.mediana), max: banda.map((b) => b.max), actual, diaHoy,
        posicion: posicionEnCiclos(valorHoy, ciclos, diaHoy),
        vsMedianaPct: valorHoy != null && mediana != null && mediana > 0 ? (valorHoy / mediana) * 100 : null,
        ritmo: ritmoActual(actual, anio, diaHoy, ciclos),
    };
}

// ── Modelo ───────────────────────────────────────────────────────────────────
export interface EntradaSuficiencia {
    presas: PresaEntrada[];
    /** Extracción total medida (m³/s); null = S/D; ≤ 0.0001 = presas cerradas. */
    extraccionM3s: number | null;
    hoyISO: string;
    indice: Indice | null;
    demandaRefMm3?: number | null;
}

export function modeloSuficiencia(e: EntradaSuficiencia): ModeloSuficiencia {
    const presas = e.presas.map(presaSuficiencia);
    const completas = presas.length > 0 && presas.every((p) => p.utilMm3 != null && p.almacenadoMm3 != null);
    const util = completas ? presas.reduce((a, p) => a + (p.utilMm3 as number), 0) : null;
    const alm = completas ? presas.reduce((a, p) => a + (p.almacenadoMm3 as number), 0) : null;
    const muerto = completas ? presas.reduce((a, p) => a + (p.muertoMm3 as number), 0) : null;
    const demandaMm3 = e.demandaRefMm3 === undefined ? DEMANDA_REF_PROVISIONAL_MM3 : e.demandaRefMm3;
    const cobertura = util != null && fin(demandaMm3) && demandaMm3 > 0 ? util / demandaMm3 : null;
    const abiertas = fin(e.extraccionM3s) && e.extraccionM3s > 0.0001;
    const modo: ModoSuficiencia = abiertas ? 'temporada' : 'preciclo';
    const anio = anioInicioCiclo(e.hoyISO);
    const diasRestantes = Math.max(0, ultimoDiaCiclo(anio) - diaDeCiclo(e.hoyISO, anio));
    const diasAlcance = abiertas && util != null ? util / ((e.extraccionM3s as number) * M3S_A_MM3_DIA) : null;

    const aviso: string[] = [];
    if (presas.some((p) => !p.muertoOficial && p.muertoMm3 != null)) aviso.push('Madero: volumen muerto estimado (piso de la curva)');
    if (cobertura != null) aviso.push('Demanda de referencia provisional');
    if (!fin(e.extraccionM3s)) aviso.push('Extracción sin dato');

    let estado: EstadoKpi;
    if (util == null) estado = { tipo: 'sd', texto: 'S/D' };
    else if (modo === 'temporada' && diasAlcance != null) {
        estado = diasAlcance >= diasRestantes ? { tipo: 'ok', texto: 'Alcanza al 30-sep', corto: 'Alcanza' }
            : diasAlcance >= diasRestantes * 0.6 ? { tipo: 'warn', texto: 'Atención' } : { tipo: 'crit', texto: 'No alcanza', corto: 'Crítico' };
    } else if (cobertura != null) {
        estado = cobertura >= COBERTURA_OK ? { tipo: 'ok', texto: 'Suficiente' } : cobertura >= COBERTURA_CRIT ? { tipo: 'warn', texto: 'Atención' } : { tipo: 'crit', texto: 'Crítico' };
    } else estado = { tipo: 'info', texto: 'Sin demanda de referencia', corto: 'Sin referencia' };

    return { modo, estado, utilTotalMm3: util, almacenadoTotalMm3: alm, muertoTotalMm3: muerto, presas, demanda: { mm3: fin(demandaMm3) ? demandaMm3 : null, provisional: true }, cobertura, diasAlcance, diasRestantes, banda: bandaHistorica(e.indice, e.hoyISO), aviso };
}
