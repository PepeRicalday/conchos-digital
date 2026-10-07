/**
 * infografiaPresas — datos puros de la infografía "Estado actual de las presas".
 *
 * Cifras tal cual el informe CILA/USIBWC (tabla lecturas_presas_cila): almacenamiento, % de conservación y
 * capacidad de conservación. Regla rectora "S/D nunca cero": todo dato ausente es `null` y se imprime "S/D".
 * Sin React ni Supabase: las entradas las arma el botón (BotonInfografiaPresas).
 */
import { agregarAlmacenamiento, calcularFrescura, type ProcedenciaNivel } from './presaMetrics';
import { mismaFecha, type MapaPresa, type PresaId } from './historicoPresas';
import { semaforo, type EstadoSemaforo } from './estadisticaHistorica';

export interface LecturaCilaInf {
    fecha: string; // YYYY-MM-DD (día del dato)
    almacenamiento_mm3: number | null;
    pct_conservacion: number | null;
    cap_conservacion_mm3: number | null;
    /** Cuándo se publicó el archivo (timestamptz ISO): es la hora de corte. */
    archivo_last_modified: string | null;
}

export interface EntradaPresaInfografia {
    id: PresaId;
    nombre: string;
    actual: LecturaCilaInf | null;
    /** Lectura CILA inmediata anterior (para el cambio vs día anterior). */
    previa: Pick<LecturaCilaInf, 'fecha' | 'almacenamiento_mm3' | 'pct_conservacion'> | null;
    /** Serie normalizada de la presa (v_presas_serie_diaria) para comparar contra años anteriores. */
    historico: MapaPresa | undefined;
    elevacion: { valor: number | null; procedencia: ProcedenciaNivel | null };
    /** Gasto de salida de SICA; `conocida=false` ⇒ S/D (el 0 de arranque no es medición). */
    salida: { valor: number | null; conocida: boolean };
}

export interface DatosPresaInfografia {
    id: PresaId;
    nombre: string;
    volumen: number | null;
    pct: number | null;
    capacidad: number | null;
    fechaDato: string | null;
    /** Cambio contra la lectura previa: hm³ y puntos porcentuales. null = S/D. */
    delta: { mm3: number; puntosPct: number | null; desde: string; dias: number } | null;
    /** Mismo día del año anterior (±3 días). null = S/D. */
    anioPrevio: { anio: number; fecha: string; valor: number; difMm3: number } | null;
    posicion: { posicion: number; de: number; desdeAnio: number } | null;
    /** "2.º más bajo desde 2021" / "El más bajo desde 2021" / "El más alto desde 2021". */
    posicionTexto: string | null;
    semaforo: EstadoSemaforo;
    elevacion: number | null;
    procedencia: ProcedenciaNivel | null;
    salida: number | null;
}

export interface DatosInfografia {
    presas: DatosPresaInfografia[];
    conjunto: { totalMm3: number | null; presasConDato: number; presasTotal: number; parcial: boolean };
    corte: { fechaDato: string | null; instante: string | null; texto: string | null };
    vigencia: { estado: 'ACTUALIZADO' | 'DESFASADO' | 'SD'; texto: string };
    fuente: string;
    limitacion: string;
}

export const FUENTE_INFOGRAFIA = 'Fuente: International Boundary & Water Commission (IBWC), United States and Mexico.';
export const LIMITACION_INFOGRAFIA = 'El almacenamiento reportado no equivale a volumen autorizado para riego.';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "06 de octubre de 2026" desde YYYY-MM-DD. */
export function fechaLarga(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
    if (!a || !m || !d) return null;
    return `${String(d).padStart(2, '0')} de ${MESES[m - 1]} de ${a}`;
}

/** Hora local de Chihuahua (HH:mm) de un instante ISO; null si no hay instante válido. */
export function horaChihuahua(instanteIso: string | null | undefined): string | null {
    if (!instanteIso) return null;
    const t = new Date(instanteIso);
    if (!Number.isFinite(t.getTime())) return null;
    return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Chihuahua', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
}

/** hm³ con 3 decimales; null → "S/D". */
export function fmtHm3(v: number | null | undefined, dec = 3): string {
    return v == null || !Number.isFinite(v) ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Con signo explícito (▲/▼ lo pone la plantilla): "+1.780" / "−0.219"; null → "S/D". */
export function fmtConSigno(v: number | null | undefined, dec = 3): string {
    if (v == null || !Number.isFinite(v)) return 'S/D';
    const s = fmtHm3(Math.abs(v), dec);
    return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

const diasEntre = (a: string, b: string): number => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);

function etiquetaPosicion(pos: { posicion: number; de: number; desdeAnio: number }): string {
    if (pos.posicion === 1) return `El más bajo desde ${pos.desdeAnio}`;
    if (pos.posicion === pos.de) return `El más alto desde ${pos.desdeAnio}`;
    return `${pos.posicion}.º más bajo desde ${pos.desdeAnio}`;
}

function datosPresa(e: EntradaPresaInfografia): DatosPresaInfografia {
    const a = e.actual;
    const volumen = a?.almacenamiento_mm3 ?? null;
    const pct = a?.pct_conservacion ?? null;
    const fechaDato = a?.fecha ?? null;

    let delta: DatosPresaInfografia['delta'] = null;
    if (a && volumen != null && e.previa && e.previa.almacenamiento_mm3 != null && e.previa.fecha < a.fecha) {
        delta = {
            mm3: volumen - e.previa.almacenamiento_mm3,
            puntosPct: pct != null && e.previa.pct_conservacion != null ? pct - e.previa.pct_conservacion : null,
            desde: e.previa.fecha,
            dias: diasEntre(e.previa.fecha, a.fecha),
        };
    }

    let anioPrevio: DatosPresaInfografia['anioPrevio'] = null;
    let posicion: DatosPresaInfografia['posicion'] = null;
    if (fechaDato && volumen != null && e.historico) {
        const anio = +fechaDato.slice(0, 4);
        const mes = +fechaDato.slice(5, 7);
        const dia = +fechaDato.slice(8, 10);
        const previos = Array.from({ length: Math.max(0, anio - 2021) }, (_, i) => 2021 + i); // el archivo histórico inicia en 2021
        const comp = mismaFecha(e.historico, mes, dia, previos, 'volumen', 'normalizada', 3);
        const delAnioPrevio = comp.find(c => c.anio === anio - 1);
        if (delAnioPrevio) anioPrevio = { anio: delAnioPrevio.anio, fecha: delAnioPrevio.fecha, valor: delAnioPrevio.valor, difMm3: volumen - delAnioPrevio.valor };
        if (comp.length >= 2) {
            const menores = comp.filter(c => c.valor < volumen).length;
            posicion = { posicion: menores + 1, de: comp.length + 1, desdeAnio: Math.min(...comp.map(c => c.anio)) };
        }
    }

    return {
        id: e.id, nombre: e.nombre, volumen, pct, capacidad: a?.cap_conservacion_mm3 ?? null, fechaDato,
        delta, anioPrevio, posicion,
        posicionTexto: posicion ? etiquetaPosicion(posicion) : null,
        semaforo: semaforo(posicion),
        elevacion: e.elevacion.valor,
        procedencia: e.elevacion.valor != null ? e.elevacion.procedencia : null,
        salida: e.salida.conocida ? e.salida.valor : null,
    };
}

export function construirDatosInfografia(entradas: EntradaPresaInfografia[]): DatosInfografia {
    const presas = entradas.map(datosPresa);

    const agregado = agregarAlmacenamiento(entradas.map(e => ({
        capacidad_max_mm3: e.actual?.cap_conservacion_mm3 ?? 0,
        lectura: e.actual ? { fecha: e.actual.fecha, almacenamiento_mm3: e.actual.almacenamiento_mm3 } : null,
    })));

    // Corte = hora de publicación del archivo más reciente; el día del dato es el de la lectura más reciente.
    const fechaDato = presas.map(p => p.fechaDato).filter((f): f is string => !!f).sort().at(-1) ?? null;
    const instantes = entradas.map(e => e.actual?.archivo_last_modified).filter((x): x is string => !!x).sort();
    const instante = instantes.at(-1) ?? null;
    const hora = horaChihuahua(instante);
    const largaFecha = fechaLarga(fechaDato);
    const texto = largaFecha ? `Corte: ${largaFecha}${hora ? ` · ${hora} h` : ''}` : null;

    // Vigencia: el dato de CILA lleva fecha del día; se considera actualizado si es de hoy o de ayer (reporte de la mañana).
    const fr = calcularFrescura(instante ?? fechaDato, 36);
    const vigencia: DatosInfografia['vigencia'] = !fr ? { estado: 'SD', texto: 'S/D' }
        : fr.stale ? { estado: 'DESFASADO', texto: fr.texto }
        : { estado: 'ACTUALIZADO', texto: fr.texto };

    return {
        presas,
        conjunto: { totalMm3: agregado.totalMm3, presasConDato: agregado.presasConDato, presasTotal: agregado.presasTotal, parcial: agregado.parcial },
        corte: { fechaDato, instante, texto },
        vigencia,
        fuente: FUENTE_INFOGRAFIA,
        limitacion: LIMITACION_INFOGRAFIA,
    };
}
