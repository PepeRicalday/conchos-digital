import { useState } from 'react';
import { ImageDown, Loader2 } from 'lucide-react';
import type { Comprobacion } from '../../../conservacion/verificacion/comprobacion';
import type { CriterioInferido } from '../../../conservacion/verificacion/criterio';
import { assetToDataURI } from '../../../utils/assetToDataURI';
import { guardaOComparte } from '../../../utils/descargaArchivo';
import { rasterizaHtml } from '../../../utils/rasterizaHtml';
import { construirDatosConcepto, hoyIso, nombreArchivoConcepto, nombreArchivoTramo } from '../../../utils/infografiaComprobacion';
import { conTrazo, type ModeloCanal } from './ubicacionModelo';
import { obtenerTrazo } from './TrazoContext';
import { ANCHO_COMPROBACION, htmlInfografiaConcepto, htmlInfografiaTramo } from '../../../utils/infografiaComprobacionHtml';

interface Comun { ambito: string; red: string; /** Perfil y ubicación de la pantalla: la infografía cuenta lo mismo. */ modelo?: ModeloCanal | null }
type Props = Comun & (
    | { tipo: 'tramo'; comprobacion: Comprobacion }
    | { tipo: 'concepto'; filas: readonly Comprobacion[]; crit: CriterioInferido }
);

/** Botón que genera la infografía (PNG a 2x de 1080 px) del tramo en pantalla o del resumen del concepto, y la descarga o abre Compartir en iOS. */
export function BotonInfografiaComprobacion(props: Props) {
    const [generando, setGenerando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);
    const etiqueta = props.tipo === 'tramo' ? 'Infografía del tramo' : 'Infografía del concepto';

    const generar = async () => {
        if (generando) return;
        setGenerando(true);
        setAviso(null);
        try {
            const fecha = hoyIso();
            const logo = await assetToDataURI('/logos/logo-srl.png'); // '' si falla: la plantilla lo omite
            // El contorno real viaja incrustado en el SVG (el PNG no tiene red): se espera al trazo y se reconstruye el modelo con él, igual que la ventana de ubicación.
            const tz = await obtenerTrazo();
            const canal = props.modelo ? conTrazo(props.modelo, tz.trazo) : null;
            const ctx = { fecha, logo, ambito: props.ambito, red: props.red, canal };
            let html: string;
            let nombre: string;
            if (props.tipo === 'tramo') {
                html = htmlInfografiaTramo(props.comprobacion, ctx);
                nombre = nombreArchivoTramo(props.comprobacion.fila, fecha);
            } else {
                const datos = construirDatosConcepto(props.filas, props.crit, ctx);
                html = htmlInfografiaConcepto(datos, ctx);
                nombre = nombreArchivoConcepto(datos.concepto, fecha);
            }
            const png = await rasterizaHtml(html, { ancho: ANCHO_COMPROBACION, escala: 2 });
            await guardaOComparte(png, nombre, 'image/png');
        } catch (e) {
            setAviso(e instanceof Error ? e.message : 'No se pudo generar la infografía.');
        } finally {
            setGenerando(false);
        }
    };

    return (
        <>
            <button type="button" className="sc-btn cons-infografia" onClick={generar} disabled={generando} aria-busy={generando}
                title={props.tipo === 'tramo' ? 'Genera una imagen de la cuenta de este tramo para enviar por mensaje' : 'Genera una imagen del resumen de este concepto en todo el canal'}>
                {generando ? <Loader2 size={16} className="cons-der-gira" aria-hidden="true" /> : <ImageDown size={16} aria-hidden="true" />}
                {generando ? 'Generando…' : etiqueta}
            </button>
            {aviso && <span role="alert" className="cons-infografia-aviso">{aviso}</span>}
        </>
    );
}
