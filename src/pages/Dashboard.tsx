import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader } from 'lucide-react';
import { useHydraEngine } from '../hooks/useHydraEngine';
import { usePresas } from '../hooks/usePresas';
import { useLeakMonitor } from '../hooks/useLeakMonitor';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { usePredictiveBalance } from '../hooks/usePredictiveBalance';
import { useAlertasRegistro } from '../hooks/useAlertasSistema';
import { useCanalExtremos, useClimaPulso } from '../hooks/useDashboardPulso';
import { useFecha } from '../context/FechaContext';
import { supabase } from '../lib/supabase';
import { getTodayString } from '../utils/dateHelpers';
import { agregarAlmacenamiento, calcularFrescura } from '../utils/presaMetrics';
import {
    extraccionTotalMedida, serieExtraccion, datosAlmacenamientoPresas, cumplimientoModulo,
    fusionaAlertas, resumenAlertas, type AlertaSistema,
} from '../utils/dashboardKpis';
import { construyeAlertasVivas, construyeChips, diasDesde } from '../utils/alertasVivas';
import AlertList from '../components/AlertList';
import { HeroCentro } from '../components/dashboard/HeroCentro';
import { PulsoSistema } from '../components/dashboard/PulsoSistema';
import { FuentesPresas } from '../components/dashboard/FuentesPresas';
import { TendenciasPresas } from '../components/dashboard/TendenciasPresas';
import { CumplimientoModulos, type FilaModulo } from '../components/dashboard/CumplimientoModulos';
import { PieSistema } from '../components/dashboard/PieSistema';
import type { AppVersionRow, VwAlertaTomaVaradaRow } from '../types/sica.types';
import './Dashboard.css';
import '../styles/sala-control.css';
import '../components/dashboard/DashboardTema.css';

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

const Dashboard = () => {
    const navigate = useNavigate();
    const { fechaSeleccionada, esHoy } = useFecha();
    const { activeEvent } = useHydricEvents();
    const { modules, loading: loadingModules } = useHydraEngine();
    const { presas, totalAlmacenamiento, almacenamiento, frescuraLectura, loading: loadingPresas, error: errorPresas } = usePresas(fechaSeleccionada);
    const { segments, loading: loadingLeaks } = useLeakMonitor();
    const { alertas: predictivas } = usePredictiveBalance();
    const { alertas: alertasRegistro, error: errorRegistro } = useAlertasRegistro();
    const canal = useCanalExtremos();
    const { pulso: clima, cargado: climaCargado } = useClimaPulso();

    // ── Consultas propias del Dashboard (columnas explícitas; historial de 7 días de lecturas_presas) ──
    const [versiones, setVersiones] = useState<AppVersionRow[]>([]);
    const [tomasVaradas, setTomasVaradas] = useState<VwAlertaTomaVaradaRow[]>([]);
    const [extraccionFilas, setExtraccionFilas] = useState<{ fecha: string; extraccion_total_m3s: number | null }[]>([]);
    const [fuentesCaidas, setFuentesCaidas] = useState<string[]>([]);

    useEffect(() => {
        let cancelado = false;
        void (async () => {
            const hasta = fechaSeleccionada || getTodayString();
            const desde = new Date(`${hasta}T00:00:00Z`); desde.setUTCDate(desde.getUTCDate() - 6);
            const [v, t, h] = await Promise.allSettled([
                supabase.from('app_versions').select('id, app_id, version'),
                supabase.from('vw_alertas_tomas_varadas').select('*'),
                supabase.from('lecturas_presas').select('fecha, extraccion_total_m3s').gte('fecha', desde.toISOString().slice(0, 10)).lte('fecha', hasta).order('fecha', { ascending: true }),
            ]);
            if (cancelado) return;
            const caidas: string[] = [];
            const ok = (r: PromiseSettledResult<{ data: unknown; error: unknown }>, nombre: string): unknown => {
                if (r.status === 'fulfilled' && !r.value.error) return r.value.data;
                console.error(`[Dashboard] Error cargando ${nombre}`, r.status === 'rejected' ? r.reason : r.value.error);
                caidas.push(nombre);
                return null;
            };
            setVersiones((ok(v, 'Versiones') ?? []) as AppVersionRow[]);
            setTomasVaradas((ok(t, 'Tomas varadas') ?? []) as VwAlertaTomaVaradaRow[]);
            setExtraccionFilas((ok(h, 'Historial de extracción') ?? []) as { fecha: string; extraccion_total_m3s: number | null }[]);
            setFuentesCaidas(caidas);
        })();
        return () => { cancelado = true; };
    }, [fechaSeleccionada]);

    // Dos relojes: 30 s solo para interpolar la entrega; 5 min para vigencia de alertas y días de protocolo.
    const ahoraEntrega = useReloj(30_000, esHoy);
    const ahoraAlertas = useReloj(5 * 60_000, true);

    // ── Derivados ──
    const extraccion = useMemo(() => extraccionTotalMedida(presas), [presas]);
    const serieExt = useMemo(() => serieExtraccion(extraccionFilas, fechaSeleccionada || getTodayString(), 7), [extraccionFilas, fechaSeleccionada]);
    const datosPresas = useMemo(() => datosAlmacenamientoPresas(presas), [presas]);
    const agregado = useMemo(() => agregarAlmacenamiento(presas), [presas]);

    // Volumen entregado hoy: suma por punto + interpolación acotada a 30 min; null (S/D) si ningún módulo reporta.
    const entregaMm3 = useMemo(() => {
        const total = modules.reduce((acc, m) => {
            const puntos = m.delivery_points.reduce((a, pt) => {
                const seg = pt.last_update_time ? Math.max(0, (ahoraEntrega - new Date(pt.last_update_time).getTime()) / 1000) : 0;
                const interp = esHoy && pt.current_q > 0 ? (pt.current_q * Math.min(seg, 1800)) / 1_000_000 : 0;
                return a + (pt.daily_vol || 0) + interp;
            }, 0);
            return acc + (puntos > 0 ? puntos : (m.daily_vol || 0));
        }, 0);
        return total > 0.0001 ? total : null;
    }, [modules, ahoraEntrega, esHoy]);

    const filasModulos: FilaModulo[] = useMemo(() => modules
        .map((m) => ({ clave: m.id, nombre: m.short_code || (m.name || '').slice(0, 10), pct: cumplimientoModulo(m.accumulated_vol, m.authorized_vol), volumenMm3: m.accumulated_vol ?? 0 }))
        .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)), [modules]);

    // Alertas: calculadas en vivo + persistidas, una sola cifra para KPI, lista y menú.
    const vivas: AlertaSistema[] = useMemo(() => construyeAlertasVivas({
        tomasVaradas: tomasVaradas as never,
        tramos: segments,
        modulos: modules.map((m) => ({ id: m.id, name: m.name, current_flow: m.current_flow, target_flow: m.target_flow })),
        presas,
        protocolo: activeEvent ? { id: activeEvent.id, evento_tipo: activeEvent.evento_tipo, fecha_inicio: activeEvent.fecha_inicio } : null,
        predictivas: predictivas as AlertaSistema[],
        ahoraMs: ahoraAlertas,
    }), [tomasVaradas, segments, modules, presas, activeEvent, predictivas, ahoraAlertas]);
    const alertas = useMemo(() => fusionaAlertas(vivas, alertasRegistro), [vivas, alertasRegistro]);
    const resumen = useMemo(() => resumenAlertas(alertas), [alertas]);

    const chips = useMemo(() => construyeChips({
        protocolo: activeEvent ? { id: activeEvent.id, evento_tipo: activeEvent.evento_tipo, gasto_solicitado_m3s: activeEvent.gasto_solicitado_m3s } : null,
        diasProtocolo: diasDesde(activeEvent?.fecha_inicio, ahoraAlertas),
        almacenamiento: agregado,
        fuentesCaidas,
        frescuraPresas: presas.map((p) => { const f = calcularFrescura(p.lectura?.fecha); return { nombre: p.nombre_corto || p.nombre, texto: f?.texto ?? null, stale: !!f?.stale }; }),
    }), [activeEvent, ahoraAlertas, agregado, fuentesCaidas, presas]);

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

    const corte = new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Chihuahua' });
    const erroresPagina = [errorPresas && `Presas: ${errorPresas}`, canal.error && `Canal: ${canal.error}`, errorRegistro && `Alertas guardadas: ${errorRegistro}`].filter(Boolean);

    return (
        <div className="dashboard-container sc-root">
            <div className="print-only dash-print-header">
                <img src="/logos/logo-srl.png" alt="SRL Unidad Conchos" style={{ height: '64px', width: 'auto', objectFit: 'contain' }} />
                <div><h3>Sociedad de Asociaciones de Usuarios</h3><h1>Unidad Conchos</h1><h4>S. de R.L. de I.P. y C.V.</h4></div>
            </div>

            <HeroCentro fechaTexto={fechaCorta(fechaSeleccionada)} esHoy={esHoy} chips={chips}
                onMonitor={() => window.open('/monitor-publico', '_blank')} onImprimir={() => window.print()} />

            {erroresPagina.length > 0 && (
                <p className="sc-chip sc-chip-crit" role="alert">No se pudo leer: {erroresPagina.join(' · ')}. Las cifras de esas secciones pueden estar incompletas.</p>
            )}

            <PulsoSistema
                presas={{
                    pct: almacenamiento.porcentaje, almacenadoMm3: totalAlmacenamiento, capacidadMm3: almacenamiento.capacidadContabilizadaMm3,
                    conDato: almacenamiento.presasConDato, total: almacenamiento.presasTotal, extraccion,
                    frescuraTexto: frescuraLectura?.texto ?? null, stale: !!frescuraLectura?.stale,
                }}
                canal={{
                    conduccion: canal.conduccion, // Un extremo sin lectura vigente (≤ 4 h) se muestra S/D, no su último valor (mismo criterio que Geo-Monitor y Monitor Público).
                    qEntrada: canal.k0?.fresca ? canal.k0.gasto : null, qSalida: canal.k104?.fresca ? canal.k104.gasto : null,
                    k0Fresca: !!canal.k0?.fresca, k104Fresca: !!canal.k104?.fresca, cargado: canal.cargado,
                    entregaMilM3: entregaMm3 != null ? entregaMm3 * 1000 : null,
                }}
                clima={{ ...clima, cargado: climaCargado }}
                alertas={resumen}
            />

            <div className="sc-grid-principal">
                <div className="sc-col">
                    <FuentesPresas presas={presas} />
                    <TendenciasPresas presas={datosPresas} serie={serieExt} esHoy={esHoy} />
                </div>
                <div className="sc-col">
                    <div className="sc-alertas"><AlertList alerts={alertas} /></div>
                    <CumplimientoModulos filas={filasModulos} cargando={loadingModules} onBalance={() => navigate('/balance')} />
                </div>
            </div>

            <PieSistema versiones={versiones} corte={corte} appVersion={__V2_APP_VERSION__} buildHash={__V2_BUILD_HASH__} />
        </div>
    );
};

export default Dashboard;
