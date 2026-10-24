import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { supabase } from '../../lib/supabase';
import { COLOR_MODULO_SRL } from '../../utils/modulosSRL';
import { fmt, fmtMiles } from '../../utils/formato';
import { NDVI_RANGO, cargarSerieNdviV2 } from '../../utils/ndviSerie';
import {
    COLOR_ANIO_FOCO, ETIQUETA_MES, MESES_TEMPORADA, UMBRAL_SIN_CAMBIO, anomaliaPico, aniosDisponibles, climatologiaMensual, colorAnioPrevio, cruceAnual,
    lecturaAnio, resumenAnio, serieAnio, tendenciaPico, type FilaNdviV2, type FilaSupVol,
} from '../../utils/ndviInteranual';
import { SelectorChips } from './SelectorChips';
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

/** Dispersión volumen entregado (hm³) contra NDVI medio de la temporada: un punto por año con ambos datos; atípico = hueco con marca.
 *  Se usa la media mar–sep y no el pico: con los datos 2021–2024 la media acompaña al volumen dentro de cada módulo
 *  (r de 0.69 a 0.98 en 5 de 6 módulos) y el pico no (r entre −0.74 y 0.54). */
const DispersionLamina: React.FC<{ cruce: ReturnType<typeof cruceAnual>[]; modulo: number }> = ({ cruce, modulo }) => {
    const pts = cruce.filter(c => c.volumenHm3 != null && c.mediaNdvi != null);
    if (pts.length < 3) {
        return <p className="ndvi-nota">Volumen contra vegetación: <Sd /> (se necesitan al menos 3 años con volumen y NDVI; hay {pts.length}).</p>;
    }
    const W = 360, H = 190, L = 46, R = 54, T = 14, B = 34;
    const xs = pts.map(p => p.volumenHm3 as number), ys = pts.map(p => p.mediaNdvi as number);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const px = (v: number) => L + (x1 === x0 ? (W - L - R) / 2 : ((v - x0) / (x1 - x0)) * (W - L - R));
    const py = (v: number) => T + (y1 === y0 ? (H - T - B) / 2 : (1 - (v - y0) / (y1 - y0)) * (H - T - B));
    return (
        <figure className="ndvi-ia-fig">
            <figcaption>¿Más agua entregada, más vegetación? — Módulo {modulo}</figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Volumen entregado contra NDVI medio de la temporada, ${pts.length} años`}>
                <line x1={L} y1={H - B} x2={W - R} y2={H - B} className="ndvi-ia-eje" /><line x1={L} y1={T} x2={L} y2={H - B} className="ndvi-ia-eje" />
                <text x={L} y={H - 18} className="ndvi-ia-tick" textAnchor="start">{fmt(x0, 1)}</text>
                <text x={W - R} y={H - 18} className="ndvi-ia-tick" textAnchor="end">{fmt(x1, 1)}</text>
                <text x={(L + W - R) / 2} y={H - 3} className="ndvi-ia-tick" textAnchor="middle">Volumen entregado (hm³)</text>
                <text x={L - 6} y={T + 8} className="ndvi-ia-tick" textAnchor="end">{y1.toFixed(2)}</text>
                <text x={L - 6} y={H - B} className="ndvi-ia-tick" textAnchor="end">{y0.toFixed(2)}</text>
                <text x={12} y={(T + H - B) / 2} className="ndvi-ia-tick" textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>NDVI medio mar–sep</text>
                {pts.map(p => (
                    <g key={p.anio}>
                        <circle cx={px(p.volumenHm3 as number)} cy={py(p.mediaNdvi as number)} r="6" className={p.atipicos > 0 ? 'ndvi-ia-pto atip' : 'ndvi-ia-pto'} />
                        <text x={px(p.volumenHm3 as number) + 9} y={py(p.mediaNdvi as number) + 4} className="ndvi-ia-pto-t">{p.anio}{p.atipicos > 0 ? ' ⚠' : ''}</text>
                    </g>
                ))}
            </svg>
            <p className="ndvi-nota">{pts.length} años con ambos datos. Es una comparación descriptiva entre años, no una relación causal; punto hueco con ⚠ = captura atípica en el informe fuente.</p>
        </figure>
    );
};

export const NdviInteranual: React.FC = () => {
    const [ndvi, setNdvi] = useState<FilaNdviV2[]>([]);
    const [supVol, setSupVol] = useState<FilaSupVol[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [cargando, setCargando] = useState(true);
    const [modulo, setModulo] = useState<number>(1);
    const [anioElegido, setAnioElegido] = useState<number | null>(null);
    const [reducir, setReducir] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        setReducir(!!mq?.matches);
    }, []);

    useEffect(() => {
        let cancelado = false;
        (async () => {
            const [a, b] = await Promise.all([
                cargarSerieNdviV2(supabase),
                supabase.from('superficie_volumen_anual_modulo').select('anio, numero_modulo, cultivo, superficie_ha, volumen_miles_m3, atipico').limit(2000),
            ]);
            if (cancelado) return;
            const msg = a.error ?? b.error?.message ?? null;
            setError(msg);
            setNdvi(a.error ? [] : a.filas);
            setSupVol(b.error || !b.data ? [] : (b.data as FilaSupVol[]));
            setCargando(false);
        })();
        return () => { cancelado = true; };
    }, []);

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
    const cruce = useMemo(() => aniosCruce.map(a => cruceAnual(ndvi, supVol, modulo, a)), [aniosCruce, ndvi, supVol, modulo]);

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

            <h4 className="ndvi-ia-sub">Superficie, volumen y vegetación</h4>
            <div className="ndvi-ia-cruce">
                <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label={`Superficie, volumen y vegetación por año, Módulo ${modulo}`}>
                    <table className="ndvi-ia-tabla">
                        <caption>Superficie · volumen · vegetación por año — Módulo {modulo}</caption>
                        <thead><tr><th scope="col">Año</th><th scope="col">Superficie (ha)</th><th scope="col">Volumen (hm³)</th><th scope="col">Lámina (m³/ha)</th><th scope="col">ha por hm³</th><th scope="col">NDVI medio</th><th scope="col">Pico NDVI</th></tr></thead>
                        <tbody>
                            {cruce.map(c => (
                                <tr key={c.anio} className={c.anio === anioFoco ? 'foco' : ''}>
                                    <th scope="row">{c.anio}{c.atipicos > 0 && <span className="ndvi-ia-aviso" title={`${c.atipicos} renglón(es) de cultivo con captura atípica en el informe fuente (se suman tal cual)`}> ⚠</span>}</th>
                                    <td>{celda(fmtMiles(c.superficieHa, 0))}</td>
                                    <td>{celda(fmt(c.volumenHm3, 1))}</td>
                                    <td>{celda(fmtMiles(c.laminaM3Ha, 0))}</td>
                                    <td>{celda(fmt(c.haPorHm3, 1))}</td>
                                    <td>{celda(fmt(c.mediaNdvi, 3))}</td>
                                    <td>{celda(fmt(c.picoNdvi, 3))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <DispersionLamina cruce={cruce} modulo={modulo} />
            </div>
            <p className="ndvi-nota">
                Superficie y volumen: informe de distribución al corte de septiembre (ACUM_INF); no hay informe de 2025 ni de 2026 cargado,
                y no hay NDVI de 2020 (la serie de satélite inicia en marzo de 2021): esos huecos se muestran como S/D, no como cero.
                ⚠ = renglones con captura atípica en el informe fuente, sumados sin corregir.
            </p>
        </section>
    );
};

export default NdviInteranual;
