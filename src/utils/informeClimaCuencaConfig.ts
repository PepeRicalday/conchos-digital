/**
 * informeClimaCuencaConfig — filtros del informe "Clima y pronóstico de la cuenca del Conchos". Lógica PURA (sin React): se prueba con vitest.
 *
 * Qué se puede elegir: variables (lluvia, temperatura, viento, humedad), observado y/o pronóstico, periodo de cada uno y si va la tabla de
 * estaciones. Reglas que esta capa protege: el informe nunca queda vacío; se avisa cuando algo no tiene base (pronóstico sin corrida,
 * confiabilidad todavía en construcción) en lugar de rellenarlo.
 */
import type { VariablePlano } from './paletasClima';

export const VARIABLES_INFORME: { id: VariablePlano; etiqueta: string; ayuda: string }[] = [
  { id: 'lluvia', etiqueta: 'Lluvia (isoyetas)', ayuda: 'Líneas de igual lluvia en mm, con niveles fijos' },
  { id: 'temperatura', etiqueta: 'Temperatura', ayuda: 'Temperatura media, con corrección por altitud cuando es estadísticamente sólida' },
  { id: 'viento', etiqueta: 'Viento', ayuda: 'Velocidad media en km/h (JCAS no entrega dirección)' },
  { id: 'humedad', etiqueta: 'Humedad', ayuda: 'Humedad relativa media en %' },
];
export const ORDEN_VARIABLES: VariablePlano[] = VARIABLES_INFORME.map((v) => v.id);

export interface ConfigInformeClima {
  variables: VariablePlano[];
  observado: boolean;
  pronostico: boolean;
  diasObs: 7 | 30;
  diasPron: 3 | 7;
  /** Tabla de estaciones (observado y pronóstico). */
  estaciones: boolean;
}

export function configClimaPorDefecto(): ConfigInformeClima {
  return { variables: [...ORDEN_VARIABLES], observado: true, pronostico: true, diasObs: 30, diasPron: 7, estaciones: true };
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
  return c.variables.length * ((c.observado ? 1 : 0) + (c.pronostico ? 1 : 0));
}

/** Texto corto del alcance para folio, nombre de archivo y membrete: "4 variables · obs 30 d + pron 7 d". */
export function etiquetaAlcanceClima(c: ConfigInformeClima): string {
  const partes = [c.observado ? `obs ${c.diasObs} d` : null, c.pronostico ? `pron ${c.diasPron} d` : null].filter(Boolean).join(' + ');
  return `${c.variables.length} ${c.variables.length === 1 ? 'variable' : 'variables'} · ${partes || 'sin datos'}`;
}
