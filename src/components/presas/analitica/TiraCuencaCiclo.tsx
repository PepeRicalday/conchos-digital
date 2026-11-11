import { useMemo } from 'react';
import { useCuerposAgua } from '../../../hooks/useCuerposAgua';
import { etiquetaMes, variacionEnCiclo } from '../../../utils/cuerposAgua';
import { formatearNumero } from '../../../utils/historicoPresas';

const pts = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), 1)}`;

/**
 * «La cuenca en este ciclo»: por cada cuerpo de agua de la cuenca, su % del NAMO al cierre del 30-sep (inicio del ciclo) y en su
 * último cierre mensual con dato. Solo contexto: la proyección de esta pestaña sigue siendo la de la presa seleccionada. Un cuerpo sin
 * cierre posterior al inicio (ciclo recién empezado, o sin telemetría) dice S/D; nunca se rellena con 0.
 */
export default function TiraCuencaCiclo({ anioCiclo, onVerCuenca }: { anioCiclo: number; onVerCuenca?: () => void }) {
  const { datos, loading, error } = useCuerposAgua();
  const filas = useMemo(() => (datos ? variacionEnCiclo(datos.cuerpos, datos.cierres, anioCiclo) : []), [datos, anioCiclo]);

  if (loading || error || !filas.length) return null; // contexto opcional: si no carga, la pestaña sigue como antes

  const conDato = filas.filter((f) => f.deltaPct != null).length;
  return (
    <section className="an-card" aria-label="La cuenca en este ciclo">
      <div className="an-h-fila">
        <h4 className="an-h">La cuenca en este ciclo</h4>
        {onVerCuenca && <button type="button" className="an-btn an-btn--chico" onClick={onVerCuenca}>Ver Cuenca del Conchos</button>}
      </div>
      <p className="an-nota">
        Porcentaje del NAMO al 30 de septiembre de {anioCiclo} (inicio del ciclo) y en el último cierre mensual con dato, de cada cuerpo de agua de la cuenca. Contexto de fuentes terceras (SINA, AQUARIUS, reporte SRL); no entra a la proyección de arriba.
        {conDato === 0 && ' El ciclo acaba de empezar: todavía no hay un cierre posterior al inicio.'}
      </p>
      <div className="an-tira-wrap" role="region" aria-label="Variación por cuerpo de agua (desplazable)" tabIndex={0}>
        <table className="an-tira">
          <caption className="an-sr">Cambio del % del NAMO desde el inicio del ciclo, por cuerpo de agua</caption>
          <thead><tr><th scope="col">Cuerpo de agua</th><th scope="col" className="an-n">Inicio (30-sep)</th><th scope="col" className="an-n">Último cierre</th><th scope="col" className="an-n">Cambio</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.cuerpo.id}>
                <th scope="row">{f.cuerpo.etiqueta}</th>
                <td className="an-n">{f.inicio?.pctNamo == null ? 'S/D' : `${formatearNumero(f.inicio.pctNamo, 1)} %`}</td>
                <td className="an-n">
                  {f.actual?.pctNamo == null ? 'S/D' : `${formatearNumero(f.actual.pctNamo, 1)} %`}
                  {f.actual && <small> {etiquetaMes(f.actual.mes, true)}</small>}
                </td>
                <td className="an-n">
                  {f.deltaPct == null ? 'S/D'
                    : <span className={`an-tira-d an-tira-d--${f.deltaPct > 0.05 ? 'sube' : f.deltaPct < -0.05 ? 'baja' : 'igual'}`}>
                      <span aria-hidden="true">{f.deltaPct > 0.05 ? '▲' : f.deltaPct < -0.05 ? '▼' : '■'}</span> {pts(f.deltaPct)} pts
                    </span>}
                  {f.deltaMm3 != null && <small> {pts(f.deltaMm3)} Mm³</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
