/**
 * aqwpEstadistica — indicadores técnicos y estadísticos de la cuenca del Conchos. Lógica PURA (sin React ni Supabase).
 *
 * Reglas que se respetan en TODO el módulo (salen del análisis con datos reales, ver aqwpCalidad.ts):
 *  · S/D nunca es 0: sin dato suficiente se devuelve null.
 *  · Todo cálculo temporal usa FECHAS REALES, nunca posiciones en el arreglo (Boquilla y Madero reportan de lunes a
 *    viernes desde abril de 2026: entre lecturas hay saltos de 3 días).
 *  · El histórico se calcula en Mm³, NO en % del NAMO: el NAMO de CONAGUA cambia en el tiempo.
 *  · Con solo 9 años (2017-2025) el percentil tiene resolución de ~11 puntos: se exige un mínimo de años y se rotula
 *    siempre "n = N años". No es una probabilidad de excedencia ni un periodo de retorno.
 *  · Lluvia: solo 2 ciclos. Se permite acumulado y "frente al ciclo anterior (n = 1)"; NUNCA "normal", anomalía ni percentil.
 */

export const MIN_ANIOS_PERCENTIL = 8;

// ── Fechas ────────────────────────────────────────────────────────────────────
const aUtcMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const DIA_MS = 86_400_000;

/** Día del año 1-366 (mismo criterio que extract(doy) de la vista v_aqwp_climatologia). */
export function diaDelAnio(fechaISO: string): number {
  const anio = Number(fechaISO.slice(0, 4));
  return Math.round((aUtcMs(fechaISO) - Date.UTC(anio, 0, 1)) / DIA_MS) + 1;
}

// ── Climatología (vista v_aqwp_climatologia) ──────────────────────────────────
export interface FilaClimatologia {
  ubicacionId: number; diaAnio: number; nAnios: number;
  minimo: number | null; p10: number | null; p25: number | null; mediana: number | null;
  p75: number | null; p90: number | null; maximo: number | null;
}
export interface ClimatologiaHoy { ubicacionId: number; diaAnio: number; nAnios: number; valores: number[] }

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function normalizarClimatologia(r: Record<string, unknown>): FilaClimatologia {
  return {
    ubicacionId: Number(r.ubicacion_id), diaAnio: Number(r.dia_anio), nAnios: Number(r.n_anios) || 0,
    minimo: num(r.minimo), p10: num(r.p10), p25: num(r.p25), mediana: num(r.mediana),
    p75: num(r.p75), p90: num(r.p90), maximo: num(r.maximo),
  };
}

/** PostgREST devuelve numeric[] como arreglo de números o de strings; los inválidos se descartan. */
export function normalizarClimatologiaHoy(r: Record<string, unknown>): ClimatologiaHoy {
  const bruto = Array.isArray(r.valores) ? (r.valores as unknown[]) : [];
  return {
    ubicacionId: Number(r.ubicacion_id), diaAnio: Number(r.dia_anio), nAnios: Number(r.n_anios) || 0,
    valores: bruto.map(num).filter((v): v is number => v != null).sort((a, b) => a - b),
  };
}

/**
 * Percentil empírico = % de las observaciones históricas del mismo día del año que son MENORES que el valor de hoy
 * (mismo criterio que el SQL de validación). null si hay menos de `minAnios` años: con 3 o 4 años no es un percentil.
 */
export function percentilEmpirico(valor: number | null, valores: number[], nAnios: number, minAnios = MIN_ANIOS_PERCENTIL): number | null {
  if (valor == null || !Number.isFinite(valor) || valores.length === 0 || nAnios < minAnios) return null;
  return Math.round((valores.filter((v) => v < valor).length / valores.length) * 100);
}

export interface PosicionHistorica {
  /** 0-100; null si hay pocos años. */
  percentil: number | null;
  mediana: number | null;
  minimo: number | null;
  maximo: number | null;
  p10: number | null;
  p90: number | null;
  nAnios: number;
  /** hoy − mediana (Mm³) y en % de la mediana. */
  anomaliaMm3: number | null;
  anomaliaPct: number | null;
  /** Texto obligatorio junto a cualquier cifra histórica. */
  nota: string;
}

/** Dónde está el almacenamiento de hoy frente a su historia del mismo día. null sin valor o sin climatología. */
export function posicionHistorica(valorHoy: number | null, hoy: ClimatologiaHoy | null, fila: FilaClimatologia | null): PosicionHistorica | null {
  if (valorHoy == null || !hoy || hoy.valores.length === 0) return null;
  const med = fila?.mediana ?? null;
  return {
    percentil: percentilEmpirico(valorHoy, hoy.valores, hoy.nAnios),
    mediana: med, minimo: fila?.minimo ?? hoy.valores[0], maximo: fila?.maximo ?? hoy.valores[hoy.valores.length - 1],
    p10: fila?.p10 ?? null, p90: fila?.p90 ?? null, nAnios: hoy.nAnios,
    anomaliaMm3: med != null ? Math.round((valorHoy - med) * 10) / 10 : null,
    anomaliaPct: med != null && med > 0 ? Math.round(((valorHoy - med) / med) * 1000) / 10 : null,
    nota: `n = ${hoy.nAnios} años (2017-${new Date().getFullYear() - 1}), mismo día del año ±3 d`,
  };
}

// ── Volumen útil ──────────────────────────────────────────────────────────────
export interface VolumenUtil { utilMm3: number; pctUtil: number; capacidadUtilMm3: number; bajoMuerto: boolean }

/**
 * Volumen ÚTIL = almacenado − volumen muerto; % útil = (S − muerto) / (NAMO − muerto).
 * Luis L. León: 13.0 Mm³ útiles de 36.6 (5 % útil) mientras su % del NAMO es 12.9 %: el % NAMO sobreestima lo disponible.
 * Usar el muerto VIGENTE (la serie existe desde 2019-05), no uno fijo. null si falta un dato o NAMO ≤ muerto.
 */
export function volumenUtil(almacenadoMm3: number | null, muertoMm3: number | null, namoMm3: number | null): VolumenUtil | null {
  if (almacenadoMm3 == null || muertoMm3 == null || namoMm3 == null) return null;
  if (![almacenadoMm3, muertoMm3, namoMm3].every(Number.isFinite) || namoMm3 <= muertoMm3) return null;
  const capacidadUtil = namoMm3 - muertoMm3;
  const util = almacenadoMm3 - muertoMm3;
  return {
    utilMm3: Math.round(Math.max(0, util) * 100) / 100,
    pctUtil: Math.round(Math.max(0, util) / capacidadUtil * 1000) / 10,
    capacidadUtilMm3: Math.round(capacidadUtil * 100) / 100,
    bajoMuerto: util < 0,
  };
}

// ── Tendencia robusta (Theil-Sen) ─────────────────────────────────────────────
export interface Tendencia { pendienteMm3Dia: number; n: number; desde: string; hasta: string }

/**
 * Pendiente de Theil-Sen (mediana de las pendientes entre todos los pares de puntos) en Mm³/día, sobre los últimos
 * `dias` días reales de la serie. Robusta a picos de un día (Madero 2026-04-06) y a los saltos de 3 días de las
 * lecturas de lunes a viernes. Exige ≥ `minPuntos` puntos con dato. Las S/D (null) se ignoran.
 */
export function theilSen(serie: { fecha: string; valor: number | null }[], dias = 30, minPuntos = 5): Tendencia | null {
  const pts = serie.filter((p): p is { fecha: string; valor: number } => p.valor != null && Number.isFinite(p.valor))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (pts.length === 0) return null;
  const ultimo = aUtcMs(pts[pts.length - 1].fecha);
  const ventana = pts.filter((p) => ultimo - aUtcMs(p.fecha) <= dias * DIA_MS);
  if (ventana.length < minPuntos) return null;
  const pend: number[] = [];
  for (let i = 0; i < ventana.length; i++) {
    for (let j = i + 1; j < ventana.length; j++) {
      const dt = (aUtcMs(ventana[j].fecha) - aUtcMs(ventana[i].fecha)) / DIA_MS;
      if (dt > 0) pend.push((ventana[j].valor - ventana[i].valor) / dt);
    }
  }
  if (pend.length === 0) return null;
  pend.sort((a, b) => a - b);
  const m = pend.length >> 1;
  const mediana = pend.length % 2 ? pend[m] : (pend[m - 1] + pend[m]) / 2;
  return {
    pendienteMm3Dia: Math.round(mediana * 1000) / 1000, n: ventana.length,
    desde: ventana[0].fecha, hasta: ventana[ventana.length - 1].fecha,
  };
}

// ── Tamaño ────────────────────────────────────────────────────────────────────
/** Participación (%) de cada presa en el NAMO sumado de las presas con NAMO conocido. Boquilla ≈ 75 %. */
export function participacionNamo(namos: Record<number, number | null>): Record<number, number> {
  const validos = Object.entries(namos).filter((e): e is [string, number] => e[1] != null && e[1] > 0);
  const total = validos.reduce((a, [, v]) => a + v, 0);
  const out: Record<number, number> = {};
  if (total <= 0) return out;
  for (const [k, v] of validos) out[Number(k)] = Math.round((v / total) * 1000) / 10;
  return out;
}

// ── Semáforo ──────────────────────────────────────────────────────────────────
export type NivelCuenca = 'critico' | 'bajo' | 'normal' | 'sd';
export interface EntradaSemaforo {
  pctUtil: number | null;
  /** Percentil histórico del mismo día (null si hay pocos años). */
  percentil: number | null;
  nAnios: number;
  /** Pendiente robusta a 14-30 d (Mm³/día). */
  tendenciaMm3Dia: number | null;
  /** Hay extracción activa (riego): solo entonces un descenso es preocupante. */
  extraccionActiva: boolean;
  sinActualizar: boolean;
}
export interface Semaforo {
  nivel: NivelCuenca;
  /** La calidad del dato va APARTE del nivel (gris "sin actualizar"): no mezcla "mal dato" con "poca agua". */
  calidad: 'ok' | 'sin_actualizar';
  motivos: string[];
}

const ORDEN: NivelCuenca[] = ['normal', 'bajo', 'critico'];

/**
 * Semáforo combinado. El nivel es el PEOR entre:
 *  · físico: % útil < 10 crítico, < 25 bajo (el piso real de agua utilizable);
 *  · histórico: percentil ≤ 10 crítico, ≤ 25 bajo (solo con ≥ 8 años).
 * La tendencia solo puede BAJAR un nivel (descenso sostenido con extracción activa); nunca sube. Los umbrales fijos 20/40 %
 * de presaNiveles.ts siguen existiendo para el resto de la app: este semáforo convive con ellos y los complementa.
 */
export function semaforoCuenca(e: EntradaSemaforo): Semaforo {
  const motivos: string[] = [];
  let nivel: NivelCuenca | null = null;
  const subir = (n: Exclude<NivelCuenca, 'sd'>, porque: string) => {
    motivos.push(porque);
    if (nivel === null || ORDEN.indexOf(n) > ORDEN.indexOf(nivel as Exclude<NivelCuenca, 'sd'>)) nivel = n;
  };

  if (e.pctUtil != null) {
    if (e.pctUtil < 10) subir('critico', `Solo ${e.pctUtil.toFixed(0)} % de su volumen útil (menos de 10 %)`);
    else if (e.pctUtil < 25) subir('bajo', `${e.pctUtil.toFixed(0)} % de su volumen útil (menos de 25 %)`);
    else subir('normal', `${e.pctUtil.toFixed(0)} % de su volumen útil`);
  }
  if (e.percentil != null && e.nAnios >= MIN_ANIOS_PERCENTIL) {
    if (e.percentil <= 10) subir('critico', `Percentil ${e.percentil} frente a su historia del día (n = ${e.nAnios} años)`);
    else if (e.percentil <= 25) subir('bajo', `Percentil ${e.percentil} frente a su historia del día (n = ${e.nAnios} años)`);
    else subir('normal', `Percentil ${e.percentil} frente a su historia del día (n = ${e.nAnios} años)`);
  }

  let final: NivelCuenca = nivel ?? 'sd';
  if (final !== 'sd' && e.tendenciaMm3Dia != null && e.tendenciaMm3Dia < 0 && e.extraccionActiva) {
    const i = ORDEN.indexOf(final);
    if (i < ORDEN.length - 1) { final = ORDEN[i + 1]; motivos.push('Desciende con extracción activa: baja un nivel'); }
  }
  return { nivel: final, calidad: e.sinActualizar ? 'sin_actualizar' : 'ok', motivos };
}

// ── Lluvia por ciclo agrícola (1-oct → 30-sep) ────────────────────────────────
export interface LluviaCiclo {
  /** Suma de los días con dato; null si no hay ninguno (S/D, nunca 0). */
  mm: number | null;
  diasConDato: number;
  /** Días del ciclo transcurridos hasta la fecha de corte. */
  diasVentana: number;
  /** Días con ≥ 1 mm. */
  diasConLluvia: number;
  maxDiaMm: number | null;
  /** diasConDato / diasVentana. */
  cobertura: number;
}

/** Año en que inicia el ciclo agrícola al que pertenece una fecha (oct-dic → ese año; ene-sep → el anterior). */
export function anioInicioCiclo(fechaISO: string): number {
  const a = Number(fechaISO.slice(0, 4)), m = Number(fechaISO.slice(5, 7));
  return m >= 10 ? a : a - 1;
}

/**
 * Lluvia acumulada del ciclo `anioCiclo` desde el 1-oct hasta el día `k` del ciclo (0 = 1-oct) inclusive. Pasar el mismo
 * `k` a dos ciclos los hace COMPARABLES (misma ventana de fechas). Un día sin dato no suma ni cuenta como 0.
 */
export function lluviaCiclo(lecturas: { fecha: string; valor: number | null }[], anioCiclo: number, k: number): LluviaCiclo {
  const ini = Date.UTC(anioCiclo, 9, 1);
  const fin = ini + k * DIA_MS;
  const dentro = lecturas.filter((l) => { const t = aUtcMs(l.fecha); return t >= ini && t <= fin; });
  const conDato = dentro.filter((l): l is { fecha: string; valor: number } => l.valor != null && Number.isFinite(l.valor));
  const suma = conDato.reduce((a, l) => a + l.valor, 0);
  return {
    mm: conDato.length ? Math.round(suma * 10) / 10 : null,
    diasConDato: conDato.length, diasVentana: k + 1,
    diasConLluvia: conDato.filter((l) => l.valor >= 1).length,
    maxDiaMm: conDato.length ? Math.round(Math.max(...conDato.map((l) => l.valor)) * 10) / 10 : null,
    cobertura: conDato.length / (k + 1),
  };
}

export interface LluviaVsAnterior {
  actualMm: number; anteriorMm: number; difMm: number; difPct: number | null;
  /** Siempre 1: solo hay UN ciclo previo. No es una anomalía ni un percentil. */
  nCiclosComparados: 1;
  nota: string;
  /**
   * Un ciclo anterior que suma EXACTAMENTE 0 mm en toda la ventana no se puede distinguir de un pluviómetro que no reportó
   * (Villalba: 0.0 mm de oct a dic de 2025 tras 40.7 mm en septiembre): la comparación se muestra, pero con esta advertencia.
   */
  advertencia: string | null;
}

/**
 * Compara el ciclo en curso con el anterior sobre la MISMA ventana de fechas. Solo si ambos tienen ≥ 80 % de cobertura
 * (si no, la diferencia sería un artefacto de datos faltantes). Con 2 ciclos NO se puede decir qué es "normal".
 */
export function lluviaVsCicloAnterior(actual: LluviaCiclo, anterior: LluviaCiclo, coberturaMin = 0.8): LluviaVsAnterior | null {
  if (actual.mm == null || anterior.mm == null || actual.cobertura < coberturaMin || anterior.cobertura < coberturaMin) return null;
  return {
    actualMm: actual.mm, anteriorMm: anterior.mm, difMm: Math.round((actual.mm - anterior.mm) * 10) / 10,
    difPct: anterior.mm > 0 ? Math.round(((actual.mm - anterior.mm) / anterior.mm) * 1000) / 10 : null,
    nCiclosComparados: 1, nota: 'Frente al ciclo anterior (n = 1); con dos ciclos no se puede decir qué es lo normal',
    advertencia: anterior.mm === 0
      ? 'El ciclo anterior sumó 0 mm en esta ventana: puede ser un periodo seco real o un pluviómetro que no reportó'
      : null,
  };
}
