/**
 * infografiaComprobacion — datos puros de las dos infografías de «Comprobación por tramo» (SICA Conservación).
 * A) la cuenta de un tramo; B) el resumen de un concepto en todo el canal. Sin React ni Supabase.
 * Regla rectora: S/D nunca cero; el criterio es el que el libro aplica en la mayoría de sus tramos, no una norma.
 */
import type { TipoRed } from '../conservacion/derivacion/tipos';
import type { Comprobacion, EstadoComp } from '../conservacion/verificacion/comprobacion';
import type { CriterioInferido } from '../conservacion/verificacion/criterio';
import { fmt } from '../components/conservacion/derivacion/fmt';
import type { ModeloCanal } from '../components/conservacion/derivacion/ubicacionModelo';

export const NOTA_HONESTIDAD = 'Esto no es una verificación normativa. “Sigue el criterio” solo significa que el tramo es coherente con lo que el libro aplica en la mayoría de sus tramos (criterio inferido del propio DIAG-01). “Atípico” es un candidato a revisión, no un error confirmado. El Manual 2026 (§5.8, pp. 63-64) no prescribe una fórmula por tramo.';
export const NOTA_CONFIRMAR = 'Conviene confirmarlo con quien armó el PacOT.';
export const TOPE_ATIPICOS = 8;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "09 de octubre de 2026" desde YYYY-MM-DD; "S/D" si la fecha no es válida. */
export function fechaLarga(iso: string): string {
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
    if (!a || !m || !d || m > 12) return 'S/D';
    return `${String(d).padStart(2, '0')} de ${MESES[m - 1]} de ${a}`;
}

/** YYYY-MM-DD de la hora local del equipo. */
export function hoyIso(ahora: Date = new Date()): string {
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())}`;
}

export const slug = (s: string): string =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'concepto';

export const nombreArchivoTramo = (fila: number, fecha: string): string => `comprobacion-tramo-fila${fila}-${fecha}.png`;
export const nombreArchivoConcepto = (concepto: string, fecha: string): string => `comprobacion-concepto-${slug(concepto)}-${fecha}.png`;

/** Contexto común de ambas infografías. */
export interface ContextoComprobacion {
    /** YYYY-MM-DD de generación. */
    readonly fecha: string;
    /** Logo como data URI; '' si no se pudo cargar (se omite). */
    readonly logo: string;
    /** "SRL" o "M5". */
    readonly ambito: string;
    /** Rótulo de la red ("Red de distribución (canales)"). */
    readonly red: string;
    /** Modelo del perfil y la ubicación (el mismo de la pantalla). Sin él, la infografía cae a la cinta de tramos y omite el mapa. */
    readonly canal?: ModeloCanal | null;
}

export interface AtipicoResumen {
    readonly fila: number;
    readonly obra: string;
    readonly pkInicial: string;
    readonly pkFinal: string;
    readonly enLibro: string;
    readonly unidad: string;
    /** Parámetro libre del tramo: valor implícito (null = no se puede calcular → S/D) frente al del criterio. */
    readonly parametro: { readonly nombre: string; readonly implicito: string | null; readonly criterio: string; readonly unidad: string } | null;
    /** El tramo sigue el criterio pero un control adicional lo marca. */
    readonly porControl: boolean;
}

export interface CeldaCinta { readonly fila: number; readonly longitud: number; readonly estado: EstadoComp }

export interface DatosConcepto {
    readonly concepto: string;
    readonly red: string;
    readonly ambito: string;
    readonly siguen: number;
    readonly total: number;
    readonly nAtipicos: number;
    readonly nSinDatos: number;
    readonly cinta: readonly CeldaCinta[];
    /** Cadenamiento de los extremos de la cinta; null si el concepto abarca varias obras (cada obra tiene su propio cadenamiento). */
    readonly pkIni: string | null;
    readonly pkFin: string | null;
    readonly nObras: number;
    readonly grupos: ReadonlyArray<{ readonly clave: string; readonly n: number; readonly siguen: number; readonly formula: string; readonly sinCriterio: boolean; readonly motivo: string | null; readonly inferencia: boolean }>;
    /** Tipo de red del concepto: en caminos no hay perfil de estructuras ni ubicación (no se inventan). */
    readonly redTipo: TipoRed;
    readonly atipicos: readonly AtipicoResumen[];
    /** Atípicos que no caben en la lista. */
    readonly masAtipicos: number;
    /** Perfil y mapa del canal: el mismo modelo que la pantalla, para contar los mismos tramos y las mismas obras. */
    readonly canal: ModeloCanal | null;
}

const cifra = (v: string | null): string => fmt(v, 4);

export function resumenAtipico(c: Comprobacion): AtipicoResumen {
    const p = c.parametroLibre;
    return {
        fila: c.fila, obra: c.obra, pkInicial: c.pkInicial, pkFinal: c.pkFinal, enLibro: cifra(c.enLibro), unidad: c.unidad,
        parametro: p ? { nombre: p.nombre, implicito: p.implicito, criterio: p.valor, unidad: p.unidad } : null,
        porControl: c.estadoCriterio !== 'atipico',
    };
}

export function construirDatosConcepto(filas: readonly Comprobacion[], crit: CriterioInferido, ctx: Pick<ContextoComprobacion, 'ambito' | 'red' | 'canal'>): DatosConcepto {
    const atip = filas.filter((c) => c.estado === 'atipico').map(resumenAtipico);
    const primera = filas[0];
    const ultima = filas[filas.length - 1];
    const nObras = new Set(filas.map((c) => c.obra)).size;
    return {
        concepto: crit.nombre || crit.concepto,
        red: ctx.red,
        ambito: ctx.ambito,
        siguen: crit.siguen,
        total: crit.total,
        nAtipicos: atip.length,
        nSinDatos: crit.sinDatos,
        cinta: filas.map((c) => ({ fila: c.fila, longitud: Math.max(c.longitudKm ?? 1, 0.05), estado: c.estado })),
        pkIni: nObras > 1 ? null : (primera?.pkInicial ?? null),
        pkFin: nObras > 1 ? null : (ultima?.pkFinal ?? null),
        nObras,
        grupos: crit.grupos.map((g) => ({ clave: g.clave === 'todos' ? 'todos los tramos' : g.clave, n: g.n, siguen: g.siguen, formula: g.formula, sinCriterio: g.modelo === null, motivo: g.motivo ?? null, inferencia: g.inferencia === true })),
        redTipo: crit.red,
        atipicos: atip.slice(0, TOPE_ATIPICOS),
        masAtipicos: Math.max(0, atip.length - TOPE_ATIPICOS),
        canal: ctx.canal ?? null,
    };
}
