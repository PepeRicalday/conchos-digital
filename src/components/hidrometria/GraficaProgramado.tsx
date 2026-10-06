import { memo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { FilaSemana } from '../../utils/hidrometria';

// Paleta categórica validada sobre #020a14: azul = programado, aqua = entregado.
const C_PROG = '#3987e5';
const C_ENT = '#199e70';
const TICK = { fill: '#8396ad', fontSize: 11 };

const Tip = ({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | null }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="sc-tip">
            <div>Módulo {label}</div>
            {payload.map((p, i) => <div key={i}>{p.name}: <b>{p.value == null ? 'S/D' : `${Number(p.value).toFixed(3)} Mm³`}</b></div>)}
        </div>
    );
};

/** Volumen programado contra entregado por módulo, en la MISMA magnitud (Mm³ de la semana). Sin dato = sin barra. */
export const GraficaProgramado = memo(function GraficaProgramado({ filas, rango }: { filas: FilaSemana[]; rango: string }) {
    const datos = filas.map((f) => ({ nombre: f.nombre, programado: f.programadoMm3, entregado: f.entregadoMm3 }));
    const hayProg = datos.some((d) => d.programado != null);
    const hayEnt = datos.some((d) => d.entregado != null);
    return (
        <section className="sc-card" aria-labelledby="hid-graf-t">
            <span className="sc-kicker">{rango}</span>
            <h3 id="hid-graf-t">Volumen por módulo</h3>
            {!hayProg && <p className="sc-aviso sc-aviso-warn" role="status">Sin solicitudes capturadas para esta semana: solo se muestra lo entregado.</p>}
            {!hayProg && !hayEnt ? (
                <p className="sc-vacio">Sin solicitud ni entrega registrada en la semana.</p>
            ) : (
                <div role="img" aria-label={`Volumen programado y entregado por módulo. ${datos.map((d) => `${d.nombre}: programado ${d.programado ?? 'sin dato'}, entregado ${d.entregado ?? 'sin dato'} millones de metros cúbicos`).join('; ')}`}>
                    <ResponsiveContainer width="100%" height={300} initialDimension={{ width: 1, height: 1 }}>
                        <BarChart data={datos} margin={{ top: 12, right: 12, left: 0, bottom: 4 }} barGap={4}>
                            <CartesianGrid vertical={false} stroke="rgba(148,163,184,.12)" />
                            <XAxis dataKey="nombre" tick={TICK} axisLine={false} tickLine={false} />
                            <YAxis tick={TICK} axisLine={false} tickLine={false} width={48} label={{ value: 'Mm³', angle: -90, position: 'insideLeft', fill: '#8396ad', fontSize: 11 }} />
                            <Tooltip content={<Tip />} cursor={{ fill: 'rgba(148,163,184,.06)' }} />
                            <Legend wrapperStyle={{ fontSize: 12, color: '#b4c2d4' }} />
                            <Bar dataKey="programado" name="Programado" fill={C_PROG} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                            <Bar dataKey="entregado" name="Entregado" fill={C_ENT} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
            <p className="sc-fresco">Mismo volumen en ambas barras (Mm³ de la semana). Módulo sin barra = sin solicitud o sin captura (S/D), no cero.</p>
        </section>
    );
});
