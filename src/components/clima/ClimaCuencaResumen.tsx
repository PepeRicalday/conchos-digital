import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CloudRain, Maximize2 } from 'lucide-react';
import { useJcasCuenca } from '../../hooks/useJcasCuenca';
import { useUnifrutCuenca } from '../../hooks/useUnifrutCuenca';
import { useCapasCuenca } from '../../hooks/useCapasCuenca';
import { arealDe, etiquetaVentana, VENTANAS_OBS, type VentanaObs } from '../../utils/jcasModelo';
import {
    construirEstacionesClima, fmtValorEstacion, FUENTES, infoVariable, ofreceVariable, reporta, resumenVisible, ROTULO_FUENTE, valorEstacion, VARIABLES_ESTACION,
    type FuenteEstacion, type VariableEstacion,
} from '../../utils/estacionesClima';
import './ClimaCuencaResumen.css';

// El mapa de pantalla completa arrastra su propio código y estilos: se carga solo al abrirlo.
const MapaClimaCompleto = lazy(() => import('../presas/cuenca/MapaClimaCompleto'));

const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : v.toFixed(d));
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Chihuahua', hour: '2-digit', minute: '2-digit', hour12: false }) : null);
type FiltroFuente = 'todas' | FuenteEstacion;

/**
 * Resumen de la cuenca del Conchos en la página de Clima: las tres redes (propias, JCAS/UACJ y Unifrut) con filtro de estaciones, de variable
 * (lluvia, temperatura, T mínima, viento, humedad, horas frío) y de ventana (Hoy parcial · Ayer · 7 · 30 días…). Mismo modelo que la tabla de
 * Presas → Cuenca (estacionesClima): las cifras no divergen. Contexto provisional; no entra a los KPIs del distrito.
 * La cifra grande es la LLUVIA AREAL de la cuenca (JCAS y propias) cuando se mira lluvia; en cualquier otro caso es una media simple de lo que se ve.
 * Unifrut está FUERA del contorno de la cuenca: nunca entra a la lluvia areal.
 */
export default function ClimaCuencaResumen() {
    const [elegida, setElegida] = useState<VentanaObs | null>(null);
    const [fuente, setFuente] = useState<FiltroFuente>('todas');
    const [variable, setVariable] = useState<VariableEstacion>('lluvia');
    const [mapaAbierto, setMapaAbierto] = useState(false);
    const jcas = useJcasCuenca(30 * 60_000);
    const unifrut = useUnifrutCuenca();
    const capas = useCapasCuenca();
    const { red, loading, error } = jcas;
    const m = red?.modelo ?? null;
    // Sin lectura de hoy (p. ej. pasada la medianoche) se abre en «Ayer» en vez de una tarjeta vacía; si la persona elige, se respeta.
    const ventana: VentanaObs = elegida ?? (m && !m.fechaHoy ? 1 : 'hoy');
    const info = infoVariable(variable);

    const modelo = useMemo(() => construirEstacionesClima(m, unifrut.modelo), [m, unifrut.modelo]);
    const visibles = useMemo(() => modelo.estaciones.filter((e) => reporta(e) && (fuente === 'todas' || e.fuente === fuente) && ofreceVariable(e, variable)), [modelo, fuente, variable]);
    const top = useMemo(() => visibles.map((e) => ({ e, v: valorEstacion(e, variable, variable === 'horasFrio' ? 30 : ventana, modelo.finUnifrut) }))
        .filter((x): x is { e: (typeof visibles)[number]; v: number } => x.v != null).sort((a, b) => b.v - a.v).slice(0, 5), [visibles, variable, ventana, modelo.finUnifrut]);
    const resumen = useMemo(() => resumenVisible(visibles, variable, variable === 'horasFrio' ? 30 : ventana, modelo.finUnifrut), [visibles, variable, ventana, modelo.finUnifrut]);

    const esAreal = variable === 'lluvia' && fuente !== 'unifrut';
    const areal = m && esAreal ? arealDe(m, ventana) : null;
    const nUnif = modelo.estaciones.filter((e) => e.fuente === 'unifrut' && reporta(e)).length;
    const sinHoyUnifrut = ventana === 'hoy' && (fuente === 'todas' || fuente === 'unifrut') && nUnif > 0;
    const nota = variable === 'horasFrio' ? 'Horas frío acumuladas en la temporada (desde el 1-nov).'
        : ventana === 'hoy'
            ? (m?.fechaHoy ? `Día en curso, parcial: lectura de las ${hora(m.hoyEn) ?? 'S/D'}.` : 'Hoy todavía sin lectura (S/D).')
            : m ? `Días completos al ${m.fin}.` : '';
    const grande = esAreal ? (areal?.mm ?? null) : resumen.media;
    const dec = variable === 'humedad' || variable === 'horasFrio' ? 0 : 1;
    const tag = (f: FuenteEstacion) => (f === 'jcas' ? null : <em> · {f === 'propia' ? 'propia' : 'Unifrut'}</em>);

    return (
        <section className="card clima-cuenca" aria-label="Lluvia en la cuenca del Conchos">
            <div className="clima-cuenca-cab">
                <h3><CloudRain size={18} /> Cuenca del Conchos · {variable === 'lluvia' ? 'lluvia observada' : `${info.etiqueta.toLowerCase()} observada`}</h3>
                <div className="clima-cuenca-filtros">
                    <div className="clima-cuenca-seg" role="group" aria-label="Estaciones">
                        <button type="button" aria-pressed={fuente === 'todas'} onClick={() => setFuente('todas')}>Todas</button>
                        {FUENTES.map((f) => <button key={f.id} type="button" aria-pressed={fuente === f.id} title={f.ayuda} onClick={() => setFuente(f.id)}>{f.etiqueta}</button>)}
                    </div>
                    <div className="clima-cuenca-seg" role="group" aria-label="Variable">
                        {VARIABLES_ESTACION.map((x) => <button key={x.id} type="button" aria-pressed={variable === x.id} onClick={() => setVariable(x.id)}>{x.etiqueta}</button>)}
                    </div>
                    <div className="clima-cuenca-seg" role="group" aria-label="Ventana de la cuenca">
                        {VENTANAS_OBS.map(({ v: vv, t }) => <button key={String(vv)} type="button" aria-pressed={ventana === vv} disabled={variable === 'horasFrio'} onClick={() => setElegida(vv)}>{t}</button>)}
                    </div>
                </div>
            </div>
            {loading && <p className="clima-cuenca-nota" aria-busy="true">Cargando estaciones de la cuenca…</p>}
            {!loading && (error || !m) && <p className="clima-cuenca-nota" role="status">Sin estaciones de la cuenca por ahora (S/D).</p>}
            {!loading && m && (
                <>
                    <div className="clima-cuenca-kpi">
                        <span className="clima-cuenca-val">{grande == null ? 'S/D' : fmt(grande, esAreal ? 1 : dec)}{grande != null && <small> {info.unidad}</small>}</span>
                        <span className="clima-cuenca-sub">{esAreal
                            ? (areal?.mm == null ? areal?.motivoSD : `lluvia promedio de la cuenca · n = ${areal.nEstaciones} estaciones · cobertura ${areal.coberturaPct.toFixed(0)} % del área`)
                            : resumen.media == null
                                ? (sinHoyUnifrut && resumen.conDato === 0 ? 'Unifrut solo publica días completos: elige Ayer o más.' : `Se necesitan al menos 2 estaciones con dato (hay ${resumen.conDato}).`)
                                : `${info.etiqueta.toLowerCase()} · media simple de ${resumen.conDato} estaciones (${fmtValorEstacion(variable, resumen.min)}–${fmtValorEstacion(variable, resumen.max)}) · no es el valor areal de la cuenca${fuente !== 'jcas' && fuente !== 'propia' && nUnif > 0 ? ' (Unifrut está fuera de ella)' : ''}`}</span>
                    </div>
                    {top.length > 0 && (
                        <ol className="clima-cuenca-top" aria-label={`Estaciones con más ${info.etiqueta.toLowerCase()}`}>
                            {top.map((x) => <li key={x.e.clave}><span>{x.e.nombre}{tag(x.e.fuente)}</span><b>{fmtValorEstacion(variable, x.v)}</b></li>)}
                        </ol>
                    )}
                    {top.length === 0 && <p className="clima-cuenca-nota" role="status">Ninguna estación de {fuente === 'todas' ? 'la red' : ROTULO_FUENTE[fuente]} tiene {info.etiqueta.toLowerCase()} para {variable === 'horasFrio' ? 'la temporada' : etiquetaVentana(ventana)} (S/D).</p>}
                    {sinHoyUnifrut && <p className="clima-cuenca-nota">Unifrut solo publica días completos: sus estaciones no aparecen en «Hoy».</p>}
                    <p className="clima-cuenca-nota">{nota} Fuente: JCAS/UACJ, estaciones propias y Unifrut (regional, fuera de la cuenca), dato provisional de contexto.{' '}
                        <button type="button" className="clima-cuenca-lnk" onClick={() => setMapaAbierto(true)}><Maximize2 size={13} aria-hidden="true" /> Mapa interactivo</button>
                        {' · '}<Link to="/presas?tab=analitica&vista=cuenca">Ver planos de isoyetas e informe</Link></p>
                </>
            )}
            {mapaAbierto && <Suspense fallback={null}><MapaClimaCompleto jcas={jcas} unifrut={unifrut} capas={capas} ventanaInicial={ventana} onCerrar={() => setMapaAbierto(false)} /></Suspense>}
        </section>
    );
}
