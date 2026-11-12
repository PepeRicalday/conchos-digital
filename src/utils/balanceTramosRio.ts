/**
 * balanceTramos — balance por TRAMO de río: lo que sale de los vasos de arriba contra lo que llega al punto de abajo.
 * Funciones PURAS (sin React ni red). Los tramos salen del catálogo (`aguas_abajo_id`), no de una lista aparte.
 *
 *   no medido = llega − (liberado − derivado)       [Mm³ en el periodo]
 *     liberado = salida total de los vasos de arriba (extracción + vertido, AQUARIUS)
 *     derivado = agua que sale del río en medio y SÍ se mide (hoy: la toma K-0 del Canal Conchos, solo desde mar-2026)
 *     llega    = aportación del vaso de abajo (AQUARIUS) o volumen del aforo de Ojinaga
 *
 * El «no medido» NO es un error: positivo = entra al río más de lo que salió de arriba (escurrimiento propio del tramo,
 * retornos); negativo = se pierde o no se mide en el trayecto (infiltración, evaporación, tomas sin aforo) o la onda llega con desfase.
 * La aportación de CONAGUA se deduce de la operación del vaso de abajo, así que tampoco es independiente del todo.
 * S/D nunca se vuelve 0: un mes en el que falta cualquier dato necesario NO entra a la suma y se cuenta como incompleto.
 */
import { finDeMes, mesesDelRango, salidaCuenca, type Lectura, type LecturaGasto } from './cuencaAnalisis';
import type { BalanceMensual, CuerpoAgua } from './cuerposAgua';

/** La toma K-0 del Canal Conchos queda sobre el río aguas abajo de Boquilla: su gasto se descuenta del tramo que contiene a Boquilla. */
export const ORIGEN_TOMA_K0 = 'CA-LBQCH';

export type DestinoTramo = { tipo: 'vaso'; cuerpo: CuerpoAgua } | { tipo: 'ojinaga' };

export interface TramoDef {
  id: string;
  nombre: string;
  /** Vasos de arriba CON telemetría: su salida se mide y se suma. */
  origenes: CuerpoAgua[];
  /** Vasos de arriba SIN telemetría (ni AQUARIUS ni SINA diario): su aporte no se mide y queda dentro de «no medido». */
  sinMedir: CuerpoAgua[];
  destino: DestinoTramo;
  /** true = se descuenta la toma K-0 (el tramo contiene a Boquilla). */
  derivaK0: boolean;
}

const tieneTelemetria = (c: CuerpoAgua) => c.aqwpUbicacionId != null;

/** Primer vaso de aguas abajo que SÍ tiene telemetría (salta los reguladores sin dato, como La Colina). null = sale de la cuenca. */
function destinoEfectivo(c: CuerpoAgua, porId: Map<string, CuerpoAgua>): CuerpoAgua | null {
  const visto = new Set<string>([c.id]);
  let sig = c.aguasAbajoId ? porId.get(c.aguasAbajoId) : undefined;
  while (sig && !visto.has(sig.id)) {
    if (tieneTelemetria(sig)) return sig;
    visto.add(sig.id);
    sig = sig.aguasAbajoId ? porId.get(sig.aguasAbajoId) : undefined;
  }
  return null;
}

/** Tramos del catálogo, de aguas arriba a aguas abajo. El último vaso con telemetría que no descarga a otro cierra contra Ojinaga. */
export function definirTramos(cuerpos: CuerpoAgua[]): TramoDef[] {
  const porId = new Map(cuerpos.map((c) => [c.id, c]));
  const orden = [...cuerpos].sort((a, b) => a.ordenRed - b.ordenRed);
  const grupos = new Map<string, { destino: DestinoTramo; origenes: CuerpoAgua[]; sinMedir: CuerpoAgua[] }>();
  const clave = (d: CuerpoAgua | null) => (d ? d.id : 'ojinaga');
  const grupo = (d: CuerpoAgua | null) => {
    const k = clave(d);
    let g = grupos.get(k);
    if (!g) { g = { destino: d ? { tipo: 'vaso', cuerpo: d } : { tipo: 'ojinaga' }, origenes: [], sinMedir: [] }; grupos.set(k, g); }
    return g;
  };
  for (const c of orden) {
    const d = destinoEfectivo(c, porId);
    if (tieneTelemetria(c)) {
      // Un vaso que descarga al siguiente es origen de su tramo; el último de la cadena cierra contra Ojinaga.
      grupo(d).origenes.push(c);
    } else if (c.rol !== 'reguladora') {
      // Un vaso de almacenamiento sin telemetría: su aporte llega al destino pero no se mide.
      grupo(d).sinMedir.push(c);
    }
    // Un regulador sin telemetría solo transmite lo que recibe: no es origen ni aporte propio.
  }
  const tramos: TramoDef[] = [];
  for (const g of grupos.values()) {
    if (!g.origenes.length) continue; // sin vasos medidos arriba no hay nada que comparar
    const destEt = g.destino.tipo === 'vaso' ? g.destino.cuerpo.etiqueta : 'Ojinaga (salida de la cuenca)';
    const nombre = g.origenes.length <= 2 ? `${g.origenes.map((o) => o.etiqueta).join(' + ')} → ${destEt}` : `Vasos de arriba → ${destEt}`;
    tramos.push({
      id: `tramo:${g.origenes.map((o) => o.id).join('+')}>${g.destino.tipo === 'vaso' ? g.destino.cuerpo.id : 'ojinaga'}`,
      nombre, origenes: g.origenes, sinMedir: g.sinMedir, destino: g.destino, derivaK0: g.origenes.some((o) => o.id === ORIGEN_TOMA_K0),
    });
  }
  const posDestino = (t: TramoDef) => (t.destino.tipo === 'ojinaga' ? 1e6 : t.destino.cuerpo.ordenRed);
  return tramos.sort((a, b) => posDestino(a) - posDestino(b));
}

// ── Cálculo por mes y por periodo ───────────────────────────────────────────────────────────────────────────────────
export interface MesTramo {
  mes: string;
  liberado: number | null;
  derivado: number | null;
  llega: number | null;
  /** null mientras falte cualquier dato del mes. */
  noMedido: number | null;
  completo: boolean;
  /** Primer dato que falta, en una frase. null si el mes está completo. */
  motivo: string | null;
}

export interface ResultadoTramo {
  def: TramoDef;
  meses: MesTramo[];
  mesesCompletos: number;
  mesesPeriodo: number;
  /** Sumas SOLO sobre los meses completos (nunca mezclan meses con y sin dato). null si no hubo ningún mes completo. */
  liberado: number | null;
  derivado: number | null;
  llega: number | null;
  noMedido: number | null;
  /** noMedido / (liberado − derivado), en %. null si el neto liberado es < 1 Mm³ (el cociente no dice nada). */
  noMedidoPct: number | null;
  /** Motivos por los que se descartaron meses, del más frecuente al menos. */
  descartes: { motivo: string; meses: number }[];
}

export interface FuentesTramo {
  /** Volumen mensual que pasa por Ojinaga (Mm³), null con cobertura insuficiente. */
  ojinagaMes: (mes: string) => number | null;
  /** Volumen mensual derivado en la toma K-0 (Mm³), null con cobertura insuficiente. */
  k0Mes: (mes: string) => number | null;
}

/** Fuentes mensuales a partir de series diarias de gasto (m³/s). Usa la misma regla de cobertura (≥ 60 %) que la salida de la cuenca. */
export function fuentesDeGastos(ojinaga: LecturaGasto[] | null, k0: LecturaGasto[] | null, hoyISO: string): FuentesTramo {
  const vol = (l: LecturaGasto[] | null) => (mes: string) => (l ? salidaCuenca(l, mes, finDeMes(mes), hoyISO).mm3 : null);
  return { ojinagaMes: vol(ojinaga), k0Mes: vol(k0) };
}

const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function balanceTramos(defs: TramoDef[], balances: BalanceMensual[], rango: { desde: string; hasta: string }, fuentes: FuentesTramo): ResultadoTramo[] {
  const meses = mesesDelRango(rango);
  const fila = new Map(balances.map((b) => [`${b.cuerpoId}|${b.mes}`, b]));
  return defs.map((def) => {
    const porMes: MesTramo[] = meses.map((mes) => {
      let motivo: string | null = null;
      const salidas: number[] = [];
      for (const o of def.origenes) {
        const s = fila.get(`${o.id}|${mes}`)?.salidaTotal ?? null;
        if (s == null) { motivo ??= `sin salida de ${o.etiqueta}`; } else salidas.push(s);
      }
      const liberado = motivo == null ? suma(salidas) : null;
      const llega = def.destino.tipo === 'vaso' ? (fila.get(`${def.destino.cuerpo.id}|${mes}`)?.entradas ?? null) : fuentes.ojinagaMes(mes);
      if (llega == null) motivo ??= def.destino.tipo === 'vaso' ? `sin aportación de ${def.destino.cuerpo.etiqueta}` : 'sin aforo en Ojinaga';
      const derivado = def.derivaK0 ? fuentes.k0Mes(mes) : 0;
      if (derivado == null) motivo ??= 'sin gasto medido en la toma K-0';
      const completo = motivo == null;
      return {
        mes, liberado, derivado: def.derivaK0 ? derivado : null, llega,
        noMedido: completo ? (llega as number) - ((liberado as number) - (derivado as number)) : null, completo, motivo,
      };
    });
    const ok = porMes.filter((m) => m.completo);
    const cuenta = new Map<string, number>();
    for (const m of porMes) if (m.motivo) cuenta.set(m.motivo, (cuenta.get(m.motivo) ?? 0) + 1);
    const liberado = ok.length ? suma(ok.map((m) => m.liberado as number)) : null;
    const derivado = ok.length && def.derivaK0 ? suma(ok.map((m) => m.derivado as number)) : null;
    const llega = ok.length ? suma(ok.map((m) => m.llega as number)) : null;
    const noMedido = ok.length ? suma(ok.map((m) => m.noMedido as number)) : null;
    const neto = liberado == null ? null : liberado - (derivado ?? 0);
    return {
      def, meses: porMes, mesesCompletos: ok.length, mesesPeriodo: meses.length, liberado, derivado, llega, noMedido,
      noMedidoPct: noMedido != null && neto != null && neto >= 1 ? (noMedido / neto) * 100 : null,
      descartes: [...cuenta].map(([motivo, n]) => ({ motivo, meses: n })).sort((a, b) => b.meses - a.meses),
    };
  });
}

// ── Lectura en una frase por tramo ──────────────────────────────────────────────────────────────────────────────────
/** Referencia interna de SICA, no una norma: hasta 10 % de lo liberado sin explicar se considera cuadrado; más de 25 % pide revisar. */
export const UMBRAL_CUADRA_PCT = 10;
export const UMBRAL_REVISAR_PCT = 25;

const n1 = (v: number) => v.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const conSigno = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n1(Math.abs(v))}`;

export function lecturasTramos(resultados: ResultadoTramo[], frasePeriodo: string): Lectura[] {
  return resultados.map((r): Lectura => {
    if (r.mesesCompletos === 0 || r.noMedido == null || r.liberado == null || r.llega == null) {
      const principal = r.descartes[0];
      return {
        tono: 'info', titulo: `${r.def.nombre}: sin balance`,
        texto: `Ningún mes tiene todos los datos en ${frasePeriodo}${principal ? ` (${principal.motivo} en ${principal.meses} de ${r.mesesPeriodo} meses)` : ''}. No se muestra cifra: un dato que falta no se cuenta como cero.`,
      };
    }
    const pct = r.noMedidoPct;
    const tono = pct == null ? 'info' : Math.abs(pct) <= UMBRAL_CUADRA_PCT ? 'ok' : Math.abs(pct) > UMBRAL_REVISAR_PCT ? 'warn' : 'info';
    const salio = r.derivado != null ? `${n1(r.liberado)} Mm³ (menos ${n1(r.derivado)} derivados en K-0)` : `${n1(r.liberado)} Mm³`;
    const sentido = r.noMedido > 0 ? 'entró más de lo que salió de arriba (escurrimiento propio del tramo o retornos)' : r.noMedido < 0 ? 'llegó menos de lo que salió de arriba (pérdidas, tomas sin aforo o desfase de la onda)' : 'cuadra';
    return {
      tono, titulo: `${r.def.nombre}: ${conSigno(r.noMedido)} Mm³ sin medir${pct != null ? ` (${conSigno(pct)} %)` : ''}`,
      texto: `En ${frasePeriodo} salieron ${salio} y llegaron ${n1(r.llega)} Mm³: ${sentido}. Con ${r.mesesCompletos} de ${r.mesesPeriodo} meses completos${r.def.sinMedir.length ? `; el aporte de ${r.def.sinMedir.map((c) => c.etiqueta).join(', ')} no se mide` : ''}.`,
    };
  });
}
