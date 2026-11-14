import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, ImageDown, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import type { DatosTratado } from '../../hooks/useTratadoCiclo';
import {
    ANCHO_PNG_TRATADO, LAMINA_TRATADO_PX, configTratadoPorDefecto, construirDatosTratado, htmlInformeTratado, type ConfigInformeTratado, type FormatoInformeTratado,
} from '../../utils/informeTratadoHtml';
import { resuelvePeriodo } from '../../utils/tratadoCiclo';
import { cargarLogosInforme } from '../../utils/logosInforme';
import { rasterizaHtml } from '../../utils/rasterizaHtml';
import { guardaOComparte } from '../../utils/descargaArchivo';
import { imprimirOPdf } from '../../utils/imprimirInforme';
import { conMarcaInvitado } from '../../utils/marcaInvitado';
import { nombreArchivoConPartes } from '../../utils/informeBase';
import SelectorPeriodoTratado from './cuenca/SelectorPeriodoTratado';
import './analitica/analitica.css';
import './cuenca/cuenca.css';
import './cuenca/tratado.css';
import '../ndvi/informeNdviModal.css';

interface Props { datos: DatosTratado; hoyISO: string; onCerrar: () => void }

const FORMATOS: { id: FormatoInformeTratado; et: string; ayuda: string }[] = [
    { id: 'carta', et: 'PDF carta', ayuda: 'Tres hojas: avance, volumen por afluente y conciliación, con trazabilidad y firmas' },
    { id: 'png', et: 'Infografía PNG', ayuda: `Imagen vertical de ${ANCHO_PNG_TRATADO} px para WhatsApp` },
    { id: 'lamina', et: 'Lámina 17×11', ayuda: 'Horizontal para imprimir en gran formato' },
];
const ANCHO_FORMATO: Record<FormatoInformeTratado, number> = { carta: 816, png: ANCHO_PNG_TRATADO, lamina: LAMINA_TRATADO_PX.ancho };

/** Ventana «Informe del Tratado de 1944»: periodo y secciones → vista previa → PDF carta / PNG / lámina. */
export default function InformeTratadoModal({ datos, hoyISO, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const marcoRef = useRef<HTMLDivElement>(null);
    const [c, setC] = useState<ConfigInformeTratado>(() => configTratadoPorDefecto());
    const [formato, setFormato] = useState<FormatoInformeTratado>('carta');
    const [emitido, setEmitido] = useState<Date | null>(null);
    const [logos, setLogos] = useState<{ srl: string; sica: string } | null>(null);
    const [generando, setGenerando] = useState(false);
    const [exportando, setExportando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [anchoMarco, setAnchoMarco] = useState(900);

    const enPrevia = emitido != null || generando || error != null;
    const volver = () => { setEmitido(null); setError(null); setGenerando(false); };
    useModalA11y(dialogRef, true, enPrevia ? volver : onCerrar);
    const set = (p: Partial<ConfigInformeTratado>) => setC((prev) => ({ ...prev, ...p }));

    const per = useMemo(() => resuelvePeriodo(datos.ciclo, c.periodo, hoyISO), [datos.ciclo, c.periodo, hoyISO]);
    const errores = useMemo(() => {
        const e: string[] = [];
        if (per.hasta < per.desde) e.push('El periodo elegido todavía no tiene días transcurridos.');
        if (!c.afluentes && !c.mensual && !c.conciliacion && !c.capturas && c.contenido === 'completo') e.push('Elija al menos una sección además del avance oficial, o use «Solo infografía».');
        return e;
    }, [per, c]);

    const informe = useMemo(() => (emitido ? construirDatosTratado(c, datos, hoyISO, emitido) : null), [emitido, c, datos, hoyISO]);
    const html = useMemo(() => (informe && emitido && logos ? htmlInformeTratado(informe, { formato, logoSrl: logos.srl, logoSica: logos.sica, emitido }) : null), [informe, emitido, logos, formato]);
    const htmlPrevia = useMemo(() => {
        if (!html) return null;
        const z = Math.min(1, Math.max(0.25, (anchoMarco - 24) / ANCHO_FORMATO[formato]));
        return formato === 'carta' ? html : html.replace('</head>', `<style>html{zoom:${z.toFixed(3)}}</style></head>`);
    }, [html, formato, anchoMarco]);

    const [urlBlob, setUrlBlob] = useState<string | null>(null);
    useEffect(() => {
        if (htmlPrevia == null) { setUrlBlob(null); return; }
        const u = URL.createObjectURL(new Blob([htmlPrevia], { type: 'text/html;charset=utf-8' }));
        setUrlBlob(u);
        return () => URL.revokeObjectURL(u);
    }, [htmlPrevia]);
    useEffect(() => {
        const el = marcoRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => setAnchoMarco(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, [enPrevia]);

    const generar = async () => {
        setGenerando(true); setError(null);
        try { setLogos(await cargarLogosInforme()); setEmitido(new Date()); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        finally { setGenerando(false); }
    };
    const nombreBase = () => nombreArchivoConPartes('tratado-1944', [per.clave.replace(/[^a-z0-9]+/gi, '-'), formato]).replace(/\.html$/, '');
    const exportarPng = async () => {
        if (!html) return;
        setExportando(true); setError(null);
        try {
            const lam = formato === 'lamina';
            const png = await rasterizaHtml(conMarcaInvitado(html), { ancho: ANCHO_FORMATO[formato], escala: lam ? 2 : 1.5, ...(lam ? { alto: LAMINA_TRATADO_PX.alto } : {}) });
            await guardaOComparte(png, `${nombreBase()}.png`, 'image/png');
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar la imagen.'); }
        finally { setExportando(false); }
    };
    const imprimir = async () => {
        setExportando(true); setError(null);
        try { await imprimirOPdf({ html, frame: frameRef.current, nombre: nombreBase(), ancho: formato === 'carta' ? undefined : ANCHO_FORMATO[formato] }); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el PDF.'); }
        finally { setExportando(false); }
    };

    return createPortal(
        <div className="ndvi-cfg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !enPrevia) onCerrar(); }}>
            {enPrevia ? (
                <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="trt-prev-t" tabIndex={-1}>
                    <div className="ndvi-cfg-barra">
                        <h2 id="trt-prev-t">Vista previa del informe</h2>
                        <div className="ndvi-cfg-acc">
                            <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Formato del informe">
                                {FORMATOS.map((f) => (
                                    <button key={f.id} type="button" role="radio" aria-checked={formato === f.id} className="ndvi-cfg-chip" title={f.ayuda} onClick={() => setFormato(f.id)}>{f.et}</button>
                                ))}
                            </div>
                            <button type="button" className="ndvi-cfg-btn" onClick={volver}><ArrowLeft size={16} aria-hidden="true" /> Volver a filtros</button>
                            {formato !== 'carta' && (
                                <button type="button" className="ndvi-cfg-btn" onClick={() => void exportarPng()} disabled={!html || exportando}><ImageDown size={16} aria-hidden="true" /> {exportando ? 'Generando imagen…' : 'Descargar PNG'}</button>
                            )}
                            {formato !== 'png' && (
                                <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" onClick={() => void imprimir()} disabled={!urlBlob || exportando}><Printer size={16} aria-hidden="true" /> {exportando ? 'Generando…' : 'Imprimir / PDF'}</button>
                            )}
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                        </div>
                    </div>
                    <div className="ndvi-cfg-marco" ref={marcoRef}>
                        {error ? <div className="ndvi-cfg-estado" role="alert"><h3>No se pudo completar la acción</h3><p>{error}</p></div>
                            : !urlBlob ? <div className="ndvi-cfg-estado" role="status" aria-busy="true"><p>Generando informe…</p></div>
                                : <iframe ref={frameRef} title="Vista previa del informe del Tratado de 1944" src={urlBlob} />}
                    </div>
                </div>
            ) : (
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="trt-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Sala de Control Hidráulico · Cuenca del Conchos</span>
                            <h2 id="trt-cfg-t" className="ndvi-cfg-titulo">Informe del Tratado de Aguas de 1944</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Periodo">
                                <span className="ndvi-cfg-etq">Periodo del informe</span>
                                <SelectorPeriodoTratado id="trt-m" ciclo={datos.ciclo} valor={c.periodo} onChange={(periodo) => set({ periodo })} hoyISO={hoyISO} />
                                <p className="ndvi-cfg-resumen">El avance oficial (corte del IBWC) siempre es el del ciclo completo; el periodo fija el volumen por afluente y la conciliación.</p>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Contenido del informe">
                                <span className="ndvi-cfg-etq">Contenido</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Contenido del informe">
                                    <button type="button" role="radio" aria-checked={c.contenido === 'completo'} className="ndvi-cfg-chip" onClick={() => set({ contenido: 'completo' })}>Informe completo</button>
                                    <button type="button" role="radio" aria-checked={c.contenido === 'infografia'} className="ndvi-cfg-chip" onClick={() => set({ contenido: 'infografia' })} title="Solo lo gráfico, en una hoja">Solo infografía</button>
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Secciones">
                                <span className="ndvi-cfg-etq">Secciones</span>
                                <div className="ndvi-cfg-secs">
                                    <label className="ndvi-cfg-check"><input type="checkbox" checked={c.mensual} onChange={() => set({ mensual: !c.mensual })} /><span>Volumen mensual por afluente (gráfica)</span></label>
                                    <label className="ndvi-cfg-check"><input type="checkbox" checked={c.afluentes} onChange={() => set({ afluentes: !c.afluentes })} /><span>Desglose por afluente (tabla)</span></label>
                                    <label className="ndvi-cfg-check"><input type="checkbox" checked={c.conciliacion} onChange={() => set({ conciliacion: !c.conciliacion })} /><span>Conciliación EUA contra México</span></label>
                                    <label className="ndvi-cfg-check"><input type="checkbox" checked={c.capturas} onChange={() => set({ capturas: !c.capturas })} /><span>Cifras oficiales de CONAGUA/CILA</span></label>
                                </div>
                            </section>
                        </div>
                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Resumen del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{per.hasta >= per.desde ? `${Math.round((Date.parse(per.hasta) - Date.parse(per.desde)) / 86_400_000) + 1} días` : 'S/D'}<small>{per.etiqueta}</small></div>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((x) => <li key={x}><span aria-hidden="true">⛔</span>{x}</li>)}</ul>}
                            <p className="ndvi-cfg-resumen">Fuente EUA: IBWC (series públicas y corte semanal, datos provisionales). Fuente México: Sutron de Ojinaga (SICA, no confiable para gasto mientras no se calibre) y las cifras oficiales capturadas de CONAGUA/CILA. Seguimiento operativo, no es el dictamen de la CILA.</p>
                        </aside>
                    </div>
                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">{per.etiqueta}</p>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0 || generando} onClick={() => void generar()}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            )}
        </div>,
        document.body,
    );
}
