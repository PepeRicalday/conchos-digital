/**
 * dashboardKpisEjecutivos — lógica PURA de los 8 KPIs de la primera pantalla del Dashboard.
 * Reglas: S/D (null) nunca 0; el estado siempre lleva texto (nunca solo color); los umbrales están nombrados aquí,
 * en un solo sitio, y son PROVISIONALES donde se indica (validar con operación).
 */
import { estadoEmbalse } from './presaNiveles';

export type TipoEstado = 'ok' | 'warn' | 'crit' | 'info' | 'sd';
export interface EstadoKpi { tipo: TipoEstado; texto: string; /** Versión breve para pantallas angostas. */ corto?: string }

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

// ── Presas: estado del embalse agregado ──────────────────────────────────────
/** Umbrales únicos de embalse (utils/presaNiveles.ts: crítico <20 %, bajo <40 %). */
export function estadoPresas(pct: number | null | undefined): EstadoKpi {
    const e = estadoEmbalse(pct);
    return { tipo: e.clave === 'crit' ? 'crit' : e.clave === 'warn' ? 'warn' : e.clave === 'ok' ? 'ok' : 'sd', texto: e.clave === 'sd' ? 'S/D' : e.clave === 'ok' ? 'Normal' : e.clave === 'warn' ? 'Bajo' : 'Crítico' };
}

// ── Días de suficiencia ──────────────────────────────────────────────────────
/** Provisionales: ≥60 d normal, 30–60 atención, <30 crítico. */
export const SUFICIENCIA_OK_DIAS = 60;
export const SUFICIENCIA_CRIT_DIAS = 30;
const M3S_A_MM3_DIA = 0.0864;

export interface Suficiencia { dias: number | null; estado: EstadoKpi; nota: string }

/**
 * Días que alcanza el volumen ALMACENADO (sin descontar volumen muerto) al ritmo de extracción vigente.
 * Extracción 0 (presas cerradas) no da "infinito" ni 0: es un estado propio. Sin dato de alguno → S/D.
 */
export function diasSuficiencia(almacenadoMm3: number | null | undefined, extraccionM3s: number | null | undefined): Suficiencia {
    if (!fin(almacenadoMm3)) return { dias: null, estado: { tipo: 'sd', texto: 'S/D' }, nota: 'Sin lectura de almacenamiento' };
    if (!fin(extraccionM3s)) return { dias: null, estado: { tipo: 'sd', texto: 'S/D' }, nota: 'Sin extracción medida' };
    if (extraccionM3s <= 0.0001) return { dias: null, estado: { tipo: 'info', texto: 'Presas cerradas', corto: 'Cerradas' }, nota: 'Sin extracción: no hay ritmo con qué estimar' };
    const dias = almacenadoMm3 / (extraccionM3s * M3S_A_MM3_DIA);
    const tipo: TipoEstado = dias >= SUFICIENCIA_OK_DIAS ? 'ok' : dias >= SUFICIENCIA_CRIT_DIAS ? 'warn' : 'crit';
    return { dias, estado: { tipo, texto: tipo === 'ok' ? 'Suficiente' : tipo === 'warn' ? 'Atención' : 'Crítico' }, nota: `Al ritmo vigente de ${extraccionM3s.toFixed(1)} m³/s` };
}

// ── Ciclo agrícola ───────────────────────────────────────────────────────────
export interface AvanceCiclo { pct: number | null; concluido: boolean; etiqueta: string | null }

export interface DiasCiclo { total: number; transcurridos: number; restantes: number; concluido: boolean; haceDias: number | null }
const DIA_MS = 86_400_000;
const msDe = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Días del ciclo [inicio, fin] (AAAA-MM-DD, ambos incluidos). null sin fechas válidas (S/D, nunca 0). */
export function diasCiclo(hoyISO: string, inicio: string | null | undefined, fin: string | null | undefined): DiasCiclo | null {
    if (!inicio || !fin) return null;
    const i = msDe(inicio), f = msDe(fin), h = msDe(hoyISO);
    if (![i, f, h].every(Number.isFinite) || f < i) return null;
    const total = Math.round((f - i) / DIA_MS) + 1;
    if (h > f) return { total, transcurridos: total, restantes: 0, concluido: true, haceDias: Math.round((h - f) / DIA_MS) };
    const transcurridos = h < i ? 0 : Math.round((h - i) / DIA_MS) + 1;
    return { total, transcurridos, restantes: total - transcurridos, concluido: false, haceDias: null };
}

/** Avance temporal del ciclo [inicio, fin] (AAAA-MM-DD). Hoy fuera del rango: 0 % (aún no inicia) o 100 % concluido. */
export function avanceCiclo(hoyISO: string, inicio: string | null | undefined, finCiclo: string | null | undefined, etiqueta: string | null = null): AvanceCiclo {
    if (!inicio || !finCiclo) return { pct: null, concluido: false, etiqueta };
    const a = Date.parse(`${inicio}T00:00:00Z`), b = Date.parse(`${finCiclo}T23:59:59Z`), h = Date.parse(`${hoyISO}T12:00:00Z`);
    if (![a, b, h].every(Number.isFinite) || b <= a) return { pct: null, concluido: false, etiqueta };
    if (h > b) return { pct: 100, concluido: true, etiqueta };
    if (h < a) return { pct: 0, concluido: false, etiqueta };
    return { pct: ((h - a) / (b - a)) * 100, concluido: false, etiqueta };
}

/** Tolerancia (puntos porcentuales) entre volumen entregado y avance del ciclo. Provisional. */
export const TOLERANCIA_CICLO_PP = 10;

export interface BrechaCiclo { brechaPP: number | null; estado: EstadoKpi }

export function brechaCiclo(entregadoPct: number | null | undefined, ciclo: AvanceCiclo): BrechaCiclo {
    if (!fin(entregadoPct)) return { brechaPP: null, estado: { tipo: 'sd', texto: 'S/D' } };
    if (ciclo.concluido) {
        return { brechaPP: null, estado: entregadoPct > 100 ? { tipo: 'crit', texto: 'Sobregiro' } : { tipo: 'info', texto: 'Ciclo concluido', corto: 'Concluido' } };
    }
    if (ciclo.pct == null) return { brechaPP: null, estado: { tipo: 'sd', texto: 'Sin fechas de ciclo' } };
    if (entregadoPct > 100) return { brechaPP: entregadoPct - ciclo.pct, estado: { tipo: 'crit', texto: 'Sobregiro' } };
    const b = entregadoPct - ciclo.pct;
    if (b > TOLERANCIA_CICLO_PP) return { brechaPP: b, estado: { tipo: 'warn', texto: 'Adelantado' } };
    if (b < -TOLERANCIA_CICLO_PP) return { brechaPP: b, estado: { tipo: 'warn', texto: 'Atrasado' } };
    return { brechaPP: b, estado: { tipo: 'ok', texto: 'En ritmo' } };
}

// ── Módulos: estado por avance contra el ciclo ───────────────────────────────
export interface EstadoModulo { letra: string; estado: EstadoKpi }
export function estadoModulo(pctModulo: number | null | undefined, ciclo: AvanceCiclo): EstadoModulo {
    const b = brechaCiclo(pctModulo, ciclo);
    const letra = b.estado.texto === 'Sobregiro' ? 'S' : b.estado.texto === 'Adelantado' ? 'A' : b.estado.texto === 'Atrasado' ? 'T' : b.estado.texto === 'En ritmo' ? 'R' : b.estado.texto === 'Ciclo concluido' ? 'C' : '—';
    return { letra, estado: b.estado };
}

// ── Demanda de riego ─────────────────────────────────────────────────────────
/** Provisionales (mm/día): <2 baja, 2–5 media, >5 alta. */
export interface DemandaRiego { netaMm: number | null; estado: EstadoKpi }
export function demandaRiego(etoMm: number | null | undefined, lluviaMm: number | null | undefined): DemandaRiego {
    if (!fin(etoMm)) return { netaMm: null, estado: { tipo: 'sd', texto: 'S/D' } };
    const neta = Math.max(0, etoMm - (fin(lluviaMm) ? lluviaMm : 0));
    // Sin dato de lluvia no se afirma "neta": la ETo bruta es cota superior.
    if (!fin(lluviaMm)) return { netaMm: neta, estado: { tipo: 'info', texto: 'Sin dato de lluvia' } };
    return { netaMm: neta, estado: neta < 2 ? { tipo: 'ok', texto: 'Baja' } : neta <= 5 ? { tipo: 'info', texto: 'Media' } : { tipo: 'warn', texto: 'Alta' } };
}

// ── Confianza del tablero ────────────────────────────────────────────────────
export interface FuenteConfianza { clave: string; nombre: string; /** true vigente, false caída/vieja, null no se sabe aún (no cuenta) */ ok: boolean | null }
export interface Confianza { pct: number | null; vigentes: number; total: number; caidas: string[]; estado: EstadoKpi; /** Todas las fuentes con su estado (vigente / caída / aún sin saber) para dibujarlas una por una. */ fuentes: FuenteConfianza[] }

export function confianzaTablero(fuentes: FuenteConfianza[]): Confianza {
    const conocidas = fuentes.filter((f) => f.ok !== null);
    if (conocidas.length === 0) return { pct: null, vigentes: 0, total: 0, caidas: [], estado: { tipo: 'sd', texto: 'Calculando' }, fuentes };
    const vigentes = conocidas.filter((f) => f.ok).length;
    const pct = (vigentes / conocidas.length) * 100;
    return {
        pct, vigentes, total: conocidas.length, caidas: conocidas.filter((f) => !f.ok).map((f) => f.nombre), fuentes,
        estado: pct >= 80 ? { tipo: 'ok', texto: 'Confiable' } : pct >= 50 ? { tipo: 'warn', texto: 'Parcial' } : { tipo: 'crit', texto: 'Degradada' },
    };
}

// ── Tendencia con texto ──────────────────────────────────────────────────────
export interface TendenciaTexto { dir: 'sube' | 'baja' | 'estable' | 'sd'; texto: string }
/** Compara el primer y el último valor con dato de una serie; epsilon = cambio mínimo para no llamarlo "estable". */
export function tendenciaTexto(serie: (number | null)[], unidad: string, epsilon: number, decimales = 1): TendenciaTexto {
    const v = serie.filter(fin);
    if (v.length < 2) return { dir: 'sd', texto: 'Sin tendencia' };
    const d = v[v.length - 1] - v[0];
    if (Math.abs(d) < epsilon) return { dir: 'estable', texto: `Estable en ${serie.length} d` };
    return { dir: d > 0 ? 'sube' : 'baja', texto: `${d > 0 ? 'Sube' : 'Baja'} ${Math.abs(d).toFixed(decimales)} ${unidad} en ${serie.length} d` };
}

// ── Telemetría GOES ──────────────────────────────────────────────────────────
/** Estado de la telemetría satelital según cuántas estaciones transmiten (en línea o con retraso). */
export function estadoGoes(enLinea: number | null | undefined, total: number | null | undefined): EstadoKpi {
    if (!fin(enLinea) || !fin(total) || total <= 0) return { tipo: 'sd', texto: 'S/D' };
    if (enLinea <= 0) return { tipo: 'crit', texto: 'Sin transmisión', corto: 'Sin señal' };
    if (enLinea < total) return { tipo: 'warn', texto: 'Parcial' };
    return { tipo: 'ok', texto: 'En línea' };
}

// ── NDVI ─────────────────────────────────────────────────────────────────────
/** Anomalía (NDVI − media del mismo mes en años previos) que separa "normal" de "fuera de lo normal". Provisional. */
export const NDVI_ANOMALIA_UMBRAL = 0.05;
export function estadoNdvi(anomalia: number | null | undefined): EstadoKpi {
    if (!fin(anomalia)) return { tipo: 'info', texto: 'Sin referencia' };
    if (anomalia < -NDVI_ANOMALIA_UMBRAL) return { tipo: 'warn', texto: 'Bajo lo normal', corto: 'Bajo normal' };
    if (anomalia > NDVI_ANOMALIA_UMBRAL) return { tipo: 'info', texto: 'Sobre lo normal', corto: 'Sobre normal' };
    return { tipo: 'ok', texto: 'Normal' };
}
