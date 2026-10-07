import { memo } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, HelpCircle, Info, Radio } from 'lucide-react';
import LimnimetroPresa from '../LimnimetroPresa';
import { UMBRAL_BAJO_PCT, UMBRAL_CRITICO_PCT, type EstadoEmbalse, type MensajeEstado } from '../../utils/presaNiveles';
import type { ProcedenciaNivel } from '../../utils/presaMetrics';
import './vasoNiveles.css';

const COLOR_ESTADO = { sd: 'var(--sc-t3)', crit: 'var(--sc-crit)', warn: 'var(--sc-warn)', ok: 'var(--sc-ok)' } as const;
const ICONO = { sd: HelpCircle, crit: AlertOctagon, warn: AlertTriangle, ok: CheckCircle2, info: Info } as const;
const ETIQUETA_PROCEDENCIA: Record<ProcedenciaNivel, string> = { CAMPO: 'Lectura de campo', CILA: 'CILA/USIBWC', ESTIMADA: 'Elevación estimada' };

interface Props {
    presaId: string;
    /** Nivel mostrado (el simulado si hay simulación); null = S/D. */
    nivel: number | null;
    pct: number | null;
    volumen: number | null;
    capacidad: number | null;
    namo: number | null;
    deficit: number | null;
    estado: EstadoEmbalse;
    mensaje: MensajeEstado;
    simulado: boolean;
    frescura: { texto: string; stale: boolean } | null;
    procedencia: ProcedenciaNivel | null;
}

const f1 = (v: number) => v.toLocaleString('es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** Primer vistazo del vaso: % de llenado, volumen, nivel y déficit bajo el NAMO con su estado; el limnímetro al lado. */
function HeroVaso({ presaId, nivel, pct, volumen, capacidad, namo, deficit, estado, mensaje, simulado, frescura, procedencia }: Props) {
    const Icono = ICONO[mensaje.severidad];
    const color = COLOR_ESTADO[estado.clave];
    const EstadoIcono = ICONO[estado.clave];
    const claseDef = deficit == null ? '' : deficit <= 0 ? 'ok' : estado.clave === 'sd' ? '' : estado.clave;
    return (
        <section className="vaso-sc vaso-card vaso-hero" aria-label="Estado del embalse">
            <div className="vaso-hero-main">
                <div>
                    <span className="vaso-kicker">{simulado ? 'Llenado simulado' : 'Llenado actual'}</span>
                    <div className="vaso-num" aria-label={pct != null ? `${pct.toFixed(1)} por ciento` : 'sin dato'}>
                        {pct != null ? pct.toFixed(1) : 'S/D'}{pct != null && <small>%</small>}
                    </div>
                </div>
                <div>
                    <div className="vaso-barra" role="progressbar" aria-label="Porcentaje de llenado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct != null ? Math.round(pct) : undefined}
                        aria-valuetext={pct != null ? `${pct.toFixed(1)} % · ${estado.etiqueta}` : 'sin dato'} style={{ ['--c' as string]: color }}>
                        {pct != null && <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />}
                        <b className="vaso-umbral" style={{ left: `${UMBRAL_CRITICO_PCT}%` }} /><b className="vaso-umbral" style={{ left: `${UMBRAL_BAJO_PCT}%` }} />
                    </div>
                    <div className="vaso-barra-pie" aria-hidden="true"><span>0</span><span>{UMBRAL_CRITICO_PCT} crítico</span><span>{UMBRAL_BAJO_PCT} bajo</span><span>100 %</span></div>
                </div>
                <dl className="vaso-datos">
                    <div><dt>Volumen</dt><dd>{volumen != null ? f1(volumen) : 'S/D'}{volumen != null && <small>Mm³</small>}</dd>
                        <span className="sub">{capacidad != null ? `de ${f1(capacidad)} Mm³ al NAMO` : 'capacidad S/D'}</span></div>
                    <div><dt>Nivel</dt><dd>{nivel != null ? nivel.toFixed(2) : 'S/D'}{nivel != null && <small>msnm</small>}</dd>
                        <span className="sub">{procedencia ? ETIQUETA_PROCEDENCIA[procedencia] : 'sin lectura'}</span></div>
                    <div className={`vaso-def--${claseDef}`}><dt>{deficit != null && deficit < 0 ? 'Sobre el NAMO' : 'Déficit bajo el NAMO'}</dt>
                        <dd className="vaso-def-v">{deficit != null ? Math.abs(deficit).toFixed(2) : 'S/D'}{deficit != null && <small>m</small>}</dd>
                        <span className="sub">{namo != null ? `NAMO ${namo.toFixed(2)} msnm` : 'NAMO S/D'}</span></div>
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
            <div className="vaso-hero-limn"><LimnimetroPresa presaId={presaId} nivel={nivel} estimada={procedencia === 'ESTIMADA'} /></div>
        </section>
    );
}

export default memo(HeroVaso);
