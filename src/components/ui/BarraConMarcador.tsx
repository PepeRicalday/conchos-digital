import { memo } from 'react';

interface Props {
    /** Valor de la barra en % (puede pasar de 100); null = S/D (barra rayada). */
    pct: number | null;
    /** Marcador de referencia en % (p. ej. avance del ciclo); null = sin marcador. */
    marcaPct?: number | null;
    marcaTexto?: string;
    etiqueta: string;
    alerta?: boolean;
}

/** Barra de progreso con un marcador vertical de referencia: la comparación de dos porcentajes se lee por posición. */
export const BarraConMarcador = memo(function BarraConMarcador({ pct, marcaPct = null, marcaTexto = 'Referencia', etiqueta, alerta = false }: Props) {
    const escala = Math.max(100, pct ?? 0, marcaPct ?? 0);
    const w = (v: number) => `${(Math.min(v, escala) / escala) * 100}%`;
    return (
        <div className={`kp-barra ${pct == null ? 'kp-barra-sd' : ''}`} role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={pct == null ? undefined : Math.round(pct)}
            aria-valuetext={pct == null ? 'Sin dato' : `${pct.toFixed(1)} por ciento${marcaPct != null ? `; ${marcaTexto} ${marcaPct.toFixed(0)} por ciento` : ''}`}>
            {pct != null && <i className={alerta ? 'kp-alerta' : ''} style={{ width: w(pct) }} />}
            {marcaPct != null && <u style={{ left: w(marcaPct) }} title={`${marcaTexto} ${marcaPct.toFixed(0)} %`} />}
            {escala > 100 && <s style={{ left: w(100) }} title="Límite autorizado (100 %)" />}
        </div>
    );
});
