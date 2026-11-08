/**
 * informeCuencaConfig — filtros del informe infografía "Cuenca del Conchos". Lógica PURA (sin React): se prueba con vitest.
 *
 * Filtros: presas (cuáles), tamaño (clase por capacidad NAMO), datos (qué bloques), orden y periodo de la serie.
 * Reglas institucionales que esta capa protege:
 *  · el informe nunca queda vacío (validar) y avisa cuando se FILTRA ("N de M presas"): un total de 3 presas no es "la cuenca";
 *  · pedir un dato sin base (histórico sin climatología) se avisa, no se rellena con otra cosa.
 */
import { ORDEN_PRESAS_CUENCA } from './aqwpCuenca';
import type { OrdenCuenca } from './cuencaViz';

/** Bloques de datos que se pueden incluir. Los tanques (estado de cada presa) van siempre: son el corazón del informe. */
export type DatoInforme = 'tabla' | 'historico' | 'serie' | 'lluvia' | 'ficha';
export const DATOS_INFORME: { id: DatoInforme; etiqueta: string; ayuda: string }[] = [
  { id: 'tabla', etiqueta: 'Tabla de cifras', ayuda: 'Almacenamiento, % del NAMO, % útil, tendencia, aportación, extracción y vertido por presa' },
  { id: 'historico', etiqueta: 'Posición histórica', ayuda: '¿Es normal para la fecha? Percentil y rango del mismo día del año (2017 en adelante)' },
  { id: 'serie', etiqueta: 'Serie de llenado', ayuda: 'Una mini-gráfica por presa, con banda histórica' },
  { id: 'lluvia', etiqueta: 'Lluvia GOES', ayuda: 'Pluviómetros: 30 días, 7 d, 30 d y ciclo agrícola' },
  { id: 'ficha', etiqueta: 'Ficha por presa', ayuda: 'Río, municipio, distrito de riego, volumen útil y semáforo; en el PDF, una hoja por presa' },
];
export const ORDEN_DATOS_INFORME: DatoInforme[] = DATOS_INFORME.map((d) => d.id);

/** Clase de tamaño por capacidad (NAMO). El umbral de 100 Mm³ separa las 4 presas grandes de las 3 pequeñas de la cuenca. */
export type TamanoInforme = 'todas' | 'grandes' | 'pequenas';
export const UMBRAL_GRANDES_MM3 = 100;
export const TAMANOS_INFORME: { id: TamanoInforme; etiqueta: string; ayuda: string }[] = [
  { id: 'todas', etiqueta: 'Todas', ayuda: 'Las 7 presas de la cuenca' },
  { id: 'grandes', etiqueta: `Grandes (≥ ${UMBRAL_GRANDES_MM3} Mm³)`, ayuda: 'Boquilla, Madero, Luis L. León y San Gabriel' },
  { id: 'pequenas', etiqueta: `Pequeñas (< ${UMBRAL_GRANDES_MM3} Mm³)`, ayuda: 'Pico del Águila, Chihuahua y El Rejón' },
];

export const ORDENES_INFORME: { id: OrdenCuenca; etiqueta: string }[] = [
  { id: 'cuenca', etiqueta: 'Cuenca (distrito primero, aguas arriba → abajo)' },
  { id: 'llenado', etiqueta: '% de llenado (la menos llena primero)' },
  { id: 'volumen', etiqueta: 'Tamaño (mayor capacidad primero)' },
  { id: 'frescura', etiqueta: 'Frescura (la más atrasada primero)' },
];

export interface ConfigInformeCuenca {
  /** ids de ubicación (aqwp_ubicaciones) de las presas a incluir. */
  presas: number[];
  tamano: TamanoInforme;
  datos: DatoInforme[];
  orden: OrdenCuenca;
  /** Meses que abarcan las mini-series. */
  meses: 3 | 12;
}

export function configCuencaPorDefecto(): ConfigInformeCuenca {
  return { presas: [...ORDEN_PRESAS_CUENCA], tamano: 'todas', datos: [...ORDEN_DATOS_INFORME], orden: 'cuenca', meses: 12 };
}

/** ¿La presa pasa el filtro de tamaño? Sin NAMO no se puede clasificar: solo entra con "todas" (no se inventa su tamaño). */
export function pasaTamano(namoMm3: number | null, t: TamanoInforme): boolean {
  if (t === 'todas') return true;
  if (namoMm3 == null || !(namoMm3 > 0)) return false;
  return t === 'grandes' ? namoMm3 >= UMBRAL_GRANDES_MM3 : namoMm3 < UMBRAL_GRANDES_MM3;
}

/** Errores que BLOQUEAN la generación. */
export function validarConfigCuenca(c: ConfigInformeCuenca, namos: Record<number, number | null> = {}): string[] {
  const e: string[] = [];
  if (c.presas.length === 0) e.push('Elija al menos una presa.');
  else if (Object.keys(namos).length > 0 && !c.presas.some((id) => pasaTamano(namos[id] ?? null, c.tamano))) {
    e.push('Ninguna de las presas elegidas pertenece a la clase de tamaño seleccionada.');
  }
  if (c.datos.length === 0) e.push('Elija al menos un bloque de datos además de los tanques (o desactive los filtros).');
  return e;
}

/** Avisos que NO bloquean. */
export function avisosConfigCuenca(c: ConfigInformeCuenca, o: { totalPresas: number; hayClimatologia: boolean; incluidas: number }): string[] {
  const a: string[] = [];
  if (o.incluidas < o.totalPresas) {
    a.push(`El informe incluirá ${o.incluidas} de ${o.totalPresas} presas: los totales serán de esas presas, no de toda la cuenca.`);
  }
  if (c.datos.includes('historico') && !o.hayClimatologia) {
    a.push('No hay climatología cargada: la posición histórica quedará como S/D y la banda será el rango de los últimos 12 meses.');
  }
  if (c.datos.includes('serie') && c.meses === 3) {
    a.push('Con 3 meses la banda histórica se ve muy comprimida; para comparar contra la historia conviene 12 meses.');
  }
  return a;
}

/** Texto corto del alcance para folio, nombre de archivo y membrete: "7 de 7 presas" o "3 de 7 presas · grandes". */
export function etiquetaAlcance(c: ConfigInformeCuenca, incluidas: number, total: number): string {
  return `${incluidas} de ${total} presas${c.tamano === 'todas' ? '' : ` · ${c.tamano}`}`;
}
