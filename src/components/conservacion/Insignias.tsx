import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { Severidad } from '../../conservacion/nucleo';
import { MOTIVO_CORTO_REGLA, TEXTO_SEVERIDAD, type EstadoReglaVista } from '../../conservacion/informe/vistas';
import { desdeRegla } from '../../conservacion/vocabulario';
import { InsigniaEstado } from './derivacion/formato';

const ICO_SEV = { alta: AlertTriangle, media: AlertCircle, informativa: Info } as const;

/** Severidad con icono y texto: el estado nunca depende solo del color. */
export function InsigniaSeveridad({ severidad }: { severidad: Severidad }) {
    const Ico = ICO_SEV[severidad];
    return <span className={`cons-ins cons-ins-${severidad}`}><Ico size={13} aria-hidden="true" /> {TEXTO_SEVERIDAD[severidad]}</span>;
}

export function InsigniaEstadoRegla({ estado }: { estado: EstadoReglaVista }) {
    // «No implementada», «Sin datos»… ya no son estados: son «No evaluable» con su motivo a la vista.
    return <InsigniaEstado e={desdeRegla(estado)} tono={estado === 'error_interno' ? 'alerta' : undefined} motivoCorto={MOTIVO_CORTO_REGLA[estado]} />;
}
