import { memo, useMemo } from 'react';
import type { AlertaFila } from '../../utils/alertasPantalla';
import { MAX_KM_CANAL, etiquetaCategoria, kmDeAlerta, lugarDeAlerta } from '../../utils/alertasPantalla';
import { sevDe } from './severidad';

const MARCAS_KM = [0, 23, 34, 57, 80, 104];

interface Props {
    alertas: AlertaFila[];
    lugarActivo: string | null;
    onFiltrarLugar: (lugar: string | null) => void;
}

/**
 * Franja del canal K0–K104 con las alertas que SÍ traen km, y debajo un carril "Sin ubicación en el canal" con chips por
 * lugar (las agroclimáticas son por módulo/estación, no tienen km). Texto en HTML (≥ 11 px reales), no en un SVG escalado.
 */
export const CanalAlertas = memo(function CanalAlertas({ alertas, lugarActivo, onFiltrarLugar }: Props) {
    const { pins, sinKm } = useMemo(() => {
        const conKm = new Map<number, { km: number; n: number; peor: 'critical' | 'warning' | 'info'; titulos: string[] }>();
        const sin = new Map<string, { n: number; peor: 'critical' | 'warning' | 'info' }>();
        const peso = { critical: 0, warning: 1, info: 2 } as const;
        for (const a of alertas) {
            const sev = sevDe(a.tipo_riesgo);
            const km = kmDeAlerta(a);
            if (km != null) {
                const k = Math.round(km);
                const p = conKm.get(k) ?? { km: k, n: 0, peor: sev, titulos: [] };
                p.n++; p.titulos.push(a.titulo);
                if (peso[sev] < peso[p.peor]) p.peor = sev;
                conKm.set(k, p);
            } else {
                const lugar = lugarDeAlerta(a) ?? etiquetaCategoria(a.categoria);
                const c = sin.get(lugar) ?? { n: 0, peor: sev };
                c.n++;
                if (peso[sev] < peso[c.peor]) c.peor = sev;
                sin.set(lugar, c);
            }
        }
        return {
            pins: [...conKm.values()],
            sinKm: [...sin.entries()].map(([lugar, v]) => ({ lugar, ...v })).sort((a, b) => b.n - a.n),
        };
    }, [alertas]);

    return (
        <div className="al-canal">
            <div className="al-canal-franja" role="img" aria-label={`Canal Conchos de K0 a K104: ${pins.length} punto(s) con alertas ubicadas`}>
                <span className="al-canal-linea" />
                {MARCAS_KM.map((km) => (
                    <span key={km} className="al-canal-marca" style={{ left: `${(km / MAX_KM_CANAL) * 100}%` }}>
                        <i /><small>K{km}</small>
                    </span>
                ))}
                {pins.map((p) => (
                    <span key={p.km} className={`al-canal-pin al-pin-${sevDe(p.peor) === 'critical' ? 'crit' : sevDe(p.peor) === 'warning' ? 'warn' : 'info'}`}
                        style={{ left: `${(p.km / MAX_KM_CANAL) * 100}%` }} title={`K-${p.km}: ${p.titulos.join(' · ')}`}>
                        {p.n}
                    </span>
                ))}
            </div>
            {pins.length === 0 && <p className="al-canal-nota">Ninguna de estas alertas trae kilometraje; se agrupan por lugar abajo.</p>}
            {sinKm.length > 0 && (
                <div className="al-sinkm">
                    <span className="sc-kicker">Sin ubicación en el canal · filtrar por lugar</span>
                    <ul className="sc-chips" style={{ marginTop: 8 }}>
                        {sinKm.map((c) => {
                            const activo = lugarActivo === c.lugar;
                            const cls = c.peor === 'critical' ? 'crit' : c.peor === 'warning' ? 'warn' : 'info';
                            return (
                                <li key={c.lugar}>
                                    <button type="button" className={`sc-chip sc-chip-${cls} al-chip-btn`} aria-pressed={activo}
                                        onClick={() => onFiltrarLugar(activo ? null : c.lugar)}>
                                        {c.lugar} · {c.n}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
});
