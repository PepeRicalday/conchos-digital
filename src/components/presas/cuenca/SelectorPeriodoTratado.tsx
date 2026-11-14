import { useMemo } from 'react';
import { anioDelCiclo, mesesDelCiclo, resuelvePeriodo, type CicloTratado, type PeriodoSel } from '../../../utils/tratadoCiclo';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const etiquetaMes = (m: string) => `${MESES[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`;

type Tipo = PeriodoSel['tipo'];

/** Periodo del avance: ciclo completo, año del ciclo (25-oct → 24-oct), un mes o un rango libre. */
export default function SelectorPeriodoTratado({ ciclo, valor, onChange, hoyISO, id = 'tr-per' }: {
  ciclo: CicloTratado; valor: PeriodoSel; onChange: (p: PeriodoSel) => void; hoyISO: string; id?: string;
}) {
  const anioActual = anioDelCiclo(ciclo, hoyISO) ?? 1;
  const meses = useMemo(() => mesesDelCiclo(ciclo, hoyISO), [ciclo, hoyISO]);
  const per = resuelvePeriodo(ciclo, valor, hoyISO);
  const cambiaTipo = (t: Tipo) => {
    if (t === 'ciclo') onChange({ tipo: 'ciclo' });
    else if (t === 'anio') onChange({ tipo: 'anio', anio: anioActual });
    else if (t === 'mes') onChange({ tipo: 'mes', mes: meses[0] ?? ciclo.inicio.slice(0, 7) });
    else onChange({ tipo: 'rango', desde: per.desde, hasta: per.hasta });
  };
  const TIPOS: { v: Tipo; t: string }[] = [{ v: 'ciclo', t: 'Ciclo completo' }, { v: 'anio', t: 'Año del ciclo' }, { v: 'mes', t: 'Mes' }, { v: 'rango', t: 'Rango libre' }];
  return (
    <div className="cu-controles tr-periodo" role="group" aria-label="Periodo del avance del Tratado">
      <div className="cu-ctl">
        <span className="cu-ctl-etq" id={`${id}-t`}>Periodo</span>
        <div className="an-seg cu-seg-envuelve" role="group" aria-labelledby={`${id}-t`}>
          {TIPOS.map((o) => <button key={o.v} type="button" className="an-seg-btn" aria-pressed={valor.tipo === o.v} onClick={() => cambiaTipo(o.v)}>{o.t}</button>)}
        </div>
      </div>
      {valor.tipo === 'anio' && (
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id={`${id}-a`}>Año</span>
          <div className="an-seg" role="group" aria-labelledby={`${id}-a`}>
            {[1, 2, 3, 4, 5].filter((a) => a <= anioActual).map((a) => <button key={a} type="button" className="an-seg-btn" aria-pressed={valor.anio === a} onClick={() => onChange({ tipo: 'anio', anio: a })}>{a}{a === anioActual ? ' (en curso)' : ''}</button>)}
          </div>
        </div>
      )}
      {valor.tipo === 'mes' && (
        <label className="cu-ctl">
          <span className="cu-ctl-etq">Mes</span>
          <select className="tr-sel" value={valor.mes} onChange={(e) => onChange({ tipo: 'mes', mes: e.target.value })}>
            {meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}
          </select>
        </label>
      )}
      {valor.tipo === 'rango' && (
        <div className="cu-ctl tr-rango">
          <label><span className="cu-ctl-etq">Del</span><input type="date" className="tr-sel" value={valor.desde} min={ciclo.inicio} max={hoyISO} onChange={(e) => e.target.value && onChange({ tipo: 'rango', desde: e.target.value, hasta: valor.hasta })} /></label>
          <label><span className="cu-ctl-etq">Al</span><input type="date" className="tr-sel" value={valor.hasta} min={ciclo.inicio} max={hoyISO} onChange={(e) => e.target.value && onChange({ tipo: 'rango', desde: valor.desde, hasta: e.target.value })} /></label>
        </div>
      )}
    </div>
  );
}
