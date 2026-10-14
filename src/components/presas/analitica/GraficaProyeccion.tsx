import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta, type Proyeccion } from '../../../utils/analiticaPresas';

interface Props {
    proy: Proyeccion;
    umbralCritico: number | null;
    umbralBajo: number | null;
    capacidad: number | null;
}

interface Fila { k: number; fecha: string; base: number | null; delta: number | null; min: number | null; mediana: number | null; max: number | null }

function TooltipProy({ active, payload, valorHoy }: { active?: boolean; payload?: { payload: Fila }[]; valorHoy: number }) {
    if (!active || !payload?.length) return null;
    const f = payload[0].payload;
    return (
        <div className="an-tip">
            <b>{fechaCorta(f.fecha)}{f.k === 0 ? ' · hoy' : ` · +${f.k} d`}</b>
            <span>Seco: <b>{f.min == null ? 'S/D' : `${formatearNumero(f.min, 0)} Mm³`}</b></span>
            <span>Mediana: <b>{f.mediana == null ? 'S/D' : `${formatearNumero(f.mediana, 0)} Mm³`}</b></span>
            <span>Húmedo: <b>{f.max == null ? 'S/D' : `${formatearNumero(f.max, 0)} Mm³`}</b></span>
            {f.mediana != null && <span>Cambio de la mediana vs hoy: <b>{f.mediana - valorHoy > 0 ? '+' : '−'}{formatearNumero(Math.abs(f.mediana - valorHoy), 0)} Mm³</b></span>}
        </div>
    );
}

export default function GraficaProyeccion({ proy, umbralCritico, umbralBajo, capacidad }: Props) {
    const datos = useMemo<Fila[]>(() => proy.puntos.map(p => ({
        k: p.k, fecha: p.fecha, min: p.min, mediana: p.mediana, max: p.max,
        base: p.min, delta: p.min != null && p.max != null ? p.max - p.min : null,
    })), [proy]);

    // Marcas: unas 5 fechas repartidas por el horizonte.
    const marcas = useMemo(() => {
        const n = 5;
        return Array.from({ length: n + 1 }, (_, i) => Math.round((proy.horizonteDias * i) / n));
    }, [proy.horizonteDias]);

    const piso = umbralCritico != null && umbralCritico < Math.min(...datos.map(d => d.min ?? Infinity)) ? Math.floor(umbralCritico * 0.9 / 50) * 50 : 0;

    return (
        <>
            <div className="an-chart" role="img" aria-label="Proyección del volumen almacenado en tres escenarios: seco, mediana y húmedo">
                <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height="100%">
                    <ComposedChart data={datos} margin={{ top: 16, right: 28, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--pr-line)" />
                        <XAxis dataKey="k" type="number" domain={[0, proy.horizonteDias]} ticks={marcas} interval={0}
                            tickFormatter={k => fechaCorta(datos[k as number]?.fecha ?? proy.fechaHoy).slice(0, -5)} axisLine={false} tickLine={false}
                            tick={{ fontSize: 12, fill: 'var(--pr-t3)' }} />
                        <YAxis axisLine={false} tickLine={false} width={52} tick={{ fontSize: 12, fill: 'var(--pr-t3)' }}
                            domain={[piso, (max: number) => Math.min(capacidad ?? Infinity, Math.ceil((max * 1.05) / 50) * 50)]}
                            tickFormatter={v => formatearNumero(v as number, 0)} />
                        <Tooltip content={<TooltipProy valorHoy={proy.valorHoy} />} isAnimationActive={false} />
                        {umbralBajo != null && umbralBajo < (capacidad ?? Infinity) && (
                            <ReferenceLine y={umbralBajo} stroke="var(--pr-warn)" strokeDasharray="4 4"
                                label={{ value: `BAJO 40 % · ${formatearNumero(umbralBajo, 0)} Mm³ (referencia)`, position: 'insideBottomLeft', fill: 'var(--pr-warn)', fontSize: 12 }} />
                        )}
                        {umbralCritico != null && (
                            <ReferenceLine y={umbralCritico} stroke="var(--pr-crit)" strokeDasharray="4 4"
                                label={{ value: `CRÍTICO 20 % · ${formatearNumero(umbralCritico, 0)} Mm³ (referencia)`, position: 'insideBottomLeft', fill: 'var(--pr-crit)', fontSize: 12 }} />
                        )}
                        <Area dataKey="base" stackId="p" stroke="none" fill="none" isAnimationActive={false} connectNulls={false} />
                        <Area dataKey="delta" stackId="p" stroke="none" fill="var(--pr-sky)" fillOpacity={0.2} isAnimationActive={false} connectNulls={false} />
                        <Line dataKey="min" stroke="var(--pr-warn)" strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} connectNulls={false} />
                        <Line dataKey="max" stroke="var(--pr-ok)" strokeWidth={1.5} strokeDasharray="8 4" dot={false} isAnimationActive={false} connectNulls={false} />
                        <Line dataKey="mediana" stroke="var(--pr-sky)" strokeWidth={3} dot={false} isAnimationActive={false} connectNulls={false} />
                        <ReferenceLine x={0} stroke="var(--pr-t1)" strokeDasharray="3 3"
                            label={{ value: 'HOY', position: 'insideTopRight', fill: 'var(--pr-t1)', fontSize: 12, dx: 34 }} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            <ul className="an-leyenda" aria-label="Leyenda">
                <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--pr-sky)" strokeWidth="3" /></svg> Mediana de las trayectorias</li>
                <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--pr-warn)" strokeWidth="1.5" strokeDasharray="2 3" /></svg> Escenario seco (el peor ciclo pasado)</li>
                <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--pr-ok)" strokeWidth="1.5" strokeDasharray="8 4" /></svg> Escenario húmedo (el mejor ciclo pasado)</li>
                <li><svg width="30" height="10" aria-hidden="true"><rect x="0" y="1" width="30" height="8" fill="var(--pr-sky)" fillOpacity="0.35" /></svg> Rango entre escenarios</li>
            </ul>
        </>
    );
}
