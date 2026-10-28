import { lazy, Suspense, useState } from 'react';
import { ImageDown } from 'lucide-react';
import type { EstacionHidro, VentanaHidro } from '../../../utils/hidroEstaciones';

// El modal arrastra el generador de la infografía, el mapa y las exportaciones: se carga solo al abrirlo.
const InfografiaGoesModal = lazy(() => import('./InfografiaGoesModal'));

export interface InfografiaGoesBotonProps {
    estaciones: EstacionHidro[];
    /** Ventana activa en la pantalla: es el periodo inicial de los filtros. */
    ventana: VentanaHidro;
}

/**
 * Botón "Infografía" de la vista Estaciones GOES: abre los filtros (formato resumen o técnico, estaciones, periodo, plano,
 * vasos de presa, estadística…) y la vista previa, con salida en imagen, HTML o PDF.
 */
export default function InfografiaGoesBoton({ estaciones, ventana }: InfografiaGoesBotonProps) {
    const [abierto, setAbierto] = useState(false);
    return (
        <>
            <button type="button" className="goes-btn" onClick={() => setAbierto(true)} aria-haspopup="dialog"
                title="Infografía de las estaciones: resumen para enviar por mensaje o fichas técnicas, en imagen, HTML o PDF">
                <ImageDown size={14} aria-hidden="true" /> Infografía
            </button>
            {abierto && <Suspense fallback={null}><InfografiaGoesModal estaciones={estaciones} ventanaInicial={ventana} onCerrar={() => setAbierto(false)} /></Suspense>}
        </>
    );
}
