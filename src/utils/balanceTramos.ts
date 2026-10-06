/**
 * balanceTramos — balance de masa por tramo (entre escalas consecutivas) con la regla "S/D nunca cero".
 *
 * Qe = Qs + Qtomas + pérdidas. Es un balance DE TRAMO; la cifra global que llama "eficiencia" todo el sistema es la
 * de conducción K-0→K-104 (utils/conduccion.ts). Correcciones respecto a la versión embebida en la página:
 *  · una escala sin km ya no cae en el km 0 (se excluye y se cuenta aparte);
 *  · un caudal de toma nulo no es una "toma activa" ni suma 0 disfrazado;
 *  · canal cerrado medido (Qe = 0) se distingue de "sin dato";
 *  · la toma exactamente en el km final del último tramo entra al balance;
 *  · la clasificación sale de UNA sola función (getEfficiencyStatus).
 */
import { calculateSectionBalance, esSifon, propagarQSifon, type BalanceTramo, type PerfilTramo } from './hydraulics';
import { UMBRAL_PERDIDA_M3S } from './dashboardKpis';

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export interface FilaEscalaRaw {
    escala_id: string; nombre?: string | null; km?: number | string | null; nivel_actual?: number | string | null;
    gasto_calculado_m3s?: number | string | null; seccion_nombre?: string | null;
}
export interface EscalaBalance { escala_id: string; nombre: string; km: number; nivel: number | null; gasto: number | null; seccion_nombre: string }

export interface FilaTomaRaw {
    punto_id: string; caudal_promedio?: number | string | null;
    puntos_entrega?: { nombre?: string | null; km?: number | string | null } | null;
}
export interface TomaBalance { punto_id: string; nombre: string; km: number; caudal: number }

/** Normaliza las escalas. Devuelve las utilizables (con km) y cuántas se descartaron por no tener km. */
export function normalizaEscalas(filas: FilaEscalaRaw[]): { escalas: EscalaBalance[]; sinKm: number } {
    const escalas: EscalaBalance[] = [];
    let sinKm = 0;
    for (const f of filas) {
        const km = num(f.km);
        if (km == null) { sinKm++; continue; }
        escalas.push({ escala_id: f.escala_id, nombre: f.nombre || f.escala_id, km, nivel: num(f.nivel_actual), gasto: num(f.gasto_calculado_m3s), seccion_nombre: f.seccion_nombre ?? '' });
    }
    return { escalas: escalas.sort((a, b) => a.km - b.km), sinKm };
}

/** Normaliza las tomas del día: solo las que tienen km y caudal > 0 son tomas activas; el resto no suma ni cuenta. */
export function normalizaTomas(filas: FilaTomaRaw[]): { tomas: TomaBalance[]; descartadas: number } {
    const tomas: TomaBalance[] = [];
    let descartadas = 0;
    for (const f of filas) {
        const km = num(f.puntos_entrega?.km);
        const q = num(f.caudal_promedio);
        if (km == null || q == null || q <= 0) { descartadas++; continue; }
        tomas.push({ punto_id: f.punto_id, nombre: f.puntos_entrega?.nombre || 'Toma', km, caudal: q });
    }
    return { tomas, descartadas };
}

/** K-23 es un sifón: la fórmula radial no aplica, su Q se propaga desde K-0 (solo si K-0 tiene gasto > 0). */
export function propagaSifones(escalas: EscalaBalance[]): EscalaBalance[] {
    const k0 = escalas.find((e) => e.km === 0)?.gasto ?? null;
    if (k0 == null || k0 <= 0) return escalas;
    return escalas.map((e) => (esSifon(e.nombre) ? { ...e, gasto: propagarQSifon(e.nombre, k0) } : e));
}

/** Suma de las tomas del tramo [kmA, kmB): la del último tramo incluye también el km final. */
export function qTomasEntre(tomas: TomaBalance[], kmA: number, kmB: number, incluyeFin: boolean): number {
    return tomas.filter((t) => t.km >= kmA && (incluyeFin ? t.km <= kmB : t.km < kmB)).reduce((a, t) => a + t.caudal, 0);
}

export interface TramoBalance extends BalanceTramo {
    /** Entrada medida en 0 con las dos escalas con dato: el tramo está cerrado (no es "sin dato"). */
    cerrado: boolean;
}

export function construyeBalance(escalasIn: EscalaBalance[], tomas: TomaBalance[], perfil: PerfilTramo[]): TramoBalance[] {
    const escalas = [...escalasIn].sort((a, b) => a.km - b.km);
    const out: TramoBalance[] = [];
    for (let i = 0; i < escalas.length - 1; i++) {
        const e1 = escalas[i], e2 = escalas[i + 1];
        const qTomas = qTomasEntre(tomas, e1.km, e2.km, i === escalas.length - 2);
        const p = perfil.find((t) => e1.km >= t.km_inicio && e1.km < t.km_fin);
        // Un extremo SIN gasto → sin dato (nunca se toma como 0 y se fabrica una fuga).
        const faltante = e1.gasto == null || e2.gasto == null;
        const cerrado = !faltante && e1.gasto === 0;
        const b = calculateSectionBalance(`${e1.nombre} → ${e2.nombre}`, e1.km, e2.km, faltante ? 0 : (e1.gasto as number), faltante ? 0 : (e2.gasto as number), qTomas, p);
        out.push({ ...b, cerrado });
    }
    return out;
}

export interface ResumenBalance {
    tramos: number;
    conDato: number;
    sinDato: number;
    cerrados: number;
    anomalos: number;
    /** Tramos con pérdida real (alerta/crítico, sin anomalía de medición). */
    fugas: number;
}

export function resumenBalance(t: TramoBalance[]): ResumenBalance {
    const cerrados = t.filter((b) => b.cerrado).length;
    const sinDato = t.filter((b) => b.sinDato && !b.cerrado).length;
    return {
        tramos: t.length,
        conDato: t.filter((b) => !b.sinDato && !b.anomalo).length,
        sinDato, cerrados,
        anomalos: t.filter((b) => b.anomalo).length,
        fugas: t.filter((b) => !b.anomalo && !b.sinDato && (b.estado === 'critico' || b.estado === 'alerta')).length,
    };
}

/** ¿La pérdida del tramo es material (≥ umbral compartido)? Antes 0.5 y 0.01 m³/s sueltos en la página. */
export const perdidaMaterial = (qPerdidas: number | null | undefined): boolean => qPerdidas != null && qPerdidas >= UMBRAL_PERDIDA_M3S;

/** Orden de atención: lo más urgente primero; sin dato y cerrados al final. */
const PESO: Record<string, number> = { critico: 0, alerta: 1, atencion: 2, optimo: 3, sin_dato: 4 };
export function ordenaPorSeveridad(t: TramoBalance[]): TramoBalance[] {
    return [...t].sort((a, b) => (a.cerrado ? 5 : (PESO[a.estado] ?? 9)) - (b.cerrado ? 5 : (PESO[b.estado] ?? 9)) || a.km_inicio - b.km_inicio);
}

// ── Estado visual de un tramo (texto + tipo; nunca solo color) ──────────────
import { getEfficiencyStatus } from './hydraulics';
import type { EstadoVisual } from './eficienciaCanal';

export function estadoTramo(b: TramoBalance): { texto: string; tipo: EstadoVisual } {
    if (b.cerrado) return { texto: 'Cerrado (Q = 0)', tipo: 'sd' };
    if (b.sinDato) return { texto: 'S/D', tipo: 'sd' };
    if (b.anomalo) return { texto: 'Dato anómalo', tipo: 'info' };
    const s = getEfficiencyStatus(b.eficiencia);
    return { texto: s.label, tipo: s.nivel === 'optimo' ? 'ok' : s.nivel === 'atencion' ? 'warn' : 'crit' };
}
