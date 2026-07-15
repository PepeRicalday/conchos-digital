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
export interface SeriePunto { t: number; y: number | null; est?: boolean; } // est=valor arrastrado (LOCF), no medido ese día
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
  bordo_libre_m?: number | null;      // bordo libre (freeboard) sobre el diseño → altura real del canal
}

// Estado de llenado de un tramo en la última fecha con dato (para P2/P3 y modal).
export interface EstadoTramo {
  tiranteActual: number | null;   // tirante medio (m) más reciente
  pctDiseno: number | null;       // % del tirante de diseño (null si no hay diseño)
  plantilla: number;              // b usada (m)
  talud: number;                  // z usado
  tiranteDiseno: number | null;
  bordoLibre: number | null;      // bordo libre de diseño (m)
  alturaCanal: number | null;     // altura real del canal = tirante diseño + bordo libre (m)
  pctBordo: number | null;        // % de la altura real del canal ocupado por el agua
  esTrapezoidal: boolean;         // true = geometría real; false = fallback rectangular
  anchoCorona: number | null;     // ancho de corona = espejo a la altura total (m)
  nSecciones: number;             // nº de geometrías reales distintas que cruza el tramo (>1 = compuesto)
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

// Empareja un tramo (km_up→km_down) con su geometría REPRESENTATIVA.
// Un tramo del panel (entre escalas) puede cruzar varias secciones-tipo del
// canal (el Canal Conchos cambia plantilla/talud/corona a lo largo). Elegir por
// el punto medio es arbitrario; en su lugar tomamos el perfil DOMINANTE: el que
// aporta MÁS longitud dentro del tramo. Devolvemos también cuántas geometrías
// distintas cruza, para etiquetar honestamente las secciones compuestas.
function perfilDeTramo(
  tr: TramoGeom, perfiles: PerfilGeom[]
): { perfil: PerfilGeom | null; nSecciones: number } {
  if (!perfiles.length) return { perfil: null, nSecciones: 0 };
  const a = Math.min(tr.km_up, tr.km_down), b = Math.max(tr.km_up, tr.km_down);
  // Solape (km) de cada perfil con el tramo.
  const solapes = perfiles
    .map(p => ({ p, ov: Math.max(0, Math.min(b, p.km_fin) - Math.max(a, p.km_inicio)) }))
    .filter(s => s.ov > 0);
  if (!solapes.length) {
    // Sin solape: cae al perfil que contiene el punto de inicio (o el más cercano).
    const kmMedio = (a + b) / 2;
    const p = perfiles.find(pp => pp.km_inicio <= kmMedio && pp.km_fin >= kmMedio)
           ?? perfiles.find(pp => pp.km_inicio <= a && pp.km_fin >= a) ?? null;
    return { perfil: p, nSecciones: p ? 1 : 0 };
  }
  // El perfil se almacena en filas cortas (p.ej. cada 2 km) que comparten la
  // MISMA geometría. Agrupamos por firma (b/z/tirante/bordo) y sumamos el solape
  // de cada geometría; la dominante es la de MAYOR longitud total dentro del
  // tramo (no la fila individual más larga). Empate → la de km_inicio menor.
  const firma = (p: PerfilGeom) =>
    `${p.plantilla_m}|${p.talud_z}|${p.tirante_diseno_m ?? ''}|${p.bordo_libre_m ?? ''}`;
  const porGeom = new Map<string, { p: PerfilGeom; ov: number; km0: number }>();
  for (const s of solapes) {
    const f = firma(s.p);
    const g = porGeom.get(f);
    if (g) { g.ov += s.ov; g.km0 = Math.min(g.km0, s.p.km_inicio); }
    else porGeom.set(f, { p: s.p, ov: s.ov, km0: s.p.km_inicio });
  }
  const geoms = [...porGeom.values()].sort((x, y) => y.ov - x.ov || x.km0 - y.km0);
  return { perfil: geoms[0].p, nSecciones: porGeom.size };
}

// Nivel de una escala en una fecha, distinguiendo las dos caras de su compuerta:
//   arriba = nivel_m (remanso AGUAS ARRIBA de la compuerta de esa escala)
//   abajo  = nivel_abajo_m (lámina AGUAS ABAJO, ya dentro del tramo siguiente)
export interface NivelUpDown { arriba: number | null; abajo: number | null; }

// Tirante REAL en cada frontera de un tramo (modelo hidráulico de compuertas):
// el tramo esc_up→esc_down es el prisma de agua ENTRE dos compuertas, así que
//   · frontera aguas arriba  = nivel ABAJO de esc_up (agua ya dentro del tramo)
//   · frontera aguas abajo   = nivel ARRIBA de esc_down (remanso contra su compuerta)
// Fallback: K-64 y K-94+200 son escalas de sólo referencia (sin compuerta de
// control); su nivel_abajo_m suele venir 0/null → se usa el nivel disponible
// (arriba) de esa misma escala como aproximación, por ser de pura referencia.
const nivelValido = (n: number | null | undefined): n is number => n != null && n > 0;
const tiranteFrontera = (nd: NivelUpDown | undefined, cara: 'up' | 'down'): number | null => {
  if (!nd) return null;
  if (cara === 'up') return nivelValido(nd.abajo) ? nd.abajo : (nivelValido(nd.arriba) ? nd.arriba : null);
  return nivelValido(nd.arriba) ? nd.arriba : (nivelValido(nd.abajo) ? nd.abajo : null);
};

export function serieVolumenTramos(
  tramos: TramoGeom[],
  nivelesPorEscalaFecha: Map<string, Map<string, NivelUpDown>>, // escala_id -> (fecha -> {arriba,abajo})
  fechas: string[],
  perfiles: PerfilGeom[] = []
): { series: SerieTramo[]; totalPorFecha: SeriePunto[] } {
  const series: SerieTramo[] = tramos.map(tr => {
    const { perfil, nSecciones } = perfilDeTramo(tr, perfiles);
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

    // Volumen diario del tramo con arrastre de última lectura (LOCF): si un día
    // no se aforó una frontera, se mantiene su ÚLTIMO tirante conocido en vez de
    // contar 0. Evita valles falsos en el apilado cuando la cola del canal no se
    // mide a diario (el agua sigue ahí). El punto se marca est=true (estimado)
    // cuando cualquiera de las dos fronteras se arrastró. Un hueco INICIAL (sin
    // lectura previa) queda null: no inventamos datos antes del primer aforo.
    let lastUp: number | null = null, lastDn: number | null = null;
    const puntos: SeriePunto[] = fechas.map(f => {
      const rawUp = tiranteFrontera(nivelesPorEscalaFecha.get(tr.esc_up_id)?.get(f), 'up');
      const rawDn = tiranteFrontera(nivelesPorEscalaFecha.get(tr.esc_down_id)?.get(f), 'down');
      const arrastrado = (rawUp == null && lastUp != null) || (rawDn == null && lastDn != null);
      if (rawUp != null) lastUp = rawUp;
      if (rawDn != null) lastDn = rawDn;
      if (lastUp == null || lastDn == null) return { t: tsOf(f), y: null };
      const y = +(volM3(lastUp, lastDn) / 1e6).toFixed(4);
      return arrastrado ? { t: tsOf(f), y, est: true } : { t: tsOf(f), y };
    });

    // Estado de llenado de la SECCIÓN: último tirante conocido en cada frontera
    // (real o arrastrado, igual que el apilado), tomando la lectura más reciente
    // disponible de forma independiente para arriba y abajo. Así la sección
    // dibujada coincide con el último punto de la serie de volumen.
    let nivelUpActual: number | null = null, nivelDownActual: number | null = null;
    for (let i = fechas.length - 1; i >= 0 && nivelUpActual == null; i--)
      nivelUpActual = tiranteFrontera(nivelesPorEscalaFecha.get(tr.esc_up_id)?.get(fechas[i]), 'up');
    for (let i = fechas.length - 1; i >= 0 && nivelDownActual == null; i--)
      nivelDownActual = tiranteFrontera(nivelesPorEscalaFecha.get(tr.esc_down_id)?.get(fechas[i]), 'down');
    if (nivelUpActual != null) nivelUpActual = +nivelUpActual.toFixed(3);
    if (nivelDownActual != null) nivelDownActual = +nivelDownActual.toFixed(3);
    const tiranteActual = (nivelUpActual != null && nivelDownActual != null)
      ? +((nivelUpActual + nivelDownActual) / 2).toFixed(3) : null;
    const tiranteDiseno = perfil?.tirante_diseno_m ?? null;
    const pctDiseno = tiranteActual != null && tiranteDiseno != null && tiranteDiseno > 0
      ? +((tiranteActual / tiranteDiseno) * 100).toFixed(1) : null;
    // Altura REAL del canal = tirante de diseño + bordo libre (freeboard). Es la
    // profundidad física del revestimiento; sobre ella se mide el margen a bordo.
    const bordoLibre = perfil?.bordo_libre_m ?? null;
    const alturaCanal = tiranteDiseno != null && bordoLibre != null
      ? +(tiranteDiseno + bordoLibre).toFixed(3) : null;
    const pctBordo = tiranteActual != null && alturaCanal != null && alturaCanal > 0
      ? +((tiranteActual / alturaCanal) * 100).toFixed(1) : null;
    // Ancho de corona = espejo a la altura total del canal (b + 2·z·(y+BL)).
    // Es el ancho físico entre coronamientos del documento del Canal Conchos.
    const anchoCorona = usaTrapecio && alturaCanal != null
      ? +(b + 2 * z * alturaCanal).toFixed(2) : null;

    return {
      key: `${tr.esc_up_id}_${tr.esc_down_id}`, etiqueta: `${tr.esc_up}→${tr.esc_down}`,
      km_up: tr.km_up, km_down: tr.km_down, puntos,
      estado: {
        tiranteActual, pctDiseno,
        plantilla: usaTrapecio ? b : (tr.ancho_canal_m || 8),
        talud: usaTrapecio ? z : 0,
        tiranteDiseno, bordoLibre, alturaCanal, pctBordo, esTrapezoidal: usaTrapecio,
        anchoCorona, nSecciones,
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

// Índice escala_id -> (fecha -> {arriba, abajo}) desde lecturas_escalas, para el
// volumen por tramo con el modelo de compuertas (necesita AMBAS caras del nivel).
// Por día se toma la ÚLTIMA lectura con dato en cada cara (creado_en ascendente),
// para que arriba y abajo reflejen el estado más reciente aunque vengan en
// lecturas distintas del mismo día.
export function indiceNivelesUpDown(
  lecturas: LecturaEscala[]
): { idx: Map<string, Map<string, NivelUpDown>>; fechas: string[] } {
  const ordenadas = [...lecturas].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
  const idx = new Map<string, Map<string, NivelUpDown>>();
  const fechasSet = new Set<string>();
  for (const l of ordenadas) {
    if (!idx.has(l.escala_id)) idx.set(l.escala_id, new Map());
    const porFecha = idx.get(l.escala_id)!;
    const prev = porFecha.get(l.fecha) ?? { arriba: null, abajo: null };
    // Última lectura válida gana (>0); un 0/null no pisa un valor real anterior.
    porFecha.set(l.fecha, {
      arriba: nivelValido(l.nivel_m) ? l.nivel_m : prev.arriba,
      abajo:  nivelValido(l.nivel_abajo_m) ? l.nivel_abajo_m : prev.abajo,
    });
    fechasSet.add(l.fecha);
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
