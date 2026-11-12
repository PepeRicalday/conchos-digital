import { useEffect, useMemo, useState } from 'react';
import { cargarBaseHidro, useHidroEstadistica } from './useHidroEstaciones';
import { estadisticaEstacion, type EstadisticaEstacion } from '../utils/hidroEstadistica';
import { ID_OJINAGA_IBWC, ID_OJINAGA_SUTRON, estadoEnlace, type EstacionHidro, type EstadoEnlace, type VentanaHidro } from '../utils/hidroEstaciones';

/** Lugar de cada estación hidrométrica en la red de la cuenca: qué tramo mide y junto a qué vaso se dibuja. */
export interface SitioRed {
  corto: string;
  tramo: string;
  /** entrada = mide lo que llega a un vaso · rio = cauce entre dos vasos · salida = aforo de salida de la cuenca. */
  rol: 'entrada' | 'rio' | 'salida';
  /** presa_id del vaso junto al que se dibuja (entrada: arriba de él; rio: abajo de él). null = en la salida de la cuenca. */
  presaId: string | null;
  /** Cuerpo de agua al que llega el agua que mide. */
  haciaTxt: string;
  reserva: string | null;
}

export const SITIOS_RED: Record<string, SitioRed> = {
  C63009B2: { corto: 'Boca del Río', tramo: 'Río Conchos, antes de La Boquilla', rol: 'entrada', presaId: 'PRE-001', haciaTxt: 'La Boquilla', reserva: null },
  C6301AC4: { corto: 'Vírgenes', tramo: 'Río San Pedro, antes de F. I. Madero', rol: 'entrada', presaId: 'PRE-002', haciaTxt: 'F. I. Madero', reserva: null },
  C6301416: { corto: 'Babisas', tramo: 'Río San Pedro, entre F. I. Madero y Luis L. León', rol: 'rio', presaId: 'PRE-002', haciaTxt: 'Luis L. León', reserva: 'El sensor no reporta gastos menores a 15 m³/s: bajo ese umbral el gasto es un rango, no una cifra.' },
  [ID_OJINAGA_IBWC]: { corto: 'Ojinaga (USIBWC)', tramo: 'Río Conchos, salida de la cuenca', rol: 'salida', presaId: null, haciaTxt: 'Río Bravo', reserva: null },
  [ID_OJINAGA_SUTRON]: { corto: 'Ojinaga (Sutron)', tramo: 'Río Conchos, salida de la cuenca · mismo sitio', rol: 'salida', presaId: null, haciaTxt: 'Río Bravo', reserva: 'Su gasto no coincide con el aforo oficial USIBWC del mismo sitio: no se usa para la salida de la cuenca.' },
};
/** Orden de aguas arriba a aguas abajo. */
export const ORDEN_RED = ['C63009B2', 'C6301AC4', 'C6301416', ID_OJINAGA_IBWC, ID_OJINAGA_SUTRON];

export interface EstacionRed { est: EstacionHidro; sitio: SitioRed; stat: EstadisticaEstacion | null; enlace: EstadoEnlace }

/**
 * Estaciones hidrométricas (GOES y USIBWC) colocadas en la red de la cuenca, con su estadística en la ventana elegida.
 * Reutiliza la caché y la estadística de la página de estaciones GOES: aquí no se recalcula nada distinto.
 */
export function useHidrometriaCuenca(ventana: VentanaHidro, activo = true) {
  const [base, setBase] = useState<{ estaciones: EstacionHidro[]; en: number } | null>(null);
  const [errorBase, setErrorBase] = useState<string | null>(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    cargarBaseHidro().then((b) => { if (vivo) setBase({ estaciones: b.estaciones, en: Date.now() }); }).catch((e: Error) => { if (vivo) setErrorBase(e.message); });
    return () => { vivo = false; };
  }, [activo]);
  const ids = useMemo(() => (activo && base ? ORDEN_RED.filter((id) => base.estaciones.some((e) => e.id === id)) : []), [activo, base]);
  const { series, cargando, error } = useHidroEstadistica(ventana, ids);

  const estaciones = useMemo<EstacionRed[]>(() => {
    if (!base) return [];
    const ahora = base.en;
    return ids.flatMap((id) => {
      const est = base.estaciones.find((e) => e.id === id);
      if (!est) return [];
      const ult = est.ult_dato_en ? Date.parse(est.ult_dato_en) : null;
      return [{ est, sitio: SITIOS_RED[id], stat: series?.[id] ? estadisticaEstacion(id, est.intervalo_min, series[id], ventana, ahora) : null, enlace: estadoEnlace(ult, ahora, id) }];
    });
  }, [base, ids, series, ventana]);

  return { estaciones, cargando: activo && (!base || cargando) && !errorBase, error: errorBase ?? error };
}

/** Gasto medio de la ventana como texto: cifra, o rango cuando hay lecturas censuradas (Babisas). Sin lecturas: S/D. */
export function textoGasto(s: EstadisticaEstacion | null, dec = 1): string {
  const f = (v: number) => v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (!s) return 'S/D';
  if (s.censurado && s.censurado.n > 0) return `${f(s.censurado.mediaInf)}–${f(s.censurado.mediaSup)}`;
  return s.gasto ? f(s.gasto.media) : 'S/D';
}

/** Gasto medio como número para comparar (punto medio del rango si está censurado). null = S/D. */
export function gastoMedio(s: EstadisticaEstacion | null): number | null {
  if (!s) return null;
  if (s.censurado && s.censurado.n > 0) return (s.censurado.mediaInf + s.censurado.mediaSup) / 2;
  return s.gasto?.media ?? null;
}
