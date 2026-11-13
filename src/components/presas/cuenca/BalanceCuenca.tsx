import { useMemo, useState } from 'react';
import { DataTable, Kpi, type Columna } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { csvTabla, etiquetaMes } from '../../../utils/cuerposAgua';
import BotonCsv from './BotonCsv';
import {
  balanceCuenca, finDeMes, lecturasBalance, periodoInicial, rangosPeriodo, salidaCuenca,
  type BalanceVasoPeriodo, type LecturaGasto, type PeriodoCuenca,
} from '../../../utils/cuencaAnalisis';
import type { DatosCuerposAgua } from '../../../hooks/useCuerposAgua';
import LecturaCuenca from './LecturaCuenca';

const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const con = (v: number | null, d = 1) => (v == null ? 'S/D' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), d)}`);

/** Barras divergentes del cambio de almacenamiento por vaso: a la derecha gana, a la izquierda pierde. Escala común. */
function BarrasDelta({ vasos }: { vasos: BalanceVasoPeriodo[] }) {
  const max = Math.max(1, ...vasos.map((v) => Math.abs(v.deltaS ?? 0)));
  return (
    <ul className="cu-bc-barras" aria-label="Cambio de almacenamiento por vaso en el periodo, en Mm³">
      {vasos.map((v) => {
        const d = v.deltaS, ancho = d == null ? 0 : Math.max(1.5, (Math.abs(d) / max) * 50);
        return (
          <li key={v.cuerpo.id} className="cu-bc-fila">
            <span className="cu-bc-nombre">{v.cuerpo.etiqueta}</span>
            <span className="cu-bc-pista" aria-hidden="true">
              {d != null && <span className={`cu-bc-barra cu-bc-barra--${d >= 0 ? 'sube' : 'baja'}`} style={d >= 0 ? { left: '50%', width: `${ancho}%` } : { right: '50%', width: `${ancho}%` }} />}
              {d == null && <span className="cu-bc-sd" />}
            </span>
            <span className="cu-bc-val">{d == null ? 'S/D' : <>{con(d)} <small>Mm³{v.deltaParcial && v.mesIni && v.mesFin ? ` · ${etiquetaMes(v.mesIni, true)}–${etiquetaMes(v.mesFin, true)}` : ''}</small></>}</span>
          </li>
        );
      })}
    </ul>
  );
}

const COLUMNAS: Columna<BalanceVasoPeriodo>[] = [
  { id: 'v', titulo: 'Vaso', encabezadoFila: true, render: (v) => <><span className="cu-nombre">{v.cuerpo.etiqueta}</span>{v.cabecera && <span className="cu-tag">Cabecera</span>}</> },
  { id: 'ini', titulo: 'Inicio (Mm³)', numerica: true, render: (v) => <>{f1(v.sIni)}{v.mesIni && v.deltaParcial && <span className="cu-nota-fila">inicio de {etiquetaMes(v.mesIni, true)}</span>}</> },
  { id: 'fin', titulo: 'Final (Mm³)', numerica: true, render: (v) => <>{f1(v.sFin)}{v.mesFin && v.deltaParcial && <span className="cu-nota-fila">cierre de {etiquetaMes(v.mesFin, true)}</span>}</> },
  { id: 'ds', titulo: 'Cambio ΔS', numerica: true, render: (v) => con(v.deltaS) },
  { id: 'ent', titulo: 'Entradas', numerica: true, render: (v) => f1(v.entradas) },
  { id: 'sal', titulo: 'Salida total', numerica: true, render: (v) => f1(v.salida) },
  { id: 'res', titulo: 'Residuo', numerica: true, ayuda: () => 'Entradas − salida − ΔS, solo en meses con balance completo', render: (v) => con(v.residuo) },
  { id: 'cob', titulo: 'Meses completos', numerica: true, render: (v) => `${v.mesesOk} de ${v.mesesPeriodo}` },
];

/**
 * Balance de la cuenca: resultado agregado de todos los vasos en un periodo elegido. Dice cuánto cambió el almacenamiento, cuánto
 * entró a los vasos de cabecera, cuánto extrajeron los vasos y cuánto salió por Ojinaga. No es un balance hidrológico cerrado:
 * faltan los escurrimientos que entran entre vasos, la evaporación y los retornos, y se declara.
 */
export default function BalanceCuenca({ datos, salida, hoyISO, compacto = false, onIr }: {
  datos: DatosCuerposAgua; salida: LecturaGasto[] | null; hoyISO: string; compacto?: boolean; onIr?: () => void;
}) {
  const rangos = useMemo(() => rangosPeriodo(hoyISO), [hoyISO]);
  // El ciclo en curso apenas empieza en octubre: con menos de 3 meses, el ciclo anterior es el que da un resultado.
  const [periodo, setPeriodo] = useState<PeriodoCuenca>(() => periodoInicial(hoyISO));
  const rango = rangos.find((r) => r.clave === periodo) ?? rangos[0];
  const bal = useMemo(() => balanceCuenca(datos.cuerpos, datos.balances, rango), [datos, rango]);
  const sal = useMemo(() => (salida ? salidaCuenca(salida, rango.desde, finDeMes(rango.hasta), hoyISO) : null), [salida, rango, hoyISO]);
  const frase = rango.clave === 'todo' ? 'el periodo desde 2021' : rango.clave === '12m' || rango.clave === '24m' ? `los últimos ${rango.etiqueta}` : `el ${rango.etiqueta.toLowerCase()}`;
  const lecturas = useMemo(() => lecturasBalance(bal, frase, sal), [bal, frase, sal]);

  const csv = () => {
    const cab = ['periodo', 'vaso', 'cabecera', 'inicio_mm3', 'final_mm3', 'cambio_mm3', 'mes_inicio', 'mes_final', 'entradas_mm3', 'salida_mm3', 'residuo_mm3', 'meses_completos', 'meses_periodo'];
    const filas = bal.vasos.map((v) => [rango.etiqueta, v.cuerpo.etiqueta, v.cabecera ? 'si' : 'no', v.sIni, v.sFin, v.deltaS, v.mesIni?.slice(0, 7) ?? null, v.mesFin?.slice(0, 7) ?? null, v.entradas, v.salida, v.residuo, v.mesesOk, v.mesesPeriodo]);
    return csvTabla(cab, filas);
  };
  const filtro = (
    <div className="cu-controles" role="group" aria-label="Periodo del balance de la cuenca">
      <div className="cu-ctl">
        <span className="cu-ctl-etq" id="cu-bc-per">Periodo</span>
        <div className="an-seg cu-seg-envuelve" role="group" aria-labelledby="cu-bc-per">
          {rangos.map((r) => <button key={r.clave} type="button" className="an-seg-btn" aria-pressed={r.clave === periodo} onClick={() => setPeriodo(r.clave)}>{r.etiqueta}{r.enCurso ? ' (en curso)' : ''}</button>)}
        </div>
      </div>
    </div>
  );
  const kpis = (
    <div className="cu-kpis cu-kpis--4" role="list">
      <Kpi densidad="compacta" etiqueta="Cambio de almacenamiento" valor={con(bal.deltaS)} unidad={bal.deltaS != null ? ' Mm³' : undefined}
        estado={bal.deltaS == null ? null : { tipo: bal.deltaS >= 0 ? 'ok' : 'warn', texto: bal.deltaS >= 0 ? 'La cuenca ganó' : 'La cuenca perdió' }}
        contexto={bal.sIni != null && bal.sFin != null ? `de ${f1(bal.sIni)} a ${f1(bal.sFin)} Mm³ · ${bal.vasosConDelta} de ${bal.vasos.length} vasos` : 'Sin cierres suficientes'} />
      <Kpi densidad="compacta" etiqueta="Entradas a vasos de cabecera" valor={f1(bal.entradasCabecera)} unidad={bal.entradasCabecera != null ? ' Mm³' : undefined}
        contexto={`${bal.vasosCabecera} vasos que no reciben de otro · sin repetir agua en cascada${bal.entradasBrutas != null ? ` · suma de todos: ${f1(bal.entradasBrutas)}` : ''}`} />
      <Kpi densidad="compacta" etiqueta="Salida de los vasos" valor={f1(bal.salidaVasos)} unidad={bal.salidaVasos != null ? ' Mm³' : undefined}
        contexto="extracción + vertido de todos los vasos · el agua que pasa a otro vaso se cuenta en ambos" />
      <Kpi densidad="compacta" etiqueta="Salida por Ojinaga" valor={sal?.mm3 != null ? f1(sal.mm3) : 'S/D'} unidad={sal?.mm3 != null ? ' Mm³' : undefined}
        contexto={sal == null ? 'Cargando aforo…' : sal.mm3 != null ? `gasto medio ${f1(sal.gastoMedio, 2)} m³/s · ${sal.dias} de ${sal.diasPeriodo} días con dato` : sal.dias > 0 ? `solo ${sal.dias} de ${sal.diasPeriodo} días con aforo · al menos ${f1(sal.mm3Observado)} Mm³` : 'Sin aforo en el periodo'} />
    </div>
  );

  if (compacto) {
    return (
      <section className="an-card" aria-label="Balance de la cuenca">
        <div className="cu-red-cab">
          <div>
            <h4 className="an-h">Balance de la cuenca · {rango.etiqueta}{rango.enCurso ? ' (en curso)' : ''}</h4>
            <p className="an-nota">{lecturas[0]?.texto}</p>
          </div>
          {onIr && <button type="button" className="an-btn" onClick={onIr}>Ver balance completo →</button>}
        </div>
        {filtro}
        {kpis}
      </section>
    );
  }

  return (
    <section className="an-card" id="cu-balance-cuenca" aria-label="Balance de la cuenca">
      <h4 className="an-h">Balance de la cuenca · {rango.etiqueta}{rango.enCurso ? ' (en curso)' : ''}</h4>
      <p className="an-nota">
        Resultado de todos los vasos en el periodo: cuánto cambió el almacenamiento, cuánto entró, cuánto salió de los vasos y cuánto dejó la cuenca por Ojinaga.
        Sale del balance mensual por vaso (flujos diarios de CONAGUA y cierres mensuales). De {etiquetaMes(rango.desde, true)} a {etiquetaMes(rango.hasta, true)}.
      </p>
      {filtro}
      {kpis}
      <LecturaCuenca lecturas={lecturas} />
      <div className="cu-red-cab">
        <h5 className="an-h an-h--pie cu-cm-sub">Cambio de almacenamiento por vaso</h5>
        <BotonCsv nombre={`balance-cuenca-conchos-${rango.clave}.csv`} generar={csv} />
      </div>
      <BarrasDelta vasos={bal.vasos} />
      <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Balance por vaso en el periodo (desplazable)" captionOculto caption={`Balance por vaso, ${rango.etiqueta}`} clave={(v) => v.cuerpo.id} filas={bal.vasos} columnas={COLUMNAS} />
      <p className="an-nota cu-bal-pie">
        <b>Límites:</b> no es un balance hidrológico cerrado. Faltan los escurrimientos que entran al río entre un vaso y otro, las filtraciones y los retornos de riego; la evaporación solo está calculada para La Boquilla y F. I. Madero (ver «Balance mensual por vaso») y en los demás vasos es S/D; por eso entradas − salidas no tiene que igualar al cambio de almacenamiento.
        La aportación de cada vaso la deduce CONAGUA de su propia operación.
        {bal.sinBalance.length > 0 && <> Sin balance (no publican flujos): {bal.sinBalance.map((c) => c.etiqueta).join(', ')}.</>}
      </p>
    </section>
  );
}
