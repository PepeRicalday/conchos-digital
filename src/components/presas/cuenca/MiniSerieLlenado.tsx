import { memo, useMemo } from 'react';
import { formatearNumero } from '../../../utils/historicoPresas';
import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';
import type { PuntoSemanal } from '../../../utils/cuencaViz';
import SemaforoBadge from './SemaforoBadge';

const W = 200, H = 84;
const DIA_MS = 86_400_000;
const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

interface Props {
    m: PresaCuencaModelo;
    /** 3 o 12 meses. */
    meses: 3 | 12;
    seleccionada: boolean;
    onSelect: (ubicacionId: number) => void;
}

interface Tramo { d: string; dudoso: boolean }

/**
 * Mini-serie de una presa (SVG sin texto: las cifras van en HTML a ≥ 12 px). Escala Y 0-100 % del NAMO COMPARTIDA por las 7,
 * para poder comparar de un vistazo. Banda = p10–p90 del mismo día del año (2017-último año completo) con la mediana punteada;
 * sin climatología se dibuja el rango propio de los últimos 12 meses y se rotula así. Líneas guía en 20 y 40 %. Los tramos
 * "sin actualizar" van punteados en violeta. Sin dato queda un hueco: nunca se interpola ni se dibuja 0.
 */
function MiniSerieBase({ m, meses, seleccionada, onSelect }: Props) {
    const f = m.fila;

    const { tramos, banda, mediana, rango, ultimo } = useMemo(() => {
        const todos = m.serie;
        const corte = todos.length ? ms(todos[todos.length - 1].fecha) - Math.round(meses * 30.4375) * DIA_MS : 0;
        const pts: PuntoSemanal[] = todos.filter((p) => ms(p.fecha) >= corte);
        if (pts.length === 0) return { tramos: [] as Tramo[], banda: null, mediana: null, rango: null, ultimo: null };
        const t0 = ms(pts[0].fecha), t1 = ms(pts[pts.length - 1].fecha);
        const x = (iso: string) => (t1 === t0 ? W : ((ms(iso) - t0) / (t1 - t0)) * W);
        const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;

        // tramos continuos (corte en S/D); un cambio de "dudoso" abre otro tramo
        const tramos: Tramo[] = [];
        let actual: { puntos: string[]; dudoso: boolean } | null = null;
        for (const p of pts) {
            if (p.pct == null) { if (actual) { tramos.push({ d: actual.puntos.join(' '), dudoso: actual.dudoso }); actual = null; } continue; }
            const punto: string = `${actual ? 'L' : 'M'}${x(p.fecha).toFixed(1)},${y(p.pct).toFixed(1)}`;
            if (actual && actual.dudoso !== p.dudoso) {
                const prev: string = actual.puntos[actual.puntos.length - 1].replace(/^[ML]/, '');
                tramos.push({ d: actual.puntos.join(' '), dudoso: actual.dudoso });
                actual = { puntos: [`M${prev}`, `L${x(p.fecha).toFixed(1)},${y(p.pct).toFixed(1)}`], dudoso: p.dudoso };
            } else if (actual) actual.puntos.push(punto);
            else actual = { puntos: [punto], dudoso: p.dudoso };
        }
        if (actual) tramos.push({ d: actual.puntos.join(' '), dudoso: actual.dudoso });

        let banda: string | null = null, mediana: string | null = null;
        const b = (m.banda ?? []).filter((q) => pts.some((p) => p.fecha === q.fecha));
        const conBanda = b.filter((q) => q.p10 != null && q.p90 != null);
        if (conBanda.length >= 2) {
            banda = `M${conBanda.map((q) => `${x(q.fecha).toFixed(1)},${y(q.p90 as number).toFixed(1)}`).join(' L')} L${[...conBanda].reverse().map((q) => `${x(q.fecha).toFixed(1)},${y(q.p10 as number).toFixed(1)}`).join(' L')} Z`;
            const med = b.filter((q) => q.mediana != null);
            if (med.length >= 2) mediana = `M${med.map((q) => `${x(q.fecha).toFixed(1)},${y(q.mediana as number).toFixed(1)}`).join(' L')}`;
        }
        const conDato = pts.filter((p) => p.pct != null);
        const ultimo = conDato.length ? { x: x(conDato[conDato.length - 1].fecha), y: y(conDato[conDato.length - 1].pct as number) } : null;
        const vals = conDato.map((p) => p.pct as number);
        const rango = vals.length ? { min: Math.min(...vals), max: Math.max(...vals), y0: y(Math.max(...vals)), y1: y(Math.min(...vals)) } : null;
        return { tramos, banda, mediana, rango, ultimo };
    }, [m.serie, m.banda, meses]);

    const pos = m.posicion;
    const desdeMediana = pos?.mediana != null && f.pct != null && f.namoMm3
        ? f.pct - (pos.mediana / f.namoMm3) * 100 : null;
    const sinDatos = tramos.length === 0;

    return (
        <button type="button" className={`cu-mini${seleccionada ? ' cu-mini--sel' : ''}`} aria-pressed={seleccionada}
            onClick={() => onSelect(f.ubicacionId)} data-ubicacion={f.ubicacionId}
            aria-label={`${f.etiqueta}: serie de ${meses} meses${pos ? `, percentil ${pos.percentil ?? 'S/D'} frente a ${pos.nAnios} años` : ''}`}>
            <span className="cu-mini-cab">
                <span className="cu-mini-nombre">{f.etiqueta}</span>
                <SemaforoBadge s={m.semaforo} />
            </span>
            <span className="cu-mini-num">
                <span className="cu-mini-pct">{f.pct == null ? 'S/D' : formatearNumero(f.pct, 1)}{f.pct != null && <small> %</small>}</span>
                {m.cambio30Puntos != null && (
                    <span className={`cu-mini-delta${m.cambio30Puntos < 0 ? ' cu-mini-delta--baja' : ''}`}>
                        {m.cambio30Puntos > 0 ? '▲ +' : m.cambio30Puntos < 0 ? '▼ −' : '= '}{formatearNumero(Math.abs(m.cambio30Puntos), 1)} pts <small>30 d</small>
                    </span>
                )}
            </span>
            <svg className="cu-mini-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-hidden="true" focusable="false">
                <line x1="0" x2={W} y1={H * 0.8} y2={H * 0.8} className="cu-guia" vectorEffect="non-scaling-stroke" />
                <line x1="0" x2={W} y1={H * 0.6} y2={H * 0.6} className="cu-guia" vectorEffect="non-scaling-stroke" />
                {banda
                    ? <path d={banda} className="cu-banda" />
                    : rango && <rect x="0" width={W} y={rango.y0} height={Math.max(1, rango.y1 - rango.y0)} className="cu-banda cu-banda--propia" />}
                {mediana && <path d={mediana} className="cu-mediana" vectorEffect="non-scaling-stroke" />}
                {tramos.map((t, i) => <path key={i} d={t.d} className={t.dudoso ? 'cu-linea cu-linea--dudosa' : 'cu-linea'} vectorEffect="non-scaling-stroke" />)}
                {ultimo && <line x1={ultimo.x} x2={ultimo.x} y1={Math.max(0, ultimo.y - 7)} y2={Math.min(H, ultimo.y + 7)} className="cu-ultimo" vectorEffect="non-scaling-stroke" />}
            </svg>
            <span className="cu-mini-pie">
                {sinDatos ? 'Sin serie (S/D)'
                    : pos?.percentil != null ? <>Percentil <b>{pos.percentil}</b> del día · {desdeMediana == null ? '' : <>{desdeMediana > 0 ? '+' : desdeMediana < 0 ? '−' : ''}{formatearNumero(Math.abs(desdeMediana), 0)} pts vs mediana · </>}n = {pos.nAnios} años</>
                    : pos ? <>Mediana del día {pos.mediana != null ? `${formatearNumero(pos.mediana, 0)} Mm³` : 'S/D'} · n = {pos.nAnios} años (pocos para percentil)</>
                    : rango ? <>Rango 12 m: {formatearNumero(rango.min, 0)}–{formatearNumero(rango.max, 0)} %</>
                    : 'S/D'}
            </span>
        </button>
    );
}

export default memo(MiniSerieBase);
