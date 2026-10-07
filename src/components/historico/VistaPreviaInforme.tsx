import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Download, Printer, X } from 'lucide-react';
import type { Indice } from '../../utils/historicoPresas';
import type { ConfigInforme } from '../../utils/informeHistoricoConfig';
import { descargarInformeHtml, generarInformeHtml, nombreArchivoInforme } from '../../utils/exportHistoricoInforme';
import { useModalA11y } from './useModalA11y';

// Memoización por configuración: no se regenera al abrir/cerrar sin cambios (se invalida si cambia el índice de datos).
const CACHE = new WeakMap<Indice, Map<string, string>>();
const llave = (c: ConfigInforme) => JSON.stringify(c);

interface Props { config: ConfigInforme; indice: Indice; onVolver: () => void; onCerrar: () => void }

export default function VistaPreviaInforme({ config, indice, onVolver, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [html, setHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [urlBlob, setUrlBlob] = useState<string | null>(null);
    const [errDescarga, setErrDescarga] = useState<string | null>(null);

    useModalA11y(dialogRef, true, onVolver);

    useEffect(() => {
        let vivo = true;
        const k = llave(config);
        const porIndice = CACHE.get(indice) ?? new Map<string, string>();
        CACHE.set(indice, porIndice);
        const previo = porIndice.get(k);
        const listo = previo !== undefined ? Promise.resolve(previo) : generarInformeHtml(config, indice).then(h => { porIndice.set(k, h); return h; });
        listo.then(h => { if (vivo) setHtml(h); })
            .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); });
        return () => { vivo = false; };
    }, [config, indice]);

    useEffect(() => {
        if (html == null) return;
        const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        setUrlBlob(u); // eslint-disable-line react-hooks/set-state-in-effect
        return () => URL.revokeObjectURL(u);
    }, [html]);

    const imprimir = () => { const w = frameRef.current?.contentWindow; if (w) { w.focus(); w.print(); } };
    const descargar = async () => {
        if (html == null) return;
        setErrDescarga(null);
        try { await descargarInformeHtml(html, nombreArchivoInforme(config)); }
        catch (e) { setErrDescarga(e instanceof Error ? e.message : 'No se pudo descargar el archivo.'); }
    };

    const listoParaUsar = html != null && urlBlob != null;

    return createPortal(
        <div className="ah-inf-overlay ah-inf-overlay--previa">
            <div className="ah-inf-dialog ah-inf-dialog--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ah-inf-previa-t" tabIndex={-1}>
                <div className="ah-inf-bar">
                    <h2 id="ah-inf-previa-t" className="ah-inf-bar-t">Vista previa del informe</h2>
                    <div className="ah-inf-bar-acc">
                        <button type="button" className="ah-btn ah-inf-btn" onClick={onVolver}><ArrowLeft size={16} /> Volver a filtros</button>
                        <button type="button" className="ah-btn ah-inf-btn" onClick={descargar} disabled={!listoParaUsar}><Download size={16} /> Descargar HTML</button>
                        <button type="button" className="ah-btn ah-inf-btn ah-inf-btn--pri" onClick={imprimir} disabled={!listoParaUsar}><Printer size={16} /> Imprimir / PDF</button>
                        <button type="button" className="ah-btn ah-inf-btn ah-inf-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} /></button>
                    </div>
                </div>
                {errDescarga && <p className="ah-inf-err" role="alert">{errDescarga}</p>}
                <div className="ah-inf-previa-cuerpo">
                    {error ? (
                        <div className="ah-inf-estado" role="alert">
                            <h3>No se pudo generar el informe</h3>
                            <p>{error}</p>
                            <button type="button" className="ah-btn ah-inf-btn" onClick={onVolver}><ArrowLeft size={16} /> Volver a filtros</button>
                        </div>
                    ) : !listoParaUsar ? (
                        <div className="ah-inf-estado" role="status" aria-busy="true"><div className="ah-pulso" /><p>Generando informe…</p></div>
                    ) : (
                        <iframe ref={frameRef} className="ah-inf-frame" title="Vista previa del informe histórico" src={urlBlob} />
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
