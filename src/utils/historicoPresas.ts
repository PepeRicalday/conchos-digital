/**
 * historicoPresas — lógica pura del Análisis Histórico de presas (sin React ni Supabase).
 *
 * Fuente: la vista v_presas_serie_diaria (operativo CAMPO/CILA + histórico SRL 2021-2025).
 * Regla rectora "S/D nunca cero": un día sin dato es `null`, jamás 0; las agregaciones lo excluyen y,
 * si no queda información suficiente, devuelven `null` para que la interfaz muestre S/D.
 */

export type PresaId = 'PRE-001' | 'PRE-002';
/** Ids canónicos de presa en BD (`presas.id`). Identificar SIEMPRE por id: `presas.codigo` vale "1"/"2", no PLB/PFM. */
export const ID_BOQUILLA: PresaId = 'PRE-001';
export const ID_MADERO: PresaId = 'PRE-002';
export type Metrica = 'volumen' | 'elevacion' | 'llenado';
/** normalizada = recalculada con la curva vigente (comparable entre años) · reportada = tal como salió en el reporte. */
export type TipoSerie = 'normalizada' | 'reportada';
export type Calidad = 'OK' | 'SIN_DATO' | 'REVISAR' | 'FUERA_DE_RANGO';
export type Fuente = 'CAMPO' | 'CILA' | 'HISTORICO';

/** Fila tal como la devuelve v_presas_serie_diaria. */
export interface FilaSerie {
    presa_id: string;
    fecha: string; // YYYY-MM-DD
    escala_msnm: number | string | null;
    almacenamiento_mm3: number | string | null;
    pct: number | string | null;
    fuente: Fuente;
    calidad: Calidad;
    almacenamiento_reportado_mm3: number | string | null;
    pct_reportado: number | string | null;
}

export interface PuntoDia {
    fecha: string;
    escala: number | null;
    alm: number | null;
    pct: number | null;
    almRep: number | null;
    pctRep: number | null;
    fuente: Fuente;
    calidad: Calidad;
}

export type MapaPresa = Map<string, PuntoDia>;
export type Indice = Record<string, MapaPresa>;

export const NOMBRE_PRESA: Record<string, string> = { 'PRE-001': 'La Boquilla', 'PRE-002': 'Fco. I. Madero' };
export const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function diasDelMes(anio: number, mes: number): number {
    return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

export const claveFecha = (anio: number, mes: number, dia: number): string =>
    `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** Día del año en calendario bisiesto fijo (2000): permite alinear años bisiestos y no bisiestos. */
export function diaDelAnio(mes: number, dia: number): number {
    return Math.round((Date.UTC(2000, mes - 1, dia) - Date.UTC(2000, 0, 1)) / 86400000);
}

/** Agrupa las filas por presa y fecha. Si una fecha viene repetida prevalece lo operativo (CAMPO > CILA > HISTORICO). */
export function indexarSerie(filas: FilaSerie[]): Indice {
    const prioridad: Record<Fuente, number> = { CAMPO: 3, CILA: 2, HISTORICO: 1 };
    const idx: Indice = {};
    for (const f of filas) {
        const mapa = (idx[f.presa_id] ??= new Map());
        const previo = mapa.get(f.fecha);
        if (previo && prioridad[previo.fuente] >= prioridad[f.fuente]) continue;
        mapa.set(f.fecha, {
            fecha: f.fecha,
            escala: num(f.escala_msnm),
            alm: num(f.almacenamiento_mm3),
            pct: num(f.pct),
            almRep: num(f.almacenamiento_reportado_mm3),
            pctRep: num(f.pct_reportado),
            fuente: f.fuente,
            calidad: f.calidad,
        });
    }
    return idx;
}

/** Valor de una métrica en un día. La elevación es una medición: es la misma en ambas series. */
export function valorMetrica(p: PuntoDia | undefined, metrica: Metrica, serie: TipoSerie): number | null {
    if (!p) return null;
    // Un día marcado FUERA_DE_RANGO tiene una escala inverosímil: no se grafica.
    if (p.calidad === 'FUERA_DE_RANGO' && metrica === 'elevacion') return null;
    if (metrica === 'elevacion') return p.escala;
    if (metrica === 'volumen') return serie === 'normalizada' ? p.alm : p.almRep;
    return serie === 'normalizada' ? p.pct : p.pctRep;
}

export function aniosDisponibles(idx: Indice): number[] {
    const s = new Set<number>();
    for (const mapa of Object.values(idx)) for (const k of mapa.keys()) s.add(Number(k.slice(0, 4)));
    return [...s].sort((a, b) => b - a);
}

/** Serie diaria de un mes: arreglo de longitud = días del mes (índice = día-1), null donde no hay dato. */
export function serieMes(mapa: MapaPresa | undefined, anio: number, mes: number, metrica: Metrica, serie: TipoSerie): (number | null)[] {
    const n = diasDelMes(anio, mes);
    return Array.from({ length: n }, (_, i) => valorMetrica(mapa?.get(claveFecha(anio, mes, i + 1)), metrica, serie));
}

/** Serie del año alineada por día del año (366 posiciones, calendario bisiesto fijo). */
export function serieAnio(mapa: MapaPresa | undefined, anio: number, metrica: Metrica, serie: TipoSerie): (number | null)[] {
    const out: (number | null)[] = Array.from({ length: 366 }, () => null);
    if (!mapa) return out;
    for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= diasDelMes(anio, m); d++) {
            out[diaDelAnio(m, d)] = valorMetrica(mapa.get(claveFecha(anio, m, d)), metrica, serie);
        }
    }
    return out;
}

export interface ValorFechado { fecha: string; valor: number }

/** Último dato disponible de un mes (S/D si el mes no tiene ninguno). */
export function cierreMes(mapa: MapaPresa | undefined, anio: number, mes: number, metrica: Metrica, serie: TipoSerie): ValorFechado | null {
    for (let d = diasDelMes(anio, mes); d >= 1; d--) {
        const v = valorMetrica(mapa?.get(claveFecha(anio, mes, d)), metrica, serie);
        if (v != null) return { fecha: claveFecha(anio, mes, d), valor: v };
    }
    return null;
}

/** Primer dato disponible de un mes. */
export function aperturaMes(mapa: MapaPresa | undefined, anio: number, mes: number, metrica: Metrica, serie: TipoSerie): ValorFechado | null {
    const n = diasDelMes(anio, mes);
    for (let d = 1; d <= n; d++) {
        const v = valorMetrica(mapa?.get(claveFecha(anio, mes, d)), metrica, serie);
        if (v != null) return { fecha: claveFecha(anio, mes, d), valor: v };
    }
    return null;
}

export interface DeltaMes {
    delta: number;
    desde: ValorFechado;
    hasta: ValorFechado;
    /** 'mes-anterior': del último dato del mes previo (convención de los reportes SRL) · 'primer-dia': del primer dato del mes. */
    base: 'mes-anterior' | 'primer-dia';
}

/**
 * Cambio durante un mes. Convención de los reportes de la SRL ("aumento en el año"): último dato del mes
 * menos último dato del mes anterior. Si no hay mes previo, se usa el primer dato del propio mes.
 * Devuelve null (S/D) si no hay al menos dos puntos distintos en el tiempo — nunca 0 por falta de datos.
 */
export function deltaMes(mapa: MapaPresa | undefined, anio: number, mes: number, metrica: Metrica, serie: TipoSerie): DeltaMes | null {
    const hasta = cierreMes(mapa, anio, mes, metrica, serie);
    if (!hasta) return null;
    const mesPrev = mes === 1 ? 12 : mes - 1;
    const anioPrev = mes === 1 ? anio - 1 : anio;
    const previo = cierreMes(mapa, anioPrev, mesPrev, metrica, serie);
    if (previo) return { delta: hasta.valor - previo.valor, desde: previo, hasta, base: 'mes-anterior' };
    const desde = aperturaMes(mapa, anio, mes, metrica, serie);
    if (!desde || desde.fecha === hasta.fecha) return null;
    return { delta: hasta.valor - desde.valor, desde, hasta, base: 'primer-dia' };
}

export interface PosicionAnual { anio: number; valor: number; fecha: string }

/** Cierre de un mes en cada año, ordenado de menor a mayor. */
export function cierresPorAnio(mapa: MapaPresa | undefined, anios: number[], mes: number, metrica: Metrica, serie: TipoSerie): PosicionAnual[] {
    const out: PosicionAnual[] = [];
    for (const a of anios) {
        const c = cierreMes(mapa, a, mes, metrica, serie);
        if (c) out.push({ anio: a, valor: c.valor, fecha: c.fecha });
    }
    return out.sort((x, y) => x.valor - y.valor);
}

/** Posición (1 = el más bajo) del año base entre los años con dato; null si el año base no tiene dato o hay <2 años. */
export function posicionHistorica(cierres: PosicionAnual[], anioBase: number): { posicion: number; de: number } | null {
    const i = cierres.findIndex(c => c.anio === anioBase);
    if (i < 0 || cierres.length < 2) return null;
    return { posicion: i + 1, de: cierres.length };
}

export interface CeldaMatriz { valor: number | null; fecha: string | null; dias: number; diasMes: number }

/** Matriz año × mes con el cierre de cada mes (para el mapa de calor). */
export function matrizMensual(mapa: MapaPresa | undefined, anios: number[], metrica: Metrica, serie: TipoSerie): Map<number, CeldaMatriz[]> {
    const m = new Map<number, CeldaMatriz[]>();
    for (const a of anios) {
        m.set(a, Array.from({ length: 12 }, (_, i) => {
            const mes = i + 1;
            const serieDias = serieMes(mapa, a, mes, metrica, serie);
            const c = cierreMes(mapa, a, mes, metrica, serie);
            return { valor: c?.valor ?? null, fecha: c?.fecha ?? null, dias: serieDias.filter(v => v != null).length, diasMes: serieDias.length };
        }));
    }
    return m;
}

export interface Extremos { max: ValorFechado; min: ValorFechado }

export function extremos(mapa: MapaPresa | undefined, metrica: Metrica, serie: TipoSerie): Extremos | null {
    if (!mapa) return null;
    let max: ValorFechado | null = null;
    let min: ValorFechado | null = null;
    for (const [fecha, p] of mapa) {
        const v = valorMetrica(p, metrica, serie);
        if (v == null) continue;
        if (!max || v > max.valor) max = { fecha, valor: v };
        if (!min || v < min.valor) min = { fecha, valor: v };
    }
    return max && min ? { max, min } : null;
}

export interface CalidadMes { diasMes: number; conDato: number; sinDato: number; atipicos: number; fuentes: Fuente[] }

export function calidadMes(mapa: MapaPresa | undefined, anio: number, mes: number): CalidadMes {
    const diasMes = diasDelMes(anio, mes);
    let conDato = 0;
    let atipicos = 0;
    const fuentes = new Set<Fuente>();
    for (let d = 1; d <= diasMes; d++) {
        const p = mapa?.get(claveFecha(anio, mes, d));
        if (!p) continue;
        if (p.escala != null || p.alm != null) {
            conDato++;
            fuentes.add(p.fuente);
        }
        if (p.calidad === 'REVISAR' || p.calidad === 'FUERA_DE_RANGO') atipicos++;
    }
    return { diasMes, conDato, sinDato: diasMes - conDato, atipicos, fuentes: [...fuentes] };
}

export interface ComparacionFecha { anio: number; fecha: string; valor: number; desfaseDias: number }

/**
 * Valor de la misma fecha (mes/día) en cada año anterior. Si ese día exacto no existe se toma el dato más cercano
 * dentro de ±tolerancia días (y se informa el desfase); si no hay ninguno, el año no aparece (S/D).
 */
export function mismaFecha(mapa: MapaPresa | undefined, mes: number, dia: number, anios: number[], metrica: Metrica, serie: TipoSerie, tolerancia = 3): ComparacionFecha[] {
    const out: ComparacionFecha[] = [];
    if (!mapa) return out;
    for (const a of anios) {
        const ref = Date.UTC(a, mes - 1, Math.min(dia, diasDelMes(a, mes)));
        for (let off = 0; off <= tolerancia; off++) {
            let hallado: ComparacionFecha | null = null;
            for (const signo of off === 0 ? [0] : [-1, 1]) {
                const t = new Date(ref + signo * off * 86400000).toISOString().slice(0, 10);
                const v = valorMetrica(mapa.get(t), metrica, serie);
                if (v != null) { hallado = { anio: a, fecha: t, valor: v, desfaseDias: signo * off }; break; }
            }
            if (hallado) { out.push(hallado); break; }
        }
    }
    return out;
}

export const formatearNumero = (v: number | null | undefined, decimales = 1): string =>
    v == null || !Number.isFinite(v) ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

export function etiquetaMetrica(m: Metrica): { nombre: string; unidad: string; decimales: number } {
    return m === 'volumen' ? { nombre: 'Volumen almacenado', unidad: 'Mm³', decimales: 1 }
        : m === 'elevacion' ? { nombre: 'Elevación', unidad: 'msnm', decimales: 2 }
        : { nombre: 'Llenado', unidad: '%', decimales: 1 };
}
