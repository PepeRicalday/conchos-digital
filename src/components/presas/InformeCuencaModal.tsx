import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, ImageDown, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import type { CuencaConchos } from '../../hooks/useAqwpCuenca';
import { ORDEN_PRESAS_CUENCA } from '../../utils/aqwpCuenca';
import { metaPresaPorUbicacion } from '../../utils/presasCuencaMeta';
import {
    DATOS_INFORME, ORDENES_INFORME, ORDEN_DATOS_INFORME, TAMANOS_INFORME, avisosConfigCuenca, configCuencaPorDefecto, etiquetaAlcance, pasaTamano, validarConfigCuenca,
    type ConfigInformeCuenca, type DatoInforme, type TamanoInforme,
} from '../../utils/informeCuencaConfig';
import { construirDatosCuenca } from '../../utils/informeCuencaDatos';
import { ANCHO_PNG_CUENCA, LAMINA_PX, htmlInformeCuenca, type FormatoInformeCuenca } from '../../utils/informeCuencaHtml';
import { cargarLogosInforme } from '../../utils/logosInforme';
import { rasterizaHtml } from '../../utils/rasterizaHtml';
import { guardaOComparte } from '../../utils/descargaArchivo';
import { imprimirOPdf } from '../../utils/imprimirInforme';
import { conMarcaInvitado } from '../../utils/marcaInvitado';
import { nombreArchivoConPartes } from '../../utils/informeBase';
import '../ndvi/informeNdviModal.css';

interface Props { datos: CuencaConchos; onCerrar: () => void }

const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
const FORMATOS: { id: FormatoInformeCuenca; et: string; ayuda: string }[] = [
    { id: 'carta', et: 'PDF carta', ayuda: 'Resumen, una hoja por presa y anexo con trazabilidad y firmas' },
    { id: 'png', et: 'Infografía PNG', ayuda: 'Imagen vertical de 1600 px para WhatsApp o pantalla' },
    { id: 'lamina', et: 'Lámina 17×11', ayuda: 'Horizontal para imprimir en gran formato' },
];
const ANCHO_FORMATO: Record<FormatoInformeCuenca, number> = { carta: 816, png: ANCHO_PNG_CUENCA, lamina: LAMINA_PX.ancho };

const hoyPortal = () => new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10); // UTC-6, como el portal

/** Ventana "Informe de la cuenca del Conchos": filtros (presas, tamaño, datos, orden, periodo) → vista previa → PNG / PDF / lámina. */
export default function InformeCuencaModal({ datos, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const marcoRef = useRef<HTMLDivElement>(null);
    const [c, setC] = useState<ConfigInformeCuenca>(() => configCuencaPorDefecto());
    const [formato, setFormato] = useState<FormatoInformeCuenca>('carta');
    const [emitido, setEmitido] = useState<Date | null>(null);
    const [logos, setLogos] = useState<{ srl: string; sica: string } | null>(null);
    const [generando, setGenerando] = useState(false);
    const [exportando, setExportando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [anchoMarco, setAnchoMarco] = useState(900);

    const enPrevia = emitido != null || generando || error != null;
    const volver = () => { setEmitido(null); setError(null); setGenerando(false); };
    useModalA11y(dialogRef, true, enPrevia ? volver : onCerrar);

    const set = (p: Partial<ConfigInformeCuenca>) => setC((prev) => ({ ...prev, ...p }));
    const hoyISO = useMemo(hoyPortal, []);

    // Etiquetas y NAMO de las 7 presas para los chips y la validación.
    const presas = useMemo(() => ORDEN_PRESAS_CUENCA.map((id) => {
        const e = datos.estados.find((x) => x.ubicacionId === id);
        return { id, etiqueta: metaPresaPorUbicacion(id)?.etiqueta ?? e?.nombre ?? String(id), namo: e?.namoMm3 ?? null, distrito: e?.presaId != null };
    }), [datos.estados]);
    const namos = useMemo(() => Object.fromEntries(presas.map((p) => [p.id, p.namo])), [presas]);

    const incluidas = presas.filter((p) => c.presas.includes(p.id) && pasaTamano(p.namo, c.tamano)).length;
    const errores = useMemo(() => validarConfigCuenca(c, namos), [c, namos]);
    const avisos = useMemo(() => avisosConfigCuenca(c, { totalPresas: presas.length, hayClimatologia: datos.climatologia != null, incluidas }),
        [c, presas.length, datos.climatologia, incluidas]);

    const informe = useMemo(() => (emitido ? construirDatosCuenca(datos, c, hoyISO) : null), [datos, c, hoyISO, emitido]);
    const html = useMemo(() => (informe && emitido && logos ? htmlInformeCuenca(informe, { formato, logoSrl: logos.srl, logoSica: logos.sica, emitido }) : null), [informe, emitido, logos, formato]);

    // Vista previa: el documento (1600 / 1632 px) se reduce con zoom al ancho del marco para verlo entero sin desplazamiento lateral.
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
        try {
            setLogos(await cargarLogosInforme());
            setEmitido(new Date());
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        finally { setGenerando(false); }
    };

    const nombreBase = () => nombreArchivoConPartes('cuenca-conchos', [etiquetaAlcance(c, incluidas, presas.length), formato]).replace(/\.html$/, '');

    const exportarPng = async () => {
        if (!html) return;
        setExportando(true); setError(null);
        try {
            const lam = formato === 'lamina';
            const png = await rasterizaHtml(conMarcaInvitado(html), { ancho: ANCHO_FORMATO[formato], escala: lam ? 2 : 1.5, ...(lam ? { alto: LAMINA_PX.alto } : {}) });
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

    const marcarPresas = (ids: number[]) => set({ presas: [...ORDEN_PRESAS_CUENCA].filter((id) => ids.includes(id)) });
    const atajos: { id: string; et: string; ids: number[] }[] = [
        { id: 'todas', et: 'Todas', ids: [...ORDEN_PRESAS_CUENCA] },
        { id: 'distrito', et: 'Solo distrito', ids: presas.filter((p) => p.distrito).map((p) => p.id) },
        { id: 'rio', et: 'Río Florido', ids: [541, 540] },
    ];
    const mismas = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

    return createPortal(
        <div className="ndvi-cfg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !enPrevia) onCerrar(); }}>
            {enPrevia ? (
                <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cu-prev-t" tabIndex={-1}>
                    <div className="ndvi-cfg-barra">
                        <h2 id="cu-prev-t">Vista previa del informe</h2>
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
                                : <iframe ref={frameRef} title="Vista previa del informe de la cuenca del Conchos" src={urlBlob} />}
                    </div>
                </div>
            ) : (
                <div className="ndvi-cfg" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cu-cfg-t" tabIndex={-1}>
                    <header className="ndvi-cfg-head">
                        <div>
                            <span className="ndvi-cfg-kicker">Sala de Control Hidráulico · Cuenca del Conchos</span>
                            <h2 id="cu-cfg-t" className="ndvi-cfg-titulo">Informe de la cuenca del Conchos</h2>
                        </div>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className="ndvi-cfg-cuerpo">
                        <div className="ndvi-cfg-col">
                            <section className="ndvi-cfg-bloque" aria-label="Presas">
                                <span className="ndvi-cfg-etq">Presas <em>({c.presas.length} de {presas.length})</em></span>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Atajos de presas">
                                    {atajos.map((a) => (
                                        <button key={a.id} type="button" className="ndvi-cfg-chip" aria-pressed={mismas(c.presas, a.ids)} onClick={() => marcarPresas(a.ids)}>{a.et}</button>
                                    ))}
                                </div>
                                <div className="ndvi-cfg-chips" role="group" aria-label="Presas a incluir">
                                    {presas.map((p) => (
                                        <button key={p.id} type="button" className="ndvi-cfg-chip" aria-pressed={c.presas.includes(p.id)}
                                            onClick={() => { const x = alternar(c.presas, p.id); if (x.length) marcarPresas(x); }}>{p.etiqueta}</button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Tamaño">
                                <span className="ndvi-cfg-etq">Tamaño de la presa <em>(capacidad NAMO)</em></span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Clase de tamaño">
                                    {TAMANOS_INFORME.map((t) => (
                                        <button key={t.id} type="button" role="radio" aria-checked={c.tamano === t.id} className="ndvi-cfg-chip" title={t.ayuda} onClick={() => set({ tamano: t.id as TamanoInforme })}>{t.etiqueta}</button>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Datos">
                                <span className="ndvi-cfg-etq">Datos a incluir <em>({c.datos.length} de {DATOS_INFORME.length}; los tanques van siempre)</em></span>
                                <div className="ndvi-cfg-secs">
                                    {DATOS_INFORME.map((d) => (
                                        <label key={d.id} className="ndvi-cfg-check" title={d.ayuda}>
                                            <input type="checkbox" checked={c.datos.includes(d.id)}
                                                onChange={() => { const x = alternar<DatoInforme>(c.datos, d.id); set({ datos: ORDEN_DATOS_INFORME.filter((k) => x.includes(k)) }); }} />
                                            <span>{d.etiqueta}</span>
                                        </label>
                                    ))}
                                </div>
                            </section>
                            <section className="ndvi-cfg-bloque" aria-label="Orden">
                                <span className="ndvi-cfg-etq">Orden de las presas</span>
                                <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Orden">
                                    {ORDENES_INFORME.map((o) => (
                                        <button key={o.id} type="button" role="radio" aria-checked={c.orden === o.id} className="ndvi-cfg-chip" onClick={() => set({ orden: o.id })}>{o.etiqueta}</button>
                                    ))}
                                </div>
                            </section>
                            {c.datos.includes('serie') && (
                                <section className="ndvi-cfg-bloque" aria-label="Periodo de la serie">
                                    <span className="ndvi-cfg-etq">Periodo de la serie de llenado</span>
                                    <div className="ndvi-cfg-chips" role="radiogroup" aria-label="Meses de la serie">
                                        {([3, 12] as const).map((m) => (
                                            <button key={m} type="button" role="radio" aria-checked={c.meses === m} className="ndvi-cfg-chip" onClick={() => set({ meses: m })}>{m} meses</button>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>
                        <aside className="ndvi-cfg-col ndvi-cfg-viva" aria-label="Resumen del informe">
                            <div className="ndvi-cfg-cuenta" aria-live="polite">{incluidas} de {presas.length} {presas.length === 1 ? 'presa' : 'presas'}<small>{c.tamano === 'todas' ? 'todos los tamaños' : TAMANOS_INFORME.find((t) => t.id === c.tamano)?.etiqueta}</small></div>
                            {errores.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert">{errores.map((x) => <li key={x}><span aria-hidden="true">⛔</span>{x}</li>)}</ul>}
                            {avisos.length > 0 && <ul className="ndvi-cfg-msgs ndvi-cfg-avi">{avisos.map((a) => <li key={a}><span aria-hidden="true">⚠</span>{a}</li>)}</ul>}
                            <p className="ndvi-cfg-resumen">Mismo modelo que la pantalla: las cifras del informe coinciden con las de la cuenca. Dato provisional de CONAGUA vía USIBWC; es contexto y no sustituye al aforo de campo ni a CILA. Formatos: PDF carta, infografía PNG y lámina 17×11.</p>
                        </aside>
                    </div>
                    <footer className="ndvi-cfg-pie">
                        <p className="ndvi-cfg-resumen" aria-live="polite">{etiquetaAlcance(c, incluidas, presas.length)}</p>
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
