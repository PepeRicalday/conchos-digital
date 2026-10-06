import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { isToday, isSameDay, formatDate, getTodayString } from '../utils/dateHelpers';
import { useHydraEngine, type ModuleData } from '../hooks/useHydraEngine';
import { useEficienciaCanal } from '../hooks/useEficienciaCanal';
import { useEscalasCanal } from '../hooks/useEscalasCanal';
import { useAhora, useUltimaCaptura } from '../hooks/useHidrometriaSemana';
import { avanceDistrito, rangoKmModulo, resumenTomas, mensajeMapaVacio, caudalModulo } from '../utils/distribucion';
import { fmtMiles } from '../utils/formato';
import type { ChipEstado } from '../utils/alertasVivas';
import OfflineIndicator from '../components/OfflineIndicator';
import { ModalModulo } from '../components/distribucion/ModalModulo';
import { PaginaHero } from '../components/ui/PaginaHero';
import { BalanceDistrito } from '../components/distribucion/BalanceDistrito';
import { MapaCanal } from '../components/distribucion/MapaCanal';
import { OperacionModulos } from '../components/distribucion/OperacionModulos';
import '../styles/sala-control.css';
import '../components/distribucion/distribucion.css';

interface Seccion { id: string; nombre: string; color: string }

const Canales = () => {
    const [fechaSel, setFechaSel] = useState<Date>(() => new Date());
    const { modules, loading, error, refresh } = useHydraEngine();
    const canal = useEficienciaCanal();
    const { escalas } = useEscalasCanal();
    const ultimaCaptura = useUltimaCaptura();
    const ahora = useAhora(30_000);
    const hoy = useMemo(() => getTodayString(), [ahora]); // eslint-disable-line react-hooks/exhaustive-deps

    const [viendo, setViendo] = useState<ModuleData | null>(null);
    const [puntoSel, setPuntoSel] = useState<string | null>(null);
    const [seccionId, setSeccionId] = useState<string>('all');
    const esHoy = isToday(fechaSel);

    const cambiaDia = (n: number) => { const d = new Date(fechaSel); d.setDate(d.getDate() + n); setFechaSel(d); setPuntoSel(null); };

    // Tomas con su estado en la fecha elegida (abierta = flujo ahora; con movimiento = tuvo flujo ese día).
    const puntos = useMemo(() => modules.flatMap((m) => m.delivery_points.map((p) => {
        const meds = p.mediciones?.filter((x) => isSameDay(x.fecha_hora, fechaSel)) ?? [];
        const ultimo = meds[0];
        const reporte = p.reportes?.[0];
        const hayReporte = esHoy && !!reporte && Number(reporte.caudal_promedio_lps) > 0;
        const qUlt = ultimo?.valor_q != null ? Number(ultimo.valor_q) : 0;
        const qMax = meds.reduce((mx, x) => Math.max(mx, Number(x.valor_q) || 0), 0);
        const isOpen = qUlt > 0 || (hayReporte && qUlt === 0 && qMax === 0);
        const wasActive = !isOpen && (qMax > 0 || hayReporte);
        const flow = isOpen ? (qUlt > 0 ? qUlt : Number(reporte?.caudal_promedio_lps) / 1000) : qMax;
        return { ...p, flow, isOpen, wasActive, isCaptured: meds.length > 0 || hayReporte, moduleName: m.name };
    })), [modules, fechaSel, esHoy]);
    const conActividad = useMemo(() => puntos.filter((p) => p.isOpen || p.wasActive), [puntos]);

    const secciones: Seccion[] = useMemo(() => {
        const mapa = new Map<string, Seccion>();
        for (const p of puntos) if (p.section_data) mapa.set(String(p.section_data.id), p.section_data as Seccion);
        return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
    }, [puntos]);

    const visibles = useMemo(() => seccionId === 'all' ? conActividad : conActividad.filter((p) => p.section_data != null && String(p.section_data.id) === seccionId),
        [conActividad, seccionId]);
    const [kmIni, kmFin] = useMemo<[number, number]>(() => {
        if (seccionId === 'all') return [0, 104];
        const kms = puntos.filter((p) => p.section_data && String(p.section_data.id) === seccionId).map((p) => p.km);
        return kms.length ? [Math.max(0, Math.min(...kms) - 1.5), Math.min(104, Math.max(...kms) + 1.5)] : [0, 104];
    }, [seccionId, puntos]);

    const avance = useMemo(() => avanceDistrito(modules), [modules]);
    const resumen = useMemo(() => resumenTomas(puntos), [puntos]);
    const tramos = useMemo(() => modules.map((m) => ({ id: m.id, nombre: m.short_code || m.name, rango: rangoKmModulo(m), lps: caudalModulo(m).lps })), [modules]);

    const seccional = seccionId !== 'all';
    const hayCaptura = visibles.length > 0;
    // Cifras de HOY: con otra fecha elegida el store no trae histórico, así que se rotulan S/D en vez de mostrar hoy bajo otra fecha.
    const entregaLps = !esHoy ? null : seccional ? (hayCaptura ? visibles.reduce((a, p) => a + p.flow * 1000, 0) : null)
        : modules.length ? modules.reduce((a, m) => a + m.current_flow * 1000, 0) : null;
    const volumenDia = !esHoy ? null : seccional ? (hayCaptura ? visibles.reduce((a, p) => a + (p.daily_vol || 0), 0) : null)
        : modules.length ? modules.reduce((a, m) => a + m.daily_vol, 0) : null;
    const acumulado = seccional && esHoy && hayCaptura ? visibles.reduce((a, p) => a + (p.accumulated || 0), 0) : null;

    const chips: ChipEstado[] = useMemo(() => {
        const c: ChipEstado[] = [];
        if (error) c.push({ key: 'err', sev: 'crit', texto: `Datos posiblemente desactualizados: ${error}` });
        if (!esHoy) c.push({ key: 'fecha', sev: 'info', texto: 'Fecha distinta de hoy: las cifras del distrito solo existen para hoy (S/D)' });
        if (esHoy && ultimaCaptura && ultimaCaptura < hoy) c.push({ key: 'cap', sev: 'warn', texto: `El gasto de módulos viene de la captura del ${ultimaCaptura.split('-').reverse().join('/')}, no de hoy` });
        if (!canal.k0Fresca || !canal.k104Fresca) c.push({ key: 'ext', sev: 'warn', texto: 'Extremo K-0 o K-104 sin lectura vigente: eficiencia en S/D' });
        c.push({ key: 'tomas', sev: resumen.conCaptura > 0 ? 'ok' : 'info', texto: `${resumen.conCaptura} de ${resumen.total} tomas con captura ${esHoy ? 'hoy' : 'en la fecha'}` });
        return c;
    }, [error, esHoy, ultimaCaptura, hoy, canal.k0Fresca, canal.k104Fresca, resumen]);

    if (loading && modules.length === 0) return <div className="sc-root sc-pagina" role="status"><p className="sc-vacio">Cargando centro de control…</p></div>;
    if (error && modules.length === 0) return <div className="sc-root sc-pagina"><p className="sc-aviso sc-aviso-crit" role="alert">Error de conexión: {error}</p></div>;

    const activo = visibles.find((p) => p.id === puntoSel);
    const titulo = seccional ? `Tramo: ${secciones.find((s) => s.id === seccionId)?.nombre ?? ''}` : 'Red completa del distrito';

    return (
        <div className="sc-root sc-pagina">
            <OfflineIndicator />
            <PaginaHero
                kicker="Operación · Unidad de manejo"
                titulo="Distribución"
                subtitulo="Centro de control operativo del Distrito de Riego 005 Delicias"
                chips={chips}
                acciones={<>
                    <div className="sc-barra-nav" role="group" aria-label="Fecha de consulta">
                        <button type="button" className="sc-btn" onClick={() => cambiaDia(-1)} aria-label="Día anterior"><ChevronLeft size={18} aria-hidden="true" /></button>
                        <div className="sc-rango"><small>Fecha</small>{formatDate(fechaSel, { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</div>
                        <button type="button" className="sc-btn" onClick={() => cambiaDia(1)} disabled={esHoy} aria-label="Día siguiente"><ChevronRight size={18} aria-hidden="true" /></button>
                    </div>
                    {!esHoy && <button type="button" className="sc-btn" onClick={() => setFechaSel(new Date())}>Hoy</button>}
                    <button type="button" className="sc-btn" onClick={() => { void refresh(); canal.recargar(); }} aria-label="Actualizar datos"><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>
                </>}
            />

            {secciones.length > 0 && (
                <div className="dc-tabs" role="tablist" aria-label="Zona del canal">
                    <button type="button" role="tab" id="tab-all" aria-selected={!seccional} className="dc-tab" onClick={() => setSeccionId('all')}>Vista general</button>
                    {secciones.map((s) => (
                        <button key={s.id} type="button" role="tab" id={`tab-${s.id}`} aria-selected={seccionId === String(s.id)} className="dc-tab"
                            style={{ '--c': s.color } as React.CSSProperties} onClick={() => { setSeccionId(String(s.id)); setPuntoSel(null); }}>
                            <i aria-hidden="true" />{s.nombre}
                        </button>
                    ))}
                </div>
            )}

            <BalanceDistrito seccional={seccional} entregaLps={entregaLps} volumenDiaMm3={volumenDia} acumuladoMm3={acumulado} avance={avance}
                ultimaCaptura={ultimaCaptura} hoy={hoy} esHoy={esHoy} canal={canal} />

            <div style={{ position: 'relative' }}>
                <MapaCanal kmIni={kmIni} kmFin={kmFin} escalas={escalas} modulos={tramos} titulo={titulo} ahoraMs={ahora}
                    puntos={visibles} activoId={puntoSel} onPunto={(id) => setPuntoSel((p) => (p === id ? null : id))} mensajeVacio={mensajeMapaVacio(resumen, esHoy)} />
                {activo && (
                    <div className="sc-card" role="status" style={{ position: 'absolute', right: 16, bottom: 16, width: 'min(320px, calc(100% - 32px))', background: '#07121f' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <div><span className="sc-kicker">{activo.type} · km {activo.km}</span><b style={{ fontSize: 17 }}>{activo.name}</b><div className="sc-fresco">{activo.moduleName}</div></div>
                            <button type="button" className="sc-btn" onClick={() => setPuntoSel(null)} aria-label="Cerrar detalle de la toma"><X size={16} aria-hidden="true" /></button>
                        </div>
                        <p className="sc-lineas">Gasto <b>{fmtMiles(activo.flow * 1000, 0)} L/s</b> · volumen del día <b>{(activo.daily_vol ?? 0).toFixed(4)} Mm³</b></p>
                    </div>
                )}
            </div>

            <OperacionModulos modulos={modules} sdGlobal={!esHoy} onAbrir={(id) => setViendo(modules.find((m) => m.id === id) ?? null)} />

            {viendo && <ModalModulo modulo={viendo} onCerrar={() => setViendo(null)} />}
        </div>
    );
};

export default Canales;
