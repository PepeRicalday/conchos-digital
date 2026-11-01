/**
 * climaVistas — resumen PURO de las próximas 24 h por variable para la tarjeta "Clima agro" del Dashboard
 * (vistas ETₒ · Temperatura · Lluvia · Viento · Humedad). Especificación del agente experto en pronóstico, 2026-11-01:
 *
 *  · Temperatura, viento, ráfaga y ETₒ usan el valor CORREGIDO por estación cuando existe (lo resuelve demanda24h).
 *    Lluvia, probabilidad y humedad son del modelo, sin corrección.
 *  · Riesgos con el PEOR CASO entre estaciones: la helada con la mínima de la estación más fría (el promedio la
 *    esconde 1–3 °C), viento y ráfaga con el máximo.
 *  · S/D POR VISTA: pronóstico viejo, < 2 estaciones o < 22 h con dato para esa variable. Que falte la humedad no
 *    tumba la tarjeta entera.
 */
import type { DemandaRiego24h, PuntoHora24 } from './dashboardExtra';
import { PROB_LLUVIA_CUENTA_PCT, VIENTO_VENTANA_MS, HORAS_MIN_ESTACION } from './dashboardExtra';

export type VistaClima = 'eto' | 'temp' | 'lluvia' | 'viento' | 'hr';
export const VISTAS_CLIMA: VistaClima[] = ['eto', 'temp', 'lluvia', 'viento', 'hr'];
export type Severidad = 'crit' | 'warn' | 'info' | 'ok' | 'sd';

export interface UmbralesVistas {
    helada: { aviso: number; critico: number };
    viento: { aviso: number; critico: number };
    rafaga: { aviso: number; critico: number };
    lluvia: { aviso: number; critico: number };
}
export const UMBRALES_RESPALDO: UmbralesVistas = {
    helada: { aviso: 4, critico: 0 }, viento: { aviso: 6, critico: 10 }, rafaga: { aviso: 12, critico: 18 }, lluvia: { aviso: 10, critico: 25 },
};

interface Extremo { v: number; t: number }
export interface ResumenTemp { tMin: Extremo | null; tMax: Extremo | null; horasBajoAviso: number; desde: number | null; hasta: number | null; rangoMaxC: number | null; severidad: Severidad; sd: boolean }
export interface ResumenLluvia { mm: number | null; probMax: number | null; efectivaMm: number | null; probable: boolean; severidad: Severidad; sd: boolean }
export interface ResumenViento { max: Extremo | null; rafaga: Extremo | null; ventanaHoras: number | null; ventanaDesde: number | null; ventanaHasta: number | null; severidad: Severidad; sd: boolean }
export interface ResumenHr { min: number | null; max: number | null; rocioC: number | null; escarcha: boolean; severidad: Severidad; sd: boolean }
export interface ResumenEto { mm: number | null; pico: Extremo | null; sd: boolean }
export interface ResumenClima24 { eto: ResumenEto; temp: ResumenTemp; lluvia: ResumenLluvia; viento: ResumenViento; hr: ResumenHr }

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const RANGO_SEV: Record<Severidad, number> = { crit: 0, warn: 1, info: 2, ok: 3, sd: 4 };
const peor = (a: Severidad, b: Severidad): Severidad => (RANGO_SEV[a] <= RANGO_SEV[b] ? a : b);

/** Punto de rocío (Magnus–Tetens), °C. */
export function puntoRocio(tC: number, hrPct: number): number | null {
    if (!fin(tC) || !fin(hrPct) || hrPct <= 0) return null;
    const a = 17.62, b = 243.12;
    const g = Math.log(Math.min(hrPct, 100) / 100) + (a * tC) / (b + tC);
    return (b * g) / (a - g);
}

function extremo(horas: PuntoHora24[], val: (h: PuntoHora24) => number | null | undefined, modo: 'min' | 'max'): Extremo | null {
    let r: Extremo | null = null;
    for (const h of horas) {
        const v = val(h);
        if (!fin(v)) continue;
        if (!r || (modo === 'min' ? v < r.v : v > r.v)) r = { v, t: h.t };
    }
    return r;
}

/** Cuántas horas tienen la variable, y si alguna hora la aportan ≥ 2 estaciones. */
function cobertura(horas: PuntoHora24[], val: (h: PuntoHora24) => number | null | undefined): { horas: number; multi: boolean } {
    const con = horas.filter((h) => fin(val(h)));
    return { horas: con.length, multi: con.some((h) => (h.estaciones ?? 0) >= 2) };
}
const insuficiente = (c: { horas: number; multi: boolean }) => c.horas < HORAS_MIN_ESTACION || !c.multi;

export function resumenVariables24h(d: DemandaRiego24h | null, u: UmbralesVistas = UMBRALES_RESPALDO): ResumenClima24 {
    const horas = d?.horas ?? [];
    const viejo = !d || d.viejo;

    // ETₒ (lo mismo que ya muestra la tarjeta)
    const sdEto = viejo || d.eto24Mm == null;
    const eto: ResumenEto = { mm: sdEto ? null : d.eto24Mm, pico: extremo(horas, (h) => h.etoMm, 'max'), sd: sdEto };

    // Temperatura: mínima de la estación más fría por hora (peor caso), máxima de la más cálida
    const cT = cobertura(horas, (h) => h.tempC);
    const sdT = viejo || insuficiente(cT);
    const tMin = extremo(horas, (h) => h.tempMinC ?? h.tempC, 'min');
    const tMax = extremo(horas, (h) => h.tempMaxC ?? h.tempC, 'max');
    const bajo = horas.filter((h) => fin(h.tempMinC ?? h.tempC) && (h.tempMinC ?? h.tempC)! <= u.helada.aviso);
    const rangos = horas.map((h) => (fin(h.tempMinC) && fin(h.tempMaxC) ? h.tempMaxC! - h.tempMinC! : null)).filter(fin);
    const sevT: Severidad = sdT || !tMin ? 'sd' : tMin.v <= u.helada.critico ? 'crit' : tMin.v <= u.helada.aviso ? 'warn' : 'ok';
    const temp: ResumenTemp = {
        tMin: sdT ? null : tMin, tMax: sdT ? null : tMax, horasBajoAviso: sdT ? 0 : bajo.length,
        desde: !sdT && bajo.length ? bajo[0].t : null, hasta: !sdT && bajo.length ? bajo[bajo.length - 1].t : null,
        rangoMaxC: rangos.length ? Math.max(...rangos) : null, severidad: sevT, sd: sdT,
    };

    // Lluvia: total por estación agregado (mediana) — nunca suma entre estaciones
    const cL = cobertura(horas, (h) => h.lluviaMm);
    const sdL = viejo || insuficiente(cL) || d.lluvia24Mm == null;
    const mm = sdL ? null : d.lluvia24Mm;
    const probMax = sdL ? null : d.probMaxPct;
    const probable = probMax != null && probMax >= PROB_LLUVIA_CUENTA_PCT;
    const sevL: Severidad = sdL ? 'sd' : mm != null && mm >= u.lluvia.critico ? 'crit' : mm != null && mm >= u.lluvia.aviso ? 'warn' : probable ? 'info' : 'ok';
    const lluvia: ResumenLluvia = { mm, probMax, efectivaMm: sdL ? null : d.lluviaEfectivaMm, probable, severidad: sevL, sd: sdL };

    // Viento: sostenido y ráfaga, máximo entre estaciones; vale el peor de los dos umbrales
    const cV = cobertura(horas, (h) => h.vientoMs);
    const sdV = viejo || insuficiente(cV);
    const vMax = extremo(horas, (h) => h.vientoMs, 'max');
    const rMax = extremo(horas, (h) => h.rafagaMs, 'max');
    const sevSost: Severidad = !vMax ? 'sd' : vMax.v >= u.viento.critico ? 'crit' : vMax.v >= u.viento.aviso ? 'warn' : 'ok';
    const sevRaf: Severidad = !rMax ? 'ok' : rMax.v >= u.rafaga.critico ? 'crit' : rMax.v >= u.rafaga.aviso ? 'warn' : 'ok';
    const libres = horas.filter((h) => fin(h.vientoMs) && h.vientoMs! <= VIENTO_VENTANA_MS && (h.probPct ?? 0) < 30 && (h.lluviaMm ?? 0) <= 0.2);
    const viento: ResumenViento = {
        max: sdV ? null : vMax, rafaga: sdV ? null : rMax, ventanaHoras: sdV ? null : d.ventanaLibreHoras,
        ventanaDesde: !sdV && libres.length ? libres[0].t : null, ventanaHasta: !sdV && libres.length ? libres[libres.length - 1].t : null,
        severidad: sdV ? 'sd' : peor(sevSost, sevRaf), sd: sdV,
    };

    // Humedad relativa (modelo): rocío / escarcha con HR ≥ 90 % y T ≤ aviso de helada en la misma hora
    const cH = cobertura(horas, (h) => h.humPct);
    const sdH = viejo || insuficiente(cH);
    const hMin = extremo(horas, (h) => h.humMinPct ?? h.humPct, 'min');
    const hMax = extremo(horas, (h) => h.humMaxPct ?? h.humPct, 'max');
    const horaFria = tMin ? horas.find((h) => h.t === tMin.t) : undefined;
    const rocio = horaFria && fin(horaFria.tempMinC ?? horaFria.tempC) && fin(horaFria.humPct) ? puntoRocio((horaFria.tempMinC ?? horaFria.tempC)!, horaFria.humPct!) : null;
    const escarcha = !sdH && horas.some((h) => fin(h.humMaxPct ?? h.humPct) && (h.humMaxPct ?? h.humPct)! >= 90 && fin(h.tempMinC ?? h.tempC) && (h.tempMinC ?? h.tempC)! <= u.helada.aviso);
    const hr: ResumenHr = {
        min: sdH ? null : hMin?.v ?? null, max: sdH ? null : hMax?.v ?? null, rocioC: sdH ? null : rocio,
        escarcha, severidad: sdH ? 'sd' : escarcha ? 'warn' : 'ok', sd: sdH,
    };

    return { eto, temp, lluvia, viento, hr };
}

/** Vista que conviene abrir: el riesgo más grave primero; si no hay riesgo, ETₒ. */
export function vistaPorDefecto(r: ResumenClima24): VistaClima {
    if (r.temp.severidad === 'crit') return 'temp';
    if (r.viento.severidad === 'crit') return 'viento';
    if (r.temp.severidad === 'warn') return 'temp';
    if (r.lluvia.probable || r.lluvia.severidad === 'warn' || r.lluvia.severidad === 'crit') return 'lluvia';
    if (r.viento.severidad === 'warn') return 'viento';
    return 'eto';
}

/** Severidad de cada vista (para el punto del botón). */
export function severidadVista(r: ResumenClima24, v: VistaClima): Severidad {
    return v === 'eto' ? (r.eto.sd ? 'sd' : 'ok') : r[v].severidad;
}
