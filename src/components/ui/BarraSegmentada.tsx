import { memo } from 'react';

interface Props {
    /** % entregado (puede pasar de 100); null = S/D. */
    pct: number | null;
    /** Marcador del tiempo transcurrido; null = no se muestra (p. ej. ciclo concluido). */
    marcaPct?: number | null;
    /** Ciclo concluido: lo no entregado se dibuja rayado ("sin entregar"). */
    concluido?: boolean;
    etiqueta: string;
}

const N = 20;

/** 20 segmentos de 5 %: lo entregado, lo pendiente (rayado si el ciclo ya terminó) y el marcador de tiempo. */
export const BarraSegmentada = memo(function BarraSegmentada({ pct, marcaPct = null, concluido = false, etiqueta }: Props) {
    const sobre = pct != null && pct > 100;
    return (
        <div className={`kp-segs ${pct == null ? 'kp-segs-sd' : ''}`} role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct == null ? undefined : Math.round(pct)}
            aria-valuetext={pct == null ? 'Sin dato' : `${pct.toFixed(1)} por ciento entregado${concluido ? `; ${Math.max(0, 100 - pct).toFixed(1)} por ciento sin entregar` : ''}${marcaPct != null ? `; tiempo transcurrido ${marcaPct.toFixed(0)} por ciento` : ''}`}>
            {Array.from({ length: N }, (_, i) => {
                const lleno = pct != null && (i + 0.5) * (100 / N) <= pct;
                const clase = lleno ? (sobre ? 'kp-seg-sobre' : 'kp-seg-lleno') : concluido && pct != null ? 'kp-seg-pend' : '';
                return <i key={i} className={clase} />;
            })}
            {marcaPct != null && <u style={{ left: `${Math.min(100, marcaPct)}%` }} title={`Tiempo transcurrido ${marcaPct.toFixed(0)} %`} />}
        </div>
    );
});
