import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, FileCode2, ImageDown, Printer, X } from 'lucide-react';
import { useModalA11y } from '../../historico/useModalA11y';
import { useImprimirInforme } from '../../../hooks/useImprimirInforme';
import { cargarBaseHidro, cargarSeriesHidro } from '../../../hooks/useHidroEstaciones';
import { colorEstacion, type EstacionHidro, type VentanaHidro } from '../../../utils/hidroEstaciones';
import {
    MAX_DIAS_SERIES, diaLocal, estacionesDeAtajo, atajoActivo, rangoEfectivo, type AtajoEstaciones, type TipoPeriodoGoes,
} from '../../../utils/informeGoesConfig';
import { NOMBRE_CORTO } from '../../../utils/informeGoesDatos';
import {
    BLOQUES_INFOGRAFIA, FORMATOS_INFOGRAFIA, HOJAS_INFOGRAFIA, dimensionHoja, avisosConfigInfografia, cambiarFormatoInfografia, configInfografiaPorDefecto, contarPaginasInfografia,
    contenidoEfectivo, validarConfigInfografia, type ConfigInfografiaGoes,
} from '../../../utils/infografiaGoesConfig';
import { ORDEN_INFOGRAFIA_GOES, construirDatosInfografiaGoes, type DatosInfografiaGoes } from '../../../utils/infografiaGoes';
import { htmlInfografiaGoes, nombreBaseInfografiaGoes } from '../../../utils/infografiaGoesHtml';
import { ajustarZoomVistaPrevia, cargarRecursosInfografiaGoes, prepararImpresionInfografia } from '../../../utils/infografiaGoesRecursos';
import { htmlPorHoja } from '../../../utils/imprimirInforme';
import { rasterizaHtml } from '../../../utils/rasterizaHtml';
import { guardaOComparte } from '../../../utils/descargaArchivo';
import '../../ndvi/informeNdviModal.css';
import './informeGoesModal.css';

export interface InfografiaGoesModalProps {
    estaciones: EstacionHidro[];
    ventanaInicial: VentanaHidro;
    onCerrar: () => void;
}

const HORA = 3600000;
const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
const PERIODOS: { id: TipoPeriodoGoes; et: string }[] = [
    { id: '24h', et: 'Últimas 24 h' }, { id: '7d', et: 'Últimos 7 días' }, { id: '30d', et: 'Últimos 30 días' }, { id: 'rango', et: 'Rango de fechas' },
];
const ATAJOS: { id: AtajoEstaciones; et: string }[] = [{ id: 'todas', et: 'Todas' }, { id: 'presas', et: 'Entradas a presa' }, { id: 'rio', et: 'Estaciones de río' }];

interface Resultado { html: string; datos: DatosInfografiaGoes; formato: ConfigInfografiaGoes['formato']; hoja: ConfigInfografiaGoes['hoja'] }

/** Descarga las series del periodo (más 8 días previos para la variación a 7 d), los recursos del plano y arma el HTML. */
async function generar(c: ConfigInfografiaGoes, estaciones: EstacionHidro[]): Promise<Resultado> {
    const ahoraMs = Date.now();
    const r = rangoEfectivo(c.periodo, ahoraMs);
    if (!r) throw new Error('El rango de fechas no es válido.');
    const cfg = contenidoEfectivo(c);
    const horas = Math.ceil((ahoraMs - r.desdeMs) / HORA);
    const tope = (MAX_DIAS_SERIES + 8) * 24;
    const [series, base] = await Promise.all([cargarSeriesHidro(c.estaciones, Math.min(tope, horas + 8 * 24)), cargarBaseHidro()]);
    const datos = construirDatosInfografiaGoes({ periodo: c.periodo, incluir: c.estaciones, estaciones, series, mensajes: base.mensajes, ahoraMs });
    if (datos.estaciones.every((e) => e.sinDatos)) throw new Error('Sin lecturas en el periodo (S/D) para las estaciones elegidas: no se genera la infografía.');
    const recursos = await cargarRecursosInfografiaGoes(datos, cfg);
    return { html: htmlInfografiaGoes(datos, { ...recursos, config: cfg }), datos, formato: cfg.formato, hoja: cfg.hoja };
}

/** Infografía GOES: filtros (formato, estaciones, periodo, plano, vasos, estadística…) → vista previa → imagen, HTML o PDF. */
export default function InfografiaGoesModal({ estaciones, ventanaInicial, onCerrar }: InfografiaGoesModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    // Mismo orden de lectura que la infografía: Boca del Río, Madero–Vírgenes, Babisas y Ojinaga.
    const lista = useMemo(() => [...estaciones].sort((a, b) => ORDEN_INFOGRAFIA_GOES.indexOf(a.id as typeof ORDEN_INFOGRAFIA_GOES[number]) - ORDEN_INFOGRAFIA_GOES.indexOf(b.id as typeof ORDEN_INFOGRAFIA_GOES[number])), [estaciones]);
    const ids = useMemo(() => lista.map((e) => e.id), [lista]);
    const [c, setC] = useState<ConfigInfografiaGoes>(() => configInfografiaPorDefecto(ventanaInicial, ids));
    const [res, setRes] = useState<Resultado | null>(null);
    const [generando, setGenerando] = useState(false);
    const [exportando, setExportando] = useState<null | 'png' | 'html'>(null);
    const [error, setError] = useState<string | null>(null);
    const [urlBlob, setUrlBlob] = useState<string | null>(null);
    const [ahora] = useState(() => Date.now());

    const errores = useMemo(() => validarConfigInfografia(c, Date.now(), ids), [c, ids]);
    const avisos = useMemo(() => avisosConfigInfografia(c), [c]);
    const paginas = useMemo(() => contarPaginasInfografia(contenidoEfectivo(c)), [c]);
    const atajo = atajoActivo(estaciones, c.estaciones);
    const enPrevia = res != null || generando || error != null;
    const nombreBase = res ? nombreBaseInfografiaGoes(res.datos, res.formato, res.hoja) : 'estaciones-goes';
    const dimRes = dimensionHoja(res?.hoja ?? 'pantalla');
    const { imprimir, generando: imprimiendo, errorPdf } = useImprimirInforme(res?.html ?? null, frameRef, nombreBase, dimRes.ancho);

    const volver = () => { setRes(null); setError(null); setGenerando(false); };
    useModalA11y(dialogRef, true, enPrevia ? volver : onCerrar);

    useEffect(() => {
        if (!res) { setUrlBlob(null); return; }
        const u = URL.createObjectURL(new Blob([res.html], { type: 'text/html;charset=utf-8' }));
        setUrlBlob(u);
        return () => URL.revokeObjectURL(u);
    }, [res]);

    // La vista previa se escala al ancho disponible (las páginas miden 1080 px); al imprimir se quita el zoom.
    useEffect(() => {
        const f = frameRef.current;
        if (!f || !urlBlob) return;
        const aplicar = () => ajustarZoomVistaPrevia(f, dimRes.ancho);
        f.addEventListener('load', aplicar);
        const ro = new ResizeObserver(aplicar);
        ro.observe(f);
        return () => { f.removeEventListener('load', aplicar); ro.disconnect(); };
    }, [urlBlob, dimRes.ancho]);

    const set = (p: Partial<ConfigInfografiaGoes>) => setC((prev) => ({ ...prev, ...p }));
    const setPeriodo = (tipo: TipoPeriodoGoes) => setC((prev) => ({
        ...prev,
        periodo: tipo === 'rango'
            ? { tipo, desde: prev.periodo.desde || diaLocal(ahora - 6 * 24 * HORA), hasta: prev.periodo.hasta || diaLocal(ahora) }
            : { ...prev.periodo, tipo },
    }));
    const alternarEstacion = (id: string) => {
        const x = alternar(c.estaciones, id);
        if (x.length) set({ estaciones: ids.filter((k) => x.includes(k)) });
    };
    const bloquesDelFormato = BLOQUES_INFOGRAFIA.filter((b) => !b.soloTecnico || c.formato === 'tecnico');

    const vistaPrevia = async () => {
        setGenerando(true); setError(null);
        try { setRes(await generar(c, estaciones)); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar la infografía.'); }
        finally { setGenerando(false); }
    };

    /** Una imagen por página (cada ficha es independiente); una sola imagen muy alta excedería el límite de lienzo de iOS. */
    const exportarPng = async () => {
        if (!res) return;
        setExportando('png'); setError(null);
        try {
            const { htmls, ancho } = htmlPorHoja(res.html, dimRes.ancho, dimRes.alto ?? undefined);
            // En hoja de papel (816 px o menos) se rasteriza a escala 3: más nitidez para imprimir la imagen.
            for (let i = 0; i < htmls.length; i++) {
                const png = await rasterizaHtml(htmls[i], { ancho, escala: dimRes.papel ? 3 : 2, alto: dimRes.alto ?? undefined });
                await guardaOComparte(png, htmls.length > 1 ? `${nombreBase}-pagina-${i + 1}-de-${htmls.length}.png` : `${nombreBase}.png`, 'image/png');
            }
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar la imagen.'); }
        finally { setExportando(null); }
    };

    const exportarHtml = async () => {
        if (!res) return;
        setExportando('html'); setError(null);
        try { await guardaOComparte(new Blob([res.html], { type: 'text/html;charset=utf-8' }), `${nombreBase}.html`, 'text/html'); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el HTML.'); }
        finally { setExportando(null); }
    };

    /** PDF vectorial en escritorio: una hoja de 1080 px por página, sin zoom; se restaura la vista al terminar. */
    const imprimirPdf = async () => {
        const restaurar = prepararImpresionInfografia(frameRef.current, res?.hoja ?? 'pantalla');
        frameRef.current?.contentWindow?.addEventListener('afterprint', restaurar, { once: true });
        await imprimir();
        // En iOS no hay diálogo de impresión (se entrega un PDF rasterizado): se restaura de inmediato.
        if (!frameRef.current?.contentWindow) restaurar();
    };

    const nSel = c.estaciones.length;
    const ocupado = exportando != null || imprimiendo;

    return createPortal(
        <div className="ndvi-cfg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !enPrevia) onCerrar(); }}>
            {enPrevia ? (
                <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ia-prev-t" tabIndex={-1}>
                    <div className="ndvi-cfg-barra">
                        <h2 id="ia-prev-t">Vista previa de la infografía</h2>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={volver}><ArrowLeft size={16} aria-hidden="true" /> Volver a filtros</button>
                            <button type="button" className="ndvi-cfg-btn" onClick={() => void exportarPng()} disabled={!res || ocupado}><ImageDown size={16} aria-hidden="true" /> {exportando === 'png' ? 'Generando imagen…' : paginas > 1 ? 'Imagen (1 por página)' : 'Imagen PNG'}</button>
                            <button type="button" className="ndvi-cfg-btn" onClick={() => void exportarHtml()} disabled={!res || ocupado}><FileCode2 size={16} aria-hidden="true" /> HTML</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" onClick={() => void imprimirPdf()} disabled={!urlBlob || ocupado}><Printer size={16} aria-hidden="true" /> {imprimiendo ? 'Generando…' : 'Imprimir / PDF'}</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                        </div>
                    </div>
                    {errorPdf && !error && <div className="ig-alerta" role="alert">{errorPdf}</div>}
                    <div className="ndvi-cfg-marco">
                        {error ? <div className="ndvi-cfg-estado" role="alert"><h3>No se pudo completar la acción</h3><p>{error}</p><button type="button" className="ndvi-cfg-btn" onClick={volver}>Volver a filtros</button></div>
                            : !urlBlob ? <div className="ndvi-cfg-estado" role="status" aria-busy="true"><p>Descargando telemetría, mapa y vasos de presa…</p></div>
                                : <iframe ref={frameRef} title="Vista previa de la infografía de estaciones GOES" src={urlBlob} />}
                    </div>
                </div>
            ) : (
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ia-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Sala de Control Hidráulico, Presas</span>
                            <h2 id="ia-cfg-t" className="ndvi-cfg-titulo">Infografía de estaciones GOES</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Formato">
                                <span className="ndvi-cfg-etq">Formato</span>
                                <div className="ig-modalidades" role="radiogroup" aria-label="Formato de la infografía">
                                    {FORMATOS_INFOGRAFIA.map((m) => (
                                        <button key={m.id} type="button" role="radio" aria-checked={c.formato === m.id} className="ig-modalidad" onClick={() => setC((p) => cambiarFormatoInfografia(p, m.id))}>
                                            <strong>{m.t}</strong><span>{m.d}</span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                            {c.formato === 'tecnico' && (
                                <section className="ndvi-cfg-bloque" aria-label="Tamaño de hoja">
                                    <span className="ndvi-cfg-etq">Tamaño de hoja</span>
                                    <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Tamaño de hoja de la ficha técnica">
                                        {HOJAS_INFOGRAFIA.map((h) => (
                                            <button key={h.id} type="button" role="radio" aria-checked={c.hoja === h.id} className="ndvi-cfg-chip" title={h.detalle} onClick={() => set({ hoja: h.id })}>{h.etiqueta}</button>
                                        ))}
                                    </div>
                                    <span className="ndvi-cfg-ayuda">{dimensionHoja(c.hoja).detalle}</span>
                                </section>
                            )}
                            <section className="ndvi-cfg-bloque" aria-label="Estaciones">
                                <span className="ndvi-cfg-etq">Estaciones <em>({nSel} de {ids.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Atajos de agrupación">
                                    {ATAJOS.map((a) => (
                                        <button key={a.id} type="button" className="ndvi-cfg-chip" aria-pressed={atajo === a.id} onClick={() => { const x = estacionesDeAtajo(estaciones, a.id); if (x.length) set({ estaciones: x }); }}>{a.et}</button>
                                    ))}
                                </div>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Estaciones a incluir">
                                    {lista.map((e) => (
                                        <button key={e.id} type="button" className="ndvi-cfg-chip" style={{ ['--c' as string]: colorEstacion(e.id) }} aria-pressed={c.estaciones.includes(e.id)} onClick={() => alternarEstacion(e.id)}>
                                            <i aria-hidden="true" />{NOMBRE_CORTO[e.id] ?? e.nombre}
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Periodo">
                                <span className="ndvi-cfg-etq">Periodo</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Periodo de la infografía">
                                    {PERIODOS.map((p) => (
                                        <button key={p.id} type="button" role="radio" aria-checked={c.periodo.tipo === p.id} className="ndvi-cfg-chip" onClick={() => setPeriodo(p.id)}>{p.et}</button>
                                    ))}
                                </div>
                                {c.periodo.tipo === 'rango' && (
                                    <div className="ndvi-cfg-fila">
                                        <label className="ndvi-cfg-etq ig-campo">Desde
                                            <input type="date" className="ndvi-cfg-in ig-fecha" value={c.periodo.desde} min={diaLocal(ahora - MAX_DIAS_SERIES * 24 * HORA)} max={diaLocal(ahora)}
                                                onChange={(e) => set({ periodo: { ...c.periodo, desde: e.target.value } })} /></label>
                                        <label className="ndvi-cfg-etq ig-campo">Hasta
                                            <input type="date" className="ndvi-cfg-in ig-fecha" value={c.periodo.hasta} min={diaLocal(ahora - MAX_DIAS_SERIES * 24 * HORA)} max={diaLocal(ahora)}
                                                onChange={(e) => set({ periodo: { ...c.periodo, hasta: e.target.value } })} /></label>
                                    </div>
                                )}
                                <span className="ndvi-cfg-ayuda">Hora de Chihuahua. Las series de telemetría llegan hasta {MAX_DIAS_SERIES} días atrás.</span>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Contenido">
                                <span className="ndvi-cfg-etq">Contenido <em>({bloquesDelFormato.filter((b) => c[b.id] && (b.id !== 'vasos' || c.mapa)).length} de {bloquesDelFormato.length})</em></span>
                                <div className="ndvi-cfg-secs">
                                    {bloquesDelFormato.map((b) => {
                                        const bloqueado = b.id === 'vasos' && !c.mapa;
                                        return (
                                            <label key={b.id} className="ndvi-cfg-check" title={b.ayuda}>
                                                <input type="checkbox" checked={c[b.id] && !bloqueado} disabled={bloqueado} onChange={() => set({ [b.id]: !c[b.id] } as Partial<ConfigInfografiaGoes>)} />
                                                <span>{b.etiqueta}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </section>
                        </div>
                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Resumen de la infografía">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{paginas} {paginas === 1 ? 'imagen' : 'imágenes'}<small>{c.formato === 'tecnico' ? `Técnico, ${dimensionHoja(c.hoja).etiqueta.toLowerCase()}` : 'Resumen, 1080 px de ancho'}</small></div>
                            <p className="ndvi-cfg-resumen">{nSel} {nSel === 1 ? 'estación' : 'estaciones'}</p>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((x) => <li key={x}><span aria-hidden="true">⛔</span>{x}</li>)}</ul>}
                            {avisos.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-avi">{avisos.map((a) => <li key={a}><span aria-hidden="true">⚠</span>{a}</li>)}</ul>}
                            <p className="ndvi-cfg-resumen">{c.formato === 'tecnico' ? 'Una ficha independiente por estación, además del panorama. Cada página se guarda como imagen o como hoja del PDF.' : 'Una sola imagen, pensada para enviar por mensaje.'} Lo que no se midió sale como S/D, nunca como cero.</p>
                        </aside>
                    </div>
                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">La telemetría, el mapa y los vasos se descargan al generar</p>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0 || nSel === 0} onClick={() => void vistaPrevia()}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            )}
        </div>,
        document.body,
    );
}
