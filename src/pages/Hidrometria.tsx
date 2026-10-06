import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Loader, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useHydraEngine } from '../hooks/useHydraEngine';
import { useEficienciaCanal } from '../hooks/useEficienciaCanal';
import { useHidrometriaSemana, useAhora } from '../hooks/useHidrometriaSemana';
import { getStartOfWeek, getEndOfWeek, getTodayString } from '../utils/dateHelpers';
import { fmtEdadMin } from '../utils/formato';
import { estadoPorCobertura } from '../utils/balanceModulo';
import { cumplimientoModulo } from '../utils/dashboardKpis';
import { relacionEntregaEntrada } from '../utils/eficienciaCanal';
import type { ChipEstado } from '../utils/alertasVivas';
import {
    construyeFilasSemana, ordenaPorDesviacion, resumenSemana, solicitudesAEscribir, mm3ACaudalMedio, sumaDias,
} from '../utils/hidrometria';
import { PaginaHero } from '../components/ui/PaginaHero';
import { KpisHidrometria } from '../components/hidrometria/KpisHidrometria';
import { GraficaProgramado } from '../components/hidrometria/GraficaProgramado';
import { TablaCumplimiento, type FilaConCiclo } from '../components/hidrometria/TablaCumplimiento';
import { ModalSolicitudes } from '../components/hidrometria/ModalSolicitudes';
import '../styles/sala-control.css';

const dm = (s: string) => s.split('-').slice(1).reverse().join('/');

const Hidrometria = () => {
    const { modules, loading: storeLoading } = useHydraEngine();
    const canal = useEficienciaCanal();
    const ahora = useAhora();
    const hoy = useMemo(() => getTodayString(), [ahora]); // eslint-disable-line react-hooks/exhaustive-deps

    const [fechaSel, setFechaSel] = useState(() => new Date());
    const inicio = useMemo(() => getStartOfWeek(fechaSel), [fechaSel]);
    const fin = useMemo(() => getEndOfWeek(fechaSel), [fechaSel]);
    const datos = useHidrometriaSemana(inicio, fin);
    const esSemanaActual = hoy >= inicio && hoy <= fin;

    const [modalAbierto, setModalAbierto] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

    // ── Derivados (una sola vez; antes la fórmula se repetía en la gráfica y en la tabla) ──
    const filas = useMemo(() => construyeFilasSemana({
        modulos: modules.map((m) => ({ id: m.id, short_code: m.short_code, name: m.name, daily_vol: m.daily_vol, current_flow: m.current_flow, target_flow: m.target_flow })),
        solicitudes: datos.solicitudes, entregas: datos.entregas, inicio, fin, hoy,
    }), [modules, datos.solicitudes, datos.entregas, inicio, fin, hoy]);
    const filasTabla: FilaConCiclo[] = useMemo(() => {
        const ciclo = new Map(modules.map((m) => [m.id, cumplimientoModulo(m.accumulated_vol, m.authorized_vol)]));
        return ordenaPorDesviacion(filas).map((f) => ({ ...f, avanceCicloPct: ciclo.get(f.moduloId) ?? null }));
    }, [filas, modules]);
    const resumen = useMemo(() => resumenSemana(filas, inicio, fin, hoy), [filas, inicio, fin, hoy]);
    const entregaM3s = modules.length ? modules.reduce((a, m) => a + (m.current_flow || 0), 0) : null;

    const etiquetaCumpl = useMemo(() => {
        if (resumen.cumplimientoPct == null) return { texto: resumen.modulosConSolicitud === 0 ? 'Sin solicitud' : 'Sin captura', tipo: 'sd' as const };
        const s = estadoPorCobertura(resumen.cumplimientoPct);
        return s === 'DEFICIT' ? { texto: 'Bajo el programa', tipo: 'crit' as const } : s === 'SUPERAVIT' ? { texto: 'Sobre el programa', tipo: 'warn' as const } : { texto: 'Cumple', tipo: 'ok' as const };
    }, [resumen]);

    const chips: ChipEstado[] = useMemo(() => {
        const c: ChipEstado[] = [];
        if (datos.error) c.push({ key: 'err', sev: 'crit', texto: `No se pudo leer la semana: ${datos.error}` });
        if (!canal.k0Fresca) c.push({ key: 'k0', sev: 'warn', texto: 'K-0 sin lectura vigente (> 4 h): entrada y eficiencia en S/D' });
        if (datos.ultimaCaptura && datos.ultimaCaptura < hoy) c.push({ key: 'cap', sev: 'warn', texto: `El gasto de módulos viene de la captura del ${datos.ultimaCaptura.split('-').reverse().join('/')}, no de hoy` });
        const rel = relacionEntregaEntrada(entregaM3s, canal.qEntrada);
        if (rel.estado === 'inconsistente') c.push({ key: 'rel', sev: 'warn', texto: 'La entrega a módulos supera a la entrada K-0: no se calcula como eficiencia' });
        if (!datos.cargando && resumen.modulosConSolicitud === 0) c.push({ key: 'sol', sev: 'info', texto: 'Sin solicitudes capturadas para esta semana' });
        if (c.length === 0) c.push({ key: 'ok', sev: 'ok', texto: 'Fuentes al día' });
        if (datos.actualizadoEn) c.push({ key: 'act', sev: 'ok', texto: `Actualizado ${fmtEdadMin(Math.max(0, (ahora - datos.actualizadoEn) / 60000))}` });
        return c;
    }, [datos.error, datos.ultimaCaptura, datos.cargando, datos.actualizadoEn, canal.k0Fresca, canal.qEntrada, entregaM3s, resumen.modulosConSolicitud, hoy, ahora]);

    const iniciales = useMemo(() => Object.fromEntries(datos.solicitudes
        .map((s) => [s.modulo_id, mm3ACaudalMedio(Number(s.volumen_solicitado_mm3))] as const)
        .filter(([, q]) => q != null).map(([id, q]) => [id, (q as number).toFixed(3)])), [datos.solicitudes]);

    const guardar = async (valores: Record<string, string>) => {
        const aEscribir = solicitudesAEscribir(valores, inicio, fin);
        if (aEscribir.length === 0) { setModalAbierto(false); return; }
        setGuardando(true); setErrorGuardar(null);
        const { error } = await supabase.from('solicitudes_riego_semanal').upsert(aEscribir, { onConflict: 'modulo_id, fecha_inicio' });
        if (error) setErrorGuardar(error.message);
        else { await datos.recargar(); setModalAbierto(false); }
        setGuardando(false);
    };
    const irSemana = (n: number) => setFechaSel(new Date(`${sumaDias(inicio, 7 * n + 3)}T12:00:00`));

    if (storeLoading && modules.length === 0) {
        return (
            <div className="sc-root sc-pagina" role="status" style={{ minHeight: '60vh', alignItems: 'center', justifyContent: 'center' }}>
                <Loader size={32} className="animate-spin" aria-hidden="true" /> <span>Sincronizando red mayor…</span>
            </div>
        );
    }

    return (
        <div className="sc-root sc-pagina">
            <PaginaHero
                kicker="Operación · Red mayor"
                titulo="Hidrometría y eficiencia"
                subtitulo="Monitoreo técnico y auditoría de distribución: lo que entra, lo que se entrega y lo programado"
                chips={chips}
                acciones={<>
                    <div className="sc-barra-nav" role="group" aria-label="Semana de riego">
                        <button type="button" className="sc-btn" onClick={() => irSemana(-1)} aria-label="Semana anterior"><ArrowLeft size={18} aria-hidden="true" /></button>
                        <div className="sc-rango"><small>Semana de riego</small>{dm(inicio)} — {dm(fin)}</div>
                        <button type="button" className="sc-btn" onClick={() => irSemana(1)} aria-label="Semana siguiente"><ArrowRight size={18} aria-hidden="true" /></button>
                    </div>
                    {!esSemanaActual && <button type="button" className="sc-btn" onClick={() => setFechaSel(new Date())}>Semana actual</button>}
                    <button type="button" className="sc-btn" onClick={() => { void datos.recargar(); canal.recargar(); }} aria-label="Actualizar datos"><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>
                    <button type="button" className="sc-btn sc-btn-primario" onClick={() => { setErrorGuardar(null); setModalAbierto(true); }}><CalendarCheck size={16} aria-hidden="true" /> Solicitudes semanales</button>
                </>}
            />

            <KpisHidrometria canal={canal} ahoraMs={ahora} entregaM3s={entregaM3s} ultimaCaptura={datos.ultimaCaptura} hoy={hoy} resumen={resumen} cumplimientoEtiqueta={etiquetaCumpl} />

            <GraficaProgramado filas={filas} rango={`Semana ${inicio} al ${fin}`} />
            <TablaCumplimiento filas={filasTabla} />

            {modalAbierto && (
                <ModalSolicitudes
                    key={inicio}
                    modulos={modules.map((m) => ({ id: m.id, nombre: m.short_code || m.name, detalle: m.name }))}
                    inicio={inicio} fin={fin} iniciales={iniciales} guardando={guardando} error={errorGuardar}
                    onGuardar={(v) => { void guardar(v); }} onCerrar={() => setModalAbierto(false)}
                />
            )}
        </div>
    );
};

export default Hidrometria;
