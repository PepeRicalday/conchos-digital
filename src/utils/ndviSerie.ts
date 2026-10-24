/**
 * ndviSerie — carga ÚNICA y utilidades comunes de la serie mensual v2 (ndvi_modulo_mensual_v2, metodo 'scl-mediana-v1':
 * Sentinel-2, máscara de nubes por píxel SCL y MEDIANA mensual sobre el polígono del módulo).
 *
 * Panel, ficha, plano, tarjetas e informes leen de aquí: una sola cifra por módulo y mes en toda la app.
 * Regla "S/D nunca cero": un mes sin píxeles válidos llega con ndvi_mediana = null y NO genera fila para el panel
 * (queda como hueco); jamás se rellena con otro mes ni con la serie anterior (ndvi_modulo_historico es otra magnitud:
 * promedio de 30 días sin máscara; nunca se empalma con esta).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { calcICV, calcIHR } from './indicesSrl';
import type { FilaNdviV2 } from './ndviInteranual';
import type { FilaNdviInforme } from './informeNdviDatos';
export { NDVI_RANGO } from './ndviRampa';

export const METODO_NDVI_V2 = 'scl-mediana-v1';
/** Rótulo del método para encabezados de informes y fichas. */
export const ROTULO_METODO_NDVI = 'Mediana mensual con máscara de nubes por píxel (Sentinel-2), serie 2021–2026';

/** Tope alto de filas: la serie son ~70 meses × 6 módulos; supera con holgura el máximo por defecto de PostgREST. */
export const LIMITE_FILAS_NDVI = 5000;

export const COLS_NDVI_V2 =
    'numero_modulo, nombre_modulo, mes, ndvi_mediana, ndvi_medio, ndvi_min, ndvi_max, ndvi_desv, ndvi_p10, ndvi_p90, fraccion_cobertura_activa, ' +
    'n_escenas, pct_pixeles_validos, muestras_validas, kc_estimado, superficie_ha, ventana_desde, ventana_hasta, nubosidad_max_pct';

/** Fila de ndvi_modulo_mensual_v2 con todas las columnas que usa la app (extiende la mínima del comparativo interanual). */
export interface FilaNdviV2Completa extends FilaNdviV2 {
    nombre_modulo: string | null;
    ndvi_medio: number | null;
    ndvi_min: number | null;
    ndvi_max: number | null;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    muestras_validas: number | null;
    ventana_desde: string | null;
    ventana_hasta: string | null;
    nubosidad_max_pct: number | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function normaliza(r: Record<string, unknown>): FilaNdviV2Completa {
    return {
        numero_modulo: Number(r.numero_modulo), nombre_modulo: (r.nombre_modulo as string | null) ?? null, mes: String(r.mes).slice(0, 7),
        ndvi_mediana: num(r.ndvi_mediana), ndvi_medio: num(r.ndvi_medio), ndvi_min: num(r.ndvi_min), ndvi_max: num(r.ndvi_max), ndvi_desv: num(r.ndvi_desv),
        ndvi_p10: num(r.ndvi_p10), ndvi_p90: num(r.ndvi_p90), fraccion_cobertura_activa: num(r.fraccion_cobertura_activa),
        n_escenas: num(r.n_escenas), pct_pixeles_validos: num(r.pct_pixeles_validos), muestras_validas: num(r.muestras_validas),
        kc_estimado: num(r.kc_estimado), superficie_ha: num(r.superficie_ha),
        ventana_desde: (r.ventana_desde as string | null) ?? null, ventana_hasta: (r.ventana_hasta as string | null) ?? null, nubosidad_max_pct: num(r.nubosidad_max_pct),
    };
}

/** Carga la serie v2 completa (solo lectura). Un error de lectura se devuelve aparte: NO equivale a "sin datos". */
export async function cargarSerieNdviV2(cliente: Pick<SupabaseClient, 'from'>, numeroModulo?: number): Promise<{ filas: FilaNdviV2Completa[]; error: string | null }> {
    let consulta = cliente.from('ndvi_modulo_mensual_v2').select(COLS_NDVI_V2).eq('metodo', METODO_NDVI_V2);
    if (numeroModulo != null) consulta = consulta.eq('numero_modulo', numeroModulo);
    const { data, error } = await consulta.order('mes', { ascending: true }).limit(LIMITE_FILAS_NDVI);
    if (error || !data) return { filas: [], error: error?.message ?? 'Sin respuesta del servidor.' };
    return { filas: (data as unknown as Record<string, unknown>[]).map(normaliza), error: null };
}

// ── Fila para panel/informes ────────────────────────────────────────────────

/** Fila que consumen panel, plano, ficha e informes: `ndvi_medio` ES la mediana v2 (el valor representativo). */
export interface FilaNdviSerie extends FilaNdviInforme {
    ndvi_min: number | null;
    ndvi_max: number | null;
    muestras_validas: number | null;
    ndvi_p10: number | null;
    ndvi_p90: number | null;
}

const indiceMes = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7));
const mesDeIndice = (i: number) => `${Math.floor((i - 1) / 12)}-${String(((i - 1) % 12) + 1).padStart(2, '0')}`;

/**
 * v2 → filas del panel. Se descartan los meses con mediana null (S/D = hueco). `delta_ndvi` = mediana del mes menos la del
 * mes calendario inmediato anterior del mismo módulo; null si ese mes no existe o es S/D (no se salta al mes previo).
 */
export function filasDeSerie(v2: FilaNdviV2Completa[]): FilaNdviSerie[] {
    const porClave = new Map<string, number>();
    for (const f of v2) if (f.ndvi_mediana != null) porClave.set(`${f.numero_modulo}|${f.mes}`, f.ndvi_mediana);
    return v2
        .filter((f): f is FilaNdviV2Completa & { ndvi_mediana: number } => f.ndvi_mediana != null)
        .sort((a, b) => (a.mes === b.mes ? a.numero_modulo - b.numero_modulo : a.mes < b.mes ? -1 : 1))
        .map((f) => {
            const p = porClave.get(`${f.numero_modulo}|${mesDeIndice(indiceMes(f.mes) - 1)}`);
            return {
                numero_modulo: f.numero_modulo, nombre_modulo: f.nombre_modulo ?? `Módulo ${f.numero_modulo}`, mes: f.mes,
                ndvi_medio: f.ndvi_mediana, ndvi_desv: f.ndvi_desv, kc_estimado: f.kc_estimado,
                delta_ndvi: p != null ? f.ndvi_mediana - p : null,
                superficie_ha: f.superficie_ha, fraccion_cobertura_activa: f.fraccion_cobertura_activa,
                ventana_desde: f.ventana_desde, ventana_hasta: f.ventana_hasta, nubosidad_max_pct: f.nubosidad_max_pct,
                n_escenas: f.n_escenas, pct_pixeles_validos: f.pct_pixeles_validos,
                ndvi_min: f.ndvi_min, ndvi_max: f.ndvi_max, muestras_validas: f.muestras_validas, ndvi_p10: f.ndvi_p10, ndvi_p90: f.ndvi_p90,
            };
        });
}

// ── Índices del plano ───────────────────────────────────────────────────────

export type ClaveIndice = 'ndvi' | 'icv' | 'ihr';

export interface FilaIndice {
    numero_modulo: number;
    nombre_modulo: string;
    ndvi_medio: number;
    ndvi_desv: number | null;
    fraccion_cobertura_activa: number | null;
    superficie_ha: number | null;
}

/** Valor del índice elegido para la fila de un módulo; sin fila → null (S/D). ICV/IHR usan la mediana y la ndvi_desv de v2. */
export function valorIndice(clave: ClaveIndice, fila: FilaIndice | undefined): number | null {
    if (!fila) return null;
    if (clave === 'ndvi') return fila.ndvi_medio;
    const base = {
        numeroModulo: fila.numero_modulo, nombreModulo: fila.nombre_modulo,
        ndviMedio: fila.ndvi_medio, ndviDesv: fila.ndvi_desv, fraccionCoberturaActiva: fila.fraccion_cobertura_activa,
        superficieHa: fila.superficie_ha, volumenAcumuladoHm3: null,
    };
    return clave === 'icv' ? calcICV(base).valor : calcIHR(base).valor;
}

export interface PromedioSrl {
    valor: number | null;
    /** Módulos con dato que entran al promedio. */
    n: number;
    /** Módulos que se intentaron promediar. */
    total: number;
}

/** Promedio simple de los valores con dato (null = módulo sin dato, no entra). Devuelve también "n de total". */
export function promedioSrl(valores: (number | null | undefined)[]): PromedioSrl {
    const v = valores.filter((x): x is number => x != null && Number.isFinite(x));
    return { valor: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: v.length, total: valores.length };
}

/** "n de m" legible: "5 de 6 módulos". */
export const textoNDe = (p: Pick<PromedioSrl, 'n' | 'total'>): string => `${p.n} de ${p.total} módulos`;

/** Mes calendario inmediato anterior ('2026-03' → '2026-02'); no salta meses sin dato. */
export const mesAnteriorCalendario = (mes: string): string => mesDeIndice(indiceMes(mes) - 1);

/** Meses 'AAAA-MM' consecutivos de `desde` a `hasta` (inclusive): ejes sin saltos, para que un mes S/D quede como hueco. */
export function mesesContinuos(desde: string, hasta: string): string[] {
    const out: string[] = [];
    for (let i = indiceMes(desde); i <= indiceMes(hasta) && out.length < 600; i++) out.push(mesDeIndice(i));
    return out;
}

/** Serie de los últimos `n` meses (hasta `mesHasta`, inclusive) por módulo para las sparklines; null = mes sin dato. */
export function serieSpark(
    filas: { numero_modulo: number; mes: string; ndvi_medio: number }[],
    meses: string[],
    mesHasta: string,
    modulos: readonly number[],
    n = 6,
): { hasta: string[]; mapa: Map<number, (number | null)[]> } {
    const hasta = meses.filter((m) => m <= mesHasta).slice(-n);
    const mapa = new Map<number, (number | null)[]>();
    for (const mod of modulos) {
        const porMes = new Map(filas.filter((f) => f.numero_modulo === mod).map((f) => [f.mes, f.ndvi_medio]));
        mapa.set(mod, hasta.map((m) => porMes.get(m) ?? null));
    }
    return { hasta, mapa };
}

export interface DeltaVsResto {
    /** Valor del módulo menos el promedio simple de los OTROS módulos con dato; null si el módulo es S/D o no hay otro con dato. */
    delta: number | null;
    /** Otros módulos con dato que forman la referencia. */
    nResto: number;
}

/** Δ de cada módulo contra el promedio de los demás (no contra el promedio que lo incluye: así no se compara consigo mismo). */
export function deltaVsResto(valores: Map<number, number | null>): Map<number, DeltaVsResto> {
    const out = new Map<number, DeltaVsResto>();
    for (const [mod, v] of valores) {
        const otros = [...valores].filter(([m, x]) => m !== mod && x != null && Number.isFinite(x)).map(([, x]) => x as number);
        const resto = otros.length ? otros.reduce((a, b) => a + b, 0) / otros.length : null;
        out.set(mod, { delta: v != null && Number.isFinite(v) && resto != null ? v - resto : null, nResto: otros.length });
    }
    return out;
}
