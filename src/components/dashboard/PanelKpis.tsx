import { memo } from 'react';
import { Waves, Hourglass, CalendarClock, Gauge, Droplets, LayoutGrid, ShieldCheck, ShieldAlert, Radio, Sprout, TriangleAlert, OctagonAlert } from 'lucide-react';
import { KpiTile } from './KpiTile';
import { Sparkline } from '../ui/Sparkline';
import { BarraSegmentada } from '../ui/BarraSegmentada';
import { BarraSeveridad } from '../ui/BarraSeveridad';
import { MedidorSemicircular } from '../ui/MedidorSemicircular';
import { ColumnasEmbalse, type ColumnaEmbalse } from '../ui/ColumnasEmbalse';
import { EsquemaCanal } from '../ui/EsquemaCanal';
import { PronosticoBarras } from '../ui/PronosticoBarras';
import { FilaEstaciones, type EstacionFila } from '../ui/FilaEstaciones';
import { AnilloSegmentado } from '../ui/AnilloSegmentado';
import { MapaCalorModulos, type CeldaModulo } from '../ui/MapaCalorModulos';
import {
    SUFICIENCIA_CRIT_DIAS, SUFICIENCIA_OK_DIAS, estadoGoes, estadoNdvi,
    type EstadoKpi, type Suficiencia, type BrechaCiclo, type AvanceCiclo, type DemandaRiego, type Confianza, type TendenciaTexto,
} from '../../utils/dashboardKpisEjecutivos';
import { textoEdad } from '../../utils/hidroEstaciones';
import type { ResumenAlertas, AlertaSistema } from '../../utils/dashboardKpis';
import type { ResumenPronostico, ResumenNdvi, PuntoHora } from '../../utils/dashboardExtra';
import { etiquetaEficiencia, type ConduccionTramo } from '../../utils/conduccion';

const f = (v: number | null | undefined, d = 1) => (v == null ? null : v.toFixed(d));
const edadMin = (ms: number | null) => (ms == null ? null : Math.max(0, (Date.now() - ms) / 60000));

interface ExtremoKpi { gasto: number | null; fresca: boolean; ms: number | null }

export interface ModeloKpis {
    enVivoFuera: boolean;
    presas: { pct: number | null; estado: EstadoKpi; almacenadoMm3: number | null; capacidadMm3: number; conDato: number; total: number; serie: (number | null)[]; items: ColumnaEmbalse[]; tendencia: TendenciaTexto; frescura: string | null; stale: boolean };
    suficiencia: Suficiencia;
    ciclo: { entregadoPct: number | null; acumMm3: number | null; autMm3: number | null; avance: AvanceCiclo; brecha: BrechaCiclo };
    canal: { conduccion: ConduccionTramo; k0: ExtremoKpi | null; k104: ExtremoKpi | null; cargado: boolean };
    demanda: { d: DemandaRiego; etoMm: number | null; lluviaMm: number | null; tMax: number | null; pron: ResumenPronostico | null; horas: PuntoHora[]; ultimaObs: string | null };
    modulos: CeldaModulo[];
    confianza: Confianza;
    alertas: { resumen: ResumenAlertas; top: AlertaSistema[]; onAbrir: () => void };
    goes: { cargado: boolean; error: string | null; estaciones: EstacionFila[] };
    ndvi: { cargado: boolean; error: string | null; r: ResumenNdvi | null };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesTexto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const ZONAS_SUF = [{ hasta: SUFICIENCIA_CRIT_DIAS, tipo: 'crit' as const }, { hasta: SUFICIENCIA_OK_DIAS, tipo: 'warn' as const }, { hasta: 90, tipo: 'ok' as const }];
const NDVI_MAX = 0.8;
const LEYENDA_MOD: Record<string, string> = { C: 'concluido', R: 'en ritmo', A: 'adelantado', T: 'atrasado', S: 'sobregiro', '—': 'sin dato' };

/** Estados derivados de cada tarjeta: los comparten las tarjetas y la barra de pulso global. */
export function derivaEstados(m: ModeloKpis) {
    const { canal, alertas, goes, ndvi } = m;
    const c = canal.conduccion;
    const etiqueta = etiquetaEficiencia(c.eficienciaPct);
    const canalE: EstadoKpi = c.eficienciaPct == null
        ? { tipo: 'sd', texto: canal.cargado ? 'Sin lectura vigente' : 'Consultando', corto: canal.cargado ? 'Sin lectura' : undefined }
        : { tipo: etiqueta === 'Óptima' ? 'ok' : etiqueta === 'Aceptable' ? 'warn' : 'crit', texto: etiqueta };
    const crit = alertas.resumen.criticas, avi = alertas.resumen.avisos;
    const alertasE: EstadoKpi = crit > 0 ? { tipo: 'crit', texto: `${crit} crítica${crit === 1 ? '' : 's'}` } : avi > 0 ? { tipo: 'warn', texto: 'Con avisos' } : { tipo: 'ok', texto: 'Sin alertas' };
    const enLinea = goes.estaciones.filter((g) => g.clave === 'en_linea' || g.clave === 'retraso').length;
    const goesE: EstadoKpi = goes.error ? { tipo: 'sd', texto: 'Sin lectura' } : !goes.cargado ? { tipo: 'sd', texto: 'Consultando' } : estadoGoes(enLinea, goes.estaciones.length);
    const nd = ndvi.r && ndvi.r.mes ? ndvi.r : null;
    const ndviE: EstadoKpi = ndvi.error ? { tipo: 'sd', texto: 'Sin lectura' } : !ndvi.cargado ? { tipo: 'sd', texto: 'Consultando' } : estadoNdvi(nd?.anomalia);
    const modulosE: EstadoKpi = m.ciclo.brecha.estado.tipo === 'sd' ? { tipo: 'sd', texto: 'S/D' } : m.ciclo.avance.concluido ? { tipo: 'info', texto: 'Ciclo concluido' } : { tipo: 'ok', texto: 'Por módulo' };
    return { canalE, alertasE, goesE, ndviE, modulosE, enLinea, nd };
}

export function estadosTarjetas(m: ModeloKpis): { id: string; nombre: string; tipo: EstadoKpi['tipo'] }[] {
    const e = derivaEstados(m);
    return [
        { id: 'kp-presas', nombre: 'Presas', tipo: m.presas.estado.tipo }, { id: 'kp-suficiencia', nombre: 'Suficiencia', tipo: m.suficiencia.estado.tipo },
        { id: 'kp-ciclo', nombre: 'Ciclo', tipo: m.ciclo.brecha.estado.tipo }, { id: 'kp-canal', nombre: 'Canal', tipo: e.canalE.tipo },
        { id: 'kp-alertas', nombre: 'Alertas', tipo: e.alertasE.tipo }, { id: 'kp-demanda', nombre: 'Demanda de riego', tipo: m.demanda.d.estado.tipo },
        { id: 'kp-modulos', nombre: 'Módulos', tipo: e.modulosE.tipo }, { id: 'kp-ndvi', nombre: 'Vegetación', tipo: e.ndviE.tipo },
        { id: 'kp-goes', nombre: 'Telemetría GOES', tipo: e.goesE.tipo }, { id: 'kp-confianza', nombre: 'Confianza', tipo: m.confianza.estado.tipo },
    ];
}

/** Las 10 tarjetas de la pantalla única del Dashboard. Cada gráfico degrada por container query (kp) según el espacio de su celda. */
export const PanelKpis = memo(function PanelKpis({ m }: { m: ModeloKpis }) {
    const { presas, suficiencia, ciclo, canal, demanda, modulos, confianza, alertas, goes, ndvi } = m;
    const { canalE, alertasE, goesE, ndviE, modulosE, enLinea, nd } = derivaEstados(m);
    const c = canal.conduccion;
    const crit = alertas.resumen.criticas, avi = alertas.resumen.avisos, inf = alertas.resumen.informativas;
    const sinSenal = goes.estaciones.filter((g) => g.clave === 'sin_transmision' || g.clave === 'sd');
    const refNdvi = nd && nd.valor != null && nd.anomalia != null ? nd.valor - nd.anomalia : null;
    const ext = (e: ExtremoKpi | null) => ({ gasto: e?.gasto ?? null, vigente: !!e?.fresca, edadTexto: e?.ms != null ? textoEdad(edadMin(e.ms)).replace('hace ', 'hace ') : null });
    const pcts = modulos.map((x) => x.pct).filter((v): v is number => v != null);
    const letras = [...new Set(modulos.map((x) => x.letra))];
    const inactivoSuf = suficiencia.estado.tipo === 'info';

    return (
        <section className="kp-grid" aria-label="Indicadores clave del distrito">
            <KpiTile id="kp-presas" to="/presas" titulo="Presas" icono={<Waves size={18} />} valor={f(presas.pct)} unidad="%" estado={presas.estado}
                aria={`Presas: almacenamiento ${f(presas.pct) ?? 'sin dato'} por ciento, ${presas.estado.texto}. Abrir Presas`}
                viz={<div className="kp-presas-viz"><ColumnasEmbalse items={presas.items} /><div className="kp-presas-spark"><Sparkline valores={presas.serie} etiqueta="Almacenamiento total, últimos 7 días" unidad="Mm³" color="var(--sc-s1)" alto={44} area /><small>7 días</small></div></div>}
                contexto={<><b>{presas.almacenadoMm3 != null ? `${presas.almacenadoMm3.toFixed(0)} / ${presas.capacidadMm3.toFixed(0)} Mm³` : 'Sin lectura'}</b> · {presas.tendencia.texto}</>}
                fresco={presas.frescura} stale={presas.stale} />

            <KpiTile id="kp-suficiencia" titulo="Suficiencia" icono={<Hourglass size={18} />}
                valor={inactivoSuf ? f(presas.almacenadoMm3, 0) : suficiencia.dias == null ? null : f(suficiencia.dias, 0)} unidad={inactivoSuf ? 'Mm³' : 'd'} estado={suficiencia.estado}
                aria={`Días de suficiencia: ${suficiencia.dias == null ? suficiencia.estado.texto : `${suficiencia.dias.toFixed(0)} días`}`}
                viz={<MedidorSemicircular valor={suficiencia.dias} max={90} zonas={ZONAS_SUF} etiqueta="Días de suficiencia" unidad="días" inactivo={inactivoSuf} />}
                contexto={inactivoSuf ? <>Almacenados. Sin extracción no hay ritmo con qué estimar los días.</> : <>{suficiencia.nota}. Sin descontar volumen muerto.</>} />

            <KpiTile id="kp-ciclo" to="/distribucion" titulo={`Ciclo ${ciclo.avance.etiqueta ?? ''}`.trim()} icono={<CalendarClock size={18} />} valor={f(ciclo.entregadoPct)} unidad="%" estado={ciclo.brecha.estado}
                aria={`Volumen entregado ${f(ciclo.entregadoPct) ?? 'sin dato'} por ciento del autorizado, ${ciclo.brecha.estado.texto}. Abrir Distribución`}
                viz={<BarraSegmentada pct={ciclo.entregadoPct} marcaPct={ciclo.avance.concluido ? null : ciclo.avance.pct} concluido={ciclo.avance.concluido} etiqueta="Volumen entregado frente al autorizado" />}
                contexto={ciclo.avance.concluido && ciclo.entregadoPct != null && ciclo.autMm3 != null && ciclo.acumMm3 != null
                    ? <><b>{f(ciclo.acumMm3, 0)} de {f(ciclo.autMm3, 0)} Mm³</b> · sin entregar {Math.max(0, ciclo.autMm3 - ciclo.acumMm3).toFixed(0)} Mm³ ({Math.max(0, 100 - ciclo.entregadoPct).toFixed(0)} %)</>
                    : <>Tiempo <b>{f(ciclo.avance.pct, 0) ?? 'S/D'} %</b>{ciclo.brecha.brechaPP != null ? ` · brecha ${ciclo.brecha.brechaPP > 0 ? '+' : '−'}${Math.abs(ciclo.brecha.brechaPP).toFixed(0)} pp` : ''}</>} />

            <KpiTile id="kp-canal" to="/monitor-publico" vivo titulo="Canal K-0 → K-104" icono={<Gauge size={18} />} valor={f(c.eficienciaPct)} unidad="%" estado={canalE}
                aria={`Canal: eficiencia de conducción ${f(c.eficienciaPct) ?? 'sin dato'}. Abrir Monitor Público`}
                viz={<EsquemaCanal k0={ext(canal.k0)} k104={ext(canal.k104)} perdidaPct={c.perdidaPct} />}
                contexto={c.perdidaM3s != null ? <>Pérdida <b>{c.perdidaM3s.toFixed(2)} m³/s</b> ({f(c.perdidaPct)} %)</> : <>Lectura de más de 4 h · K-0 <b>{canal.k0?.ms != null ? textoEdad(edadMin(canal.k0.ms)).replace('hace ', '') : 'sin dato'}</b> · K-104 <b>{canal.k104?.ms != null ? textoEdad(edadMin(canal.k104.ms)).replace('hace ', '') : 'sin dato'}</b></>} />

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

            <KpiTile id="kp-demanda" to="/clima" vivo titulo={`Demanda riego${m.enVivoFuera ? ' · en vivo' : ''}`} icono={<Droplets size={18} />} valor={f(demanda.d.netaMm)} unidad="mm" estado={demanda.d.estado}
                aria={`Demanda de riego neta ${f(demanda.d.netaMm) ?? 'sin dato'} milímetros, ${demanda.d.estado.texto}. Abrir Clima`}
                viz={demanda.horas.length > 0 ? <PronosticoBarras horas={demanda.horas} /> : <div className="kp-par" aria-hidden="true"><span>ETₒ<b>{f(demanda.etoMm, 2) ?? 'S/D'}</b></span><span>Lluvia<b>{f(demanda.lluviaMm, 1) ?? 'S/D'}</b></span><span>Tmáx<b>{f(demanda.tMax) ?? 'S/D'}°</b></span></div>}
                contexto={<>ETₒ <b>{f(demanda.etoMm, 2) ?? 'S/D'}</b> − lluvia <b>{f(demanda.lluviaMm, 1) ?? 'S/D'}</b> mm{demanda.pron ? <> · 48 h (previsión): lluvia <b>{f(demanda.pron.lluviaMm) ?? 'S/D'} mm</b>, prob. <b>{f(demanda.pron.probMax, 0) ?? 'S/D'} %</b>, viento <b>{f(demanda.pron.vientoMax) ?? 'S/D'} m/s</b></> : null}</>}
                fresco={demanda.ultimaObs ? `Observación ${textoEdad(edadMin(Date.parse(demanda.ultimaObs)))}` : 'Sin observación reciente'} />

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
