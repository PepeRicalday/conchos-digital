import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';

export interface CeldaModulo {
    clave: string; nombre: string; pct: number | null; letra: string; estado: EstadoKpi;
    /** Código corto (M1…M12) para el enlace profundo a Hidrometría. */
    codigo?: string | null;
    nombreLargo?: string | null;
    /** Ruta del logo del módulo (A.C.U.); sin logo la celda queda solo con el código. */
    logo?: string | null;
}

/** Logo del módulo: miniatura sobre fondo claro (los logos son JPG con fondo blanco). Si no carga, se omite sin romper la celda. */
function Logo({ src }: { src: string }) {
    const [roto, setRoto] = useState(false);
    if (roto) return null;
    return <span className="kp-celda-logo" aria-hidden="true"><img src={src} alt="" loading="lazy" decoding="async" onError={() => setRoto(true)} /></span>;
}

/** Una celda por módulo (enlace a Hidrometría): logo, nombre, letra de estado y %; el color refuerza pero nunca sustituye al texto. */
export const MapaCalorModulos = memo(function MapaCalorModulos({ celdas }: { celdas: CeldaModulo[] }) {
    return (
        <ul className="kp-mapa" role="list" aria-label="Estado por módulo">
            {celdas.map((c) => {
                const p = c.pct == null ? 0 : Math.max(0, Math.min(c.pct, 100));
                const texto = `${c.nombreLargo ?? c.nombre}: ${c.estado.texto}${c.pct != null ? `, ${c.pct.toFixed(1)} por ciento del volumen autorizado` : ', sin dato'}`;
                const a = c.codigo ? `/hidrometria?modulo=${encodeURIComponent(c.codigo)}` : '/hidrometria';
                return (
                    <li key={c.clave} className="kp-mapa-i">
                        <Link to={a} className={`kp-celda kp-${c.estado.tipo}`} style={{ ['--ci' as string]: (0.07 + (p / 100) * 0.3).toFixed(2) }}
                            title={`${c.nombreLargo ?? c.nombre} — ${c.estado.texto}${c.pct != null ? ` · ${c.pct.toFixed(1)} %` : ''}. Abrir en Hidrometría`}
                            aria-label={`${texto}. Abrir en Hidrometría`}>
                            {c.logo && <Logo src={c.logo} />}
                            <b>{c.nombre}</b>
                            <span className="kp-celda-letra" aria-hidden="true">{c.letra}{c.letra === 'S' ? '▲' : ''}</span>
                            <small>{c.pct == null ? 'S/D' : `${c.pct.toFixed(0)}%`}</small>
                            <i className="kp-celda-barra" aria-hidden="true"><em style={{ width: `${p}%` }} /></i>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
});
