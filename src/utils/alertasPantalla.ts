/**
 * alertasPantalla — lógica pura de la pantalla Alertas (sin React ni Supabase).
 * Una sola definición de "vigente"/"antigua" (la misma del menú y el Dashboard: DIAS_ALERTA_VIGENTE) y un solo
 * criterio para contar alertas distintas (las agroclimáticas se cierran y reabren: 15 filas ≠ 15 alertas).
 */
import { DIAS_ALERTA_VIGENTE } from './dashboardKpis';

export type Severidad = 'critical' | 'warning' | 'info';
export type TabAlerta = 'criticas' | 'avisos' | 'info' | 'antiguas';

export interface AlertaFila {
    id: string;
    tipo_riesgo: string;
    categoria: string | null;
    titulo: string;
    mensaje: string | null;
    origen_id: string | null;
    fecha_deteccion: string | null;
    coordenadas?: { lat: number; lng: number } | null;
}

export const MAX_KM_CANAL = 104;

const norm = (t: string): Severidad => (t === 'critical' || t === 'warning' ? t : 'info');

/** Edad en días (Infinity si no hay fecha: una alerta sin fecha se trata como antigua). */
export function edadDias(f: Pick<AlertaFila, 'fecha_deteccion'>, ahoraMs: number): number {
    return f.fecha_deteccion ? (ahoraMs - new Date(f.fecha_deteccion).getTime()) / 86_400_000 : Infinity;
}

/** Antigua = crítica/aviso sin resolver con más de DIAS_ALERTA_VIGENTE días (criterio del menú lateral). */
export function esAntigua(f: AlertaFila, ahoraMs: number): boolean {
    return norm(f.tipo_riesgo) !== 'info' && edadDias(f, ahoraMs) > DIAS_ALERTA_VIGENTE;
}

export function tabDeAlerta(f: AlertaFila, ahoraMs: number): TabAlerta {
    const sev = norm(f.tipo_riesgo);
    if (sev === 'info') return 'info';
    if (esAntigua(f, ahoraMs)) return 'antiguas';
    return sev === 'critical' ? 'criticas' : 'avisos';
}

export function contarPorTab(filas: AlertaFila[], ahoraMs: number): Record<TabAlerta, number> {
    const c: Record<TabAlerta, number> = { criticas: 0, avisos: 0, info: 0, antiguas: 0 };
    for (const f of filas) c[tabDeAlerta(f, ahoraMs)]++;
    return c;
}

/** Orden del despacho: severidad (crítica primero) y, dentro de ella, la más vieja primero (la que más espera). */
export function ordenaDespacho<T extends AlertaFila>(filas: T[]): T[] {
    const peso: Record<Severidad, number> = { critical: 0, warning: 1, info: 2 };
    const t = (f: AlertaFila) => (f.fecha_deteccion ? new Date(f.fecha_deteccion).getTime() : 0);
    return [...filas].sort((a, b) => peso[norm(a.tipo_riesgo)] - peso[norm(b.tipo_riesgo)] || t(a) - t(b));
}

/** "K-23+820" / "K23+820" en título, mensaje u origen → 23.82. Fuera de 0–104.5 o ausente → null. */
export function kmDeAlerta(f: Pick<AlertaFila, 'titulo' | 'mensaje' | 'origen_id'>): number | null {
    const texto = `${f.titulo ?? ''} ${f.mensaje ?? ''} ${f.origen_id ?? ''}`;
    const m = texto.match(/\bK-?\s?(\d{1,3})\s?\+\s?(\d{3})/i);
    if (!m) return null;
    const km = Number(m[1]) + Number(m[2]) / 1000;
    return km >= 0 && km <= MAX_KM_CANAL + 0.5 ? km : null;
}

/** Dónde ocurre, legible: "Módulo 1", la parte tras " · " del título, o el punto PE-xxx. */
export function lugarDeAlerta(f: Pick<AlertaFila, 'titulo' | 'origen_id'>): string | null {
    const mod = f.titulo?.match(/M[oó]dulo\s*(\d{1,2})/i);
    if (mod) return `Módulo ${mod[1]}`;
    const partes = (f.titulo ?? '').split(' · ');
    if (partes.length > 1) return partes[partes.length - 1].trim() || null;
    if (f.origen_id && /^PE-/i.test(f.origen_id)) return f.origen_id;
    return null;
}

const CATEGORIAS: Record<string, string> = {
    agroclimatica: 'Agroclima',
    infraestructura: 'Infraestructura',
    nivel_critico: 'Nivel de presa',
    desviacion_batimetrica: 'Vaso (NDWI)',
    fuente_datos: 'Fuente de datos',
    caudal: 'Caudal',
    evaporacion: 'Evaporación',
};

export function etiquetaCategoria(c: string | null | undefined): string {
    if (!c) return 'Sistema';
    return CATEGORIAS[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ');
}

/** "hace 12 min" · "hace 3 h" · "hace 2 d". */
export function haceTexto(iso: string | null, ahoraMs: number): string {
    if (!iso) return 'sin fecha';
    const min = Math.max(0, Math.round((ahoraMs - new Date(iso).getTime()) / 60000));
    if (min < 1) return 'hace instantes';
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.floor(min / 60)} h`;
    return `hace ${Math.floor(min / 1440)} d`;
}

export interface ResumenPeriodo {
    /** Alertas distintas (por origen). */
    distintas: number;
    /** Filas detectadas: las reaperturas cuentan aparte. */
    aperturas: number;
    porCategoria: { clave: string; etiqueta: string; distintas: number; criticas: number }[];
}

/** Resumen del periodo contando alertas DISTINTAS: la misma estación/riesgo reabierta varias veces es una sola. */
export function resumenPeriodo(filas: AlertaFila[]): ResumenPeriodo {
    const vistas = new Map<string, AlertaFila & { critica: boolean }>();
    for (const f of filas) {
        const k = f.origen_id ?? f.id;
        const previa = vistas.get(k);
        const critica = norm(f.tipo_riesgo) === 'critical' || !!previa?.critica;
        vistas.set(k, { ...f, critica });
    }
    const cats = new Map<string, { distintas: number; criticas: number }>();
    for (const f of vistas.values()) {
        const k = f.categoria ?? 'sistema';
        const c = cats.get(k) ?? { distintas: 0, criticas: 0 };
        c.distintas++;
        if (f.critica) c.criticas++;
        cats.set(k, c);
    }
    return {
        distintas: vistas.size,
        aperturas: filas.length,
        porCategoria: [...cats.entries()]
            .map(([clave, v]) => ({ clave, etiqueta: etiquetaCategoria(clave), ...v }))
            .sort((a, b) => b.distintas - a.distintas),
    };
}
