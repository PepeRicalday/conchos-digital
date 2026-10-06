import { memo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PresaGrafica, PuntoSerie } from '../../utils/dashboardKpis';

// Paleta categórica validada sobre #020a14: azul = almacenamiento, aqua = extracción.
const C_ALM = '#3987e5';
const C_EXT = '#199e70';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etiquetaDia = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]}`;

const TICK = { fill: '#8396ad', fontSize: 11 };
const Tip = ({ active, payload, label, unidad }: { active?: boolean; payload?: { name?: string; value?: number | null }[]; label?: string; unidad: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="sc-tip">
            <div>{label}</div>
            {payload.map((p, i) => <div key={i}>{p.name}: <b>{p.value == null ? 'S/D' : `${Number(p.value).toFixed(1)} ${unidad}`}</b></div>)}
        </div>
    );
};

/** Almacenamiento por presa y extracción de 7 días. Los días/presas sin dato quedan en blanco: nunca se dibujan como 0. */
export const TendenciasPresas = memo(function TendenciasPresas({ presas, serie, esHoy }: { presas: PresaGrafica[]; serie: PuntoSerie[]; esHoy: boolean }) {
    const hayExt = serie.some((p) => p.total != null);
    const datosExt = serie.map((p) => ({ label: etiquetaDia(p.fecha), extraccion: p.total }));
    return (
        <section className="sc-card" aria-labelledby="sc-tend-t">
            <span className="sc-kicker">Tendencias{esHoy ? ' · en vivo' : ''}</span>
            <h3 id="sc-tend-t">Almacenamiento y extracción</h3>

            <figure className="sc-grafica">
                <figcaption><span>Almacenamiento actual contra capacidad NAMO · Mm³</span></figcaption>
                <div role="img" aria-label={`Almacenamiento por presa: ${presas.map(p => `${p.nombre} ${p.actual != null ? p.actual.toFixed(0) + ' de ' + p.capacidad.toFixed(0) + ' millones de metros cúbicos' : 'sin dato'}`).join('; ')}`}>
                    <ResponsiveContainer width="100%" height={230} initialDimension={{ width: 1, height: 1 }}>
                        <BarChart data={presas} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={4}>
                            <CartesianGrid vertical={false} stroke="rgba(148,163,184,.12)" />
                            <XAxis dataKey="nombre" tick={TICK} axisLine={false} tickLine={false} />
                            <YAxis tick={TICK} axisLine={false} tickLine={false} width={44} />
                            <Tooltip content={<Tip unidad="Mm³" />} cursor={{ fill: 'rgba(148,163,184,.06)' }} />
                            <Bar dataKey="capacidad" name="Capacidad NAMO" fill="none" stroke="#8396ad" strokeDasharray="4 3" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                            <Bar dataKey="actual" name="Almacenado" fill={C_ALM} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <figcaption><span>Barra azul: almacenado · contorno punteado: capacidad. Presa sin lectura: sin barra (S/D).</span></figcaption>
            </figure>

            <figure className="sc-grafica">
                <figcaption><span>Extracción combinada de presas · m³/s · últimos 7 días</span></figcaption>
                {hayExt ? (
                    <div role="img" aria-label="Extracción diaria de las presas en los últimos siete días; los días sin medición quedan en blanco">
                        <ResponsiveContainer width="100%" height={190} initialDimension={{ width: 1, height: 1 }}>
                            <AreaChart data={datosExt} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                <CartesianGrid vertical={false} stroke="rgba(148,163,184,.12)" />
                                <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
                                <YAxis tick={TICK} axisLine={false} tickLine={false} width={40} />
                                <Tooltip content={<Tip unidad="m³/s" />} />
                                <Area type="monotone" dataKey="extraccion" name="Extracción" stroke={C_EXT} fill={C_EXT} fillOpacity={0.16} strokeWidth={2}
                                    dot={{ r: 3, fill: C_EXT, stroke: '#020a14', strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <p className="sc-vacio">Sin extracción medida del {etiquetaDia(serie[0].fecha)} al {etiquetaDia(serie[serie.length - 1].fecha)}.</p>
                )}
            </figure>
        </section>
    );
});
