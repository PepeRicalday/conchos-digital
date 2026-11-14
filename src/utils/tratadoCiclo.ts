// Tratado de Aguas de 1944 · avance del ciclo quinquenal. Lógica pura (sin red ni React), con pruebas.
// Regla de la casa: S/D (null) nunca se vuelve 0. Un periodo con poca cobertura se dice «cota inferior».

export const M3_POR_AF = 1233.4818;
/** Acre-pies por millón de m³. */
export const AF_POR_MM3 = 1_000_000 / M3_POR_AF;
export const M3S_DIA_A_MM3 = 0.0864;
export const COBERTURA_MIN_TRATADO = 60; // % de días con dato para estimar un volumen de periodo

export const tcmAAf = (tcm: number) => (tcm * 1000) / M3_POR_AF;
export const afAMm3 = (af: number) => (af * M3_POR_AF) / 1_000_000;
export const mm3AAf = (mm3: number) => mm3 * AF_POR_MM3;

// ── Tipos de entrada (lo que traen las tablas) ───────────────────────────────────────────────────────────
export interface CicloTratado {
  id: string; nombre: string; inicio: string; fin: string;
  compromisoAf: number; compromisoAnualAf: number; deudaPreviaAf: number | null; deudaRemanenteAf: number | null;
}
export interface CorteOficial { fecha: string; acumuladoAf: number; acumuladoMcm: number | null; deudaRemanenteAf: number | null }
export interface EntregaDiaria { afluente: string; fecha: string; tcm: number | null }
export interface CapturaMx { id: number; desde: string; hasta: string; mm3: number; fuente: string; comentario: string | null; autor: string | null; creadoEn: string; anulada: boolean }
export interface SutronDia { fecha: string; gastoMedio: number; lecturas: number }
export interface Afluente { clave: string; nombre: string; estacion: string; orden: number }

export const CICLO_POR_DEFECTO: CicloTratado = {
  id: 'C37', nombre: 'Ciclo 2025-2030', inicio: '2025-10-25', fin: '2030-10-24', compromisoAf: 1_750_000, compromisoAnualAf: 350_000,
  deudaPreviaAf: 865_139, deudaRemanenteAf: 861_980,
};

// ── Fechas (YYYY-MM-DD, sin zona horaria: aritmética en UTC) ─────────────────────────────────────────────
const MS_DIA = 86_400_000;
const t = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const sumaDias = (iso: string, n: number) => new Date(t(iso) + n * MS_DIA).toISOString().slice(0, 10);
/** Días entre dos fechas (b − a). */
export const diasEntre = (a: string, b: string) => Math.round((t(b) - t(a)) / MS_DIA);
/** Días del periodo, ambos extremos incluidos. */
export const diasInclusive = (a: string, b: string) => diasEntre(a, b) + 1;
const minF = (a: string, b: string) => (a < b ? a : b);
const maxF = (a: string, b: string) => (a > b ? a : b);

export const diasCiclo = (c: CicloTratado) => diasInclusive(c.inicio, c.fin); // 1826

/** Año del ciclo (1 a 5) de una fecha; null fuera del ciclo. */
export function anioDelCiclo(c: CicloTratado, fecha: string): number | null {
  if (fecha < c.inicio || fecha > c.fin) return null;
  // Los años del ciclo corren de aniversario a aniversario (25-oct → 24-oct), no por bloques de 365 días.
  return Math.min(5, +fecha.slice(0, 4) - +c.inicio.slice(0, 4) + (fecha.slice(4) >= c.inicio.slice(4) ? 1 : 0));
}
/** Rango de un año del ciclo: 25-oct → 24-oct del siguiente. El año 5 llega hasta el fin del ciclo. */
export function rangoAnioCiclo(c: CicloTratado, anio: number): { desde: string; hasta: string } {
  const y0 = +c.inicio.slice(0, 4);
  const desde = `${y0 + anio - 1}${c.inicio.slice(4)}`;
  const hasta = anio >= 5 ? c.fin : sumaDias(`${y0 + anio}${c.inicio.slice(4)}`, -1);
  return { desde, hasta };
}

// ── Periodos del informe ─────────────────────────────────────────────────────────────────────────────────
export type PeriodoSel =
  | { tipo: 'ciclo' }
  | { tipo: 'anio'; anio: number }
  | { tipo: 'mes'; mes: string }               // 'YYYY-MM'
  | { tipo: 'rango'; desde: string; hasta: string };

export interface Periodo { clave: string; etiqueta: string; desde: string; hasta: string; esActual: boolean }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmtDia = (iso: string) => `${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1].slice(0, 3)} ${iso.slice(0, 4)}`;
export const fechaLargaTratado = (iso: string) => `${+iso.slice(8, 10)} de ${MESES[+iso.slice(5, 7) - 1]} de ${iso.slice(0, 4)}`;

/** Resuelve la selección a fechas, recortadas al ciclo y a hoy (el futuro no tiene datos). */
export function resuelvePeriodo(c: CicloTratado, sel: PeriodoSel, hoy: string): Periodo {
  let desde: string, hasta: string, etiqueta: string, clave: string;
  if (sel.tipo === 'anio') {
    ({ desde, hasta } = rangoAnioCiclo(c, Math.min(5, Math.max(1, sel.anio))));
    etiqueta = `Año ${sel.anio} del ciclo (${fmtDia(desde)} – ${fmtDia(hasta)})`; clave = `anio${sel.anio}`;
  } else if (sel.tipo === 'mes') {
    const y = +sel.mes.slice(0, 4), m = +sel.mes.slice(5, 7);
    desde = `${sel.mes}-01`;
    hasta = sumaDias(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
    etiqueta = `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} de ${y}`; clave = sel.mes;
  } else if (sel.tipo === 'rango') {
    desde = sel.desde <= sel.hasta ? sel.desde : sel.hasta; hasta = sel.desde <= sel.hasta ? sel.hasta : sel.desde;
    etiqueta = `${fmtDia(desde)} – ${fmtDia(hasta)}`; clave = `${desde}_${hasta}`;
  } else {
    desde = c.inicio; hasta = c.fin; etiqueta = `${c.nombre} (${fmtDia(c.inicio)} – ${fmtDia(c.fin)})`; clave = 'ciclo';
  }
  const finalDesde = maxF(desde, c.inicio);
  const finalHasta = minF(minF(hasta, c.fin), hoy);
  return { clave, etiqueta, desde: finalDesde, hasta: finalHasta, esActual: hoy >= finalDesde && hoy <= hasta };
}

/** Meses del ciclo con al menos un día transcurrido, del más reciente al más antiguo. */
export function mesesDelCiclo(c: CicloTratado, hoy: string): string[] {
  const out: string[] = [];
  let y = +c.inicio.slice(0, 4), m = +c.inicio.slice(5, 7);
  for (;;) {
    const mes = `${y}-${String(m).padStart(2, '0')}`;
    if (`${mes}-01` > hoy || `${mes}-01` > c.fin) break;
    out.push(mes);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out.reverse();
}

// ── Volúmenes por afluente (series del IBWC) ─────────────────────────────────────────────────────────────
export interface VolumenAfluente { clave: string; nombre: string; estacion: string; af: number | null; mm3: number | null; dias: number; diasPeriodo: number; cobertura: number; completo: boolean }
export interface VolumenPeriodo {
  desde: string; hasta: string; diasPeriodo: number;
  afluentes: VolumenAfluente[];
  totalAf: number; totalMm3: number;
  /** Algún afluente con huecos: el total es cota inferior. */
  cotaInferior: boolean;
}

/** Suma de TCM de un afluente en [desde, hasta]. Los días S/D no suman (ni se rellenan): se informa la cobertura. */
export function volumenPeriodo(entregas: EntregaDiaria[], afluentes: Afluente[], desde: string, hasta: string): VolumenPeriodo {
  const diasPeriodo = hasta >= desde ? diasInclusive(desde, hasta) : 0;
  const porAfl = new Map<string, Map<string, number>>();
  for (const e of entregas) {
    if (e.tcm == null || !Number.isFinite(e.tcm) || e.fecha < desde || e.fecha > hasta) continue;
    (porAfl.get(e.afluente) ?? porAfl.set(e.afluente, new Map()).get(e.afluente)!).set(e.fecha, e.tcm);
  }
  const lista = [...afluentes].sort((a, b) => a.orden - b.orden).map((a): VolumenAfluente => {
    const dias = porAfl.get(a.clave);
    const n = dias?.size ?? 0;
    const tcm = dias ? [...dias.values()].reduce((s, v) => s + v, 0) : 0;
    const cobertura = diasPeriodo > 0 ? (n / diasPeriodo) * 100 : 0;
    return {
      clave: a.clave, nombre: a.nombre, estacion: a.estacion,
      af: n > 0 ? tcmAAf(tcm) : null, mm3: n > 0 ? tcm / 1000 : null, dias: n, diasPeriodo, cobertura,
      completo: n >= diasPeriodo && diasPeriodo > 0,
    };
  });
  const totalAf = lista.reduce((s, a) => s + (a.af ?? 0), 0);
  return { desde, hasta, diasPeriodo, afluentes: lista, totalAf, totalMm3: afAMm3(totalAf), cotaInferior: lista.some((a) => !a.completo) };
}

/** Serie acumulada (AF) de la suma publicada de los seis afluentes, un punto por día con dato en alguna serie. */
export function serieAcumuladaPublicada(entregas: EntregaDiaria[], desde: string, hasta: string): { fecha: string; af: number }[] {
  const porDia = new Map<string, number>();
  for (const e of entregas) {
    if (e.tcm == null || !Number.isFinite(e.tcm) || e.fecha < desde || e.fecha > hasta) continue;
    porDia.set(e.fecha, (porDia.get(e.fecha) ?? 0) + tcmAAf(e.tcm));
  }
  let acum = 0;
  return [...porDia.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([fecha, af]) => ({ fecha, af: (acum += af) }));
}

// ── Avance oficial del ciclo ─────────────────────────────────────────────────────────────────────────────
export type EstadoAvance = 'adelante' | 'en_meta' | 'atrasado' | 'sd';

export interface AvanceCiclo {
  corte: CorteOficial | null;
  diasTranscurridos: number | null; diasRestantes: number | null; anio: number | null;
  acumuladoAf: number | null; acumuladoMm3: number | null;
  pctCompromiso: number | null;
  metaLinealAf: number | null; difLinealAf: number | null; estado: EstadoAvance;
  /** Meta lineal que incluye la deuda del ciclo anterior (la tercera referencia de la gráfica del IBWC). */
  metaConDeudaAf: number | null;
  faltanteAf: number | null;
  ritmoActualAfDia: number | null;       // acumulado / días transcurridos
  ritmoRequeridoAfDia: number | null;    // faltante / días restantes
  ritmoRequeridoM3s: number | null;
  proyeccionFinAf: number | null;        // tendencia lineal, NO pronóstico
  deudaRemanenteAf: number | null;
  /** Cambio entre los dos últimos cortes (los «aumentos»). */
  deltaAf: number | null; deltaDias: number | null; deltaAfSemana: number | null; cortePrevio: CorteOficial | null;
}

export function avanceCiclo(c: CicloTratado, cortes: CorteOficial[]): AvanceCiclo {
  const orden = [...cortes].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const corte = orden[0] ?? null;
  const vacio: AvanceCiclo = {
    corte: null, diasTranscurridos: null, diasRestantes: null, anio: null, acumuladoAf: null, acumuladoMm3: null, pctCompromiso: null,
    metaLinealAf: null, difLinealAf: null, estado: 'sd', metaConDeudaAf: null, faltanteAf: null, ritmoActualAfDia: null,
    ritmoRequeridoAfDia: null, ritmoRequeridoM3s: null, proyeccionFinAf: null, deudaRemanenteAf: c.deudaRemanenteAf,
    deltaAf: null, deltaDias: null, deltaAfSemana: null, cortePrevio: null,
  };
  if (!corte) return vacio;
  const total = diasCiclo(c);
  const trans = Math.max(1, diasInclusive(c.inicio, minF(corte.fecha, c.fin)));
  const rest = Math.max(0, diasEntre(corte.fecha, c.fin));
  const meta = (c.compromisoAf * trans) / total;
  const dif = corte.acumuladoAf - meta;
  const faltante = Math.max(0, c.compromisoAf - corte.acumuladoAf);
  const ritmoDia = corte.acumuladoAf / trans;
  const prev = orden[1] ?? null;
  const dDias = prev ? diasEntre(prev.fecha, corte.fecha) : null;
  const dAf = prev ? corte.acumuladoAf - prev.acumuladoAf : null;
  const deuda = corte.deudaRemanenteAf ?? c.deudaRemanenteAf;
  return {
    corte, diasTranscurridos: trans, diasRestantes: rest, anio: anioDelCiclo(c, corte.fecha),
    acumuladoAf: corte.acumuladoAf, acumuladoMm3: afAMm3(corte.acumuladoAf),
    pctCompromiso: (corte.acumuladoAf / c.compromisoAf) * 100,
    metaLinealAf: meta, difLinealAf: dif,
    estado: Math.abs(dif) <= c.compromisoAf * 0.005 ? 'en_meta' : dif > 0 ? 'adelante' : 'atrasado',
    metaConDeudaAf: ((c.compromisoAf + (c.deudaPreviaAf ?? 0)) * trans) / total,
    faltanteAf: faltante, ritmoActualAfDia: ritmoDia,
    ritmoRequeridoAfDia: rest > 0 ? faltante / rest : null,
    ritmoRequeridoM3s: rest > 0 ? (faltante * M3_POR_AF) / 86_400 / rest : null,
    proyeccionFinAf: ritmoDia * total,
    deudaRemanenteAf: deuda,
    deltaAf: dAf, deltaDias: dDias, deltaAfSemana: dAf != null && dDias ? (dAf / dDias) * 7 : null, cortePrevio: prev,
  };
}

/** Líneas de referencia para la gráfica (AF acumulados) en una fecha: meta lineal y meta con deuda. */
export function metasEn(c: CicloTratado, fecha: string): { lineal: number; conDeuda: number } {
  const trans = Math.min(diasCiclo(c), Math.max(0, diasInclusive(c.inicio, fecha)));
  const f = trans / diasCiclo(c);
  return { lineal: c.compromisoAf * f, conDeuda: (c.compromisoAf + (c.deudaPreviaAf ?? 0)) * f };
}

// ── Conciliación de tres fuentes en un periodo ───────────────────────────────────────────────────────────
export interface FuenteConciliacion {
  clave: 'ibwc_total' | 'ibwc_conchos' | 'sica_ojinaga' | 'conagua';
  nombre: string; mm3: number | null; af: number | null;
  /** Cobertura en % de días con dato (null si no aplica, p. ej. captura oficial). */
  cobertura: number | null; nota: string;
}
export interface Conciliacion {
  fuentes: FuenteConciliacion[];
  /** Conchos medido por SICA frente al Conchos del IBWC. */
  razonSicaIbwc: number | null; difSicaIbwcMm3: number | null;
  /** Días en que Sutron e IBWC tienen dato a la vez (base de la razón). */
  diasComunesSica: number;
  /** Captura CONAGUA frente a la suma publicada del IBWC. */
  difConaguaIbwcMm3: number | null; difConaguaIbwcPct: number | null;
  sicaConfiable: boolean;
}
export const RAZON_SICA_UMBRAL = 3; // fuera de [1/3, 3] el Sutron se declara no confiable (igual que hidroComparacion)

export function sutronPeriodo(sutron: SutronDia[], desde: string, hasta: string) {
  const diasPeriodo = hasta >= desde ? diasInclusive(desde, hasta) : 0;
  const dias = sutron.filter((s) => s.fecha >= desde && s.fecha <= hasta && Number.isFinite(s.gastoMedio));
  const mm3 = dias.reduce((s, d) => s + d.gastoMedio * M3S_DIA_A_MM3, 0);
  return { mm3: dias.length ? mm3 : null, dias: dias.length, diasPeriodo, cobertura: diasPeriodo ? (dias.length / diasPeriodo) * 100 : 0 };
}

/** Las capturas vigentes que caen COMPLETAS dentro del periodo (una captura parcial no se prorratea). */
export function capturaPeriodo(capturas: CapturaMx[], desde: string, hasta: string): { mm3: number | null; n: number } {
  const dentro = capturas.filter((k) => !k.anulada && k.desde >= desde && k.hasta <= hasta);
  return { mm3: dentro.length ? dentro.reduce((s, k) => s + k.mm3, 0) : null, n: dentro.length };
}

/**
 * Conciliación de las cuatro fuentes. La comparación SICA-IBWC se hace SOLO en los días en que ambos tienen dato (el Sutron arrancó
 * el 25-sep-2026 y el aforo del IBWC cubre todo el periodo: compararlos completos exagera la brecha).
 */
export function concilia(vol: VolumenPeriodo, sutron: SutronDia[], capturas: CapturaMx[], entregas: EntregaDiaria[] = []): Conciliacion {
  const conchos = vol.afluentes.find((a) => a.clave === 'conchos');
  const s = sutronPeriodo(sutron, vol.desde, vol.hasta);
  const k = capturaPeriodo(capturas, vol.desde, vol.hasta);
  const ibwcPorDia = new Map<string, number>();
  for (const e of entregas) if (e.afluente === 'conchos' && e.tcm != null && Number.isFinite(e.tcm) && e.fecha >= vol.desde && e.fecha <= vol.hasta) ibwcPorDia.set(e.fecha, e.tcm);
  let sica = 0, ibwc = 0, comunes = 0;
  for (const d of sutron) {
    const i = ibwcPorDia.get(d.fecha);
    if (i == null || !Number.isFinite(d.gastoMedio) || d.fecha < vol.desde || d.fecha > vol.hasta) continue;
    sica += d.gastoMedio * M3S_DIA_A_MM3; ibwc += i / 1000; comunes++;
  }
  const razon = comunes > 0 && ibwc > 0 ? sica / ibwc : null;
  const fuera = razon != null && (razon > RAZON_SICA_UMBRAL || razon < 1 / RAZON_SICA_UMBRAL);
  const difMx = k.mm3 != null && vol.totalMm3 > 0 ? k.mm3 - vol.totalMm3 : null;
  return {
    fuentes: [
      { clave: 'ibwc_total', nombre: 'EUA · IBWC, seis afluentes', mm3: vol.totalAf > 0 ? vol.totalMm3 : null, af: vol.totalAf > 0 ? vol.totalAf : null,
        cobertura: vol.afluentes.length ? Math.min(...vol.afluentes.map((a) => a.cobertura)) : null,
        nota: vol.cotaInferior ? 'Suma publicada (provisional); hay días sin dato: es cota inferior' : 'Suma publicada (provisional)' },
      { clave: 'ibwc_conchos', nombre: 'EUA · IBWC, Río Conchos (08373000)', mm3: conchos?.mm3 ?? null, af: conchos?.af ?? null, cobertura: conchos?.cobertura ?? null, nota: 'Aforo oficial en Ojinaga' },
      { clave: 'sica_ojinaga', nombre: 'México · SICA, Sutron Ojinaga', mm3: s.mm3, af: s.mm3 != null ? mm3AAf(s.mm3) : null, cobertura: s.cobertura,
        nota: s.mm3 == null ? 'Sin lecturas en el periodo' : fuera ? 'Medición propia fuera de rango: curva o unidad sin calibrar' : 'Medición propia (GOES)' },
      { clave: 'conagua', nombre: 'México · CONAGUA/CILA (captura oficial)', mm3: k.mm3, af: k.mm3 != null ? mm3AAf(k.mm3) : null, cobertura: null,
        nota: k.n ? `${k.n} captura${k.n === 1 ? '' : 's'} vigente${k.n === 1 ? '' : 's'}` : 'Sin captura oficial en el periodo' },
    ],
    razonSicaIbwc: razon, diasComunesSica: comunes,
    difSicaIbwcMm3: comunes > 0 ? sica - ibwc : null,
    difConaguaIbwcMm3: difMx,
    difConaguaIbwcPct: difMx != null && vol.totalMm3 > 0 ? (difMx / vol.totalMm3) * 100 : null,
    sicaConfiable: razon != null && !fuera,
  };
}

/** Brecha entre el corte oficial IBWC y lo que suman las series publicadas al mismo día (explica la diferencia). */
export function brechaOficialVsPublicado(entregas: EntregaDiaria[], c: CicloTratado, corte: CorteOficial | null) {
  if (!corte) return null;
  const pub = serieAcumuladaPublicada(entregas, c.inicio, corte.fecha);
  const af = pub.length ? pub[pub.length - 1].af : null;
  return af == null ? null : { publicadoAf: af, oficialAf: corte.acumuladoAf, difAf: corte.acumuladoAf - af, pct: ((corte.acumuladoAf - af) / corte.acumuladoAf) * 100 };
}

// ── Series mensuales y semanales ─────────────────────────────────────────────────────────────────────────
export interface FilaMes { mes: string; afluentes: Record<string, number>; totalAf: number }
export function volumenMensual(entregas: EntregaDiaria[], desde: string, hasta: string): FilaMes[] {
  const m = new Map<string, FilaMes>();
  for (const e of entregas) {
    if (e.tcm == null || !Number.isFinite(e.tcm) || e.fecha < desde || e.fecha > hasta) continue;
    const mes = e.fecha.slice(0, 7);
    const f = m.get(mes) ?? m.set(mes, { mes, afluentes: {}, totalAf: 0 }).get(mes)!;
    const af = tcmAAf(e.tcm);
    f.afluentes[e.afluente] = (f.afluentes[e.afluente] ?? 0) + af;
    f.totalAf += af;
  }
  return [...m.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1));
}

/** Gasto medio (m³/s) equivalente de un volumen en AF durante n días. */
export const afAGastoM3s = (af: number, dias: number) => (dias > 0 ? (af * M3_POR_AF) / 86_400 / dias : null);

// ── Lectura en palabras (para la tarjeta y el informe) ───────────────────────────────────────────────────
export function lecturaAvance(a: AvanceCiclo): string {
  if (a.corte == null || a.acumuladoAf == null || a.pctCompromiso == null || a.difLinealAf == null) return 'Sin corte oficial del IBWC (S/D).';
  const dif = Math.abs(a.difLinealAf);
  const pos = a.estado === 'adelante' ? `${fmtAf(dif)} AF por delante de la meta lineal` : a.estado === 'atrasado' ? `${fmtAf(dif)} AF por debajo de la meta lineal` : 'en la meta lineal';
  return `Al ${fechaLargaTratado(a.corte.fecha)} el IBWC registra ${fmtAf(a.acumuladoAf)} AF entregados (${a.pctCompromiso.toFixed(1)} % de ${fmtAf(1_750_000)} AF), ${pos}.`;
}
export const fmtAf = (n: number) => Math.round(n).toLocaleString('en-US');
