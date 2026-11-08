import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudRain } from 'lucide-react';
import { useJcasCuenca } from '../../hooks/useJcasCuenca';
import { arealDe, mmPropio, valorObs, VENTANAS_OBS, type VentanaObs } from '../../utils/jcasModelo';
import './ClimaCuencaResumen.css';

const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : v.toFixed(d));
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Chihuahua', hour: '2-digit', minute: '2-digit', hour12: false }) : null);

/**
 * Resumen de la cuenca del Conchos en la página de Clima: lluvia areal y las estaciones con más lluvia, con el mismo selector de ventana
 * (Hoy parcial · Ayer · 7 · 30 días) que la vista Cuenca de Presas. Contexto provisional: JCAS/UACJ + estaciones propias, no entra a los
 * KPIs del distrito. El detalle (planos, isoyetas, informe) vive en Presas → Analítica → Cuenca.
 */
export default function ClimaCuencaResumen() {
    const [ventana, setVentana] = useState<VentanaObs>('hoy');
    const { red, loading, error } = useJcasCuenca(30 * 60_000);
    const m = red?.modelo ?? null;

    const top = useMemo(() => {
        if (!m) return [];
        const jcas = m.puntos.filter((p) => !p.sospechosa && !p.sinPluviometro).map((p) => ({ n: p.nombre, v: valorObs(p, 'lluvia', ventana), propia: false }));
        const propias = m.propias.map((p) => ({ n: p.nombre, v: mmPropio(p, ventana), propia: true }));
        return [...jcas, ...propias].filter((x) => x.v != null).sort((a, b) => (b.v as number) - (a.v as number)).slice(0, 5);
    }, [m, ventana]);

    const areal = m ? arealDe(m, ventana) : null;
    const nota = ventana === 'hoy'
        ? (m?.fechaHoy ? `Día en curso, parcial: lectura de las ${hora(m.hoyEn) ?? 'S/D'}.` : 'Hoy todavía sin lectura (S/D).')
        : m ? `Días completos al ${m.fin}.` : '';

    return (
        <section className="card clima-cuenca" aria-label="Lluvia en la cuenca del Conchos">
            <div className="clima-cuenca-cab">
                <h3><CloudRain size={18} /> Cuenca del Conchos · lluvia observada</h3>
                <div className="clima-cuenca-seg" role="group" aria-label="Ventana de lluvia de la cuenca">
                    {VENTANAS_OBS.map(({ v, t }) => <button key={String(v)} type="button" aria-pressed={ventana === v} onClick={() => setVentana(v)}>{t}</button>)}
                </div>
            </div>
            {loading && <p className="clima-cuenca-nota" aria-busy="true">Cargando estaciones de la cuenca…</p>}
            {!loading && (error || !m) && <p className="clima-cuenca-nota" role="status">Sin estaciones de la cuenca por ahora (S/D).</p>}
            {!loading && m && (
                <>
                    <div className="clima-cuenca-kpi">
                        <span className="clima-cuenca-val">{areal?.mm == null ? 'S/D' : fmt(areal.mm)}{areal?.mm != null && <small> mm</small>}</span>
                        <span className="clima-cuenca-sub">{areal?.mm == null ? areal?.motivoSD : `lluvia promedio de la cuenca · n = ${areal.nEstaciones} estaciones · cobertura ${areal.coberturaPct.toFixed(0)} % del área`}</span>
                    </div>
                    {top.length > 0 && (
                        <ol className="clima-cuenca-top" aria-label="Estaciones con más lluvia">
                            {top.map((x) => <li key={x.n}><span>{x.n}{x.propia && <em> · propia</em>}</span><b>{fmt(x.v)} mm</b></li>)}
                        </ol>
                    )}
                    <p className="clima-cuenca-nota">{nota} Fuente: JCAS/UACJ y estaciones propias, dato provisional de contexto. <Link to="/presas?tab=analitica&vista=cuenca">Ver planos de isoyetas e informe</Link></p>
                </>
            )}
        </section>
    );
}
