import { lazy, Suspense, useState } from 'react';
import { FileBarChart } from 'lucide-react';

// El modal arrastra el generador completo del informe: se carga solo al abrirlo.
const InformeNivelTendenciaModal = lazy(() => import('./presas/InformeNivelTendenciaModal'));

/**
 * Botón "Informe nivel y tendencia" de la página Presas: abre la ventana de filtros (presa, mes, años de comparación)
 * y de ahí la vista previa, el PNG compartible y el PDF institucional.
 */
export default function BotonInformeNivelTendencia() {
    const [abierto, setAbierto] = useState(false);
    return (
        <>
            <button type="button" className="scada-action-btn" onClick={() => setAbierto(true)}
                title="Informe institucional: nivel actual, tendencia del mes y comparación con años anteriores" aria-haspopup="dialog">
                <FileBarChart size={11} />Informe nivel y tendencia
            </button>
            {abierto && <Suspense fallback={null}><InformeNivelTendenciaModal onCerrar={() => setAbierto(false)} /></Suspense>}
        </>
    );
}
