import { memo } from 'react';
import { Activity, Printer } from 'lucide-react';
import { PaginaHero } from '../ui/PaginaHero';
import type { ChipEstado } from '../../utils/alertasVivas';

interface Props {
    fechaTexto: string;
    esHoy: boolean;
    chips: ChipEstado[];
    onMonitor: () => void;
    onImprimir: () => void;
}

/** Cabecera de la sala de control: identidad, fecha, estado del sistema (chips con icono + texto) y acciones. */
export const HeroCentro = memo(function HeroCentro({ fechaTexto, esHoy, chips, onMonitor, onImprimir }: Props) {
    return (
        <PaginaHero
            kicker="Unidad Conchos · S. de R.L. de I.P. y C.V."
            titulo="Centro de control"
            subtitulo={`Distrito de Riego 005 Delicias — ${esHoy ? 'Hoy' : fechaTexto}`}
            chips={chips}
            id="sc-hero-t"
            acciones={<>
                <button type="button" className="sc-btn" onClick={onMonitor}><Activity size={16} aria-hidden="true" /> Monitor Público</button>
                <button type="button" className="sc-btn sc-btn-primario" onClick={onImprimir}><Printer size={16} aria-hidden="true" /> Generar reporte digital</button>
            </>}
        />
    );
});
