import { memo } from 'react';
import { Waves, Hourglass, CalendarClock, LayoutGrid, ShieldCheck, ShieldAlert, TriangleAlert, OctagonAlert } from 'lucide-react';
import { IconoMedicion, IconoTelemetria, IconoUsoAgricola } from '../marca/IconoSica';
import { KpiTile } from './KpiTile';
import { Sparkline } from '../ui/Sparkline';
import { BarraSegmentada } from '../ui/BarraSegmentada';
import { BarraSeveridad } from '../ui/BarraSeveridad';
import { MedidorSemicircular } from '../ui/MedidorSemicircular';
import { ColumnasEmbalse, type ColumnaEmbalse } from '../ui/ColumnasEmbalse';
import { PerfilCanalMini } from '../ui/PerfilCanalMini';
import { BandaCiclos } from '../ui/BandaCiclos';
import { BarraUtil } from '../ui/BarraUtil';
import { FilaEstaciones, type EstacionFila } from '../ui/FilaEstaciones';
import { AnilloSegmentado } from '../ui/AnilloSegmentado';
import { MapaCalorModulos, type CeldaModulo } from '../ui/MapaCalorModulos';
import {
    estadoGoes, estadoNdvi,
    type EstadoKpi, type DiasCiclo, type BrechaCiclo, type AvanceCiclo, type DemandaRiego, type Confianza, type TendenciaTexto,
} from '../../utils/dashboardKpisEjecutivos';
import { textoEdad } from '../../utils/hidroEstaciones';
import type { ResumenAlertas, AlertaSistema } from '../../utils/dashboardKpis';
import { estadoDemanda24h, type ResumenNdvi, type DemandaRiego24h, type PuntoHora } from '../../utils/dashboardExtra';
import type { ModeloSuficiencia } from '../../utils/suficiencia';
import { etiquetaEficiencia } from '../../utils/conduccion';
import type { CanalKpiModelo } from '../../utils/perfilCanal';
import type { VolumenCanal, EtoReciente } from '../../hooks/useDashboardPulso';
import { resumenVariables24h, VISTAS_CLIMA, severidadVista, type UmbralesVistas } from '../../utils/climaVistas';
import { TarjetaClimaHero } from './TarjetaClimaHero';
import { CultivosCicloMini, ENLACE_CULTIVOS_CICLO } from './CultivosCicloMini';
import type { ResumenCultivosCiclo } from '../../utils/cultivosCiclo';
import { useRol } from '../../lib/auth/roles';
import type { CuencaCompacta } from '../../utils/aqwpCuenca';

const f = (v: number | null | undefined, d = 1) => (v == null ? null : v.toFixed(d));
const edadMin = (ms: number | null) => (ms == null ? null : Math.max(0, (Date.now() - ms) / 60000));
/** Días completos transcurridos desde un instante ISO; null sin fecha. */
const diasDesde = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : null;
};
/** Variación porcentual de la ETo prevista frente a la medida de los últimos días (null sin ambas). */
export function etoVsReciente(eto24: number | null | undefined, promMmDia: number | null | undefined): number | null {
    return eto24 != null && promMmDia != null && promMmDia > 0.2 ? ((eto24 / promMmDia) - 1) * 100 : null;
}


export interface ModeloKpis {
    enVivoFuera: boolean;
    presas: { pct: number | null; estado: EstadoKpi; almacenadoMm3: number | null; capacidadMm3: number; conDato: number; total: number; serie: (number | null)[]; items: ColumnaEmbalse[]; tendencia: TendenciaTexto; frescura: string | null; stale: boolean };
    suficiencia: ModeloSuficiencia & { historicoCargado: boolean; historicoError: string | null };
    ciclo: { entregadoPct: number | null; acumMm3: number | null; autMm3: number | null; avance: AvanceCiclo; brecha: BrechaCiclo; dias?: DiasCiclo | null; cultivos?: { r: ResumenCultivosCiclo; cargado: boolean; error: string | null } };
    canal: { modelo: CanalKpiModelo; cargado: boolean; volumen?: VolumenCanal; vaciadoDesde?: string | null };
    demanda: {
        d24: DemandaRiego24h | null; cargado: boolean; error: string | null;
        medido: { d: DemandaRiego; etoMm: number | null; lluviaMm: number | null; tMax: number | null; ultimaObs: string | null };
        /** Ciclo de riego concluido o canal en vaciado: la cifra es ETo de REFERENCIA, no demanda de cultivo. */
        cicloCerrado?: boolean;
        etoReciente?: EtoReciente;
        heladaAvisoC?: number;
        vientoAvisoMs?: number;
        /** Umbrales de aviso/crítico (helada, viento, ráfaga, lluvia) para las vistas por variable. */
        umbralesVistas?: UmbralesVistas;
        /** Observación actual de la red de estaciones (para la tarjeta Clima). */
        ahora?: { tempProm: number | null; tempMax: number | null; tempMin: number | null; vientoMax: number | null; estacionesValidas: number; estacionesTotal: number; excluidas: string[] };
        /** Serie horaria de 48 h (promedio entre estaciones) para Hoy / Mañana. */
        horas48?: PuntoHora[];
    };
    modulos: CeldaModulo[];
    confianza: Confianza;
    alertas: { resumen: ResumenAlertas; top: AlertaSistema[]; onAbrir: () => void };
    goes: { cargado: boolean; error: string | null; estaciones: EstacionFila[] };
    ndvi: { cargado: boolean; error: string | null; r: ResumenNdvi | null };
    /** Contexto de cuenca (portal USIBWC/AQUARIUS): una línea dentro de la tarjeta Presas. Opcional: solo contexto, nunca bloquea el tablero. */
    cuenca?: { cargado: boolean; error: string | null; r: CuencaCompacta | null };
}

/** Línea "Cuenca: X Mm³ · Y % · lluvia 7 d Z mm" de la tarjeta Presas. S/D explícito; sin datos no se afirma nada. */
function LineaCuenca({ c }: { c: NonNullable<ModeloKpis['cuenca']> }) {
    if (!c.cargado) return null;
    const r = c.r;
    if (!r) return <span className="kp-cuenca-l">Cuenca del Conchos: sin lectura</span>;
    const parcial = r.conDato < r.total ? ` (${r.conDato}/${r.total} presas)` : '';
    return (
        <span className="kp-cuenca-l">
            Cuenca: <b>{r.almacenadoMm3 != null ? `${r.almacenadoMm3.toFixed(0)} Mm³` : 'S/D'}</b>{r.pct != null ? ` · ${r.pct.toFixed(0)} %` : ''}{parcial}
            <span className="kp-sep"> · </span><span className="kp-nw">lluvia 7 d <b>{r.lluvia.promedio7Mm != null ? `${r.lluvia.promedio7Mm.toFixed(1)} mm` : 'S/D'}</b></span>
            {r.sinActualizar > 0 ? <span className="kp-nw"> · {r.sinActualizar} sin actualizar</span> : null}
            {r.frescura?.stale ? <span className="kp-viejo"> · dato atrasado</span> : null}
        </span>
    );
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesTexto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const NDVI_MAX = 0.8;
const LEYENDA_MOD: Record<string, string> = { C: 'concluido', R: 'en ritmo', A: 'adelantado', T: 'atrasado', S: 'sobregiro', '—': 'sin dato' };

/** Estados derivados de cada tarjeta: los comparten las tarjetas y la barra de pulso global. */
export function derivaEstados(m: ModeloKpis) {
    const { canal, alertas, goes, ndvi } = m;
    const cm = canal.modelo;
    const c = cm.conduccion;
    const etiqueta = etiquetaEficiencia(c.eficienciaPct);
    const canalE: EstadoKpi = c.eficienciaPct != null
        ? { tipo: etiqueta === 'Óptima' ? 'ok' : etiqueta === 'Aceptable' ? 'warn' : 'crit', texto: etiqueta }
        : !canal.cargado ? { tipo: 'sd', texto: 'Consultando' }
        : cm.total === 0 ? { tipo: 'sd', texto: 'Sin escalas' }
        : cm.conMedicion === 0 ? { tipo: 'sd', texto: 'Sin vigentes' }
        : (cm.fueraDeRango ?? 0) > 0 ? { tipo: 'warn', texto: `${cm.fueraDeRango} fuera de rango`, corto: `${cm.fueraDeRango} fuera` }
        : cm.vaciado ? { tipo: 'info', texto: diasDesde(canal.vaciadoDesde) != null ? `Vaciado · ${diasDesde(canal.vaciadoDesde)} d` : 'Vaciado' }
        : cm.conMedicion < cm.total ? { tipo: 'info', texto: 'Parcial' } : { tipo: 'ok', texto: 'En rango' };
    const crit = alertas.resumen.criticas, avi = alertas.resumen.avisos;
    const alertasE: EstadoKpi = crit > 0 ? { tipo: 'crit', texto: `${crit} crítica${crit === 1 ? '' : 's'}` } : avi > 0 ? { tipo: 'warn', texto: 'Con avisos' } : { tipo: 'ok', texto: 'Sin alertas' };
    const enLinea = goes.estaciones.filter((g) => g.clave === 'en_linea' || g.clave === 'retraso').length;
    const goesE: EstadoKpi = goes.error ? { tipo: 'sd', texto: 'Sin lectura' } : !goes.cargado ? { tipo: 'sd', texto: 'Consultando' } : estadoGoes(enLinea, goes.estaciones.length);
    const nd = ndvi.r && ndvi.r.mes ? ndvi.r : null;
    const ndviE: EstadoKpi = ndvi.error ? { tipo: 'sd', texto: 'Sin lectura' } : !ndvi.cargado ? { tipo: 'sd', texto: 'Consultando' } : estadoNdvi(nd?.anomalia);
    const modulosE: EstadoKpi = m.ciclo.brecha.estado.tipo === 'sd' ? { tipo: 'sd', texto: 'S/D' } : m.ciclo.avance.concluido ? { tipo: 'info', texto: 'Ciclo concluido' } : { tipo: 'ok', texto: 'Por módulo' };
    const d24 = m.demanda.d24;
    const usa24 = !!d24 && d24.netaMm != null && !d24.viejo;
    const cerrado = !!m.demanda.cicloCerrado;
    const vs7 = usa24 ? etoVsReciente(d24!.eto24Mm, m.demanda.etoReciente?.promMmDia) : null;
    // Ciclo cerrado: no hay demanda de cultivo que calificar; el chip compara la ETo prevista con la MEDIDA la semana pasada.
    const demandaE: EstadoKpi = cerrado && usa24
        ? { tipo: 'info', texto: vs7 != null ? `${vs7 >= 0 ? '+' : '−'}${Math.abs(vs7).toFixed(0)} % vs 7 d` : 'Referencia' }
        : usa24 ? estadoDemanda24h(d24)
        : d24?.viejo ? estadoDemanda24h(d24)
        : !m.demanda.cargado && m.demanda.medido.d.netaMm == null ? { tipo: 'sd', texto: 'Consultando' } : m.demanda.medido.d.estado;
    return { canalE, alertasE, goesE, ndviE, modulosE, enLinea, nd, demandaE, usa24, cerrado, vs7 };
}

/** Para la barra de pulso: si alguna vista del pronóstico (helada, viento, lluvia) está en aviso o crítico, manda sobre la ETₒ. */
function tipoClimaPulso(m: ModeloKpis, base: EstadoKpi['tipo']): EstadoKpi['tipo'] {
    const d = m.demanda.d24;
    if (!d || d.viejo) return base;
    const r = resumenVariables24h(d, m.demanda.umbralesVistas);
    const sev = VISTAS_CLIMA.map((v) => severidadVista(r, v));
    return sev.includes('crit') ? 'crit' : sev.includes('warn') ? 'warn' : base;
}

export function estadosTarjetas(m: ModeloKpis, e: ReturnType<typeof derivaEstados> = derivaEstados(m)): { id: string; nombre: string; tipo: EstadoKpi['tipo'] }[] {
    return [
        { id: 'kp-presas', nombre: 'Presas', tipo: m.presas.estado.tipo }, { id: 'kp-suficiencia', nombre: 'Suficiencia', tipo: m.suficiencia.estado.tipo },
        { id: 'kp-ciclo', nombre: 'Ciclo', tipo: m.ciclo.brecha.estado.tipo }, { id: 'kp-canal', nombre: 'Canal', tipo: e.canalE.tipo },
        { id: 'kp-alertas', nombre: 'Alertas', tipo: e.alertasE.tipo }, { id: 'kp-demanda', nombre: e.cerrado ? 'Clima agro' : 'Demanda de riego', tipo: tipoClimaPulso(m, e.demandaE.tipo) },
        { id: 'kp-modulos', nombre: 'Módulos', tipo: e.modulosE.tipo }, { id: 'kp-ndvi', nombre: 'Vegetación', tipo: e.ndviE.tipo },
        { id: 'kp-goes', nombre: 'Telemetría GOES', tipo: e.goesE.tipo }, { id: 'kp-confianza', nombre: 'Confianza', tipo: m.confianza.estado.tipo },
    ];
}

/** Contexto de la tarjeta Ciclo: volumen, tiempo del ciclo y los dos módulos más rezagados. Cada tramo no se parte a media frase. */
function contextoCiclo(ciclo: ModeloKpis['ciclo'], modulos: CeldaModulo[]) {
    const d = ciclo.dias;
    const rez = modulos.filter((m) => m.pct != null).sort((a, b) => (a.pct as number) - (b.pct as number)).slice(0, 2);
    const vol = ciclo.entregadoPct != null && ciclo.autMm3 != null && ciclo.acumMm3 != null
        ? <><b>{f(ciclo.acumMm3, 0)} de {f(ciclo.autMm3, 0)} Mm³</b>{ciclo.avance.concluido
            ? <><span className="kp-sep"> · </span><span className="kp-nw">sin entregar {Math.max(0, ciclo.autMm3 - ciclo.acumMm3).toFixed(0)} Mm³ ({Math.max(0, 100 - ciclo.entregadoPct).toFixed(0)} %)</span></>
            : <><span className="kp-sep"> · </span><span className="kp-nw">tiempo {f(ciclo.avance.pct, 0) ?? 'S/D'} %{ciclo.brecha.brechaPP != null ? ` · brecha ${ciclo.brecha.brechaPP > 0 ? '+' : '−'}${Math.abs(ciclo.brecha.brechaPP).toFixed(0)} pp` : ''}</span></>}</>
        : <>Sin volumen autorizado capturado</>;
    const tiempo = d ? (d.concluido ? <>Concluyó hace <b>{d.haceDias} d</b> ({d.total} d de ciclo)</> : <>Día <b>{d.transcurridos}</b> de {d.total} · faltan <b>{d.restantes} d</b></>) : null;
    return (
        <>
            <span className="kp-ciclo-l">{vol}</span>
            {tiempo && <span className="kp-ciclo-l kp-ciclo-t">{tiempo}</span>}
            {rez.length >= 2 && <span className="kp-ciclo-l kp-ciclo-r">Más bajos: {rez.map((m, i) => <span key={m.clave} className="kp-nw">{i > 0 ? ' · ' : ''}<b>{m.nombre}</b> {(m.pct as number).toFixed(0)} %</span>)}</span>}
        </>
    );
}

/** Las 10 tarjetas (Clima destacada primero) de la pantalla única del Dashboard. Cada gráfico degrada por container query (kp) según el espacio de su celda. */
export const PanelKpis = memo(function PanelKpis({ m, derivados }: { m: ModeloKpis; derivados?: ReturnType<typeof derivaEstados> }) {
    const { esInvitado } = useRol();
    const { presas, suficiencia, ciclo, canal, demanda, modulos, confianza, alertas, goes, ndvi } = m;
    const { canalE, alertasE, goesE, ndviE, modulosE, enLinea, nd, demandaE, usa24, cerrado } = derivados ?? derivaEstados(m);
    const cm = canal.modelo;
    const c = cm.conduccion;
    const crit = alertas.resumen.criticas, avi = alertas.resumen.avisos, inf = alertas.resumen.informativas;
    const sinSenal = goes.estaciones.filter((g) => g.clave === 'sin_transmision' || g.clave === 'sd');
    const refNdvi = nd && nd.valor != null && nd.anomalia != null ? nd.valor - nd.anomalia : null;
    const k0 = cm.escalas[0];
    const k0Nivel = k0 && k0.nivelM != null ? k0.nivelM : null;
    const pcts = modulos.map((x) => x.pct).filter((v): v is number => v != null);
    const letras = [...new Set(modulos.map((x) => x.letra))];
    const sf = suficiencia;
    const posTxt = sf.banda?.posicion ? `${sf.banda.posicion.posicion}.º más bajo de ${sf.banda.posicion.de} años` : null;
    const maxMedidor = Math.max(90, Math.ceil((sf.diasRestantes ?? 0) * 1.3));

    return (
        <section className="kp-grid" aria-label="Indicadores clave del distrito">
            {/* Clima manda en la pantalla: va primero y ocupa la mitad del ancho (ver ClimaHero.css) */}
            <TarjetaClimaHero demanda={demanda} usa24={usa24} cerrado={cerrado} demandaE={demandaE} />

            <KpiTile id="kp-presas" to="/presas" titulo="Presas" icono={<Waves size={18} />} valor={f(presas.pct)} unidad="%" estado={presas.estado}
                aria={`Presas: almacenamiento ${f(presas.pct) ?? 'sin dato'} por ciento, ${presas.estado.texto}. Abrir Presas`}
                viz={<div className="kp-presas-viz"><ColumnasEmbalse items={presas.items} /><div className="kp-presas-spark"><Sparkline valores={presas.serie} etiqueta="Almacenamiento total, últimos 7 días" unidad="Mm³" color="var(--sc-s1)" alto={44} area /><small>7 días</small></div></div>}
                contexto={<><b>{presas.almacenadoMm3 != null ? `${presas.almacenadoMm3.toFixed(0)} / ${presas.capacidadMm3.toFixed(0)} Mm³` : 'Sin lectura'}</b> · {presas.tendencia.texto}{m.cuenca && <LineaCuenca c={m.cuenca} />}</>}
                fresco={presas.frescura} stale={presas.stale} />

            <KpiTile id="kp-suficiencia" to="/analisis-historico" titulo={sf.modo === 'preciclo' ? 'Suficiencia · útil' : 'Suficiencia · alcance'} icono={<Hourglass size={18} />}
                valor={sf.modo === 'preciclo' ? f(sf.utilTotalMm3, 0) : f(sf.diasAlcance, 0)} unidad={sf.modo === 'preciclo' ? 'Mm³' : 'd'} estado={sf.estado}
                aria={sf.modo === 'preciclo' ? `Suficiencia: ${f(sf.utilTotalMm3, 0) ?? 'sin dato'} millones de metros cúbicos útiles, ${sf.estado.texto}${posTxt ? `, ${posTxt}` : ''}. Abrir Análisis histórico` : `Suficiencia: alcanza ${f(sf.diasAlcance, 0) ?? 'sin dato'} días de ${sf.diasRestantes} que faltan. Abrir Análisis histórico`}
                viz={sf.modo === 'temporada'
                    ? <MedidorSemicircular valor={sf.diasAlcance} max={maxMedidor} zonas={[{ hasta: (sf.diasRestantes ?? 0) * 0.6, tipo: 'crit' }, { hasta: sf.diasRestantes ?? 0, tipo: 'warn' }, { hasta: maxMedidor, tipo: 'ok' }]} etiqueta="Días que alcanza el volumen útil" unidad="días" />
                    : <div className="kp-suf-viz">{sf.banda ? <BandaCiclos banda={sf.banda} /> : <div className="kp-banda kp-banda-sd" role="status">{sf.historicoError ? 'Histórico no disponible' : sf.historicoCargado ? 'Sin base histórica suficiente' : 'Cargando histórico…'}</div>}<BarraUtil presas={sf.presas} /></div>}
                contexto={sf.modo === 'preciclo'
                    ? <>{posTxt ? <><b>{posTxt}</b>{sf.banda?.vsMedianaPct != null ? ` · ${sf.banda.vsMedianaPct.toFixed(0)} % de la mediana` : ''}</> : <>Útil = almacenado − volumen muerto</>}{sf.cobertura != null ? <> · cobertura <b>{sf.cobertura.toFixed(1)}×</b> (ref. provisional)</> : null}</>
                    : <>Alcanza <b>{f(sf.diasAlcance, 0) ?? 'S/D'} d</b> al ritmo actual; faltan <b>{sf.diasRestantes} d</b> al 30-sep</>}
                fresco={presas.frescura} stale={presas.stale} />

            <KpiTile id="kp-ciclo" to={ENLACE_CULTIVOS_CICLO} enlaceInterno enlaceTexto="Ver cultivos del ciclo en Geo-Monitor" titulo={`Ciclo ${ciclo.avance.etiqueta ?? ''}`.trim()} icono={<CalendarClock size={18} />} valor={f(ciclo.entregadoPct)} unidad="%" estado={ciclo.brecha.estado}
                aria={`Volumen entregado ${f(ciclo.entregadoPct) ?? 'sin dato'} por ciento del autorizado, ${ciclo.brecha.estado.texto}${ciclo.dias ? (ciclo.dias.concluido ? `; el ciclo concluyó hace ${ciclo.dias.haceDias} días` : `; día ${ciclo.dias.transcurridos} de ${ciclo.dias.total}`) : ''}. Ver cultivos del ciclo`}
                viz={<><BarraSegmentada pct={ciclo.entregadoPct} marcaPct={ciclo.avance.concluido ? null : ciclo.avance.pct} concluido={ciclo.avance.concluido} etiqueta="Volumen entregado frente al autorizado" />{ciclo.cultivos && <CultivosCicloMini r={ciclo.cultivos.r} cargado={ciclo.cultivos.cargado} error={ciclo.cultivos.error} />}</>}
                contexto={contextoCiclo(ciclo, modulos)} />

            {(() => {
                const vol = canal.volumen;
                const dVac = diasDesde(canal.vaciadoDesde);
                const enVaciado = cm.vaciado && c.eficienciaPct == null;
                const valor = c.eficienciaPct != null ? f(c.eficienciaPct)
                    : enVaciado ? (vol?.totalMm3 != null ? vol.totalMm3.toFixed(3) : null)
                    : canal.cargado && cm.totalControl > 0 ? String(cm.conMedicionControl) : null;
                const unidad = c.eficienciaPct != null ? '%' : enVaciado ? (vol?.totalMm3 != null ? 'Mm³' : undefined) : canal.cargado && cm.totalControl > 0 ? `de ${cm.totalControl}` : undefined;
                const k0Txt = cm.k0EdadMin == null ? 'K-0 sin medición en 30 d'
                    : cm.k0EdadMin <= 240 ? `K-0 medido ${textoEdad(cm.k0EdadMin)}` : `K-0 sin medición ${textoEdad(cm.k0EdadMin)}`;
                return (
            <KpiTile id="kp-canal" to="/escalas" vivo titulo={enVaciado ? 'Canal · volumen' : 'Canal K-0 → K-104'} icono={<IconoMedicion size={18} />}
                valor={valor} unidad={unidad} estado={canalE}
                aria={`Canal${enVaciado ? ` en vaciado${dVac != null ? ` desde hace ${dVac} días` : ''}: volumen almacenado ${vol?.totalMm3 != null ? `${vol.totalMm3.toFixed(3)} millones de metros cúbicos en ${vol.tramosMedidos} de ${vol.tramosTotal} tramos medidos` : 'sin dato'}` : ''}. ${cm.conMedicionControl} de ${cm.totalControl} escalas de control con medición vigente; ${k0Txt}${c.eficienciaPct != null ? `; eficiencia de conducción ${f(c.eficienciaPct)} por ciento` : ''}. Abrir Control de Niveles`}
                viz={<PerfilCanalMini modelo={cm} />}
                contexto={c.perdidaM3s != null
                    ? <>Pérdida <b>{c.perdidaM3s.toFixed(2)} m³/s</b> ({f(c.perdidaPct)} %) · entra <b>{f(cm.k0.gasto, 1)}</b> sale <b>{f(cm.k104.gasto, 1)}</b> m³/s</>
                    : enVaciado
                        ? <><b>{cm.descendiendo}</b> de {cm.conMedicionControl} vigentes bajando vs lectura previa{cm.secas > 0 ? <> · <b>{cm.secas}</b> seca{cm.secas === 1 ? '' : 's'}</> : null}{vol && vol.tramosTotal > 0 ? <> · {vol.tramosMedidos}/{vol.tramosTotal} tramos con volumen</> : null}</>
                        : cm.ultimaMedicionMs != null
                            ? <>Última medición <b>{textoEdad(edadMin(cm.ultimaMedicionMs))}</b>{k0Nivel != null ? <> · K-0 <b>{k0Nivel.toFixed(2)} m</b>{cm.k0EdadMin != null && cm.k0EdadMin > 240 ? ` (${textoEdad(cm.k0EdadMin)})` : ''}</> : null}</>
                            : <>{canal.cargado ? 'Sin mediciones de campo en 30 días' : 'Consultando escalas…'}</>}
                fresco={canal.cargado && cm.totalControl > 0 ? `Control ${cm.conMedicionControl}/${cm.totalControl} vigentes · ${k0Txt}` : null} stale={cm.conMedicionControl === 0} />
                );
            })()}

            <section id="kp-alertas" className={`kp-tile kp-alertas ${crit > 0 ? 'kp-dest-crit' : avi > 0 ? 'kp-dest-warn' : ''}`} data-estado={alertasE.tipo} aria-label="Alertas vigentes"><div className="kp-in">
                <div className="kp-cab"><span className="kp-titulo">Alertas</span><span className="kp-vivo" title="Fuente en tiempo real" aria-hidden="true" /><span className="kp-icono" aria-hidden="true"><ShieldAlert size={18} /></span></div>
                <div className="kp-cifra-fila"><div className="kp-cifra">{alertas.resumen.accionables}</div><span className={`kp-estado kp-${alertasE.tipo}`}>{alertasE.texto}</span></div>
                <div className="kp-viz kp-sev">
                    <BarraSeveridad crit={crit} avisos={avi} info={inf} />
                    <div className="kp-sev-btns" role="group" aria-label="Alertas por severidad">
                        <button type="button" className={`kp-sev-btn kp-crit ${crit === 0 ? 'kp-cero' : ''}`} onClick={alertas.onAbrir}><b>{crit}</b> críticas</button>
                        <button type="button" className={`kp-sev-btn kp-warn ${avi === 0 ? 'kp-cero' : ''}`} onClick={alertas.onAbrir}><b>{avi}</b> avisos</button>
                        <button type="button" className={`kp-sev-btn kp-info ${inf === 0 ? 'kp-cero' : ''}`} onClick={alertas.onAbrir}><b>{inf}</b> info</button>
                    </div>
                </div>
                <ul className="kp-top" aria-label="Alertas más graves">
                    {alertas.top.length === 0 ? <li className="kp-top-ok">Operando dentro de parámetros.</li> : alertas.top.map((a) => (
                        <li key={a.id} className={`kp-top-${a.type}`}>{a.type === 'critical' ? <OctagonAlert size={14} aria-hidden="true" /> : <TriangleAlert size={14} aria-hidden="true" />}<b>{a.title}</b><span>{a.timestamp}</span></li>
                    ))}
                </ul>
                <button type="button" className="kp-ver" onClick={alertas.onAbrir}>Ver detalle{alertas.resumen.antiguas > 0 ? ` (+${alertas.resumen.antiguas} antiguas)` : ''}</button>
            </div></section>

            <KpiTile id="kp-modulos" to={esInvitado ? undefined : '/hidrometria'} enlaceInterno enlaceTexto="Abrir Hidrometría" titulo="Módulos" icono={<LayoutGrid size={18} />}
                valor={pcts.length ? (Math.min(...pcts) === Math.max(...pcts) ? f(pcts[0], 0) : `${Math.min(...pcts).toFixed(0)}–${Math.max(...pcts).toFixed(0)}`) : null} unidad="%" estado={modulosE}
                aria={`Avance por módulo: ${pcts.length ? `de ${Math.min(...pcts).toFixed(0)} a ${Math.max(...pcts).toFixed(0)} por ciento` : 'sin dato'}. Cada módulo abre Hidrometría`}
                viz={<MapaCalorModulos celdas={modulos} />}
                contexto={<>{pcts.length} de {modulos.length} con dato · {letras.map((l) => `${l} ${LEYENDA_MOD[l] ?? ''}`).join(' · ')}</>} />

            <KpiTile id="kp-ndvi" to="/geo-monitor?panel=ndvi" titulo="Vegetación NDVI" icono={<IconoUsoAgricola size={18} />} valor={nd ? f(nd.valor, 3) : null} estado={ndviE}
                aria={`Vegetación NDVI ${nd ? f(nd.valor, 3) : 'sin dato'}${nd?.anomalia != null ? `, anomalía ${nd.anomalia.toFixed(3)}` : ''}. Abrir NDVI mensual por módulo en Geo-Monitor`}
                viz={nd && nd.valor != null ? (
                    <div className="kp-ndvi-viz">
                        <div className="kp-ndvi-pista" role="img" aria-label={`NDVI ${nd.valor.toFixed(3)}${refNdvi != null ? `, media del mismo mes en años previos ${refNdvi.toFixed(3)}` : ''}`}>
                            {refNdvi != null && <i className="kp-ndvi-cuna" style={{ left: `${Math.min(nd.valor, refNdvi) / NDVI_MAX * 100}%`, width: `${Math.abs(nd.valor - refNdvi) / NDVI_MAX * 100}%` }} />}
                            {refNdvi != null && <u className="kp-ndvi-ref" style={{ left: `${refNdvi / NDVI_MAX * 100}%` }} title={`Media años previos ${refNdvi.toFixed(3)}`} />}
                            <b className="kp-ndvi-val" style={{ left: `${Math.min(100, nd.valor / NDVI_MAX * 100)}%` }} />
                        </div>
                        <div className="kp-ndvi-esc" aria-hidden="true"><span>0</span><span>{(NDVI_MAX / 2).toFixed(1).replace('.', ',')}</span><span>{NDVI_MAX.toFixed(1).replace('.', ',')}</span></div>
                        <Sparkline valores={nd.serieMensual} etiqueta="NDVI promedio de los módulos, últimos 12 meses" decimales={2} color="var(--sc-ok)" alto={30} area />
                    </div>
                ) : undefined}
                contexto={nd ? <>{mesTexto(nd.mes as string)} · anomalía <b>{nd.anomalia == null ? 'S/D' : `${nd.anomalia > 0 ? '+' : '−'}${Math.abs(nd.anomalia).toFixed(3)}`}</b>{nd.peor ? ` · menor: mód. ${nd.peor.modulo} (${nd.peor.valor.toFixed(2)})` : ''}</> : (ndvi.error ?? 'Sin serie NDVI')}
                fresco="Último mes cerrado (Sentinel-2)" />

            <KpiTile id="kp-goes" to="/presas?tab=analitica&vista=goes" vivo titulo="Telemetría GOES" icono={<IconoTelemetria size={18} />} valor={goes.estaciones.length ? String(enLinea) : null} unidad={goes.estaciones.length ? `de ${goes.estaciones.length}` : undefined} estado={goesE}
                aria={`Telemetría GOES: ${enLinea} de ${goes.estaciones.length} estaciones transmiten. Abrir la vista GOES de Presas`}
                viz={goes.estaciones.length ? <FilaEstaciones estaciones={goes.estaciones} /> : undefined}
                contexto={goes.estaciones.length === 0 ? (goes.error ?? 'Sin estaciones activas') : sinSenal.length ? <>Sin señal: <b>{sinSenal.length} de {goes.estaciones.length}</b> · sus gastos se muestran S/D</> : <>Todas transmiten</>} />

            <KpiTile id="kp-confianza" titulo="Confianza datos" icono={<ShieldCheck size={18} />} valor={f(confianza.pct, 0)} unidad="%" estado={confianza.estado}
                aria={`Confianza del tablero ${f(confianza.pct, 0) ?? 'sin dato'} por ciento: ${confianza.vigentes} de ${confianza.total} fuentes vigentes`}
                viz={<AnilloSegmentado fuentes={confianza.fuentes} />}
                contexto={confianza.caidas.length ? <><b>{confianza.vigentes} de {confianza.total}</b> fuentes vigentes · falla: {confianza.caidas.join(', ')}</> : <><b>{confianza.vigentes} de {confianza.total}</b> fuentes vigentes</>} />
        </section>
    );
});
