import { memo } from 'react';

interface Banda { hasta: number; tipo: 'crit' | 'warn' | 'ok' }
interface Props {
    /** null = S/D: se dibujan las bandas pero sin marca de valor. */
    valor: number | null;
    max: number;
    bandas: Banda[];
    etiqueta: string;
    unidad?: string;
}

/** Bullet chart horizontal: bandas de umbral y una marca de valor. Una lectura rápida de "¿en qué zona estoy?". */
export const BulletChart = memo(function BulletChart({ valor, max, bandas, etiqueta, unidad = '' }: Props) {
    let desde = 0;
    const tramos = bandas.map((b) => { const t = { ...b, desde, ancho: Math.max(0, Math.min(b.hasta, max) - desde) }; desde = Math.min(b.hasta, max); return t; });
    const pos = valor == null ? null : Math.max(0, Math.min(valor, max)) / max * 100;
    return (
        <div className="kp-bullet" role="img" aria-label={`${etiqueta}: ${valor == null ? 'sin dato' : `${valor.toFixed(0)} ${unidad}`}; zonas ${bandas.map((b, i) => `${i === 0 ? 0 : bandas[i - 1].hasta} a ${b.hasta} ${unidad}`).join(', ')}`}>
            {tramos.map((t, i) => <i key={i} className={`kp-b-${t.tipo}`} style={{ left: `${(t.desde / max) * 100}%`, width: `${(t.ancho / max) * 100}%` }} />)}
            {pos != null && <u style={{ left: `${pos}%` }} />}
        </div>
    );
});
