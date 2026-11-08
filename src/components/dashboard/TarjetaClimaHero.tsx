import { memo, useMemo, type ReactNode } from 'react';
import {
    Sun, Moon, CloudSun, CloudMoon, Cloud, CloudOff, CloudRain, CloudDrizzle, Snowflake, ThermometerSun, Thermometer, Wind, Droplets, Gauge,
    Radio, CircleCheck, TriangleAlert, OctagonAlert, Info, CircleHelp,
} from 'lucide-react';
import { Sparkline } from '../ui/Sparkline';
import { textoEdad } from '../../utils/hidroEstaciones';
import { resumenVariables24h, severidadVista, UMBRALES_RESPALDO, VISTAS_CLIMA, type Severidad, type VistaClima, type UmbralesVistas } from '../../utils/climaVistas';
import { cieloAhora, fraseAhora, fraseResumen, horaLocal, resumenDias, nombreHoy, type CondicionDia, type TipoCielo } from '../../utils/climaPronosticoDash';
import { TarjetaClimaAgro } from './TarjetaClimaAgro';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';
import type { ModeloKpis } from './PanelKpis';

const fx = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? null : v.toFixed(d));
const NOMBRE_VISTA: Record<VistaClima, string> = { eto: 'ETₒ', temp: 'Temperatura', lluvia: 'Lluvia', viento: 'Viento', hr: 'Humedad' };
const ORDEN_SEV: Severidad[] = ['sd', 'ok', 'info', 'warn', 'crit'];
const ICONO_SEV = { ok: CircleCheck, info: Info, warn: TriangleAlert, crit: OctagonAlert, sd: CircleHelp } as const;
const ICONO_CIELO: Record<TipoCielo, ReactNode> = {
    despejado: <Sun />, parcial: <CloudSun />, nublado: <Cloud />, noche: <Moon />, 'noche-parcial': <CloudMoon />, sd: <CloudOff />,
};
const ICONO_DIA: Record<CondicionDia, ReactNode> = { lluvia: <CloudRain />, posible: <CloudDrizzle />, seco: <Sun />, sd: <CloudOff /> };
const TXT_DIA: Record<CondicionDia, string> = { lluvia: 'Lluvia probable', posible: 'Lluvia posible', seco: 'Sin lluvia', sd: 'Sin pronóstico' };

function Kpi({ icono, etiqueta, valor, unidad, extra }: { icono: ReactNode; etiqueta: string; valor: string | null; unidad?: string; extra?: string }) {
    return (
        <li className="kc-kpi" title={etiqueta === "Prob." ? "Probabilidad máxima de lluvia, próximas 24 h" : etiqueta === "Lluvia" ? "Lluvia medida hoy (promedio del distrito)" : undefined} data-sd={valor == null ? '1' : undefined}>
            <span className="kc-kpi-et"><span aria-hidden="true">{icono}</span>{etiqueta}</span>
            <span className="kc-kpi-v" aria-label={valor == null ? `${etiqueta}: sin dato` : undefined}>{valor ?? 'S/D'}{valor != null && unidad && <small>{unidad}</small>}</span>
            {extra && <span className="kc-kpi-x">{extra}</span>}
        </li>
    );
}

/** Panel "Ahora + Pronóstico" de la tarjeta Clima: cielo, 5 KPI observados, Hoy / Mañana, sensores y confianza de la red. */
const PanelAhoraClima = memo(function PanelAhoraClima({ demanda }: { demanda: ModeloKpis['demanda'] }) {
    const ahora = demanda.ahora;
    const d24 = demanda.d24 && !demanda.d24.viejo ? demanda.d24 : null;
    const u: UmbralesVistas = demanda.umbralesVistas ?? UMBRALES_RESPALDO;
    const r = useMemo(() => resumenVariables24h(d24, u), [d24, u]);
    const nowMs = Date.now();

    // Peor severidad del pronóstico de 24 h y la variable que la causa.
    const peor = useMemo(() => {
        let sev: Severidad = 'sd'; let vista: VistaClima | null = null;
        for (const v of VISTAS_CLIMA) { const s = severidadVista(r, v); if (ORDEN_SEV.indexOf(s) > ORDEN_SEV.indexOf(sev)) { sev = s; vista = v; } }
        return { sev, vista };
    }, [r]);
    const estado: EstadoKpi['tipo'] = peor.sev;
    const chipTxt = !d24 ? 'Sin pronóstico' : peor.sev === 'crit' ? `Crítico · ${NOMBRE_VISTA[peor.vista!]}` : peor.sev === 'warn' ? `Aviso · ${NOMBRE_VISTA[peor.vista!]}` : peor.sev === 'info' ? `Atención · ${NOMBRE_VISTA[peor.vista!]}` : 'Sin riesgos';
    const IconoSev = ICONO_SEV[!d24 ? 'sd' : peor.sev];

    const nub = d24?.horas.find((h) => h.nubPct != null)?.nubPct ?? null;
    const cielo = cieloAhora(nub, horaLocal(nowMs));
    const tempNow = ahora?.tempProm ?? null;
    const lluviaHoy = demanda.medido.lluviaMm;
    const heladaC = demanda.heladaAvisoC ?? 2;
    const vientoAviso = demanda.vientoAvisoMs ?? 8;
    const frase = fraseAhora(cielo, tempNow, lluviaHoy, heladaC);
    let icono: ReactNode = ICONO_CIELO[cielo.tipo];
    if (lluviaHoy != null && lluviaHoy >= 0.2) icono = <CloudRain />;
    else if (tempNow != null && tempNow <= heladaC) icono = <Snowflake />;
    else if (tempNow != null && tempNow >= 35) icono = <ThermometerSun />;
    else if (ahora?.vientoMax != null && ahora.vientoMax >= vientoAviso) icono = <Wind />;

    const dias = useMemo(() => resumenDias(demanda.horas48 ?? [], nowMs), [demanda.horas48, nowMs]);
    const hayDias = dias.some((d) => d.condicion !== 'sd');
    const serieT = useMemo(() => (demanda.horas48 ?? []).map((h) => h.tempC), [demanda.horas48]);
    const tRango = useMemo(() => { const v = serieT.filter((x): x is number => x != null); return v.length ? { min: Math.round(Math.min(...v)), max: Math.round(Math.max(...v)) } : null; }, [serieT]);
    const edad = demanda.medido.ultimaObs ? Math.max(0, (nowMs - Date.parse(demanda.medido.ultimaObs)) / 60000) : null;
    const validas = ahora?.estacionesValidas ?? 0, total = ahora?.estacionesTotal ?? 0;
    const sinRed = total === 0;

    return (
        <section className="kc-ahora" data-estado={estado} aria-label="Clima ahora y pronóstico">
            <header className="kc-cab">
                <span className="kc-titulo">Clima ahora</span>
                <span className={`kp-estado kp-${!d24 ? 'sd' : peor.sev}`}><IconoSev size={13} aria-hidden="true" />{chipTxt}</span>
            </header>

            <div className="kc-hero-fila">
                <span className="kc-cielo" aria-hidden="true">{icono}</span>
                <div className="kc-hero-txt">
                    <div className="kc-temp" aria-label={tempNow == null ? 'Temperatura: sin dato' : `Temperatura ${tempNow.toFixed(1)} grados`}>{tempNow == null ? 'S/D' : tempNow.toFixed(0)}{tempNow != null && <small>°C</small>}</div>
                    <div className="kc-frase" aria-live="polite">{frase}</div>
                    <div className="kc-sub">{ahora?.tempMin != null && ahora.tempMax != null ? `${ahora.tempMin.toFixed(0)}–${ahora.tempMax.toFixed(0)} °C · ` : ''}{edad != null ? textoEdad(edad) : 'sin observación'}</div>
                </div>
            </div>

            <ul className="kc-kpis" aria-label="Indicadores del clima">
                <Kpi icono={<Thermometer size={14} />} etiqueta="Temp" valor={fx(tempNow)} unidad="°C" />
                <Kpi icono={<CloudRain size={14} />} etiqueta="Lluvia" valor={fx(lluviaHoy)} unidad="mm" />
                <Kpi icono={<Wind size={14} />} etiqueta="Viento" valor={fx(ahora?.vientoMax)} unidad="m/s" />
                <Kpi icono={<Gauge size={14} />} etiqueta="ETₒ" valor={fx(demanda.medido.etoMm, 2)} unidad="mm" />
                <Kpi icono={<Droplets size={14} />} etiqueta="Prob." valor={d24?.probMaxPct != null ? d24.probMaxPct.toFixed(0) : null} unidad="%" />
            </ul>

            <div className="kc-pron" aria-label="Pronóstico de hoy y mañana">
                <div className="kc-dias">
                    {dias.map((d) => (
                        <div key={d.clave} className="kc-dia" data-cond={d.condicion}>
                            <span className="kc-dia-ico" aria-hidden="true">{ICONO_DIA[d.condicion]}</span>
                            <span className="kc-dia-txt">
                                <b>{d.clave === 'hoy' ? nombreHoy(d, horaLocal(nowMs), true) : 'Mañana'}</b>
                                <span className="kc-dia-t">{d.tMax != null ? <>{d.tMax.toFixed(0)}°<i>/{d.tMin != null ? d.tMin.toFixed(0) : 'S/D'}°</i></> : 'S/D'}</span>
                                <span className="kc-dia-ll" title={`${TXT_DIA[d.condicion]}${d.probMax != null ? ` · prob. máx. ${d.probMax.toFixed(0)} %` : ''}`}>{TXT_DIA[d.condicion]}</span>
                            </span>
                        </div>
                    ))}
                </div>
                {hayDias && <p className="kc-resumen">{fraseResumen(dias, horaLocal(nowMs))}</p>}
                {serieT.some((v) => v != null) && <div className="kc-spark"><Sparkline valores={serieT} etiqueta="Temperatura prevista, próximas 48 horas" unidad="°C" decimales={0} color="var(--sc-warn)" alto={34} area /><small>Temperatura 48 h</small></div>}
            </div>

            <footer className="kc-sens">
                <Radio size={14} aria-hidden="true" />
                {sinRed ? <span>Sin lectura de estaciones</span> : (
                    <>
                        <span className="kc-puntos" role="img" aria-label={`${validas} de ${total} estaciones válidas`}>{Array.from({ length: total }, (_, i) => <i key={i} className={i < validas ? 'kc-p-ok' : 'kc-p-mal'} />)}</span>
                        <span title={ahora && ahora.excluidas.length > 0 ? `Fuera: ${ahora.excluidas.join(', ')}` : 'Todas las estaciones son válidas'}>{validas}/{total} estaciones{ahora && ahora.excluidas.length > 0 ? <> · <b>{ahora.excluidas.length} fuera</b></> : ''}</span>
                        {tRango && <span className="kc-rango" title="Temperatura prevista, próximas 48 horas">48 h: <b>{tRango.min}°</b>–<b>{tRango.max}°</b></span>}
                    </>
                )}
            </footer>
        </section>
    );
});

/** Tarjeta Clima destacada: panel "Ahora + Pronóstico" a la izquierda y el detalle por variable (24 h) a la derecha. */
export const TarjetaClimaHero = memo(function TarjetaClimaHero({ demanda, usa24, cerrado, demandaE }: {
    demanda: ModeloKpis['demanda']; usa24: boolean; cerrado: boolean; demandaE: EstadoKpi;
}) {
    return (
        <div id="kp-clima" className="kc-hero">
            <PanelAhoraClima demanda={demanda} />
            <TarjetaClimaAgro demanda={demanda} usa24={usa24} cerrado={cerrado} demandaE={demandaE} />
        </div>
    );
});
