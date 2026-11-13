import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, Filter, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { useModalA11y } from '../../historico/useModalA11y';
import type { useJcasCuenca } from '../../../hooks/useJcasCuenca';
import type { useUnifrutCuenca } from '../../../hooks/useUnifrutCuenca';
import type { CapasCuenca } from '../../../hooks/useCapasCuenca';
import { anilloAPath, proyectorCuenca, SALIDA_CUENCA } from '../../../utils/geoCuenca';
import { MODULOS_SRL, PRESAS } from '../../../utils/geoDistrito';
import { CAPAS_INFO, capasSvg } from '../../../utils/capasCuenca';
import { cuandoVentana, VENTANAS_OBS, type VentanaObs } from '../../../utils/jcasModelo';
import { fechaCorta } from '../../../utils/analiticaPresas';
import { formatearNumero } from '../../../utils/historicoPresas';
import { valorUnifrut, ubicacionUnifrut } from '../../../utils/unifrutModelo';
import {
    construirEstacionesClima, fmtValorEstacion, FUENTES, FUENTES_TODAS, infoVariable, ofreceVariable, ORDEN_ESTADO, reporta, resumenVisible, ROTULO_FUENTE, valorEstacion, VARIABLES_ESTACION,
    type EstacionClima, type FuenteEstacion, type VariableEstacion,
} from '../../../utils/estacionesClima';
// Autosuficiente: también se abre desde Clima y el Dashboard, donde no se cargan los estilos de Presas
import '../analitica/analitica.css';
import './cuenca.css';
import './mapaClimaCompleto.css';

const K_MAX = 14;
const HEX = 'M0,-9 L8,-4.5 L8,4.5 L0,9 L-8,4.5 L-8,-4.5 Z';
const COLOR: Record<FuenteEstacion, string> = { jcas: '63,178,243', propia: '94,196,138', unifrut: '167,139,250' };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Vista { k: number; tx: number; ty: number }
const num = (v: number | null, d: number) => (v == null ? 'S/D' : v.toFixed(d));
const numSD = num;

/**
 * Mapa interactivo de clima a pantalla completa de la cuenca del Conchos y su región. Estaciones propias, JCAS y Unifrut en un mismo plano, con
 * filtros por fuente (varias a la vez), variable y periodo, capas de referencia y ficha de detalle. Zoom con rueda, pellizco o botones; arrastre para mover;
 * teclado (+ − 0 y flechas). Mismos valores que la tabla de la red (estacionesClima): nunca divergen. Contexto provisional; Unifrut está FUERA de la cuenca.
 */
export default function MapaClimaCompleto({ jcas, unifrut, capas, ventanaInicial, onCerrar }: {
    jcas: ReturnType<typeof useJcasCuenca>; unifrut: ReturnType<typeof useUnifrutCuenca>; capas: CapasCuenca; ventanaInicial: VentanaObs; onCerrar: () => void;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    useModalA11y(dialogRef, true, onCerrar);

    const [fuentes, setFuentes] = useState<FuenteEstacion[]>(FUENTES_TODAS);
    const [variable, setVariable] = useState<VariableEstacion>('lluvia');
    const [ventana, setVentana] = useState<VentanaObs>(ventanaInicial);
    const [verFuera, setVerFuera] = useState(false);
    const [nombres, setNombres] = useState(true);
    const [sel, setSel] = useState<string | null>(null);
    const [vista, setVista] = useState<Vista>({ k: 1, tx: 0, ty: 0 });
    const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
    const info = infoVariable(variable);
    // El mapa se dibuja en PÍXELES reales del contenedor (1 unidad = 1 px): así los rótulos y marcadores miden lo mismo en escritorio, iPad y iPhone.
    const lienzoRef = useRef<HTMLDivElement>(null);
    const [dim, setDim] = useState({ w: 900, h: 600 });
    const W = dim.w, H = dim.h;
    const sinMapa = jcas.red?.contorno == null;

    const red = jcas.red;
    const contorno = red?.contorno ?? null;
    const modelo = useMemo(() => construirEstacionesClima(red?.modelo, unifrut.modelo), [red, unifrut.modelo]);
    const p = useMemo(() => (contorno ? proyectorCuenca(contorno.bbox, W, 0.04, H) : null), [contorno, W, H]);

    const visibles = useMemo(() => modelo.estaciones.filter((e) => fuentes.includes(e.fuente) && (verFuera || reporta(e)) )
        .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.nombre.localeCompare(b.nombre)), [modelo, fuentes, verFuera]);
    const valores = useMemo(() => new Map(visibles.map((e) => [e.clave, valorEstacion(e, variable, variable === 'horasFrio' ? 30 : ventana, modelo.finUnifrut)])), [visibles, variable, ventana, modelo.finUnifrut]);
    const [vMin, vMax] = useMemo(() => {
        const vs = [...valores.values()].filter((x): x is number => x != null);
        return vs.length ? [Math.min(...vs), Math.max(...vs)] : [0, 0];
    }, [valores]);
    const resumen = useMemo(() => resumenVisible(visibles.filter((e) => reporta(e) && ofreceVariable(e, variable)), variable, variable === 'horasFrio' ? 30 : ventana, modelo.finUnifrut), [visibles, variable, ventana, modelo.finUnifrut]);
    const seleccionada = modelo.estaciones.find((e) => e.clave === sel) ?? null;

    useEffect(() => {
        const el = lienzoRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const medir = () => { const r = el.getBoundingClientRect(); if (r.width > 50 && r.height > 50) setDim((d) => (Math.abs(d.w - r.width) < 1 && Math.abs(d.h - r.height) < 1 ? d : { w: Math.round(r.width), h: Math.round(r.height) })); };
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, [sinMapa]);
    // Al cambiar el tamaño se vuelve a la vista completa (las posiciones en píxeles ya no valen)
    useEffect(() => { setVista({ k: 1, tx: 0, ty: 0 }); }, [W, H]);

    // ── Vista: zoom y arrastre ────────────────────────────────────────────────
    const limita = (v: Vista): Vista => {
        const k = clamp(v.k, 1, K_MAX);
        return { k, tx: clamp(v.tx, W - W * k, 0), ty: clamp(v.ty, H - H * k, 0) };
    };
    const aSvg = (cx: number, cy: number) => {
        const s = svgRef.current;
        const m = s?.getScreenCTM();
        if (!s || !m) return { x: 0, y: 0 };
        const pt = s.createSVGPoint(); pt.x = cx; pt.y = cy;
        const q = pt.matrixTransform(m.inverse());
        return { x: q.x, y: q.y };
    };
    const zoomEn = (factor: number, x: number, y: number) => setVista((v) => {
        const k = clamp(v.k * factor, 1, K_MAX), f = k / v.k;
        return limita({ k, tx: x - (x - v.tx) * f, ty: y - (y - v.ty) * f });
    });
    const centrar = (lon: number, lat: number, k = 4) => { if (!p) return; setVista(limita({ k, tx: W / 2 - p.x(lon) * k, ty: H / 2 - p.y(lat) * k })); };
    const restablecer = () => setVista({ k: 1, tx: 0, ty: 0 });

    useEffect(() => {
        const s = svgRef.current;
        if (!s) return undefined;
        const rueda = (ev: WheelEvent) => { ev.preventDefault(); const q = aSvg(ev.clientX, ev.clientY); zoomEn(Math.exp(-ev.deltaY * 0.0016), q.x, q.y); };
        s.addEventListener('wheel', rueda, { passive: false });
        return () => s.removeEventListener('wheel', rueda);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [p]);

    const punteros = useRef(new Map<number, { x: number; y: number }>());
    const arrastre = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    const dist0 = useRef(0);
    const alBajar = (ev: React.PointerEvent<SVGSVGElement>) => {
        punteros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        arrastre.current = { x: ev.clientX, y: ev.clientY, moved: false };
        if (punteros.current.size === 2) { const [a, b] = [...punteros.current.values()]; dist0.current = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const alMover = (ev: React.PointerEvent<SVGSVGElement>) => {
        if (!punteros.current.has(ev.pointerId)) return;
        const prev = punteros.current.get(ev.pointerId)!;
        punteros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (punteros.current.size === 2) {
            const [a, b] = [...punteros.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist0.current > 0 && d > 0) { const q = aSvg((a.x + b.x) / 2, (a.y + b.y) / 2); zoomEn(d / dist0.current, q.x, q.y); }
            dist0.current = d;
            if (arrastre.current) arrastre.current.moved = true;
            return;
        }
        const a = arrastre.current;
        if (!a) return;
        if (!a.moved && Math.hypot(ev.clientX - a.x, ev.clientY - a.y) < 5) return;
        a.moved = true;
        const r = svgRef.current?.getBoundingClientRect();
        if (!r) return;
        const esc = Math.max(W / r.width, H / r.height);
        setVista((v) => limita({ ...v, tx: v.tx + (ev.clientX - prev.x) * esc, ty: v.ty + (ev.clientY - prev.y) * esc }));
    };
    const alSoltar = (ev: React.PointerEvent<SVGSVGElement>) => { punteros.current.delete(ev.pointerId); if (punteros.current.size < 2) dist0.current = 0; };
    const tecla = (ev: React.KeyboardEvent) => {
        const paso = 60;
        if (ev.key === '+' || ev.key === '=') zoomEn(1.4, W / 2, H / 2);
        else if (ev.key === '-' || ev.key === '_') zoomEn(1 / 1.4, W / 2, H / 2);
        else if (ev.key === '0') restablecer();
        else if (ev.key === 'ArrowLeft') setVista((v) => limita({ ...v, tx: v.tx + paso }));
        else if (ev.key === 'ArrowRight') setVista((v) => limita({ ...v, tx: v.tx - paso }));
        else if (ev.key === 'ArrowUp') setVista((v) => limita({ ...v, ty: v.ty + paso }));
        else if (ev.key === 'ArrowDown') setVista((v) => limita({ ...v, ty: v.ty - paso }));
        else return;
        ev.preventDefault();
    };

    // ── Capas de referencia (texto a tamaño constante: px/k) ───────────────────
    const kTexto = Math.max(1, Math.round(vista.k * 2) / 2);
    const g = useMemo(() => (contorno && p ? {
        cuenca: contorno.poligonos.map((poli) => anilloAPath(poli[0], p)).join(' '),
        modulos: Object.entries(MODULOS_SRL).map(([k, anillo]) => ({ k, d: anilloAPath(anillo, p) })),
    } : null), [contorno, p]);
    const capasG = useMemo(() => (p && capas.ids.some((i) => i !== 'srl') ? capasSvg(capas.datos, capas.ids.filter((i) => i !== 'srl'), p, { px: 12 / kTexto, tema: 'pantalla', ancho: p.ancho, alto: p.alto }) : null), [capas.datos, capas.ids, p, kTexto]);

    // ── Marcadores en pantalla (tamaño constante) y rótulos sin choques ────────
    const marcas = useMemo(() => {
        if (!p) return [];
        const out = visibles.map((e) => ({ e, x: p.x(e.lon) * vista.k + vista.tx, y: p.y(e.lat) * vista.k + vista.ty, v: valores.get(e.clave) ?? null }))
            .filter((m) => m.x > -30 && m.x < W + 30 && m.y > -30 && m.y < H + 30);
        const cajas: { x0: number; x1: number; y0: number; y1: number }[] = out.map((m) => ({ x0: m.x - 10, x1: m.x + 10, y0: m.y - 10, y1: m.y + 10 }));
        const choca = (c: { x0: number; x1: number; y0: number; y1: number }) => c.x0 < 2 || c.x1 > W - 2 || c.y0 < 2 || c.y1 > H - 2 || cajas.some((o) => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0);
        const rot = new Map<string, { valor: boolean; nombre: boolean; izq: boolean }>();
        const orden = [...out].sort((a, b) => (b.v ?? -1e9) - (a.v ?? -1e9));
        for (const m of orden) {
            const txtV = m.v == null ? '' : num(m.v, info.decimales), wV = txtV.length * 8 + 4, wN = m.e.nombre.length * 7 + 4;
            let valor = false, nombre = false, izq = false;
            for (const lado of [false, true]) {
                const cv = { x0: lado ? m.x - 12 - wV : m.x + 12, x1: lado ? m.x - 12 : m.x + 12 + wV, y0: m.y - 9, y1: m.y + 7 };
                if (txtV && !choca(cv)) {
                    valor = true; izq = lado; cajas.push(cv);
                    if (nombres && vista.k >= 1.8) {
                        const cn = { x0: lado ? cv.x0 - wN - 3 : cv.x1 + 3, x1: lado ? cv.x0 - 3 : cv.x1 + 3 + wN, y0: m.y - 9, y1: m.y + 7 };
                        if (!choca(cn)) { nombre = true; cajas.push(cn); }
                    }
                    break;
                }
            }
            rot.set(m.e.clave, { valor, nombre, izq });
        }
        return out.map((m) => ({ ...m, rot: rot.get(m.e.clave)! }));
    }, [visibles, valores, vista, p, nombres, info.decimales, W, H]);

    const alfaDe = (v: number | null) => (v == null ? 0.08 : 0.35 + 0.6 * (vMax > vMin ? (v - vMin) / (vMax - vMin) : 0.5));
    const alternarFuente = (f: FuenteEstacion) => setFuentes((a) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]));
    const cuando = variable === 'horasFrio' ? 'acumuladas desde el 1-nov' : cuandoVentana(ventana);
    const conteo = (f: FuenteEstacion) => modelo.estaciones.filter((e) => e.fuente === f && reporta(e)).length;
    const apagadas = modelo.estaciones.filter((e) => fuentes.includes(e.fuente) && !reporta(e)).length;
    const aria = (e: EstacionClima, v: number | null) => `${e.nombre} (${ROTULO_FUENTE[e.fuente]}${e.fuente === 'unifrut' ? ', fuera de la cuenca' : ''}): ${info.etiqueta.toLowerCase()} ${fmtValorEstacion(variable, v)} ${cuando}${e.estado === 'atrasada' ? `, dato atrasado ${e.atrasoDias} d` : ''}`;

    return createPortal(
        <div className="cu-root mc-overlay">
            <div className="mc" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="mc-t" tabIndex={-1}>
                <header className="mc-barra">
                    <div className="mc-tit">
                        <h2 id="mc-t">Mapa interactivo de clima</h2>
                        <p className="mc-sub">{info.etiqueta} · {cuando} · {visibles.length} estaciones · propias, JCAS y Unifrut · dato provisional de contexto</p>
                    </div>
                    <div className="mc-acc">
                        <button type="button" className="an-btn mc-btn-filtros" aria-expanded={filtrosAbiertos} aria-controls="mc-filtros" onClick={() => setFiltrosAbiertos((v) => !v)}><Filter size={14} aria-hidden="true" /> Filtros</button>
                        <button type="button" className="an-btn" onClick={onCerrar} aria-label="Cerrar el mapa interactivo"><X size={14} aria-hidden="true" /> Cerrar</button>
                    </div>
                </header>

                <div className="mc-cuerpo">
                    <aside id="mc-filtros" className={`mc-filtros${filtrosAbiertos ? ' mc-filtros--abierto' : ''}`} aria-label="Filtros del mapa">
                        <fieldset className="mc-grupo">
                            <legend>Estaciones</legend>
                            <div className="mc-chips">
                                {FUENTES.map((f) => (
                                    <button key={f.id} type="button" className="mc-chip" aria-pressed={fuentes.includes(f.id)} title={f.ayuda} onClick={() => alternarFuente(f.id)}>
                                        <svg width="14" height="14" viewBox="-9 -9 18 18" aria-hidden="true">
                                            {f.id === 'jcas' ? <circle r="7" fill={`rgba(${COLOR.jcas},.6)`} stroke={`rgb(${COLOR.jcas})`} strokeWidth="1.5" /> : f.id === 'propia' ? <rect x="-7" y="-7" width="14" height="14" rx="2" fill={`rgba(${COLOR.propia},.6)`} stroke={`rgb(${COLOR.propia})`} strokeWidth="1.5" /> : <path d={HEX} fill={`rgba(${COLOR.unifrut},.6)`} stroke={`rgb(${COLOR.unifrut})`} strokeWidth="1.5" />}
                                        </svg>
                                        {f.etiqueta} ({conteo(f.id)})
                                    </button>
                                ))}
                            </div>
                            {apagadas > 0 && <label className="mc-check"><input type="checkbox" checked={verFuera} onChange={() => setVerFuera((v) => !v)} /> Mostrar {apagadas} fuera de servicio o sin datos</label>}
                        </fieldset>
                        <fieldset className="mc-grupo">
                            <legend>Variable</legend>
                            <div className="mc-chips" role="radiogroup" aria-label="Variable">
                                {VARIABLES_ESTACION.map((v) => <button key={v.id} type="button" role="radio" aria-checked={variable === v.id} className="mc-chip" onClick={() => setVariable(v.id)}>{v.etiqueta}</button>)}
                            </div>
                            {(variable === 'humedad' || variable === 'horasFrio') && fuentes.includes('unifrut') && <p className="mc-nota">Unifrut no tiene {variable === 'humedad' ? 'humedad confiable' : 'horas frío'}: sus estaciones quedan en S/D.</p>}
                        </fieldset>
                        <fieldset className="mc-grupo" disabled={variable === 'horasFrio'}>
                            <legend>Periodo</legend>
                            <div className="mc-chips" role="radiogroup" aria-label="Periodo">
                                {VENTANAS_OBS.map(({ v, t }) => <button key={String(v)} type="button" role="radio" aria-checked={ventana === v} className="mc-chip" onClick={() => setVentana(v)}>{t}</button>)}
                            </div>
                            {ventana === 'hoy' && fuentes.includes('unifrut') && variable !== 'horasFrio' && <p className="mc-nota">Unifrut solo publica días completos: en «Hoy» queda S/D.</p>}
                            {variable === 'horasFrio' && <p className="mc-nota">Las horas frío son un acumulado de temporada: no dependen del periodo.</p>}
                        </fieldset>
                        <fieldset className="mc-grupo">
                            <legend>Capas de referencia</legend>
                            <div className="mc-chips">
                                {CAPAS_INFO.map((c) => <button key={c.id} type="button" className="mc-chip" aria-pressed={capas.ids.includes(c.id)} title={c.ayuda} onClick={() => capas.alternar(c.id)}>{capas.ids.includes(c.id) ? '✓ ' : ''}{c.titulo}</button>)}
                            </div>
                            <label className="mc-check"><input type="checkbox" checked={nombres} onChange={() => setNombres((v) => !v)} /> Nombres de estación (al acercar)</label>
                        </fieldset>
                        <fieldset className="mc-grupo">
                            <legend>Ir a una estación</legend>
                            <select className="mc-sel" aria-label="Ir a una estación" value={sel ?? ''} onChange={(ev) => { const e = modelo.estaciones.find((x) => x.clave === ev.target.value); setSel(e?.clave ?? null); if (e) centrar(e.lon, e.lat); }}>
                                <option value="">Elegir…</option>
                                {FUENTES.map((f) => <optgroup key={f.id} label={f.etiqueta}>{visibles.filter((e) => e.fuente === f.id).map((e) => <option key={e.clave} value={e.clave}>{e.nombre}</option>)}</optgroup>)}
                            </select>
                        </fieldset>
                        <div className="mc-resumen" role="status">
                            <b>{resumen.media == null ? 'S/D' : `${formatearNumero(resumen.media, info.decimales)} ${info.unidad}`}</b>
                            <span>{resumen.media == null ? `Se necesitan ≥ 2 estaciones con dato (hay ${resumen.conDato}).` : `media simple de ${resumen.conDato} estaciones (${fmtValorEstacion(variable, resumen.min)}–${fmtValorEstacion(variable, resumen.max)}). No es el valor areal de la cuenca.`}</span>
                        </div>
                    </aside>

                    <section className="mc-mapa" aria-label="Mapa">
                        {!p || !g ? (
                            <div className="an-vacio" role="status"><strong>Sin contorno de la cuenca por ahora (S/D)</strong><span>{jcas.error ?? 'Todavía no se carga el contorno.'}</span></div>
                        ) : (
                            <>
                                <div className="mc-lienzo" ref={lienzoRef} tabIndex={0} role="application" aria-label="Mapa interactivo. Más y menos acercan; las flechas mueven; cero restablece." onKeyDown={tecla}>
                                    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="mc-svg" onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar} role="group" aria-label={`Estaciones: ${info.etiqueta.toLowerCase()} ${cuando}`}>
                                        <defs><clipPath id="mc-cl"><path d={g.cuenca} /></clipPath></defs>
                                        <g transform={`translate(${vista.tx.toFixed(1)} ${vista.ty.toFixed(1)}) scale(${vista.k.toFixed(3)})`} className="mc-base">
                                            <path d={g.cuenca} className="cu-mapa-cuenca" />
                                            {capasG && <g clipPath="url(#mc-cl)" aria-hidden="true" dangerouslySetInnerHTML={{ __html: capasG.bajo }} />}
                                            {capasG && <g aria-hidden="true" dangerouslySetInnerHTML={{ __html: capasG.alto }} />}
                                            {g.modulos.map((m) => <path key={m.k} d={m.d} className="cu-mapa-modulo" />)}
                                        </g>
                                        {PRESAS.map((pr) => {
                                            const x = p.x(pr.lon) * vista.k + vista.tx, y = p.y(pr.lat) * vista.k + vista.ty;
                                            if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return null;
                                            return <g key={pr.nombre} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}><path d="M0,-7 L7,6 L-7,6 Z" className="cu-mapa-presa"><title>{pr.nombre}</title></path>{vista.k >= 1.8 && <text x={10} y={4} className="cu-mapa-txt">{pr.nombre}</text>}</g>;
                                        })}
                                        <g transform={`translate(${(p.x(SALIDA_CUENCA.lon) * vista.k + vista.tx).toFixed(1)} ${(p.y(SALIDA_CUENCA.lat) * vista.k + vista.ty).toFixed(1)})`} aria-hidden="true"><path d="M-14,16 L0,30 L14,16" className="cu-mapa-flecha" /><text x={14} y={46} textAnchor="end" className="cu-mapa-txt cu-mapa-txt--salida">Salida · Ojinaga</text></g>
                                        {marcas.map(({ e, x, y, v, rot }) => {
                                            const esSel = e.clave === sel;
                                            const atras = e.estado !== 'vigente';
                                            const fill = `rgba(${COLOR[e.fuente]},${alfaDe(v)})`;
                                            const stroke = `rgb(${COLOR[e.fuente]})`;
                                            return (
                                                <g key={e.clave} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} className={`mc-est${esSel ? ' mc-est--sel' : ''}`} role="button" tabIndex={0} aria-label={aria(e, v)} aria-pressed={esSel}
                                                    onClick={() => setSel(e.clave)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setSel(e.clave); } }}>
                                                    <title>{aria(e, v)}</title>
                                                    <circle r={16} className="mc-est-zona" />
                                                    {esSel && <circle r={14} className="mc-est-anillo" />}
                                                    {e.fuente === 'jcas' && <circle r={8} fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray={atras ? '3 3' : undefined} />}
                                                    {e.fuente === 'propia' && <rect x={-7} y={-7} width={14} height={14} rx={2} fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray={atras ? '3 2' : undefined} />}
                                                    {e.fuente === 'unifrut' && <path d={HEX} fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray={atras ? '3 2' : undefined} />}
                                                    {rot.valor && <text x={rot.izq ? -12 : 12} y={4} textAnchor={rot.izq ? 'end' : 'start'} className="cu-mapa-txt cu-mapa-txt--mm">{num(v, info.decimales)}</text>}
                                                    {rot.valor && rot.nombre && <text x={rot.izq ? -12 - (num(v, info.decimales).length * 8 + 7) : 12 + (num(v, info.decimales).length * 8 + 7)} y={4} textAnchor={rot.izq ? 'end' : 'start'} className="cu-mapa-txt">{e.nombre}</text>}
                                                </g>
                                            );
                                        })}
                                    </svg>
                                    <div className="mc-zoom" role="group" aria-label="Zoom del mapa">
                                        <button type="button" className="an-btn" onClick={() => zoomEn(1.5, W / 2, H / 2)} aria-label="Acercar"><Plus size={16} aria-hidden="true" /></button>
                                        <button type="button" className="an-btn" onClick={() => zoomEn(1 / 1.5, W / 2, H / 2)} aria-label="Alejar"><Minus size={16} aria-hidden="true" /></button>
                                        <button type="button" className="an-btn" onClick={restablecer} aria-label="Ver toda la cuenca"><RotateCcw size={16} aria-hidden="true" /></button>
                                    </div>
                                    <span className="mc-k" aria-live="polite">×{vista.k.toFixed(1)}</span>
                                </div>
                                <div className="cu-leyenda-viz mc-leyenda">
                                    <span className="mc-barra-esc" aria-hidden="true"><i /></span>
                                    <span>{num(vMin, info.decimales)} → {num(vMax, info.decimales)} {info.unidad} (más intenso = mayor)</span>
                                    <span><svg width="14" height="14" viewBox="-9 -9 18 18" aria-hidden="true"><circle r="7" className="cu-est-c cu-est-c--atras" style={{ fill: 'rgba(63,178,243,0.1)' }} /></svg> punteado = dato atrasado · tenue = S/D</span>
                                    <span>Unifrut está fuera del contorno de la cuenca (contexto regional)</span>
                                </div>
                            </>
                        )}
                    </section>

                    <aside className="mc-detalle" aria-label="Detalle de la estación" aria-live="polite">
                        {!seleccionada ? (
                            <div className="mc-vacio"><Crosshair size={22} aria-hidden="true" /><p>Toca o elige una estación para ver sus datos de clima: lluvia, temperaturas, viento, humedad y horas frío por periodo.</p></div>
                        ) : (
                            <Detalle e={seleccionada} fin={modelo.finUnifrut} onEnfocar={() => centrar(seleccionada.lon, seleccionada.lat)} onCerrar={() => setSel(null)} />
                        )}
                    </aside>
                </div>
            </div>
        </div>,
        document.body,
    );
}

const COLS: { v: VentanaObs; t: string }[] = [{ v: 'hoy', t: 'Hoy*' }, { v: 1, t: 'Ayer' }, { v: 7, t: '7 d' }, { v: 30, t: '30 d' }];

function Detalle({ e, fin, onEnfocar, onCerrar }: { e: EstacionClima; fin: string | null; onEnfocar: () => void; onCerrar: () => void }) {
    const estado = e.estado === 'vigente' ? 'Al día' : e.estado === 'atrasada' ? `Atrasada ${e.atrasoDias} d` : e.estado === 'fuera-servicio' ? `Fuera de servicio · ${e.atrasoDias} d` : 'Sin datos';
    const unif = e.fuente === 'unifrut' ? e.origen : null;
    return (
        <div className="mc-det">
            <div className="mc-det-cab">
                <div>
                    <h3>{e.nombre}</h3>
                    <p><span className={`cu-tag${e.fuente === 'unifrut' ? ' cu-tag--aviso' : ''}`}>{ROTULO_FUENTE[e.fuente]}</span> {e.fuente === 'unifrut' ? ubicacionUnifrut(e.origen) : e.fuente === 'jcas' && e.origen.zona === 'salida' ? 'Salida de la cuenca' : e.fuente === 'propia' ? 'Estación del distrito' : 'Dentro de la cuenca'}</p>
                </div>
                <button type="button" className="an-btn" onClick={onCerrar} aria-label="Quitar la selección"><X size={14} aria-hidden="true" /></button>
            </div>
            <dl className="mc-datos">
                <div><dt>Estado</dt><dd>{estado} · último día {e.ultFecha ? fechaCorta(e.ultFecha) : 'S/D'}</dd></div>
                <div><dt>Ubicación</dt><dd>{e.lat.toFixed(4)}, {e.lon.toFixed(4)}{e.altitudM != null ? ` · ${formatearNumero(e.altitudM, 0)} msnm` : ''}</dd></div>
            </dl>
            <table className="mc-tabla">
                <caption className="cu-sr">Datos de clima por periodo</caption>
                <thead><tr><th scope="col">Variable</th>{COLS.map((c) => <th key={String(c.v)} scope="col" className="cu-num">{c.t}</th>)}</tr></thead>
                <tbody>
                    {VARIABLES_ESTACION.filter((v) => v.id !== 'horasFrio').map((v) => (
                        <tr key={v.id}><th scope="row">{v.etiqueta} <span className="mc-u">({v.unidad})</span></th>{COLS.map((c) => <td key={String(c.v)} className="cu-num">{numSD(valorEstacion(e, v.id, c.v, fin), v.decimales)}</td>)}</tr>
                    ))}
                    <tr><th scope="row">Horas frío <span className="mc-u">(h, desde 1-nov)</span></th><td colSpan={4} className="cu-num">{numSD(valorEstacion(e, 'horasFrio', 30, fin), 0)}</td></tr>
                    {unif && fin && <tr><th scope="row">ETo <span className="mc-u">(mm)</span></th>{COLS.map((c) => <td key={String(c.v)} className="cu-num">{numSD(valorUnifrut(unif, 'eto', c.v, fin), 1)}</td>)}</tr>}
                </tbody>
            </table>
            <p className="mc-nota">* «Hoy» es el día en curso y es parcial (hasta la última lectura){e.fuente === 'unifrut' ? '; Unifrut solo publica días completos, por eso es S/D' : ''}. S/D = sin dato suficiente (menos del 80 % de los días): nunca 0.{e.fuente === 'unifrut' ? ' Sin humedad confiable ni horas frío.' : ''}{e.excluidaLluvia ? ' Su pluviómetro está excluido por sospechoso (solo afecta a la lluvia).' : ''}{e.sinPluviometro ? ' Sin pluviómetro: la lluvia es S/D.' : ''}</p>
            {e.nota && <p className="mc-nota">{e.nota}</p>}
            <button type="button" className="an-btn" onClick={onEnfocar}><Crosshair size={14} aria-hidden="true" /> Acercar a la estación</button>
        </div>
    );
}
