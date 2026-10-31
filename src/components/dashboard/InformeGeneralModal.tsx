import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageDown, Printer, X } from 'lucide-react';
import { useModalA11y } from '../historico/useModalA11y';
import { useImprimirInforme } from '../../hooks/useImprimirInforme';
import { cargarLogosInforme } from '../../utils/logosInforme';
import { htmlPorHoja } from '../../utils/imprimirInforme';
import { rasterizaHtml } from '../../utils/rasterizaHtml';
import { guardaOComparte } from '../../utils/descargaArchivo';
import { construirHtmlInformeGeneral, nombreArchivoInformeGeneral, type EntradaInformeGeneral } from '../../utils/informeGeneralHtml';
import '../ndvi/informeNdviModal.css';

interface Props {
    /** Arma la entrada con los datos del Dashboard EN EL MOMENTO de abrir (las mismas cifras que la pantalla). */
    armarEntrada: () => Omit<EntradaInformeGeneral, 'emitido'>;
    onCerrar: () => void;
}

/** Vista previa del Informe general del sistema (hojas Carta) con Imprimir / PDF y PNG por hoja. */
export default function InformeGeneralModal({ armarEntrada, onCerrar }: Props) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [html, setHtml] = useState<string | null>(null);
    const [nombre, setNombre] = useState('informe-general');
    const [urlBlob, setUrlBlob] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [exportando, setExportando] = useState(false);
    useModalA11y(dialogRef, true, onCerrar);
    const { imprimir, generando, errorPdf } = useImprimirInforme(html, frameRef, nombre);

    useEffect(() => {
        let cancelado = false;
        void (async () => {
            try {
                const emitido = new Date();
                const logos = await cargarLogosInforme();
                const h = construirHtmlInformeGeneral({ ...armarEntrada(), emitido }, logos);
                if (cancelado) return;
                setNombre(nombreArchivoInformeGeneral(emitido));
                setHtml(h);
            } catch (e) { if (!cancelado) setError(e instanceof Error ? e.message : 'No se pudo generar el informe.'); }
        })();
        return () => { cancelado = true; };
        // El informe es una fotografía del momento en que se abre: no se regenera cuando el Dashboard se actualiza.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (html == null) { setUrlBlob(null); return; }
        const u = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        setUrlBlob(u);
        return () => URL.revokeObjectURL(u);
    }, [html]);

    /** Un PNG por hoja (una sola imagen con todas excedería el límite de lienzo de iOS). */
    const exportarPng = async () => {
        if (!html) return;
        setExportando(true); setError(null);
        try {
            const { htmls, ancho } = htmlPorHoja(html);
            for (let i = 0; i < htmls.length; i++) {
                const png = await rasterizaHtml(htmls[i], { ancho, escala: 2 });
                await guardaOComparte(png, `${nombre}-hoja-${i + 1}-de-${htmls.length}.png`, 'image/png');
            }
        } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar la imagen.'); }
        finally { setExportando(false); }
    };

    return createPortal(
        <div className="ndvi-cfg-overlay">
            <div className="ndvi-cfg ndvi-cfg--previa" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="igs-t" tabIndex={-1}>
                <div className="ndvi-cfg-barra">
                    <h2 id="igs-t">Informe general del sistema</h2>
                    <div className="ndvi-cfg-acc">
                        <button type="button" className="ndvi-cfg-btn" onClick={() => void exportarPng()} disabled={!html || exportando || generando}><ImageDown size={16} aria-hidden="true" /> {exportando ? 'Generando imagen…' : 'Descargar PNG (1 por hoja)'}</button>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--pri" onClick={() => void imprimir()} disabled={!urlBlob || exportando || generando}><Printer size={16} aria-hidden="true" /> {generando ? 'Generando…' : 'Imprimir / PDF'}</button>
                        <button type="button" className="ndvi-cfg-btn ndvi-cfg-btn--icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} aria-hidden="true" /></button>
                    </div>
                </div>
                {errorPdf && !error && <div className="ig-alerta" role="alert">{errorPdf}</div>}
                <div className="ndvi-cfg-marco">
                    {error ? <div className="ndvi-cfg-estado" role="alert"><h3>No se pudo completar la acción</h3><p>{error}</p><button type="button" className="ndvi-cfg-btn" onClick={onCerrar}>Cerrar</button></div>
                        : !urlBlob ? <div className="ndvi-cfg-estado" role="status" aria-busy="true"><p>Armando el informe…</p></div>
                            : <iframe ref={frameRef} title="Vista previa del informe general del sistema" src={urlBlob} />}
                </div>
            </div>
        </div>,
        document.body,
    );
}
