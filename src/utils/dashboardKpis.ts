/**
 * dashboardKpis — cifras del Centro de Control con la regla "S/D nunca cero".
 *
 * Todo lo que aquí devuelve `null` significa SIN DATO y la UI debe rotularlo "S/D". Antes el Dashboard sumaba
 * `|| 0` y presentaba "Extracción 0.0 m³/s" tanto para un 0 medido como para una presa sin lectura.
 */
import { porcentajeLlenadoPresa, calcularFrescura, type PresaLike, type Frescura } from './presaMetrics';

// ── Umbrales (antes dispersos en Dashboard.tsx) ──────────────────────────────
export const UMBRAL_PERDIDA_M3S = 0.05;
export const UMBRAL_DIAS_PROTOCOLO = 30;
export const EFICIENCIA_TRAMO_MIN_PCT = 90;
export const PRESA_ALTA_PCT = 90;
export const PRESA_BAJA_PCT = 20;
export const TOLERANCIA_SOBREGIRO = 1.1;
export const TOLERANCIA_SOBREGIRO_LLENADO = 1.5;
/** Una alerta persistida sin resolver con más de estos días ya no describe la operación de hoy: es "pendiente antiguo". */
export const DIAS_ALERTA_VIGENTE = 14;
/** Capacidad de conducción de referencia del canal (m³/s) para normalizar el anillo de extracción. */
export const CAPACIDAD_CONDUCCION_M3S = 80;

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// ── Extracción de presas ─────────────────────────────────────────────────────
export interface ExtraccionTotal {
    /** Suma de las extracciones MEDIDAS; `null` si ninguna presa tiene medición. */
    valorM3s: number | null;
    conMedicion: number;
    total: number;
}

type PresaConExtraccion = { lectura: ((PresaLike['lectura'] & object) & { extraccion_conocida?: boolean }) | null };

/** Extracción de UNA presa: null si no hay medición o si ninguna fuente la informa (extraccion_conocida === false: el 0 es de arranque). */
export function extraccionDePresa(p: PresaConExtraccion): number | null {
    if (p.lectura?.extraccion_conocida === false) return null;
    return num(p.lectura?.extraccion_total_m3s);
}

export function extraccionTotalMedida(presas: PresaConExtraccion[]): ExtraccionTotal {
    const medidas = presas
        .map((p) => extraccionDePresa(p))
        .filter((v): v is number => v != null);
    return {
        valorM3s: medidas.length ? medidas.reduce((a, b) => a + b, 0) : null,
        conMedicion: medidas.length,
        total: presas.length,
    };
}

/** Suma de dos fechas "YYYY-MM-DD" desplazada `n` días (aritmética UTC, sin depender de la zona del navegador). */
export function desplazaDia(fecha: string, n: number): string {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

export interface PuntoSerie { fecha: string; total: number | null }

/**
 * Serie diaria de extracción de los últimos `dias` días terminando en `hasta`. Un día sin ninguna medición queda
 * `null` (hueco en la gráfica), no 0; un día con mediciones suma solo las que existen.
 */
export function serieExtraccion(
    filas: { fecha: string; extraccion_total_m3s: number | string | null }[],
    hasta: string,
    dias = 7,
): PuntoSerie[] {
    const porDia = new Map<string, number>();
    for (const f of filas) {
        const v = num(f.extraccion_total_m3s);
        if (v == null) continue;
        porDia.set(f.fecha, (porDia.get(f.fecha) ?? 0) + v);
    }
    return Array.from({ length: dias }, (_, i) => {
        const fecha = desplazaDia(hasta, i - (dias - 1));
        return { fecha, total: porDia.has(fecha) ? porDia.get(fecha)! : null };
    });
}

/** Tendencia con los dos últimos días CON dato (±5 %). `null` si no hay base de comparación — sin números mágicos. */
export function tendenciaSerie(serie: PuntoSerie[]): 'rising' | 'falling' | 'stable' | null {
    const conDato = serie.filter((p) => p.total != null) as { fecha: string; total: number }[];
    if (conDato.length < 2) return null;
    const ultimo = conDato[conDato.length - 1].total;
    const previo = conDato[conDato.length - 2].total;
    if (previo <= 0) return ultimo > 0 ? 'rising' : 'stable';
    if (ultimo > previo * 1.05) return 'rising';
    if (ultimo < previo * 0.95) return 'falling';
    return 'stable';
}

// ── Almacenamiento por presa (gráfica) ───────────────────────────────────────
export interface PresaGrafica { nombre: string; actual: number | null; capacidad: number; pct: number | null }

export function datosAlmacenamientoPresas(
    presas: (PresaLike & { nombre_corto?: string | null; nombre: string })[],
): PresaGrafica[] {
    return presas.map((p) => ({
        nombre: p.nombre_corto || p.nombre,
        actual: num(p.lectura?.almacenamiento_mm3),
        capacidad: p.capacidad_max_mm3,
        pct: porcentajeLlenadoPresa(p), // misma fórmula que el resto del sistema (antes: división propia)
    }));
}

/** Frescura de cada presa por separado: una presa al día ya no oculta a otra con lectura vieja. */
export function frescuraPorPresa(
    presas: { id?: string; nombre: string; lectura: { fecha?: string } | null }[],
    umbralHoras = 24,
): { nombre: string; frescura: Frescura | null }[] {
    return presas.map((p) => ({ nombre: p.nombre, frescura: calcularFrescura(p.lectura?.fecha, umbralHoras) }));
}

// ── Módulos ──────────────────────────────────────────────────────────────────
/** % del volumen autorizado ya entregado; `null` si no hay volumen autorizado (antes dividía entre `|| 1`). */
export function cumplimientoModulo(volumen: number | null | undefined, autorizado: number | null | undefined): number | null {
    const v = num(volumen);
    const a = num(autorizado);
    if (v == null || a == null || a <= 0) return null;
    return (v / a) * 100;
}

export function promedioSinNulos(valores: (number | null)[]): number | null {
    const v = valores.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ── Alertas: una sola fuente ─────────────────────────────────────────────────
export type SeveridadAlerta = 'critical' | 'warning' | 'info';

export interface AlertaSistema {
    id: string;
    type: SeveridadAlerta;
    title: string;
    message: string;
    timestamp: string;
    /** 'vivo' = calculada en el cliente con datos actuales; 'registro' = guardada en registro_alertas. */
    fuente?: 'vivo' | 'registro';
    categoria?: string;
    detectadaEn?: string | null;
    /** Persistida sin resolver con más de DIAS_ALERTA_VIGENTE días: pendiente antiguo, no cuenta como accionable de hoy. */
    antigua?: boolean;
    /** Qué hacer (solo en alertas que lo traen, p. ej. las agroclimáticas). */
    accion?: string | null;
}

export interface AlertaRegistroFila {
    id: string;
    tipo_riesgo: string;
    categoria: string | null;
    titulo: string;
    mensaje: string | null;
    origen_id: string | null;
    fecha_deteccion: string | null;
}

const SEVERIDADES: SeveridadAlerta[] = ['critical', 'warning', 'info'];

function textoHace(iso: string | null, ahoraMs: number): string {
    if (!iso) return 'Sin fecha';
    const min = Math.max(0, Math.round((ahoraMs - new Date(iso).getTime()) / 60000));
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
}

export function alertaDesdeRegistro(f: AlertaRegistroFila, ahoraMs: number, acciones: Record<string, string> = {}): AlertaSistema {
    const type: SeveridadAlerta = (SEVERIDADES as string[]).includes(f.tipo_riesgo) ? (f.tipo_riesgo as SeveridadAlerta) : 'info';
    const edadDias = f.fecha_deteccion ? (ahoraMs - new Date(f.fecha_deteccion).getTime()) / 86_400_000 : Infinity;
    const clave = (f.origen_id ?? '').split('-')[0]?.toLowerCase() === 'clima' ? (f.origen_id ?? '').split('-')[1]?.toLowerCase() ?? '' : '';
    return {
        id: `reg-${f.id}`,
        type,
        title: f.titulo,
        message: f.mensaje ?? '',
        timestamp: textoHace(f.fecha_deteccion, ahoraMs),
        fuente: 'registro',
        categoria: f.categoria ?? undefined,
        detectadaEn: f.fecha_deteccion,
        antigua: edadDias > DIAS_ALERTA_VIGENTE,
        accion: acciones[clave] ?? null,
    };
}

/** Une alertas calculadas en vivo con las persistidas (sin duplicar ids) y ordena por severidad y vigencia. */
export function fusionaAlertas(vivas: AlertaSistema[], persistidas: AlertaSistema[]): AlertaSistema[] {
    const ids = new Set(vivas.map((a) => a.id));
    const todas = [...vivas.map((a) => ({ ...a, fuente: a.fuente ?? ('vivo' as const) })), ...persistidas.filter((a) => !ids.has(a.id))];
    const peso: Record<SeveridadAlerta, number> = { critical: 0, warning: 1, info: 2 };
    return todas.sort((a, b) => (Number(!!a.antigua) - Number(!!b.antigua)) || (peso[a.type] - peso[b.type]));
}

export interface ResumenAlertas {
    criticas: number;
    avisos: number;
    informativas: number;
    /** críticas + avisos VIGENTES: la cifra que ve el KPI, la lista y el menú. */
    accionables: number;
    /** críticas/avisos persistidos con más de DIAS_ALERTA_VIGENTE días sin resolver. */
    antiguas: number;
}

export function resumenAlertas(alertas: AlertaSistema[]): ResumenAlertas {
    let criticas = 0, avisos = 0, informativas = 0, antiguas = 0;
    for (const a of alertas) {
        if (a.type === 'info') { informativas++; continue; }
        if (a.antigua) { antiguas++; continue; }
        if (a.type === 'critical') criticas++; else avisos++;
    }
    return { criticas, avisos, informativas, accionables: criticas + avisos, antiguas };
}
