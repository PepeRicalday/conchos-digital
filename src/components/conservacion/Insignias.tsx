import { AlertCircle, AlertTriangle, CheckCircle2, CircleDashed, Info, MinusCircle, XCircle } from 'lucide-react';
import type { Severidad } from '../../conservacion/nucleo';
import { TEXTO_ESTADO_REGLA, TEXTO_SEVERIDAD, type EstadoReglaVista } from '../../conservacion/informe/vistas';

const ICO_SEV = { alta: AlertTriangle, media: AlertCircle, informativa: Info } as const;

/** Severidad con icono y texto: el estado nunca depende solo del color. */
export function InsigniaSeveridad({ severidad }: { severidad: Severidad }) {
    const Ico = ICO_SEV[severidad];
    return <span className={`cons-ins cons-ins-${severidad}`}><Ico size={13} aria-hidden="true" /> {TEXTO_SEVERIDAD[severidad]}</span>;
}

const ICO_ESTADO: Record<EstadoReglaVista, { ico: typeof Info; clase: string }> = {
    superada: { ico: CheckCircle2, clase: 'cons-ins-ok' },
    hallazgo: { ico: AlertTriangle, clase: 'cons-ins-media' },
    no_evaluable: { ico: MinusCircle, clase: 'cons-ins-sd' },
    sin_datos: { ico: MinusCircle, clase: 'cons-ins-sd' },
    error_interno: { ico: XCircle, clase: 'cons-ins-alta' },
    no_aplica: { ico: MinusCircle, clase: 'cons-ins-sd' },
    no_ejecutada: { ico: MinusCircle, clase: 'cons-ins-sd' },
    no_implementada: { ico: CircleDashed, clase: 'cons-ins-sd' },
};

export function InsigniaEstadoRegla({ estado }: { estado: EstadoReglaVista }) {
    const { ico: Ico, clase } = ICO_ESTADO[estado];
    return <span className={`cons-ins ${clase}`}><Ico size={13} aria-hidden="true" /> {TEXTO_ESTADO_REGLA[estado]}</span>;
}
