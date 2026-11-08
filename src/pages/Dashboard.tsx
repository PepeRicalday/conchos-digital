import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import { Loader } from 'lucide-react';
import { useHydraEngine } from '../hooks/useHydraEngine';
import { usePresas } from '../hooks/usePresas';
import { useLeakMonitor } from '../hooks/useLeakMonitor';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { usePredictiveBalance } from '../hooks/usePredictiveBalance';
import { useAlertasRegistro } from '../hooks/useAlertasSistema';
import { useCanalPerfil, useClimaPulso, useVolumenCanal, useEtoReciente } from '../hooks/useDashboardPulso';
import { useUmbralesClima } from '../hooks/useClimaOperativo';
import { umbralVigente } from '../utils/umbralesClima';
import { useFecha } from '../context/FechaContext';
import { supabase } from '../lib/supabase';
import { getTodayString } from '../utils/dateHelpers';
import { porcentajeLlenadoPresa } from '../utils/presaMetrics';
import {
    extraccionTotalMedida, cumplimientoModulo, PRESA_ALTA_PCT, UMBRAL_DIAS_PROTOCOLO,
    fusionaAlertas, resumenAlertas, type AlertaSistema,
} from '../utils/dashboardKpis';
import { construyeAlertasVivas, diasDesde } from '../utils/alertasVivas';
import { useDashboardExtra } from '../hooks/useDashboardExtra';
import { useAqwpCuenca } from '../hooks/useAqwpCuenca';
import { cuencaCompacta } from '../utils/aqwpCuenca';
import { serieAlmacenamiento } from '../utils/dashboardExtra';
import { PanelKpis, derivaEstados, estadosTarjetas, type ModeloKpis } from '../components/dashboard/PanelKpis';
import { BarraCentro } from '../components/dashboard/BarraCentro';
import { AlertasDrawer } from '../components/dashboard/AlertasDrawer';
import { avanceDistrito } from '../utils/distribucion';
import { modeloSuficiencia } from '../utils/suficiencia';
import { resumenCultivosCiclo, anioDelCiclo } from '../utils/cultivosCiclo';
import {
    estadoPresas, avanceCiclo, diasCiclo, brechaCiclo, estadoModulo, demandaRiego, confianzaTablero, tendenciaTexto,
    type EstadoKpi, type FuenteConfianza,
} from '../utils/dashboardKpisEjecutivos';
import { getLogoVector } from '../utils/uiHelpers';
import type { VwAlertaTomaVaradaRow } from '../types/sica.types';
import type { EntradaInformeGeneral } from '../utils/informeGeneralHtml';
import './Dashboard.css';
import '../styles/sala-control.css';
import '../components/dashboard/DashboardTema.css';
import '../components/dashboard/KpiPanel.css';
import '../components/dashboard/ClimaHero.css';

const InformeGeneralModal = lazy(() => import('../components/dashboard/InformeGeneralModal'));

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const fechaCorta = (s: string) => { const [y, m, d] = s.split('-'); return `${parseInt(d, 10)} ${MESES[parseInt(m, 10) - 1]} ${y}`; };

/** Reloj con la cadencia pedida; en fechas históricas no avanza (no hay nada que interpolar). */
function useReloj(ms: number, activo: boolean): number {
    const [t, setT] = useState(() => Date.now());
    useEffect(() => {
        if (!activo) return;
        const id = window.setInterval(() => setT(Date.now()), ms);
        return () => window.clearInterval(id);
    }, [ms, activo]);
    return t;
}

/** Alto real disponible para el contenido (alto del área con scroll menos su relleno): la primera pantalla mide exactamente eso. */
function useAlturaVisible(): number | null {
    const [h, setH] = useState<number | null>(null);
    useLayoutEffect(() => {
        const main = document.querySelector<HTMLElement>('.main-content');
        if (!main) return;
        const medir = () => {
            const cs = getComputedStyle(main);
            setH(Math.max(0, Math.round(main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))));
        };
        medir();
        // Un resize dispara decenas de eventos por segundo: se mide una sola vez por frame (antes, un render completo del Dashboard por evento).
        let raf = 0;
        const programar = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; medir(); }); };
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(programar);
        ro?.observe(main);
        window.addEventListener('resize', programar);
        return () => { if (raf) cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('resize', programar); };
    }, []);
    return h;
}

const Dashboard = () => {
    const alturaFold = useAlturaVisible();
    const [drawerAbierto, setDrawerAbierto] = useState(false);
    const [informeAbierto, setInformeAbierto] = useState(false);
    const abrirDrawer = useCallback(() => setDrawerAbierto(true), []);   // estable: si fuera una función nueva, el memo de PanelKpis no serviría de nada
    const { fechaSeleccionada, esHoy } = useFecha();
    const { activeEvent } = useHydricEvents();
    const { modules, loading: loadingModules } = useHydraEngine();
    const { presas, totalAlmacenamiento, almacenamiento, frescuraLectura, loading: loadingPresas, error: errorPresas } = usePresas(fechaSeleccionada);
    const { segments, loading: loadingLeaks } = useLeakMonitor();
    const { alertas: predictivas } = usePredictiveBalance();
    const { alertas: alertasRegistro, error: errorRegistro } = useAlertasRegistro();
    const canal = useCanalPerfil(activeEvent?.evento_tipo === 'VACIADO');
    const { pulso: clima, cargado: climaCargado } = useClimaPulso();
    const { vol: volumenCanal } = useVolumenCanal();
    const etoReciente = useEtoReciente(7);
    const umbralesClima = useUmbralesClima();
    const vaciadoDesde = activeEvent?.evento_tipo === 'VACIADO' ? activeEvent.fecha_inicio ?? null : null;

    // ── Consultas propias del Dashboard (columnas explícitas; historial de 7 días de lecturas_presas) ──
    const [tomasVaradas, setTomasVaradas] = useState<VwAlertaTomaVaradaRow[]>([]);
    const [extraccionFilas, setExtraccionFilas] = useState<{ fecha: string; presa_id: string; almacenamiento_mm3: number | null; extraccion_total_m3s: number | null }[]>([]);
    const [fuentesCaidas, setFuentesCaidas] = useState<string[]>([]);
    const [cicloAct, setCicloAct] = useState<{ clave: string; fecha_inicio: string; fecha_fin: string } | null>(null);
    const extra = useDashboardExtra(clima.excluidasIds);
    // Cuenca del Conchos (portal USIBWC): solo contexto. Modo ligero (sin serie de 12 meses) y refresco lento (30 min):
    // el portal publica una vez al día y la sala queda abierta todo el día. No toca realtime ni el modelo estable salvo al cambiar.
    const cuenca = useAqwpCuenca({ conSerie: false, refrescoMs: 30 * 60_000 });
    const cuencaR = useMemo(() => (cuenca.datos ? cuencaCompacta(cuenca.datos.estados, cuenca.datos.lluvia) : null), [cuenca.datos]);

    // Reloj de alertas (5 min): también refresca las consultas propias (tomas varadas cambian con el día), sin pedir con la pestaña oculta.
    const ahoraAlertas = useReloj(5 * 60_000, true);
    const cicloRefresco = Math.floor(ahoraAlertas / (5 * 60_000));

    useEffect(() => {
        let cancelado = false;
        if (document.hidden && cicloRefresco > 0 && esHoy) return;
        void (async () => {
            const hasta = fechaSeleccionada || getTodayString();
            const desde = new Date(`${hasta}T00:00:00Z`); desde.setUTCDate(desde.getUTCDate() - 6);
            const [t, h, ci] = await Promise.allSettled([
                supabase.from('vw_alertas_tomas_varadas').select('punto_id, punto_nombre, ultimo_estado, dias_varada'),
                supabase.from('lecturas_presas').select('fecha, presa_id, almacenamiento_mm3, extraccion_total_m3s').gte('fecha', desde.toISOString().slice(0, 10)).lte('fecha', hasta).order('fecha', { ascending: true }),
                supabase.from('ciclos_agricolas').select('clave, fecha_inicio, fecha_fin').eq('activo', true).limit(1),
            ]);
            if (cancelado) return;
            const caidas: string[] = [];
            const ok = (r: PromiseSettledResult<{ data: unknown; error: unknown }>, nombre: string): unknown => {
                if (r.status === 'fulfilled' && !r.value.error) return r.value.data;
                console.error(`[Dashboard] Error cargando ${nombre}`, r.status === 'rejected' ? r.reason : r.value.error);
                caidas.push(nombre);
                return null;
            };
            setTomasVaradas((ok(t, 'Tomas varadas') ?? []) as VwAlertaTomaVaradaRow[]);
            setExtraccionFilas((ok(h, 'Historial de presas') ?? []) as { fecha: string; presa_id: string; almacenamiento_mm3: number | null; extraccion_total_m3s: number | null }[]);
            const cicloFilas = (ok(ci, 'Ciclo agrícola') ?? []) as { clave: string; fecha_inicio: string; fecha_fin: string }[];
            setCicloAct(cicloFilas[0] ?? null);
            setFuentesCaidas(caidas);
        })();
        return () => { cancelado = true; };
    }, [fechaSeleccionada, cicloRefresco, esHoy]);

    // ── Derivados ──
    const extraccion = useMemo(() => extraccionTotalMedida(presas), [presas]);
    const serieAlm = useMemo(() => serieAlmacenamiento(extraccionFilas, fechaSeleccionada || getTodayString(), 7, presas.length), [extraccionFilas, fechaSeleccionada, presas.length]);

    // Estado de la telemetría GOES para la alerta viva (null mientras no se sabe: no se afirma nada).
    const goesResumen = useMemo(() => (extra.goes.datos && extra.goes.datos.length
        ? { total: extra.goes.datos.length, sinTransmision: extra.goes.datos.filter((g) => g.enlace.clave === 'sin_transmision').length }
        : null), [extra.goes.datos]);

    // Alertas: calculadas en vivo + persistidas, una sola cifra para KPI, lista y menú.
    const vivas: AlertaSistema[] = useMemo(() => construyeAlertasVivas({
        tomasVaradas: tomasVaradas as never,
        tramos: segments,
        modulos: modules.map((m) => ({ id: m.id, name: m.name, current_flow: m.current_flow, target_flow: m.target_flow })),
        presas,
        protocolo: activeEvent ? { id: activeEvent.id, evento_tipo: activeEvent.evento_tipo, fecha_inicio: activeEvent.fecha_inicio } : null,
        predictivas: predictivas as AlertaSistema[],
        ahoraMs: ahoraAlertas,
        goes: goesResumen,
    }), [tomasVaradas, segments, modules, presas, activeEvent, predictivas, ahoraAlertas, goesResumen]);
    const alertas = useMemo(() => fusionaAlertas(vivas, alertasRegistro), [vivas, alertasRegistro]);
    const resumen = useMemo(() => resumenAlertas(alertas), [alertas]);

    // Protocolo operativo activo: contexto que cambia cómo se leen los KPIs (p. ej. VACIADO con las presas cerradas).
    const protocolo = useMemo((): EstadoKpi | null => {
        if (!activeEvent) return null;
        const d = diasDesde(activeEvent.fecha_inicio, ahoraAlertas);
        const vencido = (d ?? 0) > UMBRAL_DIAS_PROTOCOLO;
        return { tipo: vencido ? 'crit' : 'info', texto: `Protocolo ${activeEvent.evento_tipo}${d != null ? ` · ${d} d` : ''}${vencido ? ' · revisar cierre' : ''}`, corto: `${activeEvent.evento_tipo}${d != null ? ` · ${d} d` : ''}` };
    }, [activeEvent, ahoraAlertas]);

    // ── KPIs de la primera pantalla ──
    const hoyISO = getTodayString();
    const avance = useMemo(() => avanceCiclo(hoyISO, cicloAct?.fecha_inicio, cicloAct?.fecha_fin, cicloAct?.clave ?? null), [hoyISO, cicloAct]);
    const avanceDist = useMemo(() => avanceDistrito(modules), [modules]);
    const enLineaGoes = extra.goes.datos ? extra.goes.datos.filter((g) => g.enlace.clave === 'en_linea' || g.enlace.clave === 'retraso').length : null;

    const confianza = useMemo(() => {
        const edadH = (iso: string | null) => (iso ? (ahoraAlertas - Date.parse(iso)) / 3_600_000 : null);
        const mesMin = (() => { const d = new Date(ahoraAlertas); const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() - 1; return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`; })();
        const fuentes: FuenteConfianza[] = [
            { clave: 'presas', nombre: 'Presas', ok: loadingPresas && presas.length === 0 ? null : almacenamiento.presasConDato > 0 && !frescuraLectura?.stale },
            { clave: 'escalas', nombre: 'Escalas', ok: canal.cargado ? canal.modelo.conMedicion > 0 : null },
            { clave: 'goes', nombre: 'GOES', ok: enLineaGoes != null ? enLineaGoes > 0 : extra.goes.cargado ? false : null },
            { clave: 'clima', nombre: 'Clima', ok: climaCargado ? (clima.ultimaObs ? (edadH(clima.ultimaObs) ?? 99) <= 3 : false) : null },
            { clave: 'ndvi', nombre: 'NDVI', ok: extra.ndvi.datos?.mes ? extra.ndvi.datos.mes >= mesMin : extra.ndvi.cargado ? false : null },
        ];
        return confianzaTablero(fuentes);
    }, [ahoraAlertas, loadingPresas, presas.length, almacenamiento.presasConDato, frescuraLectura, canal.cargado, canal.modelo.conMedicion, enLineaGoes, extra.goes.cargado, climaCargado, clima.ultimaObs, extra.ndvi.datos, extra.ndvi.cargado]);

    const topAlertas = useMemo(() => alertas.filter((a) => a.id !== 'ok' && a.type !== 'info' && !a.antigua).slice(0, 2), [alertas]);

    const veredicto = useMemo((): { estado: EstadoKpi; detalle: string } => {
        if (resumen.criticas > 0) return { estado: { tipo: 'crit', texto: 'Atención' }, detalle: `${resumen.criticas} crítica(s) · ${resumen.avisos} aviso(s)` };
        if (confianza.pct != null && confianza.pct < 80) return { estado: { tipo: 'warn', texto: 'Datos parciales' }, detalle: `Sin datos vigentes: ${confianza.caidas.join(', ')}${resumen.avisos ? ` · ${resumen.avisos} aviso(s)` : ''}` };
        if (resumen.avisos > 0) return { estado: { tipo: 'warn', texto: 'Con avisos' }, detalle: `${resumen.avisos} aviso(s) vigente(s)` };
        return { estado: { tipo: 'ok', texto: 'Operación normal' }, detalle: 'Sin alertas vigentes' };
    }, [resumen, confianza]);

    // Suficiencia: volumen útil (descuenta el muerto), cobertura y posición histórica; por modo (pre-ciclo / temporada).
    const suficiencia = useMemo(() => modeloSuficiencia({
        presas: presas.map((p) => ({ id: p.id, nombre: p.nombre_corto || p.nombre, almacenadoMm3: p.lectura?.almacenamiento_mm3 ?? null, capacidadMm3: p.capacidad_max_mm3, curva: p.curva_capacidad })),
        extraccionM3s: extraccion.valorM3s, hoyISO, indice: extra.historico.indice,
    }), [presas, extraccion.valorM3s, hoyISO, extra.historico.indice]);

    const modeloKpis: ModeloKpis = useMemo(() => ({
        enVivoFuera: !esHoy,
        presas: {
            pct: almacenamiento.porcentaje, estado: estadoPresas(almacenamiento.porcentaje), almacenadoMm3: totalAlmacenamiento, capacidadMm3: almacenamiento.capacidadContabilizadaMm3,
            conDato: almacenamiento.presasConDato, total: almacenamiento.presasTotal,
            serie: serieAlm,
            items: presas.map((p) => { const pct = porcentajeLlenadoPresa(p); return { nombre: (p.nombre_corto || p.nombre).trim().split(/\s+/).slice(-1)[0], pct, capacidadMm3: p.capacidad_max_mm3, alerta: pct != null && pct > PRESA_ALTA_PCT }; }),
            tendencia: tendenciaTexto(serieAlm, 'Mm³', 1, 0),
            frescura: frescuraLectura?.texto ?? null, stale: !!frescuraLectura?.stale,
        },
        suficiencia: { ...suficiencia, historicoCargado: extra.historico.cargado, historicoError: extra.historico.error },
        ciclo: { entregadoPct: avanceDist.pct, acumMm3: avanceDist.acumuladoMm3, autMm3: avanceDist.autorizadoMm3, avance, brecha: brechaCiclo(avanceDist.pct, avance), dias: diasCiclo(hoyISO, cicloAct?.fecha_inicio, cicloAct?.fecha_fin),
            cultivos: { r: resumenCultivosCiclo(extra.cultivos.datos, anioDelCiclo(cicloAct?.fecha_fin)), cargado: extra.cultivos.cargado, error: extra.cultivos.error } },
        canal: { modelo: canal.modelo, cargado: canal.cargado, volumen: volumenCanal, vaciadoDesde },
        demanda: { d24: extra.pronostico.demanda, cargado: extra.pronostico.cargado, error: extra.pronostico.error, medido: { d: demandaRiego(clima.etoProm, clima.lluviaProm), etoMm: clima.etoProm, lluviaMm: clima.lluviaProm, tMax: clima.tempMax, ultimaObs: clima.ultimaObs },
            ahora: { tempProm: clima.tempProm, tempMax: clima.tempMax, tempMin: clima.tempMin, vientoMax: clima.vientoMax, estacionesValidas: clima.estacionesValidas, estacionesTotal: clima.estacionesTotal, excluidas: clima.excluidas },
            horas48: extra.pronostico.horas,
            cicloCerrado: avance.concluido || canal.modelo.vaciado, etoReciente,
            heladaAvisoC: umbralVigente(umbralesClima, 'helada').aviso, vientoAvisoMs: umbralVigente(umbralesClima, 'viento').aviso,
            umbralesVistas: { helada: umbralVigente(umbralesClima, 'helada'), viento: umbralVigente(umbralesClima, 'viento'), rafaga: umbralVigente(umbralesClima, 'rafaga'), lluvia: umbralVigente(umbralesClima, 'lluvia') } },
        modulos: modules.map((m) => {
            const pct = cumplimientoModulo(m.accumulated_vol, m.authorized_vol);
            const e = estadoModulo(pct, avance);
            return { clave: m.id, nombre: m.short_code || (m.name || '').slice(0, 6), pct, letra: e.letra, estado: e.estado, codigo: m.short_code || null, nombreLargo: m.name || null, logo: getLogoVector(m.short_code) };
        }),
        confianza,
        alertas: { resumen, top: topAlertas, onAbrir: abrirDrawer },
        goes: { cargado: extra.goes.cargado, error: extra.goes.error, estaciones: (extra.goes.datos ?? []).map((g) => ({ id: g.id, nombre: g.nombre, clave: g.enlace.clave, edadMin: g.enlace.edadMin, serieGasto: g.serieGasto, ultimoDato: g.ultimoDato, estadia: g.estadia })) },
        ndvi: { cargado: extra.ndvi.cargado, error: extra.ndvi.error, r: extra.ndvi.datos },
        cuenca: { cargado: !cuenca.loading, error: cuenca.error, r: cuencaR },
    }), [cuencaR, cuenca.loading, cuenca.error, hoyISO, cicloAct, extra.goes, extra.ndvi, extra.cultivos, esHoy, almacenamiento, totalAlmacenamiento, serieAlm, frescuraLectura, suficiencia, extra.historico.cargado, extra.historico.error, extra.pronostico.demanda, extra.pronostico.cargado, extra.pronostico.error, avanceDist, avance, canal.modelo, canal.cargado, volumenCanal, vaciadoDesde, etoReciente, umbralesClima, clima, extra.pronostico.horas, modules, confianza, resumen, topAlertas, abrirDrawer]);

    // Estados derivados: una sola vez por cambio del modelo (los comparten la barra de pulso y las tarjetas).
    const derivados = useMemo(() => derivaEstados(modeloKpis), [modeloKpis]);
    const pulso = useMemo(() => estadosTarjetas(modeloKpis, derivados), [modeloKpis, derivados]);

    /** Fotografía de lo que ve el Dashboard en este instante, para el Informe general (mismas cifras, misma fuente). */
    const armarEntradaInforme = (): Omit<EntradaInformeGeneral, 'emitido'> => ({
        m: modeloKpis, alertas, veredicto: veredicto.estado, detalleVeredicto: veredicto.detalle, protocolo,
        fechaCorteISO: fechaSeleccionada || hoyISO, fechaCorteTexto: fechaCorta(fechaSeleccionada || hoyISO),
        clima: { tempMax: clima.tempMax, tempMin: clima.tempMin, vientoMax: clima.vientoMax, estacionesValidas: clima.estacionesValidas, estacionesTotal: clima.estacionesTotal, excluidas: clima.excluidas },
        extraccionM3s: extraccion.valorM3s, erroresPagina: [errorPresas && `Presas: ${errorPresas}`, canal.error && `Canal: ${canal.error}`, errorRegistro && `Alertas guardadas: ${errorRegistro}`, ...fuentesCaidas].filter((x): x is string => !!x),
        ahoraMs: Date.now(), version: typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : undefined,
    });

    if ((loadingModules || loadingPresas || loadingLeaks) && presas.length === 0) {
        return (
            <div className="dashboard-container sc-root flex items-center justify-center min-h-[60vh]" role="status">
                <div className="flex flex-col items-center gap-3" style={{ color: 'var(--sc-t2)' }}>
                    <Loader size={32} className="animate-spin" aria-hidden="true" />
                    <span className="text-sm font-medium">Cargando centro de control…</span>
                </div>
            </div>
        );
    }

    const erroresPagina = [errorPresas && `Presas: ${errorPresas}`, canal.error && `Canal: ${canal.error}`, errorRegistro && `Alertas guardadas: ${errorRegistro}`, ...fuentesCaidas].filter(Boolean);

    return (
        <div className="dashboard-container sc-root sc-fit" style={alturaFold != null ? ({ ['--fold-h' as string]: `${alturaFold}px` } as CSSProperties) : undefined}>
            <div className="dash-fold">
                <BarraCentro pulso={pulso} protocolo={protocolo} version={__V2_APP_VERSION__} veredicto={veredicto.estado} detalleVeredicto={veredicto.detalle} fechaTexto={fechaCorta(fechaSeleccionada)} esHoy={esHoy}
                    erroresPagina={erroresPagina as string[]} onMonitor={() => window.open('/monitor-publico', '_blank')} onImprimir={() => setInformeAbierto(true)} />
                <PanelKpis m={modeloKpis} derivados={derivados} />
            </div>

            {informeAbierto && (
                <Suspense fallback={null}>
                    <InformeGeneralModal onCerrar={() => setInformeAbierto(false)} armarEntrada={armarEntradaInforme} />
                </Suspense>
            )}
            <AlertasDrawer abierto={drawerAbierto} onCerrar={() => setDrawerAbierto(false)} alertas={alertas} resumen={resumen} />
        </div>
    );
};

export default Dashboard;
