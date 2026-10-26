import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
    VENTANAS, agregarSerie, ceroSospechoso, colorEstacion, fechaHoraLocal, fmt, fusionarSeries, puentearHuecos, rotuloEje,
    type EstacionHidro, type FilaGrafica, type VentanaHidro,
} from '../../../utils/hidroEstaciones';
import type { SeriesPorEstacion } from '../../../hooks/useHidroEstaciones';

interface Props {
    estaciones: EstacionHidro[];
    seleccion: string[];
    series: SeriesPorEstacion;
    ventana: VentanaHidro;
    ahora: number;
}

const MARGEN = { top: 8, right: 14, left: 0, bottom: 0 };
const EJE_Y = 54;
/** Cadencia real de los DCP: 3-4 lecturas por hora, así que ≤ 45 min entre lecturas vecinas es normal. */
const MAX_PUENTE_MIN = 45;

/** Marcas del eje X a horas/días redondos de Chihuahua (UTC-6 fijo, sin horario de verano). */
function marcasEje(desde: number, hasta: number, ventana: VentanaHidro): number[] {
    const paso = ventana === '24h' ? 4 * 3600000 : ventana === '7d' ? 24 * 3600000 : 5 * 24 * 3600000;
    const OFFSET = 6 * 3600000;
    const ini = Math.ceil((desde - OFFSET) / paso) * paso + OFFSET;
    const out: number[] = [];
    for (let t = ini; t <= hasta; t += paso) out.push(t);
    return out;
}

interface PropsLectura {
    label: number | null;
    estaciones: EstacionHidro[];
    seleccion: string[];
    mapaG: Map<number, FilaGrafica>;
    mapaN: Map<number, FilaGrafica>;
}

/** Barra de lectura fija sobre las gráficas: no tapa las líneas y responde igual desde el panel de gasto o el de nivel. */
function Lectura({ label, estaciones, seleccion, mapaG, mapaN }: PropsLectura) {
    if (label == null) return <div className="goes-lectura goes-lectura--ayuda" aria-live="polite">Pase el cursor (o toque) una gráfica para ver las lecturas de esa hora.</div>;
    // Las estaciones leen cada 15 o 20 min y la rejilla es de 5: se toma la lectura más cercana (±10 min) en vez de mostrar S/D en filas intermedias.
    const cerca = (m: Map<number, FilaGrafica>, id: string): number | null => {
        for (const d of [0, -300000, 300000, -600000, 600000]) {
            const v = m.get(label + d)?.[id];
            if (v != null) return v as number;
        }
        return null;
    };
    return (
        <div className="goes-lectura" aria-live="polite">
            <b className="goes-lectura-hora">{fechaHoraLocal(label)}</b>
            {seleccion.map(id => {
                const e = estaciones.find(x => x.id === id);
                const g = cerca(mapaG, id);
                const n = cerca(mapaN, id);
                return (
                    <span key={id} className="goes-tip-fila">
                        <i style={{ background: colorEstacion(id) }} aria-hidden="true" />
                        {e?.nombre ?? id}: <b>{g == null ? 'S/D' : `${fmt(g, 1)} m³/s`}</b> · nivel <b>{n == null ? 'S/D' : `${fmt(n, 2)} m`}</b>
                        {ceroSospechoso(id, g, n) && <em> ◇ 0 reportado</em>}
                    </span>
                );
            })}
        </div>
    );
}

function Panel({ titulo, unidad, dec, trazo, ids, desde, hasta, ventana, ultimoPanel, onHover, dominio }: {
    titulo: string; unidad: string; dec: number; trazo: FilaGrafica[]; ids: string[]; desde: number; hasta: number; ventana: VentanaHidro;
    ultimoPanel: boolean; onHover: (t: number | null) => void; dominio?: [number | 'auto', number | 'auto'];
}) {
    const marcas = useMemo(() => marcasEje(desde, hasta, ventana), [desde, hasta, ventana]);
    return (
        <div className="goes-panel">
            <h5 className="goes-panel-t">{titulo} <small>{unidad}</small></h5>
            <div className={`goes-chart${ultimoPanel ? ' goes-chart--eje' : ''}`}>
                <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height="100%">
                    <LineChart data={trazo} syncId="goes" margin={{ ...MARGEN, bottom: ultimoPanel ? 4 : 0 }}
                        onMouseMove={(st: { activeLabel?: string | number }) => onHover(typeof st?.activeLabel === 'number' ? st.activeLabel : null)}
                        onMouseLeave={() => onHover(null)}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--pr-line, rgba(148,163,184,.16))" />
                        <XAxis dataKey="t" type="number" domain={[desde, hasta]} ticks={marcas} interval={0} allowDataOverflow
                            tickFormatter={t => rotuloEje(t as number, ventana)} axisLine={false} tickLine={false}
                            height={ultimoPanel ? 26 : 1} tick={ultimoPanel ? { fontSize: 12, fill: 'var(--pr-t3, #8396ad)' } : false} />
                        <YAxis axisLine={false} tickLine={false} width={EJE_Y} tick={{ fontSize: 12, fill: 'var(--pr-t3, #8396ad)' }}
                            domain={dominio ?? ['auto', 'auto']} tickFormatter={v => fmt(v as number, dec)} />
                        <Tooltip isAnimationActive={false} cursor={{ stroke: 'var(--pr-t2, #b4c2d4)', strokeDasharray: '3 3' }} content={() => null} />
                        {ids.map(id => (
                            <Line key={id} dataKey={id} stroke={colorEstacion(id)} strokeWidth={2} dot={false} connectNulls={false}
                                activeDot={{ r: 4, stroke: 'var(--pr-bg, #020a14)', strokeWidth: 2 }} isAnimationActive={false} />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

export default function GraficaGoes({ estaciones, seleccion, series, ventana, ahora }: Props) {
    const [hover, setHover] = useState<number | null>(null);
    const { horas, pasoMin } = VENTANAS[ventana];
    const hasta = ahora || 0;
    const desde = hasta - horas * 3600000;

    const { trazoG, trazoN, mapaG, mapaN, resumen, hayDatos } = useMemo(() => {
        const porVar = (v: 'gasto_m3s' | 'nivel_m') => Object.fromEntries(seleccion.map(id => [id, agregarSerie(series[id]?.[v] ?? [], pasoMin)]));
        const sg = porVar('gasto_m3s');
        const sn = porVar('nivel_m');
        const g = fusionarSeries(sg, pasoMin, desde, hasta);
        const n = fusionarSeries(sn, pasoMin, desde, hasta);
        const rango = (pts: { v: number }[]) => (pts.length ? { min: Math.min(...pts.map(p => p.v)), max: Math.max(...pts.map(p => p.v)) } : null);
        return {
            trazoG: puentearHuecos(g, seleccion, MAX_PUENTE_MIN), trazoN: puentearHuecos(n, seleccion, MAX_PUENTE_MIN),
            mapaG: new Map(g.map(f => [f.t, f])), mapaN: new Map(n.map(f => [f.t, f])),
            hayDatos: seleccion.some(id => sg[id].length > 0 || sn[id].length > 0),
            resumen: seleccion.map(id => ({ id, g: rango(sg[id]), n: rango(sn[id]) })),
        };
    }, [seleccion, series, pasoMin, desde, hasta]);

    if (!ahora) return <div className="goes-skeleton goes-skeleton--alta" aria-busy="true" />;
    if (!hayDatos) {
        return <div className="goes-vacio" role="status"><strong>Sin lecturas en esta ventana (S/D)</strong><span>Las estaciones elegidas no tienen nivel ni gasto en los últimos {VENTANAS[ventana].etiqueta}.</span></div>;
    }

    return (
        <>
            <Lectura label={hover} estaciones={estaciones} seleccion={seleccion} mapaG={mapaG} mapaN={mapaN} />
            <div className="goes-paneles" role="img" aria-label={`Gasto y nivel de las estaciones elegidas, ventana de ${VENTANAS[ventana].etiqueta}`}>
                <Panel titulo="Gasto" unidad="m³/s" dec={1} trazo={trazoG} ids={seleccion} desde={desde} hasta={hasta} ventana={ventana} ultimoPanel={false} onHover={setHover} />
                <Panel titulo="Nivel" unidad="m" dec={2} trazo={trazoN} ids={seleccion} desde={desde} hasta={hasta} ventana={ventana} ultimoPanel onHover={setHover} />
            </div>
            <div className="goes-tabla-wrap">
                <table className="goes-tabla goes-tabla--resumen">
                    <caption>Rango en la ventana de {VENTANAS[ventana].etiqueta} ({pasoMin <= 5 ? `lecturas originales de 15 a 20 min` : `promedios de ${pasoMin} min`})</caption>
                    <thead><tr><th scope="col">Estación</th><th scope="col">Gasto mín – máx (m³/s)</th><th scope="col">Nivel mín – máx (m)</th></tr></thead>
                    <tbody>
                        {resumen.map(r => (
                            <tr key={r.id}>
                                <th scope="row"><i className="goes-sw" style={{ background: colorEstacion(r.id) }} aria-hidden="true" />{estaciones.find(e => e.id === r.id)?.nombre ?? r.id}</th>
                                <td data-label="Gasto (m³/s)">{r.g ? `${fmt(r.g.min, 1)} – ${fmt(r.g.max, 1)}` : 'S/D'}</td>
                                <td data-label="Nivel (m)">{r.n ? `${fmt(r.n.min, 2)} – ${fmt(r.n.max, 2)}` : 'S/D'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}
