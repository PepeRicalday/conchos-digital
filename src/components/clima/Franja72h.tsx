import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSerieObservada, type UmbralClima } from '../../hooks/useClimaOperativo';
import type { EstacionConLectura } from '../../hooks/useClimaEstaciones';

// Paleta categórica validada con validate_palette.js sobre la superficie #020a14 (modo oscuro).
const C_TEMP = '#d95926';
const C_VIENTO = '#199e70';
const C_LLUVIA = '#3987e5';
const TZ = 'America/Chihuahua';
const HORA = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', hour12: false, timeZone: TZ });
const DIA_HORA = new Intl.DateTimeFormat('es-MX', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const horaLocal = (ms: number) => Number(HORA.format(ms)) % 24;
const esNoche = (ms: number) => { const h = horaLocal(ms); return h >= 20 || h < 7; };

interface Punto { ts: number; temp?: number | null; tempFc?: number | null; viento?: number | null; vientoFc?: number | null; lluviaFc?: number | null }

interface Props { estaciones: EstacionConLectura[]; umbrales: UmbralClima[] }

export function Franja72h({ estaciones, umbrales }: Props) {
    const conPronostico = useMemo(() => estaciones.filter((e) => e.pronosticoSerie.length > 0 || e.lectura), [estaciones]);
    const [sel, setSel] = useState<string | null>(null);
    const est = conPronostico.find((e) => e.id === sel) ?? conPronostico[0] ?? null;
    const obs = useSerieObservada(est?.id ?? null);
    // Reloj de la línea "ahora": se actualiza cada 5 min (no en cada render, para que el render sea puro).
    const [t0, setT0] = useState(() => Date.now());
    useEffect(() => { const id = window.setInterval(() => setT0(Date.now()), 5 * 60_000); return () => window.clearInterval(id); }, []);

    const { datos, ahora, bandas, dominio } = useMemo(() => {
        const desde = t0 - 24 * 3.6e6;
        const hasta = t0 + 48 * 3.6e6;
        const mapa = new Map<number, Punto>();
        const nodo = (ts: number) => { const k = Math.round(ts / 6e4) * 6e4; const p = mapa.get(k) ?? { ts: k }; mapa.set(k, p); return p; };
        for (const o of obs) { const p = nodo(o.ts); p.temp = o.temp; p.viento = o.viento; }
        for (const f of est?.pronosticoSerie ?? []) {
            const ts = new Date(f.valido_en).getTime();
            if (ts < desde || ts > hasta) continue;
            const p = nodo(ts); p.tempFc = f.temp_c; p.vientoFc = f.viento_ms; p.lluviaFc = f.precip_mm;
        }
        const lista = [...mapa.values()].sort((a, b) => a.ts - b.ts);
        // Bandas nocturnas: tramos contiguos de horas entre 20:00 y 07:00 locales.
        const bandas: { x1: number; x2: number }[] = [];
        let ini: number | null = null;
        for (let t = Math.floor(desde / 3.6e6) * 3.6e6; t <= hasta; t += 3.6e6) {
            if (esNoche(t) && ini == null) ini = t;
            if (!esNoche(t) && ini != null) { bandas.push({ x1: Math.max(ini, desde), x2: t }); ini = null; }
        }
        if (ini != null) bandas.push({ x1: ini, x2: hasta });
        return { datos: lista, ahora: t0, bandas, dominio: [desde, hasta] as [number, number] };
    }, [obs, est, t0]);

    const u = (clave: string) => umbrales.find((x) => x.clave === clave);
    const helada = u('helada'); const calor = u('calor'); const viento = u('viento');
    const hayDatos = datos.some((d) => d.temp != null || d.tempFc != null);

    const ejeX = (
        <XAxis dataKey="ts" type="number" scale="time" domain={dominio} allowDataOverflow
            ticks={Array.from({ length: 13 }, (_, i) => dominio[0] + i * 6 * 3.6e6)}
            tickFormatter={(v) => `${String(horaLocal(v)).padStart(2, '0')}h`}
            tick={{ fill: '#8396ad', fontSize: 11 }} axisLine={{ stroke: 'rgba(148,163,184,.2)' }} tickLine={false} />
    );
    const fondo = (
        <>
            {bandas.map((b, i) => <ReferenceArea key={i} x1={b.x1} x2={b.x2} fill="#0b1b33" fillOpacity={0.85} ifOverflow="hidden" />)}
            <CartesianGrid vertical={false} stroke="rgba(148,163,184,.10)" />
            <ReferenceLine x={ahora} stroke="#e8eef6" strokeDasharray="2 3" label={{ value: 'ahora', fill: '#e8eef6', fontSize: 11, position: 'insideTopRight' }} />
        </>
    );
    const margen = { top: 8, right: 14, left: 0, bottom: 0 };
    const tip = (unidad: string) => (
        <Tooltip contentStyle={{ background: '#0f1c30', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, fontSize: 12 }}
            labelFormatter={(v) => DIA_HORA.format(Number(v))}
            formatter={(v, n) => [`${Number(v).toFixed(1)} ${unidad}`, n]} />
    );

    return (
        <section className="cl-seccion" aria-labelledby="cl-72-t">
            <header className="cl-seccion-cab">
                <div>
                    <span className="cl-kicker">24 h observadas + 48 h de pronóstico</span>
                    <h3 id="cl-72-t">Franja de 72 horas</h3>
                </div>
                {conPronostico.length > 1 && (
                    <label className="cl-sel">
                        <span className="cl-sr">Estación</span>
                        <select value={est?.id ?? ''} onChange={(e) => setSel(e.target.value)}>
                            {conPronostico.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                        </select>
                    </label>
                )}
            </header>

            {!hayDatos ? (
                <p className="cl-vacio">Sin lecturas ni pronóstico para esta estación en la ventana de 72 h.</p>
            ) : (
                <div className="cl-franja">
                    <figure>
                        <figcaption>Temperatura (°C) <i className="cl-leyenda"><s style={{ background: C_TEMP }} /> observada <s className="cl-disc" style={{ borderColor: C_TEMP }} /> pronóstico</i></figcaption>
                        <ResponsiveContainer width="100%" height={150} initialDimension={{ width: 1, height: 1 }}>
                            <LineChart data={datos} margin={margen}>
                                {fondo}{ejeX}
                                <YAxis width={38} tick={{ fill: '#8396ad', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                                {helada && <ReferenceLine y={helada.aviso} stroke="#38bdf8" strokeDasharray="4 3" label={{ value: `helada ${helada.aviso}°`, fill: '#7dd3fc', fontSize: 11, position: 'insideBottomLeft' }} />}
                                {calor && <ReferenceLine y={calor.aviso} stroke="#fbbf24" strokeDasharray="4 3" label={{ value: `calor ${calor.aviso}°`, fill: '#fcd34d', fontSize: 11, position: 'insideTopLeft' }} />}
                                {tip('°C')}
                                <Line type="monotone" dataKey="temp" name="Observada" stroke={C_TEMP} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                                <Line type="monotone" dataKey="tempFc" name="Pronóstico" stroke={C_TEMP} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </figure>
                    <figure>
                        <figcaption>Lluvia prevista (mm/h)</figcaption>
                        <ResponsiveContainer width="100%" height={110} initialDimension={{ width: 1, height: 1 }}>
                            <BarChart data={datos.filter((d) => d.lluviaFc != null)} margin={margen}>
                                {fondo}{ejeX}
                                <YAxis width={38} tick={{ fill: '#8396ad', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals domain={[0, (m: number) => Math.max(1, Math.ceil(m))]} />
                                {tip('mm')}
                                <Bar dataKey="lluviaFc" name="Lluvia prevista" fill={C_LLUVIA} radius={[3, 3, 0, 0]} maxBarSize={9} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </figure>
                    <figure>
                        <figcaption>Viento (m/s) <i className="cl-leyenda"><s style={{ background: C_VIENTO }} /> observado <s className="cl-disc" style={{ borderColor: C_VIENTO }} /> pronóstico</i></figcaption>
                        <ResponsiveContainer width="100%" height={130} initialDimension={{ width: 1, height: 1 }}>
                            <AreaChart data={datos} margin={margen}>
                                {fondo}{ejeX}
                                <YAxis width={38} tick={{ fill: '#8396ad', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, (m: number) => Math.max(8, Math.ceil(m))]} />
                                {viento && <ReferenceLine y={viento.aviso} stroke="#fbbf24" strokeDasharray="4 3" label={{ value: `aviso ${viento.aviso} m/s`, fill: '#fcd34d', fontSize: 11, position: 'insideTopLeft' }} />}
                                {tip('m/s')}
                                <Area type="monotone" dataKey="viento" name="Observado" stroke={C_VIENTO} fill={C_VIENTO} fillOpacity={0.18} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                                <Area type="monotone" dataKey="vientoFc" name="Pronóstico" stroke={C_VIENTO} fill="none" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </figure>
                </div>
            )}
            <p className="cl-pie">Fondo oscuro = noche (20:00–07:00). Línea continua = medido por la estación; punteada = modelo Open-Meteo. Las líneas de referencia son los umbrales de aviso.</p>
        </section>
    );
}
