import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { supabase } from '../../lib/supabase';
import { COLOR_MODULO_SRL } from '../../utils/modulosSRL';
import { fmt } from '../../utils/formato';
import { NDVI_RANGO, cargarSerieNdviV2 } from '../../utils/ndviSerie';
import { cargarSupVolAnual } from '../../utils/supVolAnual';
import { aFilasV2 } from '../../utils/informeNdviAnalisis';
import type { FilaNdviInforme } from '../../utils/informeNdviDatos';
import {
    COLOR_ANIO_FOCO, ETIQUETA_MES, MESES_TEMPORADA, UMBRAL_SIN_CAMBIO, anomaliaPico, aniosDisponibles, climatologiaMensual, colorAnioPrevio,
    lecturaAnio, resumenAnio, serieAnio, tendenciaPico, type FilaNdviV2, type FilaSupVol,
} from '../../utils/ndviInteranual';
import { cargarVolumenActual, type VolumenActual } from '../../utils/ndviVolumen';
import { SelectorChips } from './SelectorChips';
import { VolumenVegetacion } from './VolumenVegetacion';
import './NdviInteranual.css';

const MODULOS_SRL = [1, 2, 3, 4, 5, 12];
const NDVI_MAX = NDVI_RANGO[1];
const COLOR_TEXTO = '#cbd5e1';

const Sd: React.FC = () => <span className="ndvi-ia-sd">S/D</span>;
const celda = (txt: string) => (txt === 'S/D' ? <Sd /> : <>{txt}</>);
const signo = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), d)}`;

/** Mini gráfica de un módulo: banda histórica, promedio y el año foco grueso. Escala 0–0.8 común a los seis. */
const MiniPulso: React.FC<{ ndvi: FilaNdviV2[]; modulo: number; anioFoco: number; activo: boolean; onElegir: () => void }> = ({ ndvi, modulo, anioFoco, activo, onElegir }) => {
    const W = 150, H = 64, L = 4, R = 4, T = 6, B = 6;
    const x = (i: number) => L + (i * (W - L - R)) / (MESES_TEMPORADA.length - 1);
    const y = (v: number) => T + (1 - Math.min(NDVI_MAX, Math.max(0, v)) / NDVI_MAX) * (H - T - B);
    const clim = climatologiaMensual(ndvi, modulo, anioFoco);
    const foco = serieAnio(ndvi, modulo, anioFoco);
    const camino = (vals: (number | null)[]) => {
        let d = '', pen = false;
        vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
        return d;
    };
    const conBanda = clim.every(c => c.p10 != null && c.p90 != null);
    const banda = conBanda
        ? `M${clim.map((c, i) => `${x(i).toFixed(1)} ${y(c.p90 as number).toFixed(1)}`).join(' L')} L${[...clim].reverse().map((c, k) => `${x(clim.length - 1 - k).toFixed(1)} ${y(c.p10 as number).toFixed(1)}`).join(' L')} Z`
        : '';
    const an = anomaliaPico(ndvi, modulo, anioFoco);
    const pico = resumenAnio(ndvi, modulo, anioFoco).pico;
    return (
        <button type="button" className={`ndvi-ia-mini${activo ? ' on' : ''}`} aria-pressed={activo} onClick={onElegir}
            aria-label={`Módulo ${modulo}: ${anioFoco} ${pico != null ? `pico ${pico.toFixed(3)}` : 'sin NDVI (S/D)'}${an ? `, ${signo(an.abs, 3)} contra el promedio previo` : ''}`}
            style={{ ['--c' as string]: COLOR_MODULO_SRL[modulo] }}>
            <span className="ndvi-ia-mini-cab"><b>M{modulo}</b>
                <span className={`ndvi-ia-mini-an ${an ? (Math.abs(an.abs) < UMBRAL_SIN_CAMBIO ? 'igual' : an.abs > 0 ? 'sube' : 'baja') : ''}`}>
                    {an ? `${Math.abs(an.abs) < UMBRAL_SIN_CAMBIO ? '■' : an.abs > 0 ? '▲' : '▼'} ${signo(an.abs, 2)}` : 'S/D'}
                </span></span>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true" preserveAspectRatio="none">
                {banda && <path d={banda} className="ndvi-ia-banda" />}
                <path d={camino(clim.map(c => c.media))} className="ndvi-ia-media" />
                <path d={camino(foco)} className="ndvi-ia-foco" />
                {foco.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="2.2" className="ndvi-ia-pt" />))}
            </svg>
        </button>
    );
};

/** `filas`: la serie v2 que el panel ya cargó; con ella el componente solo consulta superficie/volumen (compartido con el informe). Sin ella, carga la serie por su cuenta. */
export const NdviInteranual: React.FC<{ filas?: FilaNdviInforme[] }> = ({ filas }) => {
    const compartida = !!filas;
    const [ndviPropio, setNdvi] = useState<FilaNdviV2[]>([]);
    const [supVol, setSupVol] = useState<FilaSupVol[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [modulo, setModulo] = useState<number>(1);
    const [anioElegido, setAnioElegido] = useState<number | null>(null);
    const [reducir, setReducir] = useState(false);
    const [volActual, setVolActual] = useState<VolumenActual | null>(null);

    useEffect(() => {
        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        setReducir(!!mq?.matches);
    }, []);

    useEffect(() => {
        let cancelado = false;
        (async () => {
            const [a, b] = await Promise.all([
                compartida ? Promise.resolve(null) : cargarSerieNdviV2(supabase),
                cargarSupVolAnual(supabase),
            ]);
            if (cancelado) return;
            setError(a?.error ?? b.error);
            if (a) setNdvi(a.error ? [] : a.filas);
            setSupVol(b.filas);
            setCargando(false);
        })();
        return () => { cancelado = true; };
    }, [compartida]);
    // Volumen del año actual (hoja SRL provisional): una consulta por sesión, aparte de ACUM_INF; si falla, el panel lo dice.
    useEffect(() => {
        let cancelado = false;
        cargarVolumenActual().then(v => { if (!cancelado) setVolActual(v); });
        return () => { cancelado = true; };
    }, []);
    const ndvi = useMemo(() => (filas ? aFilasV2(filas) : ndviPropio), [filas, ndviPropio]);

    const anios = useMemo(() => aniosDisponibles(ndvi, modulo), [ndvi, modulo]);
    const anioFoco = anioElegido != null && anios.includes(anioElegido) ? anioElegido : anios[anios.length - 1];
    const previos = useMemo(() => anios.filter(a => a !== anioFoco), [anios, anioFoco]);
    const colorDe = (a: number) => (a === anioFoco ? COLOR_ANIO_FOCO : colorAnioPrevio(previos.indexOf(a), previos.length));

    const lectura = useMemo(() => (anioFoco != null ? lecturaAnio(ndvi, modulo, anioFoco) : null), [ndvi, modulo, anioFoco]);

    const opcion = useMemo(() => {
        const clim = climatologiaMensual(ndvi, modulo, anioFoco);
        const etiquetas = MESES_TEMPORADA.map(m => ETIQUETA_MES[m]);
        const conBanda = clim.every(c => c.p10 != null && c.p90 != null);
        const series: Record<string, unknown>[] = [];
        if (conBanda) {
            series.push({ name: 'base', type: 'line', stack: 'banda', symbol: 'none', silent: true, lineStyle: { opacity: 0 }, tooltip: { show: false }, data: clim.map(c => c.p10) });
            series.push({ name: 'Banda típica', type: 'line', stack: 'banda', symbol: 'none', silent: true, lineStyle: { opacity: 0 },
                areaStyle: { color: 'rgba(148,163,184,0.20)' }, data: clim.map(c => (c.p90 as number) - (c.p10 as number)), tooltip: { show: false } });
        }
        previos.forEach(a => {
            const color = colorDe(a);
            series.push({ name: String(a), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 5, lineStyle: { width: 1.6, color }, itemStyle: { color }, z: 2,
                endLabel: { show: true, formatter: '{a}', color: COLOR_TEXTO, fontSize: 11 }, labelLayout: { moveOverlap: 'shiftY' }, data: serieAnio(ndvi, modulo, a) });
        });
        if (anioFoco != null) {
            series.push({ name: String(anioFoco), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 9, lineStyle: { width: 4, color: COLOR_ANIO_FOCO },
                itemStyle: { color: COLOR_ANIO_FOCO, borderColor: '#0f172a', borderWidth: 2 }, z: 5,
                endLabel: { show: true, formatter: '{a}', color: COLOR_ANIO_FOCO, fontSize: 12, fontWeight: 700 }, labelLayout: { moveOverlap: 'shiftY' }, data: serieAnio(ndvi, modulo, anioFoco) });
        }
        if (clim.some(c => c.media != null)) {
            series.push({ name: 'Promedio de los otros años', type: 'line', symbol: 'none', connectNulls: true, lineStyle: { width: 1.6, type: 'dashed', color: '#e2e8f0' }, itemStyle: { color: '#e2e8f0' }, z: 1,
                data: clim.map(c => (c.media != null ? Number(c.media.toFixed(4)) : null)) });
        }
        return {
            backgroundColor: 'transparent', animation: !reducir,
            grid: { left: 44, right: 44, top: 14, bottom: 30 },
            legend: { show: false },
            tooltip: { trigger: 'axis', backgroundColor: '#0f172a', borderColor: '#334155', textStyle: { color: '#f1f5f9' },
                formatter: (ps: { seriesName: string; value: number | null; color: string; axisValueLabel: string }[]) => {
                    const filas = ps.filter(p => p.seriesName !== 'base' && p.seriesName !== 'Banda típica')
                        .map(p => `<div><span style="color:${p.color}">●</span> ${p.seriesName}: <b>${typeof p.value === 'number' ? p.value.toFixed(3) : 'S/D'}</b></div>`).join('');
                    return `<b>${ps[0]?.axisValueLabel ?? ''}</b>${filas}`;
                } },
            xAxis: { type: 'category', data: etiquetas, boundaryGap: false, axisLabel: { color: COLOR_TEXTO, fontSize: 12 }, axisLine: { lineStyle: { color: '#334155' } } },
            yAxis: { type: 'value', min: NDVI_RANGO[0], max: NDVI_MAX, axisLabel: { color: COLOR_TEXTO, fontSize: 12 }, splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } } },
            series,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ndvi, modulo, anioFoco, previos, reducir]);

    const filasResumen = useMemo(() => anios.map(a => ({ r: resumenAnio(ndvi, modulo, a), an: anomaliaPico(ndvi, modulo, a) })), [ndvi, modulo, anios]);
    const tend = useMemo(() => tendenciaPico(ndvi, modulo), [ndvi, modulo]);

    const aniosCruce = useMemo(() => {
        const s = new Set<number>(anios);
        for (const f of supVol) if (f.numero_modulo === modulo) s.add(f.anio);
        return [...s].sort((a, b) => a - b);
    }, [anios, supVol, modulo]);

    if (cargando) return <div className="ndvi-chart-card glass ndvi-ia-msg" role="status">Cargando comparativo interanual…</div>;
    if (error) return <div className="ndvi-chart-card glass ndvi-ia-msg" role="alert">No se pudo leer el comparativo interanual ({error}). Esto no significa que no haya datos.</div>;
    if (!ndvi.length) return <div className="ndvi-chart-card glass ndvi-ia-msg">Aún no hay serie interanual cargada (ndvi_modulo_mensual_v2).</div>;

    return (
        <section className="ndvi-chart-card glass ndvi-ia" aria-label="Comparativo interanual de NDVI">
            <h3 className="ndvi-ia-titulo">Un año contra los demás · temporada marzo–septiembre</h3>
            <p className="ndvi-nota">
                Serie homogénea (Sentinel-2, máscara de nubes por píxel y mediana mensual) sobre la frontera completa del módulo:
                incluye caminos, canales y suelo sin riego, por eso sirve para comparar un año contra otro, no como NDVI de parcela.
            </p>

            {anios.length > 0 && (
                <SelectorChips etiqueta="Año a comparar" valor={String(anioFoco)} onChange={v => setAnioElegido(Number(v))}
                    opciones={anios.map(a => ({ valor: String(a), texto: String(a) }))} />
            )}
            {lectura && <p className={`ndvi-ia-lectura ${lectura.direccion ?? ''}`} aria-live="polite">{lectura.texto}</p>}

            <div className="ndvi-ia-minis" role="group" aria-label="Los seis módulos en el mismo año">
                {MODULOS_SRL.map(m => <MiniPulso key={m} ndvi={ndvi} modulo={m} anioFoco={anioFoco} activo={m === modulo} onElegir={() => setModulo(m)} />)}
            </div>
            <p className="ndvi-nota ndvi-ia-minis-nota">Cada recuadro: {anioFoco} (línea gruesa) sobre la banda típica de los otros años (zona gris, p10–p90; sin banda si hay menos de 3 años) y su promedio (punteada). ▲▼ = pico de {anioFoco} contra el promedio de pico de los demás años. Toca un módulo para ver su detalle.</p>

            <div className="ndvi-ia-grafica" style={{ borderTop: `3px solid ${COLOR_MODULO_SRL[modulo]}` }}>
                <ReactECharts option={opcion} style={{ height: 320, width: '100%' }} notMerge />
                <ul className="ndvi-ia-leyenda" aria-label="Años">
                    {[...previos, ...(anioFoco != null ? [anioFoco] : [])].map(a => (
                        <li key={a}><i style={{ background: colorDe(a), height: a === anioFoco ? 4 : 2 }} aria-hidden="true" />{a}</li>
                    ))}
                    <li><i className="dash" aria-hidden="true" />Promedio de otros años</li>
                    <li><i className="band" aria-hidden="true" />Banda típica</li>
                </ul>
            </div>

            <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label={`Resumen por año, Módulo ${modulo}`}>
                <table className="ndvi-ia-tabla">
                    <caption>Resumen por año — Módulo {modulo}</caption>
                    <thead><tr><th scope="col">Año</th><th scope="col">Pico NDVI</th><th scope="col">Mes pico</th><th scope="col">Media mar–sep</th><th scope="col">Meses con dato</th><th scope="col">Pico vs otros años</th></tr></thead>
                    <tbody>
                        {filasResumen.map(({ r, an }) => (
                            <tr key={r.anio} className={r.anio === anioFoco ? 'foco' : ''}>
                                <th scope="row">{r.anio}{r.pocoConfiables.length > 0 && <span className="ndvi-ia-aviso" title={`Pocas observaciones limpias en: ${r.pocoConfiables.join(', ')}`}> ⚠</span>}</th>
                                <td>{celda(fmt(r.pico, 3))}</td>
                                <td>{r.mesPico ?? <Sd />}</td>
                                <td>{celda(fmt(r.media, 3))}</td>
                                <td>{r.mesesConDato}/{MESES_TEMPORADA.length}</td>
                                <td>{an ? `${an.abs >= 0 ? '+' : '−'}${fmt(Math.abs(an.abs), 3)}${an.pct != null ? ` (${an.pct >= 0 ? '+' : '−'}${fmt(Math.abs(an.pct), 0)} %)` : ''}` : <Sd />}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="ndvi-nota">
                {tend
                    ? `Tendencia del pico anual: ${tend.pendiente >= 0 ? '+' : '−'}${fmt(Math.abs(tend.pendiente), 4)} por año (R² ${fmt(tend.r2, 2)}, ${tend.n} años)${tend.r2 < 0.5 ? ' — sin tendencia clara' : ''}.`
                    : 'Tendencia del pico anual: S/D (se requieren al menos 3 años).'}
                {' '}⚠ = algún mes con menos de 2 pasos de satélite limpios o menos de la mitad de píxeles válidos.
            </p>

            <VolumenVegetacion ndvi={ndvi} supVol={supVol} volumenActual={volActual} cargandoVolumen={volActual == null}
                modulo={modulo} onElegir={setModulo} aniosTabla={aniosCruce} />
        </section>
    );
};

export default NdviInteranual;
