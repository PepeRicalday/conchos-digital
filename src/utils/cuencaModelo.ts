/**
 * cuencaModelo — une, por presa, todo lo que la interfaz y los informes necesitan: estado actual, volumen útil, posición
 * histórica, tendencia, semáforo, serie de 12 meses y su banda. Lógica PURA: la vista y el informe consumen EL MISMO modelo,
 * así sus cifras nunca divergen.
 */
import { claveEstancada, filasPresas, type EstadoUbicacion, type FilaGrafica, type FilaPresaCuenca } from './aqwpCuenca';
import { atrasoDias, estadoFrescura, type Descarte } from './aqwpCalidad';
import {
  participacionNamo, posicionHistorica, semaforoCuenca, theilSen, volumenUtil,
  type FilaClimatologia, type PosicionHistorica, type Semaforo, type Tendencia, type VolumenUtil,
} from './aqwpEstadistica';
import { metaPresaPorUbicacion, type MetaPresa } from './presasCuencaMeta';
import { bandaEnPct, cambioPuntos, rangoPropio, serieSemanal, type PuntoBanda, type PuntoSemanal } from './cuencaViz';
import type { Climatologia } from '../hooks/useAqwpCuenca';

export interface EntradaModeloCuenca {
  estados: EstadoUbicacion[];
  serie: FilaGrafica[];
  descartes: Record<number, Descarte[]>;
  climatologia: Climatologia | null;
}

export interface PresaCuencaModelo {
  fila: FilaPresaCuenca;
  meta: MetaPresa | null;
  util: VolumenUtil | null;
  /** null = sin climatología (la vista rotula "rango de los últimos 12 meses"). */
  posicion: PosicionHistorica | null;
  /** Pendiente Theil-Sen a 30 d. null con pocos puntos o con la lectura sin actualizar (una pendiente 0 ahí no significa "estable"). */
  tendencia: Tendencia | null;
  semaforo: Semaforo;
  /** % del NAMO de la cuenca (suma de las presas con NAMO). */
  participacionNamo: number | null;
  /** 12 meses, semanal, % del NAMO. */
  serie: PuntoSemanal[];
  /** Banda histórica en % del NAMO actual; null si no hay climatología. */
  banda: PuntoBanda[] | null;
  rangoPropio: { min: number; max: number } | null;
  /** Cambio en puntos porcentuales a ~30 días. */
  cambio30Puntos: number | null;
  atrasoDias: number | null;
  frescura: 'al_dia' | 'atrasada' | 'sd';
  descartes: Descarte[];
}

/** Extracción activa (hay riego): umbral 0.05 m³/s, el mismo que usa la detección de "sin actualizar". */
const EXTRACCION_ACTIVA_M3S = 0.05;

export function construirModeloCuenca(entrada: EntradaModeloCuenca, hoyISO: string): PresaCuencaModelo[] {
  const filas = filasPresas(entrada.estados);
  const part = participacionNamo(Object.fromEntries(filas.map((f) => [f.ubicacionId, f.namoMm3])));
  const diaHoy = entrada.climatologia?.diaHoy ?? null;

  return filas.map((fila) => {
    const id = fila.ubicacionId;
    const clave = String(id), claveE = claveEstancada(id);

    // Serie diaria de la presa: la columna normal o, en tramos sin actualizar, la punteada (el dato se conserva).
    const diaria = entrada.serie.map((r) => {
      const normal = r[clave], dudoso = r[claveE];
      const pct = typeof normal === 'number' ? normal : typeof dudoso === 'number' ? dudoso : null;
      return { fecha: r.fecha, pct, dudoso: typeof normal !== 'number' && typeof dudoso === 'number' };
    });
    const semanal = serieSemanal(diaria.map((d) => ({ fecha: d.fecha, valor: d.pct, dudoso: d.dudoso })), 12);

    // Tendencia en Mm³/día (el NAMO actual convierte el % de vuelta a volumen; solo se usa la pendiente).
    const mm3 = fila.namoMm3 != null && fila.namoMm3 > 0
      ? diaria.map((d) => ({ fecha: d.fecha, valor: d.pct == null ? null : (d.pct / 100) * (fila.namoMm3 as number) }))
      : [];
    const tendencia = fila.sinActualizar ? null : theilSen(mm3, 30);

    const util = volumenUtil(fila.almacenamientoValido, fila.muertoMm3, fila.namoMm3);
    const hoyClim = entrada.climatologia?.hoy.find((h) => h.ubicacionId === id) ?? null;
    const filaClim: FilaClimatologia | null = diaHoy != null
      ? entrada.climatologia?.banda.find((b) => b.ubicacionId === id && b.diaAnio === diaHoy) ?? null : null;
    const posicion = posicionHistorica(fila.almacenamientoValido, hoyClim, filaClim);

    const atraso = atrasoDias(fila.fecha, hoyISO, fila.delDistrito);
    const bandaClim = entrada.climatologia?.banda.filter((b) => b.ubicacionId === id);

    return {
      fila, meta: metaPresaPorUbicacion(id), util, posicion, tendencia,
      semaforo: semaforoCuenca({
        pctUtil: util?.pctUtil ?? null,
        percentil: posicion?.percentil ?? null,
        nAnios: posicion?.nAnios ?? 0,
        tendenciaMm3Dia: tendencia?.pendienteMm3Dia ?? null,
        extraccionActiva: (fila.extraccionTotalM3s ?? 0) >= EXTRACCION_ACTIVA_M3S,
        sinActualizar: fila.sinActualizar,
      }),
      participacionNamo: part[id] ?? null,
      serie: semanal,
      banda: bandaEnPct(bandaClim, semanal.map((p) => p.fecha), fila.namoMm3),
      rangoPropio: rangoPropio(semanal),
      cambio30Puntos: cambioPuntos(semanal, 30),
      atrasoDias: atraso, frescura: estadoFrescura(atraso),
      descartes: entrada.descartes[id] ?? [],
    };
  });
}
