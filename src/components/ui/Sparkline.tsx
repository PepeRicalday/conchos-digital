import { memo, useId } from 'react';
import { segmentosSpark } from '../../utils/dashboardExtra';

interface Props {
    /** Serie con huecos: null = S/D (corta la línea, nunca se dibuja como 0). */
    valores: (number | null)[];
    /** Descripción accesible: qué mide y el periodo (p. ej. "Almacenamiento, últimos 7 días"). */
    etiqueta: string;
    unidad?: string;
    decimales?: number;
    ancho?: number;
    alto?: number;
    color?: string;
    /** Relleno suave bajo la línea (tendencias de más de unos pocos puntos). */
    area?: boolean;
}

/** Sparkline SVG sin ejes: línea con huecos, punto final y texto alternativo con rango. Si todo es S/D no dibuja nada inventado. */
export const Sparkline = memo(function Sparkline({ valores, etiqueta, unidad = '', decimales = 1, ancho = 120, alto = 28, color = 'var(--sc-sky)', area = false }: Props) {
    const id = useId();
    const { segmentos, min, max, ultimo } = segmentosSpark(valores, ancho, alto);
    if (min == null || max == null) {
        return <span className="sc-spark sc-spark-sd" role="img" aria-label={`${etiqueta}: sin datos`}>sin serie</span>;
    }
    const f = (v: number) => v.toFixed(decimales);
    const desc = `${etiqueta}: de ${f(min)} a ${f(max)}${unidad ? ` ${unidad}` : ''}`;
    return (
        <svg className="sc-spark" viewBox={`0 0 ${ancho} ${alto}`} width="100%" height={alto} preserveAspectRatio="none" role="img" aria-labelledby={id}>
            <title id={id}>{desc}</title>
            {area && segmentos.filter((seg) => seg.length > 1).map((seg, i) => (
                <polygon key={`a${i}`} points={`${seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} ${seg[seg.length - 1].x.toFixed(1)},${alto} ${seg[0].x.toFixed(1)},${alto}`} fill={color} fillOpacity={0.16} />
            ))}
            {segmentos.map((seg, i) => (seg.length === 1
                ? <line key={i} x1={seg[0].x} y1={seg[0].y} x2={seg[0].x} y2={seg[0].y} stroke={color} strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                : <polyline key={i} points={seg.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />))}
            {/* Punto final: trazo de punta redonda de largo cero (un <circle> se deforma con preserveAspectRatio="none"). */}
            {ultimo && <line x1={ultimo.x} y1={ultimo.y} x2={ultimo.x} y2={ultimo.y} stroke={color} strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        </svg>
    );
});
