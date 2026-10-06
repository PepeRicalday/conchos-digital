import { memo } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Printer, Radio } from 'lucide-react';
import type { ChipEstado, SeveridadChip } from '../../utils/alertasVivas';

const ICONO: Record<SeveridadChip, typeof Radio> = { crit: AlertTriangle, warn: Clock, info: Radio, ok: CheckCircle2 };

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
        <header className="sc-hero" aria-labelledby="sc-hero-t">
            <div className="sc-hero-top">
                <div>
                    <span className="sc-kicker">Unidad Conchos · S. de R.L. de I.P. y C.V.</span>
                    <h2 id="sc-hero-t">Centro de control</h2>
                    <p className="sc-hero-sub">Distrito de Riego 005 Delicias — {esHoy ? 'Hoy' : fechaTexto}</p>
                </div>
                <div className="sc-acciones">
                    <button type="button" className="sc-btn" onClick={onMonitor}><Activity size={16} aria-hidden="true" /> Monitor Público</button>
                    <button type="button" className="sc-btn sc-btn-primario" onClick={onImprimir}><Printer size={16} aria-hidden="true" /> Generar reporte digital</button>
                </div>
            </div>
            <ul className="sc-chips" aria-label="Estado del sistema" aria-live="polite">
                {chips.map((c) => {
                    const Ico = ICONO[c.sev];
                    return <li key={c.key} className={`sc-chip sc-chip-${c.sev}`}><Ico size={12} aria-hidden="true" /> {c.texto}</li>;
                })}
            </ul>
        </header>
    );
});
