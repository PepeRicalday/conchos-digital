import type { ReactNode } from 'react';
import { AlertTriangle, Thermometer, Wind, CloudRain, Activity, Snowflake } from 'lucide-react';

interface Props {
    fecha: string;
    /** Estaciones con dato vigente / total / excluidas del agregado por lectura sospechosa. */
    vigentes: number;
    total: number;
    excluidas: string[];
    tempMax: number | null;
    tempMin: number | null;
    vientoMax: number | null;
    vientoEn: string | null;
    lluviaProm: number | null;
    probLluviaMax: number | null;
    etoHoy: number | null;
    etoCorte: number | null;
    cielo: { etiqueta: string; color: string; cobertura: number } | null;
    confianza: { etiqueta: string; pct: number; color: string } | null;
    acciones?: ReactNode;
}

const num = (v: number | null, d = 1) => (v == null ? 'S/D' : v.toFixed(d));

/** Encabezado del distrito: condiciones de ahora en numerales grandes, con procedencia y calidad del corte visibles. */
export function HeroDistrito(p: Props) {
    return (
        <section className="cl-hero" aria-labelledby="cl-hero-t">
            <div className="cl-hero-top">
                <div>
                    <span className="cl-kicker">SICA‑005 · Módulo Agro · {p.fecha}</span>
                    <h2 id="cl-hero-t">Inteligencia agroclimática</h2>
                    <p className="cl-hero-sub">
                        Distrito de Riego 005 · {p.vigentes} de {p.total} estaciones con dato vigente
                        {p.cielo && <> · cielo <b style={{ color: p.cielo.color }}>{p.cielo.etiqueta.toLowerCase()}</b> ({p.cielo.cobertura.toFixed(0)} %)</>}
                    </p>
                </div>
                {p.confianza && (
                    <div className="cl-hero-conf" title="Frescura, cobertura de la red y pronóstico disponibles">
                        <span>Confianza del corte</span>
                        <b style={{ color: p.confianza.color }}>{p.confianza.etiqueta} · {p.confianza.pct}%</b>
                    </div>
                )}
            </div>

            <dl className="cl-hero-kpis">
                <div className="cl-kpi cl-kpi-temp">
                    <dt><Thermometer size={14} aria-hidden="true" /> Temp. máxima</dt>
                    <dd>{num(p.tempMax)}<small>°C</small></dd>
                    <span className="cl-kpi-nota">{p.tempMin != null ? <><Snowflake size={11} aria-hidden="true" /> mín. {p.tempMin.toFixed(1)} °C</> : 'mín. S/D'}</span>
                </div>
                <div className="cl-kpi cl-kpi-viento">
                    <dt><Wind size={14} aria-hidden="true" /> Viento máx.</dt>
                    <dd>{num(p.vientoMax)}<small>m/s</small></dd>
                    <span className="cl-kpi-nota">{p.vientoEn ?? 'sin lectura'}</span>
                </div>
                <div className="cl-kpi cl-kpi-lluvia">
                    <dt><CloudRain size={14} aria-hidden="true" /> Lluvia hoy</dt>
                    <dd>{num(p.lluviaProm)}<small>mm</small></dd>
                    <span className="cl-kpi-nota">{p.probLluviaMax != null ? `prevista hasta ${p.probLluviaMax} %` : 'sin pronóstico'}</span>
                </div>
                <div className="cl-kpi cl-kpi-eto">
                    <dt><Activity size={14} aria-hidden="true" /> ETₒ prevista hoy</dt>
                    <dd>{num(p.etoHoy, 2)}<small>mm</small></dd>
                    <span className="cl-kpi-nota">{p.etoCorte != null ? `acumulada al corte ${p.etoCorte.toFixed(2)} mm` : 'sin acumulado'}</span>
                </div>
            </dl>

            {p.excluidas.length > 0 && (
                <p className="cl-aviso cl-aviso-warn" role="status">
                    <AlertTriangle size={14} aria-hidden="true" />
                    {p.excluidas.join(', ')}: lectura sospechosa, excluida de estos promedios y de los índices.
                </p>
            )}
            {p.acciones && <div className="cl-hero-acc">{p.acciones}</div>}
        </section>
    );
}
