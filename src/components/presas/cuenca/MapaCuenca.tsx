import { useMemo } from 'react';
import { anilloAPath, proyectorCuenca, SALIDA_CUENCA, type ContornoCuenca } from '../../../utils/geoCuenca';
import { MODULOS_SRL, PRESAS } from '../../../utils/geoDistrito';
import type { CapasCuenca } from '../../../hooks/useCapasCuenca';
import { capasSvg } from '../../../utils/capasCuenca';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { mediana } from '../../../utils/jcasCuenca';
import { cuandoVentana, esVentanaLarga, mmPropio, valorObs, type PuntoPropio, type PuntoRedJcas, type VariableObs, type VentanaObs } from '../../../utils/jcasModelo';
import { ubicacionUnifrut, type ModeloUnifrut } from '../../../utils/unifrutModelo';
import { fmtValorEstacion, FUENTES_TODAS, infoVariable, valorUnifrutVariable, type FuenteEstacion } from '../../../utils/estacionesClima';

interface Props {
    contorno: ContornoCuenca;
    puntos: PuntoRedJcas[];
    seleccionada: number | null;
    onSelect: (id: number) => void;
    ventana: VentanaObs;
    /** Estaciones propias (WeatherLink): cuadrado con su valor; los nombres van en la tabla (en el Distrito quedan muy juntas). */
    propias?: PuntoPropio[];
    /** Capas de referencia activas (el mismo estado que los planos). */
    capas?: CapasCuenca;
    /** Red regional Unifrut (FUERA del contorno): hexágono violeta solo para las que reportan; no entra a ningún promedio de la cuenca. */
    regionales?: ModeloUnifrut | null;
    /** Variable que se dibuja (lluvia por defecto) y fuentes visibles (todas por defecto). */
    variable?: VariableObs;
    fuentes?: FuenteEstacion[];
}

const HEX = 'M0,-8 L7,-4 L7,4 L0,8 L-7,4 L-7,-4 Z';
const W = 500; // ≈ tamaño de pantalla de escritorio: el texto del mapa queda cerca de 12 px

/** Marca de una estación JCAS: si es un grupo (varias de una ciudad), `_v` trae la mediana ya calculada para la variable y ventana activas. */
type Marca = PuntoRedJcas & { _v?: number | null };

/** Estaciones de una misma ciudad (p. ej. 4 en Chihuahua) = un solo marcador con la mediana: así no se encima el texto. */
function colapsaMarcas(puntos: PuntoRedJcas[], v: VentanaObs, variable: VariableObs): Marca[] {
    const val = (x: PuntoRedJcas) => valorObs(x, variable, v);
    // Solo la lluvia excluye al pluviómetro sospechoso: su temperatura, humedad y viento siguen valiendo
    const util = (x: PuntoRedJcas) => val(x) != null && (variable !== 'lluvia' || !x.sospechosa);
    const sueltos: Marca[] = puntos.filter((x) => !x.grupo), grupos = new Map<string, PuntoRedJcas[]>();
    for (const x of puntos) if (x.grupo) grupos.set(x.grupo, [...(grupos.get(x.grupo) ?? []), x]);
    for (const [g, ps] of grupos) {
        const ok = ps.filter(util);
        const m = ok.length ? Math.round(mediana(ok.map((x) => val(x) as number)) * 10) / 10 : null;
        const base = ok[0] ?? ps[0];
        sueltos.push({ ...base, id: ps[0].id, nombre: `${g.charAt(0).toUpperCase()}${g.slice(1)} (${ps.length} est.)`, lat: ps.reduce((a, x) => a + x.lat, 0) / ps.length, lon: ps.reduce((a, x) => a + x.lon, 0) / ps.length, mm7: v === 7 ? m : base.mm7, mm30: v === 30 ? m : base.mm30,
            largas: esVentanaLarga(v) ? { ...base.largas, [String(v)]: { mm: m, temp: null, hum: null, viento: null } } : base.largas, ayer: { ...base.ayer, mm: v === 1 ? m : base.ayer.mm }, hoy: v === 'hoy' ? { mm: m, temp: null, hum: null, viento: null } : base.hoy, sinPluviometro: ok.length === 0 && ps.every((x) => x.sinPluviometro), sospechosa: false, estado: ps.some((x) => x.estado === 'vigente') ? 'vigente' : base.estado, _v: m });
    }
    return sueltos;
}

/**
 * Mapa propio (SVG, sin teselas de terceros) de la cuenca del Conchos: contorno oficial INEGI-CONAGUA, distrito, presas y las estaciones
 * (JCAS, propias y Unifrut), con la variable y las fuentes que se elijan (lluvia y todas por defecto).
 * El estado nunca va solo en color: círculo = JCAS · cuadrado = propia · hexágono = Unifrut · punteado = dato atrasado · rombo = sin pluviómetro
 * (solo en lluvia) · círculo con ✕ = pluviómetro excluido por sospechoso. El valor va junto a cada estación y toda la información está en la tabla.
 */
export default function MapaCuenca({ contorno, puntos, seleccionada, onSelect, ventana, propias = [], capas, regionales = null, variable = 'lluvia', fuentes = FUENTES_TODAS }: Props) {
    const g = useMemo(() => {
        const p = proyectorCuenca(contorno.bbox, W);
        return {
            p,
            cuenca: contorno.poligonos.map((poli) => anilloAPath(poli[0], p)).join(' '),
            modulos: Object.entries(MODULOS_SRL).map(([k, anillo]) => ({ k, d: anilloAPath(anillo, p) })),
        };
    }, [contorno]);
    const { p } = g;
    const esLluvia = variable === 'lluvia';
    const info = infoVariable(variable);
    const verJcas = fuentes.includes('jcas'), verPropias = fuentes.includes('propia'), verUnifrut = fuentes.includes('unifrut');
    const marcas = useMemo(() => (verJcas ? colapsaMarcas(puntos, ventana, variable) : []), [puntos, ventana, variable, verJcas]);
    const valJ = (pt: Marca): number | null => (pt._v !== undefined ? pt._v : valorObs(pt, variable, ventana));
    const valP = (pp: PuntoPropio): number | null => (esLluvia ? mmPropio(pp, ventana) : valorObs(pp, variable, ventana));
    const unif = useMemo(() => (verUnifrut ? (regionales?.puntos ?? []).filter((u) => u.estado === 'vigente' || u.estado === 'atrasada') : []), [regionales, verUnifrut]);
    const valU = (u: (typeof unif)[number]): number | null => valorUnifrutVariable(u, variable, ventana, regionales?.fin ?? null);
    const propiasVis = verPropias ? propias : [];

    // Escala de la variable: en lluvia, tamaño por mm (como siempre); en las demás, tamaño fijo y color más intenso = valor mayor dentro de lo visible.
    const [vMin, vMax] = useMemo(() => {
        const vs = [...marcas.map(valJ), ...propiasVis.map(valP), ...unif.map(valU)].filter((x): x is number => x != null);
        return vs.length ? [Math.min(...vs), Math.max(...vs)] : [0, 0];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marcas, propiasVis, unif, variable, ventana]);
    const alfaDe = (v: number | null, base: number) => (v == null ? 0.08 : esLluvia ? base + 0.6 * Math.min(v / 120, 1) : base + 0.6 * (vMax > vMin ? (v - vMin) / (vMax - vMin) : 0.5));
    const radioDe = (v: number | null) => (v == null ? 7 : esLluvia ? 7 + 9 * Math.sqrt(Math.min(v, 150) / 150) : 9);
    const rotuloV = (v: number | null) => (v == null ? 'S/D' : esLluvia ? `${fmtLluvia(v)} mm` : fmtValorEstacion(variable, v));
    const cuando = cuandoVentana(ventana);
    const dice = (v: number | null) => (v == null ? `${info.etiqueta.toLowerCase()} S/D` : `${esLluvia ? v.toFixed(1) + ' mm' : fmtValorEstacion(variable, v)} ${cuando}`);

    // Capas de referencia (los módulos SRL ya se dibujan siempre en este mapa): el SVG sale de capasSvg (texto escapado, datos estáticos propios), recortado a la cuenca
    const capasG = useMemo(() => (capas && capas.ids.some((i) => i !== 'srl') ? capasSvg(capas.datos, capas.ids.filter((i) => i !== 'srl'), p, { px: 12, tema: 'pantalla', ancho: p.ancho, alto: p.alto }) : null), [capas, p]);
    // Anti-solape de rótulos: se colocan de mayor a menor valor; cada uno prueba su lado habitual, el opuesto y, si ambos chocan,
    // conserva solo la cifra (el nombre sigue en el título, en la tabla y para lectores de pantalla).
    const rotulos = useMemo(() => {
        const cajas: { x0: number; x1: number; y0: number; y1: number }[] = [];
        const choca = (c: { x0: number; x1: number; y0: number; y1: number }) => c.x0 < 2 || c.x1 > p.ancho - 2 || cajas.some((o) => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0);
        const m = new Map<number, { alinea: boolean; nombre: boolean }>();
        const orden = [...marcas].sort((a, b) => (valJ(b) ?? -1e9) - (valJ(a) ?? -1e9));
        for (const pt of orden) {
            const x = p.x(pt.lon), y = p.y(pt.lat), mm = valJ(pt);
            const r = radioDe(mm);
            const pref = pt.lon > contorno.bbox.maxLon - (contorno.bbox.maxLon - contorno.bbox.minLon) * 0.22;
            const wN = pt.nombre.length * 6.6 + 4, wM = esLluvia ? 40 : 58;
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marcas, ventana, variable, p, contorno]);
    const salida = { x: p.x(SALIDA_CUENCA.lon), y: p.y(SALIDA_CUENCA.lat) };
    const nombresFuentes = [verJcas ? 'JCAS' : null, verPropias ? 'propias' : null, verUnifrut ? 'Unifrut' : null].filter(Boolean).join(', ') || 'ninguna fuente';

    return (
        <figure className="cu-mapa" aria-label="Mapa de la cuenca del Conchos con las estaciones">
            <svg viewBox={`0 0 ${p.ancho} ${p.alto}`} className="cu-mapa-svg" role="group" aria-label={`Estaciones (${nombresFuentes}) en la cuenca, ${info.etiqueta.toLowerCase()} ${cuando}`}>
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
                {/* Unifrut (regional, fuera del contorno): debajo de todo lo demás; solo las que reportan (vigentes o atrasadas) */}
                {unif.map((u) => {
                    const x = p.x(u.lon), y = p.y(u.lat), mm = valU(u);
                    const etiqueta = `${u.nombre} (Unifrut, ${ubicacionUnifrut(u)}): ${dice(mm)}${u.estado === 'atrasada' ? `, dato atrasado ${u.atrasoDias} d` : ''}`;
                    return (
                        <g key={`u-${u.id}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} role="img" aria-label={etiqueta}>
                            <title>{etiqueta}</title>
                            <path d={HEX} className={`cu-unif-c${u.estado === 'atrasada' || mm == null ? ' cu-unif-c--sd' : ''}`} style={{ fill: `rgba(167,139,250,${alfaDe(mm, 0.3)})` }} />
                            {mm != null && <text x={11} y={4} className="cu-mapa-txt cu-mapa-txt--mm cu-mapa-txt--unif">{esLluvia ? fmtLluvia(mm) : fmtValorEstacion(variable, mm)}</text>}
                        </g>
                    );
                })}
                {/* Propias primero: los rótulos de JCAS (con halo) quedan encima y siguen legibles donde se juntan */}
                {propiasVis.map((pp) => {
                    const x = p.x(pp.lon), y = p.y(pp.lat), mm = valP(pp);
                    const etiqueta = `${pp.nombre} (estación propia): ${dice(mm)}`;
                    return (
                        <g key={pp.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} role="img" aria-label={etiqueta}>
                            <title>{etiqueta}</title>
                            <rect x={-6} y={-6} width={12} height={12} rx={2} className={`cu-prop-c${mm == null ? ' cu-prop-c--sd' : ''}`} style={{ fill: `rgba(94,196,138,${alfaDe(mm, 0.3)})` }} />
                            <text x={9} y={4} className="cu-mapa-txt cu-mapa-txt--mm cu-mapa-txt--prop">{esLluvia ? fmtLluvia(mm) : mm == null ? 'S/D' : fmtValorEstacion(variable, mm)}</text>
                        </g>
                    );
                })}
                {marcas.map((pt) => {
                    const x = p.x(pt.lon), y = p.y(pt.lat), mm = valJ(pt);
                    const sel = pt.id === seleccionada;
                    const r = radioDe(mm);
                    const sospechosa = esLluvia && pt.sospechosa, sinPluv = esLluvia && pt.sinPluviometro;
                    const etiqueta = `${pt.nombre}: ${dice(mm)}${sospechosa ? ', pluviómetro excluido por sospechoso' : ''}${pt.estado === 'atrasada' ? ', dato atrasado' : ''}${sinPluv ? ', sin pluviómetro' : ''}`;
                    const rot = rotulos.get(pt.id) ?? { alinea: false, nombre: true };
                    const alinea = rot.alinea;
                    return (
                        <g key={pt.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} className={`cu-est${sel ? ' cu-est--sel' : ''}`}
                            role="button" tabIndex={0} aria-label={etiqueta} aria-pressed={sel}
                            onClick={() => onSelect(pt.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(pt.id); } }}>
                            <title>{etiqueta}</title>
                            <circle r={20} className="cu-est-zona" />
                            {sinPluv
                                ? <path d="M0,-9 L9,0 L0,9 L-9,0 Z" className="cu-est-rombo" />
                                : <circle r={r} className={`cu-est-c${pt.estado !== 'vigente' ? ' cu-est-c--atras' : ''}${sospechosa ? ' cu-est-c--sosp' : ''}`} style={{ fill: `rgba(63,178,243,${alfaDe(mm, 0.28)})` }} />}
                            {sospechosa && <path d="M-5,-5 L5,5 M5,-5 L-5,5" className="cu-est-x" />}
                            {rot.nombre && <text x={alinea ? -r - 4 : r + 4} y={-r + 2} textAnchor={alinea ? 'end' : 'start'} className="cu-mapa-txt">{pt.nombre}</text>}
                            <text x={alinea ? -r - 4 : r + 4} y={-r + 16} textAnchor={alinea ? 'end' : 'start'} className="cu-mapa-txt cu-mapa-txt--mm">{rotuloV(mm)}</text>
                        </g>
                    );
                })}
            </svg>
            <figcaption className="cu-leyenda-viz">
                {verJcas && <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" className="cu-est-c" style={{ fill: 'rgba(63,178,243,0.6)' }} /></svg> JCAS · {esLluvia ? 'con lluvia (más grande = más mm)' : `${info.etiqueta.toLowerCase()} (más intenso = mayor)`}</span>}
                {verJcas && <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" className="cu-est-c cu-est-c--atras" style={{ fill: 'rgba(63,178,243,0.1)' }} /></svg> dato atrasado o S/D</span>}
                {verJcas && esLluvia && <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0,-6 L6,0 L0,6 L-6,0 Z" className="cu-est-rombo" /></svg> sin pluviómetro</span>}
                {verJcas && esLluvia && <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><circle r="6" className="cu-est-c cu-est-c--sosp" style={{ fill: 'none' }} /><path d="M-4,-4 L4,4 M4,-4 L-4,4" className="cu-est-x" /></svg> excluida (sospechosa)</span>}
                <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><path d="M0,-6 L6,5 L-6,5 Z" className="cu-mapa-presa" /></svg> presa del distrito</span>
                {propiasVis.length > 0 && <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><rect x="-6" y="-6" width="12" height="12" rx="2" className="cu-prop-c" style={{ fill: 'rgba(94,196,138,0.6)' }} /></svg> estación propia ({info.unidad})</span>}
                {unif.length > 0 && <span><svg width="14" height="14" viewBox="-8 -8 16 16" aria-hidden="true"><path d={HEX} className="cu-unif-c" style={{ fill: 'rgba(167,139,250,0.6)' }} /></svg> Unifrut · regional, fuera de la cuenca (no entra al promedio)</span>}
            </figcaption>
        </figure>
    );
}
