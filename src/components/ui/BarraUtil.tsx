import { memo } from 'react';
import type { PresaSuficiencia } from '../../utils/suficiencia';

/** Por presa: volumen muerto (rayado), útil (azul) y vacío hasta el NAMO (tenue). Cada barra usa su propia capacidad. */
export const BarraUtil = memo(function BarraUtil({ presas }: { presas: PresaSuficiencia[] }) {
    return (
        <ul className="kp-util" aria-label="Volumen útil por presa">
            {presas.map((p) => {
                const cap = p.capacidadMm3 > 0 ? p.capacidadMm3 : null;
                const completo = p.almacenadoMm3 != null && p.muertoMm3 != null && cap != null;
                const w = (v: number) => `${Math.max(0, Math.min(100, (v / (cap as number)) * 100))}%`;
                const nombre = p.nombre.length > 12 ? p.nombre.split(' ').slice(-1)[0] : p.nombre;
                return (
                    <li key={p.id} aria-label={completo ? `${p.nombre}: ${(p.utilMm3 as number).toFixed(0)} Mm³ útiles de ${cap!.toFixed(0)}${p.muertoOficial ? '' : ' (volumen muerto estimado)'}` : `${p.nombre}: sin dato`}>
                        <span className="kp-util-n">{nombre}</span>
                        <div className={`kp-util-barra ${completo ? '' : 'kp-util-sd'}`} aria-hidden="true">
                            {completo && <><i className="kp-u-muerto" style={{ width: w(p.muertoMm3 as number) }} /><i className="kp-u-util" style={{ width: w((p.almacenadoMm3 as number) - (p.muertoMm3 as number)) }} /></>}
                        </div>
                        <b className="kp-util-v" title={p.muertoOficial ? undefined : 'Volumen muerto estimado (piso de la curva): no es un dato oficial'}>{completo ? `${(p.utilMm3 as number).toFixed(0)}${p.muertoOficial ? '' : '*'}` : 'S/D'}</b>
                    </li>
                );
            })}
        </ul>
    );
});
