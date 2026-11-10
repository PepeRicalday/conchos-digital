import { memo, type ComponentProps, type ReactNode } from 'react';
import { Kpi } from '../ui/base';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';

type Props = Omit<ComponentProps<typeof Kpi>, 'etiqueta' | 'estado' | 'contexto' | 'viejo' | 'densidad' | 'aria'> & {
    titulo: string;
    estado: EstadoKpi;
    contexto: ReactNode;
    stale?: boolean;
    aria: string;
};

/** Celda de KPI del Dashboard: adaptador del KPI único (densidad «tablero»). Conserva su API para PanelKpis y las tarjetas. */
export const KpiTile = memo(function KpiTile({ titulo, stale, ...resto }: Props) {
    return <Kpi densidad="tablero" etiqueta={titulo} viejo={stale} {...resto} />;
});
