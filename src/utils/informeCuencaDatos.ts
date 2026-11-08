/**
 * informeCuencaDatos — datos del informe infografía "Cuenca del Conchos". Lógica PURA.
 * Reutiliza EL MISMO modelo que la pantalla (construirModeloCuenca): las cifras del informe nunca divergen de las de la vista.
 * Los agregados se calculan SOLO sobre las presas seleccionadas y se rotulan así ("de las N presas seleccionadas").
 */
import {
  agregadoCuenca, aportacionTotal, restarDias, UBICACIONES_LLUVIA, NOMBRE_LLUVIA,
  type ResumenLluvia,
} from './aqwpCuenca';
import { construirModeloCuenca, type EntradaModeloCuenca, type PresaCuencaModelo } from './cuencaModelo';
import { ordenarPresas, type PuntoBanda, type PuntoSemanal } from './cuencaViz';
import { anioInicioCiclo, lluviaCiclo, lluviaVsCicloAnterior, type LluviaCiclo, type LluviaVsAnterior } from './aqwpEstadistica';
import { etiquetaAlcance, pasaTamano, type ConfigInformeCuenca } from './informeCuencaConfig';
import type { Descarte } from './aqwpCalidad';

export interface EntradaInformeCuenca extends EntradaModeloCuenca {
  lluvia: ResumenLluvia;
  lluviaSerie: { ubicacionId: number; fecha: string; valor: number | null }[];
  ultSyncEn: string | null;
}

export interface PresaInforme extends Omit<PresaCuencaModelo, 'serie' | 'banda'> {
  /** Serie recortada al periodo del informe (3 o 12 meses). */
  serie: PuntoSemanal[];
  banda: PuntoBanda[] | null;
}

export interface AgregadoInforme {
  /** Presas seleccionadas / con dato. */
  n: number;
  conDato: number;
  almacenadoMm3: number | null;
  namoMm3: number | null;
  /** % del NAMO sumado de las presas contabilizadas. */
  pct: number | null;
  utilMm3: number | null;
  capacidadUtilMm3: number | null;
  pctUtil: number | null;
  sinActualizar: number;
  aportacionM3s: number | null;
  aportacionConDato: number;
  extraccionM3s: number | null;
  /** Presas con semáforo critico / bajo (para el titular). */
  criticas: number;
  bajas: number;
}

export interface LluviaInforme {
  ubicacionId: number;
  nombre: string;
  dias30: (number | null)[];
  total7Mm: number | null;
  total7ConDato: number;
  total30Mm: number | null;
  total30ConDato: number;
  ciclo: LluviaCiclo;
  vsAnterior: LluviaVsAnterior | null;
}

export interface DatosInformeCuenca {
  config: ConfigInformeCuenca;
  /** Fecha de corte de los datos (ISO): la del último dato de las presas incluidas. */
  corte: string | null;
  alcance: string;
  totalPresas: number;
  filtrado: boolean;
  hayClimatologia: boolean;
  presas: PresaInforme[];
  agregado: AgregadoInforme;
  lluvia: { fechas: string[]; hasta: string | null; filas: LluviaInforme[] } | null;
  /** Lecturas atípicas descartadas de las presas incluidas, con su fecha (se rotulan en el anexo). */
  descartes: { presa: string; descarte: Descarte }[];
  ultSyncEn: string | null;
}

const redondea = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** Recorta una serie semanal a los últimos `meses` meses (≈ 91 días por trimestre) respecto al corte. */
export function recortarPeriodo<T extends { fecha: string }>(serie: T[], corte: string, meses: 3 | 12): T[] {
  if (meses === 12) return serie;
  const desde = restarDias(corte, 91);
  return serie.filter((p) => p.fecha >= desde);
}

function agregar(presas: PresaCuencaModelo[]): AgregadoInforme {
  const filas = presas.map((p) => p.fila);
  const ag = agregadoCuenca(filas);
  const apo = aportacionTotal(filas);
  const conUtil = presas.filter((p) => p.util != null);
  const utilMm3 = conUtil.length ? redondea(conUtil.reduce((a, p) => a + (p.util as NonNullable<typeof p.util>).utilMm3, 0), 2) : null;
  const capUtil = conUtil.length ? redondea(conUtil.reduce((a, p) => a + (p.util as NonNullable<typeof p.util>).capacidadUtilMm3, 0), 2) : null;
  const ext = filas.map((f) => f.extraccionTotalM3s).filter((x): x is number => x != null);
  const namos = filas.filter((f) => f.almacenamientoValido != null && (f.namoMm3 ?? 0) > 0).map((f) => f.namoMm3 as number);
  return {
    n: presas.length, conDato: ag.presasConDato,
    almacenadoMm3: ag.totalMm3 == null ? null : redondea(ag.totalMm3, 1),
    namoMm3: namos.length ? redondea(namos.reduce((a, b) => a + b, 0), 1) : null,
    pct: ag.porcentaje == null ? null : redondea(ag.porcentaje, 1),
    utilMm3, capacidadUtilMm3: capUtil,
    pctUtil: utilMm3 != null && capUtil ? redondea((utilMm3 / capUtil) * 100, 1) : null,
    sinActualizar: filas.filter((f) => f.sinActualizar).length,
    aportacionM3s: apo.total == null ? null : redondea(apo.total, 2), aportacionConDato: apo.conDato,
    extraccionM3s: ext.length ? redondea(ext.reduce((a, b) => a + b, 0), 2) : null,
    criticas: presas.filter((p) => p.semaforo.nivel === 'critico').length,
    bajas: presas.filter((p) => p.semaforo.nivel === 'bajo').length,
  };
}

function armarLluvia(entrada: EntradaInformeCuenca): DatosInformeCuenca['lluvia'] {
  const { lluvia } = entrada;
  if (!lluvia.hasta || lluvia.filas.length === 0) return null;
  const hasta = lluvia.hasta;
  const cicloActual = anioInicioCiclo(hasta);
  const k = Math.round((Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10)) - Date.UTC(cicloActual, 9, 1)) / 86_400_000);
  const filas: LluviaInforme[] = UBICACIONES_LLUVIA.flatMap((id) => {
    const f = lluvia.filas.find((x) => x.ubicacionId === id);
    if (!f) return [];
    const lecturas = entrada.lluviaSerie.filter((l) => l.ubicacionId === id);
    const actual = lluviaCiclo(lecturas, cicloActual, k);
    const anterior = lluviaCiclo(lecturas, cicloActual - 1, k);
    const dias30 = lluvia.serie30.map((r) => (typeof r[String(id)] === 'number' ? (r[String(id)] as number) : null));
    return [{
      ubicacionId: id, nombre: NOMBRE_LLUVIA[id] ?? f.nombre, dias30,
      total7Mm: f.total7.mm, total7ConDato: f.total7.conDato, total30Mm: f.total30.mm, total30ConDato: f.total30.conDato,
      ciclo: actual, vsAnterior: lluviaVsCicloAnterior(actual, anterior),
    }];
  });
  return { fechas: lluvia.serie30.map((r) => r.fecha), hasta, filas };
}

/** Arma los datos del informe: filtra por presas y tamaño, ordena, recorta el periodo y agrega SOLO lo seleccionado. */
export function construirDatosCuenca(entrada: EntradaInformeCuenca, config: ConfigInformeCuenca, hoyISO: string): DatosInformeCuenca {
  const modelo = construirModeloCuenca(entrada, hoyISO);
  const seleccion = modelo.filter((m) => config.presas.includes(m.fila.ubicacionId) && pasaTamano(m.fila.namoMm3, config.tamano));
  const ordenadas = ordenarPresas(
    seleccion.map((m) => ({ m, ubicacionId: m.fila.ubicacionId, pct: m.fila.pct, namoMm3: m.fila.namoMm3, atrasoDias: m.atrasoDias })),
    config.orden,
  ).map((x) => x.m);

  const fechas = ordenadas.map((m) => m.fila.fecha).filter((f): f is string => !!f).sort();
  const corte = fechas.length ? fechas[fechas.length - 1] : null;
  const base = corte ?? hoyISO;

  const presas: PresaInforme[] = ordenadas.map((m) => ({
    ...m,
    serie: recortarPeriodo(m.serie, base, config.meses),
    banda: m.banda ? recortarPeriodo(m.banda, base, config.meses) : null,
  }));

  return {
    config, corte,
    alcance: etiquetaAlcance(config, presas.length, modelo.length),
    totalPresas: modelo.length, filtrado: presas.length < modelo.length,
    hayClimatologia: entrada.climatologia != null,
    presas, agregado: agregar(ordenadas),
    lluvia: config.datos.includes('lluvia') ? armarLluvia(entrada) : null,
    descartes: ordenadas.flatMap((m) => m.descartes.map((d) => ({ presa: m.fila.etiqueta, descarte: d }))),
    ultSyncEn: entrada.ultSyncEn,
  };
}
