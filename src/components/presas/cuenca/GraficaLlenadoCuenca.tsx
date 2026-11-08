import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatearNumero, MESES_CORTO } from '../../../utils/historicoPresas';
import { claveEstancada, COLOR_PRESA_CUENCA, type FilaGrafica, type FilaPresaCuenca } from '../../../utils/aqwpCuenca';
import { fechaCorta } from '../../../utils/analiticaPresas';
import { useDevice } from '../../../hooks/useDevice';

interface Props { serie: FilaGrafica[]; presas: FilaPresaCuenca[] }

/** Primer día presente de cada mes en la serie → marcas del eje X (sin inventar fechas). */
function marcasMeses(serie: FilaGrafica[]): string[] {
    const vistos = new Set<string>();
    const out: string[] = [];
    for (const f of serie) {
        const mes = f.fecha.slice(0, 7);
        if (!vistos.has(mes)) { vistos.add(mes); out.push(f.fecha); }
    }
    return out;
}

function Tip({ active, payload, presas }: { active?: boolean; payload?: { payload: FilaGrafica }[]; presas: FilaPresaCuenca[] }) {
    if (!active || !payload?.length) return null;
    const f = payload[0].payload;
    return (
        <div className="an-tip">
            <b>{fechaCorta(f.fecha)}</b>
            {presas.map(p => {
                const v = f[String(p.ubicacionId)];
                const rep = f[claveEstancada(p.ubicacionId)];
                return (
                    <span key={p.ubicacionId} style={{ color: COLOR_PRESA_CUENCA[p.ubicacionId] }}>
                        {p.nombre}: <b>{typeof v === 'number' ? `${formatearNumero(v, 1)} %`
                            : typeof rep === 'number' ? `${formatearNumero(rep, 1)} % (repetido)` : 'S/D'}</b>
                    </span>
                );
            })}
        </div>
    );
}

/** % de llenado (sobre el NAMO de CONAGUA) de las 7 presas, últimos 12 meses. Las líneas se cortan donde hay S/D. */
export default function GraficaLlenadoCuenca({ serie, presas }: Props) {
    const [ocultas, setOcultas] = useState<Set<number>>(new Set());
    const visibles = useMemo(() => presas.filter(p => !ocultas.has(p.ubicacionId)), [presas, ocultas]);
    const { esPhone } = useDevice();
    // En iPhone caben ~6 etiquetas: un mes sí y otro no, para que no se encimen.
    const marcas = useMemo(() => marcasMeses(serie).filter((_, i) => !esPhone || i % 2 === 0), [serie, esPhone]);

    const alternar = (id: number) => setOcultas(prev => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });

    if (serie.length === 0) {
        return <div className="an-vacio" role="status"><strong>Sin serie de llenado (S/D)</strong><span>Aún no hay lecturas diarias cargadas del portal.</span></div>;
    }

    return (
        <>
            <div className="an-chart" role="img" aria-label="Porcentaje de llenado de las presas de la cuenca del Conchos en los últimos 12 meses">
                <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height="100%">
                    <LineChart data={serie} margin={{ top: 12, right: 20, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--pr-line)" />
                        <XAxis dataKey="fecha" ticks={marcas} interval={0} axisLine={false} tickLine={false}
                            tick={{ fontSize: 12, fill: 'var(--pr-t3)' }}
                            tickFormatter={(f: string) => MESES_CORTO[Number(f.slice(5, 7)) - 1] ?? ''} />
                        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} width={44}
                            tick={{ fontSize: 12, fill: 'var(--pr-t3)' }} tickFormatter={v => `${v} %`} />
                        <Tooltip content={<Tip presas={visibles} />} isAnimationActive={false} />
                        {visibles.map(p => (
                            <Line key={p.ubicacionId} dataKey={String(p.ubicacionId)} stroke={COLOR_PRESA_CUENCA[p.ubicacionId]}
                                strokeWidth={p.delDistrito ? 3 : 1.8} dot={false} isAnimationActive={false} connectNulls={false} />
                        ))}
                        {/* Tramos con el mismo valor repetido: punteados (dudosos), no se esconden. */}
                        {visibles.map(p => (
                            <Line key={`${p.ubicacionId}e`} dataKey={claveEstancada(p.ubicacionId)} stroke={COLOR_PRESA_CUENCA[p.ubicacionId]}
                                strokeWidth={p.delDistrito ? 2.5 : 1.5} strokeDasharray="2 4" strokeOpacity={0.75} dot={false}
                                isAnimationActive={false} connectNulls={false} legendType="none" />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <ul className="an-leyenda cu-leyenda" aria-label="Presas (activar o desactivar)">
                {presas.map(p => {
                    const activa = !ocultas.has(p.ubicacionId);
                    return (
                        <li key={p.ubicacionId}>
                            <button type="button" className="cu-chip" aria-pressed={activa} onClick={() => alternar(p.ubicacionId)}>
                                <svg width="26" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke={COLOR_PRESA_CUENCA[p.ubicacionId]} strokeWidth={p.delDistrito ? 3 : 1.8} opacity={activa ? 1 : 0.3} /></svg>
                                {p.nombre}
                            </button>
                        </li>
                    );
                })}
                <li className="cu-leyenda-nota">
                    <svg width="26" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--pr-t2)" strokeWidth="2.5" strokeDasharray="2 4" /></svg>
                    Punteado: mismo valor repetido varios días (dudoso)
                </li>
            </ul>
        </>
    );
}
