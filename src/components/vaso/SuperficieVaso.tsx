import { memo } from 'react';
import { Eye, RefreshCw, Satellite, ShieldCheck } from 'lucide-react';
import type { FuenteSuperficie } from '../../utils/presaNiveles';
import './vasoNiveles.css';

interface Props {
    fuentes: FuenteSuperficie[];
    cargandoVisual: boolean;
    /** La estimación visual falló (sin imagen reciente y despejada). */
    errorVisual: boolean;
    /** Presa sin coordenadas de vaso configuradas para la detección visual. */
    sinDeteccion: boolean;
    onRefrescarVisual: () => void;
}

const dif = (p: number | null) => (p == null ? null : `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(0)} % contra la curva`);

/** Superficie del espejo de agua: las fuentes disponibles, rotuladas y comparadas contra la curva oficial (una sola tarjeta). */
function SuperficieVaso({ fuentes, cargandoVisual, errorVisual, sinDeteccion, onRefrescarVisual }: Props) {
    const hayVisual = fuentes.some((f) => f.clave === 'visual');
    return (
        <section className="vaso-sc vaso-card" aria-labelledby="vaso-sup-t">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <span className="vaso-kicker" id="vaso-sup-t"><Satellite size={13} aria-hidden="true" /> Superficie del espejo de agua</span>
                <button type="button" className="vaso-btn" onClick={onRefrescarVisual} disabled={cargandoVisual || sinDeteccion} aria-label="Recalcular la estimación visual de hoy">
                    <RefreshCw size={16} className={cargandoVisual ? 'animate-spin' : undefined} aria-hidden="true" /> Recalcular estimación de hoy
                </button>
            </div>
            {fuentes.length === 0 && !cargandoVisual ? (
                <div className="vaso-vacio" style={{ marginTop: 12 }}>{sinDeteccion ? 'Esta presa no tiene coordenadas de vaso para la detección satelital.' : 'Sin superficie disponible por ahora.'}</div>
            ) : (
                <ul className="vaso-sup-lista">
                    {fuentes.map((f) => (
                        <li key={f.clave} className="vaso-sup-item">
                            <span className="et">{f.etiqueta}</span>
                            <span className="v">{f.km2.toFixed(1)}<small>km²</small></span>
                            <span className={`vaso-chip ${f.validada ? 'vaso-chip--ok' : 'vaso-chip--warn'}`} style={{ alignSelf: 'flex-start' }}>
                                {f.validada ? <ShieldCheck size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}{f.validada ? 'VALIDADO' : 'APROXIMADO'}
                            </span>
                            <span className="d">{f.detalle}</span>
                            {dif(f.difVsCurvaPct) && <span className="d"><b>{dif(f.difVsCurvaPct)}</b></span>}
                        </li>
                    ))}
                </ul>
            )}
            {cargandoVisual && <div className="vaso-vacio" role="status" style={{ marginTop: 12 }}>Analizando imagen satelital reciente…</div>}
            {errorVisual && !hayVisual && !cargandoVisual && (
                <div className="vaso-error" role="alert" style={{ marginTop: 12 }}>
                    No hay una imagen satelital reciente y despejada para la estimación de hoy. Vuelve a intentarlo en unos minutos; las otras fuentes siguen disponibles.
                </div>
            )}
            <details className="vaso-sup-nota">
                <summary>Cómo se obtiene cada cifra</summary>
                <p><b>Curva oficial:</b> área que la batimetría 2020 asigna al nivel actual. <b>Sentinel-2:</b> espejo de agua detectado con NDWI (banda infrarroja, 20 m) en la última escena despejada; es la medición validada. <b>Estimación visual:</b> cálculo rápido sobre imagen en color (ArcGIS World Imagery, sin infrarrojo): sirve como referencia del día, no como medición certificada. Cuando difieren más de 15 %, confía primero en Sentinel-2 y en la curva.</p>
            </details>
        </section>
    );
}

export default memo(SuperficieVaso);
