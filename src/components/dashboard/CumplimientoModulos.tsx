import { memo } from 'react';
import { ArrowRight } from 'lucide-react';

export interface FilaModulo { clave: string; nombre: string; pct: number | null; volumenMm3: number }

// Bandas con texto en la leyenda (el color nunca es el único portador de significado).
const BANDAS = [
    { color: '#199e70', texto: '< 60 %' },
    { color: '#3987e5', texto: '60–89 %' },
    { color: '#fbbf24', texto: '90–100 %' },
    { color: '#f87171', texto: '> 100 % (sobregiro)' },
];
const colorDe = (p: number) => (p > 100 ? BANDAS[3].color : p >= 90 ? BANDAS[2].color : p >= 60 ? BANDAS[1].color : BANDAS[0].color);

/** Volumen entregado contra el autorizado por módulo. Sin volumen autorizado → S/D (no un % inventado). */
export const CumplimientoModulos = memo(function CumplimientoModulos({ filas, cargando, onBalance }: { filas: FilaModulo[]; cargando: boolean; onBalance: () => void }) {
    return (
        <section className="sc-card" aria-labelledby="sc-mod-t">
            <span className="sc-kicker">{filas.length} módulos</span>
            <h3 id="sc-mod-t">Cumplimiento de módulos</h3>
            <ul className="sc-leyenda" aria-label="Leyenda de bandas">
                {BANDAS.map((b) => <li key={b.texto}><i style={{ background: b.color }} />{b.texto}</li>)}
            </ul>
            {cargando ? <p className="sc-vacio">Cargando módulos…</p> : filas.length === 0 ? <p className="sc-vacio">Sin datos operativos.</p> : (
                <ol className="sc-modulos">
                    {filas.map((m, i) => {
                        const escala = Math.max(100, m.pct ?? 0);
                        return (
                            <li key={m.clave} className="sc-mod">
                                <span className="sc-mod-rank" aria-hidden="true">{i + 1}</span>
                                <span className="sc-mod-nombre">{m.nombre}</span>
                                <div className="sc-barra-mod" role="progressbar" aria-label={`Cumplimiento de ${m.nombre}`} aria-valuemin={0} aria-valuemax={Math.round(escala)}
                                    aria-valuenow={m.pct == null ? undefined : Math.round(m.pct)} aria-valuetext={m.pct == null ? 'Sin volumen autorizado' : `${m.pct.toFixed(1)} por ciento del volumen autorizado`}>
                                    {m.pct != null && <i style={{ width: `${(Math.min(m.pct, escala) / escala) * 100}%`, background: colorDe(m.pct) }} />}
                                    {m.pct != null && m.pct > 100 && <u title="Volumen autorizado (100 %)" style={{ left: `${(100 / escala) * 100}%` }} />}
                                </div>
                                <div className="sc-mod-valor"><b>{m.pct == null ? 'S/D' : `${m.pct.toFixed(1)} %`}</b><span>{m.volumenMm3.toFixed(3)} Mm³</span></div>
                            </li>
                        );
                    })}
                </ol>
            )}
            <button type="button" className="sc-btn sc-pie-boton" onClick={onBalance}>Ver balance hidráulico <ArrowRight size={14} aria-hidden="true" /></button>
        </section>
    );
});
