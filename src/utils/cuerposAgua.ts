/**
 * cuerposAgua — lógica PURA del catálogo de cuerpos de agua de la cuenca (macromedición, etapa 1).
 * Sin React ni Supabase. Tablas: cuerpos_agua, cuerpos_agua_cierre_mensual, cuerpos_agua_balance_mensual,
 * cuerpos_agua_geometria, v_vaso_ultima_escena.
 *
 * REGLA: lo que no tiene fuente es null (S/D), jamás 0. El cierre mensual ya viene con la fuente elegida y su calidad
 * (precedencia SRL > SINA > AQWP en presas del distrito; SINA > AQWP en las demás): aquí solo se presenta, no se recalcula.
 */

export type CalidadCierre = 'OK' | 'DESFASADO' | 'REPETIDO' | 'DIFIERE' | 'SD';
export type FuenteAlm = 'SRL' | 'SINA' | 'AQWP';
export type Metrica = 'mm3' | 'pct' | 'elev';
export type RolCuerpo = 'almacenamiento' | 'reguladora' | 'derivadora';

export interface CuerpoAgua {
  id: string;
  nombre: string;
  etiqueta: string;
  tambienLlamada: string | null;
  rol: RolCuerpo;
  cuencaId: string;
  corriente: string | null;
  estado: string | null;
  distritoRiego: string | null;
  lat: number | null;
  lon: number | null;
  claveSih: string | null;
  aqwpUbicacionId: number | null;
  presaId: string | null;
  /** Clave de sus series satelitales y de curva (presa_id si es del distrito; si no, el id del cuerpo). */
  idSerie: string;
  aguasAbajoId: string | null;
  ordenRed: number;
  namoRefMm3: number | null;
  namoRefFuente: string | null;
  satelite: boolean;
  nota: string | null;
}

export interface FuenteDetalle { fecha: string | null; almacenamiento: number | null; elevacion: number | null; origen: string | null; estancada: boolean | null }

export interface CierreMensual {
  cuerpoId: string;
  /** Primer día del mes (AAAA-MM-01). */
  mes: string;
  fechaCierre: string;
  fechaDato: string | null;
  almMm3: number | null;
  elevMsnm: number | null;
  fuenteAlm: FuenteAlm | null;
  fuenteElev: FuenteAlm | null;
  calidad: CalidadCierre;
  namoRefMm3: number | null;
  pctNamo: number | null;
  nFuentes: number;
  difMaxMm3: number | null;
  areaSatKm2: number | null;
  /** Valor de cada fuente que tuvo dato ese mes (claves srl / sina / aqwp). */
  detalle: Partial<Record<'srl' | 'sina' | 'aqwp', FuenteDetalle>>;
}

export interface BalanceMensual {
  cuerpoId: string;
  mes: string;
  sIni: number | null;
  sFin: number | null;
  deltaS: number | null;
  entradas: number | null;
  salidaTotal: number | null;
  extraccion: number | null;
  vertido: number | null;
  diasMes: number;
  diasAportacion: number;
  diasSalida: number;
  coberturaPct: number | null;
  evap: number | null;
  residuo: number | null;
  errorCierre: number | null;
  calidad: 'OK' | 'PARCIAL' | 'SD';
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const txt = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

export function normalizarCuerpo(r: Record<string, unknown>): CuerpoAgua {
  return {
    id: String(r.id), nombre: String(r.nombre ?? r.id), etiqueta: String(r.etiqueta ?? r.nombre ?? r.id), tambienLlamada: txt(r.tambien_llamada),
    rol: (txt(r.rol) as RolCuerpo) ?? 'almacenamiento', cuencaId: String(r.cuenca_id ?? ''), corriente: txt(r.corriente), estado: txt(r.estado),
    distritoRiego: txt(r.distrito_riego), lat: num(r.latitud), lon: num(r.longitud), claveSih: txt(r.clave_sih),
    aqwpUbicacionId: num(r.aqwp_ubicacion_id), presaId: txt(r.presa_id), idSerie: String(r.id_serie ?? r.id), aguasAbajoId: txt(r.aguas_abajo_id),
    ordenRed: num(r.orden_red) ?? 0, namoRefMm3: num(r.namo_ref_mm3), namoRefFuente: txt(r.namo_ref_fuente), satelite: r.satelite_activo === true,
    nota: txt(r.nota),
  };
}

function normalizarDetalle(d: unknown): CierreMensual['detalle'] {
  const out: CierreMensual['detalle'] = {};
  if (!d || typeof d !== 'object') return out;
  for (const k of ['srl', 'sina', 'aqwp'] as const) {
    const v = (d as Record<string, unknown>)[k] as Record<string, unknown> | undefined;
    if (v) out[k] = { fecha: txt(v.fecha), almacenamiento: num(v.almacenamiento), elevacion: num(v.elevacion), origen: txt(v.origen), estancada: typeof v.estancada === 'boolean' ? v.estancada : null };
  }
  return out;
}

export function normalizarCierre(r: Record<string, unknown>): CierreMensual {
  return {
    cuerpoId: String(r.cuerpo_id), mes: String(r.mes), fechaCierre: String(r.fecha_cierre), fechaDato: txt(r.fecha_dato),
    almMm3: num(r.almacenamiento_mm3), elevMsnm: num(r.elevacion_msnm), fuenteAlm: txt(r.fuente_alm) as FuenteAlm | null,
    fuenteElev: txt(r.fuente_elev) as FuenteAlm | null, calidad: (txt(r.calidad) as CalidadCierre) ?? 'SD', namoRefMm3: num(r.namo_ref_mm3),
    pctNamo: num(r.pct_namo), nFuentes: num(r.n_fuentes) ?? 0, difMaxMm3: num(r.dif_max_fuentes_mm3), areaSatKm2: num(r.area_sat_km2),
    detalle: normalizarDetalle(r.detalle),
  };
}

export function normalizarBalance(r: Record<string, unknown>): BalanceMensual {
  return {
    cuerpoId: String(r.cuerpo_id), mes: String(r.mes), sIni: num(r.s_ini_mm3), sFin: num(r.s_fin_mm3), deltaS: num(r.delta_s_mm3),
    entradas: num(r.entradas_mm3), salidaTotal: num(r.salida_total_mm3), extraccion: num(r.extraccion_mm3), vertido: num(r.vertido_mm3),
    diasMes: num(r.dias_mes) ?? 0, diasAportacion: num(r.dias_aportacion) ?? 0, diasSalida: num(r.dias_salida) ?? 0,
    coberturaPct: num(r.cobertura_pct), evap: num(r.evap_mm3), residuo: num(r.residuo_mm3), errorCierre: num(r.error_cierre_mm3),
    calidad: (txt(r.calidad) as BalanceMensual['calidad']) ?? 'SD',
  };
}

// ── Etiquetas ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const ETIQUETA_CALIDAD: Record<CalidadCierre, string> = {
  OK: 'Dato del cierre', DESFASADO: 'Dato de días antes', REPETIDO: 'Igual al mes anterior', DIFIERE: 'Las fuentes difieren', SD: 'Sin dato (S/D)',
};
export const DESCRIPCION_CALIDAD: Record<CalidadCierre, string> = {
  OK: 'El valor es del último día del mes.',
  DESFASADO: 'No hay dato el último día del mes; se usa el más reciente de los 3 días anteriores.',
  REPETIDO: 'Idéntico al cierre del mes anterior: la fuente suele repetir el último dato cuando no llega uno nuevo.',
  DIFIERE: 'Dos fuentes difieren más de 0.5 Mm³ o 0.5 %. Se muestra la de mayor precedencia; revise el cuadre.',
  SD: 'Ninguna fuente tiene dato cerca del fin de mes. No se rellena con cero.',
};
/** Glifo + texto: el estado nunca va solo en color. */
export const GLIFO_CALIDAD: Record<CalidadCierre, string> = { OK: '●', DESFASADO: '◐', REPETIDO: '=', DIFIERE: '▲', SD: '◇' };
export const NOMBRE_FUENTE: Record<FuenteAlm, string> = { SRL: 'Reporte SRL/CILA', SINA: 'SINA CONAGUA', AQWP: 'AQUARIUS (CONAGUA vía USIBWC)' };
export const SIGLA_FUENTE: Record<FuenteAlm, string> = { SRL: 'R', SINA: 'S', AQWP: 'A' };
export const METRICAS: { v: Metrica; t: string }[] = [{ v: 'mm3', t: 'Mm³' }, { v: 'pct', t: '% NAMO' }, { v: 'elev', t: 'Elevación' }];

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function etiquetaMes(mes: string, conAnio = false): string {
  const [a, m] = mes.split('-');
  const nombre = MESES_CORTOS[Number(m) - 1] ?? mes;
  return conAnio ? `${nombre} ${a.slice(2)}` : nombre;
}

// ── Matriz presa × mes ──────────────────────────────────────────────────────────────────────────────────────────────
/** Orden hidrológico aguas arriba → aguas abajo (orden_red del catálogo). */
export const ordenarCuerpos = (cuerpos: CuerpoAgua[]): CuerpoAgua[] => [...cuerpos].sort((a, b) => a.ordenRed - b.ordenRed || a.nombre.localeCompare(b.nombre, 'es'));

export function aniosDisponibles(cierres: CierreMensual[]): number[] {
  return [...new Set(cierres.map((c) => Number(c.mes.slice(0, 4))))].sort((a, b) => b - a);
}

/** Meses (AAAA-MM-01) que hay que dibujar: los de `anio`, o todos si es null. Ordenados ascendente. */
export function mesesDe(cierres: CierreMensual[], anio: number | null): string[] {
  const todos = [...new Set(cierres.map((c) => c.mes))].sort();
  return anio == null ? todos : todos.filter((m) => m.startsWith(`${anio}-`));
}

export interface CeldaCierre { texto: string; sd: boolean; cierre: CierreMensual | null }

/** Texto de una celda según la métrica. Sin cierre o sin valor: «S/D» (nunca 0). */
export function celdaCierre(c: CierreMensual | undefined, metrica: Metrica): CeldaCierre {
  if (!c) return { texto: 'S/D', sd: true, cierre: null };
  const v = metrica === 'mm3' ? c.almMm3 : metrica === 'pct' ? c.pctNamo : c.elevMsnm;
  if (v == null) return { texto: 'S/D', sd: true, cierre: c };
  const d = metrica === 'mm3' ? (v >= 100 ? 0 : 1) : metrica === 'pct' ? 1 : 2;
  const s = v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
  return { texto: metrica === 'pct' ? `${s} %` : s, sd: false, cierre: c };
}

export function indexarCierres(cierres: CierreMensual[]): Map<string, CierreMensual> {
  return new Map(cierres.map((c) => [`${c.cuerpoId}|${c.mes}`, c]));
}

export interface CoberturaCuerpo { total: number; conDato: number; sd: number; difiere: number; repetido: number; desfasado: number; porFuente: Record<FuenteAlm, number> }

export function coberturaDeCuerpo(cierres: CierreMensual[]): CoberturaCuerpo {
  const r: CoberturaCuerpo = { total: cierres.length, conDato: 0, sd: 0, difiere: 0, repetido: 0, desfasado: 0, porFuente: { SRL: 0, SINA: 0, AQWP: 0 } };
  for (const c of cierres) {
    if (c.almMm3 == null) r.sd++; else r.conDato++;
    if (c.calidad === 'DIFIERE') r.difiere++;
    if (c.calidad === 'REPETIDO') r.repetido++;
    if (c.calidad === 'DESFASADO') r.desfasado++;
    if (c.fuenteAlm) r.porFuente[c.fuenteAlm]++;
  }
  return r;
}

/** Último cierre con dato de un cuerpo (para rotular «último dato: abr 2025»). */
export function ultimoCierreConDato(cierres: CierreMensual[]): CierreMensual | null {
  const con = cierres.filter((c) => c.almMm3 != null).sort((a, b) => a.mes.localeCompare(b.mes));
  return con.length ? con[con.length - 1] : null;
}

/** Marca de orden de bytes: Excel la necesita para abrir el CSV como UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const csvCelda = (v: string | number | null): string => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV de los cierres (UTF-8 con BOM para Excel). S/D = celda vacía, nunca 0; la columna calidad dice SD. */
export function csvCierres(cuerpos: CuerpoAgua[], cierres: CierreMensual[]): string {
  const por = new Map(cuerpos.map((c) => [c.id, c]));
  const cab = ['cuerpo_id', 'cuerpo', 'mes', 'fecha_cierre', 'fecha_dato', 'almacenamiento_mm3', 'elevacion_msnm', 'pct_namo', 'namo_ref_mm3', 'fuente', 'calidad', 'srl_mm3', 'sina_mm3', 'aqwp_mm3', 'dif_max_fuentes_mm3', 'area_satelital_km2'];
  const filas = [...cierres].sort((a, b) => (por.get(a.cuerpoId)?.ordenRed ?? 0) - (por.get(b.cuerpoId)?.ordenRed ?? 0) || a.mes.localeCompare(b.mes)).map((c) => [
    c.cuerpoId, por.get(c.cuerpoId)?.etiqueta ?? c.cuerpoId, c.mes.slice(0, 7), c.fechaCierre, c.fechaDato, c.almMm3, c.elevMsnm, c.pctNamo, c.namoRefMm3, c.fuenteAlm, c.calidad,
    c.detalle.srl?.almacenamiento ?? null, c.detalle.sina?.almacenamiento ?? null, c.detalle.aqwp?.almacenamiento ?? null, c.difMaxMm3, c.areaSatKm2,
  ].map(csvCelda).join(','));
  return `${BOM}${cab.join(',')}\n${filas.join('\n')}\n`;
}

// ── Red río–presa ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface NodoRed { cuerpo: CuerpoAgua; /** 0 = descarga a la salida de la cuenca; crece hacia aguas arriba. */ nivel: number; hijos: string[] }

/** Distancia (en saltos) de cada cuerpo a la salida de la cuenca. Protege contra ciclos. */
export function construirRed(cuerpos: CuerpoAgua[]): NodoRed[] {
  const por = new Map(cuerpos.map((c) => [c.id, c]));
  const hijos = new Map<string, string[]>();
  for (const c of cuerpos) if (c.aguasAbajoId && por.has(c.aguasAbajoId)) hijos.set(c.aguasAbajoId, [...(hijos.get(c.aguasAbajoId) ?? []), c.id]);
  const nivelDe = (c: CuerpoAgua): number => {
    let n = 0, cur: CuerpoAgua | undefined = c;
    const visto = new Set<string>();
    while (cur?.aguasAbajoId && por.has(cur.aguasAbajoId) && !visto.has(cur.id)) { visto.add(cur.id); cur = por.get(cur.aguasAbajoId); n++; }
    return n;
  };
  return ordenarCuerpos(cuerpos).map((c) => ({ cuerpo: c, nivel: nivelDe(c), hijos: (hijos.get(c.id) ?? []).sort() }));
}

// ── Geometría para dibujar vasos ────────────────────────────────────────────────────────────────────────────────────
export type Par = [number, number];

/** Anillos de un GeoJSON Polygon / MultiPolygon (exterior primero, huecos después). */
export function anillosDeGeojson(g: unknown): Par[][] {
  const geo = g as { type?: string; coordinates?: unknown } | null;
  if (!geo || !Array.isArray(geo.coordinates)) return [];
  if (geo.type === 'Polygon') return (geo.coordinates as Par[][]).filter((a) => Array.isArray(a) && a.length >= 4);
  if (geo.type === 'MultiPolygon') return (geo.coordinates as Par[][][]).flat().filter((a) => Array.isArray(a) && a.length >= 4);
  return [];
}

export interface Proyeccion { ancho: number; alto: number; x: (lon: number) => number; y: (lat: number) => number; /** metros por unidad de pantalla */ mPorPx: number }

/** Proyección equirectangular local que cabe en ancho×alto con margen `pad`, conservando la proporción real. */
export function proyeccionPara(anillos: Par[][], ancho: number, alto: number, pad = 6): Proyeccion | null {
  const pts = anillos.flat();
  if (!pts.length) return null;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const lat0 = (s + n) / 2, kx = Math.cos((lat0 * Math.PI) / 180);
  const dx = Math.max((e - w) * kx, 1e-9), dy = Math.max(n - s, 1e-9);
  const esc = Math.min((ancho - 2 * pad) / dx, (alto - 2 * pad) / dy);
  const ox = pad + ((ancho - 2 * pad) - dx * esc) / 2, oy = pad + ((alto - 2 * pad) - dy * esc) / 2;
  return { ancho, alto, x: (lon) => ox + (lon - w) * kx * esc, y: (lat) => oy + (n - lat) * esc, mPorPx: 111_320 / esc };
}

/** Ruta SVG de varios anillos (relleno par-impar: los huecos quedan abiertos). */
export function rutaDeAnillos(anillos: Par[][], p: Proyeccion): string {
  return anillos.map((a) => `M${a.map(([lon, lat]) => `${p.x(lon).toFixed(1)},${p.y(lat).toFixed(1)}`).join('L')}Z`).join(' ');
}

/** Longitud «redonda» (1, 2, 5 × 10ⁿ m) para la barra de escala. */
export function longitudEscala(mPorPx: number, pxObjetivo = 70): { metros: number; px: number; etiqueta: string } {
  const bruto = mPorPx * pxObjetivo;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const m = [1, 2, 5, 10].map((k) => k * pot).reduce((a, b) => (Math.abs(b - bruto) < Math.abs(a - bruto) ? b : a));
  return { metros: m, px: m / mPorPx, etiqueta: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

// ── Balance ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Últimos `n` meses del balance de un cuerpo, en orden cronológico. */
export function serieBalance(balances: BalanceMensual[], cuerpoId: string, n: number): BalanceMensual[] {
  return balances.filter((b) => b.cuerpoId === cuerpoId).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-n);
}

/** Resumen del residuo de una serie: media sobre meses OK y % de las entradas. null si no hay meses OK. */
export function resumenResiduo(serie: BalanceMensual[]): { nMeses: number; mediaMm3: number; pctEntradas: number | null } | null {
  const ok = serie.filter((b) => b.calidad === 'OK' && b.residuo != null);
  if (!ok.length) return null;
  const suma = ok.reduce((t, b) => t + (b.residuo as number), 0);
  const ent = ok.reduce((t, b) => t + (b.entradas ?? 0), 0);
  return { nMeses: ok.length, mediaMm3: suma / ok.length, pctEntradas: ent > 0 ? (suma / ent) * 100 : null };
}

// ── Variación en el ciclo agrícola ──────────────────────────────────────────────────────────────────────────────────
export interface VariacionCiclo {
  cuerpo: CuerpoAgua;
  /** Cierre del 30 de septiembre (inicio del ciclo agrícola). */
  inicio: CierreMensual | null;
  /** Último cierre con dato posterior al inicio; null si el ciclo acaba de empezar o el cuerpo no tiene dato nuevo (S/D). */
  actual: CierreMensual | null;
  /** Cambio en puntos porcentuales del NAMO declarado; null si falta alguno de los dos extremos. */
  deltaPct: number | null;
  deltaMm3: number | null;
}

/** Cambio de cada cuerpo de agua desde el inicio del ciclo (1-oct del año `anioCiclo`) hasta su último cierre con dato. */
export function variacionEnCiclo(cuerpos: CuerpoAgua[], cierres: CierreMensual[], anioCiclo: number): VariacionCiclo[] {
  const mesInicio = `${anioCiclo}-09-01`;
  return ordenarCuerpos(cuerpos).map((cuerpo) => {
    const propios = cierres.filter((c) => c.cuerpoId === cuerpo.id);
    const ini = propios.find((c) => c.mes === mesInicio && c.almMm3 != null) ?? null;
    const ult = ultimoCierreConDato(propios);
    const actual = ult && ult.mes > mesInicio ? ult : null;
    const ok = ini != null && actual != null;
    return {
      cuerpo, inicio: ini, actual,
      deltaPct: ok && ini.pctNamo != null && actual.pctNamo != null ? actual.pctNamo - ini.pctNamo : null,
      deltaMm3: ok && ini.almMm3 != null && actual.almMm3 != null ? actual.almMm3 - ini.almMm3 : null,
    };
  });
}
