/**
 * analiticaPresas — lógica PURA de la pestaña "Analítica y forecasting" de Presas (sin React ni Supabase).
 *
 * Ciclo agrícola: del 1 de octubre al 30 de septiembre del año siguiente (ciclo 2026-2027 = 01-oct-2026 → 30-sep-2027).
 * Todo se calcula sobre el volumen NORMALIZADO (Mm³) de la serie histórica real; la proyección no inventa nada:
 * parte del volumen de hoy y le suma lo que cambió el almacenamiento en cada ciclo pasado desde este mismo día del
 * ciclo (trayectorias análogas). Esos cambios YA incluyen aportaciones, evaporación y la extracción de riego de cada
 * ciclo, de modo que no exige una base de extracción que no existe.
 * Regla rectora "S/D nunca cero": sin base suficiente se devuelve null y la interfaz muestra S/D.
 */
import { claveFecha, valorMetrica, type MapaPresa } from './historicoPresas';
import { percentil } from './estadisticaHistorica';

export const DIAS_CICLO = 366;
/** Un ciclo pasado solo entra al comparativo si tiene dato en al menos esta fracción de sus días. */
export const COBERTURA_MIN_CICLO = 0.6;
/** Máximo de días consecutivos sin dato que se rellenan por interpolación lineal en los ciclos PASADOS. */
export const MAX_HUECO_DIAS = 10;
/** Mínimo de ciclos comparables para dibujar banda o proyección. */
export const MIN_CICLOS = 3;

const DIA_MS = 86400000;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-10-14' → '14-oct-2026'. */
export const fechaCorta = (iso: string): string => `${Number(iso.slice(8, 10))}-${MESES[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;

/** Año en que empieza el ciclo al que pertenece una fecha (oct-dic → ese año; ene-sep → el anterior). */
export function anioInicioCiclo(fechaISO: string): number {
    const anio = Number(fechaISO.slice(0, 4));
    return Number(fechaISO.slice(5, 7)) >= 10 ? anio : anio - 1;
}

export const etiquetaCiclo = (anioInicio: number): string => `${anioInicio}-${anioInicio + 1}`;

/** Días transcurridos desde el 1-oct del ciclo (0 = 1 de octubre). */
export function diaDeCiclo(fechaISO: string, anioInicio: number): number {
    const t = Date.UTC(Number(fechaISO.slice(0, 4)), Number(fechaISO.slice(5, 7)) - 1, Number(fechaISO.slice(8, 10)));
    return Math.round((t - Date.UTC(anioInicio, 9, 1)) / DIA_MS);
}

/** Fecha ISO de un día del ciclo (inversa de diaDeCiclo). */
export function fechaDeCiclo(anioInicio: number, dia: number): string {
    return new Date(Date.UTC(anioInicio, 9, 1) + dia * DIA_MS).toISOString().slice(0, 10);
}

/** Último día (índice) que pertenece al ciclo: 30-sep del año siguiente (364 o 365 si hay 29-feb). */
export function ultimoDiaCiclo(anioInicio: number): number {
    return diaDeCiclo(`${anioInicio + 1}-09-30`, anioInicio);
}

/** Volumen normalizado (Mm³) por día del ciclo; longitud 366, null donde no hay dato o el día ya no es del ciclo. */
export function serieCiclo(mapa: MapaPresa | undefined, anioInicio: number): (number | null)[] {
    const ultimo = ultimoDiaCiclo(anioInicio);
    return Array.from({ length: DIAS_CICLO }, (_, d) => {
        if (d > ultimo) return null;
        const f = fechaDeCiclo(anioInicio, d);
        return valorMetrica(mapa?.get(claveFecha(Number(f.slice(0, 4)), Number(f.slice(5, 7)), Number(f.slice(8, 10)))), 'volumen', 'normalizada');
    });
}

/** Fracción de días del ciclo (hasta `hasta`, inclusive) con dato. */
export function coberturaSerie(serie: (number | null)[], anioInicio: number, hasta?: number): number {
    const fin = Math.min(hasta ?? ultimoDiaCiclo(anioInicio), ultimoDiaCiclo(anioInicio));
    let con = 0;
    for (let d = 0; d <= fin; d++) if (serie[d] != null) con++;
    return con / (fin + 1);
}

/** Interpola linealmente los huecos internos de hasta `maxHueco` días; no extrapola en los extremos. */
export function rellenarHuecos(serie: (number | null)[], maxHueco = MAX_HUECO_DIAS): (number | null)[] {
    const out = [...serie];
    let prev = -1;
    for (let i = 0; i < serie.length; i++) {
        if (serie[i] == null) continue;
        if (prev >= 0 && i - prev > 1 && i - prev - 1 <= maxHueco) {
            const a = serie[prev] as number;
            const b = serie[i] as number;
            for (let j = prev + 1; j < i; j++) out[j] = a + ((b - a) * (j - prev)) / (i - prev);
        }
        prev = i;
    }
    return out;
}

export interface CicloHistorico {
    anioInicio: number;
    etiqueta: string;
    /** Serie con huecos cortos interpolados (solo para comparar; nunca se aplica al ciclo en curso). */
    serie: (number | null)[];
    cobertura: number;
}

/**
 * Ciclos pasados comparables: anteriores al ciclo en curso y con cobertura suficiente.
 * `excluidos` lista los que se descartaron por falta de datos (se informan en pantalla).
 */
export function ciclosHistoricos(mapa: MapaPresa | undefined, anioActual: number, aniosAtras = 8): { usados: CicloHistorico[]; excluidos: { anioInicio: number; etiqueta: string; cobertura: number }[] } {
    const usados: CicloHistorico[] = [];
    const excluidos: { anioInicio: number; etiqueta: string; cobertura: number }[] = [];
    if (!mapa) return { usados, excluidos };
    for (let a = anioActual - aniosAtras; a < anioActual; a++) {
        const cruda = serieCiclo(mapa, a);
        const cobertura = coberturaSerie(cruda, a);
        if (cobertura === 0) continue; // ciclo sin ningún dato: no existe en la serie
        if (cobertura < COBERTURA_MIN_CICLO) excluidos.push({ anioInicio: a, etiqueta: etiquetaCiclo(a), cobertura });
        else usados.push({ anioInicio: a, etiqueta: etiquetaCiclo(a), serie: rellenarHuecos(cruda), cobertura });
    }
    return { usados, excluidos };
}

export interface PuntoBanda { dia: number; n: number; min: number | null; mediana: number | null; max: number | null }

/** Envolvente (mínimo, mediana, máximo) de los ciclos pasados por día del ciclo. Con menos de MIN_CICLOS: S/D. */
export function bandaCiclos(ciclos: CicloHistorico[]): PuntoBanda[] {
    return Array.from({ length: DIAS_CICLO }, (_, dia) => {
        const v = ciclos.map(c => c.serie[dia]).filter((x): x is number => x != null);
        if (v.length < MIN_CICLOS) return { dia, n: v.length, min: null, mediana: null, max: null };
        return { dia, n: v.length, min: Math.min(...v), mediana: percentil(v, 50), max: Math.max(...v) };
    });
}

/** Posición (1 = el más bajo) del volumen de hoy entre los ciclos pasados en el mismo día del ciclo. */
export function posicionEnCiclos(valorHoy: number | null, ciclos: CicloHistorico[], diaHoy: number): { posicion: number; de: number } | null {
    if (valorHoy == null) return null;
    const previos = ciclos.map(c => c.serie[diaHoy]).filter((x): x is number => x != null);
    if (previos.length < MIN_CICLOS) return null;
    return { posicion: previos.filter(v => v < valorHoy).length + 1, de: previos.length + 1 };
}

export interface Trayectoria { etiqueta: string; anioInicio: number; valores: (number | null)[] }
export interface PuntoProyeccion { k: number; dia: number; fecha: string; min: number | null; mediana: number | null; max: number | null }
export interface Proyeccion {
    fechaHoy: string;
    diaHoy: number;
    valorHoy: number;
    horizonteDias: number;
    trayectorias: Trayectoria[];
    puntos: PuntoProyeccion[];
}

/**
 * Proyección por trayectorias análogas: volumen de hoy + cambio observado en cada ciclo pasado desde este día del
 * ciclo. Acotada a [0, capacidad]. Devuelve null (S/D) si no hay volumen de hoy o hay menos de MIN_CICLOS trayectorias.
 */
export function proyectarCiclo(
    ciclos: CicloHistorico[], anioActual: number, fechaHoy: string, valorHoy: number | null, horizontePedido: number, capacidad: number | null,
): Proyeccion | null {
    if (valorHoy == null || !Number.isFinite(valorHoy)) return null;
    const diaHoy = diaDeCiclo(fechaHoy, anioActual);
    const restantes = ultimoDiaCiclo(anioActual) - diaHoy;
    const horizonteDias = Math.min(horizontePedido, restantes);
    if (diaHoy < 0 || horizonteDias < 1) return null;
    const tope = capacidad != null && capacidad > 0 ? capacidad : Number.POSITIVE_INFINITY;

    const trayectorias: Trayectoria[] = [];
    for (const c of ciclos) {
        const base = c.serie[diaHoy];
        if (base == null) continue;
        const valores = Array.from({ length: horizonteDias + 1 }, (_, k) => {
            const s = c.serie[diaHoy + k];
            return s == null ? null : Math.min(tope, Math.max(0, valorHoy + (s - base)));
        });
        trayectorias.push({ etiqueta: c.etiqueta, anioInicio: c.anioInicio, valores });
    }
    if (trayectorias.length < MIN_CICLOS) return null;

    const puntos: PuntoProyeccion[] = Array.from({ length: horizonteDias + 1 }, (_, k) => {
        const v = trayectorias.map(t => t.valores[k]).filter((x): x is number => x != null);
        const dia = diaHoy + k;
        const fecha = fechaDeCiclo(anioActual, dia);
        if (v.length < MIN_CICLOS) return { k, dia, fecha, min: null, mediana: null, max: null };
        return { k, dia, fecha, min: Math.min(...v), mediana: percentil(v, 50), max: Math.max(...v) };
    });
    return { fechaHoy, diaHoy, valorHoy, horizonteDias, trayectorias, puntos };
}

export type Escenario = 'seco' | 'mediana' | 'humedo';
export interface CruceUmbral { escenario: Escenario; k: number | null; fecha: string | null }

/** Primer día en que cada escenario llega al umbral (o queda por debajo). null = no cruza dentro del horizonte. */
export function crucesUmbral(p: Proyeccion, umbral: number): CruceUmbral[] {
    const clave: Record<Escenario, 'min' | 'mediana' | 'max'> = { seco: 'min', mediana: 'mediana', humedo: 'max' };
    return (Object.keys(clave) as Escenario[]).map(escenario => {
        const hallado = p.puntos.find(pt => (pt[clave[escenario]] ?? Infinity) <= umbral);
        return { escenario, k: hallado?.k ?? null, fecha: hallado?.fecha ?? null };
    });
}

/** Ritmo (Mm³/día) entre dos días del ciclo en una serie; null si falta cualquiera de los dos. */
export function ritmoEntre(serie: (number | null)[], diaDesde: number, diaHasta: number): number | null {
    const a = serie[diaDesde];
    const b = serie[diaHasta];
    if (a == null || b == null || diaHasta <= diaDesde) return null;
    return (b - a) / (diaHasta - diaDesde);
}

export interface RitmoActual { mm3PorDia: number; desde: string; hasta: string; dias: number; historicoMediana: number | null; ciclosComparados: number }

/**
 * Ritmo de cambio reciente del ciclo en curso (último dato disponible vs el de hace ~`ventana` días, sin interpolar)
 * y la mediana del mismo tramo en ciclos pasados. null si no hay dos lecturas separadas al menos 3 días.
 */
export function ritmoActual(serieActual: (number | null)[], anioActual: number, diaHoy: number, ciclos: CicloHistorico[], ventana = 7): RitmoActual | null {
    let hasta = -1;
    for (let d = Math.min(diaHoy, serieActual.length - 1); d >= 0; d--) if (serieActual[d] != null) { hasta = d; break; }
    if (hasta < 0) return null;
    let desde = -1;
    for (let d = hasta - ventana; d >= Math.max(0, hasta - ventana - 3); d--) if (serieActual[d] != null) { desde = d; break; }
    if (desde < 0) for (let d = hasta - 3; d > hasta - ventana; d--) if (d >= 0 && serieActual[d] != null) { desde = d; break; }
    if (desde < 0 || hasta - desde < 3) return null;
    const mm3PorDia = ritmoEntre(serieActual, desde, hasta);
    if (mm3PorDia == null) return null;
    const hist = ciclos.map(c => ritmoEntre(c.serie, desde, hasta)).filter((x): x is number => x != null);
    return {
        mm3PorDia, desde: fechaDeCiclo(anioActual, desde), hasta: fechaDeCiclo(anioActual, hasta), dias: hasta - desde,
        historicoMediana: hist.length >= MIN_CICLOS ? percentil(hist, 50) : null, ciclosComparados: hist.length,
    };
}
