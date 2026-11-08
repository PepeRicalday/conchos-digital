import { memo } from 'react';
import { formatearNumero } from '../../../utils/historicoPresas';
import { alturaRelleno } from '../../../utils/cuencaViz';
import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';
import { GLIFO_ESTADO } from './TanquePresa';

interface Props {
    m: PresaCuencaModelo;
    /** Largo del carril como fracción 0-1 (∝ √NAMO, con piso): conserva la idea de tamaño sin tanques. */
    carril: number;
    seleccionada: boolean;
    onSelect: (ubicacionId: number) => void;
}

/**
 * Fila de presa para iPhone y para el dock estrecho del Monitor, donde 7 tanques no caben. Es un botón de ≥ 44 px
 * (en la práctica 72). Una barra horizontal con marcas 20 / 40 % reemplaza al tanque; su largo sigue la capacidad.
 */
function TarjetaPresaMovilBase({ m, carril, seleccionada, onSelect }: Props) {
    const f = m.fila;
    const sd = f.pct == null;
    return (
        <li>
            <button type="button" className={`cu-movil${seleccionada ? ' cu-movil--sel' : ''}`} aria-pressed={seleccionada}
                onClick={() => onSelect(f.ubicacionId)} data-ubicacion={f.ubicacionId}
                aria-label={`${f.etiqueta}, ${sd ? 'sin dato' : `${formatearNumero(f.pct as number, 1)} por ciento del NAMO, ${f.estado.etiqueta}`}`}>
                <span className="cu-mv-cab">
                    <span className="cu-mv-nombre">{f.etiqueta}</span>
                    {f.delDistrito && <span className="cu-tag">Distrito</span>}
                    {f.sinActualizar && <span className="cu-tag cu-tag--aviso">Igual {f.diasIgual ?? '—'} d</span>}
                    {!f.sinActualizar && m.frescura === 'atrasada' && <span className="cu-tag cu-tag--atraso">Atrasada {m.atrasoDias} d</span>}
                    <span className="cu-mv-pct">{sd ? 'S/D' : formatearNumero(f.pct as number, 1)}{!sd && <small> %</small>}</span>
                </span>
                <span className="cu-mv-carril" style={{ width: `${Math.round(carril * 100)}%` }} aria-hidden="true">
                    <span className={`cu-mv-relleno cu-mv-relleno--${f.estado.clave}${f.sinActualizar ? ' cu-mv-relleno--trama' : ''}`} style={{ width: `${alturaRelleno(f.pct)}%` }} />
                    <span className="cu-mv-marca" style={{ left: '20%' }} /><span className="cu-mv-marca" style={{ left: '40%' }} />
                </span>
                <span className="cu-mv-pie">
                    <span className={`cu-estado cu-estado--${f.estado.clave}`}><span aria-hidden="true">{GLIFO_ESTADO[f.estado.clave]}</span> {f.estado.etiqueta}</span>
                    <span>{f.almacenamientoValido == null ? 'S/D' : formatearNumero(f.almacenamientoValido, 1)} / {f.namoMm3 == null ? 'S/D' : formatearNumero(f.namoMm3, 0)} Mm³</span>
                    {m.cambio30Puntos != null && <span>{m.cambio30Puntos > 0 ? '▲ +' : m.cambio30Puntos < 0 ? '▼ −' : '= '}{formatearNumero(Math.abs(m.cambio30Puntos), 1)} pts / 30 d</span>}
                </span>
            </button>
        </li>
    );
}

export default memo(TarjetaPresaMovilBase);
