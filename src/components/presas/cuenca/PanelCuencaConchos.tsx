import { Kpi } from '../../ui/base';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { arealDe, etiquetaVentana, type VentanaObs } from '../../../utils/jcasModelo';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { useAqwpCuenca } from '../../../hooks/useAqwpCuenca';
import { formatearNumero } from '../../../utils/historicoPresas';
import { calcularFrescura } from '../../../utils/presaMetrics';
import { agregadoCuenca, aportacionTotal, restarDias, ORDEN_PRESAS_CUENCA, UBICACION_BOQUILLA, UBICACION_MADERO, UBICACION_OJINAGA } from '../../../utils/aqwpCuenca';
import { construirModeloCuenca } from '../../../utils/cuencaModelo';
import { fechaCorta } from '../../../utils/analiticaPresas';
import BotonInformeCuenca from '../../BotonInformeCuenca';
import PresasCuenca, { type VistaPresas } from './PresasCuenca';
import SeccionCuenca from './SeccionCuenca';
import TiraLluvia from './TiraLluvia';
import { useJcasCuenca } from '../../../hooks/useJcasCuenca';
import { useUnifrutCuenca } from '../../../hooks/useUnifrutCuenca';
import { useCapasCuenca } from '../../../hooks/useCapasCuenca';
import { useCuerposAgua } from '../../../hooks/useCuerposAgua';
import { etiquetaMes, ultimoCierreConDato } from '../../../utils/cuerposAgua';
import SistemaCuenca from './SistemaCuenca';
import BalanceCuenca from './BalanceCuenca';
import SaludFuentesCuenca from './SaludFuentesCuenca';
import { useDerivacionK0 } from '../../../hooks/useDerivacionK0';
import HidrometriaCuenca from './HidrometriaCuenca';
import LecturaCuenca from './LecturaCuenca';
import { useAnotacionesCuenca } from '../../../hooks/useAnotacionesCuenca';
import { ultimaCaptura } from '../../../utils/anotacionesCuenca';
import { useSalidaCuenca } from '../../../hooks/useSalidaCuenca';
import { ID_BOCA_DEL_RIO, ID_VIRGENES, gastoMedio, useHidrometriaCuenca } from '../../../hooks/useHidrometriaCuenca';
import { VENTANAS, ID_OJINAGA_IBWC, ID_OJINAGA_SUTRON, type VentanaHidro } from '../../../utils/hidroEstaciones';
import { anclarSerie, cambioEn, lecturasPresas, lecturasRed, lecturasVasos, salidaCuenca, serieAlmacenamiento, lecturasCierres, type Lectura } from '../../../utils/cuencaAnalisis';
import type { VasoHoy } from './EsquemaRedCuenca';
import '../analitica/analitica.css';
import './cuenca.css';
import { hoyLocalISO } from '../../../utils/hoyLocal';

// Bloques pesados (planos, mapas, satélite, tablas largas): se descargan al abrir su sección, no al abrir la Cuenca.
const PlanosCuenca = lazy(() => import('./PlanosCuenca'));
const RedEstacionesCuenca = lazy(() => import('./RedEstacionesCuenca'));
const MapaClimaCompleto = lazy(() => import('./MapaClimaCompleto'));
const MensualCuenca = lazy(() => import('./MensualCuenca'));
const VasosSatelitalCuenca = lazy(() => import('./VasosSatelitalCuenca'));
const CierresMensualesCuenca = lazy(() => import('./CierresMensualesCuenca'));
const BalanceVaso = lazy(() => import('./BalanceVaso'));
const BalanceTramosRio = lazy(() => import('./BalanceTramosRio'));
const AnotacionesCuenca = lazy(() => import('./AnotacionesCuenca'));
const SalidaCiclosCuenca = lazy(() => import('./SalidaCiclosCuenca'));
const FichaCuerpo = lazy(() => import('./FichaCuerpo'));
const ComparadorCuenca = lazy(() => import('./ComparadorCuenca'));
const cargando = <section className="an-card" role="status" aria-busy="true" aria-label="Cargando sección"><div className="an-skeleton an-skeleton--alta" /></section>;

const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const fmtFlujo = (v: number | null) => (v == null ? 'S/D' : formatearNumero(v, v !== 0 && Math.abs(v) < 1 ? 3 : 2));

function fechaHoraLocal(iso: string | null): string {
    if (!iso) return 'nunca';
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
        ? d.toLocaleString('es-MX', { timeZone: 'America/Chihuahua', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'S/D';
}

type Pestana = 'resumen' | 'vasos' | 'balance' | 'clima';
const PESTANAS: { id: Pestana; t: string; ayuda: string }[] = [
    { id: 'resumen', t: 'Resumen', ayuda: 'Lo más importante, el recorrido del agua y el balance del periodo' },
    { id: 'vasos', t: 'Vasos', ayuda: 'Nivel, estado y tendencia de cada presa, y su espejo de agua por satélite' },
    { id: 'balance', t: 'Balance', ayuda: 'Balance de la cuenca y por tramo, cierres mensuales y estaciones hidrométricas' },
    { id: 'clima', t: 'Clima', ayuda: 'Planos, estaciones y lluvia de la cuenca' },
];
/** Sección que se abre al entrar a cada destino. Las pestañas de antes (Presas, Red, Vasos por satélite, Cierres) son hoy secciones. */
type Seccion = 'presas' | 'satelite' | 'ficha' | 'comparador' | 'cuenca' | 'tramos' | 'ojinaga' | 'cierres' | 'mensualVaso' | 'red' | 'anotaciones' | 'planos' | 'estaciones' | 'mensual' | 'pluviometros';
type Destino = 'presas' | 'vasos' | 'balance' | 'red' | 'clima';
const DESTINOS: Record<Destino, { pestana: Pestana; seccion: Seccion }> = {
    presas: { pestana: 'vasos', seccion: 'presas' },
    vasos: { pestana: 'vasos', seccion: 'satelite' },
    balance: { pestana: 'balance', seccion: 'cuenca' },
    red: { pestana: 'balance', seccion: 'red' },
    clima: { pestana: 'clima', seccion: 'planos' },
};
// Al entrar se ve abierta la primera sección de cada pestaña; las demás muestran su título y una línea de resumen.
const SECCIONES_INICIO: Record<Seccion, boolean> = {
    presas: true, satelite: false, ficha: false, comparador: false, cuenca: true, tramos: false, ojinaga: false, cierres: false, mensualVaso: false, red: false, anotaciones: false,
    planos: true, estaciones: false, mensual: false, pluviometros: false,
};
const CLAVE_PESTANA = 'sica.cuenca.pestana';
const PESTANA_ANTERIOR: Record<string, Pestana> = { presas: 'vasos', red: 'resumen', historico: 'balance' }; // claves guardadas antes de pasar a 4 pestañas
function pestanaInicial(): Pestana {
    try {
        const v = localStorage.getItem(CLAVE_PESTANA);
        if (v && PESTANAS.some((p) => p.id === v)) return v as Pestana;
        if (v && PESTANA_ANTERIOR[v]) return PESTANA_ANTERIOR[v];
    } catch { /* sin almacenamiento */ }
    return 'resumen';
}

/**
 * Vista "Cuenca del Conchos" (Presas → Analítica, Monitor): los cuerpos de agua de la cuenca (presas CONAGUA de Chihuahua y Durango),
 * la red hidrométrica, la lluvia, el espejo por satélite, los cierres y el balance, y la salida por Ojinaga. Solo lectura: no sustituye
 * la captura de campo ni CILA, ni alimenta el balance ni la proyección propios de cada presa del distrito.
 * Todo sale de construirModeloCuenca: el informe institucional usa el MISMO modelo, así las cifras nunca divergen.
 */
export default function PanelCuencaConchos({ conInforme = false }: { conInforme?: boolean }) {
    const { datos, loading, error, recargar } = useAqwpCuenca();
    const capas = useCapasCuenca(); // las mismas capas de referencia en los planos y en el mapa de la red
    const jcas = useJcasCuenca(); // una sola carga de la red JCAS para los planos y la tabla de estaciones
    // Catálogo de cuerpos de agua + cierres mensuales + balance + vasos: carga aparte, un fallo aquí no tira el resto de la vista.
    const cuerpos = useCuerposAgua();
    const [vista, setVista] = useState<VistaPresas>('tanques');
    // Una sola ventana de lo observado para los planos y la red de estaciones (antes cada bloque tenía la suya y podían decir cosas distintas).
    const [ventanaObs, setVentanaObs] = useState<VentanaObs>(30);
    const [mapaCompleto, setMapaCompleto] = useState(false); // mapa interactivo de clima a pantalla completa (propias, JCAS y Unifrut)
    const [sel, setSel] = useState<number | null>(null);
    const [pestana, setPestanaEstado] = useState<Pestana>(pestanaInicial);
    const [abiertas, setAbiertas] = useState<Record<Seccion, boolean>>(SECCIONES_INICIO);
    const alternar = (id: string, abierta: boolean) => setAbiertas((a) => ({ ...a, [id]: abierta }));
    const ancla = useRef<Seccion | null>(null); // sección a la que hay que desplazarse tras cambiar de pestaña
    const guardarPestana = (p: Pestana) => { setPestanaEstado(p); try { localStorage.setItem(CLAVE_PESTANA, p); } catch { /* sin almacenamiento */ } };
    const setPestana = (p: Pestana) => { guardarPestana(p); window.scrollTo?.({ top: 0 }); };
    /** Va a un destino: cambia de pestaña, abre su sección y se desplaza a ella. */
    const irA = (d: Destino) => {
        const { pestana: p, seccion } = DESTINOS[d];
        ancla.current = seccion;
        setAbiertas((a) => ({ ...a, [seccion]: true }));
        guardarPestana(p);
    };
    useEffect(() => {
        const id = ancla.current;
        if (!id) return;
        ancla.current = null;
        const t = requestAnimationFrame(() => document.getElementById(`cu-sec-${id}`)?.scrollIntoView({ block: 'start' }));
        return () => cancelAnimationFrame(t);
    }, [pestana, abiertas]);
    const [ventHidro, setVentHidro] = useState<VentanaHidro>('7d');
    // Red regional Unifrut (fuera del contorno): tabla y mapa de «Clima»; nunca entra al promedio de la cuenca.
    // Solo se pide al abrir esa pestaña (una vez cargada se conserva).
    const unifrut = useUnifrutCuenca(60 * 60_000, { activo: pestana === 'clima' });
    const salida = useSalidaCuenca();
    // Anotaciones (captura manual, cierres revisados): se piden donde se muestran, en Vasos (junto al vaso sin telemetría) y en Balance.
    const anot = useAnotacionesCuenca((pestana === 'vasos' && (abiertas.ficha || abiertas.presas)) || (pestana === 'balance' && abiertas.anotaciones));
    const derivacionK0 = useDerivacionK0(pestana === 'balance' && abiertas.tramos); // la toma K-0 solo se pide al abrir el balance por tramo
    // Las estaciones hidrométricas se dibujan en el sinóptico (Resumen) y en su sección de Balance.
    const hidro = useHidrometriaCuenca(ventHidro, pestana === 'resumen' || (pestana === 'balance' && abiertas.red));

    const calc = useMemo(() => {
        if (!datos) return null;
        const hoyISO = hoyLocalISO();
        const modelos = construirModeloCuenca(datos, hoyISO);
        const filas = modelos.map((m) => m.fila);
        const fechas = filas.map((f) => f.fecha).filter((x): x is string => !!x).sort();
        const ultimaFecha = fechas.length ? fechas[fechas.length - 1] : null;
        return {
            modelos, filas, ultimaFecha,
            ojinaga: datos.estados.find((e) => e.ubicacionId === UBICACION_OJINAGA) ?? null,
            cuenca: agregadoCuenca(filas),
            dist: agregadoCuenca(filas.filter((f) => f.delDistrito)),
            aport: aportacionTotal(filas),
            frescura: calcularFrescura(ultimaFecha, 48),
            cila: new Map(datos.cruceCila.map((c) => [c.presaId, c.difPct])),
        };
    }, [datos]);

    // Almacenamiento total de la cuenca y su cambio (cuando todas las presas tienen dato propio o arrastrado ≤ 16 días).
    const serieTotal = useMemo(() => {
        if (!datos) return [];
        const namo = new Map(datos.estados.map((e) => [e.ubicacionId, e.namoMm3]));
        return serieAlmacenamiento(datos.serie, namo, ORDEN_PRESAS_CUENCA);
    }, [datos]);

    // Lectura del día de cada vaso (telemetría diaria): la dibuja el esquema y la tarjeta satelital.
    const hoyVasos = useMemo(() => {
        const m = new Map<string, VasoHoy>();
        if (!calc || !cuerpos.datos) return m;
        for (const c of cuerpos.datos.cuerpos) {
            const f = c.aqwpUbicacionId == null ? null : calc.filas.find((x) => x.ubicacionId === c.aqwpUbicacionId);
            if (f) m.set(c.id, { almMm3: f.almacenamientoValido, pct: f.pct, fecha: f.fecha });
        }
        return m;
    }, [calc, cuerpos.datos]);

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
    const boquilla = filas.find((f) => f.ubicacionId === UBICACION_BOQUILLA);
    const madero = filas.find((f) => f.ubicacionId === UBICACION_MADERO);
    // Años de historia de la posición (el mayor entre las presas): las notas lo dicen con el número real, no con uno fijo.
    const nAniosHist = calc.modelos.reduce((n, m) => Math.max(n, m.posicion?.nAnios ?? 0), 0) || null;
    const hayClim = datos.climatologia != null;
    const areal30 = jcas.red?.modelo ? arealDe(jcas.red.modelo, ventanaObs) : null; // sigue la ventana elegida (la misma de planos y red)
    const hoyISO = hoyLocalISO();
    // El cambio parte de la MISMA cifra del indicador (que puede traer la captura de campo de hoy), no del último punto de AQUARIUS.
    const cambio30 = cambioEn(cuenca.presasConDato === cuenca.presasTotal ? anclarSerie(serieTotal, { fecha: calc.ultimaFecha, v: cuenca.totalMm3 }) : serieTotal, 30);
    const sal30 = salida.lecturas ? salidaCuenca(salida.lecturas, restarDias(hoyISO, 29), hoyISO, hoyISO) : null;
    const signo = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), d)}`;

    // Lecturas por pestaña (hallazgos en una frase).
    const lecPresas = lecturasPresas(calc.modelos.map((m) => ({ etiqueta: m.fila.etiqueta, pct: m.fila.pct, cambio30Puntos: m.cambio30Puntos, percentil: m.posicion?.percentil ?? null, sinActualizar: m.fila.sinActualizar, atrasoDias: m.atrasoDias })), nAniosHist);
    const itemsVasos = cuerpos.datos ? cuerpos.datos.cuerpos.map((c) => {
        const ser = (cuerpos.datos as NonNullable<typeof cuerpos.datos>).escenas.get(c.idSerie) ?? [];
        const conArea = ser.filter((e) => e.areaKm2 != null);
        return { etiqueta: c.etiqueta, ultima: ser[ser.length - 1], anterior: conArea.length > 1 ? conArea[conArea.length - 2] : undefined, huellaKm2: cuerpos.datos?.huellas.get(c.id)?.areaKm2 ?? null };
    }) : [];
    const lecVasos = cuerpos.datos ? lecturasVasos(itemsVasos, hoyISO) : [];
    const lecResumen: (Lectura & { ir?: string; irTxt?: string })[] = [
        ...lecPresas.slice(0, 2).map((l, i) => (i === 0 ? { ...l, ir: 'presas', irTxt: 'Ver las presas' } : l)),
        ...lecVasos.slice(0, 1).map((l) => ({ ...l, ir: 'vasos', irTxt: 'Ver los vasos por satélite' })),
    ];

    // Red: coherencia de las estaciones hidrométricas contra la aportación publicada.
    const porId = new Map(hidro.estaciones.map((e) => [e.est.id, e]));
    const ibwc = gastoMedio(porId.get(ID_OJINAGA_IBWC)?.stat ?? null), sutron = gastoMedio(porId.get(ID_OJINAGA_SUTRON)?.stat ?? null);
    const cruces = [{ id: ID_BOCA_DEL_RIO, presa: 'La Boquilla', fila: boquilla }, { id: ID_VIRGENES, presa: 'F. I. Madero', fila: madero }].flatMap((c) => {
        const e = porId.get(c.id);
        return e && c.fila ? [{ estacion: e.sitio.corto, presa: c.presa, medidoM3s: gastoMedio(e.stat), reportadoM3s: c.fila.aportacionM3s, fechaReportado: c.fila.fecha ? fechaCorta(c.fila.fecha) : null }] : [];
    });
    const lecRed = hidro.estaciones.length ? lecturasRed(
        hidro.estaciones.map((e) => ({ nombre: e.sitio.corto, rol: e.sitio.rol, destino: e.sitio.haciaTxt, gastoMedio: gastoMedio(e.stat), volumenMm3: e.stat?.volumen?.mm3 ?? null, enLinea: e.enlace.clave === 'en_linea' || e.enlace.clave === 'retraso', reserva: e.sitio.reserva })),
        VENTANAS[ventHidro].etiqueta.toLowerCase(), cruces, { ibwc, sutron },
    ) : [];
    const lecCierres = cuerpos.datos ? lecturasCierres(cuerpos.datos.cuerpos, cuerpos.datos.cierres) : [];

    const avisoSinActualizar = sinActualizar.length > 0 && (
        <p className="an-aviso" role="status">
            <b>{sinActualizar.length === 1 ? 'Lectura sin actualizar' : 'Lecturas sin actualizar'}:</b> {sinActualizar.map((f) => `${f.etiqueta}${f.diasIgual ? ` (${f.diasIgual} días igual)` : ''}`).join(', ')}. La fuente repite el último dato obtenido aunque hay aportación o extracción; se sigue mostrando ese último dato (y entra en los totales) hasta que vuelva a cambiar.
        </p>
    );
    const avisoSinTelemetria = cuerpos.datos && (() => {
        const sinTelemetria = cuerpos.datos.cuerpos.filter((c) => c.aqwpUbicacionId == null);
        return sinTelemetria.length > 0 && (
            <p className="an-aviso" role="status">
                <b>{sinTelemetria.length === 1 ? 'Cuerpo de agua sin telemetría vigente' : 'Cuerpos de agua sin telemetría vigente'}:</b>{' '}
                {sinTelemetria.map((c) => {
                    const u = ultimoCierreConDato(cuerpos.datos!.cierres.filter((x) => x.cuerpoId === c.id));
                    // Una captura manual más reciente que el último cierre es el dato que se dice primero, con su fecha y su origen.
                    const cap = ultimaCaptura(anot.filas ?? [], c.id);
                    if (cap && (!u || cap.fecha > (u.fechaDato ?? u.fechaCierre))) return `${c.etiqueta} (captura manual del ${fechaCorta(cap.fecha)}: ${cap.almMm3 != null ? `${formatearNumero(cap.almMm3, 2)} Mm³` : cap.elevMsnm != null ? `${formatearNumero(cap.elevMsnm, 2)} msnm` : 'S/D'}; origen: ${cap.origen ?? 'S/D'})`;
                    return u && u.almMm3 != null
                        ? `${c.etiqueta} (último dato SINA: ${etiquetaMes(u.mes, true)}, ${formatearNumero(u.almMm3, 1)} Mm³; después S/D)`
                        : `${c.etiqueta} (${c.rol === 'reguladora' ? 'reguladora; ' : ''}no está en SINA ni en AQUARIUS: almacenamiento S/D, solo se mide el espejo por satélite)`;
                }).join('; ')}.
            </p>
        );
    })();
    const estadoCuerpos = (
        <>
            {cuerpos.loading && !cuerpos.datos && <section className="an-card" role="status" aria-busy="true" aria-label="Cargando cuerpos de agua"><div className="an-skeleton" /></section>}
            {cuerpos.error && (
                <section className="an-card" aria-label="Cuerpos de agua de la cuenca">
                    <div className="an-vacio" role="alert">
                        <strong>No se pudo cargar el catálogo de cuerpos de agua.</strong>
                        <span>{cuerpos.error}</span>
                        <button type="button" className="an-btn" onClick={cuerpos.recargar}>Reintentar</button>
                    </div>
                </section>
            )}
        </>
    );

    // Sinóptico «El agua en la cuenca» (Resumen): es la red de la cuenca; sus nodos llevan al detalle de cada sección.
    const sistema = cuerpos.datos ? (
        <SistemaCuenca cuerpos={cuerpos.datos} modelos={calc.modelos} estaciones={hidro.estaciones} ventHidro={ventHidro} onVentHidro={setVentHidro}
            lluvia={jcas.red?.modelo ?? null} lluviaEstado={jcas.red?.modelo ? 'lista' : jcas.loading ? 'cargando' : 'error'} ventanaObs={ventanaObs} onVentanaObs={setVentanaObs}
            ojinaga={ojinaga} salidaMedia30={sal30?.gastoMedio ?? null}
            onIr={(d, ubicacionId) => { if (ubicacionId != null) { setSel(ubicacionId); setVista('tanques'); } irA(d); }} />
    ) : null;

    return (
        <div className="an-root cu-root pr-reveal">
            <header className="an-head">
                <div>
                    <h3 className="an-titulo">Cuenca del Conchos</h3>
                    <p className="an-sub">Vasos, ríos, lluvia y salida por Ojinaga · CONAGUA, CILA, red GOES, satélite y estaciones de clima · datos provisionales</p>
                </div>
                <div className="cu-head-acc">
                    <span className={`an-chip an-chip--${frescura == null ? 'sd' : frescura.stale ? 'warn' : 'ok'}`}>
                        <span aria-hidden="true">{frescura == null ? '◇' : frescura.stale ? '▲' : '●'}</span> {frescura ? frescura.texto : 'Sin lectura (S/D)'}
                    </span>
                    {conInforme && <BotonInformeCuenca datos={datos} />}
                </div>
            </header>

            <SaludFuentesCuenca />

            <div className="cu-cq"><div className="an-kpis an-kpis--5" role="list">
                <Kpi densidad="compacta" etiqueta="Almacenamiento de la cuenca" valor={fmt(cuenca.totalMm3, 1)} unidad=" Mm³"
                    estado={cambio30 ? { tipo: Math.abs(cambio30.delta) < 1 ? 'sd' : cambio30.delta > 0 ? 'ok' : 'warn', texto: `${signo(cambio30.delta)} Mm³ en 30 d` } : null}
                    contexto={<>{cuenca.porcentaje == null ? 'Sin lectura vigente' : `${formatearNumero(cuenca.porcentaje, 1)} % del NAMO`} · {cuenca.presasConDato} de {cuenca.presasTotal} presas con dato{cuenca.parcial ? ' (parcial)' : ''}</>} />
                <Kpi densidad="compacta" etiqueta="Presas del distrito" valor={fmt(dist.totalMm3, 1)} unidad=" Mm³" contexto={<>{dist.porcentaje == null ? 'Sin lectura vigente' : `${formatearNumero(dist.porcentaje, 1)} % del NAMO`} · Boquilla {boquilla?.pct == null ? 'S/D' : `${formatearNumero(boquilla.pct, 1)} %`} · Madero {madero?.pct == null ? 'S/D' : `${formatearNumero(madero.pct, 1)} %`}</>} />
                <Kpi densidad="compacta" etiqueta="Aportaciones reportadas" valor={fmtFlujo(aport.total)} unidad=" m³/s" contexto={<>Última lectura de cada presa · {aport.conDato} de {filas.length} con dato · puede repetir agua en cascada</>} />
                <Kpi densidad="compacta" etiqueta="Salida de la cuenca · Ojinaga" valor={fmtFlujo(ojinaga?.gastoM3s ?? null)} unidad=" m³/s"
                    contexto={<>Aforo USIBWC 08373000{ojinaga?.fecha ? ` · ${fechaCorta(ojinaga.fecha)}` : ''}{sal30?.gastoMedio != null ? ` · media 30 d: ${formatearNumero(sal30.gastoMedio, 2)} m³/s` : ''}</>} />
                <Kpi densidad="compacta" etiqueta={`Lluvia de la cuenca · ${etiquetaVentana(ventanaObs)}`} valor={areal30?.mm == null ? 'S/D' : fmtLluvia(areal30.mm)} unidad={areal30?.mm != null ? " mm" : undefined} contexto={areal30?.mm == null
                        ? (jcas.loading ? 'Cargando estaciones…' : jcas.error ? 'No se pudieron cargar las estaciones JCAS' : areal30?.motivoSD ?? 'Sin estaciones JCAS por ahora')
                        : `n = ${areal30.nEstaciones} estaciones${areal30.nExcluidas > 0 ? ` (${areal30.nExcluidas} excluida${areal30.nExcluidas === 1 ? '' : 's'} por sospechosa${areal30.nExcluidas === 1 ? '' : 's'})` : ''} · cobertura ${areal30.coberturaPct.toFixed(0)} % · provisional`} />
            </div></div>

            <nav className="cu-nav" aria-label="Secciones de la cuenca">
                {PESTANAS.map((x) => <button key={x.id} type="button" className="cu-nav-btn" title={x.ayuda} aria-current={pestana === x.id ? 'page' : undefined} onClick={() => setPestana(x.id)}>{x.t}</button>)}
            </nav>

            {pestana === 'resumen' && (
                <>
                    {avisoSinActualizar}
                    <LecturaCuenca columnas titulo="Lo más importante hoy" lecturas={lecResumen} onIr={(d) => irA(d as Destino)} />
                    {estadoCuerpos}
                    {sistema}
                    {cuerpos.datos && <BalanceCuenca compacto datos={cuerpos.datos} salida={salida.lecturas} hoyISO={hoyISO} onIr={() => irA('balance')} />}
                </>
            )}

            {pestana === 'vasos' && (
                <>
                    {avisoSinActualizar}
                    <SeccionCuenca id="presas" titulo="Presas con telemetría diaria" abierta={abiertas.presas} onAlternar={alternar}
                        resumen={<>{cuenca.presasConDato} de {cuenca.presasTotal} con dato · {cuenca.porcentaje == null ? 'S/D' : `${formatearNumero(cuenca.porcentaje, 1)} % del NAMO`}</>}
                        notas={<>
                            <li><b>NAMO de CONAGUA:</b> el porcentaje usa el NAMO del portal, que puede diferir del que usa SICA en la pestaña Vaso operativo (Boquilla: 2,846.78 Mm³ en el portal), por eso los porcentajes pueden no coincidir exactamente.</li>
                            <li><b>Semáforo combinado:</b> el nivel es el peor entre el volumen útil (&lt; 10 % crítico, &lt; 25 % bajo) y la posición histórica (percentil ≤ 10 crítico, ≤ 25 bajo, solo con ≥ 8 años); un descenso con extracción activa lo baja un nivel. Convive con el estado por umbrales fijos 20/40 %, que no se reemplaza.</li>
                            <li><b>Posición histórica:</b> {hayClim ? `compara con el mismo día del año (±3 días) de 2017 al último año completo, en Mm³ (el NAMO de CONAGUA cambió con los años). ${nAniosHist ? `Son ${nAniosHist} años, y las observaciones de un mismo año están correlacionadas: el percentil tiene una resolución de unos ${Math.round(100 / nAniosHist)} puntos.` : 'Son pocos años y las observaciones de un mismo año están correlacionadas.'} No es una probabilidad de excedencia ni un periodo de retorno.` : 'no hay climatología disponible en este momento; se muestra el rango de los últimos 12 meses de cada presa, que no es un histórico.'}</li>
                            <li><b>Lectura sin actualizar:</b> mismo valor 21 días o más con aportación o extracción activas (≥ 0.05 m³/s). CONAGUA actualiza algunas presas por tramos de 8 a 16 días (Madero) y esas no se marcan. Es un criterio de SICA, no un dictamen. El último dato se sigue mostrando, con la marca y desde cuándo, y no se calcula tendencia.</li>
                            <li><b>Lecturas atípicas:</b> se excluyen de las estadísticas los picos de un solo día y la fila corrupta del 08-sep-2020; el dato original se conserva en la base y la ficha de cada presa lo indica.</li>
                            <li><b>San Gabriel, Dgo.:</b> la presa San Gabriel (también "Federalismo Mexicano") está en Ocampo, Durango, sobre el Río Florido, y alimenta a Pico del Águila. El nombre del portal no trae el estado; la ficha proviene de fuentes secundarias (Wikipedia, IBWC, Congreso de Chihuahua) y debe contrastarse con CONAGUA.</li>
                        </>}>
                        <LecturaCuenca titulo="Qué mirar en las presas" lecturas={lecPresas} />
                        <PresasCuenca modelos={calc.modelos} cila={calc.cila} vista={vista} onVista={setVista} sel={sel} onSel={setSel} />
                        {avisoSinTelemetria}
                    </SeccionCuenca>
                    <SeccionCuenca id="ficha" titulo="Ficha por cuerpo de agua" abierta={abiertas.ficha} onAlternar={alternar}
                        resumen="Nivel, cierre, fuentes, espejo y balance de un cuerpo, con su fecha y origen">
                        {cuerpos.datos && <Suspense fallback={cargando}><FichaCuerpo datos={cuerpos.datos} hoy={hoyVasos} anotaciones={anot.filas ?? []} /></Suspense>}
                    </SeccionCuenca>
                    <SeccionCuenca id="comparador" titulo="Comparador de vasos y años" abierta={abiertas.comparador} onAlternar={alternar}
                        resumen="% del NAMO de hasta 4 vasos, o un vaso año contra año">
                        {cuerpos.datos && <Suspense fallback={cargando}><ComparadorCuenca datos={cuerpos.datos} /></Suspense>}
                    </SeccionCuenca>
                    <SeccionCuenca id="satelite" titulo="Espejo de agua por satélite" abierta={abiertas.satelite} onAlternar={alternar}
                        resumen={cuerpos.datos ? `${cuerpos.datos.cuerpos.length} cuerpos de agua · huella máxima y última escena` : 'Huella máxima y última escena de cada vaso'}>
                        {estadoCuerpos}
                        {cuerpos.datos && <Suspense fallback={cargando}><VasosSatelitalCuenca datos={cuerpos.datos} aviso={cuerpos.avisoSatelite} hoyISO={hoyISO} hoy={hoyVasos} /></Suspense>}
                    </SeccionCuenca>
                </>
            )}

            {pestana === 'balance' && (
                <>
                    {estadoCuerpos}
                    <SeccionCuenca id="cuenca" titulo="Balance de la cuenca" abierta={abiertas.cuenca} onAlternar={alternar}
                        resumen="Cuánto cambió el almacenamiento, cuánto entró y cuánto salió en el periodo"
                        notas={<>
                            <li><b>Balance de la cuenca:</b> sale de los cierres mensuales y de los flujos diarios que publica CONAGUA. No es un balance cerrado: sus límites se dicen al pie de la tabla.</li>
                            <li><b>Ojinaga:</b> el gasto es el diario del aforo USIBWC 08373000; el sensor Sutron del mismo sitio reporta cifras muy distintas (ver «Estaciones hidrométricas»).</li>
                        </>}>
                        {cuerpos.datos && <BalanceCuenca datos={cuerpos.datos} salida={salida.lecturas} hoyISO={hoyISO} />}
                    </SeccionCuenca>
                    <SeccionCuenca id="tramos" titulo="Balance por tramo de río" abierta={abiertas.tramos} onAlternar={alternar}
                        resumen="Lo que sale de los vasos de arriba contra lo que llega abajo">
                        {cuerpos.datos && <Suspense fallback={cargando}><BalanceTramosRio datos={cuerpos.datos} ojinaga={salida.lecturas} k0={derivacionK0.lecturas} hoyISO={hoyISO} /></Suspense>}
                    </SeccionCuenca>
                    <SeccionCuenca id="ojinaga" titulo="Salida por Ojinaga por ciclo" abierta={abiertas.ojinaga} onAlternar={alternar}
                        resumen="Volumen que dejó la cuenca en el ciclo en curso contra los anteriores, a igual fecha">
                        <Suspense fallback={cargando}><SalidaCiclosCuenca salida={salida.lecturas} hoyISO={hoyISO} /></Suspense>
                    </SeccionCuenca>
                    <SeccionCuenca id="cierres" titulo="Cierres mensuales" abierta={abiertas.cierres} onAlternar={alternar}
                        resumen="Almacenamiento al cierre de cada mes desde 2021, por fuente y calidad">
                        {cuerpos.datos && (
                            <Suspense fallback={cargando}>
                                <LecturaCuenca titulo="Qué mirar en los cierres" lecturas={lecCierres} />
                                <CierresMensualesCuenca datos={cuerpos.datos} />
                            </Suspense>
                        )}
                    </SeccionCuenca>
                    <SeccionCuenca id="mensualVaso" titulo="Balance mensual por vaso" abierta={abiertas.mensualVaso} onAlternar={alternar}
                        resumen="Entradas, salidas, evaporación y residuo de cada vaso, mes a mes">
                        {cuerpos.datos && <Suspense fallback={cargando}><BalanceVaso datos={cuerpos.datos} /></Suspense>}
                    </SeccionCuenca>
                    <SeccionCuenca id="red" titulo="Estaciones hidrométricas" abierta={abiertas.red} onAlternar={alternar}
                        resumen={hidro.estaciones.length ? `${hidro.estaciones.filter((e) => e.enlace.clave === 'en_linea' || e.enlace.clave === 'retraso').length} de ${hidro.estaciones.length} estaciones transmitiendo · gasto y volumen por periodo` : 'Gasto y volumen de los ríos entre los vasos'}
                        notas={<>
                            <li><b>Nivel GOES de Luis L. León:</b> no se usa. La telemetría está congelada (1,025.43 msnm de mayo a septiembre y 1,018.78 msnm desde fines de septiembre) y su almacenamiento no coincide con el diario de CONAGUA. El gasto de Boca del Río, Vírgenes y Babisas no sale de ese portal: llega por la red GOES directa.</li>
                        </>}>
                        <LecturaCuenca titulo="Qué mirar en la red" lecturas={lecRed} />
                        <HidrometriaCuenca estaciones={hidro.estaciones} ventana={ventHidro} onVentana={setVentHidro} cargando={hidro.cargando} error={hidro.error} />
                        {avisoSinTelemetria}
                    </SeccionCuenca>
                    <SeccionCuenca id="anotaciones" titulo="Anotaciones y captura manual" abierta={abiertas.anotaciones} onAlternar={alternar}
                        resumen="Captura de vasos sin telemetría, cierres revisados y lecturas sospechosas">
                        {cuerpos.datos && <Suspense fallback={cargando}><AnotacionesCuenca cuerpos={cuerpos.datos.cuerpos} anot={anot} hoyISO={hoyISO} /></Suspense>}
                    </SeccionCuenca>
                </>
            )}

            {pestana === 'clima' && (
                <Suspense fallback={cargando}>
                    <SeccionCuenca id="planos" titulo="Planos de la cuenca" abierta={abiertas.planos} onAlternar={alternar}
                        resumen={`Lluvia y clima interpolados · ${etiquetaVentana(ventanaObs)}`}>
                        <PlanosCuenca jcas={jcas} capas={capas} diasObs={ventanaObs} onDias={setVentanaObs} unifrut={unifrut} onMapaCompleto={() => setMapaCompleto(true)} />
                    </SeccionCuenca>
                    <SeccionCuenca id="estaciones" titulo="Red de estaciones de clima" abierta={abiertas.estaciones} onAlternar={alternar}
                        resumen="Mapa y tabla de las estaciones JCAS/UACJ, propias y Unifrut">
                        <RedEstacionesCuenca jcas={jcas} unifrut={unifrut} capas={capas} ventana={ventanaObs} onVentana={setVentanaObs} onMapaCompleto={() => setMapaCompleto(true)} />
                    </SeccionCuenca>
                    {mapaCompleto && <MapaClimaCompleto jcas={jcas} unifrut={unifrut} capas={capas} ventanaInicial={ventanaObs} onCerrar={() => setMapaCompleto(false)} />}
                    <SeccionCuenca id="mensual" titulo="Mes a mes" abierta={abiertas.mensual} onAlternar={alternar}
                        resumen="Lluvia y clima de la cuenca por mes">
                        <MensualCuenca jcas={jcas} />
                    </SeccionCuenca>
                    <SeccionCuenca id="pluviometros" titulo="Pluviómetros del portal" abierta={abiertas.pluviometros} onAlternar={alternar}
                        resumen="Villalba y Luis L. León · lluvia diaria"
                        notas={<>
                            <li><b>Pluviómetros del portal (Villalba, Luis L. León):</b> el portal publica el acumulado del pluviómetro cada 10–15 minutos, con ruido y reinicios. SICA suma solo los incrementos positivos para obtener mm por día; un día con menos de 18 horas con muestra queda S/D. Solo hay dos ciclos con datos: se compara con el ciclo anterior (n = 1) y nunca se dice qué es lo normal.</li>
                        </>}>
                        <TiraLluvia lluvia={datos.lluvia} serie={datos.lluviaSerie} />
                    </SeccionCuenca>
                </Suspense>
            )}

            <details className="an-pie cu-notas">
                <summary className="cu-notas-sum">Fuente, alcance y vigencia</summary>
                <ul>
                    <li><b>Fuente de las presas:</b> CONAGUA publica a diario y el portal de USIBWC lo reparte. SICA lo copia a tablas propias (última sincronización: {fechaHoraLocal(datos.ultSyncEn)}). Dato provisional sujeto a revisión; USIBWC no lo garantiza.</li>
                    <li><b>Alcance:</b> es una vista de lectura de toda la cuenca; lo único que se captura aquí son las anotaciones de «Balance». No sustituye la captura de campo ni el reporte CILA, y no alimenta el balance ni la proyección propios de cada presa del distrito. En La Boquilla y F. I. Madero manda la lectura oficial de SICA (captura de campo o CILA) cuando es igual o más reciente que la del portal; se muestra la diferencia contra CILA y una alerta se abre si pasa de 2 %.</li>
                    <li><b>Fechas:</b> son el día del sello del portal, que usa UTC−6 fijo. Las notas de cada cifra están en «Cómo se lee», al pie de su sección.</li>
                </ul>
            </details>
        </div>
    );
}
