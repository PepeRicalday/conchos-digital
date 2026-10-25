import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, ImageDown, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import { usePresasHistorico } from '../../hooks/usePresasHistorico';
import {
    ID_BOQUILLA, ID_MADERO, MESES_LARGO, NOMBRE_PRESA, type PresaId,
} from '../../utils/historicoPresas';
import {
    ORDEN_SECCIONES_NT, SECCIONES_NT, avisosConfigNT, configNTPorDefecto, todosLosAnios, ultimosAnios, validarConfigNT,
    type ConfigNivelTendencia, type SeccionNT,
} from '../../utils/informeNivelTendenciaConfig';
import { prepararNivelTendencia } from '../../utils/informeNivelTendenciaDatos';
import { ANCHO_INFORME_NT, htmlNivelTendencia } from '../../utils/informeNivelTendenciaHtml';
import { cargarLogosInforme } from '../../utils/logosInforme';
import { rasterizaHtml } from '../../utils/rasterizaHtml';
import { esIOS, guardaOComparte } from '../../utils/descargaArchivo';
import { imagenAJpeg, pdfDePaginas } from '../../utils/pdfDeImagenes';
import { nombreArchivoConPartes } from '../../utils/informeBase';
import '../ndvi/informeNdviModal.css';

interface Props { onCerrar: () => void }

const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
const igual = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Ventana "Informe de nivel y tendencia": filtros → vista previa en iframe → PNG por presa o PDF por impresión. */
export default function InformeNivelTendenciaModal({ onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const { indice, anios, loading, error: errorCarga } = usePresasHistorico();
    const [c, setC] = useState<ConfigNivelTendencia>(() => configNTPorDefecto([]));
    const [iniciado, setIniciado] = useState(false);
    const [html, setHtml] = useState<string | null>(null);
    const [generando, setGenerando] = useState(false);
    const [exportando, setExportando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [urlBlob, setUrlBlob] = useState<string | null>(null);

    // Al llegar el histórico se calculan los años de comparación por defecto (una sola vez).
    useEffect(() => {
        if (iniciado || loading || anios.length === 0) return;
        setC(configNTPorDefecto(anios));
        setIniciado(true);
    }, [anios, loading, iniciado]);

    const aniosAnt = useMemo(() => todosLosAnios(anios, c.anioBase), [anios, c.anioBase]);
    const errores = useMemo(() => validarConfigNT(c, anios), [c, anios]);
    const avisos = useMemo(() => avisosConfigNT(c, anios), [c, anios]);
    const enPrevia = html != null || generando || error != null;

    const volver = () => { setHtml(null); setError(null); setGenerando(false); };
    useModalA11y(dialogRef, true, enPrevia ? volver : onCerrar);

    useEffect(() => {
        if (html == null) { setUrlBlob(null); return; }
        const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        setUrlBlob(u);
        return () => URL.revokeObjectURL(u);
    }, [html]);

    const set = (p: Partial<ConfigNivelTendencia>) => setC((prev) => ({ ...prev, ...p }));
    const cambiarAnioBase = (a: number) => setC((prev) => ({ ...prev, anioBase: a, aniosComparacion: prev.aniosComparacion.filter((y) => y !== a) }));

    const generar = async () => {
        setGenerando(true); setError(null);
        try {
            const logos = await cargarLogosInforme();
            setHtml(htmlNivelTendencia(prepararNivelTendencia(c, indice), logos, 'pantalla'));
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        finally { setGenerando(false); }
    };

    /** Un PNG por presa (una sola imagen con ambas excedería el límite de lienzo de iOS). */
    const exportarPng = async () => {
        setExportando(true); setError(null);
        try {
            const logos = await cargarLogosInforme();
            const datos = prepararNivelTendencia(c, indice);
            for (const p of datos.presas) {
                const png = await rasterizaHtml(htmlNivelTendencia({ ...datos, presas: [p] }, logos, 'png'), { ancho: ANCHO_INFORME_NT, escala: 2 });
                const nombre = nombreArchivoConPartes('nivel-tendencia', [p.id === ID_BOQUILLA ? 'boquilla' : 'madero', `${c.anioBase}-${String(c.mes).padStart(2, '0')}`]).replace(/\.html$/, '.png');
                await guardaOComparte(png, nombre, 'image/png');
            }
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar la imagen.'); }
        finally { setExportando(false); }
    };
    /** PDF: en iOS/iPadOS no se puede imprimir un iframe, así que se rasteriza y se comparte como archivo PDF; en el resto, diálogo de impresión. */
    const imprimir = async () => {
        if (!esIOS()) { const w = frameRef.current?.contentWindow; if (w) { w.focus(); w.print(); } return; }
        setExportando(true); setError(null);
        try {
            const logos = await cargarLogosInforme();
            const datos = prepararNivelTendencia(c, indice);
            const paginas = [];
            for (const p of datos.presas) {
                const png = await rasterizaHtml(htmlNivelTendencia({ ...datos, presas: [p] }, logos, 'png'), { ancho: ANCHO_INFORME_NT, escala: 2 });
                paginas.push(await imagenAJpeg(png));
            }
            const nombre = nombreArchivoConPartes('nivel-tendencia', [c.presas.length > 1 ? 'presas' : c.presas[0] === ID_BOQUILLA ? 'boquilla' : 'madero', `${c.anioBase}-${String(c.mes).padStart(2, '0')}`]).replace(/\.html$/, '.pdf');
            await guardaOComparte(pdfDePaginas(paginas), nombre, 'application/pdf');
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el PDF.'); }
        finally { setExportando(false); }
    };

    const chipsComp = [
        { id: '3', et: 'Últimos 3 años', v: ultimosAnios(anios, c.anioBase, 3) },
        { id: '5', et: 'Últimos 5 años', v: ultimosAnios(anios, c.anioBase, 5) },
        { id: 'todo', et: 'Todo el historial', v: aniosAnt },
        { id: 'ninguno', et: 'Sin comparación', v: [] as number[] },
    ];

    return createPortal(
        <div className="ndvi-cfg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !enPrevia) onCerrar(); }}>
            {enPrevia ? (
                <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="nt-prev-t" tabIndex={-1}>
                    <div className="ndvi-cfg-barra">
                        <h2 id="nt-prev-t">Vista previa del informe</h2>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={volver}><ArrowLeft size={16} aria-hidden="true" /> Volver a filtros</button>
                            <button type="button" className="ndvi-cfg-btn" onClick={() => void exportarPng()} disabled={!html || exportando}><ImageDown size={16} aria-hidden="true" /> {exportando ? 'Generando imagen…' : c.presas.length > 1 ? 'Descargar PNG (1 por presa)' : 'Descargar PNG'}</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" onClick={() => void imprimir()} disabled={!urlBlob || exportando}><Printer size={16} aria-hidden="true" /> {exportando ? 'Generando…' : 'Imprimir / PDF'}</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                        </div>
                    </div>
                    <div className="ndvi-cfg-marco">
                        {error ? <div className="ndvi-cfg-estado" role="alert"><h3>No se pudo completar la acción</h3><p>{error}</p></div>
                            : !urlBlob ? <div className="ndvi-cfg-estado" role="status" aria-busy="true"><p>Generando informe…</p></div>
                                : <iframe ref={frameRef} title="Vista previa del informe de nivel y tendencia" src={urlBlob} />}
                    </div>
                </div>
            ) : (
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="nt-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Sala de Control Hidráulico · Presas</span>
                            <h2 id="nt-cfg-t" className="ndvi-cfg-titulo">Informe de nivel y tendencia</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            {loading && <p className="ndvi-cfg-resumen" role="status">Cargando histórico de presas…</p>}
                            {errorCarga && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert"><li><span aria-hidden="true">⛔</span>No se pudo cargar el histórico: {errorCarga}</li></ul>}
                            <section className="ndvi-cfg-bloque" aria-label="Presa">
                                <span className="ndvi-cfg-etq">Presa</span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Presas a incluir">
                                    {([ID_BOQUILLA, ID_MADERO] as PresaId[]).map((id) => (
                                        <button key={id} type="button" className="ndvi-cfg-chip" aria-pressed={c.presas.includes(id)}
                                            onClick={() => { const x = alternar<PresaId>(c.presas, id); if (x.length) set({ presas: [ID_BOQUILLA, ID_MADERO].filter((k) => x.includes(k as PresaId)) as PresaId[] }); }}>
                                            {NOMBRE_PRESA[id]}
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Periodo">
                                <span className="ndvi-cfg-etq">Mes y año de análisis</span>
                                <div className="ndvi-cfg-fila">
                                    <label className="ndvi-cfg-etq" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Mes
                                        <select className="ndvi-cfg-in" value={c.mes} onChange={(e) => set({ mes: Number(e.target.value) })}>
                                            {MESES_LARGO.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                                        </select></label>
                                    <label className="ndvi-cfg-etq" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Año
                                        <select className="ndvi-cfg-in" value={c.anioBase} onChange={(e) => cambiarAnioBase(Number(e.target.value))}>
                                            {(anios.length ? anios : [c.anioBase]).map((a) => <option key={a} value={a}>{a}</option>)}
                                        </select></label>
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Años de comparación">
                                <span className="ndvi-cfg-etq">Años de comparación <em>({c.aniosComparacion.length} de {aniosAnt.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Atajos de años">
                                    {chipsComp.map((k) => (
                                        <button key={k.id} type="button" className="ndvi-cfg-chip" aria-pressed={igual(c.aniosComparacion, k.v)} onClick={() => set({ aniosComparacion: k.v })}>{k.et}</button>
                                    ))}
                                </div>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Años individuales">
                                    {aniosAnt.slice().sort((a, b) => b - a).map((a) => (
                                        <button key={a} type="button" className="ndvi-cfg-chip" aria-pressed={c.aniosComparacion.includes(a)}
                                            onClick={() => set({ aniosComparacion: alternar(c.aniosComparacion, a).sort((x, y) => x - y) })}>{a}</button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Secciones">
                                <span className="ndvi-cfg-etq">Secciones adicionales <em>({c.secciones.length} de {SECCIONES_NT.length})</em></span>
                                <div className="ndvi-cfg-secs">
                                    {SECCIONES_NT.map((s) => (
                                        <label key={s.id} className="ndvi-cfg-check" title={s.ayuda}>
                                            <input type="checkbox" checked={c.secciones.includes(s.id)}
                                                onChange={() => { const x = alternar<SeccionNT>(c.secciones, s.id); set({ secciones: ORDEN_SECCIONES_NT.filter((k) => x.includes(k)) }); }} />
                                            <span>{s.etiqueta}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Serie">
                                <span className="ndvi-cfg-etq">Serie de datos</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Tipo de serie">
                                    {(['normalizada', 'reportada'] as const).map((s) => (
                                        <button key={s} type="button" role="radio" aria-checked={c.serie === s} className="ndvi-cfg-chip" onClick={() => set({ serie: s })}>
                                            {s === 'normalizada' ? 'Normalizada (comparable)' : 'Reportada (tal cual)'}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </div>
                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Resumen del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{c.presas.length} {c.presas.length === 1 ? 'presa' : 'presas'}<small>{MESES_LARGO[c.mes - 1]} {c.anioBase}</small></div>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((x) => <li key={x}><span aria-hidden="true">⛔</span>{x}</li>)}</ul>}
                            {avisos.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-avi">{avisos.map((a) => <li key={a}><span aria-hidden="true">⚠</span>{a}</li>)}</ul>}
                            <p className="ndvi-cfg-resumen">Incluye nivel oficial actual, tendencia del mes en escala y volumen, y comparación con años anteriores. Una hoja por presa, con formato institucional.</p>
                        </aside>
                    </div>
                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">{c.aniosComparacion.length ? `Comparado con ${c.aniosComparacion.length} ${c.aniosComparacion.length === 1 ? 'año' : 'años'}` : 'Sin años de comparación'}</p>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0 || loading || !iniciado} onClick={() => void generar()}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            )}
        </div>,
        document.body,
    );
}
