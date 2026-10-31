import { memo } from 'react';
import { Waves, Hourglass, CalendarClock, Gauge, Droplets, LayoutGrid, ShieldCheck, ShieldAlert, Radio, Sprout, TriangleAlert, OctagonAlert } from 'lucide-react';
import { KpiTile } from './KpiTile';
import { Sparkline } from '../ui/Sparkline';
import { BarraSegmentada } from '../ui/BarraSegmentada';
import { BarraSeveridad } from '../ui/BarraSeveridad';
import { MedidorSemicircular } from '../ui/MedidorSemicircular';
import { ColumnasEmbalse, type ColumnaEmbalse } from '../ui/ColumnasEmbalse';
import { PerfilCanalMini } from '../ui/PerfilCanalMini';
import { RelojClima24 } from '../ui/RelojClima24';
import { BandaCiclos } from '../ui/BandaCiclos';
import { BarraUtil } from '../ui/BarraUtil';
import { FilaEstaciones, type EstacionFila } from '../ui/FilaEstaciones';
import { AnilloSegmentado } from '../ui/AnilloSegmentado';
import { MapaCalorModulos, type CeldaModulo } from '../ui/MapaCalorModulos';
import {
    estadoGoes, estadoNdvi,
    type EstadoKpi, type BrechaCiclo, type AvanceCiclo, type DemandaRiego, type Confianza, type TendenciaTexto,
} from '../../utils/dashboardKpisEjecutivos';
import { textoEdad } from '../../utils/hidroEstaciones';
import type { ResumenAlertas, AlertaSistema } from '../../utils/dashboardKpis';
import { estadoDemanda24h, type ResumenNdvi, type DemandaRiego24h } from '../../utils/dashboardExtra';
import type { ModeloSuficiencia } from '../../utils/suficiencia';
import { etiquetaEficiencia } from '../../utils/conduccion';
import type { CanalKpiModelo } from '../../utils/perfilCanal';

const f = (v: number | null | undefined, d = 1) => (v == null ? null : v.toFixed(d));
const edadMin = (ms: number | null) => (ms == null ? null : Math.max(0, (Date.now() - ms) / 60000));


export interface ModeloKpis {
    enVivoFuera: boolean;
    presas: { pct: number | null; estado: EstadoKpi; almacenadoMm3: number | null; capacidadMm3: number; conDato: number; total: number; serie: (number | null)[]; items: ColumnaEmbalse[]; tendencia: TendenciaTexto; frescura: string | null; stale: boolean };
    suficiencia: ModeloSuficiencia & { historicoCargado: boolean; historicoError: string | null };
    ciclo: { entregadoPct: number | null; acumMm3: number | null; autMm3: number | null; avance: AvanceCiclo; brecha: BrechaCiclo };
    canal: { modelo: CanalKpiModelo; cargado: boolean };
    demanda: { d24: DemandaRiego24h | null; cargado: boolean; error: string | null; medido: { d: DemandaRiego; etoMm: number | null; lluviaMm: number | null; tMax: number | null; ultimaObs: string | null } };
    modulos: CeldaModulo[];
    confianza: Confianza;
    alertas: { resumen: ResumenAlertas; top: AlertaSistema[]; onAbrir: () => void };
    goes: { cargado: boolean; error: string | null; estaciones: EstacionFila[] };
    ndvi: { cargado: boolean; error: string | null; r: ResumenNdvi | null };
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
        : cm.vaciado ? { tipo: 'info', texto: 'Vaciado' }
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
    const demandaE: EstadoKpi = usa24 ? estadoDemanda24h(d24)
        : d24?.viejo ? estadoDemanda24h(d24)
        : !m.demanda.cargado && m.demanda.medido.d.netaMm == null ? { tipo: 'sd', texto: 'Consultando' } : m.demanda.medido.d.estado;
    return { canalE, alertasE, goesE, ndviE, modulosE, enLinea, nd, demandaE, usa24 };
}

export function estadosTarjetas(m: ModeloKpis): { id: string; nombre: string; tipo: EstadoKpi['tipo'] }[] {
    const e = derivaEstados(m);
    return [
        { id: 'kp-presas', nombre: 'Presas', tipo: m.presas.estado.tipo }, { id: 'kp-suficiencia', nombre: 'Suficiencia', tipo: m.suficiencia.estado.tipo },
        { id: 'kp-ciclo', nombre: 'Ciclo', tipo: m.ciclo.brecha.estado.tipo }, { id: 'kp-canal', nombre: 'Canal', tipo: e.canalE.tipo },
        { id: 'kp-alertas', nombre: 'Alertas', tipo: e.alertasE.tipo }, { id: 'kp-demanda', nombre: 'Demanda de riego', tipo: e.demandaE.tipo },
        { id: 'kp-modulos', nombre: 'Módulos', tipo: e.modulosE.tipo }, { id: 'kp-ndvi', nombre: 'Vegetación', tipo: e.ndviE.tipo },
        { id: 'kp-goes', nombre: 'Telemetría GOES', tipo: e.goesE.tipo }, { id: 'kp-confianza', nombre: 'Confianza', tipo: m.confianza.estado.tipo },
    ];
}

/** Las 10 tarjetas de la pantalla única del Dashboard. Cada gráfico degrada por container query (kp) según el espacio de su celda. */
export const PanelKpis = memo(function PanelKpis({ m }: { m: ModeloKpis }) {
    const { presas, suficiencia, ciclo, canal, demanda, modulos, confianza, alertas, goes, ndvi } = m;
    const { canalE, alertasE, goesE, ndviE, modulosE, enLinea, nd, demandaE, usa24 } = derivaEstados(m);
    const cm = canal.modelo;
    const c = cm.conduccion;
    const crit = alertas.resumen.criticas, avi = alertas.resumen.avisos, inf = alertas.resumen.informativas;
    const sinSenal = goes.estaciones.filter((g) => g.clave === 'sin_transmision' || g.clave === 'sd');
    const refNdvi = nd && nd.valor != null && nd.anomalia != null ? nd.valor - nd.anomalia : null;
    const k0 = cm.escalas[0];
    const k0Nivel = k0 && k0.nivelM != null ? k0.nivelM : null;
    const pcts = modulos.map((x) => x.pct).filter((v): v is number => v != null);
    const letras = [...new Set(modulos.map((x) => x.letra))];
    const d24 = demanda.d24;
    const sf = suficiencia;
    const posTxt = sf.banda?.posicion ? `${sf.banda.posicion.posicion}.º más bajo de ${sf.banda.posicion.de} años` : null;
    const maxMedidor = Math.max(90, Math.ceil((sf.diasRestantes ?? 0) * 1.3));

    return (
        <section className="kp-grid" aria-label="Indicadores clave del distrito">
            <KpiTile id="kp-presas" to="/presas" titulo="Presas" icono={<Waves size={18} />} valor={f(presas.pct)} unidad="%" estado={presas.estado}
                aria={`Presas: almacenamiento ${f(presas.pct) ?? 'sin dato'} por ciento, ${presas.estado.texto}. Abrir Presas`}
                viz={<div className="kp-presas-viz"><ColumnasEmbalse items={presas.items} /><div className="kp-presas-spark"><Sparkline valores={presas.serie} etiqueta="Almacenamiento total, últimos 7 días" unidad="Mm³" color="var(--sc-s1)" alto={44} area /><small>7 días</small></div></div>}
                contexto={<><b>{presas.almacenadoMm3 != null ? `${presas.almacenadoMm3.toFixed(0)} / ${presas.capacidadMm3.toFixed(0)} Mm³` : 'Sin lectura'}</b> · {presas.tendencia.texto}</>}
                fresco={presas.frescura} stale={presas.stale} />

            <KpiTile id="kp-suficiencia" to="/presas" titulo={sf.modo === 'preciclo' ? 'Suficiencia · útil' : 'Suficiencia · alcance'} icono={<Hourglass size={18} />}
                valor={sf.modo === 'preciclo' ? f(sf.utilTotalMm3, 0) : f(sf.diasAlcance, 0)} unidad={sf.modo === 'preciclo' ? 'Mm³' : 'd'} estado={sf.estado}
                aria={sf.modo === 'preciclo' ? `Suficiencia: ${f(sf.utilTotalMm3, 0) ?? 'sin dato'} millones de metros cúbicos útiles, ${sf.estado.texto}${posTxt ? `, ${posTxt}` : ''}. Abrir Presas` : `Suficiencia: alcanza ${f(sf.diasAlcance, 0) ?? 'sin dato'} días de ${sf.diasRestantes} que faltan. Abrir Presas`}
                viz={sf.modo === 'temporada'
                    ? <MedidorSemicircular valor={sf.diasAlcance} max={maxMedidor} zonas={[{ hasta: (sf.diasRestantes ?? 0) * 0.6, tipo: 'crit' }, { hasta: sf.diasRestantes ?? 0, tipo: 'warn' }, { hasta: maxMedidor, tipo: 'ok' }]} etiqueta="Días que alcanza el volumen útil" unidad="días" />
                    : <div className="kp-suf-viz">{sf.banda ? <BandaCiclos banda={sf.banda} /> : <div className="kp-banda kp-banda-sd" role="status">{sf.historicoError ? 'Histórico no disponible' : sf.historicoCargado ? 'Sin base histórica suficiente' : 'Cargando histórico…'}</div>}<BarraUtil presas={sf.presas} /></div>}
                contexto={sf.modo === 'preciclo'
                    ? <>{posTxt ? <><b>{posTxt}</b>{sf.banda?.vsMedianaPct != null ? ` · ${sf.banda.vsMedianaPct.toFixed(0)} % de la mediana` : ''}</> : <>Útil = almacenado − volumen muerto</>}{sf.cobertura != null ? <> · cobertura <b>{sf.cobertura.toFixed(1)}×</b> (ref. provisional)</> : null}</>
                    : <>Alcanza <b>{f(sf.diasAlcance, 0) ?? 'S/D'} d</b> al ritmo actual; faltan <b>{sf.diasRestantes} d</b> al 30-sep</>}
                fresco={presas.frescura} stale={presas.stale} />

            <KpiTile id="kp-ciclo" to="/distribucion" titulo={`Ciclo ${ciclo.avance.etiqueta ?? ''}`.trim()} icono={<CalendarClock size={18} />} valor={f(ciclo.entregadoPct)} unidad="%" estado={ciclo.brecha.estado}
                aria={`Volumen entregado ${f(ciclo.entregadoPct) ?? 'sin dato'} por ciento del autorizado, ${ciclo.brecha.estado.texto}. Abrir Distribución`}
                viz={<BarraSegmentada pct={ciclo.entregadoPct} marcaPct={ciclo.avance.concluido ? null : ciclo.avance.pct} concluido={ciclo.avance.concluido} etiqueta="Volumen entregado frente al autorizado" />}
                contexto={ciclo.avance.concluido && ciclo.entregadoPct != null && ciclo.autMm3 != null && ciclo.acumMm3 != null
                    ? <><b>{f(ciclo.acumMm3, 0)} de {f(ciclo.autMm3, 0)} Mm³</b> · sin entregar {Math.max(0, ciclo.autMm3 - ciclo.acumMm3).toFixed(0)} Mm³ ({Math.max(0, 100 - ciclo.entregadoPct).toFixed(0)} %)</>
                    : <>Tiempo <b>{f(ciclo.avance.pct, 0) ?? 'S/D'} %</b>{ciclo.brecha.brechaPP != null ? ` · brecha ${ciclo.brecha.brechaPP > 0 ? '+' : '−'}${Math.abs(ciclo.brecha.brechaPP).toFixed(0)} pp` : ''}</>} />

            <KpiTile id="kp-canal" to="/escalas" vivo titulo="Canal K-0 → K-104" icono={<Gauge size={18} />}
                valor={c.eficienciaPct != null ? f(c.eficienciaPct) : canal.cargado && cm.total > 0 ? String(cm.conMedicion) : null} unidad={c.eficienciaPct != null ? '%' : canal.cargado && cm.total > 0 ? `de ${cm.total}` : undefined} estado={canalE}
                aria={`Canal: ${cm.conMedicion} de ${cm.total} escalas con medición vigente${cm.ultimaMedicionMs != null ? `, la última medición de campo ${textoEdad(edadMin(cm.ultimaMedicionMs))}` : ', sin mediciones de campo recientes'}${cm.vaciado ? ', canal en vaciado' : ''}${c.eficienciaPct != null ? `, eficiencia de conducción ${f(c.eficienciaPct)} por ciento` : ''}. Abrir Control de Niveles`}
                viz={<PerfilCanalMini modelo={cm} />}
                contexto={c.perdidaM3s != null
                    ? <>Pérdida <b>{c.perdidaM3s.toFixed(2)} m³/s</b> ({f(c.perdidaPct)} %) · entra <b>{f(cm.k0.gasto, 1)}</b> sale <b>{f(cm.k104.gasto, 1)}</b> m³/s</>
                    : cm.ultimaMedicionMs != null
                        ? <>Última medición <b>{textoEdad(edadMin(cm.ultimaMedicionMs))}</b>{k0Nivel != null ? <> · K-0 <b>{k0Nivel.toFixed(2)} m</b></> : null}{cm.vaciado ? ' · canal en vaciado' : ''}</>
                        : <>{canal.cargado ? 'Sin mediciones de campo en 30 días' : 'Consultando escalas…'}{cm.vaciado ? ' · canal en vaciado' : ''}</>}
                fresco={cm.ultimaMedicionMs != null ? `Medición vigente: ${cm.conMedicion} de ${cm.total}` : null} stale={cm.conMedicion === 0} />

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

            <KpiTile id="kp-demanda" to="/clima" vivo titulo={usa24 ? 'Demanda 24 h' : 'Demanda hoy (medida)'} icono={<Droplets size={18} />}
                valor={usa24 ? f(d24!.netaMm) : f(demanda.medido.d.netaMm)} unidad="mm" estado={demandaE}
                aria={`Demanda de riego ${usa24 ? 'prevista a 24 horas' : 'medida hoy'}: ${(usa24 ? f(d24!.netaMm) : f(demanda.medido.d.netaMm)) ?? 'sin dato'} milímetros, ${demandaE.texto}. Abrir Clima`}
                viz={usa24 ? <RelojClima24 horas={d24!.horas} ventanaLibre={d24!.ventanaLibreHoras} />
                    : <div className="kp-par" aria-hidden="true"><span>ETₒ<b>{f(demanda.medido.etoMm, 2) ?? 'S/D'}</b></span><span>Lluvia<b>{f(demanda.medido.lluviaMm, 1) ?? 'S/D'}</b></span><span>Tmáx<b>{f(demanda.medido.tMax) ?? 'S/D'}°</b></span></div>}
                contexto={usa24
                    ? <>ETₒ <b>{f(d24!.eto24Mm, 1) ?? 'S/D'}</b> − lluvia ef. <b>{f(d24!.lluviaEfectivaMm, 1) ?? 'S/D'}</b> mm{d24!.rangoMm ? ` (${d24!.rangoMm.min.toFixed(1)}–${d24!.rangoMm.max.toFixed(1)})` : ''}{d24!.ventanaLibreHoras != null ? <> · libre <b>{d24!.ventanaLibreHoras} h</b></> : null}{demanda.medido.etoMm != null ? <> · medido hoy ETₒ <b>{demanda.medido.etoMm.toFixed(1)}</b></> : null}</>
                    : <>{d24?.viejo ? 'Pronóstico con más de 3 h de antigüedad: ' : demanda.error ? 'Sin pronóstico: ' : 'Medición del día al corte: '}ETₒ <b>{f(demanda.medido.etoMm, 2) ?? 'S/D'}</b> − lluvia <b>{f(demanda.medido.lluviaMm, 1) ?? 'S/D'}</b> mm</>}
                fresco={usa24 ? `Previsión ${d24!.edadMin != null ? textoEdad(d24!.edadMin) : 'sin hora'} · ${d24!.estacionesUsadas}/${d24!.estacionesTotal} est.` : demanda.medido.ultimaObs ? `Observación ${textoEdad(edadMin(Date.parse(demanda.medido.ultimaObs)))}` : 'Sin observación reciente'} />

            <KpiTile id="kp-modulos" to="/balance" titulo="Módulos" icono={<LayoutGrid size={18} />}
                valor={pcts.length ? (Math.min(...pcts) === Math.max(...pcts) ? f(pcts[0], 0) : `${Math.min(...pcts).toFixed(0)}–${Math.max(...pcts).toFixed(0)}`) : null} unidad="%" estado={modulosE}
                aria={`Avance por módulo: ${pcts.length ? `de ${Math.min(...pcts).toFixed(0)} a ${Math.max(...pcts).toFixed(0)} por ciento` : 'sin dato'}. Abrir Balance hidráulico`}
                viz={<MapaCalorModulos celdas={modulos} />}
                contexto={<>{pcts.length} de {modulos.length} con dato · {letras.map((l) => `${l} ${LEYENDA_MOD[l] ?? ''}`).join(' · ')}</>} />

            <KpiTile id="kp-ndvi" to="/geo-monitor" titulo="Vegetación NDVI" icono={<Sprout size={18} />} valor={nd ? f(nd.valor, 3) : null} estado={ndviE}
                aria={`Vegetación NDVI ${nd ? f(nd.valor, 3) : 'sin dato'}${nd?.anomalia != null ? `, anomalía ${nd.anomalia.toFixed(3)}` : ''}. Abrir Geo-Monitor`}
                viz={nd && nd.valor != null ? (
                    <div className="kp-ndvi-viz">
                        <div className="kp-ndvi-pista" role="img" aria-label={`NDVI ${nd.valor.toFixed(3)}${refNdvi != null ? `, media del mismo mes en años previos ${refNdvi.toFixed(3)}` : ''}`}>
                            {refNdvi != null && <i className="kp-ndvi-cuna" style={{ left: `${Math.min(nd.valor, refNdvi) / NDVI_MAX * 100}%`, width: `${Math.abs(nd.valor - refNdvi) / NDVI_MAX * 100}%` }} />}
                            {refNdvi != null && <u className="kp-ndvi-ref" style={{ left: `${refNdvi / NDVI_MAX * 100}%` }} title={`Media años previos ${refNdvi.toFixed(3)}`} />}
                            <b className="kp-ndvi-val" style={{ left: `${Math.min(100, nd.valor / NDVI_MAX * 100)}%` }} />
                        </div>
                        <Sparkline valores={nd.serieMensual} etiqueta="NDVI promedio de los módulos, últimos 12 meses" decimales={2} color="var(--sc-ok)" alto={30} area />
                    </div>
                ) : undefined}
                contexto={nd ? <>{mesTexto(nd.mes as string)} · anomalía <b>{nd.anomalia == null ? 'S/D' : `${nd.anomalia > 0 ? '+' : '−'}${Math.abs(nd.anomalia).toFixed(3)}`}</b>{nd.peor ? ` · menor: mód. ${nd.peor.modulo} (${nd.peor.valor.toFixed(2)})` : ''}</> : (ndvi.error ?? 'Sin serie NDVI')}
                fresco="Último mes cerrado (Sentinel-2)" />

            <KpiTile id="kp-goes" to="/presas" vivo titulo="Telemetría GOES" icono={<Radio size={18} />} valor={goes.estaciones.length ? String(enLinea) : null} unidad={goes.estaciones.length ? `de ${goes.estaciones.length}` : undefined} estado={goesE}
                aria={`Telemetría GOES: ${enLinea} de ${goes.estaciones.length} estaciones transmiten. Abrir Presas`}
                viz={goes.estaciones.length ? <FilaEstaciones estaciones={goes.estaciones} /> : undefined}
                contexto={goes.estaciones.length === 0 ? (goes.error ?? 'Sin estaciones activas') : sinSenal.length ? <>Sin señal: <b>{sinSenal.length} de {goes.estaciones.length}</b> · sus gastos se muestran S/D</> : <>Todas transmiten</>} />

            <KpiTile id="kp-confianza" titulo="Confianza datos" icono={<ShieldCheck size={18} />} valor={f(confianza.pct, 0)} unidad="%" estado={confianza.estado}
                aria={`Confianza del tablero ${f(confianza.pct, 0) ?? 'sin dato'} por ciento: ${confianza.vigentes} de ${confianza.total} fuentes vigentes`}
                viz={<AnilloSegmentado fuentes={confianza.fuentes} />}
                contexto={confianza.caidas.length ? <><b>{confianza.vigentes} de {confianza.total}</b> fuentes vigentes · falla: {confianza.caidas.join(', ')}</> : <><b>{confianza.vigentes} de {confianza.total}</b> fuentes vigentes</>} />
        </section>
    );
});
