import { memo } from 'react';
import { porcentajeLlenadoPresa, calcularFrescura } from '../../utils/presaMetrics';
import { extraccionDePresa, PRESA_ALTA_PCT, PRESA_BAJA_PCT } from '../../utils/dashboardKpis';
import { AnilloProgreso } from '../ui/AnilloProgreso';
import type { PresaData } from '../../hooks/usePresas';

const fx = (v: number | null, d = 1) => (v == null ? null : v.toFixed(d));

function Cifra({ etiqueta, valor, unidad }: { etiqueta: string; valor: string | null; unidad?: string }) {
    return (
        <div className="sc-cifra">
            <span>{etiqueta}</span>
            {valor == null ? <b className="sc-sd">S/D</b> : <b>{valor}{unidad && <small>{unidad}</small>}</b>}
        </div>
    );
}

/** Estado por presa: nivel, almacenamiento, % llenado y extracción con su PROPIA frescura (una presa al día no oculta a otra vieja). */
export const FuentesPresas = memo(function FuentesPresas({ presas }: { presas: PresaData[] }) {
    return (
        <section className="sc-card" aria-labelledby="sc-presas-t">
            <span className="sc-kicker">Fuentes de agua</span>
            <h3 id="sc-presas-t">Estado de las presas</h3>
            <div className="sc-presas">
                {presas.map((p) => {
                    const l = p.lectura;
                    const pct = porcentajeLlenadoPresa(p);
                    const alm = l?.almacenamiento_mm3 ?? null;
                    const ext = extraccionDePresa(p);
                    const fr = calcularFrescura(l?.fecha);
                    return (
                        <article key={p.id} className="sc-presa" aria-label={p.nombre}>
                            <div className="sc-presa-top">
                                <div>
                                    <h4 className="sc-presa-nombre">{p.nombre}</h4>
                                    <span className="sc-presa-sub">{p.municipio}{p.nombre_corto ? ` · ${p.nombre_corto}` : ''}</span>
                                </div>
                                <span className={`sc-chip ${fr == null ? 'sc-chip-warn' : fr.stale ? 'sc-chip-warn' : 'sc-chip-ok'}`}>
                                    {fr ? fr.texto : 'Sin lectura'}{fr?.stale ? ' · antiguo' : ''}
                                </span>
                            </div>
                            <div className="sc-presa-cuerpo">
                                <AnilloProgreso pct={pct} etiqueta={`Llenado de ${p.nombre}`} alerta={pct != null && pct > PRESA_ALTA_PCT}
                                    marcas={[{ pct: PRESA_BAJA_PCT, texto: `Umbral crítico ${PRESA_BAJA_PCT} %` }, { pct: PRESA_ALTA_PCT, texto: `Umbral alto ${PRESA_ALTA_PCT} % (NAMO)` }]} />
                                <div className="sc-presa-cifras">
                                    <Cifra etiqueta="Almacenamiento" valor={fx(alm)} unidad="Mm³" />
                                    <Cifra etiqueta="Elevación" valor={fx(l?.escala_msnm ?? null, 2)} unidad="msnm" />
                                    <Cifra etiqueta="Extracción" valor={fx(ext)} unidad="m³/s" />
                                </div>
                            </div>
                            <div className="sc-barra-pie">
                                <span>NAMO {p.capacidad_max_mm3.toFixed(0)} Mm³</span>
                                <span>{alm != null ? `${alm.toFixed(1)} / ${p.capacidad_max_mm3.toFixed(0)} Mm³` : 'Sin lectura de nivel'}</span>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
});
