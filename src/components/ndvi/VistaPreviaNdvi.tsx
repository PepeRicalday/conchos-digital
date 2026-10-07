import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Download, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import { descargarInformeNdviHtml, generarHtmlInformeNdvi, type OpcionesInformeNdvi } from '../../utils/informeNdviInstitucional';
import type { FilaNdviInforme } from '../../utils/informeNdviDatos';
import './informeNdviModal.css';

interface Props { filas: FilaNdviInforme[]; opciones: OpcionesInformeNdvi; onVolver: () => void; onCerrar: () => void }

/** Vista previa en pantalla del informe ya configurado: iframe con el HTML real + Imprimir / Descargar. */
export default function VistaPreviaNdvi({ filas, opciones, onVolver, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [html, setHtml] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [urlBlob, setUrlBlob] = useState<string | null>(null);
    const [errDescarga, setErrDescarga] = useState<string | null>(null);

    useModalA11y(dialogRef, true, onVolver);

    useEffect(() => {
        let vivo = true;
        generarHtmlInformeNdvi(filas, opciones)
            .then((h) => { if (vivo) setHtml(h); })
            .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); });
        return () => { vivo = false; };
    }, [filas, opciones]);

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
        try { await descargarInformeNdviHtml(html); }
        catch (e) { setErrDescarga(e instanceof Error ? e.message : 'No se pudo descargar el archivo.'); }
    };
    const listo = html != null && urlBlob != null;

    return createPortal(
        <div className="ndvi-cfg-overlay">
            <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ndvi-previa-t" tabIndex={-1}>
                <div className="ndvi-cfg-barra">
                    <h2 id="ndvi-previa-t">Vista previa del informe</h2>
                    <div className="ndvi-cfg-acc">
                        <button type="button" className="ndvi-cfg-btn" onClick={onVolver}><ArrowLeft size={16} aria-hidden="true" /> Volver a filtros</button>
                        <button type="button" className="ndvi-cfg-btn" onClick={descargar} disabled={!listo}><Download size={16} aria-hidden="true" /> Descargar HTML</button>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" onClick={imprimir} disabled={!listo}><Printer size={16} aria-hidden="true" /> Imprimir / PDF</button>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </div>
                </div>
                {errDescarga && <ul className="ndvi-cfg-msgs ndvi-cfg-err" role="alert" style={{ margin: 8 }}><li>{errDescarga}</li></ul>}
                <div className="ndvi-cfg-marco">
                    {error ? (
                        <div className="ndvi-cfg-estado" role="alert"><h3>No se pudo generar el informe</h3><p>{error}</p>
                            <button type="button" className="ndvi-cfg-btn" onClick={onVolver}><ArrowLeft size={16} aria-hidden="true" /> Volver a filtros</button></div>
                    ) : !listo ? (
                        <div className="ndvi-cfg-estado" role="status" aria-busy="true"><p>Generando informe…</p></div>
                    ) : (
                        <iframe ref={frameRef} title="Vista previa del informe institucional de NDVI" src={urlBlob} />
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
