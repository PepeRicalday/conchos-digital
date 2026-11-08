/**
 * aqwpCuenca — lógica PURA de la vista "Cuenca del Conchos" (datos USIBWC AQUARIUS vía aqwp-sync).
 * Sin React ni Supabase. Fuente TERCERA y solo contexto: no sustituye la captura de campo ni CILA.
 * Reglas: S/D nunca es 0 (null); una serie "estancada" sin contraste se trata como S/D (las del distrito se contrastan contra CILA y no se excluyen); el % y el agregado salen de
 * presaMetrics (fuente única), usando como capacidad el NAMO que publica CONAGUA en el portal.
 */
import { agregarAlmacenamiento, calcularFrescura, porcentajeLlenadoPresa, type AlmacenamientoAgregado, type Frescura } from './presaMetrics';
import { estadoEmbalse, type EstadoEmbalse } from './presaNiveles';

/** Orden de presentación: primero las del distrito (PRE-001/002), luego aguas arriba → abajo en la cuenca. */
export const ORDEN_PRESAS_CUENCA = [536, 537, 541, 540, 526, 538, 539] as const;
export const UBICACION_OJINAGA = 230;

/** Paleta categórica (7 presas) legible sobre fondo oscuro; el rojo/verde se reservan al estado. */
export const COLOR_PRESA_CUENCA: Record<number, string> = {
  536: '#3FB2F3', 537: '#a78bfa', 541: '#34d399', 540: '#f472b6', 526: '#fbbf24', 538: '#fb923c', 539: '#94a3b8',
};

export interface EstadoUbicacion {
  ubicacionId: number;
  codigo: string;
  nombre: string;
  tipo: string;
  presaId: string | null;
  fecha: string | null;
  almacenamientoMm3: number | null;
  estancado: boolean;
  namoMm3: number | null;
  muertoMm3: number | null;
  pctNamo: number | null;
  aportacionM3s: number | null;
  extraccionTotalM3s: number | null;
  vertidoM3s: number | null;
  gastoM3s: number | null;
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Fila de la vista v_aqwp_presas_estado → tipo de la app (numeric puede llegar como string). */
export function normalizarEstado(r: Record<string, unknown>): EstadoUbicacion {
  return {
    ubicacionId: Number(r.ubicacion_id), codigo: String(r.codigo ?? ''), nombre: String(r.nombre ?? ''),
    tipo: String(r.tipo ?? ''), presaId: (r.presa_id as string | null) ?? null, fecha: (r.fecha as string | null) ?? null,
    almacenamientoMm3: num(r.almacenamiento_mm3), estancado: r.almacenamiento_estancado === true,
    namoMm3: num(r.namo_mm3), muertoMm3: num(r.muerto_mm3), pctNamo: num(r.pct_namo),
    aportacionM3s: num(r.aportacion_m3s), extraccionTotalM3s: num(r.extraccion_total_m3s),
    vertidoM3s: num(r.vertido_m3s), gastoM3s: num(r.gasto_m3s),
  };
}

export interface FilaPresaCuenca extends EstadoUbicacion {
  delDistrito: boolean;
  /** Almacenamiento utilizable: null si no hay dato o si la serie está estancada y NO se puede contrastar (se muestra S/D). */
  almacenamientoValido: number | null;
  /** Estancada y sin contraste: se excluye de totales y se muestra S/D (p. ej. Chihuahua). */
  excluida: boolean;
  /**
   * Estancada pero de una presa del distrito (Boquilla/Madero): sí se usa, porque se contrasta contra CILA (en Madero
   * coincide exacto) y CONAGUA la actualiza por tramos de 8-16 días. Se muestra con una nota, no como S/D.
   */
  repetida: boolean;
  pct: number | null;
  estado: EstadoEmbalse;
  /** CONAGUA publica a diario: se marca viejo pasadas 48 h. */
  frescura: Frescura | null;
}

export function filasPresas(estados: EstadoUbicacion[]): FilaPresaCuenca[] {
  const porId = new Map(estados.map((e) => [e.ubicacionId, e]));
  return ORDEN_PRESAS_CUENCA.flatMap((id) => {
    const e = porId.get(id);
    if (!e) return [];
    const delDistrito = e.presaId != null;
    const excluida = e.estancado && !delDistrito;
    const valido = excluida ? null : e.almacenamientoMm3;
    const pct = porcentajeLlenadoPresa({
      capacidad_max_mm3: e.namoMm3 ?? 0,
      lectura: { almacenamiento_mm3: valido, porcentaje_llenado: excluida ? null : e.pctNamo },
    });
    return [{
      ...e, delDistrito, almacenamientoValido: valido, pct, excluida, repetida: e.estancado && delDistrito,
      estado: estadoEmbalse(pct), frescura: calcularFrescura(e.fecha, 48),
    }];
  });
}

/** Almacenamiento agregado de la cuenca: excluye presas sin dato o estancadas (nunca las cuenta como 0). */
export function agregadoCuenca(filas: FilaPresaCuenca[]): AlmacenamientoAgregado {
  return agregarAlmacenamiento(filas.map((f) => ({
    capacidad_max_mm3: f.namoMm3 ?? 0,
    lectura: { almacenamiento_mm3: f.almacenamientoValido },
  })));
}

/** Suma de aportaciones de las presas con dato (m³/s). null si ninguna tiene. */
export function aportacionTotal(filas: FilaPresaCuenca[]): { total: number | null; conDato: number } {
  const v = filas.map((f) => f.aportacionM3s).filter((x): x is number => x != null);
  return { total: v.length ? v.reduce((a, b) => a + b, 0) : null, conDato: v.length };
}

// ── Serie de llenado (% del NAMO) para la gráfica ─────────────────────────────
export interface LecturaDiariaAqwp { datasetId: number; fecha: string; valor: number | null; estancada: boolean }
export type FilaGrafica = { fecha: string } & Record<string, number | string | null>;

/** Clave de la columna con los días de serie estancada (valor repetido) de una presa: se dibuja punteada, no se oculta. */
export const claveEstancada = (ubicacionId: number | string): string => `${ubicacionId}_e`;

/**
 * Una fila por fecha, una columna por presa (clave = id de ubicación): almacenamiento / NAMO × 100.
 * Sin valor o sin NAMO → null (la línea se corta; nunca se interpola ni se pone 0).
 * Estancada → la columna normal queda null y el valor va a `claveEstancada(id)`: así la gráfica puede mostrarlo
 * punteado y marcado como dudoso en vez de esconder tramos que pueden ser reales (p. ej. Madero se actualiza por escalones).
 */
export function serieLlenado(
  lecturas: LecturaDiariaAqwp[],
  ubicacionDeDataset: Map<number, number>,
  namoPorUbicacion: Map<number, number | null>,
): FilaGrafica[] {
  const porFecha = new Map<string, FilaGrafica>();
  for (const l of lecturas) {
    const ubic = ubicacionDeDataset.get(l.datasetId);
    if (ubic == null) continue;
    const fila = porFecha.get(l.fecha) ?? ({ fecha: l.fecha } as FilaGrafica);
    const namo = namoPorUbicacion.get(ubic);
    const pct = l.valor == null || !namo || namo <= 0 ? null : Math.round((l.valor / namo) * 10000) / 100;
    fila[String(ubic)] = l.estancada ? null : pct;
    if (l.estancada && pct != null) fila[claveEstancada(ubic)] = pct;
    porFecha.set(l.fecha, fila);
  }
  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Fecha ISO (YYYY-MM-DD) de hace `dias` días, sobre una fecha base ISO. Sin zona horaria: calendario puro. */
export function restarDias(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10);
}

// ── Lluvia GOES (mm por día, derivada del acumulado del pluviómetro) ─────────
/** Aguas arriba → abajo: Villalba (Río San Pedro), Luis L. León, bajo Luis L. León. */
export const UBICACIONES_LLUVIA = [551, 526, 549] as const;
export const COLOR_LLUVIA: Record<number, string> = { 551: '#3FB2F3', 526: '#fbbf24', 549: '#f472b6' };
export const NOMBRE_LLUVIA: Record<number, string> = { 551: 'Villalba', 526: 'Luis L. León', 549: 'Bajo Luis L. León' };
/** Día con lluvia fuerte para resaltar la celda (la cifra siempre se muestra: el color no es el único canal). */
export const LLUVIA_FUERTE_MM = 10;

export interface FilaLluvia {
  ubicacionId: number;
  nombre: string;
  /** mm por cada fecha de `fechas`; null = S/D (sin cobertura), 0 = día seco medido. */
  dias: (number | null)[];
  total7: TotalLluvia;
  total30: TotalLluvia;
}
export interface TotalLluvia {
  /** Suma de los días con dato; null si ninguno tiene (S/D, nunca 0). */
  mm: number | null;
  /** Días con dato sobre los de la ventana: si hay menos, el total es parcial. */
  conDato: number;
  ventana: number;
}
export interface ResumenLluvia {
  /** Últimos 7 días terminando en `hasta` (ISO), de más viejo a más reciente. */
  fechas: string[];
  hasta: string | null;
  filas: FilaLluvia[];
  /** 30 días para la gráfica: una columna por pluviómetro (clave = id de ubicación). */
  serie30: FilaGrafica[];
}

const totalVentana = (valores: (number | null)[]): TotalLluvia => {
  const v = valores.filter((x): x is number => x != null);
  return { mm: v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 10) / 10 : null, conDato: v.length, ventana: valores.length };
};

/**
 * Resume la lluvia diaria de los pluviómetros. La ventana termina en el último día con dato de cualquiera de ellos
 * (no en el reloj), para que un atraso del portal no deje la tabla vacía; los pluviómetros sin ese día salen S/D.
 */
export function resumenLluvia(
  lecturas: LecturaDiariaAqwp[],
  ubicacionDeDataset: Map<number, number>,
): ResumenLluvia {
  const porUbic = new Map<number, Map<string, number | null>>();
  let hasta: string | null = null;
  for (const l of lecturas) {
    const u = ubicacionDeDataset.get(l.datasetId);
    if (u == null) continue;
    (porUbic.get(u) ?? porUbic.set(u, new Map()).get(u)!).set(l.fecha, l.valor);
    if (l.valor != null && (hasta == null || l.fecha > hasta)) hasta = l.fecha;
  }
  if (hasta == null) return { fechas: [], hasta: null, filas: [], serie30: [] };

  const rango = (n: number) => Array.from({ length: n }, (_, i) => restarDias(hasta!, n - 1 - i));
  const f7 = rango(7), f30 = rango(30);
  const filas: FilaLluvia[] = UBICACIONES_LLUVIA.filter((id) => porUbic.has(id)).map((id) => {
    const m = porUbic.get(id)!;
    const v = (f: string) => m.get(f) ?? null;
    return { ubicacionId: id, nombre: NOMBRE_LLUVIA[id], dias: f7.map(v), total7: totalVentana(f7.map(v)), total30: totalVentana(f30.map(v)) };
  });
  const serie30: FilaGrafica[] = f30.map((fecha) => {
    const fila: FilaGrafica = { fecha };
    for (const f of filas) fila[String(f.ubicacionId)] = porUbic.get(f.ubicacionId)!.get(fecha) ?? null;
    return fila;
  });
  return { fechas: f7, hasta, filas, serie30 };
}

// ── Resumen compacto (Dashboard): una línea de cuenca dentro de la tarjeta Presas ─────────────────────────────
/** Un pluviómetro cuenta en el promedio si tiene al menos 4 de los 7 días con dato (menos = S/D, no se promedia). */
export const MIN_DIAS_LLUVIA_7D = 4;

export interface CuencaCompacta {
  /** Suma del almacenamiento de las presas con dato vigente (excluye estancadas y sin dato). null si ninguna. */
  almacenadoMm3: number | null;
  /** % sobre el NAMO de CONAGUA de las presas contabilizadas. */
  pct: number | null;
  conDato: number;
  total: number;
  fecha: string | null;
  /** Presas estancadas SIN contraste, excluidas del total (las del distrito no se excluyen). */
  estancadas: number;
  frescura: Frescura | null;
  lluvia: {
    /** Promedio de lluvia a 7 días entre pluviómetros con cobertura suficiente; null = S/D. */
    promedio7Mm: number | null;
    pluviometros: number;
    total: number;
    maxNombre: string | null;
    maxMm: number | null;
    hasta: string | null;
  };
}

export function cuencaCompacta(estados: EstadoUbicacion[], lluvia: ResumenLluvia): CuencaCompacta {
  const filas = filasPresas(estados);
  const ag = agregadoCuenca(filas);
  const fechas = filas.map((f) => f.fecha).filter((x): x is string => !!x).sort();
  const fecha = fechas.length ? fechas[fechas.length - 1] : null;
  const validos = lluvia.filas.filter((f) => f.total7.mm != null && f.total7.conDato >= MIN_DIAS_LLUVIA_7D);
  const maximo = validos.reduce<FilaLluvia | null>((m, f) => (m == null || (f.total7.mm as number) > (m.total7.mm as number) ? f : m), null);
  return {
    almacenadoMm3: ag.totalMm3, pct: ag.porcentaje, conDato: ag.presasConDato, total: ag.presasTotal,
    fecha, estancadas: filas.filter((f) => f.excluida).length, frescura: calcularFrescura(fecha, 48),
    lluvia: {
      promedio7Mm: validos.length ? Math.round((validos.reduce((a, f) => a + (f.total7.mm as number), 0) / validos.length) * 10) / 10 : null,
      pluviometros: validos.length, total: lluvia.filas.length,
      maxNombre: maximo?.nombre ?? null, maxMm: maximo ? (maximo.total7.mm as number) : null, hasta: lluvia.hasta,
    },
  };
}
