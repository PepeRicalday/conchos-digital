import { memo } from 'react';
import { UMBRAL_CRITICO_PCT, UMBRAL_BAJO_PCT } from '../../utils/presaNiveles';

export interface ColumnaEmbalse { nombre: string; pct: number | null; capacidadMm3: number; alerta: boolean }

/** Una columna de nivel por presa: ancho proporcional a su capacidad, bandas de umbral y relleno del color de su estado. */
export const ColumnasEmbalse = memo(function ColumnasEmbalse({ items }: { items: ColumnaEmbalse[] }) {
    const maxCap = Math.max(1, ...items.map((i) => i.capacidadMm3));
    const H = 60;
    return (
        <div className="kp-cols" role="img" aria-label={`Nivel de embalse: ${items.map((i) => `${i.nombre} ${i.pct == null ? 'sin dato' : `${i.pct.toFixed(1)} por ciento`}`).join('; ')}. Zonas: crítico bajo ${UMBRAL_CRITICO_PCT} por ciento, bajo bajo ${UMBRAL_BAJO_PCT}`}>
            {items.map((i) => {
                const tipo = i.pct == null ? 'sd' : i.pct < UMBRAL_CRITICO_PCT ? 'crit' : i.pct < UMBRAL_BAJO_PCT ? 'warn' : i.alerta ? 'crit' : 'ok';
                const w = 18 + (i.capacidadMm3 / maxCap) * 22;
                const alto = i.pct == null ? 0 : Math.max(0, Math.min(i.pct, 100)) / 100 * H;
                return (
                    <div key={i.nombre} className="kp-col" style={{ flex: `${w} 1 0` }}>
                        <svg viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true" className={i.pct == null ? 'kp-col-sd' : ''}>
                            <rect x={0} y={0} width={w} height={H} rx={4} className="kp-col-pista" />
                            <rect x={0} y={H * (1 - UMBRAL_CRITICO_PCT / 100)} width={w} height={H * UMBRAL_CRITICO_PCT / 100} className="kp-banda-crit" />
                            <rect x={0} y={H * (1 - UMBRAL_BAJO_PCT / 100)} width={w} height={H * (UMBRAL_BAJO_PCT - UMBRAL_CRITICO_PCT) / 100} className="kp-banda-warn" />
                            {alto > 0 && <rect x={0} y={H - alto} width={w} height={alto} rx={3} className={`kp-col-agua kp-col-${tipo}`} />}
                            <line x1={0} x2={w} y1={H * (1 - UMBRAL_BAJO_PCT / 100)} y2={H * (1 - UMBRAL_BAJO_PCT / 100)} className="kp-col-marca" />
                        </svg>
                        <b className={`kp-col-pct kp-t-${tipo}`}>{i.pct == null ? 'S/D' : `${i.pct.toFixed(0)}%`}</b>
                        <span className="kp-col-nombre">{i.nombre}</span>
                    </div>
                );
            })}
        </div>
    );
});
