import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatearNumero, MESES_CORTO } from '../../../utils/historicoPresas';
import { diaDeCiclo, fechaCorta, fechaDeCiclo, ultimoDiaCiclo, type CicloHistorico, type PuntoBanda } from '../../../utils/analiticaPresas';

interface Props {
    anioActual: number;
    diaHoy: number;
    actual: (number | null)[];
    banda: PuntoBanda[];
    previo: CicloHistorico | null;
}

interface Fila { dia: number; base: number | null; delta: number | null; mediana: number | null; max: number | null; min: number | null; actual: number | null; previo: number | null }

/** Marcas del eje X: el día 1 de cada mes del ciclo (oct → sep). */
function marcasMeses(anioActual: number): { dia: number; etiqueta: string }[] {
    return Array.from({ length: 12 }, (_, i) => {
        const mes = ((9 + i) % 12) + 1;
        const anio = mes >= 10 ? anioActual : anioActual + 1;
        return { dia: diaDeCiclo(`${anio}-${String(mes).padStart(2, '0')}-01`, anioActual), etiqueta: MESES_CORTO[mes - 1] };
    });
}

function TooltipCiclo({ active, payload, anioActual }: { active?: boolean; payload?: { payload: Fila }[]; anioActual: number }) {
    if (!active || !payload?.length) return null;
    const f = payload[0].payload;
    return (
        <div className="an-tip">
            <b>{fechaCorta(fechaDeCiclo(anioActual, f.dia))}</b>
            <span>Ciclo actual: <b>{f.actual == null ? 'S/D' : `${formatearNumero(f.actual, 1)} Mm³`}</b></span>
            <span>Mediana de ciclos pasados: <b>{f.mediana == null ? 'S/D' : `${formatearNumero(f.mediana, 1)} Mm³`}</b></span>
            <span>Rango pasado: <b>{f.min == null || f.max == null ? 'S/D' : `${formatearNumero(f.min, 0)} – ${formatearNumero(f.max, 0)} Mm³`}</b></span>
            {f.previo != null && <span>Ciclo anterior: <b>{formatearNumero(f.previo, 1)} Mm³</b></span>}
            {f.actual != null && f.mediana != null && <span>Diferencia vs mediana: <b>{f.actual - f.mediana > 0 ? '+' : '−'}{formatearNumero(Math.abs(f.actual - f.mediana), 1)} Mm³</b></span>}
        </div>
    );
}

export default function GraficaCiclo({ anioActual, diaHoy, actual, banda, previo }: Props) {
    const ultimo = ultimoDiaCiclo(anioActual);
    const datos = useMemo<Fila[]>(() => Array.from({ length: ultimo + 1 }, (_, dia) => {
        const b = banda[dia];
        const hayBanda = b?.min != null && b.max != null;
        return {
            dia,
            base: hayBanda ? b.min : null,
            delta: hayBanda ? (b.max as number) - (b.min as number) : null,
            mediana: b?.mediana ?? null, min: b?.min ?? null, max: b?.max ?? null,
            // El ciclo en curso se dibuja tal cual: solo hasta hoy, sin interpolar ni inventar el resto.
            actual: dia <= diaHoy ? actual[dia] ?? null : null,
            previo: previo?.serie[dia] ?? null,
        };
    }), [ultimo, banda, actual, diaHoy, previo]);

    const marcas = useMemo(() => marcasMeses(anioActual), [anioActual]);
    const hayActual = datos.some(d => d.actual != null);
    // Solo se marca con punto la última lectura real: los 14 puntos diarios amontonados parecían una mancha.
    const ultimoActual = datos.reduce((u, d, i) => (d.actual != null ? i : u), -1);

    return (
        <>
            <div className="an-chart" role="img" aria-label="Volumen almacenado del ciclo en curso frente a la banda de ciclos pasados">
                <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height="100%">
                    <ComposedChart data={datos} margin={{ top: 16, right: 28, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--pr-line)" />
                        <XAxis dataKey="dia" type="number" domain={[0, ultimo]} ticks={marcas.map(m => m.dia)} interval={0}
                            tickFormatter={d => marcas.find(m => m.dia === d)?.etiqueta ?? ''} axisLine={false} tickLine={false}
                            tick={{ fontSize: 12, fill: 'var(--pr-t3)' }} />
                        <YAxis axisLine={false} tickLine={false} width={52} tick={{ fontSize: 12, fill: 'var(--pr-t3)' }}
                            domain={[0, (max: number) => Math.ceil((max * 1.05) / 50) * 50]}
                            tickFormatter={v => formatearNumero(v as number, 0)} />
                        <Tooltip content={<TooltipCiclo anioActual={anioActual} />} isAnimationActive={false} />
                        <Area dataKey="base" stackId="b" stroke="none" fill="none" isAnimationActive={false} connectNulls={false} legendType="none" />
                        <Area dataKey="delta" stackId="b" stroke="none" fill="var(--pr-violet)" fillOpacity={0.2} isAnimationActive={false} connectNulls={false} />
                        <Line dataKey="mediana" stroke="var(--pr-t2)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls={false} />
                        {previo && <Line dataKey="previo" stroke="var(--pr-warn)" strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} connectNulls={false} />}
                        <Line dataKey="actual" stroke="var(--pr-sky)" strokeWidth={3} dot={(d: { cx?: number; cy?: number; index?: number }) => d.index === ultimoActual && d.cx != null && d.cy != null ? <circle key="hoy" cx={d.cx} cy={d.cy} r={5} fill="var(--pr-sky)" stroke="var(--pr-t1)" strokeWidth={1.5} /> : <g key={d.index} />} isAnimationActive={false} connectNulls={false} />
                        <ReferenceLine x={diaHoy} stroke="var(--pr-t1)" strokeDasharray="3 3"
                            label={{ value: `HOY ${fechaCorta(fechaDeCiclo(anioActual, diaHoy)).slice(0, -5)}`, position: 'insideTopRight', fill: 'var(--pr-t1)', fontSize: 12, dx: 78 }} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            {!hayActual && <p className="an-aviso">Sin lecturas del ciclo en curso (S/D).</p>}
            <ul className="an-leyenda" aria-label="Leyenda">
                <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--pr-sky)" strokeWidth="3" /><circle cx="15" cy="5" r="3.5" fill="var(--pr-sky)" /></svg> Ciclo en curso (lecturas reales)</li>
                <li><svg width="30" height="10" aria-hidden="true"><rect x="0" y="1" width="30" height="8" fill="var(--pr-violet)" fillOpacity="0.35" /></svg> Mínimo – máximo de ciclos pasados</li>
                <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--pr-t2)" strokeWidth="2" strokeDasharray="6 4" /></svg> Mediana de ciclos pasados</li>
                {previo && <li><svg width="30" height="10" aria-hidden="true"><line x1="0" y1="5" x2="30" y2="5" stroke="var(--pr-warn)" strokeWidth="1.5" strokeDasharray="2 3" /></svg> Ciclo anterior ({previo.etiqueta})</li>}
            </ul>
        </>
    );
}
