/**
 * sistemaCuenca — lógica PURA del sinóptico «El agua en la cuenca» (Cuenca → Red y estaciones).
 * Sin React ni red. Tres piezas:
 *   1. Lluvia por región hidrológica: las 28 subcuencas INEGI de la RH24 agrupadas en sus 5 cuencas, con el MISMO promedio areal
 *      (IDW, mínimos de estaciones y cobertura) que la lluvia de toda la cuenca. Lo que no alcanza cobertura es S/D, nunca 0.
 *   2. Disposición del esquema: el tronco del Conchos de la cabecera a la salida y cada afluente en su carril hasta su confluencia
 *      real (Florido antes del distrito; San Pedro y Chuvíscar después), con el distrito de riego entre el Conchos y el San Pedro.
 *   3. Recorrido del agua de un elemento (todo lo que le llega y todo lo que alimenta), para resaltarlo al seleccionarlo.
 * Los vasos y su orden salen del catálogo; el punto donde cada afluente se une al Conchos sale del plano digital de ríos (CONFLUENCIAS).
 */
import { lluviaAreal, type LluviaAreal, type PuntoLluvia } from './jcasCuenca';
import type { PoligonoGeo } from './geoCuenca';
import { dentroDelPoligono } from './vasoAnalisis';
import { ordenarCuerpos, type CuerpoAgua } from './cuerposAgua';

// ── Capas ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export type CapaSistema = 'lluvia' | 'hidro' | 'presas' | 'distrito' | 'gastos';
export const CAPAS_SISTEMA: { id: CapaSistema; titulo: string; ayuda: string }[] = [
  { id: 'lluvia', titulo: 'Lluvia', ayuda: 'Lluvia observada por las estaciones climatológicas en cada región de la cuenca' },
  { id: 'hidro', titulo: 'Estaciones hidrométricas', ayuda: 'Gasto que miden las estaciones GOES y el aforo USIBWC sobre los ríos' },
  { id: 'presas', titulo: 'Vasos', ayuda: 'Almacenamiento de cada presa y lo que le entra y le sale' },
  { id: 'distrito', titulo: 'Distrito de riego', ayuda: 'Paso del agua por el Distrito de Riego 005: entrada en K-0, cola en K-104 y lluvia dentro de su poligonal' },
  { id: 'gastos', titulo: 'Gastos y flujo', ayuda: 'Grosor y movimiento de cada tramo según su gasto en m³/s' },
];
export const todasLasCapasSistema = (): CapaSistema[] => CAPAS_SISTEMA.map((c) => c.id);

// ── Lluvia por región hidrológica ───────────────────────────────────────────────────────────────────────────────────
export interface RegionLluvia {
  /** Nombre de la cuenca INEGI tal como viene en el archivo de subcuencas. */
  clave: string;
  nombre: string;
  /** Río que recoge el escurrimiento de la región. */
  rio: string;
  orden: number;
  /** true = región de aguas abajo del último vaso: escurre directo a la salida de la cuenca. */
  aLaSalida: boolean;
  areaKm2: number;
  nSubcuencas: number;
  poligonos: PoligonoGeo[];
}

/** Las 5 cuencas de la RH24 (INEGI) que forman la cuenca del Conchos, de aguas arriba a aguas abajo. */
const REGIONES: Record<string, { nombre: string; rio: string; orden: number; aLaSalida?: boolean }> = {
  'R. FLORIDO': { nombre: 'Río Florido', rio: 'Río Florido', orden: 1 },
  'R. CONCHOS - P. DE LA BOQUILLA': { nombre: 'Alto Conchos', rio: 'Río Conchos', orden: 2 },
  'R. SAN PEDRO': { nombre: 'Río San Pedro', rio: 'Río San Pedro', orden: 3 },
  'R. CONCHOS - P. EL GRANERO': { nombre: 'Conchos medio', rio: 'Río Conchos y Chuvíscar', orden: 4 },
  'R. CONCHOS - OJINAGA': { nombre: 'Bajo Conchos', rio: 'Río Conchos', orden: 5, aLaSalida: true },
};

/** Agrupa el GeoJSON de subcuencas por su cuenca. Una cuenca desconocida se conserva con su propio nombre (no se descarta). */
export function regionesDeSubcuencas(fc: unknown): RegionLluvia[] {
  const feats = (fc as { features?: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const por = new Map<string, RegionLluvia>();
  for (const f of feats) {
    const clave = String(f.properties?.cuenca ?? '').trim();
    const g = f.geometry;
    if (!clave || !g || !Array.isArray(g.coordinates)) continue;
    const polis: PoligonoGeo[] = g.type === 'Polygon' ? [g.coordinates as PoligonoGeo] : g.type === 'MultiPolygon' ? (g.coordinates as PoligonoGeo[]) : [];
    if (!polis.length) continue;
    const meta = REGIONES[clave];
    const r = por.get(clave) ?? { clave, nombre: meta?.nombre ?? clave, rio: meta?.rio ?? '', orden: meta?.orden ?? 99, aLaSalida: meta?.aLaSalida === true, areaKm2: 0, nSubcuencas: 0, poligonos: [] };
    const area = Number(f.properties?.area_km2);
    r.areaKm2 += Number.isFinite(area) ? area : 0;
    r.nSubcuencas++;
    r.poligonos.push(...polis.filter((p) => Array.isArray(p) && p.length > 0 && p[0].length >= 4));
    por.set(clave, r);
  }
  return [...por.values()].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Región que contiene un punto; null si cae fuera de todas (o no tiene coordenadas). */
export function regionDePunto(regiones: RegionLluvia[], lon: number | null | undefined, lat: number | null | undefined): string | null {
  if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return regiones.find((r) => r.poligonos.some((p) => dentroDelPoligono(p, lon, lat)))?.clave ?? null;
}

export interface LluviaRegion {
  region: RegionLluvia;
  /** Promedio areal de la región (mismas reglas que la lluvia de la cuenca). mm null = S/D con su motivo. */
  areal: LluviaAreal;
  /** Estaciones con dato útil DENTRO de la región, de mayor a menor lluvia. */
  dentro: PuntoLluvia[];
}

/**
 * Lluvia areal de cada región con los puntos de TODA la cuenca: una estación vecina fuera de la región también informa a las celdas
 * que tiene cerca (IDW a ≤ 90 km), igual que en el promedio general. `nEstaciones` del areal cuenta las de toda la red; `dentro`
 * son las que están físicamente en la región. Las estaciones que caen dentro de la poligonal del distrito (`distrito`) se listan
 * con el distrito, no con la región que lo rodea: siguen informando al promedio areal, pero no se nombran dos veces.
 */
/** Distancia (km) de un punto al borde de un anillo, en proyección plana local (suficiente a esta escala). */
function distBordeKm(anillo: [number, number][], lon: number, lat: number): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let mejor = Infinity;
  for (let i = 0; i < anillo.length - 1; i++) {
    const ax = (anillo[i][0] - lon) * kx, ay = (anillo[i][1] - lat) * ky, bx = (anillo[i + 1][0] - lon) * kx, by = (anillo[i + 1][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    mejor = Math.min(mejor, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return mejor;
}

/** Holgura (km) con que una estación se considera del distrito: los contornos de los módulos están simplificados (p. ej. Riego San Rafael, módulo 1, cae a 0.7 km). */
export const TOLERANCIA_DISTRITO_KM = 1.5;

/** ¿La estación está en la poligonal del distrito, o a menos de la tolerancia de su borde? */
export function enPoligonalDistrito(distrito: PoligonoGeo[], lon: number, lat: number): boolean {
  return distrito.some((g) => dentroDelPoligono(g, lon, lat) || distBordeKm(g[0], lon, lat) <= TOLERANCIA_DISTRITO_KM);
}

export function lluviaPorRegion(regiones: RegionLluvia[], puntos: PuntoLluvia[], ventanaDias: number, distrito: PoligonoGeo[] = []): LluviaRegion[] {
  const enDistrito = (p: PuntoLluvia) => enPoligonalDistrito(distrito, p.lon, p.lat);
  return regiones.map((region) => ({
    region,
    areal: ventanaDias < 1
      ? { mm: null, motivoSD: 'la ventana aún no tiene días completos', nEstaciones: 0, nExcluidas: 0, coberturaPct: 0, ventanaDias: 0, min: null, max: null }
      : lluviaAreal(region.poligonos, puntos, ventanaDias),
    dentro: puntos.filter((p) => p.mm != null && !p.sospechosa && !enDistrito(p) && region.poligonos.some((g) => dentroDelPoligono(g, p.lon, p.lat)))
      .sort((a, b) => (b.mm as number) - (a.mm as number)),
  }));
}

/** Polígonos de un GeoJSON de polígonos (p. ej. los módulos del distrito). Entrada inválida: lista vacía. */
export function poligonosDeGeojson(fc: unknown): PoligonoGeo[] {
  const feats = (fc as { features?: { geometry?: { type?: string; coordinates?: unknown } | null }[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  return feats.flatMap((f): PoligonoGeo[] => {
    const g = f?.geometry;
    if (!g || !Array.isArray(g.coordinates)) return [];
    return g.type === 'Polygon' ? [g.coordinates as PoligonoGeo] : g.type === 'MultiPolygon' ? (g.coordinates as PoligonoGeo[]) : [];
  }).filter((pl) => Array.isArray(pl) && pl.length > 0 && Array.isArray(pl[0]) && pl[0].length >= 4);
}

export interface LluviaDistrito {
  /** Promedio SIMPLE de las estaciones de dentro (no es areal: son pocas y cercanas). null sin estaciones con dato. */
  mm: number | null;
  /** Estaciones con dato útil dentro de la poligonal, de mayor a menor lluvia. */
  dentro: PuntoLluvia[];
}

/** Lluvia que registran las estaciones dentro de la poligonal del distrito de riego. Sin estaciones con dato: S/D (nunca 0). */
export function lluviaEnDistrito(distrito: PoligonoGeo[], puntos: PuntoLluvia[]): LluviaDistrito {
  const dentro = puntos.filter((p) => p.mm != null && !p.sospechosa && enPoligonalDistrito(distrito, p.lon, p.lat)).sort((a, b) => (b.mm as number) - (a.mm as number));
  return { mm: dentro.length ? Math.round((dentro.reduce((t, p) => t + (p.mm as number), 0) / dentro.length) * 10) / 10 : null, dentro };
}

// ── Red de ríos: tronco y confluencias ──────────────────────────────────────────────────────────────────────────────
/** Río principal de la cuenca: los vasos sobre esta corriente forman el tronco del esquema. */
export const TRONCO = 'Río Conchos';

export interface Confluencia {
  id: string;
  /** Río que llega al Conchos en este punto. */
  afluente: string;
  /** Corrientes del catálogo que llegan por aquí: la primera es el afluente; las demás se le unen antes. */
  corrientes: string[];
  /** Lado del tronco por el que se dibuja (solo composición del esquema). */
  lado: 'arriba' | 'abajo';
  /** true = se une al Conchos aguas arriba del distrito de riego. */
  antesDelDistrito: boolean;
  lat: number;
  lon: number;
  cerca: string;
}

/**
 * Dónde se une cada afluente al Conchos, de aguas arriba a aguas abajo. Verificado sobre el plano digital de ríos de SICA
 * (public/geo/ref_rios.geojson, HydroRIVERS) siguiendo el flujo desde cada vaso y cada estación hasta la desembocadura:
 *   · la toma del Canal Principal (K-0) queda ANTES de la confluencia del Florido;
 *   · el San Pedro se une ya dentro del distrito, y el Chuvíscar en su extremo norte;
 *   · la estación Babisas (28.559, −105.423) queda DESPUÉS de las tres confluencias y antes de Luis L. León: mide el Conchos
 *     que sale del distrito, no el San Pedro.
 * El catálogo (`aguas_abajo_id`) solo dice «descarga a Luis L. León»; el punto de unión sale de aquí.
 */
export const CONFLUENCIAS: Confluencia[] = [
  { id: 'conf:florido', afluente: 'Río Florido', corrientes: ['Río Florido', 'Río Parral'], lado: 'arriba', antesDelDistrito: true, lat: 27.71, lon: -105.169, cerca: 'Camargo, aguas abajo de la toma del canal (K-0)' },
  { id: 'conf:sanpedro', afluente: 'Río San Pedro', corrientes: ['Río San Pedro'], lado: 'abajo', antesDelDistrito: false, lat: 28.348, lon: -105.406, cerca: 'entre Meoqui y Julimes, dentro del distrito' },
  { id: 'conf:chuviscar', afluente: 'Río Chuvíscar', corrientes: ['Río Chuvíscar', 'Arroyo El Rejón'], lado: 'abajo', antesDelDistrito: false, lat: 28.552, lon: -105.427, cerca: 'extremo norte del distrito, junto a la estación Babisas' },
];

// ── Disposición del esquema ─────────────────────────────────────────────────────────────────────────────────────────
export const DIM = { BW: 156, BH: 60, LLW: 124, EW: 112, EH: 36, GAP_EST: 184, GX: 30, PAD: 14, TOP: 44, PASO_Y: 92, ZONA_W: 168, ZONA_H: 110, R: 22 } as const;

export type TipoNodo = 'presa' | 'lluvia' | 'estacion' | 'distrito' | 'confluencia' | 'salida' | 'bravo';
export interface NodoSis {
  id: string;
  tipo: TipoNodo;
  x: number; y: number; w: number; h: number;
  cuerpo?: CuerpoAgua;
  /** Clave de la región (nodos de lluvia). */
  region?: string;
  /** Id de la estación hidrométrica (nodos de estación). */
  estacionId?: string;
  confluencia?: Confluencia;
}
export type TipoArco = 'rio' | 'aforo' | 'tramo' | 'lluvia' | 'canal';
export interface ArcoSis {
  id: string;
  /** rio = sale de un vaso · aforo = sale de una estación · tramo = sale de una confluencia (sin aforo) · canal = derivación al distrito. */
  tipo: TipoArco;
  de: string;
  a: string;
  d: string;
  /** Punto para rotular el gasto del tramo (solo donde hay sitio). */
  rotulo?: { x: number; y: number };
}
export interface RotuloRio { texto: string; x: number; y: number }
export interface EtapaSis { titulo: string; x: number; w: number }
export interface Disposicion {
  nodos: NodoSis[];
  arcos: ArcoSis[];
  /** Pares aguas arriba → aguas abajo, para recorrer el agua (incluye lluvia, estaciones, confluencias y distrito). */
  enlaces: [string, string][];
  rotulosRio: RotuloRio[];
  etapas: EtapaSis[];
  /** Toma del canal principal sobre el tronco (K-0); null si el catálogo no tiene vasos del distrito. */
  toma: { x: number; y: number; cuerpoId: string } | null;
  ancho: number;
  alto: number;
}

/** Sitio de una estación hidrométrica: de entrada a un vaso, sobre el Conchos a la salida del distrito, o en la salida de la cuenca. */
export interface EstacionSitio { id: string; rol: 'entrada' | 'rio' | 'salida'; presaId: string | null }

export const ID_SALIDA = 'salida';
/** Río Bravo (Grande): el Conchos le entrega su agua frente a Ojinaga (Chih.) / Presidio (Tex.), aguas abajo de la última estación de la cuenca. */
export const ID_BRAVO = 'bravo';
export const ID_DISTRITO = 'distrito';
export const idLluvia = (clave: string) => `lluvia:${clave}`;
export const idEstacion = (id: string) => `est:${id}`;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Coloca el tronco del Conchos en el centro, de la cabecera a la salida, y cada afluente en su carril hasta su confluencia real.
 * El distrito es la zona entre el Conchos y el San Pedro: recibe la derivación de K-0 y la de F. I. Madero. Las estaciones «de río»
 * van sobre el tronco después de las confluencias. `regionDeCuerpo` dice en qué región de lluvia cae cada vaso; sin regiones
 * (capa no disponible) el esquema se dibuja igual, sin los nodos de lluvia.
 */
export function disponerSistema(cuerposEntrada: CuerpoAgua[], regiones: RegionLluvia[], regionDeCuerpo: Map<string, string | null>, estaciones: EstacionSitio[]): Disposicion | null {
  const cuerpos = ordenarCuerpos(cuerposEntrada);
  if (!cuerpos.length) return null;
  const { BW, BH, LLW, EW, EH, GAP_EST, GX, PAD, TOP, PASO_Y, ZONA_W, ZONA_H, R } = DIM;

  // Tronco: vasos sobre el río principal. El último es el vaso de cierre (si el catálogo no marca corrientes, el que no descarga a nadie).
  let tronco = cuerpos.filter((c) => c.corriente === TRONCO);
  if (!tronco.length) tronco = cuerpos.filter((c) => !c.aguasAbajoId).slice(-1);
  if (!tronco.length) tronco = cuerpos.slice(-1);
  const cierre = tronco[tronco.length - 1], altos = tronco.slice(0, -1);
  const enTronco = new Set(tronco.map((c) => c.id));

  // Carriles: cada corriente afluente con sus vasos en orden; lo que no esté en la tabla de confluencias llega por la última.
  const resto = cuerpos.filter((c) => !enTronco.has(c.id));
  const confDe = (corriente: string | null) => CONFLUENCIAS.find((k) => corriente != null && k.corrientes.includes(corriente)) ?? CONFLUENCIAS[CONFLUENCIAS.length - 1];
  interface Carril { corriente: string; conf: Confluencia; principal: boolean; vasos: CuerpoAgua[]; fila: number }
  const carriles: Carril[] = [];
  for (const k of CONFLUENCIAS) {
    const propias = [...new Set(resto.filter((c) => confDe(c.corriente) === k).map((c) => c.corriente ?? ''))]
      .sort((a, b) => { const ia = k.corrientes.indexOf(a), ib = k.corrientes.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    propias.forEach((corriente, i) => carriles.push({ corriente, conf: k, principal: i === 0, vasos: resto.filter((c) => (c.corriente ?? '') === corriente && confDe(c.corriente) === k), fila: 0 }));
  }
  const confs = CONFLUENCIAS.filter((k) => carriles.some((c) => c.conf === k));
  const arriba = carriles.filter((c) => c.conf.lado === 'arriba'), debajo = carriles.filter((c) => c.conf.lado === 'abajo');

  const delDistrito = cuerpos.filter((c) => c.presaId != null);
  const hayDistrito = delDistrito.length > 0;
  const yTronco = TOP + arriba.length * PASO_Y;
  const ycTronco = yTronco + BH / 2;
  const yZona = ycTronco + 20;
  const yDebajo0 = hayDistrito ? yZona + ZONA_H + 20 - BH / 2 : yTronco + PASO_Y;
  arriba.forEach((c, i) => { c.fila = TOP + i * PASO_Y; });
  debajo.forEach((c, i) => { c.fila = yDebajo0 + i * PASO_Y; });

  const xVaso0 = PAD + LLW + GAP_EST;
  const xCol = (c: number) => xVaso0 + c * (BW + GX);
  const maxCol = Math.max(altos.length - 1, ...carriles.map((c) => c.vasos.length - 1), 0);
  const centro = (n: NodoSis) => n.y + n.h / 2;

  const nodos: NodoSis[] = [];
  const nodo = new Map<string, NodoSis>();
  const agrega = (n: NodoSis) => { nodos.push(n); nodo.set(n.id, n); return n; };
  const arcos: ArcoSis[] = [];
  const enlaces: [string, string][] = [];
  const rotulosRio: RotuloRio[] = [];

  altos.forEach((c, i) => agrega({ id: c.id, tipo: 'presa', x: xCol(i), y: yTronco, w: BW, h: BH, cuerpo: c }));
  for (const car of carriles) car.vasos.forEach((c, i) => agrega({ id: c.id, tipo: 'presa', x: xCol(i), y: car.fila, w: BW, h: BH, cuerpo: c }));

  // Los carriles secundarios (Parral, El Rejón) se unen a su río principal antes de llegar al Conchos.
  const finCarril = (car: Carril) => xCol(car.vasos.length - 1) + BW;
  const xUnion = new Map<Carril, number>();
  for (const car of carriles.filter((c) => !c.principal)) {
    const prin = carriles.find((c) => c.conf === car.conf && c.principal) as Carril;
    xUnion.set(car, Math.max(finCarril(car), finCarril(prin)) + 124);
  }
  const unionMax = (k: Confluencia) => Math.max(0, ...carriles.filter((c) => c.conf === k && !c.principal).map((c) => xUnion.get(c) as number));

  // Eje X del tronco: vasos altos → toma K-0 → confluencias de antes del distrito → zona del distrito → las de después → estaciones → cierre → salida.
  const xFinAltos = (altos.length ? xCol(altos.length - 1) : xVaso0 - GX) + BW;
  const xToma = Math.max(xFinAltos, xCol(maxCol) + BW) + 26;
  let cursor = xToma + 12;
  const xConf = new Map<string, number>();
  for (const k of confs.filter((c) => c.antesDelDistrito)) { cursor = Math.max(cursor + 32, unionMax(k) + R + 14); xConf.set(k.id, cursor); }
  const xZona = xToma - 14;
  const xZonaFin = hayDistrito ? Math.max(xZona + ZONA_W, cursor + 20) : cursor;
  cursor = xZonaFin;
  for (const k of confs.filter((c) => !c.antesDelDistrito)) { cursor = Math.max(cursor + (cursor === xZonaFin ? 26 : 40), unionMax(k) + R + 14); xConf.set(k.id, cursor); }
  const deRio = estaciones.filter((e) => e.rol === 'rio');
  const xEst = new Map<string, number>();
  for (const e of deRio) { xEst.set(e.id, cursor + 24); cursor += 24 + EW; }
  const xCierre = cursor + 24;
  const xSalida = xCierre + BW + 44;
  const xBravo = xSalida + BW + 48;

  agrega({ id: cierre.id, tipo: 'presa', x: xCierre, y: yTronco, w: BW, h: BH, cuerpo: cierre });
  agrega({ id: ID_SALIDA, tipo: 'salida', x: xSalida, y: yTronco, w: BW, h: BH });
  agrega({ id: ID_BRAVO, tipo: 'bravo', x: xBravo, y: yTronco, w: BW, h: BH });
  for (const k of confs) agrega({ id: k.id, tipo: 'confluencia', x: (xConf.get(k.id) as number) - 9, y: ycTronco - 9, w: 18, h: 18, confluencia: k });
  for (const e of deRio) agrega({ id: idEstacion(e.id), tipo: 'estacion', estacionId: e.id, x: xEst.get(e.id) as number, y: ycTronco - EH / 2, w: EW, h: EH });

  // Estaciones de entrada: sobre el río, antes de su vaso.
  const entradaDe = new Map<string, NodoSis>();
  for (const e of estaciones.filter((x) => x.rol === 'entrada')) {
    const c = e.presaId ? cuerpos.find((x) => x.presaId === e.presaId) : undefined, n = c ? nodo.get(c.id) : undefined;
    if (!c || !n || entradaDe.has(c.id)) continue;
    const enCabecera = Math.abs(n.x - xVaso0) < 1;
    entradaDe.set(c.id, agrega({ id: idEstacion(e.id), tipo: 'estacion', estacionId: e.id, w: EW, h: EH, x: enCabecera ? PAD + LLW + (GAP_EST - EW) / 2 : n.x + (BW - EW) / 2, y: enCabecera ? centro(n) - EH / 2 : n.y - EH - 8 }));
  }
  for (const [cuerpoId, est] of entradaDe) {
    const n = nodo.get(cuerpoId) as NodoSis, enLinea = Math.abs(centro(est) - centro(n)) < 1;
    arcos.push({ id: `aforo:${est.id}`, tipo: 'aforo', de: est.id, a: cuerpoId, d: enLinea ? `M${est.x + est.w},${r1(centro(est))} H${n.x}` : `M${r1(est.x + est.w / 2)},${est.y + est.h} V${n.y}` });
    enlaces.push([est.id, cuerpoId]);
  }

  // Tronco: un tramo entre cada par de elementos consecutivos. Lo que sale de una confluencia no tiene aforo (S/D).
  const enTroncoOrden = nodos.filter((n) => Math.abs(centro(n) - ycTronco) < 1 && n.tipo !== 'lluvia' && !(n.tipo === 'estacion' && !deRio.some((e) => idEstacion(e.id) === n.id))).sort((a, b) => a.x - b.x);
  for (let i = 0; i < enTroncoOrden.length - 1; i++) {
    const a = enTroncoOrden[i], b = enTroncoOrden[i + 1];
    const tipo: TipoArco = a.tipo === 'presa' ? 'rio' : a.tipo === 'estacion' ? 'aforo' : 'tramo';
    arcos.push({ id: `${tipo}:${a.id}`, tipo, de: a.id, a: b.id, d: `M${a.x + a.w},${ycTronco} H${b.x}` });
    enlaces.push([a.id, b.id]);
  }
  rotulosRio.push({ texto: TRONCO, x: xToma + 14, y: ycTronco });
  // El último tramo del tronco (Ojinaga → Río Bravo) sale de la salida: sin aforo propio, la estación mide antes de la unión.

  // Afluentes: cada carril corre paralelo y dobla hacia el tronco en su confluencia; los secundarios doblan antes hacia su principal.
  for (const car of carriles) {
    const yc = car.fila + BH / 2;
    car.vasos.forEach((c, i) => {
      const n = nodo.get(c.id) as NodoSis, sig = car.vasos[i + 1];
      if (sig) {
        const m = nodo.get(sig.id) as NodoSis;
        arcos.push({ id: `rio:${c.id}`, tipo: 'rio', de: c.id, a: sig.id, d: `M${n.x + n.w},${yc} H${m.x}` });
        enlaces.push([c.id, sig.id]);
        return;
      }
      const x1 = n.x + n.w;
      if (car.principal) {
        const cx = xConf.get(car.conf.id) as number, baja = yc < ycTronco;
        arcos.push({ id: `rio:${c.id}`, tipo: 'rio', de: c.id, a: car.conf.id, rotulo: { x: x1 + 14, y: yc }, d: `M${x1},${yc} H${cx - R} Q${cx},${yc} ${cx},${yc + (baja ? R : -R)} V${ycTronco + (baja ? -10 : 10)}` });
        enlaces.push([c.id, car.conf.id]);
      } else {
        const prin = carriles.find((p) => p.conf === car.conf && p.principal) as Carril, jx = xUnion.get(car) as number, yp = prin.fila + BH / 2;
        arcos.push({ id: `rio:${c.id}`, tipo: 'rio', de: c.id, a: car.conf.id, rotulo: { x: x1 + 14, y: yc }, d: `M${x1},${yc} H${jx - R} Q${jx},${yc} ${jx},${yc + (yp < yc ? -R : R)} V${yp + (yp < yc ? 4 : -4)}` });
        enlaces.push([c.id, car.conf.id]);
      }
      rotulosRio.push({ texto: car.corriente, x: x1 + 14, y: yc });
    });
  }

  // Distrito: zona bajo el tronco. Le entra la derivación del canal principal (K-0) y la del vaso del distrito sobre el afluente.
  let toma: Disposicion['toma'] = null;
  if (hayDistrito) {
    agrega({ id: ID_DISTRITO, tipo: 'distrito', x: xZona, y: yZona, w: xZonaFin - xZona, h: ZONA_H });
    const altoDistrito = altos.filter((c) => c.presaId != null || altos.some((p) => p.presaId != null && p.aguasAbajoId === c.id));
    const tomaCuerpo = altoDistrito[altoDistrito.length - 1];
    if (tomaCuerpo) {
      toma = { x: xToma, y: ycTronco, cuerpoId: tomaCuerpo.id };
      arcos.push({ id: `canal:${tomaCuerpo.id}`, tipo: 'canal', de: tomaCuerpo.id, a: ID_DISTRITO, d: `M${xToma},${ycTronco + 4} V${yZona - 2}` });
      enlaces.push([tomaCuerpo.id, ID_DISTRITO]);
    }
    delDistrito.filter((c) => !enTronco.has(c.id)).forEach((c, i) => {
      const n = nodo.get(c.id) as NodoSis, px = xZona + 34 + i * 16, sube = centro(n) > yZona;
      arcos.push({ id: `canal:${c.id}`, tipo: 'canal', de: c.id, a: ID_DISTRITO, d: `M${px},${r1(centro(n) + (sube ? -4 : 4))} V${sube ? yZona + ZONA_H + 2 : yZona - 2}` });
      enlaces.push([c.id, ID_DISTRITO]);
    });
  }

  // Lluvia: cada región escurre a las cabeceras que tiene dentro; la de aguas abajo, directo a la salida.
  const cabeceras = [...(altos.length ? [altos[0]] : []), ...carriles.map((c) => c.vasos[0])];
  for (const reg of regiones) {
    const dentro = cabeceras.filter((c) => regionDeCuerpo.get(c.id) === reg.clave);
    const id = idLluvia(reg.clave);
    if (dentro.length) {
      const ns = dentro.map((c) => nodo.get(c.id) as NodoSis);
      const yc = ns.reduce((s, n) => s + centro(n), 0) / ns.length;
      const ll = agrega({ id, tipo: 'lluvia', region: reg.clave, x: PAD, y: r1(yc - BH / 2), w: LLW, h: BH });
      for (const c of dentro) {
        const n = nodo.get(c.id) as NodoSis, est = entradaDe.get(c.id);
        const fin = est && Math.abs(centro(est) - centro(n)) < 1 ? est : n;
        const x1 = ll.x + ll.w, y1 = r1(centro(ll)), y2 = r1(centro(fin)), mx = r1((x1 + fin.x) / 2);
        arcos.push({ id: `lluvia:${reg.clave}:${c.id}`, tipo: 'lluvia', de: id, a: fin.id, d: Math.abs(y1 - y2) < 1 ? `M${x1},${y1} H${fin.x}` : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${fin.x},${y2}` });
        enlaces.push([id, fin.id]);
      }
    } else {
      // Sin cabeceras dentro: la lluvia cae aguas abajo de los vasos. Se cuelga de la salida (o del vaso de cierre que la contiene).
      const destino = nodo.get(!reg.aLaSalida && regionDeCuerpo.get(cierre.id) === reg.clave ? cierre.id : ID_SALIDA) as NodoSis;
      const xl = destino.x + (destino.w - LLW) / 2;
      const arribaLibre = !nodos.some((n) => n.tipo === 'lluvia' && Math.abs(n.x - xl) < 1 && n.y < destino.y);
      const ll = agrega({ id, tipo: 'lluvia', region: reg.clave, x: xl, y: arribaLibre ? destino.y - BH - 34 : destino.y + destino.h + 34, w: LLW, h: BH });
      const xm = r1(ll.x + ll.w / 2);
      arcos.push({ id: `lluvia:${reg.clave}:${destino.id}`, tipo: 'lluvia', de: id, a: destino.id, d: arribaLibre ? `M${xm},${ll.y + ll.h} V${destino.y}` : `M${xm},${ll.y} V${destino.y + destino.h}` });
      enlaces.push([id, destino.id]);
    }
  }

  const yMin = Math.min(...nodos.map((n) => n.y)), yMax = Math.max(...nodos.map((n) => n.y + n.h));
  // Si un nodo quedó por encima del margen (lluvia sobre la salida con pocas filas), todo baja lo necesario.
  const dy = yMin < TOP ? TOP - yMin : 0;
  const etapas: EtapaSis[] = [
    ...(regiones.length ? [{ titulo: 'Lluvia', x: PAD, w: LLW }] : []),
    { titulo: 'Ríos y vasos', x: xVaso0, w: xCol(maxCol) + BW - xVaso0 },
    ...(hayDistrito ? [{ titulo: 'Distrito y confluencias', x: xZona, w: xCierre - 24 - xZona }] : []),
    { titulo: 'Cierre y Río Bravo', x: xCierre, w: xBravo + BW - xCierre },
  ];
  const base: Disposicion = { nodos, arcos, enlaces, rotulosRio, etapas, toma, ancho: xBravo + BW + PAD, alto: yMax + dy + 16 };
  return dy ? desplazarY(base, dy) : base;
}

/** Baja todo el esquema `dy` unidades (nodos, rótulos y trazos). */
function desplazarY(d: Disposicion, dy: number): Disposicion {
  const mueve = (ruta: string) => ruta.replace(/([MLCQ])([^MLCQHV]+)|V(-?[\d.]+)/g, (_t, cmd: string | undefined, args: string | undefined, v: string | undefined) => {
    if (v != null) return `V${r1(Number(v) + dy)}`;
    const pares = (args as string).trim().split(/\s+/).map((p) => { const [x, y] = p.split(','); return `${x},${r1(Number(y) + dy)}`; });
    return `${cmd}${pares.join(' ')}`;
  });
  return {
    ...d,
    nodos: d.nodos.map((n) => ({ ...n, y: n.y + dy })),
    arcos: d.arcos.map((a) => ({ ...a, d: mueve(a.d), rotulo: a.rotulo ? { x: a.rotulo.x, y: a.rotulo.y + dy } : undefined })),
    rotulosRio: d.rotulosRio.map((r) => ({ ...r, y: r.y + dy })),
    toma: d.toma ? { ...d.toma, y: d.toma.y + dy } : null,
  };
}

// ── Recorrido del agua ──────────────────────────────────────────────────────────────────────────────────────────────
/** Todo lo que está aguas arriba y aguas abajo de `id` (incluido él). Con `id` desconocido devuelve solo ese id. */
export function recorridoDelAgua(enlaces: [string, string][], id: string): Set<string> {
  const out = new Set<string>([id]);
  const anda = (sig: (e: [string, string]) => [string, string]) => {
    const cola = [id], visto = new Set<string>([id]);
    while (cola.length) {
      const cur = cola.shift() as string;
      for (const e of enlaces) { const [de, a] = sig(e); if (de === cur && !visto.has(a)) { visto.add(a); out.add(a); cola.push(a); } }
    }
  };
  anda((e) => e);
  anda(([de, a]) => [a, de]);
  return out;
}

/** Un arco pertenece al recorrido si sus dos extremos están en él. */
export const arcoEnRecorrido = (a: Pick<ArcoSis, 'de' | 'a'>, rec: Set<string>): boolean => rec.has(a.de) && rec.has(a.a);

// ── Trazo según el gasto ────────────────────────────────────────────────────────────────────────────────────────────
/** Grosor del tramo: crece con la raíz del gasto (el área del trazo sigue al caudal). Sin dato o gasto 0: trazo fino. */
export function grosorDeGasto(q: number | null | undefined, qMax: number): number {
  if (q == null || !Number.isFinite(q) || q <= 0 || !(qMax > 0)) return 1.6;
  return Math.round((2 + 7 * Math.sqrt(Math.min(q, qMax) / qMax)) * 10) / 10;
}

/** Texto del gasto de un tramo: 2 decimales por debajo de 10 m³/s, 1 desde ahí. null = S/D (nunca 0). */
export function textoGastoTramo(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return 'S/D';
  const d = Math.abs(q) < 10 ? 2 : 1;
  return q.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
}
