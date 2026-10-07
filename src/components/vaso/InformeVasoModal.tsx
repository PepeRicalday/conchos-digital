import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Download, Eye, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import {
    SECCIONES_VASO, ORDEN_SECCIONES_VASO, avisosConfigVaso, configVasoPorDefecto, filtrarEscenas, validarConfigVaso,
    type ConfigInformeVaso, type EscenaVaso, type SeccionVaso,
} from '../../utils/informeVasoDatos';
import { descargarInformeVasoHtml, generarHtmlInformeVaso, type EntradaVaso } from '../../utils/informeVaso';
import '../ndvi/informeNdviModal.css';

interface Props { entrada: EntradaVaso; onCerrar: () => void }

const dia = (e: EscenaVaso) => e.fecha_escena.slice(0, 10);
const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);

/** Ventana "Configurar informe del vaso": periodo + secciones → vista previa en iframe → imprimir / descargar. */
export default function InformeVasoModal({ entrada, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [c, setC] = useState<ConfigInformeVaso>(configVasoPorDefecto);
    const [html, setHtml] = useState<string | null>(null);
    const [generando, setGenerando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [urlBlob, setUrlBlob] = useState<string | null>(null);

    const escenas = entrada.escenas;
    const fechas = useMemo(() => [...escenas].map(dia).sort(), [escenas]);
    const minF = fechas[0], maxF = fechas[fechas.length - 1];
    const errores = useMemo(() => validarConfigVaso(c, escenas), [c, escenas]);
    const avisos = useMemo(() => avisosConfigVaso(c, escenas), [c, escenas]);
    const n = filtrarEscenas(escenas, c).length;
    const enPrevia = html != null || generando || error != null;

    const volver = () => { setHtml(null); setError(null); setGenerando(false); };
    useModalA11y(dialogRef, true, enPrevia ? volver : onCerrar);

    useEffect(() => {
        if (html == null) { setUrlBlob(null); return; }
        const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        setUrlBlob(u);
        return () => URL.revokeObjectURL(u);
    }, [html]);

    const generar = async () => {
        setGenerando(true); setError(null);
        try { setHtml(await generarHtmlInformeVaso(entrada, c)); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        finally { setGenerando(false); }
    };
    const descargar = async (h: string) => {
        try { await descargarInformeVasoHtml(h, entrada.nombrePresa); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo descargar el archivo.'); }
    };
    const imprimir = () => { const w = frameRef.current?.contentWindow; if (w) { w.focus(); w.print(); } };

    const ultimas = (k: number) => setC((p) => ({ ...p, desde: fechas[Math.max(0, fechas.length - k)] ?? null, hasta: null }));
    const activoTodo = c.desde == null && c.hasta == null;
    const set = (p: Partial<ConfigInformeVaso>) => setC((prev) => ({ ...prev, ...p }));

    return createPortal(
        <div className="ndvi-cfg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !enPrevia) onCerrar(); }}>
            {enPrevia ? (
                <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="vaso-prev-t" tabIndex={-1}>
                    <div className="ndvi-cfg-barra">
                        <h2 id="vaso-prev-t">Vista previa del informe</h2>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={volver}><ArrowLeft size={16} aria-hidden="true" /> Volver a filtros</button>
                            <button type="button" className="ndvi-cfg-btn" onClick={() => html && void descargar(html)} disabled={!html}><Download size={16} aria-hidden="true" /> Descargar HTML</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" onClick={imprimir} disabled={!urlBlob}><Printer size={16} aria-hidden="true" /> Imprimir / PDF</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                        </div>
                    </div>
                    <div className="ndvi-cfg-marco">
                        {error ? <div className="ndvi-cfg-estado" role="alert"><h3>No se pudo generar el informe</h3><p>{error}</p></div>
                            : !urlBlob ? <div className="ndvi-cfg-estado" role="status" aria-busy="true"><p>Generando informe…</p></div>
                                : <iframe ref={frameRef} title="Vista previa del informe de manejo de vaso" src={urlBlob} />}
                    </div>
                </div>
            ) : (
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="vaso-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Geo-Monitor · Manejo de vaso</span>
                            <h2 id="vaso-cfg-t" className="ndvi-cfg-titulo">Configurar informe del vaso</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Periodo">
                                <span className="ndvi-cfg-etq">Periodo de escenas satelitales <em>({n} de {escenas.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Atajos de periodo">
                                    <button type="button" className="ndvi-cfg-chip" aria-pressed={activoTodo} onClick={() => set({ desde: null, hasta: null })}>Todo el histórico</button>
                                    <button type="button" className="ndvi-cfg-chip" aria-pressed={c.desde === fechas[Math.max(0, fechas.length - 3)] && c.hasta == null && !activoTodo} onClick={() => ultimas(3)}>Últimas 3 escenas</button>
                                    <button type="button" className="ndvi-cfg-chip" aria-pressed={c.desde === maxF && c.hasta == null} onClick={() => ultimas(1)}>Última escena</button>
                                </div>
                                <div className="ndvi-cfg-fila">
                                    <label className="ndvi-cfg-etq" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Desde
                                        <input type="date" className="ndvi-cfg-in" value={c.desde ?? ''} min={minF} max={maxF} onChange={(e) => set({ desde: e.target.value || null })} /></label>
                                    <label className="ndvi-cfg-etq" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Hasta
                                        <input type="date" className="ndvi-cfg-in" value={c.hasta ?? ''} min={minF} max={maxF} onChange={(e) => set({ hasta: e.target.value || null })} /></label>
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Secciones">
                                <span className="ndvi-cfg-etq">Secciones <em>({c.secciones.length} de {SECCIONES_VASO.length})</em></span>
                                <div className="ndvi-cfg-secs">
                                    {SECCIONES_VASO.map((s) => (
                                        <label key={s.id} className="ndvi-cfg-check">
                                            <input type="checkbox" checked={c.secciones.includes(s.id)}
                                                onChange={() => { const x = alternar<SeccionVaso>(c.secciones, s.id); set({ secciones: ORDEN_SECCIONES_VASO.filter((k) => x.includes(k)) }); }} />
                                            <span>{s.etiqueta}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Hoja">
                                <span className="ndvi-cfg-etq">Hoja</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Tamaño de hoja">
                                    {(['letter', 'a4'] as const).map((h) => (
                                        <button key={h} type="button" role="radio" aria-checked={c.hoja === h} className="ndvi-cfg-chip" onClick={() => set({ hoja: h })}>{h === 'letter' ? 'Carta' : 'A4'}</button>
                                    ))}
                                </div>
                            </section>
                        </div>
                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Resumen del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{n} {n === 1 ? 'escena' : 'escenas'}<small>{c.secciones.length} secciones</small></div>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((e) => <li key={e}><span aria-hidden="true">⛔</span>{e}</li>)}</ul>}
                            {avisos.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-avi">{avisos.map((a) => <li key={a}><span aria-hidden="true">⚠</span>{a}</li>)}</ul>}
                            <p className="ndvi-cfg-resumen">El informe incluye el estado vigente de la presa, avisos de calidad del dato y folio de emisión.</p>
                        </aside>
                    </div>
                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">Presa {entrada.nombrePresa} · {c.hoja === 'letter' ? 'Carta' : 'A4'}</p>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0} onClick={() => void generar()}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            )}
        </div>,
        document.body,
    );
}
