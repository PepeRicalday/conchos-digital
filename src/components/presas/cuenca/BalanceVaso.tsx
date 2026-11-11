import { useId, useMemo, useState } from 'react';
import { DataTable, Kpi, type Columna } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { etiquetaMes, resumenResiduo, serieBalance, type BalanceMensual } from '../../../utils/cuerposAgua';
import type { DatosCuerposAgua } from '../../../hooks/useCuerposAgua';

const MESES_GRAFICA = 24;
const W = 720, H = 250, PAD = { l: 46, r: 10, t: 18, b: 32 };
const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const con = (v: number | null) => (v == null ? 'S/D' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), 1)}`);

/** Entradas y salida total por mes (barras) y cambio de almacenamiento (rombo). Un mes S/D es una casilla con trama, nunca barras en 0. */
function Grafica({ serie }: { serie: BalanceMensual[] }) {
  const uid = useId().replace(/:/g, '');
  const valores = serie.flatMap((b) => [b.entradas, b.salidaTotal, b.deltaS].filter((v): v is number => v != null));
  const tope = Math.max(10, ...valores), piso = Math.min(0, ...valores);
  const paso = (tope - piso) > 400 ? 200 : (tope - piso) > 100 ? 50 : (tope - piso) > 40 ? 20 : 10;
  const techo = Math.ceil(tope / paso) * paso, suelo = Math.floor(piso / paso) * paso;
  const y = (v: number) => PAD.t + (1 - (v - suelo) / (techo - suelo)) * (H - PAD.t - PAD.b);
  const col = (W - PAD.l - PAD.r) / serie.length, bw = Math.min(14, col * 0.34);
  const ticks: number[] = [];
  for (let v = suelo; v <= techo + 1e-9; v += paso) ticks.push(v);
  const resumen = serie.map((b) => `${etiquetaMes(b.mes, true)}: ${b.calidad === 'SD' ? 'sin balance' : `entradas ${f1(b.entradas)}, salida ${f1(b.salidaTotal)}, cambio de almacenamiento ${f1(b.deltaS)} Mm³`}`).join('; ');
  return (
    <svg className="cu-bal-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Balance mensual del vaso, últimos ${serie.length} meses, en Mm³. ${resumen}`}>
      <defs><pattern id={`${uid}-sd`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.5" opacity="0.45" /></pattern></defs>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'cu-bal-cero' : 'cu-mes-rejilla'} />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" className="cu-mes-eje">{formatearNumero(v, 0)}</text>
        </g>
      ))}
      <text x={4} y={11} className="cu-mes-eje">Mm³</text>
      {serie.map((b, i) => {
        const cx = PAD.l + col * i + col / 2;
        const etiqueta = i % 2 === 0 || serie.length <= 12 ? etiquetaMes(b.mes, b.mes.endsWith('-01-01') || i === 0) : '';
        if (b.entradas == null && b.salidaTotal == null) {
          return (
            <g key={b.mes}>
              <rect x={cx - col * 0.34} y={y(0) - 22} width={col * 0.68} height={22} fill={`url(#${uid}-sd)`} className="cu-mes-sd" />
              <text x={cx} y={H - 12} textAnchor="middle" className="cu-mes-eje">{etiqueta}</text>
            </g>
          );
        }
        return (
          <g key={b.mes}>
            {b.entradas != null && <rect x={cx - bw - 1} y={y(Math.max(b.entradas, 0))} width={bw} height={Math.max(1.5, Math.abs(y(0) - y(b.entradas)))} rx="2" className="cu-bal-ent" />}
            {b.salidaTotal != null && <rect x={cx + 1} y={y(Math.max(b.salidaTotal, 0))} width={bw} height={Math.max(1.5, Math.abs(y(0) - y(b.salidaTotal)))} rx="2" className="cu-bal-sal" />}
            {b.deltaS != null && <path d={`M${cx},${y(b.deltaS) - 5}l5,5l-5,5l-5,-5z`} className="cu-bal-ds" />}
            <text x={cx} y={H - 12} textAnchor="middle" className="cu-mes-eje">{etiqueta}</text>
          </g>
        );
      })}
    </svg>
  );
}

const COLUMNAS: Columna<BalanceMensual>[] = [
  { id: 'mes', titulo: 'Mes', encabezadoFila: true, render: (b) => etiquetaMes(b.mes, true) },
  { id: 'ini', titulo: 'Inicio (Mm³)', numerica: true, render: (b) => f1(b.sIni) },
  { id: 'fin', titulo: 'Cierre (Mm³)', numerica: true, render: (b) => f1(b.sFin) },
  { id: 'ds', titulo: 'Cambio ΔS', numerica: true, render: (b) => con(b.deltaS) },
  { id: 'ent', titulo: 'Entradas', numerica: true, render: (b) => f1(b.entradas) },
  { id: 'sal', titulo: 'Salida total', numerica: true, render: (b) => <>{f1(b.salidaTotal)}{b.vertido != null && b.vertido > 0.05 && <span className="cu-nota-fila">de ella vertido {f1(b.vertido)}</span>}</> },
  { id: 'res', titulo: 'Residuo', numerica: true, ayuda: () => 'Entradas − salida − cambio de almacenamiento: incluye evaporación, filtraciones y error', render: (b) => con(b.residuo) },
  { id: 'cob', titulo: 'Cobertura', numerica: true, render: (b) => (b.coberturaPct == null ? 'S/D' : `${formatearNumero(b.coberturaPct, 0)} %`) },
  { id: 'cal', titulo: 'Calidad', render: (b) => <span className={`cu-bal-cal cu-bal-cal--${b.calidad}`}><span aria-hidden="true">{b.calidad === 'OK' ? '●' : b.calidad === 'PARCIAL' ? '◐' : '◇'}</span> {b.calidad === 'SD' ? 'S/D' : b.calidad === 'OK' ? 'Completo' : 'Parcial'}</span> },
];

/**
 * Balance mensual de un vaso: entradas, salida total y cambio de almacenamiento (Mm³), con el residuo a la vista.
 * El residuo mide CONSISTENCIA entre series (la aportación de CONAGUA suele deducirse de la operación del vaso), no un error
 * independiente. La evaporación y el error de cierre son S/D en esta etapa: no se inventan. La salida total ya incluye el vertido.
 */
export default function BalanceVaso({ datos }: { datos: DatosCuerposAgua }) {
  const conBalance = useMemo(() => datos.cuerpos.filter((c) => datos.balances.some((b) => b.cuerpoId === c.id)), [datos]);
  const [id, setId] = useState<string | null>(null);
  const cuerpo = conBalance.find((c) => c.id === id) ?? conBalance.find((c) => c.presaId === 'PRE-001') ?? conBalance[0];
  const serie = useMemo(() => (cuerpo ? serieBalance(datos.balances, cuerpo.id, MESES_GRAFICA) : []), [datos.balances, cuerpo]);
  const res = useMemo(() => resumenResiduo(serie), [serie]);
  const sinBalance = datos.cuerpos.filter((c) => !conBalance.includes(c));

  if (!cuerpo) {
    return (
      <section className="an-card" id="cu-balance" aria-label="Balance mensual por vaso">
        <h4 className="an-h">Balance mensual por vaso</h4>
        <div className="an-vacio" role="status"><strong>Sin balance por ahora (S/D)</strong><span>Todavía no hay balance mensual calculado.</span></div>
      </section>
    );
  }
  const ok = serie.filter((b) => b.calidad === 'OK').length;
  return (
    <section className="an-card" id="cu-balance" aria-label="Balance mensual por vaso">
      <h4 className="an-h">Balance mensual por vaso</h4>
      <p className="an-nota">
        Entradas, salida total y cambio de almacenamiento de cada mes, en Mm³. Los flujos son los diarios de CONAGUA (AQUARIUS) promediados sobre los días con dato; el cambio sale de los cierres mensuales.
        La salida total ya incluye el vertido. Evaporación y error de cierre: S/D por ahora.
      </p>
      <div className="cu-controles" role="group" aria-label="Vaso del balance">
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id="cu-bal-vaso">Vaso</span>
          <div className="an-seg cu-seg-envuelve" role="group" aria-labelledby="cu-bal-vaso">
            {conBalance.map((c) => <button key={c.id} type="button" className="an-seg-btn" aria-pressed={c.id === cuerpo.id} onClick={() => setId(c.id)}>{c.etiqueta}</button>)}
          </div>
        </div>
      </div>
      <div className="cu-red-kpis">
        <Kpi densidad="compacta" etiqueta="Residuo medio" valor={res ? con(res.mediaMm3) : 'S/D'} unidad={res ? ' Mm³/mes' : undefined}
          contexto={res ? `${res.nMeses} meses completos${res.pctEntradas != null ? ` · ${con(res.pctEntradas).replace(' ', '')} % de las entradas` : ''}` : 'Sin meses completos para promediar'} />
        <Kpi densidad="compacta" etiqueta="Meses con balance completo" valor={`${ok} de ${serie.length}`}
          contexto={`últimos ${serie.length} meses · cobertura de flujos ≥ 90 % y dos cierres consecutivos`} />
      </div>
      <Grafica serie={serie} />
      <ul className="cu-bal-leyenda" aria-label="Leyenda del balance">
        <li><span className="cu-bal-sw cu-bal-sw--ent" aria-hidden="true" /> Entradas</li>
        <li><span className="cu-bal-sw cu-bal-sw--sal" aria-hidden="true" /> Salida total (extracción + vertido)</li>
        <li><span className="cu-bal-sw cu-bal-sw--ds" aria-hidden="true" /> Cambio de almacenamiento ΔS</li>
        <li><span className="cu-bal-sw cu-bal-sw--sd" aria-hidden="true" /> Mes sin balance (S/D)</li>
      </ul>
      {res && res.mediaMm3 < 0 && (
        <p className="an-aviso" role="status">
          <b>Residuo negativo en {cuerpo.etiqueta}:</b> el vaso retuvo más agua de la que entró menos lo que salió, algo que la evaporación no explica. Apunta a una aportación subestimada o a lecturas de almacenamiento o extracción con error: revisar la fuente antes de usar este balance.
        </p>
      )}
      <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Balance mensual (desplazable)" captionOculto caption={`Balance mensual de ${cuerpo.etiqueta}`} clave={(b) => b.mes} filas={[...serie].reverse().slice(0, 12)} columnas={COLUMNAS} />
      <p className="an-nota cu-bal-pie">
        <b>Cómo leer el residuo:</b> entradas − salida − ΔS. Positivo = agua que no aparece (evaporación, filtraciones y error). La aportación publicada por CONAGUA suele deducirse de la propia operación del vaso, así que el residuo mide consistencia entre series, no un error independiente.
        {sinBalance.length > 0 && <> Sin balance (no hay flujos en AQUARIUS): {sinBalance.map((c) => c.etiqueta).join(', ')}.</>}
      </p>
    </section>
  );
}
