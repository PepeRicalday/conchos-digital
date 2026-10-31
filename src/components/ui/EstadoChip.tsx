import { memo } from 'react';
import { CircleCheck, TriangleAlert, OctagonAlert, Info, CircleHelp } from 'lucide-react';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';

const ICONO = { ok: CircleCheck, warn: TriangleAlert, crit: OctagonAlert, info: Info, sd: CircleHelp } as const;

/** Estado de un KPI: icono + texto + color (el color nunca es el único portador del significado). */
export const EstadoChip = memo(function EstadoChip({ estado }: { estado: EstadoKpi }) {
    const I = ICONO[estado.tipo];
    return <span className={`kp-estado kp-${estado.tipo}`}><I size={13} aria-hidden="true" />{estado.corto ? <><span className="kp-largo">{estado.texto}</span><span className="kp-corto">{estado.corto}</span></> : estado.texto}</span>;
});
