import { memo } from 'react';
import { Droplets, Waves, Sprout, AlertTriangle } from 'lucide-react';

/**
 * Franja ejecutiva del Monitor Público: las 4 cifras que gerencia necesita de
 * un vistazo (presas · canal · entregas del ciclo · alertas). Cada cifra trae
 * su procedencia; sin dato se muestra "S/D", nunca 0.
 */
export interface DatosEjecutivos {
    presas: { totalMm3: number | null; pct: number | null; conDato: number; total: number; extraccion: string };
    canal: { vigentes: number; total: number; volumenMm3: number | null };
    entregas: { entregadoMm3: number | null; autorizadoMm3: number | null; pct: number | null; remanenteMm3: number | null; ciclo: string | null };
    alertas: { crit: number; avisos: number; info: number; antiguas: number };
}

const fmt = (v: number | null | undefined, d = 1) =>
    v == null || !Number.isFinite(v) ? null : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

export const PanelEjecutivo = memo(function PanelEjecutivo({ d, onAlertas }: { d: DatosEjecutivos; onAlertas?: () => void }) {
    const totalAl = d.alertas.crit + d.alertas.avisos;   // accionables, igual que el menú lateral
    const presasPct = fmt(d.presas.pct, 1);
    const ent = fmt(d.entregas.entregadoMm3, 1);
    const vol = fmt(d.canal.volumenMm3, 3);
    const telEstado = d.canal.total === 0 ? 'sd' : d.canal.vigentes === d.canal.total ? 'ok' : d.canal.vigentes === 0 ? 'crit' : 'warn';
    return (
        <section className="pm-ejec" aria-label="Indicadores ejecutivos">
            <article className="pm-ejec-tile" style={{ '--acc': '#3987e5' } as React.CSSProperties}>
                <header><span>PRESAS</span><Droplets size={14} /></header>
                <div className="pm-ejec-num">{presasPct ?? 'S/D'}{presasPct && <small>%</small>}</div>
                <p>{fmt(d.presas.totalMm3, 1) ?? 'S/D'} Mm³ almacenados{d.presas.conDato < d.presas.total ? ` · ${d.presas.conDato}/${d.presas.total} con lectura` : ''}</p>
                <p className="pm-ejec-sub">Extracción: {d.presas.extraccion}</p>
            </article>

            <article className="pm-ejec-tile" style={{ '--acc': '#199e70' } as React.CSSProperties}>
                <header><span>CANAL</span><Waves size={14} /></header>
                <div className="pm-ejec-num">{d.canal.vigentes}<small>/{d.canal.total} escalas</small></div>
                <p><span className={`pm-ejec-chip pm-ejec-chip--${telEstado}`}>{telEstado === 'ok' ? 'Telemetría al día' : telEstado === 'crit' ? 'Telemetría vencida' : telEstado === 'sd' ? 'Sin escalas' : 'Lecturas <4 h'}</span></p>
                <p className="pm-ejec-sub">Volumen en canal: {vol ? `${vol} Mm³` : 'S/D'}</p>
            </article>

            <article className="pm-ejec-tile" style={{ '--acc': '#d95926' } as React.CSSProperties}>
                <header><span title={d.entregas.ciclo ?? undefined}>ENTREGAS DEL CICLO</span><Sprout size={14} /></header>
                <div className="pm-ejec-num">{ent ?? 'S/D'}{ent && <small>Mm³</small>}</div>
                <p>{d.entregas.pct != null ? `${d.entregas.pct.toFixed(1)}% de ${fmt(d.entregas.autorizadoMm3, 1)} Mm³ autorizados` : 'Sin volumen autorizado registrado'}</p>
                {d.entregas.pct != null && (
                    <div className="pm-ejec-bar" role="img" aria-label={`${d.entregas.pct.toFixed(1)}% entregado`}>
                        <i style={{ width: `${Math.min(100, d.entregas.pct)}%` }} />
                    </div>
                )}
                {(d.entregas.remanenteMm3 ?? 0) > 0 && <p className="pm-ejec-sub">Incluye remanente: {fmt(d.entregas.remanenteMm3, 2)} Mm³</p>}
                {d.entregas.ciclo && <p className="pm-ejec-sub">{d.entregas.ciclo}</p>}
            </article>

            <button type="button" className={`pm-ejec-tile pm-ejec-tile--btn${d.alertas.crit > 0 ? ' is-crit' : d.alertas.avisos > 0 ? ' is-warn' : ''}`}
                style={{ '--acc': d.alertas.crit > 0 ? '#f87171' : d.alertas.avisos > 0 ? '#fbbf24' : '#34d399' } as React.CSSProperties}
                onClick={onAlertas} title="Ver alertas activas">
                <header><span>ALERTAS VIGENTES</span><AlertTriangle size={14} /></header>
                <div className="pm-ejec-num">{totalAl}</div>
                <p>
                    <span className="pm-sev pm-sev--crit">{d.alertas.crit} críticas</span>
                    <span className="pm-sev pm-sev--warn">{d.alertas.avisos} avisos</span>
                    <span className="pm-sev pm-sev--info">{d.alertas.info} info</span>
                </p>
                {d.alertas.antiguas > 0 && <p className="pm-ejec-sub">+{d.alertas.antiguas} pendientes antiguas sin resolver</p>}
                <div className="pm-ejec-sevbar" aria-hidden="true">
                    {d.alertas.crit > 0 && <i className="c" style={{ flex: d.alertas.crit }} />}
                    {d.alertas.avisos > 0 && <i className="w" style={{ flex: d.alertas.avisos }} />}
                    {d.alertas.info > 0 && <i className="n" style={{ flex: d.alertas.info }} />}
                </div>
            </button>
        </section>
    );
});

/** Vista de VACIADO CONTROLADO: lo que importa con la presa cerrada. */
export interface DatosVaciado {
    cerradaDesde: string | null;
    diasCierre: number | null;
    descendiendo: number;
    estables: number;
    sinLectura: number;
    totalControl: number;
    volumenMm3: number | null;
    remanenteMm3: number | null;
    filas: { nombre: string; km: number; nivel: number | null; dCm: number | null; vencida: boolean; edad: string }[];
}

export const VistaVaciado = memo(function VistaVaciado({ d }: { d: DatosVaciado }) {
    const medidas = d.descendiendo + d.estables;
    return (
        <section className="pm-vac" aria-label="Seguimiento del vaciado">
            <div className="pm-vac-cab">
                <span className="pm-vac-kicker">SEGUIMIENTO DEL VACIADO</span>
                {d.cerradaDesde && <span className="pm-vac-cierre">Presa cerrada {d.cerradaDesde}{d.diasCierre != null ? ` · ${d.diasCierre} d` : ''}</span>}
            </div>
            <div className="pm-vac-kpis">
                <div><b>{d.volumenMm3 != null ? d.volumenMm3.toFixed(3) : 'S/D'}</b><span>Mm³ en canal (estimado)</span></div>
                <div><b>{medidas}/{d.totalControl}</b><span>escalas con lectura &lt;4 h</span></div>
                <div><b>{d.descendiendo}</b><span>con nivel en descenso (12 h)</span></div>
                <div><b>{d.remanenteMm3 != null ? d.remanenteMm3.toFixed(2) : 'S/D'}</b><span>Mm³ de remanente entregado</span></div>
            </div>
            <div className="pm-vac-tabla" role="table" aria-label="Último nivel por escala">
                <div className="pm-vac-fila pm-vac-fila--cab" role="row">
                    <span role="columnheader">Escala</span><span role="columnheader">Nivel</span><span role="columnheader">Δ 12 h</span><span role="columnheader">Antigüedad</span>
                </div>
                {d.filas.map(f => (
                    <div key={f.nombre} className={`pm-vac-fila${f.vencida ? ' is-vencida' : ''}`} role="row">
                        <span role="cell">{f.nombre}</span>
                        <span role="cell">{f.nivel != null ? `${f.nivel.toFixed(2)} m` : 'S/D'}</span>
                        <span role="cell" className={f.dCm != null && !f.vencida ? (f.dCm < 0 ? 'is-down' : f.dCm > 0 ? 'is-up' : '') : ''}>
                            {f.vencida || f.dCm == null ? '—' : `${f.dCm > 0 ? '+' : ''}${f.dCm} cm`}
                        </span>
                        <span role="cell">{f.edad}</span>
                    </div>
                ))}
            </div>
            {d.sinLectura > 0 && <p className="pm-vac-nota">{d.sinLectura} escala{d.sinLectura > 1 ? 's' : ''} sin lectura de campo en las últimas 4 h: su nivel es el último medido, no el actual.</p>}
        </section>
    );
});
