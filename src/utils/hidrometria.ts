/**
 * hidrometria — programa semanal de riego contra lo entregado, por módulo, con la regla "S/D nunca cero".
 *
 * Antes la página comparaba un caudal MEDIO semanal programado contra un caudal INSTANTÁNEO entregado, convertía la
 * falta de solicitud en 0 (y 0 en "Crítico (Fuga)") y mostraba semanas futuras como 0. Aquí todo se compara en la
 * misma magnitud (volumen, Mm³) y lo que no existe es null.
 */
import { estadoPorCobertura, UMBRAL_DEFICIT_PCT, UMBRAL_SUPERAVIT_PCT } from './balanceModulo';

export const SEGUNDOS_POR_DIA = 86_400;
export const DIAS_SEMANA = 7;

export interface SolicitudSemana { modulo_id: string; volumen_solicitado_mm3: number | string | null }
export interface EntregaDia { modulo_id: string | null; fecha: string; volumen_m3: number | string | null; gasto_m3s?: number | string | null }
export interface ModuloSemana { id: string; short_code?: string | null; name: string; daily_vol?: number | null; current_flow?: number | null; target_flow?: number | null }

export type EstadoCumplimiento = 'sin_solicitud' | 'sin_dato' | 'futura' | 'bajo' | 'cumple' | 'sobre';

export interface FilaSemana {
    moduloId: string;
    nombre: string;
    /** Volumen solicitado para la semana (Mm³); null = no hay solicitud capturada. */
    programadoMm3: number | null;
    /** Volumen entregado en la semana hasta hoy (Mm³); null = sin ninguna captura. */
    entregadoMm3: number | null;
    /** Caudal medio equivalente al volumen programado (m³/s). */
    programadoM3s: number | null;
    /** Caudal medio de lo entregado en los días transcurridos (m³/s). */
    entregadoM3s: number | null;
    /** Entregado / programado PRORRATEADO a los días transcurridos (%); null si falta cualquiera de los dos. */
    cumplimientoPct: number | null;
    estado: EstadoCumplimiento;
    /** Días de la semana con captura de entrega. */
    diasConCaptura: number;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Mm³ → caudal medio (m³/s) sobre `dias` días. */
export const mm3ACaudalMedio = (mm3: number | null, dias = DIAS_SEMANA): number | null =>
    mm3 == null || dias <= 0 ? null : (mm3 * 1_000_000) / (dias * SEGUNDOS_POR_DIA);

/** Caudal medio (m³/s) sostenido `dias` días → Mm³. */
export const caudalAMm3 = (m3s: number | null, dias = DIAS_SEMANA): number | null =>
    m3s == null ? null : (m3s * dias * SEGUNDOS_POR_DIA) / 1_000_000;

/** Suma `n` días a "YYYY-MM-DD" (aritmética UTC, sin depender de la zona del navegador). */
export function sumaDias(fecha: string, n: number): string {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** Días de la semana [inicio, fin] ya transcurridos al día `hoy` (0 si la semana es futura, 7 si ya terminó). */
export function diasTranscurridos(inicio: string, fin: string, hoy: string): number {
    if (hoy < inicio) return 0;
    if (hoy >= fin) return DIAS_SEMANA;
    return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / (SEGUNDOS_POR_DIA * 1000)) + 1;
}

/**
 * Volumen entregado por un módulo en la semana. Las filas de `entregas_modulo` aportan los días ANTERIORES a hoy; el
 * día de hoy lo aporta `dailyVolHoyMm3` (acumulado en vivo del store), para no contarlo dos veces.
 * Devuelve null si no hay ninguna captura (no 0).
 */
export function entregadoSemana(
    entregas: EntregaDia[], moduloId: string, inicio: string, fin: string, hoy: string, dailyVolHoyMm3: number | null,
): { mm3: number | null; dias: number } {
    let sumaM3 = 0;
    const dias = new Set<string>();
    for (const e of entregas) {
        if (e.modulo_id !== moduloId || e.fecha < inicio || e.fecha > fin || e.fecha === hoy) continue;
        const v = num(e.volumen_m3);
        if (v == null) continue;
        sumaM3 += v;
        dias.add(e.fecha);
    }
    let total = dias.size > 0 ? sumaM3 / 1_000_000 : null;
    if (hoy >= inicio && hoy <= fin && dailyVolHoyMm3 != null && dailyVolHoyMm3 > 0) {
        total = (total ?? 0) + dailyVolHoyMm3;
        dias.add(hoy);
    }
    return { mm3: total, dias: dias.size };
}

export interface EntradaSemana {
    modulos: ModuloSemana[];
    solicitudes: SolicitudSemana[];
    entregas: EntregaDia[];
    inicio: string;
    fin: string;
    /** Día de hoy en hora de Chihuahua ("YYYY-MM-DD"). */
    hoy: string;
}

export function construyeFilasSemana(e: EntradaSemana): FilaSemana[] {
    const transcurridos = diasTranscurridos(e.inicio, e.fin, e.hoy);
    return e.modulos.map((m) => {
        const sol = e.solicitudes.find((s) => s.modulo_id === m.id);
        const programadoMm3 = num(sol?.volumen_solicitado_mm3);
        const dailyHoy = num(m.daily_vol);
        const ent = transcurridos === 0
            ? { mm3: null, dias: 0 }
            : entregadoSemana(e.entregas, m.id, e.inicio, e.fin, e.hoy, dailyHoy);
        const prorrata = programadoMm3 != null ? (programadoMm3 * transcurridos) / DIAS_SEMANA : null;
        const cumplimientoPct = prorrata != null && prorrata > 0 && ent.mm3 != null ? (ent.mm3 / prorrata) * 100 : null;

        let estado: EstadoCumplimiento;
        if (transcurridos === 0) estado = 'futura';
        else if (programadoMm3 == null) estado = 'sin_solicitud';
        else if (ent.mm3 == null || cumplimientoPct == null) estado = 'sin_dato';
        else {
            const s = estadoPorCobertura(cumplimientoPct);
            estado = s === 'DEFICIT' ? 'bajo' : s === 'SUPERAVIT' ? 'sobre' : 'cumple';
        }
        return {
            moduloId: m.id,
            nombre: m.short_code || m.name,
            programadoMm3,
            entregadoMm3: ent.mm3,
            programadoM3s: mm3ACaudalMedio(programadoMm3),
            entregadoM3s: ent.mm3 != null && transcurridos > 0 ? mm3ACaudalMedio(ent.mm3, transcurridos) : null,
            cumplimientoPct,
            estado,
            diasConCaptura: ent.dias,
        };
    });
}

export const ETIQUETA_CUMPLIMIENTO: Record<EstadoCumplimiento, string> = {
    sin_solicitud: 'Sin solicitud', sin_dato: 'Sin captura', futura: 'Semana futura',
    bajo: `Bajo (< ${UMBRAL_DEFICIT_PCT} %)`, cumple: 'Cumple', sobre: `Sobre (> ${UMBRAL_SUPERAVIT_PCT} %)`,
};

/** Orden de atención: lo que más se aparta del programa primero; sin solicitud/captura al final. */
const PESO: Record<EstadoCumplimiento, number> = { bajo: 0, sobre: 1, cumple: 2, sin_dato: 3, sin_solicitud: 4, futura: 5 };
export function ordenaPorDesviacion(filas: FilaSemana[]): FilaSemana[] {
    const desv = (f: FilaSemana) => (f.cumplimientoPct == null ? 0 : Math.abs(f.cumplimientoPct - 100));
    return [...filas].sort((a, b) => PESO[a.estado] - PESO[b.estado] || desv(b) - desv(a) || a.nombre.localeCompare(b.nombre));
}

export interface ResumenSemana {
    programadoMm3: number | null;
    entregadoMm3: number | null;
    /** Cumplimiento global prorrateado, solo sobre módulos con solicitud Y captura; null si ninguno. */
    cumplimientoPct: number | null;
    modulosConSolicitud: number;
    modulosTotal: number;
}

export function resumenSemana(filas: FilaSemana[], inicio: string, fin: string, hoy: string): ResumenSemana {
    const transcurridos = diasTranscurridos(inicio, fin, hoy);
    const conSol = filas.filter((f) => f.programadoMm3 != null);
    const comparables = conSol.filter((f) => f.entregadoMm3 != null);
    const prog = comparables.reduce((a, f) => a + (f.programadoMm3! * transcurridos) / DIAS_SEMANA, 0);
    const ent = comparables.reduce((a, f) => a + f.entregadoMm3!, 0);
    const entregados = filas.filter((f) => f.entregadoMm3 != null);
    return {
        programadoMm3: conSol.length ? conSol.reduce((a, f) => a + f.programadoMm3!, 0) : null,
        entregadoMm3: entregados.length ? entregados.reduce((a, f) => a + f.entregadoMm3!, 0) : null,
        cumplimientoPct: comparables.length && prog > 0 ? (ent / prog) * 100 : null,
        modulosConSolicitud: conSol.length,
        modulosTotal: filas.length,
    };
}

/** Fecha más reciente con captura de entrega por módulo (para rotular de cuándo es el "gasto actual"). */
export function ultimaCapturaEntregas(entregas: EntregaDia[]): string | null {
    const f = entregas.filter((e) => (num(e.gasto_m3s) ?? 0) > 0 || (num(e.volumen_m3) ?? 0) > 0).map((e) => e.fecha).sort();
    return f.length ? f[f.length - 1] : null;
}

// ── Captura de solicitudes (modal) ───────────────────────────────────────────
/** Texto del campo → m³/s. Vacío o inválido = null (no se escribe nada); "0" explícito = 0 real. */
export function parseCaudalCampo(texto: string): number | null {
    const t = texto.trim().replace(',', '.');
    if (t === '') return null;
    const v = Number(t);
    return Number.isFinite(v) && v >= 0 ? v : null;
}

export interface SolicitudAEscribir { modulo_id: string; fecha_inicio: string; fecha_fin: string; volumen_solicitado_mm3: number }

/** Solo los módulos con valor capturado se escriben; los campos vacíos NO generan filas de 0 Mm³. */
export function solicitudesAEscribir(valores: Record<string, string>, inicio: string, fin: string): SolicitudAEscribir[] {
    const out: SolicitudAEscribir[] = [];
    for (const [id, texto] of Object.entries(valores)) {
        const q = parseCaudalCampo(texto);
        if (q == null) continue;
        out.push({ modulo_id: id, fecha_inicio: inicio, fecha_fin: fin, volumen_solicitado_mm3: Number((caudalAMm3(q) ?? 0).toFixed(6)) });
    }
    return out;
}
