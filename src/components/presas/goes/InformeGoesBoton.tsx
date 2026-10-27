import { lazy, Suspense, useState } from 'react';
import { FileBarChart } from 'lucide-react';
import type { EstacionHidro, VentanaHidro } from '../../../utils/hidroEstaciones';

// El modal arrastra el generador completo del informe: se carga solo al abrirlo.
const InformeGoesModal = lazy(() => import('./InformeGoesModal'));

export interface InformeGoesBotonProps {
    estaciones: EstacionHidro[];
    /** Ventana activa en la pantalla: es el periodo inicial de los filtros del informe. */
    ventana: VentanaHidro;
}

/** Botón "Informe" de la vista Estaciones GOES: abre filtros (estaciones, periodo, secciones, Básico/Técnico) y la vista previa. */
export default function InformeGoesBoton({ estaciones, ventana }: InformeGoesBotonProps) {
    const [abierto, setAbierto] = useState(false);
    return (
        <>
            <button type="button" className="goes-btn" onClick={() => setAbierto(true)} aria-haspopup="dialog"
                title="Informe institucional de las estaciones hidrométricas GOES">
                <FileBarChart size={14} aria-hidden="true" /> Informe
            </button>
            {abierto && <Suspense fallback={null}><InformeGoesModal estaciones={estaciones} ventanaInicial={ventana} onCerrar={() => setAbierto(false)} /></Suspense>}
        </>
    );
}
