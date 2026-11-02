import { memo } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Clock, HelpCircle, Info, Radio, RotateCcw } from 'lucide-react';
import ReglaVivaVaso from './ReglaVivaVaso';
import { UMBRAL_BAJO_PCT, UMBRAL_CRITICO_PCT, type EstadoEmbalse, type MensajeEstado, type PuntoCurva } from '../../utils/presaNiveles';
import type { ProcedenciaNivel } from '../../utils/presaMetrics';
import './vasoNiveles.css';

const COLOR_ESTADO = { sd: 'var(--sc-t3)', crit: 'var(--sc-crit)', warn: 'var(--sc-warn)', ok: 'var(--sc-ok)' } as const;
const ICONO = { sd: HelpCircle, crit: AlertOctagon, warn: AlertTriangle, ok: CheckCircle2, info: Info } as const;
const ETIQUETA_PROCEDENCIA: Record<ProcedenciaNivel, string> = { CAMPO: 'Lectura de campo', CILA: 'CILA/USIBWC', ESTIMADA: 'Elevación estimada' };

interface Props {
    presaId: string;
    /** Lectura real; null = S/D (sin simulador). */
    nivelBase: number | null;
    /** Nivel mostrado (el simulado si hay simulación); null = S/D. */
    nivel: number | null;
    pct: number | null;
    volumen: number | null;
    pctBase: number | null;
    volumenBase: number | null;
    capacidad: number | null;
    namo: number | null;
    deficit: number | null;
    estado: EstadoEmbalse;
    mensaje: MensajeEstado;
    simulado: boolean;
    frescura: { texto: string; stale: boolean } | null;
    procedencia: ProcedenciaNivel | null;
    fechaLectura: string | null;
    curva?: PuntoCurva[];
    tieneCurva: boolean;
    simMin: number;
    simMax: number;
    onNivel: (n: number) => void;
}

const f1 = (v: number) => v.toLocaleString('es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const signo = (v: number, d: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

/** Delta en línea bajo una cifra simulada: flecha + texto + color (nunca solo color). */
function Delta({ valor, base, d, u, mejorSiSube = true }: { valor: number | null; base: number | null; d: number; u: string; mejorSiSube?: boolean }) {
    if (valor == null || base == null) return <span className="vaso-delta-linea">Δ S/D</span>;
    const dif = valor - base;
    if (Math.abs(dif) < 10 ** -d / 2) return <span className="vaso-delta-linea">sin cambio</span>;
    const bueno = mejorSiSube ? dif > 0 : dif < 0;
    return <span className={`vaso-delta-linea ${bueno ? 'vaso-delta--sube' : 'vaso-delta--baja'}`}>{dif > 0 ? '▲' : '▼'} {signo(dif, d)} {u} vs lectura</span>;
}

/** Primer vistazo del vaso + simulador integrado: la regla viva (limnímetro arrastrable) junto a las cifras que cambia. */
function HeroVaso(p: Props) {
    const { presaId, nivelBase, nivel, pct, volumen, pctBase, volumenBase, capacidad, namo, deficit, estado, mensaje, simulado, frescura, procedencia, fechaLectura, curva, tieneCurva, simMin, simMax, onNivel } = p;
    const Icono = ICONO[mensaje.severidad];
    const color = COLOR_ESTADO[estado.clave];
    const EstadoIcono = ICONO[estado.clave];
    const claseDef = deficit == null ? '' : deficit <= 0 ? 'ok' : estado.clave === 'sd' ? '' : estado.clave;
    const deficitBase = nivelBase != null && namo != null ? namo - nivelBase : null;
    const acotar = (n: number) => Math.min(simMax, Math.max(simMin, +n.toFixed(2)));
    const etiquetaLectura = fechaLectura ? `Lectura ${new Date(fechaLectura + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : 'Lectura';
    const deltaTexto = simulado && nivel != null && nivelBase != null
        ? `${signo(nivel - nivelBase, 2)} m${volumen != null && volumenBase != null ? ` · ${signo(volumen - volumenBase, 1)} Mm³` : ''}` : null;
    const posPie = (v: number) => ({ left: `${v}%` });
    return (
        <section className={`vaso-sc vaso-card vaso-hero${simulado ? ' vaso-hero--sim' : ''}`} aria-label="Estado del embalse y simulador de nivel">
            <div className="vaso-hero-main">
                <div>
                    <span className="vaso-kicker">{simulado ? 'Llenado simulado' : 'Llenado actual'}</span>
                    <div className="vaso-num" aria-label={pct != null ? `${pct.toFixed(1)} por ciento` : 'sin dato'}>
                        {pct != null ? pct.toFixed(1) : 'S/D'}{pct != null && <small>%</small>}
                    </div>
                    {simulado && <Delta valor={pct} base={pctBase} d={1} u="pts" />}
                </div>
                <div>
                    <div className="vaso-barra" role="progressbar" aria-label="Porcentaje de llenado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct != null ? Math.round(pct) : undefined}
                        aria-valuetext={pct != null ? `${pct.toFixed(1)} % · ${estado.etiqueta}` : 'sin dato'} style={{ ['--c' as string]: color }}>
                        {pct != null && <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />}
                        <b className="vaso-umbral" style={posPie(UMBRAL_CRITICO_PCT)} /><b className="vaso-umbral" style={posPie(UMBRAL_BAJO_PCT)} />
                    </div>
                    {/* Rótulos en la MISMA posición que su marca (antes space-between los dejaba en ~30 % y ~57 %). */}
                    <div className="vaso-barra-pie" aria-hidden="true">
                        <span className="ini">0</span><span style={posPie(UMBRAL_CRITICO_PCT)}>{UMBRAL_CRITICO_PCT} crítico</span>
                        <span style={posPie(UMBRAL_BAJO_PCT)}>{UMBRAL_BAJO_PCT} bajo</span><span className="fin">100 %</span>
                    </div>
                </div>
                <dl className="vaso-datos">
                    <div><dt>Volumen</dt><dd>{volumen != null ? f1(volumen) : 'S/D'}{volumen != null && <small>Mm³</small>}</dd>
                        {simulado ? <Delta valor={volumen} base={volumenBase} d={1} u="Mm³" /> : <span className="sub">{capacidad != null ? `de ${f1(capacidad)} Mm³ al NAMO` : 'capacidad S/D'}</span>}</div>
                    <div><dt>{simulado ? 'Nivel simulado' : 'Nivel'}</dt><dd>{nivel != null ? nivel.toFixed(2) : 'S/D'}{nivel != null && <small>msnm</small>}</dd>
                        {simulado ? <Delta valor={nivel} base={nivelBase} d={2} u="m" /> : <span className="sub">{procedencia ? ETIQUETA_PROCEDENCIA[procedencia] : 'sin lectura'}</span>}</div>
                    <div className={`vaso-def--${claseDef} vaso-datos-def`}><dt>{deficit != null && deficit < 0 ? 'Sobre el NAMO' : 'Déficit bajo el NAMO'}</dt>
                        <dd className="vaso-def-v">{deficit != null ? Math.abs(deficit).toFixed(2) : 'S/D'}{deficit != null && <small>m</small>}</dd>
                        {simulado ? <Delta valor={deficit} base={deficitBase} d={2} u="m" mejorSiSube={false} /> : <span className="sub">{namo != null ? `NAMO ${namo.toFixed(2)} msnm` : 'NAMO S/D'}</span>}</div>
                </dl>
                <ul className="vaso-chips" aria-label="Estado y procedencia de la lectura">
                    <li className={`vaso-chip vaso-chip--${estado.clave}`}><EstadoIcono size={14} aria-hidden="true" />{estado.etiqueta}</li>
                    {frescura && <li className={`vaso-chip ${frescura.stale ? 'vaso-chip--warn' : 'vaso-chip--ok'}`}><Clock size={14} aria-hidden="true" />{frescura.texto}{frescura.stale ? ' · desactualizada' : ''}</li>}
                    {procedencia && <li className="vaso-chip"><Radio size={14} aria-hidden="true" />{ETIQUETA_PROCEDENCIA[procedencia]}</li>}
                    {simulado && <li className="vaso-chip vaso-chip--info"><Info size={14} aria-hidden="true" />SIMULADO</li>}
                </ul>
                <div className={`vaso-mensaje vaso-mensaje--${mensaje.severidad}`} role="status">
                    <Icono size={20} aria-hidden="true" />
                    <div><b>{mensaje.titulo}</b><span>{mensaje.detalle}</span></div>
                </div>
            </div>
            <div className="vaso-hero-limn">
                <span className="vaso-kicker">Simulador de nivel · arrastra la manija</span>
                <ReglaVivaVaso presaId={presaId} nivelBase={nivelBase} nivel={nivel} min={simMin} max={simMax} curva={curva} capacidad={capacidad}
                    estimada={procedencia === 'ESTIMADA'} etiquetaLectura={etiquetaLectura} deltaTexto={deltaTexto} onNivel={nivelBase != null ? onNivel : undefined} />
                {nivelBase != null ? (
                    <>
                        <div className="vaso-regla-ctl" role="group" aria-label="Ajuste del nivel simulado">
                            <button type="button" className="vaso-btn vaso-btn--icono" aria-label="Bajar 0.5 m" onClick={() => onNivel(acotar(nivel! - 0.5))}><ChevronsDown size={18} aria-hidden="true" /></button>
                            <button type="button" className="vaso-btn vaso-btn--icono" aria-label="Bajar 0.1 m" onClick={() => onNivel(acotar(nivel! - 0.1))}><ChevronDown size={18} aria-hidden="true" /></button>
                            <button type="button" className="vaso-btn vaso-btn--icono" aria-label="Subir 0.1 m" onClick={() => onNivel(acotar(nivel! + 0.1))}><ChevronUp size={18} aria-hidden="true" /></button>
                            <button type="button" className="vaso-btn vaso-btn--icono" aria-label="Subir 0.5 m" onClick={() => onNivel(acotar(nivel! + 0.5))}><ChevronsUp size={18} aria-hidden="true" /></button>
                            <button type="button" className="vaso-btn" onClick={() => onNivel(nivelBase)} disabled={!simulado}><RotateCcw size={16} aria-hidden="true" /> Lectura real</button>
                        </div>
                        <p className="vaso-regla-ayuda">Teclado sobre la manija: flechas ±0.1 m · Re Pág/Av Pág ±0.5 m · Esc vuelve a la lectura.</p>
                        {!tieneCurva && <div className="vaso-vacio">Sin curva elevación–capacidad: el volumen simulado no se puede estimar (S/D).</div>}
                    </>
                ) : (
                    <div className="vaso-vacio">Sin lectura oficial del día: el simulador no está disponible.</div>
                )}
            </div>
        </section>
    );
}

export default memo(HeroVaso);
