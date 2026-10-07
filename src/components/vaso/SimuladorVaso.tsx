import { memo, useId } from 'react';
import { Activity, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import './vasoNiveles.css';

interface Props {
    /** Lectura real de hoy; null = sin lectura (simulador no disponible). */
    nivelBase: number | null;
    /** Nivel del simulador. */
    nivel: number;
    min: number;
    max: number;
    namo: number | null;
    tieneCurva: boolean;
    volumenBase: number | null;
    volumenSim: number | null;
    pctBase: number | null;
    pctSim: number | null;
    deficitSim: number | null;
    onNivel: (n: number) => void;
}

const PASO_BOTON = 0.5;
const num = (v: number | null, d: number, u = '') => (v == null ? 'S/D' : `${v.toFixed(d)}${u}`);
const delta = (a: number | null, b: number | null, d: number, u = '') => (a == null || b == null ? 'S/D' : `${b - a >= 0 ? '+' : '−'}${Math.abs(b - a).toFixed(d)}${u}`);

/** Simulador de nivel: el control y su RESULTADO van juntos (antes el resultado aparecía en tarjetas lejanas). */
function SimuladorVaso({ nivelBase, nivel, min, max, namo, tieneCurva, volumenBase, volumenSim, pctBase, pctSim, deficitSim, onNivel }: Props) {
    const id = useId();
    const simulado = nivelBase != null && Math.abs(nivel - nivelBase) > 0.01;
    const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
    const acotar = (n: number) => Math.min(max, Math.max(min, +n.toFixed(2)));

    if (nivelBase == null) {
        return (
            <section className="vaso-sc vaso-card" aria-labelledby={`${id}-t`}>
                <span className="vaso-kicker" id={`${id}-t`}><Activity size={13} aria-hidden="true" /> Simulador de nivel</span>
                <div className="vaso-vacio" style={{ marginTop: 10 }}>Sin lectura oficial del día: el simulador no está disponible.</div>
            </section>
        );
    }
    return (
        <section className="vaso-sc vaso-card" aria-labelledby={`${id}-t`}>
            <span className="vaso-kicker" id={`${id}-t`}><Activity size={13} aria-hidden="true" /> Simulador de nivel</span>
            <div className="vaso-sim-fila" style={{ marginTop: 10 }}>
                <div className="vaso-sim-ctl">
                    <div className="vaso-sim-valor" aria-live="polite">{nivel.toFixed(2)}<small>msnm{simulado ? ' · simulado' : ' · lectura real'}</small></div>
                    <div className="fila">
                        <button type="button" className="vaso-btn vaso-btn--icono" aria-label={`Bajar ${PASO_BOTON} m`} onClick={() => onNivel(acotar(nivel - PASO_BOTON))}><ChevronLeft size={20} aria-hidden="true" /></button>
                        <input id={id} type="range" min={min} max={max} step={0.1} value={nivel} aria-label="Nivel simulado en metros sobre el nivel del mar" aria-valuetext={`${nivel.toFixed(2)} msnm`}
                            onChange={(e) => onNivel(parseFloat(e.target.value))}
                            onKeyDown={(e) => { if (e.key === 'PageUp') { e.preventDefault(); onNivel(acotar(nivel + PASO_BOTON)); } else if (e.key === 'PageDown') { e.preventDefault(); onNivel(acotar(nivel - PASO_BOTON)); } }} />
                        <button type="button" className="vaso-btn vaso-btn--icono" aria-label={`Subir ${PASO_BOTON} m`} onClick={() => onNivel(acotar(nivel + PASO_BOTON))}><ChevronRight size={20} aria-hidden="true" /></button>
                    </div>
                    <div className="vaso-sim-marcas" aria-hidden="true">
                        <span style={{ left: pos(nivelBase) }}>▲ hoy</span>
                        {namo != null && namo >= min && namo <= max && <span style={{ left: pos(namo) }}>NAMO</span>}
                    </div>
                    <div className="vaso-acciones">
                        <button type="button" className="vaso-btn" onClick={() => onNivel(nivelBase)} disabled={!simulado}><RotateCcw size={16} aria-hidden="true" /> Restablecer a la lectura real</button>
                    </div>
                    <span className="vaso-kicker" style={{ textTransform: 'none', letterSpacing: 0 }}>Flechas: ±0.1 m · Re Pág / Av Pág: ±0.5 m</span>
                </div>
                <dl className="vaso-sim-res" aria-label="Resultado de la simulación" aria-live="polite">
                    {tieneCurva ? (<>
                        <dt>Volumen</dt><dd>{num(volumenSim, 1, ' Mm³')} <em>({delta(volumenBase, volumenSim, 1)})</em></dd>
                        <dt>Llenado</dt><dd>{num(pctSim, 1, ' %')} <em>({delta(pctBase, pctSim, 1)})</em></dd>
                    </>) : (<><dt>Volumen</dt><dd>S/D</dd><dt>Llenado</dt><dd>S/D</dd></>)}
                    <dt>Cambio de nivel</dt><dd>{delta(nivelBase, nivel, 2, ' m')}</dd>
                    <dt>Déficit NAMO</dt><dd>{num(deficitSim, 2, ' m')}</dd>
                </dl>
            </div>
            {!tieneCurva && <div className="vaso-vacio" style={{ marginTop: 12 }}>Sin curva elevación–capacidad cargada para esta presa: el volumen simulado no se puede estimar.</div>}
        </section>
    );
}

export default memo(SimuladorVaso);
