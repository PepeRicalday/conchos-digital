import React, { useMemo, useRef, useState } from 'react';
import { useCapaLocal } from '../historico/useModalA11y';
import { fmt, fmtMiles } from '../../utils/formato';
import { SIMBOLO_MODULO } from '../../utils/ndviGrafica';
import { UMBRAL_SIN_CAMBIO, cruceAnual, type FilaNdviV2, type FilaSupVol } from '../../utils/ndviInteranual';
import {
    ANIO_ACTUAL, escalaEje, fraseActual, fraseRelacion, lecturaGeneral, relacionVolumenNdvi, type RelacionVolNdvi, type VolumenActual,
} from '../../utils/ndviVolumen';
import './VolumenVegetacion.css';

const MODULOS = [1, 2, 3, 4, 5, 12];

/** Contorno de cada símbolo del módulo (centro 0,0; «s» = radio). La forma, no el color, identifica al módulo. */
function trazoSimbolo(forma: string | undefined, s: number): string {
    switch (forma) {
        case 'rect': return `M${-s * 0.9} ${-s * 0.9}H${s * 0.9}V${s * 0.9}H${-s * 0.9}Z`;
        case 'triangle': return `M0 ${-s * 1.1}L${s * 1.05} ${s * 0.8}H${-s * 1.05}Z`;
        case 'diamond': return `M0 ${-s * 1.2}L${s * 1.2} 0L0 ${s * 1.2}L${-s * 1.2} 0Z`;
        case 'arrow': return `M0 ${-s * 1.15}L${s * 1.1} ${s * 0.1}H${s * 0.45}V${s * 1.05}H${-s * 0.45}V${s * 0.1}H${-s * 1.1}Z`;
        case 'pin': return `M0 ${s * 1.2}C${-s * 1.5} ${-s * 0.1} ${-s * 1.1} ${-s * 1.1} 0 ${-s * 1.1}C${s * 1.1} ${-s * 1.1} ${s * 1.5} ${-s * 0.1} 0 ${s * 1.2}Z`;
        default: return `M${-s} 0A${s} ${s} 0 1 0 ${s} 0A${s} ${s} 0 1 0 ${-s} 0Z`;
    }
}

const sg = (v: number, d: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;
const W = 300, H = 250, L = 38, R = 16, T = 24, B = 44;

interface Marca { clave: string; anio: number; x: number; y: number; vol: number; ndvi: number; atipico: boolean; actual: boolean; texto: string }

const ESTADO_TXT: Record<string, string> = { firme: 'Firme', indicativa: 'Indicativa', 'sin-relacion': 'Sin relación', 'sin-evidencia': 'Sin evidencia' };
const claveEstado = (r: RelacionVolNdvi) => (r.estado === 'acompaña' ? (r.firme ? 'firme' : 'indicativa') : r.estado);

const Cuadro: React.FC<{ rel: RelacionVolNdvi; activo: boolean; onElegir: () => void; ejeY: { min: number; max: number; ticks: number[] } }> = ({ rel, activo, onElegir, ejeY }) => {
    const [foco, setFoco] = useState<string | null>(null);
    const refs = useRef<Record<string, SVGGElement | null>>({});
    const forma = SIMBOLO_MODULO[rel.modulo];
    const uid = `vv-${rel.modulo}`;

    const volumenes = [...rel.puntos.map(p => p.volumenHm3), ...(rel.actual ? [rel.actual.volumenHm3] : [])];
    const ejeX = escalaEje(volumenes);
    const px = (v: number) => (ejeX ? L + ((v - ejeX.min) / (ejeX.max - ejeX.min)) * (W - L - R) : L);
    const py = (v: number) => T + (1 - (v - ejeY.min) / (ejeY.max - ejeY.min)) * (H - T - B);

    const marcas: Marca[] = useMemo(() => {
        if (!ejeX) return [];
        const m: Marca[] = rel.puntos.map(p => ({
            clave: String(p.anio), anio: p.anio, x: px(p.volumenHm3), y: py(p.ndviMedio), vol: p.volumenHm3, ndvi: p.ndviMedio, atipico: p.atipico, actual: false,
            texto: `${p.anio}: ${p.volumenHm3.toFixed(1)} hm³, NDVI ${p.ndviMedio.toFixed(3)}${p.atipico ? ', captura atípica en el informe fuente' : ''}`,
        }));
        if (rel.actual) {
            const a = rel.actual;
            m.push({
                clave: String(a.anio), anio: a.anio, x: px(a.volumenHm3), y: py(a.ndviMedio), vol: a.volumenHm3, ndvi: a.ndviMedio, atipico: false, actual: true,
                texto: `${a.anio} (volumen provisional, hoja SRL, fuera del ajuste): ${a.volumenHm3.toFixed(1)} hm³, NDVI ${a.ndviMedio.toFixed(3)}${a.volumenIncompleto ? ', volumen incompleto' : ''}`,
            });
        }
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rel, ejeX?.min, ejeX?.max, ejeY.min, ejeY.max]);

    const clave = claveEstado(rel);
    const titulo = `Módulo ${rel.modulo}: volumen entregado contra NDVI medio mar–sep. ${fraseRelacion(rel)}`;
    const pares = marcas.map(m => m.texto).join('; ');
    const enfocada = marcas.find(m => m.clave === foco) ?? null;
    // Escape cierra primero el tooltip y devuelve el foco al punto que lo abrió; con el tooltip cerrado, Escape llega al panel.
    const sinReabrir = useRef(false);
    // Tras Escape, el ratón que siga encima del punto no vuelve a abrir el tooltip hasta que salga de él.
    const descartadoConRaton = useRef(false);
    useCapaLocal(!!enfocada, () => {
        const abierto = foco;
        descartadoConRaton.current = true;
        setFoco(null);
        const nodo = abierto ? refs.current[abierto] : null;
        if (nodo && document.activeElement !== nodo) { sinReabrir.current = true; nodo.focus(); sinReabrir.current = false; }
    });

    const mover = (e: React.KeyboardEvent, i: number) => {
        const orden = [...marcas].sort((a, b) => a.x - b.x);
        const k = orden.findIndex(m => m.clave === marcas[i].clave);
        const sig = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? orden[Math.min(orden.length - 1, k + 1)] : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? orden[Math.max(0, k - 1)] : null;
        // Enter o espacio abren y cierran el tooltip; Escape cierra primero el tooltip (capa local registrada con useCapaLocal) y después el panel.
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFoco(f => (f === marcas[i].clave ? null : marcas[i].clave)); return; }
        if (sig) { e.preventDefault(); refs.current[sig.clave]?.focus(); }
    };

    // Recta del ajuste: solo sobre el rango de los años ajustados (no se extrapola).
    const vs = rel.puntos.map(p => p.volumenHm3);
    const recta = rel.pendiente != null && rel.intercepto != null && vs.length
        ? { x1: px(Math.min(...vs)), y1: py(rel.intercepto + rel.pendiente * Math.min(...vs)), x2: px(Math.max(...vs)), y2: py(rel.intercepto + rel.pendiente * Math.max(...vs)) }
        : null;
    const a = rel.actual;
    // Referencia del año actual: punto sobre la recta (o nivel promedio) en su mismo volumen.
    const refY = a && a.desviacion != null ? py(a.ndviMedio - a.desviacion) : null;
    // Rótulos de año: primero a la derecha, luego izquierda, arriba y abajo; el primer sitio que no pise otro rótulo ni otro punto.
    const rotulos = useMemo(() => {
        const out = new Map<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>();
        const cajas: { x0: number; x1: number; y0: number; y1: number }[] = [];
        const textoDe = (m: Marca) => (m.actual ? `${m.anio} · provisional` : String(m.anio));
        const orden = [...marcas].sort((a, b) => Number(b.actual) - Number(a.actual) || a.x - b.x);
        const choca = (c: { x0: number; x1: number; y0: number; y1: number }, holgura = 12) =>
            c.x0 < L || c.x1 > W - 2 || c.y0 < T - 6 || c.y1 > H - B + 2 ||
            cajas.some(o => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0) ||
            marcas.some(q => q.x + holgura > c.x0 && q.x - holgura < c.x1 && q.y + holgura > c.y0 && q.y - holgura < c.y1);
        for (const m of orden) {
            const w = textoDe(m).length * 7.6 + 6;
            const cand = [
                { x: m.x + 12, y: m.y + 4.5, anchor: 'start' as const, x0: m.x + 11, x1: m.x + 11 + w, y0: m.y - 8, y1: m.y + 8 },
                { x: m.x - 12, y: m.y + 4.5, anchor: 'end' as const, x0: m.x - 11 - w, x1: m.x - 11, y0: m.y - 8, y1: m.y + 8 },
                { x: m.x, y: m.y - 15, anchor: 'middle' as const, x0: m.x - w / 2, x1: m.x + w / 2, y0: m.y - 28, y1: m.y - 13 },
                { x: m.x, y: m.y + 25, anchor: 'middle' as const, x0: m.x - w / 2, x1: m.x + w / 2, y0: m.y + 13, y1: m.y + 28 },
                { x: m.x + 9, y: m.y + 23, anchor: 'start' as const, x0: m.x + 8, x1: m.x + 8 + w, y0: m.y + 11, y1: m.y + 26 },
                { x: m.x - 9, y: m.y + 23, anchor: 'end' as const, x0: m.x - 8 - w, x1: m.x - 8, y0: m.y + 11, y1: m.y + 26 },
                { x: m.x + 9, y: m.y - 13, anchor: 'start' as const, x0: m.x + 8, x1: m.x + 8 + w, y0: m.y - 26, y1: m.y - 10 },
                { x: m.x - 9, y: m.y - 13, anchor: 'end' as const, x0: m.x - 8 - w, x1: m.x - 8, y0: m.y - 26, y1: m.y - 10 },
                { x: m.x, y: m.y + 42, anchor: 'middle' as const, x0: m.x - w / 2, x1: m.x + w / 2, y0: m.y + 30, y1: m.y + 45 },
            ];
            // 2026 prefiere debajo (cuelga de su recta); los demás años, encima o al lado.
            const pref = m.actual ? [3, 6, 7, 1, 0, 4, 5, 8] : [2, 0, 1, 4, 5, 3, 6, 7, 8];
            const ordenado = pref.map(i => cand[i]);
            const elegido = ordenado.find(c => !choca(c)) ?? ordenado.find(c => !choca(c, 7)) ?? ordenado[0];
            cajas.push(elegido);
            out.set(m.clave, { x: elegido.x, y: elegido.y, anchor: elegido.anchor });
        }
        return out;
    }, [marcas]);

    return (
        <figure className={`vv-cuadro ${activo ? 'on' : ''} est-${clave}`}>
            <button type="button" className="vv-cab" aria-pressed={activo} onClick={onElegir} aria-label={`Módulo ${rel.modulo}, ${ESTADO_TXT[clave]}. Elegir para ver su tabla`}>
                <svg className="vv-sim" viewBox="-11 -11 22 22" aria-hidden="true"><path d={trazoSimbolo(forma, 6.5)} /></svg>
                <b>Módulo {rel.modulo}</b>
                <span className={`vv-chip ${clave}`}>{clave === 'firme' ? '✓ ' : ''}{ESTADO_TXT[clave]}</span>
            </button>
            <div className="vv-lienzo">
                {ejeX ? (
                    <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-labelledby={`${uid}-t ${uid}-d`}>
                        <title id={`${uid}-t`}>{titulo}</title>
                        <desc id={`${uid}-d`}>{pares || 'Sin puntos con volumen y NDVI.'}</desc>
                        {ejeY.ticks.map(t => (
                            <g key={t}>
                                <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} className="vv-malla" />
                                <text x={L - 6} y={py(t) + 4} className="vv-tick" textAnchor="end">{t.toFixed(1)}</text>
                            </g>
                        ))}
                        {ejeX.ticks.map(t => (
                            <g key={t}>
                                <line x1={px(t)} x2={px(t)} y1={H - B} y2={H - B + 4} className="vv-eje" />
                                <text x={px(t)} y={H - B + 17} className="vv-tick" textAnchor="middle">{t}</text>
                            </g>
                        ))}
                        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="vv-eje" />
                        <text x={(L + W - R) / 2} y={H - 6} className="vv-tick vv-ttl" textAnchor="middle">Volumen entregado mar–sep (hm³)</text>
                        <text x={L - 30} y={T - 10} className="vv-tick vv-ttl" textAnchor="start">NDVI medio</text>

                        {recta && <line {...recta} className={rel.firme ? 'vv-recta firme' : 'vv-recta'} />}
                        {a && refY != null && (
                            <g className="vv-brecha" aria-hidden="true">
                                <line x1={px(a.volumenHm3)} x2={px(a.volumenHm3)} y1={py(a.ndviMedio)} y2={refY} />
                                <line x1={px(a.volumenHm3) - 6} x2={px(a.volumenHm3) + 6} y1={refY} y2={refY} className="ref" />
                            </g>
                        )}

                        {marcas.map((m, i) => {
                            const et = rotulos.get(m.clave) ?? { x: m.x + 12, y: m.y + 4.5, anchor: 'start' as const };
                            return (
                                <g key={m.clave} ref={el => { refs.current[m.clave] = el; }} className={`vv-pto${m.actual ? ' actual' : ''}${foco === m.clave ? ' on' : ''}`}
                                    tabIndex={i === 0 ? 0 : -1} role="img" aria-label={m.texto}
                                    onPointerEnter={e => { if (e.pointerType === 'mouse' && !descartadoConRaton.current) setFoco(m.clave); }} onPointerLeave={e => { if (e.pointerType === 'mouse') { descartadoConRaton.current = false; setFoco(null); } }}
                                    onFocus={() => { if (!sinReabrir.current) { descartadoConRaton.current = false; setFoco(m.clave); } }} onBlur={() => setFoco(f => (f === m.clave ? null : f))}
                                    onClick={() => setFoco(m.clave)} onKeyDown={e => mover(e, i)}>
                                    <circle cx={m.x} cy={m.y} r="19" className="vv-hit" />
                                    {m.atipico && <circle cx={m.x} cy={m.y} r="11.5" className="vv-aro" />}
                                    <g transform={`translate(${m.x} ${m.y})`}>
                                        {m.actual ? <path d={trazoSimbolo('diamond', 7)} className="vv-rombo" /> : <path d={trazoSimbolo(forma, 6)} className="vv-forma" />}
                                    </g>
                                    <text x={et.x} y={et.y} textAnchor={et.anchor} className={m.actual ? 'vv-anio actual' : 'vv-anio'}>
                                        {m.actual ? `${m.anio} · provisional` : m.anio}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                ) : (
                    <p className="vv-vacio">S/D: sin años con volumen y NDVI para dibujar este módulo.</p>
                )}
                {enfocada && ejeX && (
                    <div className="vv-tip" role="presentation" style={{ left: `${Math.min(72, Math.max(28, (enfocada.x / W) * 100))}%`, top: `${(enfocada.y / H) * 100}%` }}>
                        <b>{enfocada.actual ? `${enfocada.anio} · provisional` : enfocada.anio}</b>
                        <span>{enfocada.vol.toFixed(1)} hm³ · NDVI {enfocada.ndvi.toFixed(3)}</span>
                        {enfocada.atipico && <span className="aviso">⚠ captura atípica en el informe fuente</span>}
                        {enfocada.actual && <span className="aviso">Otra fuente, fuera del ajuste{rel.actual?.volumenIncompleto ? '; volumen incompleto' : ''}</span>}
                    </div>
                )}
            </div>
            <p className="vv-frase">{fraseRelacion(rel)}{rel.por10Hm3 != null && rel.estado === 'acompaña' ? ` Cada +10 hm³ ≈ ${sg(rel.por10Hm3, 3)} de NDVI (indicativo).` : ''}</p>
            <p className={`vv-frase vv-frase-act${a && a.desviacion != null && a.desviacion <= -UMBRAL_SIN_CAMBIO ? ' baja' : ''}`}>{fraseActual(rel)}</p>
        </figure>
    );
};

const posicion = (v: number, todos: number[]) => 1 + todos.filter(x => x > v).length;

/** Panel «Más agua, más vegetación»: seis cuadros con la misma escala de NDVI + tabla simplificada del módulo elegido. */
export const VolumenVegetacion: React.FC<{
    ndvi: FilaNdviV2[]; supVol: FilaSupVol[]; volumenActual: VolumenActual | null; cargandoVolumen: boolean;
    modulo: number; onElegir: (m: number) => void; aniosTabla: number[];
}> = ({ ndvi, supVol, volumenActual, cargandoVolumen, modulo, onElegir, aniosTabla }) => {
    const rels = useMemo(() => MODULOS.map(m => relacionVolumenNdvi(ndvi, supVol, volumenActual, m)), [ndvi, supVol, volumenActual]);
    const ejeY = useMemo(() => {
        const vals = rels.flatMap(r => [...r.puntos.map(p => p.ndviMedio), ...(r.actual ? [r.actual.ndviMedio] : [])]);
        if (!vals.length) return { min: 0, max: 0.6, ticks: [0, 0.2, 0.4, 0.6] };
        const min = Math.floor(Math.min(...vals) * 10 - 0.0001) / 10, max = Math.ceil(Math.max(...vals) * 10 + 0.0001) / 10;
        const ticks: number[] = [];
        for (let t = min; t <= max + 1e-9; t += 0.1) ticks.push(Number(t.toFixed(1)));
        return { min, max, ticks };
    }, [rels]);
    const relSel = rels.find(r => r.modulo === modulo) ?? rels[0];
    const errorVol = volumenActual?.error ?? null;
    const parcial = !!volumenActual && !errorVol && (volumenActual.mesesParciales.length > 0 || rels.some(r => r.actual?.volumenIncompleto));

    const filas = useMemo(() => aniosTabla.map(anio => {
        const c = cruceAnual(ndvi, supVol, modulo, anio);
        const punto = relSel.puntos.find(p => p.anio === anio) ?? null;
        let lectura: React.ReactNode;
        if (anio === ANIO_ACTUAL) lectura = relSel.actual ? fraseActual(relSel).replace(/^\d{4}: /, '') : (relSel.motivoSinActual ?? 'Sin dato (S/D).');
        else if (!punto) lectura = c.volumenHm3 == null ? 'Sin informe ACUM_INF' : c.mediaNdvi == null ? 'Sin NDVI (la serie de satélite inicia en 2021)' : 'Temporada de NDVI incompleta: fuera del ajuste';
        else if (relSel.estado === 'acompaña' && relSel.pendiente != null && relSel.intercepto != null) {
            const d = punto.ndviMedio - (relSel.intercepto + relSel.pendiente * punto.volumenHm3);
            lectura = Math.abs(d) < UMBRAL_SIN_CAMBIO / 2 ? 'En la recta' : `${sg(d, 3)} ${d > 0 ? 'sobre' : 'bajo'} la recta`;
        } else {
            lectura = `Volumen ${posicion(punto.volumenHm3, relSel.puntos.map(p => p.volumenHm3))}.º · NDVI ${posicion(punto.ndviMedio, relSel.puntos.map(p => p.ndviMedio))}.º de ${relSel.n}`;
        }
        return { anio, c, punto, lectura, atipico: !!punto?.atipico || c.atipicos > 0 };
    }), [aniosTabla, ndvi, supVol, modulo, relSel]);

    return (
        <div className="vv">
            <h4 className="vv-titulo">Más agua, más vegetación</h4>
            <p className="vv-lectura">{lecturaGeneral(rels)}</p>
            {cargandoVolumen && <p className="ndvi-nota" role="status">Cargando el volumen provisional de {ANIO_ACTUAL}…</p>}
            {errorVol && <p className="vv-error" role="alert">No se pudo leer el volumen {ANIO_ACTUAL} de la hoja SRL ({errorVol}). Se dibujan solo los años con informe; el punto {ANIO_ACTUAL} queda sin dato (S/D), no en cero.</p>}
            {parcial && <p className="vv-error" role="status">El volumen provisional de {ANIO_ACTUAL} está incompleto en algún mes (parcial o faltante): su punto no es comparable con un año entero.</p>}

            <ul className="vv-clave" aria-label="Cómo leer los cuadros">
                <li><svg viewBox="-9 -9 18 18" aria-hidden="true"><circle r="5" className="vv-forma" /></svg>Año con informe (la forma de cada módulo es su identidad)</li>
                <li><svg viewBox="-10 -10 20 20" aria-hidden="true"><path d={trazoSimbolo('diamond', 6)} className="vv-rombo" /></svg>{ANIO_ACTUAL}: volumen provisional (hoja SRL), fuera del ajuste</li>
                <li><svg viewBox="-10 -10 20 20" aria-hidden="true"><circle r="4" className="vv-forma" /><circle r="8" className="vv-aro" /></svg>⚠ Captura atípica en el informe fuente</li>
                <li><svg viewBox="0 0 28 12" aria-hidden="true"><line x1="1" x2="27" y1="6" y2="6" className="vv-recta" /></svg>Recta indicativa <span className="vv-sep">·</span> <svg viewBox="0 0 28 12" aria-hidden="true"><line x1="1" x2="27" y1="6" y2="6" className="vv-recta firme" /></svg>firme</li>
            </ul>

            <div className="vv-rejilla" role="group" aria-label="Los seis módulos con la misma escala de NDVI">
                {rels.map(r => <Cuadro key={r.modulo} rel={r} activo={r.modulo === modulo} onElegir={() => onElegir(r.modulo)} ejeY={ejeY} />)}
            </div>
            <p className="ndvi-nota">Todos los cuadros comparten la escala vertical de NDVI ({ejeY.ticks[0].toFixed(1)} a {ejeY.ticks[ejeY.ticks.length - 1].toFixed(1)}); el eje de volumen es propio de cada módulo porque sus rangos son muy distintos. Una recta se llama «firme» solo si supera el R² crítico al 5 % para el número de años; con 4 años eso exige R² ≥ 0.90.</p>

            <div className="ndvi-ia-tabla-wrap" tabIndex={0} role="region" aria-label={`Superficie, volumen y vegetación por año, Módulo ${modulo}`}>
                <table className="ndvi-ia-tabla vv-tabla">
                    <caption>Módulo {modulo}, año por año</caption>
                    <thead><tr><th scope="col">Año</th><th scope="col">Superficie (ha)</th><th scope="col">Volumen (hm³)</th><th scope="col">NDVI medio</th><th scope="col">Lectura</th></tr></thead>
                    <tbody>
                        {filas.map(({ anio, c, punto, lectura, atipico }) => {
                            const actual = anio === ANIO_ACTUAL;
                            const vol = actual ? relSel.actual?.volumenHm3 ?? null : c.volumenHm3;
                            const ndviMedio = actual ? relSel.actual?.ndviMedio ?? c.mediaNdvi : punto?.ndviMedio ?? c.mediaNdvi;
                            const sd = <span className="ndvi-ia-sd">S/D</span>;
                            return (
                                <tr key={anio}>
                                    <th scope="row">{anio}</th>
                                    <td>{c.superficieHa != null && !actual ? fmtMiles(c.superficieHa, 0) : sd}</td>
                                    <td>{vol != null ? <>{fmt(vol, 1)}{actual && <span className="vv-prov"> provisional</span>}</> : sd}</td>
                                    <td>{ndviMedio != null ? fmt(ndviMedio, 3) : sd}</td>
                                    <td className="vv-lect">{lectura}{atipico && <span className="vv-warn"> ⚠ captura atípica en el informe fuente</span>}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="ndvi-nota vv-comparabilidad">
                <b>Cómo leerlo.</b> Es una comparación descriptiva entre años, no una relación de causa y efecto: la superficie sembrada explica buena parte del volumen
                (más agua suele ir con más hectáreas) y no se puede separar de él. El NDVI es el de la frontera completa del módulo (incluye caminos, canales y suelo sin riego).
                Los años 2021–2024 salen del informe ACUM_INF de septiembre; {ANIO_ACTUAL} sale de la hoja SRL, provisional, y ambas fuentes no están conciliadas.
                No hay informe de 2025 ni NDVI de 2020: se muestran como S/D, no como cero.
            </p>
        </div>
    );
};

export default VolumenVegetacion;
