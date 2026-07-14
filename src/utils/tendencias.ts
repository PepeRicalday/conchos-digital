// ── Análisis de tendencias por periodo (pestaña TENDENCIAS del Monitor Público) ──
// Reconstruye series históricas de niveles, volumen por tramo, diferenciales de
// compuerta y trayectoria del gasto a partir de las tablas Supabase.
//
// NOTA CLAVE: vol_interescalas es un SNAPSHOT sin fecha. Para el volumen histórico
// por tramo NO hay registro día-a-día, así que se RECONSTRUYE aquí: por cada día
// se toma el nivel de las dos escalas frontera del tramo y se calcula el volumen
// prismático con la geometría (longitud, ancho) que sí trae el snapshot.

export type Granularidad = 'diaria' | 'lectura';

export interface LecturaEscala {
  escala_id: string;
  fecha: string;              // YYYY-MM-DD
  hora_lectura: string | null;
  nivel_m: number | null;
  nivel_abajo_m: number | null;
  gasto_calculado_m3s: number | null;
  gasto_metodo: string | null;
  radiales_json: unknown;
  creado_en: string;
}

export interface ResumenDiario {
  escala_id: string;
  fecha: string;
  nivel_am: number | null;
  nivel_pm: number | null;
  nivel_actual: number | null;
}

export interface EscalaGeom {
  id: string;
  nombre: string;
  km: number;
  nivel_max_operativo?: number | null;
}

export interface TramoGeom {
  esc_up_id: string;
  esc_up: string;
  km_up: number;
  esc_down_id: string;
  esc_down: string;
  km_down: number;
  longitud_km: number;
  ancho_canal_m: number;
  // Calibración contra el snapshot vol_interescalas (sección real del canal):
  // volumen actual de la BD y los niveles con los que se calculó. Permiten
  // derivar un factor k por tramo que corrige el sesgo del prisma rectangular.
  vol_m3?: number | null;
  nivel_up_m?: number | null;
  nivel_down_m?: number | null;
}

export interface EntregaModulo {
  modulo_id: string;
  zona_id: string | null;
  tipo_entrega: string;
  gasto_m3s: number | null;
  fecha: string;
}

// Punto genérico de una serie temporal
export interface SeriePunto { t: number; y: number | null; }
export interface SerieEscala { escala_id: string; nombre: string; km: number; nivelMax?: number | null; puntos: SeriePunto[]; }

const tsOf = (fecha: string, hora?: string | null): number =>
  new Date(`${fecha}T${(hora || '12:00:00').slice(0, 8)}-06:00`).getTime();

// ── Bloque 1: tendencia de niveles por escala ───────────────────────────────
export function serieNivelesDiaria(
  resumen: ResumenDiario[], escalas: EscalaGeom[]
): SerieEscala[] {
  const byEsc = new Map<string, ResumenDiario[]>();
  for (const r of resumen) {
    if (!byEsc.has(r.escala_id)) byEsc.set(r.escala_id, []);
    byEsc.get(r.escala_id)!.push(r);
  }
  return escalas.map(e => {
    const rows = (byEsc.get(e.id) || []).sort((a, b) => a.fecha.localeCompare(b.fecha));
    const puntos: SeriePunto[] = rows.map(r => ({
      t: tsOf(r.fecha),
      // nivel del día: preferimos pm, luego am, luego nivel_actual
      y: r.nivel_pm ?? r.nivel_am ?? r.nivel_actual ?? null,
    }));
    return { escala_id: e.id, nombre: e.nombre, km: e.km, nivelMax: e.nivel_max_operativo, puntos };
  }).filter(s => s.puntos.some(p => p.y != null));
}

export function serieNivelesLectura(
  lecturas: LecturaEscala[], escalas: EscalaGeom[]
): SerieEscala[] {
  const byEsc = new Map<string, LecturaEscala[]>();
  for (const l of lecturas) {
    if (!byEsc.has(l.escala_id)) byEsc.set(l.escala_id, []);
    byEsc.get(l.escala_id)!.push(l);
  }
  return escalas.map(e => {
    const rows = (byEsc.get(e.id) || []).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const puntos: SeriePunto[] = rows.map(l => ({ t: tsOf(l.fecha, l.hora_lectura), y: l.nivel_m }));
    return { escala_id: e.id, nombre: e.nombre, km: e.km, nivelMax: e.nivel_max_operativo, puntos };
  }).filter(s => s.puntos.some(p => p.y != null));
}

// ── Bloque 2: volumen por tramo (RECONSTRUIDO) ──────────────────────────────
// Volumen de un tramo entre dos escalas: L · A_media, donde A es el área de la
// SECCIÓN TRAPEZOIDAL real del canal (revestido) al tirante medio de las dos
// escalas frontera. Sección trapezoidal: A = (b + z·h)·h, con b=plantilla y
// z=talud (mismo criterio que manningFlow en hydraulics.ts y las curvas de aforo).
// Fallback: si el tramo no tiene geometría trapezoidal en perfil_hidraulico_canal,
// se cae al prisma rectangular L·ancho·h calibrado por k (comportamiento previo).

// Geometría trapezoidal de un tramo del canal (de perfil_hidraulico_canal).
export interface PerfilGeom {
  km_inicio: number; km_fin: number;
  plantilla_m: number;          // b — base menor (fondo)
  talud_z: number;              // z — talud lateral (H:V)
  tirante_diseno_m?: number | null;   // tirante de diseño, para % de llenado
}

// Estado de llenado de un tramo en la última fecha con dato (para P2/P3 y modal).
export interface EstadoTramo {
  tiranteActual: number | null;   // tirante medio (m) más reciente
  pctDiseno: number | null;       // % del tirante de diseño (null si no hay diseño)
  plantilla: number;              // b usada (m)
  talud: number;                  // z usado
  tiranteDiseno: number | null;
  esTrapezoidal: boolean;         // true = geometría real; false = fallback rectangular
  longitudKm: number;             // longitud del tramo (km)
  nivelUpActual: number | null;   // nivel última fecha en la escala aguas arriba
  nivelDownActual: number | null; // nivel última fecha en la escala aguas abajo
}

export interface SerieTramo {
  key: string; etiqueta: string; km_up: number; km_down: number;
  puntos: SeriePunto[];
  estado: EstadoTramo;            // llenado actual del tramo
}

// Área de sección trapezoidal a un tirante h: A = (b + z·h)·h.
function areaTrapecio(plantilla_m: number, talud_z: number, h: number): number {
  const y = Math.max(0, h);
  return (plantilla_m + talud_z * y) * y;
}

// Volumen prismático rectangular (fallback): L·b·h_medio.
function volTramoRectM3(longitud_km: number, ancho_m: number, nivelUp: number, nivelDown: number): number {
  const L = longitud_km * 1000;
  const hMedio = (nivelUp + nivelDown) / 2;
  return L * ancho_m * Math.max(0, hMedio);
}

// Empareja un tramo (km_up→km_down) con el perfil que cubre su punto medio.
function perfilDeTramo(tr: TramoGeom, perfiles: PerfilGeom[]): PerfilGeom | null {
  if (!perfiles.length) return null;
  const kmMedio = (tr.km_up + tr.km_down) / 2;
  return perfiles.find(p => p.km_inicio <= kmMedio && p.km_fin >= kmMedio)
      ?? perfiles.find(p => p.km_inicio <= tr.km_up && p.km_fin >= tr.km_up)
      ?? null;
}

export function serieVolumenTramos(
  tramos: TramoGeom[],
  nivelesPorEscalaFecha: Map<string, Map<string, number>>, // escala_id -> (fecha -> nivel)
  fechas: string[],
  perfiles: PerfilGeom[] = []
): { series: SerieTramo[]; totalPorFecha: SeriePunto[] } {
  const series: SerieTramo[] = tramos.map(tr => {
    const perfil = perfilDeTramo(tr, perfiles);
    const usaTrapecio = perfil != null && perfil.plantilla_m > 0 && perfil.talud_z >= 0;
    const b = perfil?.plantilla_m ?? 0;
    const z = perfil?.talud_z ?? 0;
    const L = tr.longitud_km * 1000;

    // Factor de calibración k SOLO para el fallback rectangular: hace que la
    // reconstrucción reproduzca EXACTO el volumen del snapshot a los niveles del
    // snapshot. Con geometría trapezoidal real no hace falta (k=1).
    let k = 1;
    if (!usaTrapecio && tr.vol_m3 != null && tr.vol_m3 > 0 && tr.nivel_up_m != null && tr.nivel_down_m != null) {
      const prismaSnap = volTramoRectM3(tr.longitud_km, tr.ancho_canal_m || 8, tr.nivel_up_m, tr.nivel_down_m);
      if (prismaSnap > 0) k = tr.vol_m3 / prismaSnap;
    }

    const volM3 = (nUp: number, nDn: number): number => {
      if (usaTrapecio) {
        const hMedio = Math.max(0, (nUp + nDn) / 2);
        return L * areaTrapecio(b, z, hMedio);
      }
      return volTramoRectM3(tr.longitud_km, tr.ancho_canal_m || 8, nUp, nDn) * k;
    };

    const puntos: SeriePunto[] = fechas.map(f => {
      const nUp = nivelesPorEscalaFecha.get(tr.esc_up_id)?.get(f);
      const nDn = nivelesPorEscalaFecha.get(tr.esc_down_id)?.get(f);
      if (nUp == null || nDn == null) return { t: tsOf(f), y: null };
      return { t: tsOf(f), y: +(volM3(nUp, nDn) / 1e6).toFixed(4) };
    });

    // Estado de llenado: tirante medio de la última fecha con ambos niveles.
    let tiranteActual: number | null = null;
    let nivelUpActual: number | null = null, nivelDownActual: number | null = null;
    for (let i = fechas.length - 1; i >= 0; i--) {
      const nUp = nivelesPorEscalaFecha.get(tr.esc_up_id)?.get(fechas[i]);
      const nDn = nivelesPorEscalaFecha.get(tr.esc_down_id)?.get(fechas[i]);
      if (nUp != null && nDn != null) {
        tiranteActual = +((nUp + nDn) / 2).toFixed(3);
        nivelUpActual = +nUp.toFixed(3); nivelDownActual = +nDn.toFixed(3);
        break;
      }
    }
    const tiranteDiseno = perfil?.tirante_diseno_m ?? null;
    const pctDiseno = tiranteActual != null && tiranteDiseno != null && tiranteDiseno > 0
      ? +((tiranteActual / tiranteDiseno) * 100).toFixed(1) : null;

    return {
      key: `${tr.esc_up_id}_${tr.esc_down_id}`, etiqueta: `${tr.esc_up}→${tr.esc_down}`,
      km_up: tr.km_up, km_down: tr.km_down, puntos,
      estado: {
        tiranteActual, pctDiseno,
        plantilla: usaTrapecio ? b : (tr.ancho_canal_m || 8),
        talud: usaTrapecio ? z : 0,
        tiranteDiseno, esTrapezoidal: usaTrapecio,
        longitudKm: tr.longitud_km,
        nivelUpActual, nivelDownActual,
      },
    };
  });
  const totalPorFecha: SeriePunto[] = fechas.map((f, i) => {
    const suma = series.reduce((s, se) => s + (se.puntos[i].y ?? 0), 0);
    const algun = series.some(se => se.puntos[i].y != null);
    return { t: tsOf(f), y: algun ? +suma.toFixed(4) : null };
  });
  return { series, totalPorFecha };
}

// Construye el índice escala_id -> (fecha -> nivel) desde el resumen diario.
export function indiceNivelesDiario(resumen: ResumenDiario[]): { idx: Map<string, Map<string, number>>; fechas: string[] } {
  const idx = new Map<string, Map<string, number>>();
  const fechasSet = new Set<string>();
  for (const r of resumen) {
    const nivel = r.nivel_pm ?? r.nivel_am ?? r.nivel_actual;
    if (nivel == null) continue;
    if (!idx.has(r.escala_id)) idx.set(r.escala_id, new Map());
    idx.get(r.escala_id)!.set(r.fecha, nivel);
    fechasSet.add(r.fecha);
  }
  return { idx, fechas: [...fechasSet].sort() };
}

// ── Bloque 3: niveles arriba / abajo por compuerta ──────────────────────────
export interface SerieCompuerta {
  escala_id: string; nombre: string; km: number;
  arriba: SeriePunto[];      // nivel_m
  abajo: SeriePunto[];       // nivel_abajo_m
  diferencial: SeriePunto[]; // arriba - abajo
  aperturaUlt: number | null;      // apertura total última (m)
  puertasAbiertas: number | null;
}

export function aperturaTotal(radiales_json: unknown): { total: number; abiertas: number } | null {
  if (!Array.isArray(radiales_json) || !radiales_json.length) return null;
  let total = 0, abiertas = 0;
  for (const v of radiales_json) {
    const ap = typeof v === 'object' && v ? Number((v as { apertura_m?: number }).apertura_m || 0) : parseFloat(String(v)) || 0;
    total += ap;
    if (ap > 0) abiertas++;
  }
  return { total, abiertas };
}

export function serieCompuertas(lecturas: LecturaEscala[], escalas: EscalaGeom[]): SerieCompuerta[] {
  const byEsc = new Map<string, LecturaEscala[]>();
  for (const l of lecturas) {
    if (!byEsc.has(l.escala_id)) byEsc.set(l.escala_id, []);
    byEsc.get(l.escala_id)!.push(l);
  }
  return escalas.map(e => {
    const rows = (byEsc.get(e.id) || []).sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const arriba: SeriePunto[] = [], abajo: SeriePunto[] = [], diferencial: SeriePunto[] = [];
    for (const l of rows) {
      const t = tsOf(l.fecha, l.hora_lectura);
      arriba.push({ t, y: l.nivel_m });
      abajo.push({ t, y: l.nivel_abajo_m });
      // Diferencial solo cuando AMBOS niveles son reales (>0). nivel_abajo=0 suele ser
      // "no medido" en escalas de referencia sin control (K-64, K-94+200); tratarlo
      // como null evita un diferencial artificial (p.ej. 3.16 - 0 = 3.16).
      const dif = (l.nivel_m != null && l.nivel_m > 0 && l.nivel_abajo_m != null && l.nivel_abajo_m > 0)
        ? +(l.nivel_m - l.nivel_abajo_m).toFixed(3) : null;
      diferencial.push({ t, y: dif });
    }
    const ult = rows.length ? aperturaTotal(rows[rows.length - 1].radiales_json) : null;
    return {
      escala_id: e.id, nombre: e.nombre, km: e.km, arriba, abajo, diferencial,
      aperturaUlt: ult ? +ult.total.toFixed(2) : null,
      puertasAbiertas: ult ? ult.abiertas : null,
    };
  }).filter(s => s.arriba.some(p => p.y != null) || s.abajo.some(p => p.y != null));
}

// ── Bloque 4: gasto K-0 → entregas módulos → K-104 ──────────────────────────
export interface SerieGasto {
  entrada: SeriePunto[];     // K-0 gasto
  salida: SeriePunto[];      // K-104 gasto
  entregas: SeriePunto[];    // suma entregas por fecha
  perdidas: SeriePunto[];    // entrada - salida - entregas (cuando los 3 existen)
}

// gasto diario por km objetivo (0 ó 104): usa la última lectura del día
function gastoDiarioPorKm(lecturas: LecturaEscala[], escalas: EscalaGeom[], kmObjetivo: number): Map<string, number> {
  const escId = escalas.find(e => Math.abs(e.km - kmObjetivo) < 0.5)?.id;
  const out = new Map<string, number>();
  if (!escId) return out;
  for (const l of lecturas) {
    if (l.escala_id !== escId || l.gasto_calculado_m3s == null) continue;
    // conserva la lectura más tardía del día
    out.set(l.fecha, l.gasto_calculado_m3s);
  }
  return out;
}

export function serieGasto(
  lecturas: LecturaEscala[], escalas: EscalaGeom[], entregas: EntregaModulo[], fechas: string[]
): SerieGasto {
  const qEntrada = gastoDiarioPorKm(lecturas, escalas, 0);
  const qSalida = gastoDiarioPorKm(lecturas, escalas, 104);
  // entregas: dedup por modulo+zona+tipo y por fecha, sumar gasto
  const entregasPorFecha = new Map<string, number>();
  const seen = new Set<string>();
  for (const e of entregas) {
    const k = `${e.fecha}_${e.modulo_id}_${e.zona_id ?? ''}_${e.tipo_entrega}`;
    if (seen.has(k)) continue;
    seen.add(k);
    entregasPorFecha.set(e.fecha, (entregasPorFecha.get(e.fecha) ?? 0) + Number(e.gasto_m3s ?? 0));
  }
  const mk = (m: Map<string, number>) => fechas.map(f => ({ t: tsOf(f), y: m.has(f) ? +m.get(f)!.toFixed(3) : null }));
  const entrada = mk(qEntrada), salida = mk(qSalida), entregasS = mk(entregasPorFecha);
  const perdidas: SeriePunto[] = fechas.map((f, i) => {
    const qe = entrada[i].y, qs = salida[i].y, qz = entregasS[i].y;
    if (qe == null || qs == null || qz == null) return { t: tsOf(f), y: null };
    return { t: tsOf(f), y: +(qe - qs - qz).toFixed(3) };
  });
  return { entrada, salida, entregas: entregasS, perdidas };
}

// Estadística de una serie (min/max/promedio/delta) — para tablas resumen
export function statsSerie(puntos: SeriePunto[]): { min: number | null; max: number | null; avg: number | null; delta: number | null; n: number } {
  const ys = puntos.map(p => p.y).filter((v): v is number => v != null);
  if (!ys.length) return { min: null, max: null, avg: null, delta: null, n: 0 };
  const min = Math.min(...ys), max = Math.max(...ys);
  const avg = ys.reduce((s, v) => s + v, 0) / ys.length;
  const delta = ys[ys.length - 1] - ys[0];
  return { min, max, avg: +avg.toFixed(3), delta: +delta.toFixed(3), n: ys.length };
}
