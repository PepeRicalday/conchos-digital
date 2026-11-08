import { lazy, Suspense, useState } from 'react';
import { FileBarChart } from 'lucide-react';
import type { CuencaConchos } from '../hooks/useAqwpCuenca';

// El modal arrastra el generador completo del informe: se carga solo al abrirlo.
const InformeCuencaModal = lazy(() => import('./presas/InformeCuencaModal'));

/**
 * Botón "Informe de la cuenca" (Presas → Analítica → Cuenca del Conchos): abre la ventana de filtros (presas, tamaño, datos,
 * orden, periodo) y de ahí la vista previa, el PNG compartible, el PDF carta institucional y la lámina 17×11.
 */
export default function BotonInformeCuenca({ datos }: { datos: CuencaConchos }) {
    const [abierto, setAbierto] = useState(false);
    return (
        <>
            <button type="button" className="an-btn" onClick={() => setAbierto(true)} aria-haspopup="dialog"
                title="Informe institucional de la cuenca con filtros de presas, tamaño y datos">
                <FileBarChart size={14} aria-hidden="true" /> Informe de la cuenca
            </button>
            {abierto && <Suspense fallback={null}><InformeCuencaModal datos={datos} onCerrar={() => setAbierto(false)} /></Suspense>}
        </>
    );
}
