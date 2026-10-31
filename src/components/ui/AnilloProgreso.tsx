import { memo } from 'react';

interface Props {
    /** 0-100 o null (S/D: anillo rayado, nunca un 0 relleno). */
    pct: number | null;
    /** Texto accesible completo ("Llenado de Presa X"). */
    etiqueta: string;
    /** Marcas de referencia en % (p. ej. umbral alto/bajo). */
    marcas?: { pct: number; texto: string }[];
    alerta?: boolean;
    tamano?: number;
}

const R = 42;
const C = 2 * Math.PI * R;

/** Anillo de progreso SVG con cifra al centro; el estado no depende solo del color (texto + marcas con título). */
export const AnilloProgreso = memo(function AnilloProgreso({ pct, etiqueta, marcas = [], alerta = false, tamano = 96 }: Props) {
    const v = pct == null ? null : Math.max(0, Math.min(100, pct));
    const punto = (p: number) => { const a = (p / 100) * 2 * Math.PI - Math.PI / 2; return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) }; };
    return (
        <div className="sc-anillo" style={{ width: tamano, height: tamano }} role="progressbar" aria-label={etiqueta}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={v == null ? undefined : Math.round(v)}
            aria-valuetext={v == null ? 'Sin dato' : `${v.toFixed(1)} por ciento`}>
            <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r={R} className={v == null ? 'sc-anillo-pista sc-anillo-sd' : 'sc-anillo-pista'} />
                {v != null && v > 0 && (
                    <circle cx="50" cy="50" r={R} className={`sc-anillo-valor ${alerta ? 'sc-anillo-alerta' : ''}`}
                        strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 50 50)" />
                )}
                {marcas.map((m) => { const a = punto(m.pct); const b = { x: 50 + (a.x - 50) * 0.84, y: 50 + (a.y - 50) * 0.84 }; return (
                    <line key={m.texto} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="sc-anillo-marca"><title>{m.texto}</title></line>
                ); })}
            </svg>
            <span className={`sc-anillo-cifra ${v == null ? 'sc-anillo-cifra-sd' : ''}`}>{v == null ? 'S/D' : <>{v.toFixed(1)}<small>%</small></>}</span>
        </div>
    );
});
