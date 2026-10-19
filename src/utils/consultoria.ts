/**
 * consultoria — lógica pura de la interfaz de Consultoría IA (sin React ni red), para poder probarla.
 * Regla del proyecto: dato ausente = "S/D", nunca 0 ni vacío.
 */
import type { Tarjeta } from '../hooks/useHydricChat';

export type ContextoChat = 'general' | 'operacion' | 'balance' | 'hidraulica';
export interface Sugerencia { texto: string; contexto: ContextoChat }

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * Sugerencias según el protocolo oficial vigente. Solo se ofrecen consultas que el asistente puede responder con
 * datos reales (antes había "indicadores CONAGUA" y "proyecciones", para las que no tiene base).
 */
export function sugerencias(eventoTipo: string | null | undefined): Sugerencia[] {
    const t = eventoTipo ? sinTildes(eventoTipo) : '';
    const comunes: Sugerencia[] = [
        { texto: '¿Cuál es el estado actual de almacenamiento de las presas?', contexto: 'operacion' },
        { texto: '¿Qué escalas del canal tienen una medición vigente y cuáles no?', contexto: 'operacion' },
    ];
    if (t.startsWith('VACIADO')) {
        return [
            { texto: '¿Cómo va el vaciado del canal? Resume niveles por zona y qué vigilar.', contexto: 'operacion' },
            ...comunes,
            { texto: '¿Cuánto volumen se entregó por módulo en el ciclo que cerró?', contexto: 'balance' },
        ];
    }
    if (t.startsWith('LLENADO')) {
        return [
            { texto: '¿Cuánto tarda la onda de llenado en llegar al Km 104?', contexto: 'hidraulica' },
            { texto: 'Haz el balance de continuidad K0→K104 ahora mismo', contexto: 'hidraulica' },
            ...comunes,
        ];
    }
    return [
        { texto: 'Haz el balance de continuidad K0→K104 ahora mismo', contexto: 'hidraulica' },
        { texto: 'Analiza la eficiencia de distribución por módulo', contexto: 'balance' },
        ...comunes,
    ];
}

// ─── Historial ──────────────────────────────────────────────────────────────────────────────────────────────────
export type GrupoFecha = 'Hoy' | 'Ayer' | 'Esta semana' | 'Anteriores';
const ORDEN_GRUPOS: GrupoFecha[] = ['Hoy', 'Ayer', 'Esta semana', 'Anteriores'];

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** `fechaDia` y `hoy` son YYYY-MM-DD en hora de Chihuahua. */
export function grupoDeFecha(fechaDia: string, hoy: string): GrupoFecha {
    const d = diasEntre(hoy, fechaDia);
    if (d <= 0) return 'Hoy';
    if (d === 1) return 'Ayer';
    if (d <= 6) return 'Esta semana';
    return 'Anteriores';
}

export interface ConversacionMin { id: string; titulo: string; updated_at: string }

/** Filtra por texto (sin importar tildes ni mayúsculas) y agrupa por antigüedad; conserva el orden recibido. */
export function agrupaConversaciones<T extends ConversacionMin>(
    items: T[], hoy: string, aDia: (iso: string) => string, filtro = '',
): Array<{ grupo: GrupoFecha; items: T[] }> {
    const q = sinTildes(filtro.trim());
    const buckets = new Map<GrupoFecha, T[]>();
    for (const c of items) {
        if (q && !sinTildes(c.titulo ?? '').includes(q)) continue;
        const g = grupoDeFecha(aDia(c.updated_at), hoy);
        buckets.set(g, [...(buckets.get(g) ?? []), c]);
    }
    return ORDEN_GRUPOS.filter((g) => buckets.has(g)).map((g) => ({ grupo: g, items: buckets.get(g)! }));
}

// ─── Tarjetas / tablas ──────────────────────────────────────────────────────────────────────────────────────────
/** Celda de tabla: null → S/D (nunca 0 ni vacío); números con hasta 3 decimales. */
export function celda(v: string | number | null | undefined): string {
    if (v == null || v === '') return 'S/D';
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return 'S/D';
        return v.toLocaleString('es-MX', { maximumFractionDigits: 3 });
    }
    return v;
}

/** Tabla en TSV (pega bien en Excel/Sheets); respeta S/D. */
export function tablaATsv(t: Pick<Tarjeta, 'columnas' | 'filas'>): string {
    const lim = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
    return [t.columnas, ...t.filas.map((f) => f.map(celda))].map((fila) => fila.map((c) => lim(String(c))).join('\t')).join('\n');
}

/** Antigüedad legible: "hace 5 min", "hace 3 h", "hace 2 días"; null → S/D. */
export function edadTexto(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return 'S/D';
    if (ms < 60_000) return 'hace un momento';
    const min = Math.round(ms / 60_000);
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
}

/** Enlaces del markdown: solo http(s) y mailto; cualquier otro esquema (javascript:, data:) se descarta. */
export function hrefSeguro(href: string | undefined): string | null {
    if (!href) return null;
    try {
        const u = new URL(href, 'https://x.invalid');
        return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? href : null;
    } catch { return null; }
}
