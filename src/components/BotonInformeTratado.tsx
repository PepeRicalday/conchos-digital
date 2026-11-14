import { lazy, Suspense, useState } from 'react';
import { Scale } from 'lucide-react';
import type { DatosTratado } from '../hooks/useTratadoCiclo';

// El modal arrastra el generador completo del informe: se carga solo al abrirlo.
const InformeTratadoModal = lazy(() => import('./presas/InformeTratadoModal'));

/**
 * Botón «Informe del Tratado» (Cuenca → Balance y tarjeta del Dashboard): abre la ventana de filtros (periodo y secciones) y de ahí la
 * vista previa, el PDF carta institucional, la infografía PNG y la lámina 17×11.
 */
export default function BotonInformeTratado({ datos, hoyISO, compacto = false }: { datos: DatosTratado | null; hoyISO: string; compacto?: boolean }) {
    const [abierto, setAbierto] = useState(false);
    return (
        <>
            <button type="button" className={compacto ? 'an-btn an-btn--chico' : 'an-btn'} onClick={() => setAbierto(true)} aria-haspopup="dialog" disabled={!datos}
                title="Informe del avance del Tratado de 1944: EUA (IBWC) contra México, por periodo, con indicadores y gráficas">
                <Scale size={14} aria-hidden="true" /> Informe del Tratado
            </button>
            {abierto && datos && <Suspense fallback={null}><InformeTratadoModal datos={datos} hoyISO={hoyISO} onCerrar={() => setAbierto(false)} /></Suspense>}
        </>
    );
}
