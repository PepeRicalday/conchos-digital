import { useId, useMemo } from 'react';
import { useDevice } from '../../../hooks/useDevice';
import { estadoEmbalse } from '../../../utils/presaNiveles';
import { formatearNumero } from '../../../utils/historicoPresas';
import { construirRed, etiquetaMes, ultimoCierreConDato, type CierreMensual, type CuerpoAgua, type NodoRed } from '../../../utils/cuerposAgua';
import { GLIFO_ESTADO } from './TanquePresa';

const BW = 160, BH = 64, GAP_X = 58, GAP_Y = 16, PAD = 12;
/** Meses completos entre dos primeros-de-mes (AAAA-MM-01). */
const mesesEntre = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

interface Nodo { id: string; x: number; y: number; salida?: boolean; red?: NodoRed; destino: string }

/**
 * Esquema unifilar de la cuenca: cada presa en su lugar de aguas arriba a aguas abajo, hasta la salida (aforo de Ojinaga).
 * Horizontal en pantallas anchas y vertical en teléfono. Muestra el último cierre mensual con dato de cada cuerpo (con su mes) y no
 * inventa el de los que no lo tienen. La topología es la inicial del catálogo y está por confirmar con CONAGUA.
 */
export default function EsquemaRedCuenca({ cuerpos, cierres, ojinagaM3s, ojinagaFecha }: {
  cuerpos: CuerpoAgua[]; cierres: CierreMensual[]; ojinagaM3s: number | null; ojinagaFecha: string | null;
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
      const POR_FILA = 2, SEP = 14, GAP_V = 30;
      const ancho = PAD * 2 + POR_FILA * BW + (POR_FILA - 1) * SEP;
      let fila = 0;
      for (let c = 0; c < nCols - 1; c++) {
        const lista = cols.get(c) ?? [];
        for (let i = 0; i < lista.length; i += POR_FILA) {
          const trozo = lista.slice(i, i + POR_FILA);
          const off = (ancho - (trozo.length * BW + (trozo.length - 1) * SEP)) / 2;
          trozo.forEach((n, k) => nodos.push({ id: n.cuerpo.id, x: off + k * (BW + SEP), y: PAD + fila * (BH + GAP_V), red: n, destino: n.cuerpo.aguasAbajoId ?? 'salida' }));
          fila++;
        }
      }
      nodos.push({ id: 'salida', x: (ancho - BW) / 2, y: PAD + fila * (BH + GAP_V), salida: true, destino: '' });
      return { nodos, ancho, alto: PAD * 2 + (fila + 1) * BH + fila * GAP_V, vertical: true };
    }
    const maxPorCol = Math.max(...[...cols.values()].map((v) => v.length), 1);
    const alto = PAD * 2 + maxPorCol * BH + (maxPorCol - 1) * GAP_Y;
    for (let c = 0; c < nCols - 1; c++) {
      const lista = cols.get(c) ?? [];
      const off = (alto - (lista.length * BH + (lista.length - 1) * GAP_Y)) / 2;
      lista.forEach((n, i) => nodos.push({ id: n.cuerpo.id, x: PAD + c * (BW + GAP_X), y: off + i * (BH + GAP_Y), red: n, destino: n.cuerpo.aguasAbajoId ?? 'salida' }));
    }
    nodos.push({ id: 'salida', x: PAD + (nCols - 1) * (BW + GAP_X), y: (alto - BH) / 2, salida: true, destino: '' });
    return { nodos, ancho: PAD * 2 + nCols * BW + (nCols - 1) * GAP_X, alto, vertical: false };
  }, [red, esPhone]);

  if (!dis) return null;
  const mesActual = [...ultimo.values()].reduce((m, u) => (u && u.mes > m ? u.mes : m), '');
  const pos = new Map(dis.nodos.map((n) => [n.id, n]));
  const resumen = red.map((n) => `${n.cuerpo.etiqueta} descarga a ${n.cuerpo.aguasAbajoId ? cuerpos.find((c) => c.id === n.cuerpo.aguasAbajoId)?.etiqueta : 'la salida de la cuenca'}`).join('; ');

  return (
    <section className="an-card" id="cu-red" aria-label="Esquema de la red de presas">
      <h4 className="an-h">Red de presas, de aguas arriba a aguas abajo</h4>
      <p className="an-nota">
        Cada caja es un cuerpo de agua con su último cierre mensual con dato; la flecha indica a dónde descarga. La topología es la inicial del catálogo y está por confirmar con CONAGUA.
        Las cajas punteadas no tienen telemetría vigente (S/D).
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
            // Un dato de hace más de 2 meses respecto al cierre más reciente de la cuenca ya no describe el estado actual:
            // se dibuja como S/D (punteado) y se rotula «último dato», aunque se siga mostrando la cifra.
            const vencido = u != null && mesesEntre(u.mes, mesActual) > 2;
            const est = estadoEmbalse(vencido ? null : (u?.pctNamo ?? null));
            const sd = u == null || vencido;
            return (
              <g key={c.id} transform={`translate(${n.x} ${n.y})`}>
                <title>{`${c.etiqueta}: ${u == null ? 'sin cierre con dato' : `${formatearNumero(u.almMm3 as number, 1)} Mm³ (${u.pctNamo == null ? 'S/D' : `${formatearNumero(u.pctNamo, 1)} %`}) al cierre de ${etiquetaMes(u.mes, true)}${vencido ? '; dato vencido, sin lectura vigente' : ''}`}`}</title>
                <rect width={BW} height={BH} rx="10" className={`cu-red-n cu-red-n--${sd ? 'sd' : est.clave}`} />
                <text x="10" y="20" className="cu-red-t1">{c.etiqueta}</text>
                <text x="10" y="40" className="cu-red-t2">
                  {u == null ? 'S/D' : <><tspan aria-hidden="true">{GLIFO_ESTADO[est.clave]} </tspan>{u.pctNamo == null ? 'S/D' : `${formatearNumero(u.pctNamo, 1)} %`}{u.almMm3 != null ? ` · ${formatearNumero(u.almMm3, u.almMm3 >= 100 ? 0 : 1)} Mm³` : ''}</>}
                </text>
                <text x="10" y="57" className="cu-red-t3">{u == null ? (c.rol === 'reguladora' ? 'reguladora · sin dato' : 'sin cierre con dato') : `${vencido ? 'último dato' : 'cierre'} ${etiquetaMes(u.mes, true)}`}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
