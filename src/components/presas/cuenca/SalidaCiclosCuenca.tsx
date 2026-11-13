import { useMemo } from 'react';
import { DataTable, type Columna } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { csvTabla } from '../../../utils/cuerposAgua';
import { salidaPorCiclo, type CicloSalida, type LecturaGasto, type SalidaCuenca } from '../../../utils/cuencaAnalisis';
import { fechaCorta } from '../../../utils/analiticaPresas';
import BotonCsv from './BotonCsv';

const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));

/** Volumen de un periodo: el estimado, o —con aforo incompleto— la cota inferior observada, dicha como tal. */
function Volumen({ s }: { s: SalidaCuenca }) {
  if (s.mm3 != null) return <>{f1(s.mm3)}</>;
  if (s.mm3Observado != null && s.dias > 0) return <>S/D<span className="cu-nota-fila">al menos {f1(s.mm3Observado)} (aforo en {s.dias} de {s.diasPeriodo} días)</span></>;
  return <>S/D</>;
}

const COLUMNAS: Columna<CicloSalida>[] = [
  { id: 'c', titulo: 'Ciclo', encabezadoFila: true, render: (c) => <><span className="cu-nombre">{c.clave}</span>{c.enCurso && <span className="cu-tag">En curso</span>}</> },
  { id: 'f', titulo: 'A la misma fecha (Mm³)', numerica: true, ayuda: () => 'Del 1 de octubre al mismo día del año en que estamos: la comparación justa entre ciclos', render: (c) => <Volumen s={c.aLaFecha} /> },
  { id: 'm', titulo: 'Gasto medio a esa fecha (m³/s)', numerica: true, render: (c) => f1(c.aLaFecha.gastoMedio, 2) },
  { id: 't', titulo: 'Ciclo completo (Mm³)', numerica: true, ayuda: () => 'Del 1 de octubre al 30 de septiembre; el ciclo en curso muestra lo que va', render: (c) => <Volumen s={c.total} /> },
  { id: 'd', titulo: 'Días con aforo', numerica: true, render: (c) => `${c.total.dias} de ${c.total.diasPeriodo}` },
];

/**
 * Salida por Ojinaga ciclo contra ciclo: cuánta agua dejó la cuenca en el ciclo en curso comparada, a igual fecha, con los
 * anteriores. Sale del aforo oficial de USIBWC; un ciclo con menos de 60 % de días con aforo no tiene volumen estimado.
 */
export default function SalidaCiclosCuenca({ salida, hoyISO }: { salida: LecturaGasto[] | null; hoyISO: string }) {
  const ciclos = useMemo(() => (salida ? salidaPorCiclo(salida, hoyISO) : null), [salida, hoyISO]);
  const actual = ciclos?.find((c) => c.enCurso);
  const previo = ciclos?.find((c) => !c.enCurso && c.aLaFecha.mm3 != null);
  const dif = actual?.aLaFecha.mm3 != null && previo?.aLaFecha.mm3 != null ? actual.aLaFecha.mm3 - previo.aLaFecha.mm3 : null;
  const csv = () => csvTabla(['ciclo', 'en_curso', 'mm3_a_la_fecha', 'mm3_observado_a_la_fecha', 'gasto_medio_a_la_fecha_m3s', 'mm3_ciclo', 'mm3_observado_ciclo', 'dias_con_aforo', 'dias_ciclo'],
    (ciclos ?? []).map((c) => [c.clave, c.enCurso ? 'si' : 'no', c.aLaFecha.mm3, c.aLaFecha.mm3Observado, c.aLaFecha.gastoMedio, c.total.mm3, c.total.mm3Observado, c.total.dias, c.total.diasPeriodo]));

  return (
    <section className="an-card" id="cu-ojinaga-ciclos" aria-label="Salida por Ojinaga por ciclo">
      <div className="cu-red-cab">
        <div>
          <h4 className="an-h">Salida por Ojinaga por ciclo</h4>
          <p className="an-nota">
            Agua que dejó la cuenca por el aforo oficial de Ojinaga (USIBWC 08373000), del 1 de octubre al 30 de septiembre.
            {actual && <> Hasta el {fechaCorta(hoyISO)}</>}{dif != null && previo && <>, el ciclo en curso lleva {f1(Math.abs(dif))} Mm³ {dif >= 0 ? 'más' : 'menos'} que el ciclo {previo.clave} a la misma fecha</>}{actual && '.'}
          </p>
        </div>
        {ciclos && ciclos.length > 0 && <BotonCsv nombre="salida-ojinaga-por-ciclo.csv" generar={csv} />}
      </div>
      {ciclos == null ? <div className="an-skeleton" role="status" aria-busy="true" aria-label="Cargando aforo de Ojinaga" />
        : ciclos.length === 0 ? <div className="an-vacio" role="status"><strong>Sin aforo de Ojinaga (S/D)</strong><span>No hay lecturas del aforo oficial.</span></div>
        : <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Salida por Ojinaga por ciclo (desplazable)" captionOculto caption="Salida por Ojinaga por ciclo agrícola" clave={(c) => c.clave} filas={ciclos} columnas={COLUMNAS} />}
      <p className="an-nota cu-bal-pie"><b>Cómo leerlo:</b> el volumen es el gasto medio de los días con aforo por los días del periodo. Con menos de 60 % de días con aforo no se estima: se da solo lo observado, como cota inferior.</p>
    </section>
  );
}
