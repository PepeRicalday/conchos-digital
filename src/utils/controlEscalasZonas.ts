/**
 * Armado de zonas de Control de Niveles a partir de escalas, lecturas y resumen diario (lógica pura y testeable).
 *
 * "Un dato, una sola verdad": el nivel de HOY sale de la última lectura (rotulada si es arrastre de continuidad);
 * el de una fecha pasada sale solo del resumen de ese día — nunca se rellena con la lectura más reciente de la historia.
 */

import { esEscalaReferencia } from './escalasReferencia';
import { gastoDeLectura } from './geoKpis';
import {
    aNumeroONull, estadoNivel, normalizaRadiales, resumenCompuertas,
    type EstadoNivel, type ResultadoEstado,
} from './controlEscalas';

export interface EscalaMeta {
    id: string;
    nombre: string;
    km: number | string;
    seccion_id?: string | null;
    nivel_min_operativo?: number | string | null;
    nivel_max_operativo?: number | string | null;
    capacidad_max?: number | string | null;
    pzas_radiales?: number | string | null;
    ancho?: number | string | null;
    alto?: number | string | null;
}
export interface SeccionMeta { id: string; nombre: string; color?: string | null }

export interface LecturaEscala {
    escala_id: string;
    fecha: string;
    hora_lectura?: string | null;
    creado_en?: string | null;
    nivel_m?: number | string | null;
    nivel_abajo_m?: number | string | null;
    radiales_json?: unknown;
    gasto_calculado_m3s?: number | string | null;
    gasto_metodo?: string | null;
    confirmada?: boolean | null;
}

export interface ResumenDia {
    escala_id: string;
    lectura_am?: number | string | null;
    lectura_pm?: number | string | null;
    hora_am?: string | null;
    hora_pm?: string | null;
    nivel_actual?: number | string | null;
}

export type OrigenNivel = 'campo' | 'arrastre' | 'resumen' | null;

export interface ScaleReading {
    id: string;
    name: string;
    km: number;
    /** null = S/D (nunca 0). */
    currentLevel: number | null;
    amReading: number | null;
    pmReading: number | null;
    horaAm: string | null;
    horaPm: string | null;
    /** Variación entre las dos lecturas del día; null si falta alguna. */
    deltaM: number | null;
    minOperational: number | null;
    maxOperational: number | null;
    maxCapacity: number | null;
    estado: EstadoNivel;
    desviacionM: number | null;
    alerta: boolean;
    referencia: boolean;
    origen: OrigenNivel;
    horaLectura: string | null;
    pzasRadiales: number;
    anchoRadial: number;
    altoRadial: number;
    /** Aperturas por compuerta (m); null = sin dato. */
    aperturas: Array<number | null>;
    nivelAbajo: number | null;
    /** null = S/D; las escalas de referencia nunca tienen gasto. */
    gasto: number | null;
}

export interface Zone {
    id: string;
    name: string;
    color: string;
    scales: ScaleReading[];
}

export interface OpcionesZonas {
    fecha: string;
    esHoy: boolean;
    vaciado: boolean;
    ahoraMs: number;
}

const hhmm = (h?: string | null) => (h ? h.slice(0, 5) : null);
const clave = (id: string) => id.trim().toUpperCase();

/** Última lectura por escala: la más reciente por fecha/hora/creación. */
export function ultimaPorEscala(lecturas: LecturaEscala[]): Map<string, LecturaEscala> {
    const out = new Map<string, LecturaEscala>();
    const orden = (l: LecturaEscala) => `${l.fecha}|${l.hora_lectura ?? ''}|${l.creado_en ?? ''}`;
    for (const l of lecturas) {
        const k = clave(l.escala_id);
        const prev = out.get(k);
        if (!prev || orden(l) > orden(prev)) out.set(k, l);
    }
    return out;
}

export function construirZonas(
    escalas: EscalaMeta[],
    secciones: SeccionMeta[],
    lecturas: LecturaEscala[],
    resumen: ResumenDia[],
    op: OpcionesZonas,
): Zone[] {
    const secMap = new Map(secciones.map(s => [s.id, s]));
    const ultima = ultimaPorEscala(lecturas);
    const resMap = new Map(resumen.map(r => [clave(r.escala_id), r]));
    const zonas = new Map<string, Zone>();

    for (const e of escalas) {
        const k = clave(e.id);
        const res = resMap.get(k);
        const last = op.esHoy ? ultima.get(k) : undefined;
        const km = Number(e.km);
        const pzas = Number(e.pzas_radiales) || 0;
        const referencia = esEscalaReferencia({ nombre: e.nombre, km });

        // Nivel: hoy → última lectura (rotulada); fecha pasada → solo el resumen de ese día.
        const nivelLast = last ? aNumeroONull(last.nivel_m) : null;
        const nivelRes = res ? aNumeroONull(res.nivel_actual) : null;
        const currentLevel = op.esHoy ? (nivelLast ?? nivelRes) : nivelRes;
        const origen: OrigenNivel = currentLevel == null ? null
            : op.esHoy && nivelLast != null ? (last!.confirmada === false ? 'arrastre' : 'campo') : 'resumen';
        const telemetriaMs = op.esHoy
            ? (last?.creado_en ? new Date(last.creado_en).getTime() : null)
            : op.ahoraMs; // fecha histórica: la frescura no aplica

        const r: ResultadoEstado = estadoNivel({
            nombre: e.nombre, km, nivelM: currentLevel,
            minOperativo: aNumeroONull(e.nivel_min_operativo), maxOperativo: aNumeroONull(e.nivel_max_operativo),
            telemetriaMs, confirmada: origen === 'arrastre' ? false : origen === 'campo' ? true : null,
            vaciado: op.vaciado && op.esHoy, ahoraMs: op.ahoraMs,
        });

        const am = res ? aNumeroONull(res.lectura_am) : null;
        const pm = res ? aNumeroONull(res.lectura_pm) : null;

        const aperturas = normalizaRadiales(last?.radiales_json, pzas);
        let gasto: number | null = null;
        if (last && !referencia && last.confirmada !== false) {
            gasto = (pzas > 0 && resumenCompuertas(aperturas).estado === 'S/D' && last.gasto_metodo !== 'curva_nivel')
                ? aNumeroONull(last.gasto_calculado_m3s)
                : gastoDeLectura(last, { pzas_radiales: pzas, ancho: Number(e.ancho) || 0, nombre: e.nombre, km });
        }

        const secId = e.seccion_id || 'sin-seccion';
        if (!zonas.has(secId)) {
            const s = secMap.get(secId);
            zonas.set(secId, { id: secId, name: s?.nombre || 'Sin sección', color: s?.color || '#6b7280', scales: [] });
        }
        zonas.get(secId)!.scales.push({
            id: e.id, name: e.nombre, km,
            currentLevel, amReading: am, pmReading: pm, horaAm: hhmm(res?.hora_am), horaPm: hhmm(res?.hora_pm),
            deltaM: am != null && pm != null ? pm - am : null,
            minOperational: aNumeroONull(e.nivel_min_operativo), maxOperational: aNumeroONull(e.nivel_max_operativo),
            maxCapacity: aNumeroONull(e.capacidad_max),
            estado: r.estado, desviacionM: r.desviacionM, alerta: r.alerta, referencia, origen,
            horaLectura: last ? hhmm(last.hora_lectura) : null,
            pzasRadiales: pzas, anchoRadial: Number(e.ancho) || 0, altoRadial: Number(e.alto) || 0,
            aperturas,
            nivelAbajo: last ? aNumeroONull(last.nivel_abajo_m) : null,
            gasto,
        });
    }

    for (const z of zonas.values()) z.scales.sort((a, b) => a.km - b.km);
    return [...zonas.values()].sort((a, b) => (a.scales[0]?.km ?? 0) - (b.scales[0]?.km ?? 0));
}
