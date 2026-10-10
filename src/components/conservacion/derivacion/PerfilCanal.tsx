import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as TeclaReact, PointerEvent as PunteroReact } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useAnchoReal } from '../../TendenciasCharts';
import { useDevice } from '../../../hooks/useDevice';
import { calcularPerfil, etiquetaKm, ventanaCentrada } from '../../../conservacion/geo/perfilSvg';
import {
    VENTANA_INICIAL_KM, agruparEnCarril, desplazarVentana, etiquetaPk, rotuloFamilia, tramoAdyacente, tramoDeObra, ventanaQueMuestra, ventanaSobreTramo,
    zoomVentana, CLAVES_FAMILIA, TEXTO_ESTADO, TEXTO_UBICACION, type ClaveFamilia, type EjeVista, type ModeloCanal, type ObraVista, type TramoVista,
} from './ubicacionModelo';
import { SimboloG } from './Simbolo';
import './ubicacion-trazo.css';

interface Props {
    modelo: ModeloCanal;
    filaSel: number | null;
    onSeleccionar: (fila: number) => void;
    /** Abre la ventana de ubicación del tramo `fila`; con `obraId`, resaltando esa obra. */
    onAbrirUbicacion: (fila: number, obraId?: string) => void;
    ocultas: ReadonlySet<ClaveFamilia>;
    /** «Solo atípicos» activo: los tramos que cuadran se ven tenues. */
    soloAtipicos: boolean;
}

/* Medidas del dibujo, en px reales (el SVG se dibuja a escala 1:1, así el texto nunca baja de 12 px). */
const MARGEN_IZQ = 40;
const MARGEN_DER = 14;
const BANDA_H = 48;
const LADO_SIMBOLO = 18;
const CARRIL_H = 28;
const SEPARACION_AGRUPAR = 22;
const ANCHO_MINIMO_PHONE = 640;

interface Tip { x: number; y: number; titulo: string; lineas: string[] }
const lineaObra = (o: ObraVista): string => `${o.nombre} · ${etiquetaPk(o.pk)}`;

export function PerfilCanal({ modelo, filaSel, onSeleccionar, onAbrirUbicacion, ocultas, soloAtipicos }: Props) {
    const [anchoRef, w] = useAnchoReal(900);
    const dev = useDevice();
    const pendienteFoco = useRef<number | null>(null);
    const principal = modelo.ejes[0];
    const total = principal?.totalKm ?? 0;
    const ancho = dev.esPhone ? Math.max(w, ANCHO_MINIMO_PHONE) : w;
    const tramoSel = principal?.tramos.find((t) => t.fila === filaSel) ?? null;

    // Ventana del eje principal. Si la selección cambia desde fuera (Anterior, Siguiente, la lista), la ventana la sigue durante el render.
    const [vista, setVista] = useState<{ fila: number | null; v: [number, number] }>(() => ({
        fila: filaSel, v: tramoSel ? ventanaSobreTramo(tramoSel, total) : [0, Math.min(total, VENTANA_INICIAL_KM)],
    }));
    let ventana = vista.v;
    if (vista.fila !== filaSel) {
        ventana = tramoSel ? ventanaQueMuestra(vista.v, tramoSel, total) : vista.v;
        setVista({ fila: filaSel, v: ventana });
    }
    const fijaVentana = (v: [number, number]) => setVista({ fila: filaSel, v });

    useLayoutEffect(() => {
        if (pendienteFoco.current === null) return;
        const el = anchoRef.current?.querySelector<HTMLElement>(`[data-fila="${pendienteFoco.current}"]`);
        if (el) { el.focus({ preventScroll: true }); pendienteFoco.current = null; }
    });

    if (!principal) return null;
    const sinZoom = total <= VENTANA_INICIAL_KM + 0.01;
    const ventanaVisible: [number, number] = sinZoom ? [0, total] : ventana;
    const lleno = ventanaVisible[0] <= 0.001 && ventanaVisible[1] >= total - 0.001;

    const elegir = (t: TramoVista, foco = false) => {
        if (foco) pendienteFoco.current = t.fila;
        onSeleccionar(t.fila);
    };
    const sigue = (eje: EjeVista, d: number, base: number | null) => { const t = tramoAdyacente(eje.tramos, base, d); if (t) elegir(t, true); };
    const centroSel = tramoSel && tramoSel.kmIni >= ventanaVisible[0] && tramoSel.kmFin <= ventanaVisible[1] ? (tramoSel.kmIni + tramoSel.kmFin) / 2 : undefined;
    // Al mover la vista con el teclado, si la banda con el foco sale de ella el foco se perdería: se pasa a la banda más cercana al centro.
    const muevePorTeclado = (nueva: [number, number], teclado: boolean) => {
        fijaVentana(nueva);
        if (!teclado || !tramoSel || (tramoSel.kmIni >= nueva[0] && tramoSel.kmFin <= nueva[1])) return;
        const c = (nueva[0] + nueva[1]) / 2;
        const dentro = principal.tramos.filter((t) => t.kmFin > nueva[0] && t.kmIni < nueva[1]);
        const cerca = dentro.reduce<TramoVista | null>((m, t) => (m === null || Math.abs((t.kmIni + t.kmFin) / 2 - c) < Math.abs((m.kmIni + m.kmFin) / 2 - c) ? t : m), null);
        if (cerca) elegir(cerca, true);
    };

    const onTecla = (e: TeclaReact<HTMLDivElement>) => {
        const obj = e.target as HTMLElement;
        const ejeEl = obj.closest<HTMLElement>('[data-eje]');
        if (!ejeEl) return;
        const eje = modelo.ejes[Number(ejeEl.dataset.eje)];
        if (!eje) return;
        const esPrincipal = eje === principal;
        const fila = obj.dataset.fila ? Number(obj.dataset.fila) : filaSel;
        const paso = (ventanaVisible[1] - ventanaVisible[0]) * (e.shiftKey ? 0.25 : 0.5);
        let manejada = true;
        if (e.key === 'ArrowRight' && !e.shiftKey) sigue(eje, 1, fila);
        else if (e.key === 'ArrowLeft' && !e.shiftKey) sigue(eje, -1, fila);
        else if (esPrincipal && !sinZoom && ((e.key === 'ArrowRight' && e.shiftKey) || e.key === 'PageDown')) muevePorTeclado(desplazarVentana(ventanaVisible, paso, total), true);
        else if (esPrincipal && !sinZoom && ((e.key === 'ArrowLeft' && e.shiftKey) || e.key === 'PageUp')) muevePorTeclado(desplazarVentana(ventanaVisible, -paso, total), true);
        else if (esPrincipal && !sinZoom && (e.key === '+' || e.key === '=')) muevePorTeclado(zoomVentana(ventanaVisible, 1 / 1.5, total, centroSel), true);
        else if (esPrincipal && !sinZoom && (e.key === '-' || e.key === '_')) muevePorTeclado(zoomVentana(ventanaVisible, 1.5, total, centroSel), true);
        else if (e.key === 'Home') { const t = eje.tramos[0]; if (t) elegir(t, true); }
        else if (e.key === 'End') { const t = eje.tramos[eje.tramos.length - 1]; if (t) elegir(t, true); }
        else manejada = false;
        if (manejada) { e.preventDefault(); e.stopPropagation(); }
    };

    const nUbicadas = modelo.nEstructuras + modelo.nEdificios;
    const nSinLugar = modelo.ejes.reduce((s, e) => s + e.fueraDeTramos.length + e.sinPK.length, 0);
    const acercar = () => fijaVentana(zoomVentana(ventanaVisible, 1 / 1.5, total, centroSel));
    const alejar = () => fijaVentana(zoomVentana(ventanaVisible, 1.5, total, centroSel));
    const mover = (f: number) => fijaVentana(desplazarVentana(ventanaVisible, (ventanaVisible[1] - ventanaVisible[0]) * f, total));

    return (
        <div ref={anchoRef} className="pf" onKeyDown={onTecla}
            data-n-tramos={modelo.nTramos} data-n-estructuras={modelo.nEstructuras} data-n-edificios={modelo.nEdificios}>
            <p className="pf-resumen">
                <b>{modelo.nTramos} {modelo.nTramos === 1 ? 'tramo' : 'tramos'}</b>
                {modelo.v4 && modelo.cifrasConfiables && nUbicadas > 0 && <> · {modelo.nEstructuras} estructuras{modelo.nEdificios > 0 ? ` y ${modelo.nEdificios} edificios` : ''} del inventario</>}
                {modelo.v4 && !modelo.cifrasConfiables && <> · estructuras y edificios: cifra no verificada (S/D){modelo.motivoCifras ? ` · ${modelo.motivoCifras}` : ''}</>}
                {modelo.nEstimadas > 0 && <> · {modelo.nEstimadas} con ubicación estimada</>}
                {nSinLugar > 0 && <> · {nSinLugar} sin lugar en el perfil (fuera de los tramos o sin cadenamiento)</>}
            </p>
            {modelo.avisos.length > 0 && <p className="sc-aviso" role="note"><span>{modelo.avisos.join(' ')}</span></p>}
            {modelo.cifrasConfiables && modelo.edificiosAparte.length > 0 && (
                <details className="cons-aparte">
                    <summary>{modelo.edificiosAparte.length} {modelo.edificiosAparte.length === 1 ? 'edificio' : 'edificios'} del sitio (IO7): no pertenecen a un canal</summary>
                    <ul>{modelo.edificiosAparte.map((b) => <li key={b.id}><b>{b.nombre}</b> <small>{b.pkTexto ?? 'sin ubicación escrita (S/D)'}</small></li>)}</ul>
                </details>
            )}

            {!sinZoom && (
                <div className="pf-herr" role="toolbar" aria-label="Ver una parte del canal">
                    <button type="button" className="sc-btn" onClick={() => mover(-0.5)} disabled={ventanaVisible[0] <= 0.001} aria-label="Desplazar la vista hacia el inicio del canal"><ChevronLeft size={18} aria-hidden="true" /></button>
                    <button type="button" className="sc-btn" onClick={() => mover(0.5)} disabled={ventanaVisible[1] >= total - 0.001} aria-label="Desplazar la vista hacia el final del canal"><ChevronRight size={18} aria-hidden="true" /></button>
                    <button type="button" className="sc-btn" onClick={acercar} disabled={ventanaVisible[1] - ventanaVisible[0] <= 2.001} aria-label="Acercar"><ZoomIn size={18} aria-hidden="true" /></button>
                    <button type="button" className="sc-btn" onClick={alejar} disabled={lleno} aria-label="Alejar"><ZoomOut size={18} aria-hidden="true" /></button>
                    <button type="button" className="sc-btn" onClick={() => fijaVentana([0, total])} disabled={lleno}><Maximize2 size={16} aria-hidden="true" /> Todo el canal</button>
                    <span className="pf-rango" role="status">{etiquetaKm(ventanaVisible[0])} a {etiquetaKm(ventanaVisible[1])}</span>
                </div>
            )}

            <div className={`pf-scroll${dev.esPhone ? ' pf-scroll-phone' : ''}`} tabIndex={dev.esPhone ? 0 : undefined} role={dev.esPhone ? 'region' : undefined} aria-label={dev.esPhone ? 'Perfil del canal, se desplaza horizontalmente' : undefined}>
                {modelo.ejes.map((eje, i) => (
                    <PistaEje key={eje.clave} indice={i} eje={eje} modelo={modelo} ancho={ancho} ventana={i === 0 ? ventanaVisible : [0, eje.totalKm]}
                        zoomable={i === 0 && !sinZoom} filaSel={filaSel} soloAtipicos={soloAtipicos} ocultas={ocultas} esPhone={dev.esPhone}
                        onElegir={elegir} onAbrir={onAbrirUbicacion} onVentana={fijaVentana} />
                ))}
            </div>

            {!sinZoom && <Minimapa eje={principal} ancho={Math.min(ancho, w)} ventana={ventanaVisible} onCentrar={(km) => fijaVentana(ventanaCentrada(km, ventanaVisible[1] - ventanaVisible[0], total))} />}
            <p className="pf-ayuda">
                Con el foco en una banda: ← → cambian de tramo, Intro abre la ubicación{sinZoom ? '' : ', Mayús+← → mueven la vista y + − acercan o alejan'}. También con doble clic.
                {nUbicadas > 0 && ' Las estructuras se recorren con el inventario del tramo, debajo.'}
            </p>
        </div>
    );
}

/* ───────────────────────── una pista (un eje de cadenamiento) ───────────────────────── */

interface PistaProps {
    indice: number; eje: EjeVista; modelo: ModeloCanal; ancho: number; ventana: [number, number]; zoomable: boolean; filaSel: number | null;
    soloAtipicos: boolean; ocultas: ReadonlySet<ClaveFamilia>; esPhone: boolean;
    onElegir: (t: TramoVista, foco?: boolean) => void; onAbrir: (fila: number, obraId?: string) => void; onVentana: (v: [number, number]) => void;
}

function PistaEje({ indice, eje, modelo, ancho, ventana, zoomable, filaSel, soloAtipicos, ocultas, esPhone, onElegir, onAbrir, onVentana }: PistaProps) {
    const idBase = useId().replace(/:/g, '');
    const [tip, setTip] = useState<Tip | null>(null);
    const arrastre = useRef<{ x0: number; v0: [number, number]; capturado: boolean } | null>(null);
    const bloquear = useRef(false);

    const visibles = useMemo(() => eje.obras.filter((o) => !ocultas.has(o.clave)), [eje.obras, ocultas]);
    // Carriles: solo las familias con obras en este eje y no filtradas, en el orden del catálogo.
    const carriles = useMemo(() => CLAVES_FAMILIA.filter((c) => !ocultas.has(c) && eje.obras.some((o) => o.clave === c)), [eje.obras, ocultas]);
    const perfil = useMemo(() => calcularPerfil({
        ancho, ventana, margenIzq: MARGEN_IZQ, margenDer: MARGEN_DER, ticksObjetivo: Math.max(3, Math.floor((ancho - MARGEN_IZQ - MARGEN_DER) / 120)),
        tramos: eje.tramos.map((t) => ({ id: String(t.fila), kmIni: t.kmIni, kmFin: t.kmFin })),
        estructuras: visibles.map((o) => ({ id: o.id, km: o.km ?? 0, familia: o.familia })),
    }), [ancho, ventana, eje.tramos, visibles]);

    const porFila = useMemo(() => new Map(eje.tramos.map((t) => [String(t.fila), t])), [eje.tramos]);
    const porId = useMemo(() => new Map(eje.obras.map((o) => [o.id, o])), [eje.obras]);
    const grupos = useMemo(() => agruparEnCarril(perfil.estructuras.map((s) => {
        const o = porId.get(s.id);
        const clave: ClaveFamilia = o?.clave ?? 'ninguna';
        return { id: s.id, x: s.x, carril: carriles.indexOf(clave), clave };
    }).filter((s) => s.carril >= 0), SEPARACION_AGRUPAR), [perfil.estructuras, porId, carriles]);

    const margenSup = eje.nacePk === null && indice === 0 && modelo.anclaPk !== null ? 22 : 8;
    const yBanda = margenSup;
    const yEje = yBanda + BANDA_H + 6;
    const yCarriles = yEje + 34;
    const alto = yCarriles + carriles.length * CARRIL_H + 6;
    const ancla = indice === 0 && modelo.anclaPk !== null ? Number(modelo.anclaPk.split('+')[0]) + Number(modelo.anclaPk.split('+')[1]) / 1000 : null;
    const xAncla = ancla !== null && ancla >= ventana[0] && ancla <= ventana[1] ? perfil.xDeKm(ancla) : null;
    const filaFoco = eje.tramos.some((t) => t.fila === filaSel) ? filaSel : (perfil.tramos[0] ? Number(perfil.tramos[0].id) : null);

    const mostrar = (x: number, y: number, titulo: string, lineas: string[]) => setTip({ x, y, titulo, lineas });
    const ocultar = () => setTip(null);

    const alPuntero = (e: PunteroReact<SVGSVGElement>) => {
        if (!zoomable || esPhone || e.button !== 0) return;
        arrastre.current = { x0: e.clientX, v0: ventana, capturado: false };
    };
    const alMover = (e: PunteroReact<SVGSVGElement>) => {
        const a = arrastre.current;
        if (!a || perfil.pxPorKm <= 0) return;
        const dx = e.clientX - a.x0;
        if (!a.capturado && Math.abs(dx) > 4) { a.capturado = true; e.currentTarget.setPointerCapture(e.pointerId); ocultar(); }
        if (a.capturado) onVentana(desplazarVentana(a.v0, -dx / perfil.pxPorKm, eje.totalKm));
    };
    const alSoltar = () => {
        if (arrastre.current?.capturado) { bloquear.current = true; setTimeout(() => { bloquear.current = false; }, 0); }
        arrastre.current = null;
    };

    const abrirGrupo = (ids: readonly string[]) => {
        const obras = ids.map((i) => porId.get(i)).filter((o): o is ObraVista => o !== undefined);
        const unica = obras[0];
        if (!unica) return;
        if (obras.length === 1) {
            const t = tramoDeObra(eje, unica) ?? eje.tramos.find((x) => x.fila === filaSel) ?? eje.tramos[0];
            if (t) { onElegir(t); onAbrir(t.fila, unica.id); }
            return;
        }
        if (!zoomable) return;
        const kms = obras.map((o) => o.km ?? 0);
        const a = Math.min(...kms), b = Math.max(...kms);
        onVentana(ventanaCentrada((a + b) / 2, Math.max(2, (b - a) * 1.8), eje.totalKm));
    };

    const bandas = perfil.tramos.map((g) => {
        const t = porFila.get(g.id);
        if (!t) return null;
        const sel = t.fila === filaSel;
        const tenue = soloAtipicos && t.estado === 'cuadra';
        const ancB = Math.max(g.ancho - 1.5, 3);
        const etiqueta = `Tramo ${etiquetaPk(t.pkInicial)} a ${etiquetaPk(t.pkFinal)}, ${TEXTO_ESTADO[t.estado]}`;
        return (
            <g key={t.fila} className={`pf-banda pf-${t.estado}${sel ? ' pf-sel' : ''}${tenue ? ' pf-tenue' : ''}`} role="button" aria-pressed={sel} aria-label={etiqueta}
                data-fila={t.fila} data-tramo={t.fila} tabIndex={t.fila === filaFoco ? 0 : -1}
                onClick={() => { if (!bloquear.current) onElegir(t); }}
                onDoubleClick={() => { onElegir(t); onAbrir(t.fila); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onElegir(t); onAbrir(t.fila); } else if (e.key === ' ') { e.preventDefault(); onElegir(t); } }}
                onMouseEnter={() => mostrar((g.x0 + g.x1) / 2, yEje + 30, `${etiquetaPk(t.pkInicial)} → ${etiquetaPk(t.pkFinal)}`, [`${t.longitudKm.toFixed(2)} km · ${TEXTO_ESTADO[t.estado]}`, 'Doble clic o Intro: ver ubicación'])}
                onMouseLeave={ocultar}
                onFocus={() => mostrar((g.x0 + g.x1) / 2, yEje + 30, `${etiquetaPk(t.pkInicial)} → ${etiquetaPk(t.pkFinal)}`, [`${t.longitudKm.toFixed(2)} km · ${TEXTO_ESTADO[t.estado]}`, 'Intro: ver ubicación'])}
                onBlur={ocultar}>
                <rect className="pf-banda-fondo" x={g.x0 + 0.75} y={yBanda} width={ancB} height={BANDA_H} rx={4} />
                {t.estado === 'atipico' && <rect className="pf-banda-trama" x={g.x0 + 0.75} y={yBanda} width={ancB} height={BANDA_H} rx={4} fill={`url(#${idBase}-trama)`} />}
                <rect className="pf-banda-borde" x={g.x0 + 0.75} y={yBanda} width={ancB} height={BANDA_H} rx={4} />
                {t.estado === 'atipico' && ancB >= 14 && <text className="pf-glifo" x={g.x0 + 0.75 + Math.min(ancB / 2, 11)} y={yBanda + 20} textAnchor="middle">!</text>}
                {ancB >= 62 && <text className="pf-largo" x={g.x0 + 0.75 + ancB / 2} y={yBanda + 38} textAnchor="middle">{t.longitudKm.toFixed(1)} km</text>}
            </g>
        );
    });

    const vacioTramos = eje.tramos.length === 0;
    return (
        <section className="pf-pista" data-eje={indice} aria-label={eje.titulo}>
            <div className="pf-pista-cab">
                <b>{eje.titulo}</b>
                {eje.nacePk !== null && <small>cadenamiento propio, desde K-0+000 en su origen; nace en {etiquetaPk(eje.nacePk)} del canal principal</small>}
                {eje.tramosSinPK > 0 && <small>{eje.tramosSinPK} tramos sin cadenamiento legible no se dibujan</small>}
            </div>
            {vacioTramos ? <p className="sc-vacio">Ningún tramo de esta obra tiene cadenamiento legible.</p> : (
                <div className="pf-lienzo" style={{ width: ancho }}>
                    <svg className={`pf-svg${zoomable && !esPhone ? ' pf-arrastrable' : ''}`} width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="group" aria-label={`Perfil de ${eje.titulo}`}
                        onPointerDown={alPuntero} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar}>
                        <defs>
                            <pattern id={`${idBase}-trama`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line className="pf-trama-linea" x1="0" y1="0" x2="0" y2="7" /></pattern>
                            <clipPath id={`${idBase}-recorteo`}><rect x={perfil.x0 - 14} y="0" width={Math.max(perfil.x1 - perfil.x0 + 28, 0)} height={alto} /></clipPath>
                            <clipPath id={`${idBase}-recorte`}><rect x={perfil.x0} y="0" width={Math.max(perfil.x1 - perfil.x0, 0)} height={alto} /></clipPath>
                        </defs>
                        {/* Todo el recorrido del eje, para que un tramo sin cifra se vea como hueco y no desaparezca */}
                        <rect className="pf-pista-fondo" x={Math.max(perfil.xDeKm(0), perfil.x0)} y={yBanda} width={Math.max(Math.min(perfil.xDeKm(eje.totalKm), perfil.x1) - Math.max(perfil.xDeKm(0), perfil.x0), 0)} height={BANDA_H} rx={4} />
                        {perfil.ticks.map((tk) => <line key={tk.km} className="pf-rejilla" x1={tk.x} x2={tk.x} y1={yBanda} y2={yEje} />)}
                        <g clipPath={`url(#${idBase}-recorte)`}>{bandas}</g>
                        <line className="pf-eje" x1={perfil.x0} x2={perfil.x1} y1={yEje} y2={yEje} />
                        {perfil.ticks.map((tk) => (
                            <g key={tk.km} className="pf-tick">
                                <line x1={tk.x} x2={tk.x} y1={yEje} y2={yEje + 6} />
                                <text x={tk.x} y={yEje + 22} textAnchor={tk.x < perfil.x0 + 34 ? 'start' : tk.x > perfil.x1 - 34 ? 'end' : 'middle'}>{tk.etiqueta}</text>
                            </g>
                        ))}
                        {xAncla !== null && (
                            <g className="pf-ancla">
                                <line x1={xAncla} x2={xAncla} y1={6} y2={yEje} />
                                <text x={xAncla + 5} y={15} textAnchor={xAncla > perfil.x1 - 190 ? 'end' : 'start'} dx={xAncla > perfil.x1 - 190 ? -10 : 0}>Aquí nace el ramal auxiliar · {etiquetaPk(modelo.anclaPk)}</text>
                            </g>
                        )}
                        {carriles.map((c, i) => {
                            const y = yCarriles + i * CARRIL_H + CARRIL_H / 2;
                            return (
                                <g key={c} className="pf-carril">
                                    <line x1={perfil.x0} x2={perfil.x1} y1={y} y2={y} />
                                    <line className="pf-carril-sep" x1={perfil.x0 - 6} x2={perfil.x0 - 6} y1={y - CARRIL_H / 2 + 4} y2={y + CARRIL_H / 2 - 4} />
                                    <SimboloG clave={c} x={MARGEN_IZQ / 2 - 6} y={y} tamano={LADO_SIMBOLO} />
                                </g>
                            );
                        })}
                        <g clipPath={`url(#${idBase}-recorteo)`} aria-hidden="true">
                            {grupos.map((g) => {
                                const y = yCarriles + g.carril * CARRIL_H + CARRIL_H / 2;
                                const obras = g.ids.map((i) => porId.get(i)).filter((o): o is ObraVista => o !== undefined);
                                const primera = obras[0];
                                if (!primera) return null;
                                const unica = obras.length === 1;
                                const est = unica && primera.estado === 'estimada';
                                const titulo = unica
                                    ? lineaObra(primera)
                                    : `${obras.length} obras de ${rotuloFamilia(g.clave).toLowerCase()}`;
                                const lineas = unica
                                    ? [primera.tipoNombre, TEXTO_UBICACION[primera.estado], 'Clic: ver ubicación']
                                    : ['Clic para acercar a este grupo'];
                                return (
                                    <g key={g.ids[0]} className="pf-obra" onClick={() => { if (!bloquear.current) abrirGrupo(g.ids); }}
                                        onMouseEnter={() => mostrar(g.x, y, titulo, lineas)} onMouseLeave={ocultar} data-obras={g.ids.length}>
                                        <rect className="pf-obra-area" x={g.x - 22} y={y - CARRIL_H / 2} width={44} height={CARRIL_H} />
                                        <SimboloG clave={g.clave} x={g.x} y={y} tamano={LADO_SIMBOLO} punteado={est} />
                                        {!unica && (
                                            <g className="pf-cuenta">
                                                <rect x={g.x + 4} y={y - 15} width={g.ids.length > 9 ? 24 : 17} height={16} rx={8} />
                                                <text x={g.x + 4 + (g.ids.length > 9 ? 12 : 8.5)} y={y - 3} textAnchor="middle">{g.ids.length}</text>
                                            </g>
                                        )}
                                    </g>
                                );
                            })}
                        </g>
                    </svg>
                    {tip && (
                        <div className="pf-tip" aria-hidden="true" style={{ left: Math.min(Math.max(tip.x, 90), Math.max(ancho - 90, 90)), top: tip.y + 4 }}>
                            <b>{tip.titulo}</b>
                            {tip.lineas.map((l) => <span key={l}>{l}</span>)}
                        </div>
                    )}
                    {carriles.length > 0 && (
                        <span className="pf-solo-lector">
                            {`${perfil.estructuras.length} estructuras en la vista; ${perfil.estructurasFuera} fuera de ella.`}
                        </span>
                    )}
                </div>
            )}
            {(eje.fueraDeTramos.length > 0 || eje.sinPK.length > 0) && (
                <p className="pf-sinlugar">
                    {eje.fueraDeTramos.length > 0 && <>{eje.fueraDeTramos.length} {eje.fueraDeTramos.length === 1 ? 'obra' : 'obras'} con cadenamiento más allá del final declarado en IO1 ({etiquetaKm(eje.totalKm)}): no caen en ningún tramo. </>}
                    {eje.sinPK.length > 0 && <>{eje.sinPK.length} {eje.sinPK.length === 1 ? 'obra' : 'obras'} sin cadenamiento utilizable. </>}
                    Se listan en la ventana de ubicación.
                </p>
            )}
        </section>
    );
}

/* ───────────────────────── minimapa del canal completo ───────────────────────── */

function Minimapa({ eje, ancho, ventana, onCentrar }: { eje: EjeVista; ancho: number; ventana: [number, number]; onCentrar: (km: number) => void }) {
    const ref = useRef<SVGSVGElement>(null);
    const [arr, setArr] = useState(false);
    const x0 = 12, x1 = Math.max(ancho - 12, x0 + 1);
    const px = (km: number) => x0 + (km / eje.totalKm) * (x1 - x0);
    const kmDe = (clientX: number): number => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return 0;
        return Math.min(Math.max(((clientX - r.left - x0) / (x1 - x0)) * eje.totalKm, 0), eje.totalKm);
    };
    useEffect(() => {
        if (!arr) return;
        const sube = () => setArr(false);
        window.addEventListener('pointerup', sube);
        return () => window.removeEventListener('pointerup', sube);
    }, [arr]);
    return (
        <div className="pf-mini" style={{ width: ancho }}>
            <svg ref={ref} width={ancho} height={40} viewBox={`0 0 ${ancho} 40`} aria-hidden="true"
                onPointerDown={(e) => { setArr(true); onCentrar(kmDe(e.clientX)); }} onPointerMove={(e) => { if (arr) onCentrar(kmDe(e.clientX)); }}>
                {eje.tramos.map((t) => <rect key={t.fila} className={`pf-mini-t pf-${t.estado}`} x={px(t.kmIni)} y={6} width={Math.max(px(t.kmFin) - px(t.kmIni) - 0.5, 1)} height={12} />)}
                <rect className="pf-mini-ventana" x={px(ventana[0])} y={2} width={Math.max(px(ventana[1]) - px(ventana[0]), 4)} height={20} rx={3} />
                <text className="pf-mini-txt" x={x0} y={37} textAnchor="start">{etiquetaKm(0)}</text>
                <text className="pf-mini-txt" x={x1} y={37} textAnchor="end">{etiquetaKm(eje.totalKm)}</text>
            </svg>
            <span className="pf-solo-lector">Minimapa del canal completo con la parte visible marcada. Haga clic para moverse.</span>
        </div>
    );
}
