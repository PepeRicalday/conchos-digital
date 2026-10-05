import { calcularFrescura, elevacionEstimada } from '../utils/presaMetrics';

/**
 * Tira compacta de nivel de las presas para el Monitor Público.
 * Fuente: las mismas filas que el resto del monitor (presasData), que se nutren de lecturas_presas
 * (campo > CILA/USIBWC). Regla "S/D nunca cero": sin dato → S/D; dato viejo → se muestra atenuado con su fecha.
 */

interface FilaPresa {
    id?: string | number;
    presa_id?: string;
    fecha?: string | null;
    almacenamiento_mm3?: number | string | null;
    porcentaje_llenado?: number | string | null;
    escala_msnm?: number | string | null;
    notas?: string | null;
    presas?: { nombre_corto?: string | null } | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const nf = (v: number, d: number) => v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function PresasNivelStrip({ presas }: { presas: FilaPresa[] }) {
    const filas = presas.filter(p => !String(p.id ?? '').startsWith('mov-') && !String(p.id ?? '').startsWith('fallback'));
    if (filas.length === 0) return null;

    return (
        <div className="pr-strip" role="group" aria-label="Nivel de las presas">
            {filas.map(p => {
                const pct = num(p.porcentaje_llenado);
                const alm = num(p.almacenamiento_mm3);
                const elev = num(p.escala_msnm);
                const estimada = elevacionEstimada(p.notas);
                const fr = calcularFrescura(p.fecha ?? null, 36);
                const vencido = !!fr?.stale;
                const sinDato = pct == null && alm == null;
                const tono = sinDato ? 'mute' : (pct ?? 0) >= 92 || (pct ?? 0) < 12 ? 'crit' : (pct ?? 0) >= 80 || (pct ?? 0) < 22 ? 'warn' : 'ok';
                return (
                    <div key={String(p.id ?? p.presa_id)} className={`pr-strip-item${vencido ? ' is-vencido' : ''}`}>
                        <span className="pr-strip-nombre">{p.presas?.nombre_corto?.toUpperCase() || 'PRESA'}</span>
                        <span className={`pr-strip-pct pr-strip-pct--${tono}`}>{pct == null ? 'S/D' : nf(pct, 1)}{pct != null && <small>%</small>}</span>
                        <span className="pr-strip-det">
                            {alm == null ? 'S/D' : `${nf(alm, 1)} Mm³`}
                            {' · '}
                            {elev == null ? 'S/D' : `${estimada ? '≈' : ''}${nf(elev, estimada ? 1 : 2)} msnm`}
                        </span>
                        {fr && <span className="pr-strip-fecha">{vencido ? `ref. ${fr.texto}` : fr.texto}</span>}
                    </div>
                );
            })}
        </div>
    );
}
