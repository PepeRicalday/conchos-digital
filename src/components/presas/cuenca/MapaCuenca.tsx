import { useMemo } from 'react';
import { anilloAPath, proyectorCuenca, SALIDA_CUENCA, type ContornoCuenca } from '../../../utils/geoCuenca';
import { MODULOS_SRL, PRESAS } from '../../../utils/geoDistrito';
import type { CapasCuenca } from '../../../hooks/useCapasCuenca';
import { capasSvg } from '../../../utils/capasCuenca';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { cuandoVentana, mmPropio, valorObs, type PuntoPropio, type PuntoRedJcas, type VentanaObs } from '../../../utils/jcasModelo';

interface Props {
    contorno: ContornoCuenca;
    puntos: PuntoRedJcas[];
    seleccionada: number | null;
    onSelect: (id: number) => void;
    ventana: VentanaObs;
    /** Estaciones propias (WeatherLink): cuadrado con su lluvia; los nombres van en la tabla (en el Distrito quedan muy juntas). */
    propias?: PuntoPropio[];
    /** Capas de referencia activas (el mismo estado que los planos). */
    capas?: CapasCuenca;
}

const W = 500; // ≈ tamaño de pantalla de escritorio: el texto del mapa queda cerca de 12 px
const mmDe = (p: PuntoRedJcas, v: VentanaObs) => valorObs(p, 'lluvia', v);
const mediana = (v: number[]) => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** Estaciones de una misma ciudad (p. ej. 4 en Chihuahua) = un solo marcador con la mediana: así no se encima el texto. */
function colapsaMarcas(puntos: PuntoRedJcas[], v: VentanaObs): PuntoRedJcas[] {
    const sueltos = puntos.filter((x) => !x.grupo), grupos = new Map<string, PuntoRedJcas[]>();
    for (const x of puntos) if (x.grupo) grupos.set(x.grupo, [...(grupos.get(x.grupo) ?? []), x]);
    for (const [g, ps] of grupos) {
        const ok = ps.filter((x) => mmDe(x, v) != null && !x.sospechosa);
        const m = ok.length ? Math.round(mediana(ok.map((x) => mmDe(x, v) as number)) * 10) / 10 : null;
        const base = ok[0] ?? ps[0];
        sueltos.push({ ...base, id: ps[0].id, nombre: `${g.charAt(0).toUpperCase()}${g.slice(1)} (${ps.length} est.)`, lat: ps.reduce((a, x) => a + x.lat, 0) / ps.length, lon: ps.reduce((a, x) => a + x.lon, 0) / ps.length, mm7: v === 7 ? m : base.mm7, mm30: v === 30 ? m : base.mm30, ayer: { ...base.ayer, mm: v === 1 ? m : base.ayer.mm }, hoy: v === 'hoy' ? { mm: m, temp: null, hum: null, viento: null } : base.hoy, sinPluviometro: ok.length === 0 && ps.every((x) => x.sinPluviometro), sospechosa: false, estado: ps.some((x) => x.estado === 'vigente') ? 'vigente' : base.estado });
    }
    return sueltos;
}

/**
 * Mapa propio (SVG, sin teselas de terceros) de la cuenca del Conchos: contorno oficial INEGI-CONAGUA, distrito, presas y la red JCAS.
 * El estado nunca va solo en color: círculo = con lluvia · círculo punteado = dato atrasado · rombo = sin pluviómetro · círculo con ✕ = pluviómetro
 * excluido por sospechoso. La cifra de lluvia va junto a cada estación y toda la información está también en la tabla de abajo.
 */
export default function MapaCuenca({ contorno, puntos, seleccionada, onSelect, ventana, propias = [], capas }: Props) {
    const g = useMemo(() => {
        const p = proyectorCuenca(contorno.bbox, W);
        return {
            p,
            cuenca: contorno.poligonos.map((poli) => anilloAPath(poli[0], p)).join(' '),
            modulos: Object.entries(MODULOS_SRL).map(([k, anillo]) => ({ k, d: anilloAPath(anillo, p) })),
        };
    }, [contorno]);
    const { p } = g;
    const marcas = useMemo(() => colapsaMarcas(puntos, ventana), [puntos, ventana]);
    // Capas de referencia (los módulos SRL ya se dibujan siempre en este mapa): el SVG sale de capasSvg (texto escapado, datos estáticos propios), recortado a la cuenca
    const capasG = useMemo(() => (capas && capas.ids.some((i) => i !== 'srl') ? capasSvg(capas.datos, capas.ids.filter((i) => i !== 'srl'), p, { px: 12, tema: 'pantalla', ancho: p.ancho, alto: p.alto }) : null), [capas, p]);
    // Anti-solape de rótulos: se colocan de mayor a menor lluvia; cada uno prueba su lado habitual, el opuesto y, si ambos chocan,
    // conserva solo la cifra (el nombre sigue en el título, en la tabla y para lectores de pantalla).
    const rotulos = useMemo(() => {
        const cajas: { x0: number; x1: number; y0: number; y1: number }[] = [];
        const choca = (c: { x0: number; x1: number; y0: number; y1: number }) => c.x0 < 2 || c.x1 > p.ancho - 2 || cajas.some((o) => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0);
        const m = new Map<number, { alinea: boolean; nombre: boolean }>();
        const orden = [...marcas].sort((a, b) => (mmDe(b, ventana) ?? -1) - (mmDe(a, ventana) ?? -1));
        for (const pt of orden) {
            const x = p.x(pt.lon), y = p.y(pt.lat), mm = mmDe(pt, ventana);
            const r = mm == null ? 7 : 7 + 9 * Math.sqrt(Math.min(mm, 150) / 150);
            const pref = pt.lon > contorno.bbox.maxLon - (contorno.bbox.maxLon - contorno.bbox.minLon) * 0.22;
            const wN = pt.nombre.length * 6.6 + 4, wM = 40;
            const caja = (alinea: boolean, nombre: boolean) => {
                const w = nombre ? Math.max(wN, wM) : wM;
                const x0 = alinea ? x - r - 4 - w : x + r + 4;
                return { x0, x1: x0 + w, y0: y - r + (nombre ? -9 : 5), y1: y - r + 19 };
            };
            const opciones: [boolean, boolean][] = [[pref, true], [!pref, true], [pref, false], [!pref, false]];
            const ok = opciones.find(([a, n]) => !choca(caja(a, n))) ?? opciones[2];
            cajas.push(caja(ok[0], ok[1]));
            m.set(pt.id, { alinea: ok[0], nombre: ok[1] });
        }
        return m;
    }, [marcas, ventana, p, contorno]);
    const salida = { x: p.x(SALIDA_CUENCA.lon), y: p.y(SALIDA_CUENCA.lat) };

    return (
        <figure className="cu-mapa" aria-label="Mapa de la cuenca del Conchos con las estaciones JCAS">
            <svg viewBox={`0 0 ${p.ancho} ${p.alto}`} className="cu-mapa-svg" role="group" aria-label={`Estaciones JCAS y propias en la cuenca, lluvia ${cuandoVentana(ventana)}`}>
                <defs><clipPath id="cu-mapa-cl"><path d={g.cuenca} /></clipPath></defs>
                <path d={g.cuenca} className="cu-mapa-cuenca" />
                {capasG && <g clipPath="url(#cu-mapa-cl)" aria-hidden="true" dangerouslySetInnerHTML={{ __html: capasG.bajo }} />}
                {capasG && <g aria-hidden="true" dangerouslySetInnerHTML={{ __html: capasG.alto }} />}
                {g.modulos.map((m) => <path key={m.k} d={m.d} className="cu-mapa-modulo"><title>{`Módulo ${m.k} · SRL Conchos`}</title></path>)}
                {PRESAS.map((pr) => (
                    <g key={pr.nombre} transform={`translate(${p.x(pr.lon).toFixed(1)} ${p.y(pr.lat).toFixed(1)})`}>
                        <path d="M0,-7 L7,6 L-7,6 Z" className="cu-mapa-presa"><title>{pr.nombre}</title></path>
                    </g>
                ))}
                <g transform={`translate(${salida.x.toFixed(1)} ${salida.y.toFixed(1)})`} aria-hidden="true">
                    <path d="M-14,16 L0,30 L14,16" className="cu-mapa-flecha" />
                    <text x={14} y={46} textAnchor="end" className="cu-mapa-txt cu-mapa-txt--salida">Salida · Ojinaga</text>
                </g>
                {/* Propias primero: los rótulos de JCAS (con halo) quedan encima y siguen legibles donde se juntan */}
                {propias.map((pp) => {
                    const x = p.x(pp.lon), y = p.y(pp.lat), mm = mmPropio(pp, ventana);
                    const etiqueta = `${pp.nombre} (estación propia): ${mm == null ? 'lluvia S/D' : `${mm.toFixed(1)} mm ${cuandoVentana(ventana)}`}`;
                    const alfa = mm == null ? 0.08 : 0.3 + 0.6 * Math.min(mm / 120, 1);
                    return (
                        <g key={pp.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} role="img" aria-label={etiqueta}>
                            <title>{etiqueta}</title>
                            <rect x={-6} y={-6} width={12} height={12} rx={2} className={`cu-prop-c${mm == null ? ' cu-prop-c--sd' : ''}`} style={{ fill: `rgba(94,196,138,${alfa})` }} />
                            <text x={9} y={4} className="cu-mapa-txt cu-mapa-txt--mm cu-mapa-txt--prop">{fmtLluvia(mm)}</text>
                        </g>
                    );
                })}
                {marcas.map((pt) => {
                    const x = p.x(pt.lon), y = p.y(pt.lat), mm = mmDe(pt, ventana);
                    const sel = pt.id === seleccionada;
                    const r = mm == null ? 7 : 7 + 9 * Math.sqrt(Math.min(mm, 150) / 150);
                    const alfa = mm == null ? 0.08 : 0.28 + 0.6 * Math.min(mm / 120, 1);
                    const etiqueta = `${pt.nombre}: ${mm == null ? 'lluvia S/D' : `${mm.toFixed(1)} mm ${cuandoVentana(ventana)}`}${pt.sospechosa ? ', pluviómetro excluido por sospechoso' : ''}${pt.estado === 'atrasada' ? ', dato atrasado' : ''}${pt.sinPluviometro ? ', sin pluviómetro' : ''}`;
                    const rot = rotulos.get(pt.id) ?? { alinea: false, nombre: true };
                    const alinea = rot.alinea;
                    return (
                        <g key={pt.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} className={`cu-est${sel ? ' cu-est--sel' : ''}`}
                            role="button" tabIndex={0} aria-label={etiqueta} aria-pressed={sel}
                            onClick={() => onSelect(pt.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(pt.id); } }}>
                            <title>{etiqueta}</title>
                            <circle r={20} className="cu-est-zona" />
                            {pt.sinPluviometro
                                ? <path d="M0,-9 L9,0 L0,9 L-9,0 Z" className="cu-est-rombo" />
                                : <circle r={r} className={`cu-est-c${pt.estado !== 'vigente' ? ' cu-est-c--atras' : ''}${pt.sospechosa ? ' cu-est-c--sosp' : ''}`} style={{ fill: `rgba(63,178,243,${alfa})` }} />}
                            {pt.sospechosa && <path d="M-5,-5 L5,5 M5,-5 L-5,5" className="cu-est-x" />}
                            {rot.nombre && <text x={alinea ? -r - 4 : r + 4} y={-r + 2} textAnchor={alinea ? 'end' : 'start'} className="cu-mapa-txt">{pt.nombre}</text>}
                            <text x={alinea ? -r - 4 : r + 4} y={-r + 16} textAnchor={alinea ? 'end' : 'start'} className="cu-mapa-txt cu-mapa-txt--mm">{mm == null ? 'S/D' : `${fmtLluvia(mm)} mm`}</text>
                        </g>
                    );
                })}
            </svg>
            <figcaption className="cu-leyenda-viz">
                <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" className="cu-est-c" style={{ fill: 'rgba(63,178,243,0.6)' }} /></svg> con lluvia (más grande = más mm)</span>
                <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" className="cu-est-c cu-est-c--atras" style={{ fill: 'rgba(63,178,243,0.1)' }} /></svg> dato atrasado o S/D</span>
                <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0,-6 L6,0 L0,6 L-6,0 Z" className="cu-est-rombo" /></svg> sin pluviómetro</span>
                <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" className="cu-est-c cu-est-c--sosp" style={{ fill: 'none' }} /><path d="M-4,-4 L4,4 M4,-4 L-4,4" className="cu-est-x" /></svg> excluida (sospechosa)</span>
                <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0,-6 L6,5 L-6,5 Z" className="cu-mapa-presa" /></svg> presa del distrito</span>
                {propias.length > 0 && <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><rect x="-6" y="-6" width="12" height="12" rx="2" className="cu-prop-c" style={{ fill: 'rgba(94,196,138,0.6)' }} /></svg> estación propia (mm)</span>}
            </figcaption>
        </figure>
    );
}
