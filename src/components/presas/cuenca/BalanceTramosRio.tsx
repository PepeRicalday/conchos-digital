import { useMemo, useState } from 'react';
import { DataTable, type Columna } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { etiquetaMes } from '../../../utils/cuerposAgua';
import { rangosPeriodo, type LecturaGasto, type PeriodoCuenca } from '../../../utils/cuencaAnalisis';
import { balanceTramos, definirTramos, fuentesDeGastos, lecturasTramos, type ResultadoTramo } from '../../../utils/balanceTramosRio';
import type { DatosCuerposAgua } from '../../../hooks/useCuerposAgua';
import LecturaCuenca from './LecturaCuenca';

const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const con = (v: number | null, d = 1) => (v == null ? 'S/D' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), d)}`);

/** Barras divergentes de lo no medido por tramo: a la derecha entró más de lo que salió de arriba, a la izquierda llegó menos. Escala común. */
function BarrasNoMedido({ tramos }: { tramos: ResultadoTramo[] }) {
  const max = Math.max(1, ...tramos.map((t) => Math.abs(t.noMedido ?? 0)));
  return (
    <ul className="cu-bc-barras" aria-label="Agua no medida por tramo en el periodo, en Mm³">
      {tramos.map((t) => {
        const d = t.noMedido, ancho = d == null ? 0 : Math.max(1.5, (Math.abs(d) / max) * 50);
        return (
          <li key={t.def.id} className="cu-bc-fila">
            <span className="cu-bc-nombre">{t.def.nombre}</span>
            <span className="cu-bc-pista" aria-hidden="true">
              {d != null && <span className={`cu-bc-barra cu-bc-barra--${d >= 0 ? 'sube' : 'baja'}`} style={d >= 0 ? { left: '50%', width: `${ancho}%` } : { right: '50%', width: `${ancho}%` }} />}
              {d == null && <span className="cu-bc-sd" />}
            </span>
            <span className="cu-bc-val">{d == null ? 'S/D' : <>{con(d)} <small>Mm³{t.noMedidoPct != null ? ` · ${con(t.noMedidoPct, 0)} %` : ''}</small></>}</span>
          </li>
        );
      })}
    </ul>
  );
}

const COLUMNAS: Columna<ResultadoTramo>[] = [
  {
    id: 'tramo', titulo: 'Tramo', encabezadoFila: true,
    render: (t) => (
      <div className="cu-presa">
        <span className="cu-nombre">{t.def.nombre}</span>
        {t.def.origenes.length > 2 && <span className="cu-nota-fila">{t.def.origenes.map((o) => o.etiqueta).join(' + ')}</span>}
        {t.def.sinMedir.length > 0 && <span className="cu-nota-fila">sin medir: {t.def.sinMedir.map((o) => o.etiqueta).join(', ')}</span>}
      </div>
    ),
  },
  { id: 'lib', titulo: 'Sale de arriba (Mm³)', numerica: true, ayuda: () => 'Salida total (extracción + vertido) de los vasos de arriba', render: (t) => f1(t.liberado) },
  { id: 'der', titulo: 'Derivado K-0 (Mm³)', numerica: true, ayuda: () => 'Agua que el Canal Conchos toma del río en K-0; se mide solo desde mar-2026', render: (t) => (t.def.derivaK0 ? f1(t.derivado) : '—') },
  { id: 'lle', titulo: 'Llega (Mm³)', numerica: true, ayuda: () => 'Aportación del vaso de abajo (CONAGUA) o volumen del aforo de Ojinaga', render: (t) => f1(t.llega) },
  {
    id: 'nm', titulo: 'No medido (Mm³)', numerica: true,
    ayuda: () => 'Llega − (sale de arriba − derivado). Positivo: entró más agua al río; negativo: llegó menos (pérdidas, tomas sin aforo, desfase)',
    render: (t) => <>{con(t.noMedido)}{t.noMedidoPct != null && <span className="cu-nota-fila">{con(t.noMedidoPct, 0)} % de lo liberado</span>}</>,
  },
  {
    id: 'mes', titulo: 'Meses completos', numerica: true,
    ayuda: (t) => (t.descartes.length ? `Descartados: ${t.descartes.map((d) => `${d.motivo} (${d.meses})`).join('; ')}` : undefined),
    render: (t) => <>{`${t.mesesCompletos} de ${t.mesesPeriodo}`}{t.descartes[0] && t.mesesCompletos < t.mesesPeriodo && <span className="cu-nota-fila">{t.descartes[0].motivo}</span>}</>,
  },
];

/**
 * Balance por tramo de río: lo que sale de los vasos de arriba contra lo que llega al punto de abajo (otro vaso u Ojinaga),
 * descontando la toma K-0 donde se mide. Lo «no medido» no es un error: es el agua que entra, se pierde o se toma sin aforo en el
 * trayecto. Un mes al que le falta cualquier dato NO suma (S/D, nunca 0) y se dice por qué.
 */
export default function BalanceTramosRio({ datos, ojinaga, k0, hoyISO }: {
  datos: DatosCuerposAgua; ojinaga: LecturaGasto[] | null; k0: LecturaGasto[] | null; hoyISO: string;
}) {
  const rangos = useMemo(() => rangosPeriodo(hoyISO), [hoyISO]);
  const [periodo, setPeriodo] = useState<PeriodoCuenca>(() => (Number(hoyISO.slice(5, 7)) >= 10 ? 'cicloAnt' : 'ciclo'));
  const rango = rangos.find((r) => r.clave === periodo) ?? rangos[0];
  const defs = useMemo(() => definirTramos(datos.cuerpos), [datos.cuerpos]);
  const fuentes = useMemo(() => fuentesDeGastos(ojinaga, k0, hoyISO), [ojinaga, k0, hoyISO]);
  const tramos = useMemo(() => balanceTramos(defs, datos.balances, rango, fuentes), [defs, datos.balances, rango, fuentes]);
  const frase = rango.clave === 'todo' ? 'el periodo desde 2021' : rango.clave === '12m' || rango.clave === '24m' ? `los últimos ${rango.etiqueta}` : `el ${rango.etiqueta.toLowerCase()}`;
  const lecturas = useMemo(() => lecturasTramos(tramos, frase), [tramos, frase]);
  if (!defs.length) return null;

  return (
    <section className="an-card" id="cu-balance-tramos" aria-label="Balance por tramo de río">
      <h4 className="an-h">Balance por tramo de río · {rango.etiqueta}</h4>
      <p className="an-nota">
        Lo que sale de los vasos de arriba contra lo que llega al punto de abajo, en Mm³, de {etiquetaMes(rango.desde, true)} a {etiquetaMes(rango.hasta, true)}.
        La diferencia es lo <b>no medido</b>: agua que entra al río, se pierde o se toma sin aforo en el trayecto. No es un error de medición.
      </p>
      <div className="cu-controles" role="group" aria-label="Periodo del balance por tramo">
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id="cu-bt-per">Periodo</span>
          <div className="an-seg cu-seg-envuelve" role="group" aria-labelledby="cu-bt-per">
            {rangos.map((r) => <button key={r.clave} type="button" className="an-seg-btn" aria-pressed={r.clave === periodo} onClick={() => setPeriodo(r.clave)}>{r.etiqueta}</button>)}
          </div>
        </div>
      </div>
      <LecturaCuenca titulo="Qué mirar en los tramos" lecturas={lecturas} />
      <h5 className="an-h an-h--pie cu-cm-sub">Agua no medida por tramo</h5>
      <BarrasNoMedido tramos={tramos} />
      <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Balance por tramo de río (desplazable)" captionOculto caption={`Balance por tramo, ${rango.etiqueta}`} clave={(t) => t.def.id} filas={tramos} columnas={COLUMNAS} />
      <p className="an-nota cu-bal-pie">
        <b>Cómo leerlo:</b> no medido = llega − (sale de arriba − derivado en K-0). La aportación que CONAGUA publica para un vaso se deduce de su propia operación, así que no es un aforo independiente.
        La toma K-0 se mide solo desde mar-2026 y la salida de Boquilla y Madero no está publicada en AQUARIUS desde esa fecha, por eso el tramo hacia Luis L. León casi no tiene meses completos.
        Los meses suman solo si tienen todos los datos; un mes con S/D no se cuenta como cero. El aporte de los vasos sin telemetría queda dentro de lo no medido.
      </p>
    </section>
  );
}
