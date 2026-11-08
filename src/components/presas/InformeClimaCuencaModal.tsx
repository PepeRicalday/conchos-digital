import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, ImageDown, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import type { RedJcas } from '../../hooks/useJcasCuenca';
import type { PronosticoCuenca } from '../../hooks/useCuencaPronostico';
import type { DemGrid } from '../../utils/camposCuenca';
import { resumenConfiabilidad } from '../../utils/cuencaPronostico';
import {
    VARIABLES_INFORME, ORDEN_VARIABLES, avisosConfigClima, configClimaPorDefecto, cuentaPlanos, etiquetaAlcanceClima, validarConfigClima, type ConfigInformeClima,
} from '../../utils/informeClimaCuencaConfig';
import { construirDatosClima } from '../../utils/informeClimaCuencaDatos';
import {
    ANCHO_PNG_CLIMA, LAMINA_CLIMA_PX, MAX_PLANOS_LAMINA, MAX_PLANOS_PNG, htmlInformeClimaCuenca, type FormatoInformeClima,
} from '../../utils/informeClimaCuencaHtml';
import type { VariablePlano } from '../../utils/paletasClima';
import { cargarLogosInforme } from '../../utils/logosInforme';
import { rasterizaHtml } from '../../utils/rasterizaHtml';
import { guardaOComparte } from '../../utils/descargaArchivo';
import { imprimirOPdf } from '../../utils/imprimirInforme';
import { conMarcaInvitado } from '../../utils/marcaInvitado';
import { nombreArchivoConPartes } from '../../utils/informeBase';
import '../ndvi/informeNdviModal.css';

interface Props { red: RedJcas | null; pron: PronosticoCuenca | null; dem: DemGrid | null; onCerrar: () => void }

const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
const FORMATOS: { id: FormatoInformeClima; et: string; ayuda: string }[] = [
    { id: 'carta', et: 'PDF carta', ayuda: 'Todos los planos, dos por hoja, con tablas de estaciones, trazabilidad y firmas' },
    { id: 'png', et: 'Infografía PNG', ayuda: `Imagen vertical de 1600 px para WhatsApp (hasta ${MAX_PLANOS_PNG} planos)` },
    { id: 'lamina', et: 'Lámina 17×11', ayuda: `Horizontal para imprimir en gran formato (los ${MAX_PLANOS_LAMINA} primeros planos)` },
];
const ANCHO_FORMATO: Record<FormatoInformeClima, number> = { carta: 816, png: ANCHO_PNG_CLIMA, lamina: LAMINA_CLIMA_PX.ancho };
const hoyLocal = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10);

/** Ventana "Informe de clima y pronóstico de la cuenca": filtros (variables, observado/pronóstico, periodos) → vista previa → PNG / PDF / lámina. */
export default function InformeClimaCuencaModal({ red, pron, dem, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const marcoRef = useRef<HTMLDivElement>(null);
    const [c, setC] = useState<ConfigInformeClima>(() => configClimaPorDefecto());
    const [formato, setFormato] = useState<FormatoInformeClima>('carta');
    const [emitido, setEmitido] = useState<Date | null>(null);
    const [logos, setLogos] = useState<{ srl: string; sica: string } | null>(null);
    const [generando, setGenerando] = useState(false);
    const [exportando, setExportando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [anchoMarco, setAnchoMarco] = useState(900);

    const enPrevia = emitido != null || generando || error != null;
    const volver = () => { setEmitido(null); setError(null); setGenerando(false); };
    useModalA11y(dialogRef, true, enPrevia ? volver : onCerrar);
    const set = (p: Partial<ConfigInformeClima>) => setC((prev) => ({ ...prev, ...p }));
    const hoy = useMemo(hoyLocal, []);

    const errores = useMemo(() => validarConfigClima(c), [c]);
    const avisos = useMemo(() => avisosConfigClima(c, {
        hayPronostico: !!pron && pron.filas.length > 0, hayObservado: (red?.modelo?.vigentes ?? 0) > 0,
        confiabilidadEnConstruccion: resumenConfiabilidad(pron?.verificacion ?? []).estado === 'construccion',
    }), [c, pron, red]);
    const nPlanos = cuentaPlanos(c);

    const informe = useMemo(() => (emitido && red?.contorno ? construirDatosClima(c, { red: red.modelo, contorno: red.contorno, dem, pron, hoy, ultSyncJcas: red.ultSyncEn }) : null), [emitido, c, red, dem, pron, hoy]);
    const html = useMemo(() => (informe && emitido && logos ? htmlInformeClimaCuenca(informe, { formato, logoSrl: logos.srl, logoSica: logos.sica, emitido }) : null), [informe, emitido, logos, formato]);
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
    const nombreBase = () => nombreArchivoConPartes('clima-cuenca-conchos', [etiquetaAlcanceClima(c).replace(/[^a-z0-9]+/gi, '-'), formato]).replace(/\.html$/, '');
    const exportarPng = async () => {
        if (!html) return;
        setExportando(true); setError(null);
        try {
            const lam = formato === 'lamina';
            const png = await rasterizaHtml(conMarcaInvitado(html), { ancho: ANCHO_FORMATO[formato], escala: lam ? 2 : 1.5, ...(lam ? { alto: LAMINA_CLIMA_PX.alto } : {}) });
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
                <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="clc-prev-t" tabIndex={-1}>
                    <div className="ndvi-cfg-barra">
                        <h2 id="clc-prev-t">Vista previa del informe</h2>
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
                                : <iframe ref={frameRef} title="Vista previa del informe de clima y pronóstico de la cuenca" src={urlBlob} />}
                    </div>
                </div>
            ) : (
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="clc-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Sala de Control Hidráulico · Cuenca del Conchos</span>
                            <h2 id="clc-cfg-t" className="ndvi-cfg-titulo">Informe de clima y pronóstico de la cuenca</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Variables">
                                <span className="ndvi-cfg-etq">Variables <em>({c.variables.length} de {VARIABLES_INFORME.length})</em></span>
                                <div className="ndvi-cfg-secs">
                                    {VARIABLES_INFORME.map((v) => (
                                        <label key={v.id} className="ndvi-cfg-check" title={v.ayuda}>
                                            <input type="checkbox" checked={c.variables.includes(v.id)}
                                                onChange={() => { const x = alternar<VariablePlano>(c.variables, v.id); set({ variables: ORDEN_VARIABLES.filter((k) => x.includes(k)) }); }} />
                                            <span>{v.etiqueta}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Observado">
                                <label className="ndvi-cfg-check"><input type="checkbox" checked={c.observado} onChange={() => set({ observado: !c.observado })} /><span className="ndvi-cfg-etq">Lo observado (estaciones JCAS)</span></label>
                                {c.observado && (
                                    <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Periodo observado">
                                        {([7, 30] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={c.diasObs === d} className="ndvi-cfg-chip" onClick={() => set({ diasObs: d })}>Últimos {d} días</button>)}
                                    </div>
                                )}
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Pronóstico">
                                <label className="ndvi-cfg-check"><input type="checkbox" checked={c.pronostico} onChange={() => set({ pronostico: !c.pronostico })} /><span className="ndvi-cfg-etq">Pronóstico (3 modelos)</span></label>
                                {c.pronostico && (
                                    <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Horizonte del pronóstico">
                                        {([3, 7] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={c.diasPron === d} className="ndvi-cfg-chip" onClick={() => set({ diasPron: d })}>Próximos {d} días</button>)}
                                    </div>
                                )}
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Tabla de estaciones">
                                <label className="ndvi-cfg-check"><input type="checkbox" checked={c.estaciones} onChange={() => set({ estaciones: !c.estaciones })} /><span className="ndvi-cfg-etq">Tabla de estaciones</span></label>
                            </section>
                        </div>
                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Resumen del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{nPlanos} {nPlanos === 1 ? 'plano' : 'planos'}<small>{etiquetaAlcanceClima(c)}</small></div>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((x) => <li key={x}><span aria-hidden="true">⛔</span>{x}</li>)}</ul>}
                            {avisos.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-avi">{avisos.map((a) => <li key={a}><span aria-hidden="true">⚠</span>{a}</li>)}</ul>}
                            <p className="ndvi-cfg-resumen">Mismos planos que la pantalla: las cifras del informe coinciden con las de la vista Cuenca. Dato provisional de contexto (JCAS/UACJ, Open-Meteo y estaciones propias); no sustituye a las estaciones propias ni a los aforos. La infografía PNG muestra hasta {MAX_PLANOS_PNG} planos y la lámina {MAX_PLANOS_LAMINA}; el PDF carta incluye todos.</p>
                        </aside>
                    </div>
                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">{etiquetaAlcanceClima(c)}</p>
                        <div className="ndvi-cfg-acc">
                            <button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cancelar</button>
                            <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" disabled={errores.length > 0 || generando || !red?.contorno} onClick={() => void generar()}><Eye size={16} aria-hidden="true" /> Vista previa</button>
                        </div>
                    </footer>
                </div>
            )}
        </div>,
        document.body,
    );
}
