/**
 * informeClimaCuencaDatos — construye los datos del informe de clima y pronóstico de la cuenca. Lógica PURA.
 * Usa EXACTAMENTE los mismos modelos que la pantalla (puntosObservados/puntosPronostico → construirPlano): las cifras nunca divergen.
 */
import type { ContornoCuenca } from './geoCuenca';
import type { DemGrid } from './camposCuenca';
import { consensoPorPunto, extremosPronosticoPeriodo, resumenConfiabilidad, valorPronosticoPeriodo, type Confiabilidad } from './cuencaPronostico';
import type { ConfigInformeClima } from './informeClimaCuencaConfig';
import { ORDEN_VARIABLES, etiquetaAlcanceClima } from './informeClimaCuencaConfig';
import { arealDe, type FrioEstacion, type ModeloRedJcas, type PuntoPropio, type PuntoRedJcas, type VentanaObs } from './jcasModelo';
import type { DatosCapas } from './capasCuenca';
import { MODULOS_SRL } from './geoDistrito';
import type { VariablePlano } from './paletasClima';
import { construirPlano, type PlanoModelo } from './planosCuenca';
import { puntosObservados, puntosPronostico, type PuntoCuenca } from './planosDatos';
import type { PronosticoCuenca } from '../hooks/useCuencaPronostico';

export interface PlanoInforme { variable: VariablePlano; tipo: 'obs' | 'pron'; dias: VentanaObs | 3; modelo: PlanoModelo }

export interface FilaEstacionObs { nombre: string; zona: string; lluviaHoy?: number | null; lluvia7: number | null; lluvia30: number | null; temp: number | null; hum: number | null; viento: number | null; estado: string; ultFecha: string | null; excluida: boolean; sinPluviometro: boolean; motivo: string | null; frio?: FrioFila }
export interface FilaEstacionPron { nombre: string; propia: boolean; lluvia: number | null; min: number | null; max: number | null; diasLluvia: number | null; temp: number | null; viento: number | null; tMax?: number | null; tMin?: number | null }
/** Extremos y horas frío de una estación observada (S/D = null). `frioDesde` ≠ inicio de temporada cuando la serie horaria empezó después. */
export interface FrioFila { tmax7: number | null; tmin7: number | null; horasFrio: number | null; horasHelada: number | null; frioDesde: string | null }

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
  /** Archivos de las capas de referencia ya cargados (el informe es síncrono; la ventana los pide antes). */
  capasDatos: DatosCapas;
  /** Apartado del distrito: plano de lluvia sobre los 6 módulos con las estaciones propias + JCAS cercanas, y la tabla de las propias. */
  distrito: DatosDistrito | null;
}

export interface DatosDistrito {
  ventana: VentanaObs;
  contorno: ContornoCuenca;
  plano: PlanoModelo;
  filas: { nombre: string; mm: number | null; ayer: number | null; mm7: number | null; mm30: number | null; mes: number | null }[];
  /** Etiqueta del mes en curso, p. ej. «1–9 nov». */
  etiquetaMes: string;
}

/** Contorno «de los 6 módulos» para reutilizar el motor de planos con un acercamiento al distrito (mismo bbox + margen). */
export function contornoDistrito(): ContornoCuenca {
  const poligonos = Object.values(MODULOS_SRL).map((r) => [r]) as unknown as ContornoCuenca['poligonos'];
  let minLon = 99, maxLon = -999, minLat = 99, maxLat = -999;
  for (const r of Object.values(MODULOS_SRL)) for (const [x, y] of r) { minLon = Math.min(minLon, x); maxLon = Math.max(maxLon, x); minLat = Math.min(minLat, y); maxLat = Math.max(maxLat, y); }
  const m = 0.03;
  return { poligonos, bbox: { minLon: minLon - m, maxLon: maxLon + m, minLat: minLat - m, maxLat: maxLat + m }, areaKm2: null, fuente: 'SRL Conchos (módulos)' };
}

/** Lluvia del distrito: las estaciones propias y las JCAS a ≤ 70 km del centro del distrito, sobre el contorno de los 6 módulos. */
export function construirDistrito(red: ModeloRedJcas | null, ventana: VentanaObs, hoy?: string): DatosDistrito | null {
  if (!red) return null;
  const contorno = contornoDistrito();
  const cx = (contorno.bbox.minLon + contorno.bbox.maxLon) / 2, cy = (contorno.bbox.minLat + contorno.bbox.maxLat) / 2;
  const km = (lon: number, lat: number) => Math.hypot((lon - cx) * 111.32 * Math.cos((cy * Math.PI) / 180), (lat - cy) * 111.2);
  const puntos = puntosObservados(red, 'lluvia', ventana).filter((p) => km(p.lon, p.lat) <= 70);
  const plano = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: ventana }, puntos, contorno, dem: null });
  const filas = red.propias.map((p: PuntoPropio) => ({ nombre: p.nombre, mm: p.mmHoy, ayer: p.mm1, mm7: p.mm7, mm30: p.mm30, mes: p.mmMes ?? null }));
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // Mismo «hoy» que usó el modelo para sumar el mes (fin + 1 día, huso conservador): así la etiqueta nunca contradice la cifra.
  void hoy;
  const dh = new Date(Date.parse(`${red.fin}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const etiquetaMes = `1–${Number(dh.slice(8, 10))} ${MESES[Number(dh.slice(5, 7)) - 1]}`;
  return { ventana, contorno, plano, filas, etiquetaMes };
}

const frioFila = (f?: FrioEstacion): FrioFila => ({ tmax7: f?.tmax7 ?? null, tmin7: f?.tmin7 ?? null, horasFrio: f?.horasFrio ?? null, horasHelada: f?.horasHelada ?? null, frioDesde: f?.desde ?? null });

const ESTADO: Record<string, string> = { vigente: 'Al día', atrasada: 'Atrasada', 'sin-datos': 'Sin datos' };

export function construirDatosClima(
  config: ConfigInformeClima,
  e: { red: ModeloRedJcas | null; contorno: ContornoCuenca; dem: DemGrid | null; pron: PronosticoCuenca | null; hoy: string; ultSyncJcas: string | null; capasDatos?: DatosCapas },
): DatosInformeClima {
  const planos: PlanoInforme[] = [];
  const variables = ORDEN_VARIABLES.filter((v) => config.variables.includes(v));
  for (const v of variables) {
    if (config.observado) {
      const puntos = e.red ? puntosObservados(e.red, v, config.diasObs) : [];
      planos.push({ variable: v, tipo: 'obs', dias: config.diasObs, modelo: construirPlano({ variable: v, periodo: { tipo: 'obs', dias: config.diasObs }, puntos, contorno: e.contorno, dem: e.dem, areal: v === 'lluvia' && e.red ? arealDe(e.red, config.diasObs) : null }) });
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
    nombre: p.nombre, zona: p.zona === 'salida' ? 'Salida' : 'Cuenca', lluviaHoy: p.sospechosa || p.sinPluviometro ? null : p.hoy?.mm ?? null, lluvia7: p.mm7, lluvia30: p.mm30, temp: p.medias.temp7, hum: p.medias.hum7, viento: p.medias.viento7,
    estado: p.sospechosa ? 'Excluida (sospechosa)' : p.sinPluviometro ? 'Sin pluviómetro' : ESTADO[p.estado] ?? 'S/D', ultFecha: p.ultFecha, excluida: p.sospechosa, sinPluviometro: p.sinPluviometro, motivo: p.motivo, frio: frioFila(p.frio),
  })).concat((e.red?.propias ?? []).map((p: PuntoPropio) => ({
    // Propias (WeatherLink): lluvia, temperatura, humedad y viento con la misma definición que JCAS; un sensor no confiable queda S/D.
    nombre: `${p.nombre} (propia)`, zona: 'Distrito', lluviaHoy: p.mmHoy, lluvia7: p.mm7, lluvia30: p.mm30, temp: p.medias.temp7, hum: p.medias.hum7, viento: p.medias.viento7,
    estado: p.ultFecha && e.red && Date.parse(`${e.red.fin}T00:00:00Z`) - Date.parse(`${p.ultFecha}T00:00:00Z`) <= 86_400_000 ? 'Al día' : p.ultFecha ? 'Atrasada' : 'S/D',
    ultFecha: p.ultFecha, excluida: false, sinPluviometro: false, motivo: null, frio: frioFila(p.frio),
  }))).sort((a, b) => (b.lluvia30 ?? -1) - (a.lluvia30 ?? -1) || a.nombre.localeCompare(b.nombre));

  const estacionesPron: FilaEstacionPron[] = (e.pron?.puntos ?? []).map((p: PuntoCuenca) => {
    const d = consensoPorPunto(e.pron!.filas, p.id, e.hoy);
    const l = valorPronosticoPeriodo(d, 'lluvia', e.hoy, config.diasPron);
    const dd = d.slice(0, config.diasPron);
    return {
      ...extremosPronosticoPeriodo(d, e.hoy, config.diasPron),
      nombre: p.nombre, propia: p.fuente === 'weatherlink', lluvia: l.valor, min: l.min, max: l.max,
      diasLluvia: dd.length < config.diasPron || dd.some((x) => x.probPct == null) ? null : dd.filter((x) => (x.probPct ?? 0) >= 50).length,
      temp: valorPronosticoPeriodo(d, 'temperatura', e.hoy, config.diasPron).valor, viento: valorPronosticoPeriodo(d, 'viento', e.hoy, config.diasPron).valor,
    };
  }).sort((a, b) => (b.lluvia ?? -1) - (a.lluvia ?? -1) || a.nombre.localeCompare(b.nombre));

  return {
    config, contorno: e.contorno, corte: config.observado && config.diasObs === 'hoy' && e.red?.fechaHoy ? e.red.fechaHoy : (e.red?.fin ?? e.hoy), hoy: e.hoy, alcance: etiquetaAlcanceClima(config), planos, lluviaObs, lluviaPron,
    vigentes: e.red?.vigentes ?? 0, totalEstaciones: e.red?.total ?? 0, confiabilidad: resumenConfiabilidad(e.pron?.verificacion ?? []), corridaEn: e.pron?.corridaEn ?? null,
    estacionesObs, estacionesPron, excluidas: estacionesObs.filter((x) => x.excluida).map((x) => x.nombre), ultSyncJcas: e.ultSyncJcas,
    capasDatos: e.capasDatos ?? {}, distrito: config.distrito && config.observado ? construirDistrito(e.red, config.diasObs, e.hoy) : null,
  };
}
