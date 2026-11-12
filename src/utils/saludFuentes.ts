/**
 * saludFuentes — estado de las fuentes de datos de la cuenca a partir de v_cuenca_salud_fuentes. Funciones PURAS (el reloj entra como argumento).
 * Los umbrales son los de la red GOES: al día hasta 1.5 × lo esperado, con retraso hasta 3 ×, y más allá sin actualizar.
 * Una fuente sin ninguna lectura es «sin dato» (S/D); nunca se presenta como al día.
 */
import type { Lectura } from './cuencaAnalisis';

export interface FuenteSalud {
  clave: string;
  grupo: string;
  nombre: string;
  /** ISO del último dato; null si la fuente nunca ha entregado nada. */
  ultimoEn: string | null;
  esperadoMin: number;
}

export type EstadoFuente = 'al_dia' | 'retraso' | 'sin_actualizar' | 'sd';
export const FACTOR_RETRASO = 1.5;
export const FACTOR_CAIDA = 3;

export interface FuenteEvaluada extends FuenteSalud {
  estado: EstadoFuente;
  /** Minutos desde el último dato; null sin dato. */
  edadMin: number | null;
  /** edad / esperado: cuántas veces se pasó de lo normal (para ordenar lo peor primero). */
  razon: number | null;
}

export const ETIQUETA_ESTADO: Record<EstadoFuente, string> = { al_dia: 'Al día', retraso: 'Con retraso', sin_actualizar: 'Sin actualizar', sd: 'Sin dato' };
export const GLIFO_ESTADO_FUENTE: Record<EstadoFuente, string> = { al_dia: '●', retraso: '▲', sin_actualizar: '■', sd: '◇' };

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function normalizarFuente(r: Record<string, unknown>): FuenteSalud {
  const t = r.ultimo_en == null ? null : new Date(String(r.ultimo_en)).getTime();
  return {
    clave: String(r.clave), grupo: String(r.grupo ?? ''), nombre: String(r.nombre ?? r.clave),
    ultimoEn: t != null && Number.isFinite(t) ? new Date(t).toISOString() : null, esperadoMin: num(r.esperado_min) ?? 0,
  };
}

export function evaluarFuente(f: FuenteSalud, ahoraMs: number): FuenteEvaluada {
  const t = f.ultimoEn ? new Date(f.ultimoEn).getTime() : NaN;
  if (!Number.isFinite(t) || f.esperadoMin <= 0) return { ...f, estado: 'sd', edadMin: null, razon: null };
  const edadMin = Math.max(0, (ahoraMs - t) / 60000);
  const razon = edadMin / f.esperadoMin;
  return { ...f, estado: razon <= FACTOR_RETRASO ? 'al_dia' : razon <= FACTOR_CAIDA ? 'retraso' : 'sin_actualizar', edadMin, razon };
}

const PESO: Record<EstadoFuente, number> = { sin_actualizar: 3, sd: 2, retraso: 1, al_dia: 0 };

/** Evalúa todas y deja primero lo peor (sin actualizar, sin dato, retraso) y, dentro de cada estado, lo más pasado de su cadencia. */
export function evaluarFuentes(fs: FuenteSalud[], ahoraMs: number): FuenteEvaluada[] {
  return fs.map((f) => evaluarFuente(f, ahoraMs)).sort((a, b) => PESO[b.estado] - PESO[a.estado] || (b.razon ?? 0) - (a.razon ?? 0) || a.nombre.localeCompare(b.nombre, 'es'));
}

export interface ResumenSalud { total: number; alDia: number; retraso: number; sinActualizar: number; sd: number; tono: 'ok' | 'warn' | 'crit' | 'sd' }

export function resumenSalud(ev: FuenteEvaluada[]): ResumenSalud {
  const c = (e: EstadoFuente) => ev.filter((f) => f.estado === e).length;
  const r = { total: ev.length, alDia: c('al_dia'), retraso: c('retraso'), sinActualizar: c('sin_actualizar'), sd: c('sd') };
  return { ...r, tono: r.total === 0 ? 'sd' : r.sinActualizar > 0 ? 'crit' : r.retraso + r.sd > 0 ? 'warn' : 'ok' };
}

/** «hace 5 min», «hace 3 h», «hace 12 d». */
export function haceTexto(min: number | null): string {
  if (min == null) return 'S/D';
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${Math.round(min)} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d`;
}

/** Cadencia esperada en palabras: «cada 60 min», «cada 2 h», «a diario», «cada 14 d». */
export function cadenciaTexto(min: number): string {
  if (min <= 0) return 'S/D';
  if (min < 120) return `cada ${min} min`;
  if (min < 1440) return `cada ${Math.round(min / 60)} h`;
  if (min <= 1560) return 'a diario';
  return `cada ${Math.round(min / 1440)} d`;
}

/** Hallazgos en una frase: solo lo que no está al día; si todo lo está, una sola lectura que lo dice. */
export function lecturasSalud(ev: FuenteEvaluada[]): Lectura[] {
  if (!ev.length) return [{ tono: 'info', titulo: 'Sin información de las fuentes', texto: 'No se pudo leer el estado de las fuentes de datos (S/D).' }];
  const mal = ev.filter((f) => f.estado !== 'al_dia');
  if (!mal.length) return [{ tono: 'ok', titulo: `Las ${ev.length} fuentes están al día`, texto: 'Todas entregaron un dato dentro de su cadencia normal.' }];
  return mal.map((f): Lectura => ({
    tono: f.estado === 'sin_actualizar' ? 'crit' : f.estado === 'retraso' ? 'warn' : 'info',
    titulo: `${f.nombre}: ${ETIQUETA_ESTADO[f.estado].toLowerCase()}`,
    texto: f.estado === 'sd'
      ? 'Nunca ha entregado un dato (S/D). Revisar la sincronización.'
      : `Último dato ${haceTexto(f.edadMin)}; se espera ${cadenciaTexto(f.esperadoMin)}. Lo que dependa de esta fuente puede estar desactualizado.`,
  }));
}
