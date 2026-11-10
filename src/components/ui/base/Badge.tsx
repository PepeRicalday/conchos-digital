import { memo, type ReactNode } from 'react';
import { CircleCheck, TriangleAlert, OctagonAlert, Info, CircleHelp } from 'lucide-react';
import type { EstadoTipo } from '../../../types/estado';

const ICONO = { ok: CircleCheck, warn: TriangleAlert, crit: OctagonAlert, info: Info, sd: CircleHelp } as const;

/** Insignia de estado: icono + texto + tono (el color nunca es el único portador del significado). */
export const Insignia = memo(function Insignia({ tipo, children, sinIcono = false, icono, className }: {
    tipo: EstadoTipo; children: ReactNode; sinIcono?: boolean; /** Icono propio (p. ej. el de la severidad); por defecto el del estado. */ icono?: ReactNode; className?: string;
}) {
    const I = ICONO[tipo];
    return (
        <span className={['ui-badge', `ui-badge--${tipo}`, className].filter(Boolean).join(' ')}>
            {!sinIcono && (icono ?? <I size={13} aria-hidden="true" />)}
            {children}
        </span>
    );
});
