import { memo } from 'react';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';

export interface CeldaModulo { clave: string; nombre: string; pct: number | null; letra: string; estado: EstadoKpi }

/** Una celda por módulo: nombre, letra de estado y %; el color refuerza pero nunca sustituye al texto. */
export const MapaCalorModulos = memo(function MapaCalorModulos({ celdas }: { celdas: CeldaModulo[] }) {
    return (
        <ul className="kp-mapa" role="list" aria-label="Estado por módulo">
            {celdas.map((c) => {
                const p = c.pct == null ? 0 : Math.max(0, Math.min(c.pct, 100));
                return (
                    <li key={c.clave} className={`kp-celda kp-${c.estado.tipo}`} style={{ ['--ci' as string]: (0.07 + (p / 100) * 0.3).toFixed(2) }}
                        title={`${c.nombre}: ${c.estado.texto}${c.pct != null ? ` · ${c.pct.toFixed(1)} %` : ''}`}
                        aria-label={`${c.nombre}: ${c.estado.texto}${c.pct != null ? `, ${c.pct.toFixed(1)} por ciento` : ''}`}>
                        <b>{c.nombre}</b>
                        <span className="kp-celda-letra" aria-hidden="true">{c.letra}{c.letra === 'S' ? '▲' : ''}</span>
                        <small>{c.pct == null ? 'S/D' : `${c.pct.toFixed(0)}%`}</small>
                        <i className="kp-celda-barra" aria-hidden="true"><em style={{ width: `${p}%` }} /></i>
                    </li>
                );
            })}
        </ul>
    );
});
