import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
    diaDelAnio, diasDelMes, etiquetaMetrica, formatearNumero, serieAnio, serieMes, MESES_CORTO, MESES_LARGO,
    type MapaPresa, type Metrica, type TipoSerie,
} from '../../utils/historicoPresas';

/**
 * Serie comparada de una presa: un trazo por año sobre UN solo eje (sin doble escala).
 * Identidad por color Y por trazo (sólido / discontinuo / punteado), para que no dependa solo del tono.
 * Colores = paleta categórica validada para superficie oscura (slots 1-3: azul, naranja, aqua).
 */

export const ESTILOS_SERIE = [
    { color: '#3987e5', dash: undefined as string | undefined, ancho: 2.8, muestra: 'sólido' },
    { color: '#d95926', dash: '8 5', ancho: 2.2, muestra: 'discontinuo' },
    { color: '#199e70', dash: '2 5', ancho: 2.4, muestra: 'punteado' },
] as const;

type Fila = { x: number } & Record<string, number | null>;

interface Props {
    mapa: MapaPresa | undefined;
    /** Años seleccionados, del más reciente (base) al más antiguo. */
    anios: number[];
    mes: number;
    vista: 'mes' | 'anio';
    metrica: Metrica;
    serie: TipoSerie;
    nombrePresa: string;
}

const COLOR_TEXTO = '#9fb2c8';

export default function SerieComparada({ mapa, anios, mes, vista, metrica, serie, nombrePresa }: Props) {
    const { unidad, decimales, nombre } = etiquetaMetrica(metrica);

    const { filas, claves, conDatos } = useMemo(() => {
        const claves = anios.map(a => `y${a}`);
        const series = anios.map(a => (vista === 'mes' ? serieMes(mapa, a, mes, metrica, serie) : serieAnio(mapa, a, metrica, serie)));
        const n = vista === 'mes' ? 31 : 366;
        const filas: Fila[] = Array.from({ length: n }, (_, i) => {
            const f: Fila = { x: vista === 'mes' ? i + 1 : i };
            claves.forEach((k, j) => { f[k] = series[j][i] ?? null; });
            return f;
        });
        const conDatos = series.map(s => s.filter(v => v != null).length);
        return { filas, claves, conDatos };
    }, [mapa, anios, mes, vista, metrica, serie]);

    const dominio = useMemo<[number, number] | undefined>(() => {
        const vals: number[] = [];
        for (const f of filas) for (const k of claves) { const v = f[k]; if (v != null) vals.push(v); }
        if (!vals.length) return undefined;
        let lo = Math.min(...vals);
        let hi = Math.max(...vals);
        if (hi === lo) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.08;
        lo = metrica === 'llenado' ? Math.max(0, lo - pad) : lo - pad;
        return [lo, hi + pad];
    }, [filas, claves, metrica]);

    const ticksX = useMemo(
        () => (vista === 'mes' ? [1, 5, 10, 15, 20, 25, 30].filter(d => d <= 31) : Array.from({ length: 12 }, (_, i) => diaDelAnio(i + 1, 1))),
        [vista],
    );

    const etiquetaX = (x: number) => {
        if (vista === 'mes') return String(x);
        const i = ticksX.indexOf(x);
        return i >= 0 ? MESES_CORTO[i] : '';
    };

    const fechaDeX = (x: number) => {
        if (vista === 'mes') return `Día ${x} de ${MESES_LARGO[mes - 1].toLowerCase()}`;
        const d = new Date(Date.UTC(2000, 0, 1 + x));
        return `${d.getUTCDate()} de ${MESES_LARGO[d.getUTCMonth()].toLowerCase()}`;
    };

    const hayAlgo = conDatos.some(n => n > 0);

    return (
        <div className="ah-serie">
            <ul className="ah-leyenda" aria-label="Series">
                {anios.map((a, i) => {
                    const est = ESTILOS_SERIE[i];
                    return (
                        <li key={a} className={conDatos[i] === 0 ? 'is-vacia' : ''}>
                            <svg width="34" height="10" aria-hidden="true">
                                <line x1="1" y1="5" x2="33" y2="5" stroke={est.color} strokeWidth={est.ancho} strokeDasharray={est.dash} strokeLinecap="round" />
                            </svg>
                            <strong>{a}</strong>
                            <span>{i === 0 ? 'base' : est.muestra}{conDatos[i] === 0 ? ' · sin datos' : ''}</span>
                        </li>
                    );
                })}
            </ul>

            <div className="ah-chart" role="img" aria-label={`${nombre} de ${nombrePresa}, ${vista === 'mes' ? MESES_LARGO[mes - 1] : 'año completo'}, años ${anios.join(', ')}`}>
                {hayAlgo ? (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 300 }}>
                        <LineChart data={filas} margin={{ top: 8, right: 14, bottom: 4, left: 0 }}>
                            <CartesianGrid stroke="#16233a" vertical={false} />
                            {vista === 'anio' && (
                                <ReferenceArea x1={diaDelAnio(mes, 1)} x2={diaDelAnio(mes, diasDelMes(2000, mes))} fill="#38bdf8" fillOpacity={0.08} stroke="none" ifOverflow="hidden" />
                            )}
                            <XAxis
                                dataKey="x" type="number" domain={vista === 'mes' ? [1, 31] : [0, 365]} ticks={ticksX}
                                tickFormatter={etiquetaX} tick={{ fill: COLOR_TEXTO, fontSize: 12 }} axisLine={{ stroke: '#2a3d57' }} tickLine={false}
                            />
                            <YAxis
                                domain={dominio ?? ['auto', 'auto']} width={metrica === 'elevacion' ? 62 : 54}
                                tickFormatter={(v: number) => formatearNumero(v, metrica === 'elevacion' ? 1 : 0)}
                                tick={{ fill: COLOR_TEXTO, fontSize: 12 }} axisLine={false} tickLine={false}
                            />
                            <Tooltip
                                cursor={{ stroke: '#7dd3fc', strokeWidth: 1, strokeDasharray: '3 3' }}
                                content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null;
                                    return (
                                        <div className="ah-tip">
                                            <div className="ah-tip-t">{fechaDeX(Number(label))}</div>
                                            {anios.map((a, i) => {
                                                const v = payload.find(p => p.dataKey === `y${a}`)?.value as number | null | undefined;
                                                const est = ESTILOS_SERIE[i];
                                                return (
                                                    <div key={a} className="ah-tip-r">
                                                        <svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke={est.color} strokeWidth={est.ancho} strokeDasharray={est.dash} strokeLinecap="round" /></svg>
                                                        <span>{a}</span>
                                                        <b>{v == null ? 'S/D' : `${formatearNumero(v, decimales)} ${unidad}`}</b>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                }}
                            />
                            {claves.map((k, i) => {
                                const est = ESTILOS_SERIE[i];
                                return (
                                    <Line
                                        key={k} dataKey={k} stroke={est.color} strokeWidth={est.ancho} strokeDasharray={est.dash}
                                        strokeLinecap="round" connectNulls={false} isAnimationActive={false}
                                        // Punto aislado (sin vecinos) → marcador visible; si no, un día suelto no dibujaría nada.
                                        dot={(p: { cx?: number; cy?: number; index?: number; value?: number | null }) => {
                                            const i0 = p.index ?? 0;
                                            const aislado = p.value != null && filas[i0 - 1]?.[k] == null && filas[i0 + 1]?.[k] == null;
                                            return aislado && p.cx != null && p.cy != null
                                                ? <circle key={`${k}-${i0}`} cx={p.cx} cy={p.cy} r={4.5} fill={est.color} stroke="#020a14" strokeWidth={2} />
                                                : <g key={`${k}-${i0}`} />;
                                        }}
                                        activeDot={{ r: 5, stroke: '#020a14', strokeWidth: 2, fill: est.color }}
                                    />
                                );
                            })}
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="ah-chart-vacio">
                        <strong>S/D</strong>
                        <span>Sin registros de {nombre.toLowerCase()} para {vista === 'mes' ? MESES_LARGO[mes - 1].toLowerCase() : 'el año'} en los años elegidos.</span>
                    </div>
                )}
            </div>
        </div>
    );
}
