import { lazy, Suspense, useState } from 'react';
import { CloudRain } from 'lucide-react';
import type { RedJcas } from '../hooks/useJcasCuenca';
import type { PronosticoCuenca } from '../hooks/useCuencaPronostico';
import type { DemGrid } from '../utils/camposCuenca';

// El modal arrastra el generador completo del informe: se carga solo al abrirlo.
const InformeClimaCuencaModal = lazy(() => import('./presas/InformeClimaCuencaModal'));

/**
 * Botón "Informe de clima" (Presas → Analítica → Cuenca → Planos): abre la ventana de filtros (variables, observado/pronóstico, periodos)
 * y de ahí la vista previa, el PNG compartible, el PDF carta institucional y la lámina 17×11.
 */
export default function BotonInformeClimaCuenca({ red, pron, dem }: { red: RedJcas | null; pron: PronosticoCuenca | null; dem: DemGrid | null }) {
    const [abierto, setAbierto] = useState(false);
    return (
        <>
            <button type="button" className="an-btn" onClick={() => setAbierto(true)} aria-haspopup="dialog" disabled={!red?.contorno}
                title="Informe institucional de clima y pronóstico de la cuenca: isoyetas y planos de temperatura, viento y humedad">
                <CloudRain size={14} aria-hidden="true" /> Informe de clima
            </button>
            {abierto && <Suspense fallback={null}><InformeClimaCuencaModal red={red} pron={pron} dem={dem} onCerrar={() => setAbierto(false)} /></Suspense>}
        </>
    );
}
