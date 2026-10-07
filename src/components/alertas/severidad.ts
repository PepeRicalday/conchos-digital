import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { Severidad } from '../../utils/alertasPantalla';

/** Severidad → etiqueta, clase y icono. Siempre icono + texto: el color nunca es el único canal. */
export const SEVERIDAD: Record<Severidad, { etiqueta: string; cls: 'crit' | 'warn' | 'info'; Icono: typeof XCircle }> = {
    critical: { etiqueta: 'Crítica', cls: 'crit', Icono: XCircle },
    warning: { etiqueta: 'Aviso', cls: 'warn', Icono: AlertTriangle },
    info: { etiqueta: 'Info', cls: 'info', Icono: Info },
};

export const sevDe = (t: string): Severidad => (t === 'critical' || t === 'warning' ? t : 'info');
