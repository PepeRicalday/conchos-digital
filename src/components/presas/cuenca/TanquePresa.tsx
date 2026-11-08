import { memo, useId } from 'react';
import { formatearNumero } from '../../../utils/historicoPresas';
import { alturaRelleno, posicionMuerto } from '../../../utils/cuencaViz';
import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';

export const GLIFO_ESTADO: Record<string, string> = { ok: '●', warn: '▲', crit: '■', sd: '◇' };
const COLOR_ESTADO: Record<string, string> = { ok: 'var(--pr-ok)', warn: 'var(--pr-warn)', crit: 'var(--pr-crit)', sd: 'var(--pr-t3)' };

/** Alto del tanque en px. El ancho lo decide la capacidad (∝ √NAMO, ver anchoTanque). */
export const ALTO_TANQUE = 150;

interface Props {
    m: PresaCuencaModelo;
    /** Ancho del tanque (∝ √NAMO). */
    ancho: number;
    /** Ancho del botón (≥ ancho): deja espacio al texto de debajo. */
    anchoBoton: number;
    seleccionada: boolean;
    onSelect: (ubicacionId: number) => void;
}

/**
 * Tanque de una presa: el ANCHO es la capacidad real (NAMO) y el relleno, el % del NAMO. Marcas 20 / 40 % (los umbrales de
 * estado), línea punteada del volumen muerto, trama diagonal si la lectura está sin actualizar y trama gris + "S/D" si
 * nunca trajo dato (nunca se dibuja como 0 %). El estado va en glifo + texto, no solo en color. Es un botón: selecciona la presa.
 */
function TanquePresaBase({ m, ancho, anchoBoton, seleccionada, onSelect }: Props) {
    const uid = useId().replace(/:/g, '');
    const f = m.fila;
    const sd = f.pct == null;
    const alto = ALTO_TANQUE;
    const x0 = 2, w = Math.max(20, ancho - 4), yTop = 2, h = alto - 4;
    const hAgua = (h * alturaRelleno(f.pct)) / 100;
    const yAgua = yTop + h - hAgua;
    const muerto = posicionMuerto(f.muertoMm3, f.namoMm3);
    const yMuerto = muerto == null ? null : yTop + h - (h * muerto) / 100;
    const y20 = yTop + h - (h * 20) / 100, y40 = yTop + h - (h * 40) / 100;
    const color = COLOR_ESTADO[f.estado.clave] ?? COLOR_ESTADO.sd;
    const ancha = ancho >= 90;

    const aria = [
        f.etiqueta,
        sd ? 'sin dato' : `${formatearNumero(f.pct as number, 1)} por ciento del NAMO, ${f.estado.etiqueta}`,
        f.namoMm3 != null ? `capacidad ${formatearNumero(f.namoMm3, 0)} millones de metros cúbicos` : null,
        f.sinActualizar ? 'lectura sin actualizar' : null,
        m.frescura === 'atrasada' ? 'dato atrasado' : null,
    ].filter(Boolean).join(', ');

    return (
        <button type="button" className={`cu-tanque${seleccionada ? ' cu-tanque--sel' : ''}`} aria-pressed={seleccionada}
            aria-label={aria} onClick={() => onSelect(f.ubicacionId)} data-ubicacion={f.ubicacionId}
            style={{ width: anchoBoton }}>
            <svg className="cu-tanque-svg" width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} aria-hidden="true" focusable="false">
                <defs>
                    <clipPath id={`cu-c-${uid}`}><rect x={x0} y={yTop} width={w} height={h} rx="8" /></clipPath>
                    <linearGradient id={`cu-g-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={color} stopOpacity="0.95" />
                        <stop offset="1" stopColor={color} stopOpacity="0.55" />
                    </linearGradient>
                    <pattern id={`cu-tr-${uid}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="8" height="8" fill="transparent" /><line x1="0" y1="0" x2="0" y2="8" stroke="var(--pr-t1)" strokeOpacity="0.55" strokeWidth="2.5" />
                    </pattern>
                    <pattern id={`cu-sd-${uid}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                        <rect width="7" height="7" fill="transparent" /><line x1="0" y1="0" x2="0" y2="7" stroke="var(--pr-t3)" strokeOpacity="0.4" strokeWidth="1.5" />
                    </pattern>
                </defs>
                <rect x={x0} y={yTop} width={w} height={h} rx="8" fill="var(--pr-surface)" />
                <g clipPath={`url(#cu-c-${uid})`}>
                    {sd
                        ? <rect x={x0} y={yTop} width={w} height={h} fill={`url(#cu-sd-${uid})`} />
                        : <>
                            <rect x={x0} y={yAgua} width={w} height={hAgua} fill={`url(#cu-g-${uid})`} className="cu-agua" />
                            {f.sinActualizar && <rect x={x0} y={yAgua} width={w} height={hAgua} fill={`url(#cu-tr-${uid})`} />}
                        </>}
                </g>
                {/* umbrales de referencia 40 % y 20 % */}
                <line x1={x0} x2={x0 + w} y1={y40} y2={y40} stroke="var(--pr-t2)" strokeOpacity="0.55" strokeDasharray="4 4" />
                <line x1={x0} x2={x0 + w} y1={y20} y2={y20} stroke="var(--pr-t2)" strokeOpacity="0.55" strokeDasharray="4 4" />
                {ancha && <><text x={x0 + w - 4} y={y40 - 3} textAnchor="end" fontSize="12" fill="var(--pr-t2)">40</text><text x={x0 + w - 4} y={y20 - 3} textAnchor="end" fontSize="12" fill="var(--pr-t2)">20</text></>}
                {yMuerto != null && muerto != null && muerto > 1.5 && (
                    <line x1={x0} x2={x0 + w} y1={yMuerto} y2={yMuerto} stroke="var(--pr-sky)" strokeWidth="1.5" strokeDasharray="1.5 3"><title>Volumen muerto</title></line>
                )}
                <rect x={x0} y={yTop} width={w} height={h} rx="8" fill="none" stroke={seleccionada ? 'var(--pr-sky)' : 'rgba(148,163,184,0.55)'} strokeWidth={seleccionada ? 2.5 : 1.5} />
            </svg>

            <span className="cu-tq-pct">{sd ? 'S/D' : formatearNumero(f.pct as number, 1)}{!sd && <small> %</small>}</span>
            <span className="cu-tq-nombre">{f.etiqueta}</span>
            <span className="cu-tq-meta">{f.almacenamientoValido == null ? 'S/D' : formatearNumero(f.almacenamientoValido, 1)} / {f.namoMm3 == null ? 'S/D' : formatearNumero(f.namoMm3, 0)} Mm³</span>
            <span className={`cu-estado cu-estado--${f.estado.clave}`}><span aria-hidden="true">{GLIFO_ESTADO[f.estado.clave]}</span> {f.estado.etiqueta}</span>
            {f.sinActualizar && <span className="cu-tag cu-tag--aviso">Igual {f.diasIgual ?? '—'} d</span>}
            {!f.sinActualizar && m.frescura === 'atrasada' && <span className="cu-tag cu-tag--atraso">Atrasada {m.atrasoDias} d</span>}
        </button>
    );
}

export default memo(TanquePresaBase);
