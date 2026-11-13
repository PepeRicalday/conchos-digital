// Anotaciones de la Cuenca del Conchos: captura manual de vasos sin telemetría, revisión de cierres y lecturas sospechosas.
// Lógica pura (validación y lectura); la tabla es public.cuerpos_agua_anotaciones. Es una capa aparte: no cambia cierres ni balances.
import type { CuerpoAgua } from './cuerposAgua';

export type TipoAnotacion = 'captura' | 'revision' | 'sospechosa';

export const ETIQUETA_TIPO: Record<TipoAnotacion, string> = { captura: 'Captura manual', revision: 'Cierre revisado', sospechosa: 'Lectura sospechosa' };
export const GLIFO_TIPO: Record<TipoAnotacion, string> = { captura: '✎', revision: '✓', sospechosa: '▲' };

export interface Anotacion {
  id: number;
  cuerpoId: string;
  tipo: TipoAnotacion;
  /** captura y sospechosa: día de la lectura; revision: primer día del mes del cierre. */
  fecha: string;
  almMm3: number | null;
  elevMsnm: number | null;
  origen: string | null;
  comentario: string | null;
  anulada: boolean;
  autorId: string | null;
  autor: string | null;
  creadoEn: string;
}

/** Lo que el formulario tiene escrito (texto tal cual, sin convertir). */
export interface BorradorAnotacion {
  tipo: TipoAnotacion;
  cuerpoId: string;
  fecha: string;
  alm: string;
  elev: string;
  origen: string;
  comentario: string;
}

export interface AnotacionNueva {
  cuerpo_id: string; tipo: TipoAnotacion; fecha: string;
  almacenamiento_mm3: number | null; elevacion_msnm: number | null; origen: string | null; comentario: string | null;
}

export type ErroresAnotacion = Partial<Record<'cuerpoId' | 'fecha' | 'alm' | 'elev' | 'origen' | 'comentario', string>>;

/** Un campo vacío es «sin dato» (null), nunca 0. Devuelve NaN si hay texto que no es un número. */
export function numeroONull(txt: string): number | null {
  const t = txt.trim().replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Cuerpos sin telemetría diaria: los únicos donde la captura manual aporta un dato que no llega por otra vía. */
export const cuerposSinTelemetria = (cuerpos: CuerpoAgua[]): CuerpoAgua[] => cuerpos.filter((c) => c.aqwpUbicacionId == null);

/** Un almacenamiento por encima de este múltiplo del NAMO es casi seguro un error de captura (unidades o dedo). */
export const TOPE_SOBRE_NAMO = 1.5;

/**
 * Valida el borrador. Devuelve los errores por campo y, si no hay ninguno, la fila lista para insertar.
 * Reglas: la captura exige al menos una cifra y decir de dónde salió; revisión y sospechosa exigen comentario;
 * la fecha no puede ser futura; el almacenamiento no puede ser negativo ni pasar de 1.5 × NAMO.
 */
export function validarAnotacion(b: BorradorAnotacion, cuerpos: CuerpoAgua[], hoyISO: string): { errores: ErroresAnotacion; fila: AnotacionNueva | null } {
  const errores: ErroresAnotacion = {};
  const cuerpo = cuerpos.find((c) => c.id === b.cuerpoId);
  if (!cuerpo) errores.cuerpoId = 'Elija un cuerpo de agua.';
  const fecha = b.tipo === 'revision' && /^\d{4}-\d{2}$/.test(b.fecha) ? `${b.fecha}-01` : b.fecha;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) errores.fecha = b.tipo === 'revision' ? 'Elija el mes del cierre.' : 'Elija la fecha de la lectura.';
  else if (fecha > hoyISO) errores.fecha = 'La fecha no puede ser futura.';
  else if (fecha < '2021-01-01') errores.fecha = 'El registro de la cuenca empieza en 2021.';

  let alm: number | null = null, elev: number | null = null;
  if (b.tipo === 'captura') {
    alm = numeroONull(b.alm); elev = numeroONull(b.elev);
    if (Number.isNaN(alm)) errores.alm = 'Escriba un número (Mm³).';
    else if (alm != null && alm < 0) errores.alm = 'El almacenamiento no puede ser negativo.';
    else if (alm != null && cuerpo?.namoRefMm3 != null && alm > cuerpo.namoRefMm3 * TOPE_SOBRE_NAMO) errores.alm = `Pasa de ${TOPE_SOBRE_NAMO} veces el NAMO (${cuerpo.namoRefMm3} Mm³): revise las unidades.`;
    if (Number.isNaN(elev)) errores.elev = 'Escriba un número (msnm).';
    else if (elev != null && (elev < 500 || elev > 3000)) errores.elev = 'Elevación fuera del rango de la cuenca (500 a 3,000 msnm).';
    if (!errores.alm && !errores.elev && alm == null && elev == null) errores.alm = 'Capture el almacenamiento o la elevación: sin cifra no hay lectura.';
    if (b.origen.trim().length < 3) errores.origen = 'Diga de dónde salió la cifra (quién la reportó o qué documento).';
  } else if (b.comentario.trim().length < 3) {
    errores.comentario = b.tipo === 'revision' ? 'Escriba qué se revisó.' : 'Escriba por qué la lectura es sospechosa.';
  }

  if (Object.keys(errores).length) return { errores, fila: null };
  return {
    errores,
    fila: {
      cuerpo_id: b.cuerpoId, tipo: b.tipo, fecha,
      almacenamiento_mm3: b.tipo === 'captura' ? alm : null, elevacion_msnm: b.tipo === 'captura' ? elev : null,
      origen: b.tipo === 'captura' ? b.origen.trim() : null, comentario: b.comentario.trim() || null,
    },
  };
}

/** Captura manual vigente más reciente de un cuerpo (por fecha de lectura; a igual fecha, la última capturada). */
export function ultimaCaptura(filas: Anotacion[], cuerpoId: string): Anotacion | null {
  let mejor: Anotacion | null = null;
  for (const a of filas) {
    if (a.anulada || a.tipo !== 'captura' || a.cuerpoId !== cuerpoId) continue;
    if (!mejor || a.fecha > mejor.fecha || (a.fecha === mejor.fecha && a.creadoEn > mejor.creadoEn)) mejor = a;
  }
  return mejor;
}

/** Vigentes primero por fecha de lectura descendente; las anuladas al final. */
export function ordenarAnotaciones(filas: Anotacion[]): Anotacion[] {
  return [...filas].sort((a, b) => Number(a.anulada) - Number(b.anulada) || b.fecha.localeCompare(a.fecha) || b.creadoEn.localeCompare(a.creadoEn));
}

/** Quién puede anular: SRL cualquiera; ACU solo las propias. */
export function puedeAnular(a: Anotacion, rol: string | null | undefined, usuarioId: string | null | undefined): boolean {
  if (a.anulada) return false;
  return rol === 'SRL' || (rol === 'ACU' && !!usuarioId && a.autorId === usuarioId);
}
