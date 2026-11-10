import { Kpi } from '../../ui/base';
import { useEffect, useMemo, useState } from 'react';
import { arealDe, etiquetaVentana, type VentanaObs } from '../../../utils/jcasModelo';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { useAqwpCuenca } from '../../../hooks/useAqwpCuenca';
import { formatearNumero } from '../../../utils/historicoPresas';
import { calcularFrescura } from '../../../utils/presaMetrics';
import { agregadoCuenca, aportacionTotal, UBICACION_OJINAGA } from '../../../utils/aqwpCuenca';
import { construirModeloCuenca, type PresaCuencaModelo } from '../../../utils/cuencaModelo';
import { ordenarPresas, type OrdenCuenca } from '../../../utils/cuencaViz';
import { fechaCorta } from '../../../utils/analiticaPresas';
import BotonInformeCuenca from '../../BotonInformeCuenca';
import FilaTanques from './FilaTanques';
import DetallePresaCuenca from './DetallePresaCuenca';
import PequenosMultiplos from './PequenosMultiplos';
import TiraLluvia from './TiraLluvia';
import RedEstacionesCuenca from './RedEstacionesCuenca';
import MensualCuenca from './MensualCuenca';
import PlanosCuenca from './PlanosCuenca';
import { useJcasCuenca } from '../../../hooks/useJcasCuenca';
import { useCapasCuenca } from '../../../hooks/useCapasCuenca';
import SemaforoBadge from './SemaforoBadge';
import { GLIFO_ESTADO } from './TanquePresa';
import '../analitica/analitica.css';
import './cuenca.css';
import { hoyLocalISO } from '../../../utils/hoyLocal';

const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const fmtFlujo = (v: number | null) => (v == null ? 'S/D' : formatearNumero(v, v !== 0 && Math.abs(v) < 1 ? 3 : 2));

function fechaHoraLocal(iso: string | null): string {
    if (!iso) return 'nunca';
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
        ? d.toLocaleString('es-MX', { timeZone: 'America/Chihuahua', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'S/D';
}

type Vista = 'tanques' | 'tabla';
type Alcance = 'todas' | 'distrito';

function Segmentado<T extends string | number>({ etiqueta, valor, opciones, onChange }: {
    etiqueta: string; valor: T; opciones: { v: T; t: string }[]; onChange: (v: T) => void;
}) {
    return (
        <div className="cu-ctl">
            <span className="cu-ctl-etq" id={`cu-ctl-${etiqueta}`}>{etiqueta}</span>
            <div className="an-seg" role="group" aria-labelledby={`cu-ctl-${etiqueta}`}>
                {opciones.map((o) => (
                    <button key={String(o.v)} type="button" className="an-seg-btn" aria-pressed={valor === o.v} onClick={() => onChange(o.v)}>{o.t}</button>
                ))}
            </div>
        </div>
    );
}

const SECCIONES_NAV: { id: string; t: string }[] = [
    { id: 'cu-presas', t: 'Presas' }, { id: 'cu-planos', t: 'Clima y planos' }, { id: 'cu-estaciones', t: 'Estaciones' }, { id: 'cu-mensual', t: 'Mes a mes' }, { id: 'cu-lluvia', t: 'Pluviómetros GOES' },
];
/** Scroller vertical más cercano (en la app es .main-content; en el Monitor, el cuerpo del dock). */
function scrollerDe(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
}
/**
 * Lleva la sección al borde de arriba SIN dejarla bajo la navegación fija ni bajo la barra superior móvil: la nav se ancla al borde del
 * contenido del scroller (después de su padding), así que se resta ese padding y el alto de la nav. Solo se mueve el scroller de la pestaña.
 */
function irA(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const reducido = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const sc = scrollerDe(el);
    if (!sc) { el.scrollIntoView({ behavior: reducido ? 'auto' : 'smooth', block: 'start' }); return; }
    const nav = document.querySelector<HTMLElement>('.cu-nav');
    const pad = parseFloat(getComputedStyle(sc).paddingTop) || 0;
    const top = sc.scrollTop + (el.getBoundingClientRect().top - sc.getBoundingClientRect().top) - pad - (nav?.offsetHeight ?? 0) - 8;
    sc.scrollTo({ top: Math.max(0, top), behavior: reducido ? 'auto' : 'smooth' });
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
}

function FilaTabla({ m, difCila }: { m: PresaCuencaModelo; difCila: number | null | undefined }) {
    const f = m.fila;
    return (
        <tr>
            <th scope="row"><div className="cu-presa">
                <span className="cu-nombre">{f.etiqueta}</span>
                {f.delDistrito && <span className="cu-tag">Distrito</span>}
                {f.sinActualizar && <span className="cu-tag cu-tag--aviso">Sin actualizar</span>}
                {f.sinActualizar && (
                    <span className="cu-nota-fila">
                        Sin actualizar{f.igualDesde ? ` desde el ${fechaCorta(f.igualDesde)}` : ''}{f.diasIgual ? ` (${f.diasIgual} días)` : ''}: CONAGUA repite el último dato obtenido{f.almacenamientoMm3 != null ? ` (${formatearNumero(f.almacenamientoMm3, 3)} Mm³)` : ''} aunque reporta aportación y extracción.
                    </span>
                )}
                {f.delDistrito && difCila != null && (
                    <span className="cu-nota-fila">Diferencia contra CILA: {difCila > 0 ? '+' : difCila < 0 ? '−' : ''}{formatearNumero(Math.abs(difCila), 2)} %</span>
                )}
            </div></th>
            <td className="cu-num">{fmt(f.almacenamientoValido, 1)}</td>
            <td className="cu-num">{f.pct == null ? 'S/D' : `${formatearNumero(f.pct, 1)} %`}</td>
            <td>
                <span className={`cu-estado cu-estado--${f.estado.clave}`}>
                    <span aria-hidden="true">{GLIFO_ESTADO[f.estado.clave]}</span> {f.estado.etiqueta}
                </span>
            </td>
            <td className="cu-num">{m.util ? `${formatearNumero(m.util.pctUtil, 1)} %` : 'S/D'}</td>
            <td className="cu-num">{m.posicion?.percentil != null ? `p${m.posicion.percentil}` : 'S/D'}{m.posicion && <span className="cu-nota-fila">n = {m.posicion.nAnios} años</span>}</td>
            <td><SemaforoBadge s={m.semaforo} /></td>
            <td className="cu-num">{fmtFlujo(f.aportacionM3s)}</td>
            <td className="cu-num">{fmtFlujo(f.extraccionTotalM3s)}</td>
            <td className="cu-num">{fmtFlujo(f.vertidoM3s)}</td>
            <td className={`cu-fecha${m.frescura === 'atrasada' ? ' cu-fecha--vieja' : ''}`}>
                {f.fecha ? fechaCorta(f.fecha) : 'S/D'}
                {m.frescura === 'atrasada' && <span className="cu-nota-fila">Atrasada {m.atrasoDias} d</span>}
            </td>
        </tr>
    );
}

/**
 * Vista "Cuenca del Conchos" (Presas → Analítica, Monitor): las 7 presas CONAGUA de Chihuahua y Durango y el aforo de Ojinaga,
 * del portal USIBWC. CONTEXTO de solo lectura: no sustituye la captura de campo ni CILA, ni entra a balance ni proyección.
 * Todo sale de construirModeloCuenca: el informe institucional usa el MISMO modelo, así las cifras nunca divergen.
 */
export default function PanelCuencaConchos({ conInforme = false }: { conInforme?: boolean }) {
    const { datos, loading, error, recargar } = useAqwpCuenca();
    const capas = useCapasCuenca(); // las mismas capas de referencia en los planos y en el mapa de la red
    const jcas = useJcasCuenca(); // una sola carga de la red JCAS para los planos y la tabla de estaciones
    const [vista, setVista] = useState<Vista>('tanques');
    // Una sola ventana de lo observado para los planos y la red de estaciones (antes cada bloque tenía la suya y podían decir cosas distintas).
    const [ventanaObs, setVentanaObs] = useState<VentanaObs>(30);
    const [orden, setOrden] = useState<OrdenCuenca>('cuenca');
    const [alcance, setAlcance] = useState<Alcance>('todas');
    const [meses, setMeses] = useState<3 | 12>(12);
    const [sel, setSel] = useState<number | null>(null);

    const calc = useMemo(() => {
        if (!datos) return null;
        const hoyISO = hoyLocalISO();
        const modelos = construirModeloCuenca(datos, hoyISO);
        const filas = modelos.map((m) => m.fila);
        const fechas = filas.map((f) => f.fecha).filter((x): x is string => !!x).sort();
        const ultimaFecha = fechas.length ? fechas[fechas.length - 1] : null;
        return {
            modelos, filas,
            ojinaga: datos.estados.find((e) => e.ubicacionId === UBICACION_OJINAGA) ?? null,
            cuenca: agregadoCuenca(filas),
            dist: agregadoCuenca(filas.filter((f) => f.delDistrito)),
            aport: aportacionTotal(filas),
            frescura: calcularFrescura(ultimaFecha, 48),
            cila: new Map(datos.cruceCila.map((c) => [c.presaId, c.difPct])),
        };
    }, [datos]);

    const visibles = useMemo(() => {
        if (!calc) return [];
        const base = alcance === 'distrito' ? calc.modelos.filter((m) => m.fila.delDistrito) : calc.modelos;
        return ordenarPresas(base.map((m) => ({ ...m, ubicacionId: m.fila.ubicacionId, pct: m.fila.pct, namoMm3: m.fila.namoMm3, atrasoDias: m.atrasoDias })), orden);
    }, [calc, alcance, orden]);

    // Sección activa de la navegación (la que cruza el 30 % superior de la ventana).
    const [activa, setActiva] = useState<string | null>(null);
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const els = SECCIONES_NAV.map((x) => document.getElementById(x.id)).filter((e): e is HTMLElement => !!e);
        if (!els.length) return;
        const io = new IntersectionObserver((entradas) => {
            for (const en of entradas) if (en.isIntersecting) setActiva(en.target.id);
        }, { rootMargin: '-25% 0px -65% 0px' });
        els.forEach((e) => io.observe(e));
        return () => io.disconnect();
    }, [calc, jcas.loading, jcas.red, vista]);

    if (loading) {
        return <div className="an-root cu-root" role="status" aria-busy="true" aria-label="Cargando cuenca del Conchos"><div className="an-skeleton" /><div className="an-skeleton an-skeleton--alta" /></div>;
    }
    if (error) {
        return (
            <div className="an-root cu-root"><div className="an-vacio" role="alert">
                <strong>No se pudo cargar la cuenca del Conchos.</strong>
                <span>{error}</span>
                <button type="button" className="an-btn" onClick={recargar}>Reintentar</button>
            </div></div>
        );
    }
    if (!datos || !calc || calc.filas.length === 0) {
        return <div className="an-root cu-root"><div className="an-vacio" role="status"><strong>Sin datos de la cuenca (S/D)</strong><span>Todavía no hay presas cargadas desde el portal USIBWC.</span></div></div>;
    }

    const { filas, ojinaga, cuenca, dist, aport, frescura } = calc;
    const sinActualizar = filas.filter((f) => f.sinActualizar);
    const boquilla = filas.find((f) => f.ubicacionId === 536);
    const madero = filas.find((f) => f.ubicacionId === 537);
    const actual = visibles.find((m) => m.fila.ubicacionId === sel) ?? visibles[0] ?? null;
    const seleccionId = actual?.fila.ubicacionId ?? null;
    const hayClim = datos.climatologia != null;
    const areal30 = jcas.red?.modelo ? arealDe(jcas.red.modelo, ventanaObs) : null; // sigue la ventana elegida (la misma de planos y red)

    return (
        <div className="an-root cu-root pr-reveal">
            <header className="an-head">
                <div>
                    <h3 className="an-titulo">Cuenca del Conchos</h3>
                    <p className="an-sub">Presas CONAGUA de Chihuahua y Durango y aforo de Ojinaga · CONAGUA vía USIBWC · datos provisionales</p>
                </div>
                <div className="cu-head-acc">
                    <span className={`an-chip an-chip--${frescura == null ? 'sd' : frescura.stale ? 'warn' : 'ok'}`}>
                        <span aria-hidden="true">{frescura == null ? '◇' : frescura.stale ? '▲' : '●'}</span> {frescura ? frescura.texto : 'Sin lectura (S/D)'}
                    </span>
                    {conInforme && <BotonInformeCuenca datos={datos} />}
                </div>
            </header>

            <div className="cu-cq"><div className="an-kpis an-kpis--6" role="list">
                <Kpi densidad="compacta" etiqueta="Almacenamiento de la cuenca" valor={fmt(cuenca.totalMm3, 1)} unidad=" Mm³" contexto={<>{cuenca.porcentaje == null ? 'Sin lectura vigente' : `${formatearNumero(cuenca.porcentaje, 1)} % del NAMO`} · {cuenca.presasConDato} de {cuenca.presasTotal} presas con dato{cuenca.parcial ? ' (parcial)' : ''}</>} />
                <Kpi densidad="compacta" etiqueta="Presas del distrito" valor={fmt(dist.totalMm3, 1)} unidad=" Mm³" contexto={<>{dist.porcentaje == null ? 'Sin lectura vigente' : `${formatearNumero(dist.porcentaje, 1)} % del NAMO`} · Boquilla {boquilla?.pct == null ? 'S/D' : `${formatearNumero(boquilla.pct, 1)} %`} · Madero {madero?.pct == null ? 'S/D' : `${formatearNumero(madero.pct, 1)} %`}</>} />
                <Kpi densidad="compacta" etiqueta="Aportaciones reportadas" valor={fmtFlujo(aport.total)} unidad=" m³/s" contexto={<>Última lectura de cada presa · {aport.conDato} de {filas.length} con dato · puede repetir agua en cascada</>} />
                <Kpi densidad="compacta" etiqueta="Salida de la cuenca · Ojinaga" valor={fmtFlujo(ojinaga?.gastoM3s ?? null)} unidad=" m³/s" contexto={<>Aforo USIBWC 08373000{ojinaga?.fecha ? ` · ${fechaCorta(ojinaga.fecha)}` : ''}</>} />
                <Kpi densidad="compacta" etiqueta={`Lluvia de la cuenca · ${etiquetaVentana(ventanaObs)}`} valor={areal30?.mm == null ? 'S/D' : fmtLluvia(areal30.mm)} unidad={areal30?.mm != null ? " mm" : undefined} contexto={areal30?.mm == null
                        ? (jcas.loading ? 'Cargando estaciones…' : jcas.error ? 'No se pudieron cargar las estaciones JCAS' : areal30?.motivoSD ?? 'Sin estaciones JCAS por ahora')
                        : `n = ${areal30.nEstaciones} estaciones · cobertura ${areal30.coberturaPct.toFixed(0)} % · provisional`} />
                <Kpi densidad="compacta" etiqueta={`Estaciones en el promedio · ${etiquetaVentana(ventanaObs)}`} valor={areal30 ? String(areal30.nEstaciones) : 'S/D'} unidad={areal30 ? " estaciones" : undefined} contexto={areal30 ? `${areal30.nExcluidas > 0 ? `${areal30.nExcluidas} excluida(s) por sospechosa(s) · ` : ''}JCAS/UACJ y propias · provisional` : 'JCAS/UACJ y propias del distrito'} />
            </div></div>

            <nav className="cu-nav" aria-label="Secciones de la cuenca">
                {SECCIONES_NAV.map((x) => <button key={x.id} type="button" className="cu-nav-btn" aria-current={activa === x.id ? 'true' : undefined} onClick={() => irA(x.id)}>{x.t}</button>)}
            </nav>

            {sinActualizar.length > 0 && (
                <p className="an-aviso" role="status">
                    <b>{sinActualizar.length === 1 ? 'Lectura sin actualizar' : 'Lecturas sin actualizar'}:</b> {sinActualizar.map((f) => `${f.etiqueta}${f.diasIgual ? ` (${f.diasIgual} días igual)` : ''}`).join(', ')}. La fuente repite el último dato obtenido aunque hay aportación o extracción; se sigue mostrando ese último dato (y entra en los totales) hasta que vuelva a cambiar.
                </p>
            )}

            <div className="cu-controles" role="group" aria-label="Vista y filtros de la cuenca">
                <Segmentado<Vista> etiqueta="Vista" valor={vista} onChange={setVista}
                    opciones={[{ v: 'tanques', t: 'Tanques' }, { v: 'tabla', t: 'Tabla' }]} />
                <Segmentado<OrdenCuenca> etiqueta="Orden" valor={orden} onChange={setOrden}
                    opciones={[{ v: 'cuenca', t: 'Cuenca' }, { v: 'llenado', t: '% llenado' }, { v: 'volumen', t: 'Tamaño' }, { v: 'frescura', t: 'Frescura' }]} />
                <Segmentado<Alcance> etiqueta="Presas" valor={alcance} onChange={setAlcance}
                    opciones={[{ v: 'todas', t: 'Todas' }, { v: 'distrito', t: 'Solo distrito' }]} />
                {vista === 'tanques' && (
                    <Segmentado<3 | 12> etiqueta="Serie" valor={meses} onChange={setMeses} opciones={[{ v: 3, t: '3 meses' }, { v: 12, t: '12 meses' }]} />
                )}
            </div>

            {vista === 'tanques' ? (
                <div className="cu-cq" id="cu-presas">
                  <div className="cu-presas-grid">
                    <section className="an-card" aria-label="Tanques de las presas de la cuenca">
                        <h4 className="an-h">Presas de la cuenca</h4>
                        <p className="an-nota">Toque una presa para ver su detalle. El tamaño de cada tanque es su capacidad real; el estado usa los umbrales de referencia de SICA (20 % y 40 % del NAMO de CONAGUA).</p>
                        <FilaTanques modelos={visibles} seleccionada={seleccionId} onSelect={setSel} />
                    </section>
                    {actual && <DetallePresaCuenca m={actual} difCila={actual.fila.presaId ? calc.cila.get(actual.fila.presaId) : undefined} />}
                    <div className="cu-presas-multiplos"><PequenosMultiplos modelos={visibles} meses={meses} seleccionada={seleccionId} onSelect={setSel} /></div>
                  </div>
                </div>
            ) : (
                <section className="an-card" id="cu-presas" aria-label="Estado de las presas de la cuenca">
                    <h4 className="an-h">Presas de la cuenca</h4>
                    <p className="an-nota">Porcentaje sobre el NAMO que publica CONAGUA; los umbrales de estado son referencia interna de SICA. El % útil descuenta el volumen muerto y la posición compara con el mismo día de 2017 a {new Date().getFullYear() - 1}. Caudales del día en m³/s.</p>
                    <div className="cu-tabla-wrap" tabIndex={0} role="region" aria-label="Tabla de presas (desplazable)">
                        <table className="cu-tabla">
                            <thead>
                                <tr>
                                    <th scope="col">Presa</th>
                                    <th scope="col" className="cu-num">Almacenamiento (Mm³)</th>
                                    <th scope="col" className="cu-num">% NAMO</th>
                                    <th scope="col">Estado</th>
                                    <th scope="col" className="cu-num">% útil</th>
                                    <th scope="col" className="cu-num">Posición</th>
                                    <th scope="col">Semáforo</th>
                                    <th scope="col" className="cu-num">Aportación</th>
                                    <th scope="col" className="cu-num">Extracción</th>
                                    <th scope="col" className="cu-num">Vertido</th>
                                    <th scope="col">Dato del</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibles.map((m) => <FilaTabla key={m.fila.ubicacionId} m={m} difCila={m.fila.presaId ? calc.cila.get(m.fila.presaId) : undefined} />)}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            <PlanosCuenca jcas={jcas} capas={capas} diasObs={ventanaObs} onDias={setVentanaObs} />

            <RedEstacionesCuenca jcas={jcas} capas={capas} ventana={ventanaObs} onVentana={setVentanaObs} />

            <MensualCuenca jcas={jcas} />

            <TiraLluvia lluvia={datos.lluvia} serie={datos.lluviaSerie} />

            <details className="an-pie cu-notas">
                <summary className="cu-notas-sum">Cómo se lee y qué límites tiene</summary>
                <ul>
                    <li><b>Fuente:</b> CONAGUA publica a diario y el portal de USIBWC lo reparte. SICA lo copia a tablas propias (última sincronización: {fechaHoraLocal(datos.ultSyncEn)}). Dato provisional sujeto a revisión; USIBWC no lo garantiza.</li>
                    <li><b>Solo contexto:</b> no sustituye la captura de campo ni el reporte CILA, y no entra al balance ni a la proyección. Para Boquilla y Madero se muestra la diferencia contra CILA; una alerta se abre si pasa de 2 %.</li>
                    <li><b>NAMO de CONAGUA:</b> el porcentaje usa el NAMO del portal, que puede diferir del que usa SICA en la pestaña Vaso operativo (Boquilla: 2,846.78 Mm³ en el portal), por eso los porcentajes pueden no coincidir exactamente.</li>
                    <li><b>San Gabriel, Dgo.:</b> la presa San Gabriel (también "Federalismo Mexicano") está en Ocampo, Durango, sobre el Río Florido, y alimenta a Pico del Águila. El nombre del portal no trae el estado; la ficha proviene de fuentes secundarias (Wikipedia, IBWC, Congreso de Chihuahua) y debe contrastarse con CONAGUA.</li>
                    <li><b>Semáforo combinado:</b> el nivel es el peor entre el volumen útil (&lt; 10 % crítico, &lt; 25 % bajo) y la posición histórica (percentil ≤ 10 crítico, ≤ 25 bajo, solo con ≥ 8 años); un descenso con extracción activa lo baja un nivel. Convive con el estado por umbrales fijos 20/40 %, que no se reemplaza.</li>
                    <li><b>Posición histórica:</b> {hayClim ? 'compara con el mismo día del año (±3 días) de 2017 al último año completo, en Mm³ (el NAMO de CONAGUA cambió con los años). Son 9 años, y las observaciones de un mismo año están correlacionadas: el percentil tiene una resolución de unos 11 puntos. No es una probabilidad de excedencia ni un periodo de retorno.' : 'no hay climatología disponible en este momento; se muestra el rango de los últimos 12 meses de cada presa, que no es un histórico.'}</li>
                    <li><b>Lecturas atípicas:</b> se excluyen de las estadísticas los picos de un solo día y la fila corrupta del 08-sep-2020; el dato original se conserva en la base y la ficha de cada presa lo indica.</li>
                    <li><b>Lectura sin actualizar:</b> mismo valor 21 días o más con aportación o extracción activas (≥ 0.05 m³/s). CONAGUA actualiza algunas presas por tramos de 8 a 16 días (Madero) y esas no se marcan. Es un criterio de SICA, no un dictamen. El último dato se sigue mostrando, con la marca y desde cuándo, y no se calcula tendencia.</li>
                    <li><b>Ojinaga:</b> el gasto es el diario del aforo USIBWC 08373000; el sensor Sutron del mismo sitio reporta cifras muy distintas (ver Estaciones GOES).</li>
                    <li><b>Lluvia GOES:</b> el portal publica el acumulado del pluviómetro cada 10–15 minutos, con ruido y reinicios. SICA suma solo los incrementos positivos para obtener mm por día; un día con menos de 18 horas con muestra queda S/D. Solo hay dos ciclos con datos: se compara con el ciclo anterior (n = 1) y nunca se dice qué es lo normal.</li>
                    <li><b>Nivel GOES de Luis L. León:</b> no se usa. La telemetría está congelada (1,025.43 msnm de mayo a septiembre y 1,018.78 msnm desde fines de septiembre) y su almacenamiento no coincide con el diario de CONAGUA. Babisas, Peguis y Boca del Río ya no transmiten en el portal.</li>
                    <li>Las fechas son el día del sello del portal, que usa UTC−6 fijo.</li>
                </ul>
            </details>
        </div>
    );
}
