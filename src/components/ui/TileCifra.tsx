import { memo, type ReactNode } from 'react';
import { Kpi } from './base';
import type { EstadoVisual } from '../../utils/eficienciaCanal';

interface Props {
    etiqueta: string;
    icono?: ReactNode;
    /** Valor ya formateado; null = "S/D". */
    valor: string | null;
    unidad?: string;
    /** Líneas de contexto (fuente, cobertura, comparación). */
    lineas?: ReactNode[];
    /** Pie con procedencia/antigüedad del dato. */
    frescura?: string | null;
    frescuraVieja?: boolean;
    /** Color de acento superior (variable CSS o color). */
    acento?: string;
    /** Estado textual junto al valor (nunca solo color). */
    estado?: { texto: string; tipo: EstadoVisual } | null;
    aria?: string;
}

/** Tarjeta de cifra de página: adaptador del KPI único (densidad «normal»). Estática, sin enlace. */
export const TileCifra = memo(function TileCifra({ frescura, frescuraVieja, ...resto }: Props) {
    return <Kpi densidad="normal" fresco={frescura} viejo={frescuraVieja} {...resto} />;
});
