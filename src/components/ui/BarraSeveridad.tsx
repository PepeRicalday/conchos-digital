import { memo } from 'react';

/** Barra apilada de severidad: cada tramo proporcional a su conteo. Un cero no existe (no se pinta un tramo rojo vacío). */
export const BarraSeveridad = memo(function BarraSeveridad({ crit, avisos, info }: { crit: number; avisos: number; info: number }) {
    const total = crit + avisos + info;
    return (
        <div className={`kp-sevbar ${total === 0 ? 'kp-sevbar-0' : ''}`} role="img" aria-label={`Alertas: ${crit} críticas, ${avisos} avisos, ${info} informativas`}>
            {crit > 0 && <i className="kp-s-crit" style={{ flex: crit }} />}
            {avisos > 0 && <i className="kp-s-warn" style={{ flex: avisos }} />}
            {info > 0 && <i className="kp-s-info" style={{ flex: info }} />}
        </div>
    );
});
