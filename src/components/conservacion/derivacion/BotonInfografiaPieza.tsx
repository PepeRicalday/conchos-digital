import { useState } from 'react';
import { ImageDown, Loader2 } from 'lucide-react';
import type { ComprobacionPieza, GrupoSel } from '../../../conservacion/verificacion/porPieza';
import { vistaDeGrupo } from '../../../conservacion/verificacion/porPieza';
import { assetToDataURI } from '../../../utils/assetToDataURI';
import { guardaOComparte } from '../../../utils/descargaArchivo';
import { rasterizaHtml } from '../../../utils/rasterizaHtml';
import { hoyIso } from '../../../utils/infografiaComprobacion';
import { ANCHO_COMPROBACION } from '../../../utils/infografiaComprobacionHtml';
import { htmlInfografiaPiezaConcepto, htmlInfografiaPiezaGrupo, nombreArchivoGrupoPieza, nombreArchivoPieza } from '../../../utils/infografiaPieza';

type Props = { ambito: string; red: string; c: ComprobacionPieza } & ({ tipo: 'concepto' } | { tipo: 'grupo'; sel: GrupoSel });

/** Genera la infografía (PNG a 2x de 1080 px) del concepto de obras puntuales o del grupo elegido, con la misma plantilla que las de tramo. */
export function BotonInfografiaPieza(props: Props) {
    const [generando, setGenerando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);
    const etiqueta = props.tipo === 'concepto' ? 'Infografía del concepto' : 'Infografía del grupo';

    const generar = async () => {
        if (generando) return;
        setGenerando(true);
        setAviso(null);
        try {
            const fecha = hoyIso();
            const logo = await assetToDataURI('/logos/logo-srl.png');
            const ctx = { fecha, logo, ambito: props.ambito, red: props.red, canal: null };
            let html: string;
            let nombre: string;
            if (props.tipo === 'concepto') {
                html = htmlInfografiaPiezaConcepto(props.c, ctx);
                nombre = nombreArchivoPieza(props.c, fecha);
            } else {
                html = htmlInfografiaPiezaGrupo(props.c, props.sel, ctx);
                nombre = nombreArchivoGrupoPieza(props.c, vistaDeGrupo(props.c, props.sel).rotulo, fecha);
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
                title={props.tipo === 'concepto' ? 'Genera una imagen del concepto de obras puntuales para enviar por mensaje' : 'Genera una imagen del grupo elegido (familia, tipo o todo el concepto)'}>
                {generando ? <Loader2 size={16} className="cons-der-gira" aria-hidden="true" /> : <ImageDown size={16} aria-hidden="true" />}
                {generando ? 'Generando…' : etiqueta}
            </button>
            {aviso && <span role="alert" className="cons-infografia-aviso">{aviso}</span>}
        </>
    );
}
