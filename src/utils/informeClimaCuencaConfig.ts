/**
 * informeClimaCuencaConfig — filtros del informe "Clima y pronóstico de la cuenca del Conchos". Lógica PURA (sin React): se prueba con vitest.
 *
 * Qué se puede elegir: variables (lluvia, temperatura, viento, humedad), observado y/o pronóstico, periodo de cada uno y si va la tabla de
 * estaciones. Reglas que esta capa protege: el informe nunca queda vacío; se avisa cuando algo no tiene base (pronóstico sin corrida,
 * confiabilidad todavía en construcción) en lugar de rellenarlo.
 */
import type { VariablePlano } from './paletasClima';
import { etiquetaVentana, type VentanaObs } from './jcasModelo';
import { CAPAS_INFORME, type CapaId } from './capasCuenca';

export const VARIABLES_INFORME: { id: VariablePlano; etiqueta: string; ayuda: string }[] = [
  { id: 'lluvia', etiqueta: 'Lluvia (isoyetas)', ayuda: 'Líneas de igual lluvia en mm, con niveles fijos' },
  { id: 'temperatura', etiqueta: 'Temperatura', ayuda: 'Temperatura media, con corrección por altitud cuando es estadísticamente sólida' },
  { id: 'viento', etiqueta: 'Viento', ayuda: 'Velocidad media en km/h (JCAS no entrega dirección)' },
  { id: 'humedad', etiqueta: 'Humedad', ayuda: 'Humedad relativa media en %' },
  { id: 'tmin', etiqueta: 'Temperatura mínima', ayuda: 'Mínima del periodo (hoy, ayer, 7 o 30 días); 0 °C o menos es helada. S/D donde no hay serie horaria' },
  { id: 'horasFrio', etiqueta: 'Horas frío (≤ 7.2 °C)', ayuda: 'Acumuladas desde el 1-nov; solo observado (no se pronostican). S/D donde no hay serie horaria' },
];
export const ORDEN_VARIABLES: VariablePlano[] = VARIABLES_INFORME.map((v) => v.id);
/** Variables que NO se pronostican: en el informe solo llevan plano observado. */
export const SOLO_OBSERVADAS: VariablePlano[] = ['horasFrio'];
/** Variables activas por defecto: las cuatro clásicas; la mínima y las horas frío se activan a voluntad (el informe por defecto no cambia de tamaño). */
export const VARIABLES_POR_DEFECTO: VariablePlano[] = ['lluvia', 'temperatura', 'viento', 'humedad'];

export interface ConfigInformeClima {
  variables: VariablePlano[];
  observado: boolean;
  pronostico: boolean;
  diasObs: VentanaObs;
  diasPron: 3 | 7;
  /** Tabla de estaciones (observado y pronóstico). */
  estaciones: boolean;
  /** Capas de referencia de los planos (municipios, ríos, presas…). */
  capas: CapaId[];
  /** Apartado del distrito (módulos SRL con las estaciones propias) en el PDF carta. */
  distrito: boolean;
  /**
   * 'completo': informe con tablas, «Cómo se lee», trazabilidad y firmas. 'infografia': solo lo gráfico (planos, KPIs y barras por estación) con el
   * mínimo institucional (logos, corte, fuente, «provisional», atribución del contorno y folio); sin notas metodológicas, trazabilidad ni firmas.
   */
  contenido: 'completo' | 'infografia';
}

export function configClimaPorDefecto(): ConfigInformeClima {
  return { variables: [...VARIABLES_POR_DEFECTO], observado: true, pronostico: true, diasObs: 30, diasPron: 7, estaciones: true, capas: [...CAPAS_INFORME], distrito: true, contenido: 'completo' };
}

/** Errores que BLOQUEAN la generación. */
export function validarConfigClima(c: ConfigInformeClima): string[] {
  const e: string[] = [];
  if (c.variables.length === 0) e.push('Elija al menos una variable.');
  if (!c.observado && !c.pronostico) e.push('Elija lo observado, el pronóstico o ambos.');
  return e;
}

/** Avisos que NO bloquean. */
export function avisosConfigClima(c: ConfigInformeClima, o: { hayPronostico: boolean; hayObservado: boolean; confiabilidadEnConstruccion: boolean }): string[] {
  const a: string[] = [];
  if (c.pronostico && !o.hayPronostico) a.push('No hay pronóstico de la cuenca cargado: esos planos quedarán como S/D.');
  if (c.observado && !o.hayObservado) a.push('No hay estaciones JCAS con dato reciente: los planos observados quedarán como S/D.');
  if (c.pronostico && o.hayPronostico && o.confiabilidadEnConstruccion) {
    a.push('La confiabilidad del pronóstico todavía está en construcción: el informe lo dirá y no afirmará un acierto.');
  }
  return a;
}

/** Cuántos planos generará la configuración (una pareja observado/pronóstico por variable). */
export function cuentaPlanos(c: ConfigInformeClima): number {
  return c.variables.reduce((n, v) => n + (c.observado ? 1 : 0) + (c.pronostico && !SOLO_OBSERVADAS.includes(v) ? 1 : 0), 0);
}

/** Texto corto del alcance para folio, nombre de archivo y membrete: "4 variables · obs 30 d + pron 7 d". */
export function etiquetaAlcanceClima(c: ConfigInformeClima): string {
  const partes = [c.observado ? `obs ${etiquetaVentana(c.diasObs)}` : null, c.pronostico ? `pron ${c.diasPron} d` : null].filter(Boolean).join(' + ');
  return `${c.variables.length} ${c.variables.length === 1 ? 'variable' : 'variables'} · ${partes || 'sin datos'}${c.contenido === 'infografia' ? ' · infografía' : ''}`;
}
