import { ArrowRight } from 'lucide-react';
import type { DestinoTramo } from '../../../conservacion/verificacion/revision';
import './centro-revision.css';

interface Props {
    destino: DestinoTramo | null;
    abrir: (d: DestinoTramo) => void;
    /** Texto del botón; por defecto «Abrir tramo». */
    texto?: string;
    /** Frase para lectores de pantalla: qué tramo abre. */
    etiqueta: string;
    /** Dentro de un <summary>: el clic no debe abrir ni cerrar el desplegable. */
    enSummary?: boolean;
}

/** Botón único hacia «Comprobación por tramo» ya posicionada. Sin cálculo por tramo, lo dice en vez de desaparecer. */
export function BotonAbrirTramo({ destino, abrir, texto = 'Abrir tramo', etiqueta, enSummary = false }: Props) {
    if (destino === null) return <span className="cr-sin" title="El tramo no tiene ficha de inventario o cifra para recalcularlo">Sin cálculo por tramo</span>;
    return (
        <button type="button" className="sc-btn cr-abrir" aria-label={etiqueta}
            onClick={(e) => { if (enSummary) { e.preventDefault(); e.stopPropagation(); } abrir(destino); }}>
            {texto} <ArrowRight size={16} aria-hidden="true" />
        </button>
    );
}
