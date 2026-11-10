import { memo } from 'react';
import { AlertTriangle, CheckCircle2, Eye, HelpCircle, RefreshCw, Satellite, ShieldCheck, XCircle } from 'lucide-react';
import type { FuenteSuperficie } from '../../utils/presaNiveles';
import { DESVIO_ATENCION_PCT, DESVIO_CRITICO_PCT, semaforoDesvio } from '../../utils/vasoUmbrales';
import './vasoNiveles.css';
import './vasoEvolucion.css';

interface Props {
    fuentes: FuenteSuperficie[];
    cargandoVisual: boolean;
    /** La referencia visual falló (sin teselas suficientes). */
    errorVisual: boolean;
    /** Presa sin coordenadas de vaso configuradas para la detección visual. */
    sinDeteccion: boolean;
    onRefrescarVisual: () => void;
}

const ICONO = { ok: CheckCircle2, warn: AlertTriangle, crit: XCircle, sd: HelpCircle } as const;
const firmado = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(0)} %`;

/** Diferencia contra la curva: cifra con signo + barra divergente (±40 %) + semáforo con palabra. */
function Diferencia({ f }: { f: FuenteSuperficie }) {
    if (f.difVsCurvaPct == null) return f.clave === 'sentinel' ? <span className="d">Sin nivel registrado el día de la escena: diferencia S/D.</span> : null;
    const s = semaforoDesvio(f.difVsCurvaPct);
    const Icono = ICONO[s.clave];
    const ancho = Math.min(50, (Math.abs(f.difVsCurvaPct) / 40) * 50);
    return (
        <div className={`vaso-sup-dif vaso-sem--${s.clave}`}>
            <b>{firmado(f.difVsCurvaPct)} <small>{f.difContra ?? 'contra la curva'}</small></b>
            <div className="vaso-divbar" role="meter" aria-valuemin={-40} aria-valuemax={40} aria-valuenow={Math.round(f.difVsCurvaPct)} aria-valuetext={`${firmado(f.difVsCurvaPct)} ${f.difContra ?? ''}`}>
                <i style={{ left: f.difVsCurvaPct < 0 ? `${50 - ancho}%` : '50%', width: `${ancho}%` }} />
            </div>
            {f.validada && <span className={`vaso-sem vaso-sem--${s.clave}`}><Icono size={14} aria-hidden="true" /> {s.etiqueta}</span>}
        </div>
    );
}

/** Superficie del espejo de agua: curva oficial y Sentinel-2 (principales) + referencia visual (secundaria). */
function SuperficieVaso({ fuentes, cargandoVisual, errorVisual, sinDeteccion, onRefrescarVisual }: Props) {
    const principales = fuentes.filter((f) => f.clave !== 'visual');
    const visual = fuentes.find((f) => f.clave === 'visual');
    return (
        <section className="vaso-sc vaso-card" aria-labelledby="vaso-sup-t">
            <span className="vaso-kicker" id="vaso-sup-t"><Satellite size={13} aria-hidden="true" /> Superficie del espejo de agua</span>
            {fuentes.length === 0 && !cargandoVisual ? (
                <div className="vaso-vacio" style={{ marginTop: 12 }}>{sinDeteccion ? 'Esta presa no tiene coordenadas de vaso para la detección satelital.' : 'Sin superficie disponible por ahora.'}</div>
            ) : (
                <ul className="vaso-sup-lista vaso-sup-lista--jer">
                    {principales.map((f) => (
                        <li key={f.clave} className="vaso-sup-item">
                            <span className="et">{f.etiqueta}</span>
                            <span className="v">{f.km2.toFixed(1)}<small>km²</small></span>
                            {f.meta ? (
                                <ul className="vaso-sup-meta">{f.meta.map((m) => <li key={m}>{m}</li>)}</ul>
                            ) : (
                                <span className="d">{f.detalle}</span>
                            )}
                            {f.clave === 'curva'
                                ? <span className="vaso-chip vaso-chip--ok" style={{ alignSelf: 'flex-start' }}><ShieldCheck size={14} aria-hidden="true" />Referencia oficial</span>
                                : <Diferencia f={f} />}
                        </li>
                    ))}
                    {(visual || cargandoVisual || errorVisual) && !sinDeteccion && (
                        <li className="vaso-sup-item vaso-sup-item--ref">
                            <span className="et"><Eye size={13} aria-hidden="true" /> Referencia visual — mosaico de archivo, fecha desconocida</span>
                            <span className="v">{visual ? <>{visual.km2.toFixed(1)}<small>km²</small></> : 'S/D'}</span>
                            <span className="d">
                                {cargandoVisual ? 'Analizando el mosaico…'
                                    : visual ? `${visual.difVsCurvaPct != null ? `${firmado(visual.difVsCurvaPct)} contra la curva de hoy. ` : ''}Imagen en color sin infrarrojo: orientativa, no es medición.`
                                        : 'No se pudo descargar el mosaico de referencia.'}
                            </span>
                            <button type="button" className="vaso-btn" onClick={onRefrescarVisual} disabled={cargandoVisual} aria-label="Recalcular la referencia visual">
                                <RefreshCw size={16} className={cargandoVisual ? 'animate-spin' : undefined} aria-hidden="true" /> Recalcular
                            </button>
                        </li>
                    )}
                </ul>
            )}
            <details className="vaso-sup-nota">
                <summary>Cómo se obtiene cada cifra</summary>
                <p>
                    <b>Curva oficial:</b> área que la batimetría 2020 asigna al nivel actual. <b>Sentinel-2:</b> espejo de agua del día más reciente con
                    el vaso despejado (máscara de nubes por píxel), a 10 m: agua por NDWI o MNDWI sobre su umbral Otsu, sin el cauce del río. Se compara
                    contra la curva <i>a la cota de ese mismo día</i>; un área ~10 % menor es el sesgo normal del método porque el píxel pierde
                    la orilla somera (coincide hasta {DESVIO_ATENCION_PCT} %). Más de {DESVIO_CRITICO_PCT} % pide revisar escena y curva. <b>Referencia visual:</b> mosaico en color de ArcGIS cuya
                    fecha se desconoce; solo orienta, no se usa para decidir.
                </p>
            </details>
        </section>
    );
}

export default memo(SuperficieVaso);
