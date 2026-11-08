/**
 * informeClimaCuencaDatos — construye los datos del informe de clima y pronóstico de la cuenca. Lógica PURA.
 * Usa EXACTAMENTE los mismos modelos que la pantalla (puntosObservados/puntosPronostico → construirPlano): las cifras nunca divergen.
 */
import type { ContornoCuenca } from './geoCuenca';
import type { DemGrid } from './camposCuenca';
import { consensoPorPunto, resumenConfiabilidad, valorPronosticoPeriodo, type Confiabilidad } from './cuencaPronostico';
import type { ConfigInformeClima } from './informeClimaCuencaConfig';
import { ORDEN_VARIABLES, etiquetaAlcanceClima } from './informeClimaCuencaConfig';
import type { ModeloRedJcas, PuntoRedJcas, VentanaObs } from './jcasModelo';
import type { VariablePlano } from './paletasClima';
import { construirPlano, type PlanoModelo } from './planosCuenca';
import { puntosObservados, puntosPronostico, type PuntoCuenca } from './planosDatos';
import type { PronosticoCuenca } from '../hooks/useCuencaPronostico';

export interface PlanoInforme { variable: VariablePlano; tipo: 'obs' | 'pron'; dias: VentanaObs | 3; modelo: PlanoModelo }

export interface FilaEstacionObs { nombre: string; zona: string; lluvia7: number | null; lluvia30: number | null; temp: number | null; hum: number | null; viento: number | null; estado: string; ultFecha: string | null; excluida: boolean; sinPluviometro: boolean; motivo: string | null }
export interface FilaEstacionPron { nombre: string; propia: boolean; lluvia: number | null; min: number | null; max: number | null; diasLluvia: number | null; temp: number | null; viento: number | null }

export interface DatosInformeClima {
  config: ConfigInformeClima;
  contorno: ContornoCuenca;
  /** Último día completo observado. */
  corte: string;
  hoy: string;
  alcance: string;
  planos: PlanoInforme[];
  lluviaObs: { dias: VentanaObs; media: number | null; n: number; cobertura: number; motivoSD: string | null } | null;
  lluviaPron: { dias: VentanaObs | 3; media: number | null; n: number; cobertura: number; motivoSD: string | null; min: number | null; max: number | null } | null;
  vigentes: number; totalEstaciones: number;
  confiabilidad: Confiabilidad;
  corridaEn: string | null;
  estacionesObs: FilaEstacionObs[];
  estacionesPron: FilaEstacionPron[];
  excluidas: string[];
  ultSyncJcas: string | null;
}

const ESTADO: Record<string, string> = { vigente: 'Al día', atrasada: 'Atrasada', 'sin-datos': 'Sin datos' };

export function construirDatosClima(
  config: ConfigInformeClima,
  e: { red: ModeloRedJcas | null; contorno: ContornoCuenca; dem: DemGrid | null; pron: PronosticoCuenca | null; hoy: string; ultSyncJcas: string | null },
): DatosInformeClima {
  const planos: PlanoInforme[] = [];
  const variables = ORDEN_VARIABLES.filter((v) => config.variables.includes(v));
  for (const v of variables) {
    if (config.observado) {
      const puntos = e.red ? puntosObservados(e.red, v, config.diasObs) : [];
      planos.push({ variable: v, tipo: 'obs', dias: config.diasObs, modelo: construirPlano({ variable: v, periodo: { tipo: 'obs', dias: config.diasObs }, puntos, contorno: e.contorno, dem: e.dem }) });
    }
    if (config.pronostico) {
      const puntos = e.pron ? puntosPronostico(e.pron.puntos, e.pron.filas, v, config.diasPron, e.hoy) : [];
      planos.push({ variable: v, tipo: 'pron', dias: config.diasPron, modelo: construirPlano({ variable: v, periodo: { tipo: 'pron', dias: config.diasPron }, puntos, contorno: e.contorno, dem: e.dem }) });
    }
  }
  const resumen = (tipo: 'obs' | 'pron') => {
    const p = planos.find((x) => x.variable === 'lluvia' && x.tipo === tipo);
    return p ? { dias: p.dias as VentanaObs, media: p.modelo.resumen.media, n: p.modelo.resumen.n, cobertura: p.modelo.resumen.coberturaPct, motivoSD: p.modelo.motivoSD, min: p.modelo.resumen.min, max: p.modelo.resumen.max } : null;
  };
  const lluviaObs = resumen('obs'), lluviaPron = resumen('pron');

  const estacionesObs: FilaEstacionObs[] = (e.red?.puntos ?? []).map((p: PuntoRedJcas) => ({
    nombre: p.nombre, zona: p.zona === 'salida' ? 'Salida' : 'Cuenca', lluvia7: p.mm7, lluvia30: p.mm30, temp: p.medias.temp7, hum: p.medias.hum7, viento: p.medias.viento7,
    estado: p.sospechosa ? 'Excluida (sospechosa)' : p.sinPluviometro ? 'Sin pluviómetro' : ESTADO[p.estado] ?? 'S/D', ultFecha: p.ultFecha, excluida: p.sospechosa, sinPluviometro: p.sinPluviometro, motivo: p.motivo,
  })).sort((a, b) => (b.lluvia30 ?? -1) - (a.lluvia30 ?? -1) || a.nombre.localeCompare(b.nombre));

  const estacionesPron: FilaEstacionPron[] = (e.pron?.puntos ?? []).map((p: PuntoCuenca) => {
    const d = consensoPorPunto(e.pron!.filas, p.id, e.hoy);
    const l = valorPronosticoPeriodo(d, 'lluvia', e.hoy, config.diasPron);
    const dd = d.slice(0, config.diasPron);
    return {
      nombre: p.nombre, propia: p.fuente === 'weatherlink', lluvia: l.valor, min: l.min, max: l.max,
      diasLluvia: dd.length < config.diasPron || dd.some((x) => x.probPct == null) ? null : dd.filter((x) => (x.probPct ?? 0) >= 50).length,
      temp: valorPronosticoPeriodo(d, 'temperatura', e.hoy, config.diasPron).valor, viento: valorPronosticoPeriodo(d, 'viento', e.hoy, config.diasPron).valor,
    };
  }).sort((a, b) => (b.lluvia ?? -1) - (a.lluvia ?? -1) || a.nombre.localeCompare(b.nombre));

  return {
    config, contorno: e.contorno, corte: config.observado && config.diasObs === 'hoy' && e.red?.fechaHoy ? e.red.fechaHoy : (e.red?.fin ?? e.hoy), hoy: e.hoy, alcance: etiquetaAlcanceClima(config), planos, lluviaObs, lluviaPron,
    vigentes: e.red?.vigentes ?? 0, totalEstaciones: e.red?.total ?? 0, confiabilidad: resumenConfiabilidad(e.pron?.verificacion ?? []), corridaEn: e.pron?.corridaEn ?? null,
    estacionesObs, estacionesPron, excluidas: estacionesObs.filter((x) => x.excluida).map((x) => x.nombre), ultSyncJcas: e.ultSyncJcas,
  };
}
