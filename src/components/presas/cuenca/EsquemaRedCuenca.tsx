import { useId, useMemo } from 'react';
import { useDevice } from '../../../hooks/useDevice';
import { estadoEmbalse } from '../../../utils/presaNiveles';
import { formatearNumero } from '../../../utils/historicoPresas';
import { construirRed, etiquetaMes, ultimoCierreConDato, type CierreMensual, type CuerpoAgua, type NodoRed } from '../../../utils/cuerposAgua';
import { GLIFO_ESTADO } from '../../../utils/presaNiveles';

const BW = 168, BH = 64, GAP_X = 58, PAD = 12, PAD_T = 34, PH = 22;
/** Meses completos entre dos primeros-de-mes (AAAA-MM-01). */
const diaCorto = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
const mesesEntre = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

interface Nodo { id: string; x: number; y: number; salida?: boolean; red?: NodoRed; destino: string }

/**
 * Esquema unifilar de la cuenca: cada presa en su lugar de aguas arriba a aguas abajo, hasta la salida (aforo de Ojinaga).
 * Horizontal en pantallas anchas y vertical en teléfono. Muestra el último cierre mensual con dato de cada cuerpo (con su mes) y no
 * inventa el de los que no lo tienen. La topología es la inicial del catálogo y está por confirmar con CONAGUA.
 */
/** Lectura del día de un vaso (telemetría diaria): si es más nueva que el cierre mensual, es la que se dibuja. */
export interface VasoHoy { almMm3: number | null; pct: number | null; fecha: string | null }
/** Estación hidrométrica dibujada junto a un vaso: arriba si mide su entrada, abajo si mide el cauce aguas abajo. */
export interface EstacionEsquema { id: string; nombre: string; cuerpoId: string; lado: 'entrada' | 'abajo'; texto: string; enLinea: boolean }

export default function EsquemaRedCuenca({ cuerpos, cierres, ojinagaM3s, ojinagaFecha, hoy, estaciones = [] }: {
  cuerpos: CuerpoAgua[]; cierres: CierreMensual[]; ojinagaM3s: number | null; ojinagaFecha: string | null;
  hoy?: Map<string, VasoHoy>; estaciones?: EstacionEsquema[];
}) {
  const uid = useId().replace(/:/g, '');
  const { esPhone } = useDevice();
  const red = useMemo(() => construirRed(cuerpos), [cuerpos]);
  const ultimo = useMemo(() => new Map(cuerpos.map((c) => [c.id, ultimoCierreConDato(cierres.filter((x) => x.cuerpoId === c.id))])), [cuerpos, cierres]);

  const dis = useMemo(() => {
    if (!red.length) return null;
    const L = Math.max(...red.map((n) => n.nivel));
    // columna = saltos desde la cabecera: la salida de la cuenca es la última
    const cols = new Map<number, NodoRed[]>();
    for (const n of red) cols.set(L - n.nivel, [...(cols.get(L - n.nivel) ?? []), n]);
    const nCols = L + 2;
    const nodos: Nodo[] = [];
    if (esPhone) {
      // Vertical: de 2 en 2 por fila (6 cajas de 160 px no caben en un teléfono sin quedar ilegibles).
      const POR_FILA = 2, SEP = 10, GAP_V = 58;
      const ancho = PAD * 2 + POR_FILA * BW + (POR_FILA - 1) * SEP;
      let fila = 0;
      for (let c = 0; c < nCols - 1; c++) {
        const lista = cols.get(c) ?? [];
        for (let i = 0; i < lista.length; i += POR_FILA) {
          const trozo = lista.slice(i, i + POR_FILA);
          const off = (ancho - (trozo.length * BW + (trozo.length - 1) * SEP)) / 2;
          trozo.forEach((n, k) => nodos.push({ id: n.cuerpo.id, x: off + k * (BW + SEP), y: PAD_T + fila * (BH + GAP_V), red: n, destino: n.cuerpo.aguasAbajoId ?? 'salida' }));
          fila++;
        }
      }
      nodos.push({ id: 'salida', x: (ancho - BW) / 2, y: PAD_T + fila * (BH + GAP_V), salida: true, destino: '' });
      return { nodos, ancho, alto: PAD_T + PAD + (fila + 1) * BH + fila * GAP_V, vertical: true };
    }
    // Con estaciones hidrométricas se deja sitio para la píldora de arriba y la de abajo de cada caja.
    const GAP_Y = estaciones.length ? 66 : 34;
    const maxPorCol = Math.max(...[...cols.values()].map((v) => v.length), 1);
    const alto = PAD_T * 2 + maxPorCol * BH + (maxPorCol - 1) * GAP_Y;
    for (let c = 0; c < nCols - 1; c++) {
      const lista = cols.get(c) ?? [];
      const off = (alto - (lista.length * BH + (lista.length - 1) * GAP_Y)) / 2;
      lista.forEach((n, i) => nodos.push({ id: n.cuerpo.id, x: PAD + c * (BW + GAP_X), y: off + i * (BH + GAP_Y), red: n, destino: n.cuerpo.aguasAbajoId ?? 'salida' }));
    }
    nodos.push({ id: 'salida', x: PAD + (nCols - 1) * (BW + GAP_X), y: (alto - BH) / 2, salida: true, destino: '' });
    return { nodos, ancho: PAD * 2 + nCols * BW + (nCols - 1) * GAP_X, alto, vertical: false };
  }, [red, esPhone, estaciones.length]);

  if (!dis) return null;
  const mesActual = [...ultimo.values()].reduce((m, u) => (u && u.mes > m ? u.mes : m), '');
  const pos = new Map(dis.nodos.map((n) => [n.id, n]));
  const resumen = red.map((n) => `${n.cuerpo.etiqueta} descarga a ${n.cuerpo.aguasAbajoId ? cuerpos.find((c) => c.id === n.cuerpo.aguasAbajoId)?.etiqueta : 'la salida de la cuenca'}`).join('; ');

  return (
    <section className="an-card" id="cu-red" aria-label="Esquema de la red de presas">
      <h4 className="an-h">Red de presas, de aguas arriba a aguas abajo</h4>
      <p className="an-nota">
        Cada caja es un cuerpo de agua con su lectura más reciente (la del día si hay telemetría; si no, el último cierre mensual); la flecha indica a dónde descarga.
        {estaciones.length > 0 && ' Las píldoras son estaciones hidrométricas: arriba de un vaso miden lo que le entra y abajo, el cauce que sale hacia el siguiente.'}
        {' '}La topología es la inicial del catálogo y está por confirmar con CONAGUA. Las cajas punteadas no tienen telemetría vigente (S/D).
      </p>
      <div className="cu-red-esq-wrap">
        <svg className="cu-red-esq" viewBox={`0 0 ${dis.ancho} ${dis.alto}`} role="img" aria-label={`Red de presas de la cuenca del Conchos. ${resumen}.`}>
          <defs><marker id={`${uid}-f`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" className="cu-red-flecha" /></marker></defs>
          {dis.nodos.filter((n) => !n.salida).map((n) => {
            const d = pos.get(n.destino);
            if (!d) return null;
            const [x1, y1, x2, y2] = dis.vertical ? [n.x + BW / 2, n.y + BH, d.x + BW / 2, d.y] : [n.x + BW, n.y + BH / 2, d.x, d.y + BH / 2];
            const m = dis.vertical ? `C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}` : `C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
            return <path key={`e-${n.id}`} d={`M${x1},${y1} ${m}`} className="cu-red-arco" markerEnd={`url(#${uid}-f)`} />;
          })}
          {dis.nodos.map((n) => {
            if (n.salida) {
              return (
                <g key="salida" transform={`translate(${n.x} ${n.y})`}>
                  <rect width={BW} height={BH} rx="10" className="cu-red-n cu-red-n--salida" />
                  <text x="10" y="21" className="cu-red-t1">Salida · Ojinaga</text>
                  <text x="10" y="40" className="cu-red-t2">{ojinagaM3s == null ? 'S/D' : `${formatearNumero(ojinagaM3s, 2)} m³/s`}</text>
                  <text x="10" y="57" className="cu-red-t3">aforo USIBWC{ojinagaFecha ? ` · ${new Date(`${ojinagaFecha}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : ''}</text>
                </g>
              );
            }
            const c = n.red!.cuerpo, u = ultimo.get(c.id) ?? null;
            // La lectura del día (telemetría) manda si es posterior al cierre mensual; si no la hay, queda el cierre con su mes.
            const h = hoy?.get(c.id);
            const delDia = h != null && h.almMm3 != null && h.fecha != null && (u == null || h.fecha > u.fechaCierre);
            const alm = delDia ? h.almMm3 : (u?.almMm3 ?? null), pct = delDia ? h.pct : (u?.pctNamo ?? null);
            // Un cierre de hace más de 2 meses respecto al más reciente de la cuenca ya no describe el estado actual:
            // se dibuja como S/D (punteado) y se rotula «último dato», aunque se siga mostrando la cifra.
            const vencido = !delDia && u != null && mesesEntre(u.mes, mesActual) > 2;
            const sd = (!delDia && u == null) || vencido;
            const est = estadoEmbalse(sd ? null : pct);
            const cuando = delDia ? `dato del ${diaCorto(h.fecha as string)}` : u == null ? (c.rol === 'reguladora' ? 'reguladora · sin dato' : 'sin cierre con dato') : `${vencido ? 'último dato' : 'cierre'} ${etiquetaMes(u.mes, true)}`;
            return (
              <g key={c.id} transform={`translate(${n.x} ${n.y})`}>
                <title>{`${c.etiqueta}: ${alm == null ? 'sin dato' : `${formatearNumero(alm, 1)} Mm³ (${pct == null ? 'S/D' : `${formatearNumero(pct, 1)} %`}), ${cuando}${vencido ? '; dato vencido, sin lectura vigente' : ''}`}`}</title>
                <rect width={BW} height={BH} rx="10" className={`cu-red-n cu-red-n--${sd ? 'sd' : est.clave}`} />
                <text x="10" y="20" className="cu-red-t1">{c.etiqueta}</text>
                <text x="10" y="40" className="cu-red-t2">
                  {alm == null ? 'S/D' : <><tspan aria-hidden="true">{GLIFO_ESTADO[est.clave]} </tspan>{pct == null ? 'S/D' : `${formatearNumero(pct, 1)} %`}{` · ${formatearNumero(alm, alm >= 100 ? 0 : 1)} Mm³`}</>}
                </text>
                <text x="10" y="57" className="cu-red-t3">{cuando}</text>
              </g>
            );
          })}
          {estaciones.map((e) => {
            const n = dis.nodos.find((x) => x.red?.cuerpo.id === e.cuerpoId);
            if (!n) return null;
            const y = e.lado === 'entrada' ? n.y - PH - 6 : n.y + BH + 6;
            return (
              <g key={e.id} transform={`translate(${n.x} ${y})`}>
                <title>{`Estación hidrométrica ${e.nombre}, ${e.lado === 'entrada' ? 'a la entrada' : 'aguas abajo'}: ${e.texto}${e.enLinea ? '' : ' (sin transmisión reciente)'}`}</title>
                <line x1={BW / 2} x2={BW / 2} y1={e.lado === 'entrada' ? PH : -6} y2={e.lado === 'entrada' ? PH + 6 : 0} className="cu-red-est-tallo" />
                <rect width={BW} height={PH} rx={PH / 2} className={`cu-red-est${e.enLinea ? '' : ' cu-red-est--off'}`} />
                <text x="9" y="15" className="cu-red-est-t"><tspan aria-hidden="true">{e.lado === 'entrada' ? '↓ ' : '↧ '}</tspan>{e.nombre} · {e.texto}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
