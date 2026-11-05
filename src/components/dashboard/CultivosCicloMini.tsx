import { memo } from 'react';
import { Link } from 'react-router-dom';
import { IconoCultivo, estiloCultivo } from '../ndvi/IconoCultivo';
import { infoCultivo } from '../../utils/cultivos';
import { TEXTO_SIN_CICLO } from '../../utils/estadoAnio';
import type { ResumenCultivosCiclo } from '../../utils/cultivosCiclo';

export const ENLACE_CULTIVOS_CICLO = '/geo-monitor?panel=ndvi&vista=ciclo';

const f0 = (n: number | null) => (n == null ? 'S/D' : n.toLocaleString('es-MX', { maximumFractionDigits: 0 }));
const f1 = (n: number | null) => (n == null ? 'S/D' : n.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

interface Props { r: ResumenCultivosCiclo; cargado: boolean; error: string | null }

/**
 * Mini composición de la tarjeta Ciclo: barra apilada del volumen por cultivo + leyenda (ícono, nombre, hm³ y %).
 * El color nunca va solo: cada cultivo lleva ícono y nombre escrito. Dato ausente = «S/D»; año sin riego de presa = «Sin ciclo».
 */
export const CultivosCicloMini = memo(function CultivosCicloMini({ r, cargado, error }: Props) {
    if (error) return <div className="kp-ciclo-cult kp-ciclo-cult-msg" role="status">Cultivos no disponibles ahora</div>;
    if (!cargado) return <div className="kp-ciclo-cult kp-ciclo-cult-msg" role="status">Cargando cultivos…</div>;
    if (r.estado === 'sin-ciclo') return <div className="kp-ciclo-cult kp-ciclo-cult-msg" role="status" title={TEXTO_SIN_CICLO}>Sin ciclo de riego de presa</div>;
    if (r.estado === 'sd') return <div className="kp-ciclo-cult kp-ciclo-cult-msg" role="status">Cultivos del ciclo: S/D</div>;
    const resumen = `Cultivos sembrados: ${f0(r.superficieHa)} hectáreas y ${f1(r.volumenHm3)} hm³. ${r.partes.map(p => `${p.nombre} ${Math.round(p.pct)} por ciento`).join(', ')}`;
    return (
        <div className="kp-ciclo-cult" role="group" aria-label={resumen}>
            <div className="kp-cc-cab"><span>Sembrado</span><b>{f0(r.superficieHa)} ha</b><span>· {f1(r.volumenHm3)} hm³</span></div>
            <div className="kp-cc-barra" aria-hidden="true">
                {r.partes.map(p => <i key={p.nombre} style={{ ...estiloCultivo(p.esOtros ? 'Otros' : p.nombre), flexGrow: Math.max(p.pct, 1) }} />)}
            </div>
            <ul className="kp-cc-lista">
                {r.partes.map(p => {
                    const nombre = p.esOtros ? 'Otros' : infoCultivo(p.nombre).nombre;
                    return (
                        <li key={p.nombre} style={estiloCultivo(p.esOtros ? 'Otros' : p.nombre)} title={p.esOtros ? `${p.cultivos.join(', ')}` : undefined}>
                            <span className="kp-cc-ico"><IconoCultivo nombre={p.esOtros ? 'Otros' : p.nombre} size={14} /></span>
                            <span className="kp-cc-nom">{nombre}</span>
                            <span className="kp-cc-num">{f1(p.valor)} hm³ · {Math.round(p.pct)} %</span>
                        </li>
                    );
                })}
            </ul>
            <Link to={ENLACE_CULTIVOS_CICLO} className="kp-cc-ver">Ver cultivos del ciclo →</Link>
        </div>
    );
});
