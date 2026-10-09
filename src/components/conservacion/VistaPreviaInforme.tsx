import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import type { ArchivoInforme } from '../../conservacion/informe/esquemaInforme';
import { nombreSeguroArchivo } from '../../conservacion/informe/vistas';
import { generarHtmlInformeConservacion } from '../../utils/informeConservacion';
import { assetToDataURI } from '../../utils/assetToDataURI';
import { guardaOComparte } from '../../utils/descargaArchivo';

interface Props { archivo: ArchivoInforme; onCerrar: () => void }

/** Vista previa del informe imprimible: iframe con el HTML real (logos incrustados) + Imprimir / Descargar. */
export function VistaPreviaInforme({ archivo, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [html, setHtml] = useState<string | null>(null);
    const [url, setUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useModalA11y(dialogRef, true, onCerrar);

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const [logoSrl, logoSica] = await Promise.all([
                    assetToDataURI('/logos/conservacion/logo-srl-transparente.png'),
                    assetToDataURI('/logos/conservacion/sica005-transparente.png'),
                ]);
                const h = generarHtmlInformeConservacion(archivo, { logoSrl, logoSica });
                if (vivo) setHtml(h);
            } catch (e) {
                if (vivo) setError(e instanceof Error ? e.message : 'No se pudo generar el informe.');
            }
        })();
        return () => { vivo = false; };
    }, [archivo]);

    useEffect(() => {
        if (html == null) return;
        const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        setUrl(u); // eslint-disable-line react-hooks/set-state-in-effect
        return () => URL.revokeObjectURL(u);
    }, [html]);

    const imprimir = () => { const w = frameRef.current?.contentWindow; if (w) { w.focus(); w.print(); } };
    const descargar = async () => {
        if (html == null) return;
        try { await guardaOComparte(new Blob([html], { type: 'text/html;charset=utf-8' }), `${nombreSeguroArchivo(archivo)}.html`, 'text/html'); }
        catch (e) { setError(e instanceof Error ? e.message : 'No se pudo descargar el archivo.'); }
    };
    const listo = html != null && url != null;

    return createPortal(
        <div className="cons-previa-fondo sc-root">
            <div className="cons-previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cons-previa-t" tabIndex={-1}>
                <div className="cons-previa-barra">
                    <h2 id="cons-previa-t">Informe imprimible</h2>
                    <button type="button" className="sc-btn" onClick={descargar} disabled={!listo}><Download size={16} aria-hidden="true" /> Descargar HTML</button>
                    <button type="button" className="sc-btn sc-btn-primario" onClick={imprimir} disabled={!listo}><Printer size={16} aria-hidden="true" /> Imprimir / PDF</button>
                    <button type="button" className="sc-btn" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                </div>
                <div className="cons-previa-marco">
                    {error ? <p role="alert">{error}</p>
                        : !listo ? <p role="status" aria-busy="true">Generando informe…</p>
                            : <iframe ref={frameRef} title="Vista previa del informe de SICA Conservación" src={url} />}
                </div>
            </div>
        </div>,
        document.body,
    );
}
