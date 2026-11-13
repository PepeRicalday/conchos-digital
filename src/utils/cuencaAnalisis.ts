/**
 * cuencaAnalisis — lógica PURA del análisis de la cuenca: serie del almacenamiento total, variaciones para los indicadores,
 * balance agregado de la cuenca por periodo, salida por Ojinaga, resumen de los vasos por satélite y las «lecturas» (hallazgos
 * en una frase) de cada pestaña. Sin React ni Supabase.
 *
 * REGLA: lo que no tiene fuente es null (S/D), jamás 0. Toda suma declara con cuántos sumandos se hizo.
 */
import type { FilaGrafica } from './aqwpCuenca';
import { claveEstancada } from './aqwpCuenca';
import { construirRed, etiquetaMes, type BalanceMensual, type CierreMensual, type CuerpoAgua } from './cuerposAgua';

// ── Serie del almacenamiento de la cuenca ───────────────────────────────────────────────────────────────────────────
export interface PuntoSerie { fecha: string; v: number }

/** Días que se arrastra el último dato de una presa (CONAGUA actualiza algunas por tramos de 8 a 16 días). */
export const ARRASTRE_MAX_DIAS = 16;

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * Almacenamiento diario (Mm³) sumado sobre las presas `ids`. La serie de llenado viene en % del NAMO: se vuelve a Mm³ con el NAMO
 * de cada presa. Un día solo tiene total si TODAS las presas tienen dato propio o arrastrado ≤ 16 días: una suma parcial no es la cuenca.
 */
export function serieAlmacenamiento(serie: FilaGrafica[], namoPorUbicacion: Map<number, number | null>, ids: readonly number[]): PuntoSerie[] {
  const con = ids.filter((id) => (namoPorUbicacion.get(id) ?? 0) > 0);
  if (!con.length) return [];
  const ultimo = new Map<number, { fecha: string; mm3: number }>();
  const out: PuntoSerie[] = [];
  for (const r of serie) {
    for (const id of con) {
      const a = r[String(id)], b = r[claveEstancada(id)];
      const pct = typeof a === 'number' ? a : typeof b === 'number' ? b : null;
      if (pct != null) ultimo.set(id, { fecha: r.fecha, mm3: (pct / 100) * (namoPorUbicacion.get(id) as number) });
    }
    let total = 0, completo = true;
    for (const id of con) {
      const u = ultimo.get(id);
      if (!u || diasEntre(u.fecha, r.fecha) > ARRASTRE_MAX_DIAS) { completo = false; break; }
      total += u.mm3;
    }
    if (completo) out.push({ fecha: r.fecha, v: total });
  }
  return out;
}

/** Cambio entre el último punto y el más cercano a `dias` antes (tolerancia ±40 %). null sin base de comparación. */
export function cambioEn(serie: PuntoSerie[], dias: number): { delta: number; pct: number | null; base: PuntoSerie } | null {
  if (serie.length < 2) return null;
  const fin = serie[serie.length - 1];
  let mejor: PuntoSerie | null = null, dMejor = Infinity;
  for (const p of serie) {
    const d = Math.abs(diasEntre(p.fecha, fin.fecha) - dias);
    if (p.fecha < fin.fecha && d <= dias * 0.4 && d < dMejor) { mejor = p; dMejor = d; }
  }
  if (!mejor) return null;
  const delta = fin.v - mejor.v;
  return { delta, pct: mejor.v !== 0 ? (delta / mejor.v) * 100 : null, base: mejor };
}

/**
 * Ancla la serie al valor que se muestra hoy: si el total vigente (que puede incluir la captura de campo del día) es más reciente
 * que el último punto, se agrega; si es del mismo día, lo sustituye. Así el «cambio en N días» parte de la MISMA cifra del indicador.
 * Un total nulo o con fecha anterior a la serie no la toca.
 */
export function anclarSerie(serie: PuntoSerie[], hoy: { fecha: string | null; v: number | null }): PuntoSerie[] {
  if (hoy.fecha == null || hoy.v == null || !Number.isFinite(hoy.v)) return serie;
  if (!serie.length) return [{ fecha: hoy.fecha, v: hoy.v }];
  const ult = serie[serie.length - 1];
  if (hoy.fecha < ult.fecha) return serie;
  return hoy.fecha === ult.fecha ? [...serie.slice(0, -1), { fecha: hoy.fecha, v: hoy.v }] : [...serie, { fecha: hoy.fecha, v: hoy.v }];
}

export const ultimos = (serie: PuntoSerie[], dias: number): PuntoSerie[] => {
  if (!serie.length) return [];
  const fin = serie[serie.length - 1].fecha;
  return serie.filter((p) => diasEntre(p.fecha, fin) <= dias);
};

// ── Periodos ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type PeriodoCuenca = 'ciclo' | 'cicloAnt' | '12m' | '24m' | 'todo';
export interface RangoPeriodo { clave: PeriodoCuenca; etiqueta: string; /** Primer mes (AAAA-MM-01), inclusive. */ desde: string; /** Último mes (AAAA-MM-01), inclusive. */ hasta: string; /** El ciclo agrícola que todavía no termina: su resultado es parcial. */ enCurso?: boolean }

const mesDe = (anio: number, mes1: number) => `${anio}-${String(mes1).padStart(2, '0')}-01`;
function sumarMeses(mes: string, n: number): string {
  const a = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1 + n;
  return mesDe(a + Math.floor(m / 12), ((m % 12) + 12) % 12 + 1);
}

/** Año en que EMPIEZA el ciclo agrícola (1-oct → 30-sep) que contiene `hoyISO`. */
export const anioInicioCiclo = (hoyISO: string): number => Number(hoyISO.slice(0, 4)) - (Number(hoyISO.slice(5, 7)) >= 10 ? 0 : 1);

/** Meses mínimos transcurridos para que el ciclo en curso sea el periodo que se abre por defecto (con menos, casi no hay cierres). */
export const MESES_MIN_CICLO_EN_CURSO = 3;

/** Periodo con el que abre el balance: el ciclo en curso solo si ya lleva al menos 3 meses; si no, el ciclo anterior. */
export function periodoInicial(hoyISO: string): PeriodoCuenca {
  const transcurridos = (Number(hoyISO.slice(5, 7)) - 10 + 12) % 12 + 1; // octubre = 1
  return transcurridos >= MESES_MIN_CICLO_EN_CURSO ? 'ciclo' : 'cicloAnt';
}

/**
 * Periodos del balance. El ciclo agrícola va del 1 de octubre al 30 de septiembre. `hasta` nunca pasa del mes en curso.
 * El orden es el de la botonera: va primero el ciclo que ya da resultado (el anterior mientras el actual lleva menos de 3 meses).
 */
export function rangosPeriodo(hoyISO: string, primerMes = '2021-01-01'): RangoPeriodo[] {
  const mesHoy = `${hoyISO.slice(0, 7)}-01`, a = anioInicioCiclo(hoyISO);
  const tope = (m: string) => (m > mesHoy ? mesHoy : m);
  const ciclo: RangoPeriodo = { clave: 'ciclo', etiqueta: `Ciclo ${a}-${a + 1}`, desde: mesDe(a, 10), hasta: tope(mesDe(a + 1, 9)), enCurso: true };
  const cicloAnt: RangoPeriodo = { clave: 'cicloAnt', etiqueta: `Ciclo ${a - 1}-${a}`, desde: mesDe(a - 1, 10), hasta: mesDe(a, 9) };
  return [
    ...(periodoInicial(hoyISO) === 'ciclo' ? [ciclo, cicloAnt] : [cicloAnt, ciclo]),
    { clave: '12m', etiqueta: '12 meses', desde: sumarMeses(mesHoy, -12), hasta: sumarMeses(mesHoy, -1) },
    { clave: '24m', etiqueta: '24 meses', desde: sumarMeses(mesHoy, -24), hasta: sumarMeses(mesHoy, -1) },
    { clave: 'todo', etiqueta: 'Desde 2021', desde: primerMes, hasta: mesHoy },
  ];
}

export function mesesDelRango(r: { desde: string; hasta: string }): string[] {
  const out: string[] = [];
  for (let m = r.desde; m <= r.hasta && out.length < 600; m = sumarMeses(m, 1)) out.push(m);
  return out;
}

// ── Salida de la cuenca (aforo de Ojinaga) ──────────────────────────────────────────────────────────────────────────
export interface LecturaGasto { fecha: string; valor: number | null }
export interface SalidaCuenca {
  /** Volumen estimado del periodo (Mm³): gasto medio × días del periodo. null con cobertura < 60 %. */
  mm3: number | null;
  /** Volumen solo de los días con dato (cota inferior, siempre calculable si hay algún día). */
  mm3Observado: number | null;
  gastoMedio: number | null;
  dias: number;
  diasPeriodo: number;
  coberturaPct: number | null;
}

const M3S_DIA_A_MM3 = 0.0864;
export const COBERTURA_MIN_SALIDA = 60;

/** Volumen que salió por Ojinaga entre dos fechas (inclusive). El periodo se corta en `hoyISO`: no se cuentan días que aún no ocurren. */
export function salidaCuenca(lecturas: LecturaGasto[], desdeISO: string, hastaISO: string, hoyISO: string): SalidaCuenca {
  const fin = hastaISO > hoyISO ? hoyISO : hastaISO;
  const diasPeriodo = Math.max(0, diasEntre(desdeISO, fin) + 1);
  const v = lecturas.filter((l) => l.valor != null && l.fecha >= desdeISO && l.fecha <= fin).map((l) => l.valor as number);
  if (!v.length || diasPeriodo === 0) return { mm3: null, mm3Observado: null, gastoMedio: null, dias: 0, diasPeriodo, coberturaPct: diasPeriodo ? 0 : null };
  const suma = v.reduce((a, b) => a + b, 0), media = suma / v.length, cob = (v.length / diasPeriodo) * 100;
  return { mm3: cob >= COBERTURA_MIN_SALIDA ? media * diasPeriodo * M3S_DIA_A_MM3 : null, mm3Observado: suma * M3S_DIA_A_MM3, gastoMedio: media, dias: v.length, diasPeriodo, coberturaPct: cob };
}

/** Último día del mes `AAAA-MM-01`. */
export function finDeMes(mes: string): string {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
}

// ── Balance de la cuenca ────────────────────────────────────────────────────────────────────────────────────────────
export interface BalanceVasoPeriodo {
  cuerpo: CuerpoAgua;
  /** No recibe descargas de otro vaso del catálogo: su aportación es agua nueva para la red, no agua ya contada aguas arriba. */
  cabecera: boolean;
  mesesPeriodo: number;
  /** Meses con balance completo (cobertura de flujos ≥ 90 % y dos cierres consecutivos). */
  mesesOk: number;
  mesesConFlujo: number;
  entradas: number | null;
  salida: number | null;
  /** Almacenamiento al inicio y al final del tramo con dato dentro del periodo, y los meses a los que corresponden. */
  sIni: number | null; sFin: number | null; mesIni: string | null; mesFin: string | null;
  deltaS: number | null;
  /** true si el tramo con dato no cubre el periodo completo (el cambio es de un tramo más corto). */
  deltaParcial: boolean;
  /** Suma del residuo SOLO en meses completos. */
  residuo: number | null;
}

export interface BalanceCuencaPeriodo {
  rango: { desde: string; hasta: string };
  vasos: BalanceVasoPeriodo[];
  /** Vasos del catálogo sin ningún mes de balance (sin flujos en AQUARIUS). */
  sinBalance: CuerpoAgua[];
  deltaS: number | null; vasosConDelta: number; deltaParcial: boolean;
  sIni: number | null; sFin: number | null;
  /** Suma de las aportaciones de TODOS los vasos: repite el agua que pasa de un vaso al siguiente. */
  entradasBrutas: number | null;
  /** Aportaciones solo de los vasos de cabecera: no repite agua, pero deja fuera los escurrimientos que entran entre vasos. */
  entradasCabecera: number | null; vasosCabecera: number;
  salidaVasos: number | null;
  vasoMesesOk: number; vasoMesesTotal: number;
}

const sumaONull = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

/** Balance agregado de la cuenca en un rango de meses, a partir del balance mensual por vaso ya calculado en la base. */
export function balanceCuenca(cuerpos: CuerpoAgua[], balances: BalanceMensual[], rango: { desde: string; hasta: string }): BalanceCuencaPeriodo {
  const meses = mesesDelRango(rango);
  const red = new Map(construirRed(cuerpos).map((n) => [n.cuerpo.id, n]));
  const vasos: BalanceVasoPeriodo[] = [], sinBalance: CuerpoAgua[] = [];
  for (const cuerpo of cuerpos) {
    const todos = balances.filter((b) => b.cuerpoId === cuerpo.id);
    if (!todos.length) { sinBalance.push(cuerpo); continue; }
    const filas = todos.filter((b) => b.mes >= rango.desde && b.mes <= rango.hasta).sort((a, b) => a.mes.localeCompare(b.mes));
    const conIni = filas.find((b) => b.sIni != null), conFin = [...filas].reverse().find((b) => b.sFin != null);
    const hayDelta = conIni != null && conFin != null && conIni.mes <= conFin.mes;
    const ok = filas.filter((b) => b.calidad === 'OK');
    vasos.push({
      cuerpo, cabecera: (red.get(cuerpo.id)?.hijos.length ?? 0) === 0, mesesPeriodo: meses.length, mesesOk: ok.length,
      mesesConFlujo: filas.filter((b) => b.entradas != null || b.salidaTotal != null).length,
      entradas: sumaONull(filas.map((b) => b.entradas)), salida: sumaONull(filas.map((b) => b.salidaTotal)),
      sIni: hayDelta ? conIni.sIni : null, sFin: hayDelta ? conFin.sFin : null, mesIni: hayDelta ? conIni.mes : null, mesFin: hayDelta ? conFin.mes : null,
      deltaS: hayDelta ? (conFin.sFin as number) - (conIni.sIni as number) : null,
      deltaParcial: hayDelta && (conIni.mes !== meses[0] || conFin.mes !== meses[meses.length - 1]),
      residuo: sumaONull(ok.map((b) => b.residuo)),
    });
  }
  const conDelta = vasos.filter((v) => v.deltaS != null), cab = vasos.filter((v) => v.cabecera && v.entradas != null);
  return {
    rango, vasos, sinBalance,
    deltaS: sumaONull(conDelta.map((v) => v.deltaS)), vasosConDelta: conDelta.length, deltaParcial: conDelta.some((v) => v.deltaParcial) || conDelta.length < vasos.length,
    sIni: sumaONull(conDelta.map((v) => v.sIni)), sFin: sumaONull(conDelta.map((v) => v.sFin)),
    entradasBrutas: sumaONull(vasos.map((v) => v.entradas)), entradasCabecera: sumaONull(cab.map((v) => v.entradas)), vasosCabecera: cab.length,
    salidaVasos: sumaONull(vasos.map((v) => v.salida)),
    vasoMesesOk: vasos.reduce((t, v) => t + v.mesesOk, 0), vasoMesesTotal: vasos.length * meses.length,
  };
}

// ── Vasos por satélite ──────────────────────────────────────────────────────────────────────────────────────────────
export interface EscenaLigera { fecha: string; areaKm2: number | null; separacionDebil?: boolean }
export type PeriodoVaso = 3 | 6 | 12 | 'todo';
export const PERIODOS_VASO: { v: PeriodoVaso; t: string }[] = [{ v: 3, t: '3 meses' }, { v: 6, t: '6 meses' }, { v: 12, t: '12 meses' }, { v: 'todo', t: 'Todo' }];

/** Revisita de Sentinel-2 (dos satélites): una pasada cada 5 días sobre el mismo punto. */
export const REVISITA_SENTINEL_DIAS = 5;
/** Con más de 20 días la escena ya no describe el vaso de hoy (se rotula «atrasada»). */
export const ESCENA_ATRASADA_DIAS = 20;

export function escenasEnPeriodo<T extends EscenaLigera>(escenas: T[], periodo: PeriodoVaso, hoyISO: string): T[] {
  if (periodo === 'todo') return escenas;
  const corte = Date.parse(`${hoyISO}T12:00:00Z`) - periodo * 30.44 * 86_400_000;
  return escenas.filter((e) => Date.parse(e.fecha) >= corte);
}

export const diasDesde = (fechaISO: string, hoyISO: string): number => Math.max(0, diasEntre(fechaISO.slice(0, 10), hoyISO));

export interface ResumenVasos {
  vasos: number; medidos: number;
  /** Suma del espejo de la última escena de cada vaso medido. Mezcla fechas distintas: se declara el intervalo. */
  areaKm2: number | null; huellaKm2: number | null; pctHuella: number | null;
  masReciente: string | null; masAntigua: string | null;
  atrasados: number; debiles: number;
}

export function resumenVasos(items: { ultima: EscenaLigera | undefined; huellaKm2: number | null }[], hoyISO: string): ResumenVasos {
  const con = items.filter((i) => i.ultima?.areaKm2 != null);
  const fechas = con.map((i) => (i.ultima as EscenaLigera).fecha).sort();
  const area = sumaONull(con.map((i) => (i.ultima as EscenaLigera).areaKm2));
  const huella = sumaONull(con.map((i) => i.huellaKm2));
  return {
    vasos: items.length, medidos: con.length, areaKm2: area, huellaKm2: huella, pctHuella: area != null && huella != null && huella > 0 ? (area / huella) * 100 : null,
    masReciente: fechas.length ? fechas[fechas.length - 1] : null, masAntigua: fechas.length ? fechas[0] : null,
    atrasados: con.filter((i) => diasDesde((i.ultima as EscenaLigera).fecha, hoyISO) > ESCENA_ATRASADA_DIAS).length,
    debiles: con.filter((i) => i.ultima?.separacionDebil).length,
  };
}

// ── Lecturas: hallazgos en una frase ────────────────────────────────────────────────────────────────────────────────
export type TonoLectura = 'ok' | 'warn' | 'crit' | 'info';
export interface Lectura { tono: TonoLectura; titulo: string; texto: string }

const n1 = (v: number, d = 1) => v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const sig = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n1(Math.abs(v), d)}`;

export interface PresaLectura { etiqueta: string; pct: number | null; cambio30Puntos: number | null; percentil: number | null; sinActualizar: boolean; atrasoDias: number | null }

/** `nAnios` = años de historia de la posición (sale del modelo); sin él no se afirma cuántos son. */
export function lecturasPresas(presas: PresaLectura[], nAnios: number | null = null): Lectura[] {
  const out: Lectura[] = [];
  const con = presas.filter((p) => p.pct != null);
  if (!con.length) return [{ tono: 'info', titulo: 'Sin lectura vigente', texto: 'Ninguna presa tiene almacenamiento reportado (S/D).' }];
  const menor = [...con].sort((a, b) => (a.pct as number) - (b.pct as number))[0];
  const criticas = con.filter((p) => (p.pct as number) < 20), bajas = con.filter((p) => (p.pct as number) >= 20 && (p.pct as number) < 40);
  out.push({
    tono: criticas.length ? 'crit' : bajas.length ? 'warn' : 'ok', titulo: 'Nivel',
    texto: `${criticas.length} en crítico (< 20 %) y ${bajas.length} en bajo (< 40 %) de ${con.length} presas con dato. La más baja es ${menor.etiqueta} con ${n1(menor.pct as number)} % del NAMO.`,
  });
  const mov = con.filter((p) => p.cambio30Puntos != null).sort((a, b) => Math.abs(b.cambio30Puntos as number) - Math.abs(a.cambio30Puntos as number))[0];
  if (mov) {
    const suben = con.filter((p) => (p.cambio30Puntos ?? 0) > 0.5).length, bajan = con.filter((p) => (p.cambio30Puntos ?? 0) < -0.5).length;
    out.push({ tono: 'info', titulo: 'Movimiento en 30 días', texto: `${suben} presas suben y ${bajan} bajan. El mayor cambio es ${mov.etiqueta}: ${sig(mov.cambio30Puntos as number)} puntos del NAMO.` });
  }
  const pos = con.filter((p) => p.percentil != null);
  if (pos.length) {
    const bajoP25 = pos.filter((p) => (p.percentil as number) <= 25);
    out.push({
      tono: bajoP25.length > pos.length / 2 ? 'warn' : 'info', titulo: 'Frente a su historia',
      texto: `${bajoP25.length} de ${pos.length} presas están en el cuarto más bajo de lo registrado para este día del año${bajoP25.length ? ` (${bajoP25.map((p) => p.etiqueta).join(', ')})` : ''}. ${nAnios != null && nAnios > 0 ? `Historia de ${nAnios} años` : 'Historia corta'}: orientación, no probabilidad.`,
    });
  }
  const dud = presas.filter((p) => p.sinActualizar || (p.atrasoDias ?? 0) > 2);
  if (dud.length) out.push({ tono: 'warn', titulo: 'Vigencia del dato', texto: `${dud.map((p) => p.etiqueta).join(', ')}: lectura sin actualizar o atrasada. Su cifra entra a los totales con esa reserva.` });
  return out;
}

export interface EstacionLectura { nombre: string; rol: 'entrada' | 'rio' | 'salida'; destino: string | null; gastoMedio: number | null; volumenMm3: number | null; enLinea: boolean; reserva: string | null }

/** Coherencia entre lo que mide una estación a la entrada de un vaso y la aportación que publica CONAGUA para ese vaso. */
export function lecturasRed(estaciones: EstacionLectura[], ventanaTxt: string, cruces: { estacion: string; presa: string; medidoM3s: number | null; reportadoM3s: number | null; fechaReportado: string | null }[], salida: { ibwc: number | null; sutron: number | null }): Lectura[] {
  const out: Lectura[] = [];
  const fuera = estaciones.filter((e) => !e.enLinea);
  out.push({
    tono: fuera.length ? 'warn' : 'ok', titulo: 'Enlace',
    texto: fuera.length ? `${fuera.length} de ${estaciones.length} estaciones sin transmisión reciente: ${fuera.map((e) => e.nombre).join(', ')}.` : `Las ${estaciones.length} estaciones transmiten con normalidad.`,
  });
  for (const c of cruces) {
    if (c.medidoM3s == null || c.reportadoM3s == null) continue;
    const dif = c.medidoM3s - c.reportadoM3s, rel = c.reportadoM3s > 0.5 ? Math.abs(dif) / c.reportadoM3s : null;
    const discrepa = rel != null ? rel > 0.5 : Math.abs(dif) > 5;
    out.push({
      tono: discrepa ? 'warn' : 'ok', titulo: `Entrada a ${c.presa}`,
      texto: `${c.estacion} mide ${n1(c.medidoM3s)} m³/s (media ${ventanaTxt}); CONAGUA publica una aportación de ${n1(c.reportadoM3s, 2)} m³/s${c.fechaReportado ? ` (dato del ${c.fechaReportado})` : ''}. ${discrepa ? 'Difieren. Son dos medidas distintas (la estación mide el río; CONAGUA deduce la aportación de la operación del vaso) y ambas son provisionales: conviene contrastar con un aforo de campo antes de usar cualquiera.' : 'Son coherentes.'}`,
    });
  }
  if (salida.ibwc != null && salida.sutron != null && Math.abs(salida.sutron - salida.ibwc) > Math.max(5, salida.ibwc)) {
    out.push({ tono: 'warn', titulo: 'Salida en Ojinaga', texto: `El aforo oficial USIBWC da ${n1(salida.ibwc, 2)} m³/s y el sensor Sutron del mismo sitio ${n1(salida.sutron)} m³/s. Se usa el oficial; el Sutron no es confiable para gasto.` });
  } else if (salida.ibwc != null) {
    out.push({ tono: 'info', titulo: 'Salida en Ojinaga', texto: `El aforo oficial USIBWC da ${n1(salida.ibwc, 2)} m³/s (media ${ventanaTxt}).` });
  }
  return out;
}

export function lecturasVasos(items: { etiqueta: string; ultima: EscenaLigera | undefined; anterior: EscenaLigera | undefined; huellaKm2: number | null }[], hoyISO: string): Lectura[] {
  const out: Lectura[] = [];
  const r = resumenVasos(items, hoyISO);
  if (!r.medidos) return [{ tono: 'info', titulo: 'Sin medición', texto: 'Todavía no hay ninguna escena satelital procesada.' }];
  const edad = diasDesde(r.masReciente as string, hoyISO);
  out.push({
    tono: edad > ESCENA_ATRASADA_DIAS ? 'warn' : 'info', titulo: 'Qué tan reciente',
    texto: `La escena más nueva es de hace ${edad} día${edad === 1 ? '' : 's'}. Sentinel-2 pasa cada ${REVISITA_SENTINEL_DIAS} días y solo sirve una pasada sin nubes sobre el vaso: no hay imagen diaria, y con cielo nublado el dato se queda en la última pasada limpia.`,
  });
  const sin = items.filter((i) => i.ultima?.areaKm2 == null);
  if (sin.length) out.push({ tono: 'warn', titulo: 'Sin medición', texto: `${sin.map((i) => i.etiqueta).join(', ')}: ninguna pasada sin nubes procesada todavía.` });
  const cambios = items.filter((i) => i.ultima?.areaKm2 != null && i.anterior?.areaKm2 != null && (i.anterior.areaKm2 as number) > 0)
    .map((i) => ({ i, pct: (((i.ultima as EscenaLigera).areaKm2 as number) / ((i.anterior as EscenaLigera).areaKm2 as number) - 1) * 100 }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  if (cambios.length) {
    const c = cambios[0];
    out.push({ tono: 'info', titulo: 'Mayor cambio del espejo', texto: `${c.i.etiqueta}: ${sig(c.pct, 0)} % entre sus dos últimas escenas (${n1((c.i.anterior as EscenaLigera).areaKm2 as number)} → ${n1((c.i.ultima as EscenaLigera).areaKm2 as number)} km²). ${cambios.filter((x) => x.pct > 2).length} vasos crecen y ${cambios.filter((x) => x.pct < -2).length} se reducen.` });
  }
  const deb = items.filter((i) => i.ultima?.separacionDebil);
  if (deb.length) out.push({ tono: 'warn', titulo: 'Medición poco confiable', texto: `${deb.map((i) => i.etiqueta).join(', ')}: agua y tierra poco separables en la escena; el área es orientativa.` });
  return out;
}

export function lecturasCierres(cuerpos: CuerpoAgua[], cierres: CierreMensual[]): Lectura[] {
  const out: Lectura[] = [];
  const meses = [...new Set(cierres.map((c) => c.mes))].sort();
  if (!meses.length) return out;
  const ult12 = new Set(meses.slice(-12));
  const rec = cierres.filter((c) => ult12.has(c.mes));
  const sd = rec.filter((c) => c.almMm3 == null).length, dif = rec.filter((c) => c.calidad === 'DIFIERE'), rep = rec.filter((c) => c.calidad === 'REPETIDO').length;
  out.push({ tono: sd > rec.length * 0.15 ? 'warn' : 'ok', titulo: 'Cobertura de 12 meses', texto: `${rec.length - sd} de ${rec.length} cierres tienen dato; ${sd} son S/D y ${rep} repiten el mes anterior.` });
  if (dif.length) {
    const peor = [...dif].sort((a, b) => (b.difMaxMm3 ?? 0) - (a.difMaxMm3 ?? 0))[0];
    const nombre = cuerpos.find((c) => c.id === peor.cuerpoId)?.etiqueta ?? peor.cuerpoId;
    out.push({ tono: 'warn', titulo: 'Fuentes que no coinciden', texto: `${dif.length} cierres con diferencia entre fuentes en 12 meses. La mayor: ${nombre}, ${etiquetaMes(peor.mes, true)}${peor.difMaxMm3 != null ? ` (${n1(peor.difMaxMm3, 2)} Mm³)` : ''}. Toque la celda para ver el cuadre.` });
  }
  const ultimoMes = meses[meses.length - 1];
  const sinVigente = cuerpos.filter((c) => { const u = cierres.filter((x) => x.cuerpoId === c.id && x.almMm3 != null).map((x) => x.mes).sort().pop(); return !u || u < sumarMeses(ultimoMes, -2); });
  if (sinVigente.length) out.push({ tono: 'warn', titulo: 'Sin cierre vigente', texto: `${sinVigente.map((c) => c.etiqueta).join(', ')}: sin cierre con dato en los últimos 3 meses.` });
  return out;
}

export function lecturasBalance(b: BalanceCuencaPeriodo, etiquetaPeriodo: string, salida: SalidaCuenca | null): Lectura[] {
  const out: Lectura[] = [];
  if (b.deltaS == null) {
    out.push({ tono: 'info', titulo: 'Resultado', texto: `Sin cierres suficientes para calcular el cambio de almacenamiento en ${etiquetaPeriodo} (S/D).` });
  } else {
    const gana = b.deltaS > 0;
    out.push({
      tono: Math.abs(b.deltaS) < 1 ? 'info' : gana ? 'ok' : 'warn', titulo: 'Resultado',
      texto: `En ${etiquetaPeriodo} los vasos ${Math.abs(b.deltaS) < 1 ? 'quedaron prácticamente igual' : gana ? `ganaron ${n1(b.deltaS)} Mm³` : `perdieron ${n1(Math.abs(b.deltaS))} Mm³`}${b.sIni != null && b.sFin != null ? ` (de ${n1(b.sIni)} a ${n1(b.sFin)} Mm³)` : ''}, con ${b.vasosConDelta} de ${b.vasos.length} vasos${b.deltaParcial ? '; algún vaso solo cubre parte del periodo' : ''}.`,
    });
  }
  if (salida && (salida.mm3 != null || salida.mm3Observado != null)) {
    out.push({
      tono: 'info', titulo: 'Salida por Ojinaga',
      texto: salida.mm3 != null
        ? `Salieron de la cuenca ${n1(salida.mm3)} Mm³ (gasto medio ${n1(salida.gastoMedio as number, 2)} m³/s, ${salida.dias} de ${salida.diasPeriodo} días con dato).${b.entradasCabecera != null && b.entradasCabecera > 0 ? ` Equivale a ${n1((salida.mm3 / b.entradasCabecera) * 100, 0)} % de lo que entró a los vasos de cabecera.` : ''}`
        : `Solo ${salida.dias} de ${salida.diasPeriodo} días con aforo: al menos ${n1(salida.mm3Observado as number)} Mm³ en los días medidos; el total del periodo es S/D.`,
    });
  }
  const cob = b.vasoMesesTotal ? (b.vasoMesesOk / b.vasoMesesTotal) * 100 : 0;
  out.push({ tono: cob < 70 ? 'warn' : 'ok', titulo: 'Qué tan completo', texto: `${b.vasoMesesOk} de ${b.vasoMesesTotal} meses-vaso tienen balance completo (${n1(cob, 0)} %). Las sumas de entradas y salidas solo incluyen los meses con flujo publicado: con huecos son una cota inferior.` });
  const neg = b.vasos.filter((v) => v.residuo != null && v.entradas != null && v.entradas > 0 && v.residuo < -0.1 * v.entradas);
  if (neg.length) out.push({ tono: 'warn', titulo: 'Residuo negativo', texto: `${neg.map((v) => v.cuerpo.etiqueta).join(', ')}: el vaso retuvo más agua de la que explica entradas − salidas. Apunta a aportación subestimada; revisar antes de usar.` });
  return out;
}
