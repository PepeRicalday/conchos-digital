import { memo, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Radio } from 'lucide-react';
import type { ChipEstado, SeveridadChip } from '../../utils/alertasVivas';

const ICONO: Record<SeveridadChip, typeof Radio> = { crit: AlertTriangle, warn: Clock, info: Radio, ok: CheckCircle2 };

interface Props {
    /** Línea pequeña sobre el título (módulo / contexto). */
    kicker: string;
    titulo: string;
    subtitulo?: ReactNode;
    /** Chips de estado: frescura de las fuentes, avisos (icono + texto, nunca solo color). */
    chips?: ChipEstado[];
    /** Botones o controles a la derecha (selector de semana, actualizar, imprimir…). */
    acciones?: ReactNode;
    id?: string;
}

/** Cabecera común de las pantallas operativas: un solo `h1` por página, mismo lenguaje que el Dashboard. */
export const PaginaHero = memo(function PaginaHero({ kicker, titulo, subtitulo, chips, acciones, id = 'sc-pagina-t' }: Props) {
    return (
        <header className="sc-hero" aria-labelledby={id}>
            <div className="sc-hero-top">
                <div>
                    <span className="sc-kicker">{kicker}</span>
                    <h1 id={id} className="sc-titulo">{titulo}</h1>
                    {subtitulo && <p className="sc-hero-sub">{subtitulo}</p>}
                </div>
                {acciones && <div className="sc-acciones">{acciones}</div>}
            </div>
            {chips && chips.length > 0 && (
                <ul className="sc-chips" aria-label="Estado de las fuentes" aria-live="polite">
                    {chips.map((c) => {
                        const Ico = ICONO[c.sev];
                        return <li key={c.key} className={`sc-chip sc-chip-${c.sev}`}><Ico size={12} aria-hidden="true" /> {c.texto}</li>;
                    })}
                </ul>
            )}
        </header>
    );
});
