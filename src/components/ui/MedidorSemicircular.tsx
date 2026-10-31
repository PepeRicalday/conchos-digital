import { memo } from 'react';

export interface ZonaMedidor { hasta: number; tipo: 'crit' | 'warn' | 'ok' }
interface Props {
    /** null = S/D (arcos rayados, sin aguja). */
    valor: number | null;
    max: number;
    zonas: ZonaMedidor[];
    etiqueta: string;
    unidad?: string;
    /** Sin base de cálculo (p. ej. presas cerradas): arcos atenuados, sin aguja, con símbolo de pausa. */
    inactivo?: boolean;
}

const CX = 60, CY = 60, R = 48;
const pt = (grados: number, r = R) => ({ x: CX + r * Math.cos((grados * Math.PI) / 180), y: CY - r * Math.sin((grados * Math.PI) / 180) });
const arco = (a1: number, a2: number) => { const p1 = pt(a1), p2 = pt(a2); return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${R} ${R} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`; };

/** Medidor de 180° con zonas de umbral y aguja. El texto va fuera del SVG (HTML), así nunca baja de 12 px al escalar. */
export const MedidorSemicircular = memo(function MedidorSemicircular({ valor, max, zonas, etiqueta, unidad = '', inactivo = false }: Props) {
    const ang = (v: number) => 180 - (Math.max(0, Math.min(v, max)) / max) * 180;
    let desde = 0;
    const arcos = zonas.map((z) => { const a = { ...z, desde, a1: ang(desde), a2: ang(Math.min(z.hasta, max)) }; desde = Math.min(z.hasta, max); return a; });
    const sinDato = valor == null;
    const activa = !sinDato && !inactivo ? arcos.find((z) => valor! >= z.desde && (valor! <= z.hasta || z === arcos[arcos.length - 1])) : null;
    const aguja = !sinDato && !inactivo ? pt(ang(valor!), R - 10) : null;
    const desc = inactivo ? `${etiqueta}: sin base de cálculo` : sinDato ? `${etiqueta}: sin dato` : `${etiqueta}: ${valor!.toFixed(0)} ${unidad}${valor! > max ? ` (más de ${max})` : ''}`;
    return (
        <svg className={`kp-medidor ${inactivo ? 'kp-medidor-off' : ''} ${sinDato ? 'kp-medidor-sd' : ''}`} viewBox="0 0 120 70" preserveAspectRatio="xMidYMax meet" role="meter"
            aria-label={desc} aria-valuemin={0} aria-valuemax={max} aria-valuenow={sinDato || inactivo ? undefined : Math.min(valor!, max)} aria-valuetext={desc}>
            {arcos.map((z, i) => <path key={i} d={arco(z.a1, z.a2)} className={`kp-arco kp-arco-${z.tipo} ${activa === z ? 'kp-arco-activo' : ''}`} fill="none" strokeWidth={10} strokeLinecap="butt" />)}
            {arcos.slice(1).map((z, i) => { const a = pt(z.a1, R - 8), b = pt(z.a1, R + 8); return <line key={`t${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="kp-tick" />; })}
            {aguja && <>
                <line x1={CX} y1={CY} x2={aguja.x} y2={aguja.y} className="kp-aguja" />
                <circle cx={CX} cy={CY} r={5} className="kp-hub" />
            </>}
            {inactivo && <g className="kp-pausa"><rect x={53} y={42} width={5} height={16} rx={1.5} /><rect x={62} y={42} width={5} height={16} rx={1.5} /></g>}
        </svg>
    );
});
