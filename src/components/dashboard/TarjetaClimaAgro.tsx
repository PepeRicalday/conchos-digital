import { memo, useMemo, useState, type ReactNode } from 'react';
import { Droplets, Thermometer, CloudRain, Wind, Gauge } from 'lucide-react';
import { KpiTile } from './KpiTile';
import { RelojClima24 } from '../ui/RelojClima24';
import { SelectorChips } from '../ndvi/SelectorChips';
import { textoEdad } from '../../utils/hidroEstaciones';
import type { EstadoKpi } from '../../utils/dashboardKpisEjecutivos';
import {
    resumenVariables24h, vistaPorDefecto, severidadVista, UMBRALES_RESPALDO, VISTAS_CLIMA,
    type VistaClima, type Severidad, type UmbralesVistas,
} from '../../utils/climaVistas';
import type { ModeloKpis } from './PanelKpis';

const f = (v: number | null | undefined, d = 1) => (v == null ? null : v.toFixed(d));
const edadMin = (ms: number | null) => (ms == null ? null : Math.max(0, (Date.now() - ms) / 60000));
const hora = (t: number) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chihuahua' });
const hh = (t: number) => `${new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', hour12: false, timeZone: 'America/Chihuahua' })} h`;

const CLAVE_VISTA = 'sica.dashboard.clima.vista';
function leerVista(): VistaClima | null {
    try { const v = sessionStorage.getItem(CLAVE_VISTA); return v && (VISTAS_CLIMA as string[]).includes(v) ? (v as VistaClima) : null; } catch { return null; }
}
function guardarVista(v: VistaClima) { try { sessionStorage.setItem(CLAVE_VISTA, v); } catch { /* sin almacenamiento: solo vale en memoria */ } }

const NOMBRE: Record<VistaClima, string> = { eto: 'ETₒ', temp: 'Temp', lluvia: 'Lluvia', viento: 'Viento', hr: 'HR' };
const NOMBRE_LARGO: Record<VistaClima, string> = { eto: 'Evapotranspiración', temp: 'Temperatura', lluvia: 'Lluvia', viento: 'Viento', hr: 'Humedad relativa' };
const ICONO: Record<VistaClima, ReactNode> = {
    eto: <Droplets size={15} aria-hidden="true" />, temp: <Thermometer size={15} aria-hidden="true" />, lluvia: <CloudRain size={15} aria-hidden="true" />,
    viento: <Wind size={15} aria-hidden="true" />, hr: <Gauge size={15} aria-hidden="true" />,
};
const TXT_SEV: Record<Severidad, string> = { crit: 'crítico', warn: 'aviso', info: 'atención', ok: 'sin riesgo', sd: 'sin dato' };
const SD: EstadoKpi = { tipo: 'sd', texto: 'S/D' };

/**
 * Tarjeta "Clima agro 24 h" / "Demanda de riego 24 h" con botones por variable (spec del agente experto en pronóstico):
 * ETₒ · Temperatura · Lluvia · Viento · Humedad. Abre la vista del riesgo más grave (helada crítica > viento crítico >
 * aviso de helada > lluvia probable > aviso de viento > ETₒ); la elección del usuario se respeta (sessionStorage)
 * salvo que otra vista pase a CRÍTICO. Cada botón lleva marca de severidad (forma + color) para ver el riesgo sin entrar.
 * La tarjeta deja de ser un enlace (no puede haber botones dentro de un <a>): la navegación a Clima es un enlace explícito.
 */
export const TarjetaClimaAgro = memo(function TarjetaClimaAgro({ demanda, usa24, cerrado, demandaE }: {
    demanda: ModeloKpis['demanda']; usa24: boolean; cerrado: boolean; demandaE: EstadoKpi;
}) {
    const d24 = demanda.d24;
    const u: UmbralesVistas = demanda.umbralesVistas ?? UMBRALES_RESPALDO;
    const r = useMemo(() => resumenVariables24h(d24 && !d24.viejo ? d24 : null, u), [d24, u]);
    const [manual, setManual] = useState<VistaClima | null>(() => leerVista());
    const auto = vistaPorDefecto(r);
    // La elección manual cede solo si otra vista está en CRÍTICO y la elegida no.
    const vista: VistaClima = manual && !(severidadVista(r, auto) === 'crit' && severidadVista(r, manual) !== 'crit') ? manual : auto;
    const cambiar = (v: VistaClima) => { setManual(v); guardarVista(v); };

    const rec = demanda.etoReciente;
    const medHoy = demanda.medido.ultimaObs ? hora(Date.parse(demanda.medido.ultimaObs)) : null;
    const titulo = cerrado ? 'Clima agro 24 h' : usa24 ? 'Demanda de riego 24 h' : 'Demanda hoy (medida)';
    const hayPronostico = !!d24 && d24.horas.length > 0 && !d24.viejo;

    // ── Contenido por vista ──
    let valor: string | null = null, unidad: string | undefined, textoValor: string | undefined, estado: EstadoKpi = SD, contexto: ReactNode, aria: string;
    switch (vista) {
        case 'temp': {
            const t = r.temp;
            if (!t.sd && t.tMin && t.tMax) textoValor = `${t.tMin.v.toFixed(0)}° / ${t.tMax.v.toFixed(0)}°`;
            estado = t.sd ? SD : t.severidad === 'crit' ? { tipo: 'crit', texto: 'Helada crítica' } : t.severidad === 'warn' ? { tipo: 'warn', texto: 'Aviso de helada' } : { tipo: 'ok', texto: 'Sin helada' };
            contexto = t.sd ? <>Temperatura sin pronóstico suficiente (≥ 2 estaciones, ≥ 22 h)</>
                : <>{t.horasBajoAviso > 0 && t.desde != null && t.hasta != null
                    ? <><b>{t.horasBajoAviso} h</b> ≤ {u.helada.aviso} °C ({hh(t.desde)}–{hh(t.hasta)})</>
                    : <>Mín <b>{t.tMin!.v.toFixed(1)} °C</b> {hh(t.tMin!.t)} (estación más fría)</>} · máx {hh(t.tMax!.t)}{t.rangoMaxC != null && t.rangoMaxC >= 2 ? <> · dif. entre estaciones hasta <b>{t.rangoMaxC.toFixed(0)} °C</b></> : null}</>;
            aria = `Temperatura próximas 24 horas: ${textoValor ?? 'sin dato'}, ${estado.texto}`;
            break;
        }
        case 'lluvia': {
            const l = r.lluvia;
            valor = l.sd ? null : f(l.mm); unidad = 'mm';
            estado = l.sd ? SD : l.severidad === 'crit' ? { tipo: 'crit', texto: 'Lluvia fuerte' } : l.severidad === 'warn' ? { tipo: 'warn', texto: `≥ ${u.lluvia.aviso} mm` } : l.probable ? { tipo: 'info', texto: 'Lluvia probable' } : { tipo: 'ok', texto: 'Sin lluvia' };
            contexto = l.sd ? <>Lluvia sin pronóstico suficiente</>
                : <>Prob. máx. <b>{f(l.probMax, 0)} %</b> · efectiva <b>{f(l.efectivaMm) ?? '0.0'}</b> mm{demanda.medido.lluviaMm != null ? <> · medida hoy <b>{demanda.medido.lluviaMm.toFixed(1)}</b> mm</> : null}</>;
            aria = `Lluvia próximas 24 horas: ${valor ?? 'sin dato'} milímetros, ${estado.texto}`;
            break;
        }
        case 'viento': {
            const w = r.viento;
            valor = w.sd || !w.max ? null : f(w.max.v); unidad = 'm/s';
            estado = w.sd ? SD : w.severidad === 'crit' ? { tipo: 'crit', texto: 'Viento crítico' } : w.severidad === 'warn' ? { tipo: 'warn', texto: 'Viento fuerte' } : { tipo: 'ok', texto: 'Sin aviso' };
            contexto = w.sd ? <>Viento sin pronóstico suficiente</>
                : <>{w.max ? <>máx. {hh(w.max.t)}</> : null}{w.rafaga ? <> · ráfaga <b>{w.rafaga.v.toFixed(1)}</b> m/s {hh(w.rafaga.t)}</> : null}{w.ventanaHoras != null ? <> · aspersión <b>{w.ventanaHoras} h</b>{w.ventanaDesde != null && w.ventanaHasta != null ? ` (${hh(w.ventanaDesde)}–${hh(w.ventanaHasta)})` : ''}</> : null}</>;
            aria = `Viento próximas 24 horas: máximo sostenido ${valor ?? 'sin dato'} metros por segundo, ${estado.texto}`;
            break;
        }
        case 'hr': {
            const h = r.hr;
            textoValor = !h.sd && h.min != null && h.max != null ? `${h.min.toFixed(0)}–${h.max.toFixed(0)} %` : undefined;
            estado = h.sd ? SD : h.escarcha ? { tipo: 'warn', texto: 'Rocío/escarcha' } : { tipo: 'ok', texto: 'Sin rocío' };
            contexto = h.sd ? <>Humedad sin pronóstico suficiente</>
                : <>{h.rocioC != null ? <>Rocío <b>{h.rocioC.toFixed(1)} °C</b> en la hora más fría · </> : null}modelo, sin corregir</>;
            aria = `Humedad relativa próximas 24 horas: ${textoValor ?? 'sin dato'}, ${estado.texto}`;
            break;
        }
        default: {
            valor = usa24 ? (cerrado ? f(d24!.eto24Mm) : f(d24!.netaMm)) : f(demanda.medido.d.netaMm);
            unidad = cerrado && usa24 ? 'mm ETₒ' : 'mm';
            estado = demandaE;
            contexto = usa24
                ? cerrado
                    ? <>ETₒ de referencia — sin ciclo de riego{rec?.promMmDia != null ? <> · medido últ. {rec.dias} d <b>{rec.promMmDia.toFixed(1)}</b> mm/d</> : null}{d24!.rangoMm ? <> · estaciones {d24!.rangoMm.min.toFixed(1)}–{d24!.rangoMm.max.toFixed(1)}</> : null}</>
                    : <>ETₒ <b>{f(d24!.eto24Mm, 1) ?? 'S/D'}</b> − lluvia ef. <b>{f(d24!.lluviaEfectivaMm, 1) ?? 'S/D'}</b> mm{d24!.rangoMm ? ` (${d24!.rangoMm.min.toFixed(1)}–${d24!.rangoMm.max.toFixed(1)})` : ''}{d24!.ventanaLibreHoras != null ? <> · libre <b>{d24!.ventanaLibreHoras} h</b></> : null}{demanda.medido.etoMm != null ? <> · medido hoy{medHoy ? ` (a ${medHoy})` : ''} <b>{demanda.medido.etoMm.toFixed(1)}</b></> : null}</>
                : <>{d24?.viejo ? 'Pronóstico con más de 3 h de antigüedad: ' : demanda.error ? 'Sin pronóstico: ' : 'Medición del día al corte: '}ETₒ <b>{f(demanda.medido.etoMm, 2) ?? 'S/D'}</b> − lluvia <b>{f(demanda.medido.lluviaMm, 1) ?? 'S/D'}</b> mm</>;
            aria = cerrado && usa24
                ? `Clima agrícola, próximas 24 horas: evapotranspiración de referencia ${valor ?? 'sin dato'} milímetros (no hay ciclo de riego activo)${rec?.promMmDia != null ? `; la medida de los últimos ${rec.dias} días promedió ${rec.promMmDia.toFixed(1)} milímetros por día` : ''}`
                : `Demanda de riego ${usa24 ? 'prevista a 24 horas' : 'medida hoy'}: ${valor ?? 'sin dato'} milímetros, ${demandaE.texto}`;
        }
    }

    const opciones = VISTAS_CLIMA.map((v) => {
        const sev = severidadVista(r, v);
        return {
            valor: v, texto: NOMBRE[v], icono: ICONO[v],
            aria: `${NOMBRE_LARGO[v]}${sev === 'crit' || sev === 'warn' || sev === 'info' ? `: ${TXT_SEV[sev]}` : sev === 'sd' ? ': sin dato' : ''}`,
            title: `${NOMBRE_LARGO[v]} — ${TXT_SEV[sev]}`,
            marca: sev === 'crit' || sev === 'warn' || sev === 'info' ? sev : null,
        };
    });

    return (
        <KpiTile id="kp-demanda" to="/clima" enlaceTexto="Abrir Clima" vivo titulo={titulo} icono={<Droplets size={18} />}
            valor={valor} unidad={unidad} textoValor={textoValor} estado={estado} aria={`${titulo}. ${aria}.`}
            acciones={hayPronostico
                ? <SelectorChips etiqueta="Variable del pronóstico" etiquetaOculta clase="kp-vistas" valor={vista} opciones={opciones} onChange={cambiar} />
                : undefined}
            viz={hayPronostico
                ? <RelojClima24 horas={d24!.horas} ventanaLibre={d24!.ventanaLibreHoras} vista={vista} umbrales={u} />
                : <div className="kp-par" aria-hidden="true"><span>ETₒ<b>{f(demanda.medido.etoMm, 2) ?? 'S/D'}</b></span><span>Lluvia<b>{f(demanda.medido.lluviaMm, 1) ?? 'S/D'}</b></span><span>Tmáx<b>{f(demanda.medido.tMax) ?? 'S/D'}°</b></span></div>}
            contexto={contexto}
            fresco={hayPronostico
                ? `Previsión ${d24!.edadMin != null ? textoEdad(d24!.edadMin) : 'sin hora'} · ${d24!.estacionesUsadas}/${d24!.estacionesTotal} est.${vista === 'eto' && d24!.etoCorregido ? ' · ETₒ corregida por estación' : ''}${vista === 'temp' ? ' · corregido por estación' : vista === 'viento' ? ' · corregido · sin estaciones de presa' : vista === 'lluvia' || vista === 'hr' ? ' · modelo' : ''}`
                : demanda.medido.ultimaObs ? `Observación ${textoEdad(edadMin(Date.parse(demanda.medido.ultimaObs)))}` : 'Sin observación reciente'} />
    );
});
