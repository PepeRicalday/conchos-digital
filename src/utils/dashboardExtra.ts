import { lluviaEfectivaMm } from './agronomia';

/**
 * dashboardExtra — cifras ejecutivas nuevas del Dashboard (pronóstico 48 h, NDVI del último mes cerrado, GOES).
 * Funciones puras, sin red. Regla: S/D (null) nunca 0; los promedios de red PROMEDIAN (no suman) estaciones.
 */

// ── Pronóstico 48 h ───────────────────────────────────────────────────────────
export interface FilaPronostico {
    estacion_id: string; valido_en: string;
    precip_mm: number | null; precip_prob_pct: number | null;
    temp_c: number | null; temp_c_corr: number | null;
    viento_ms: number | null; viento_ms_corr: number | null;
    eto_fc_mm: number | null;
    /** ETo corregido por factor de estación (trigger fn_clima_aplica_sesgo); igual al crudo si el factor no aplica. */
    eto_fc_mm_corr?: number | null;
    viento_rafaga_ms?: number | null;
    viento_rafaga_ms_corr?: number | null;
    /** Humedad relativa del modelo (sin corrección). */
    hum_rel_pct?: number | null;
    temp_min_c?: number | null;
    nubosidad_total_pct?: number | null;
    /** Momento de la corrida del modelo (frescura del pronóstico). */
    corrida_en?: string | null;
}

export interface ResumenPronostico {
    /** Estaciones que aportan al menos una hora. */
    estaciones: number;
    tMax: number | null; tMin: number | null;
    /** Racha máxima horaria prevista (valor corregido por sesgo cuando existe). */
    vientoMax: number | null;
    /** Lluvia acumulada 48 h: promedio de estaciones de la suma de cada una (no suma entre estaciones). */
    lluviaMm: number | null;
    /** Probabilidad horaria máxima de lluvia entre estaciones. */
    probMax: number | null;
    /** ETo prevista 48 h, promedio de estaciones. */
    etoMm: number | null;
}

const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const prom = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function resumenPronostico(filas: FilaPronostico[]): ResumenPronostico {
    const porEst = new Map<string, FilaPronostico[]>();
    for (const f of filas) { const a = porEst.get(f.estacion_id); if (a) a.push(f); else porEst.set(f.estacion_id, [f]); }
    const temps: number[] = [], vientos: number[] = [], probs: number[] = [];
    const lluvias: number[] = [], etos: number[] = [];
    for (const hs of porEst.values()) {
        const ll = hs.map((h) => h.precip_mm).filter(fin);
        if (ll.length) lluvias.push(ll.reduce((a, b) => a + b, 0));
        const et = hs.map((h) => h.eto_fc_mm).filter(fin);
        if (et.length) etos.push(et.reduce((a, b) => a + b, 0));
        for (const h of hs) {
            const t = h.temp_c_corr ?? h.temp_c; if (fin(t)) temps.push(t);
            const v = h.viento_ms_corr ?? h.viento_ms; if (fin(v)) vientos.push(v);
            if (fin(h.precip_prob_pct)) probs.push(h.precip_prob_pct);
        }
    }
    return {
        estaciones: porEst.size,
        tMax: temps.length ? Math.max(...temps) : null,
        tMin: temps.length ? Math.min(...temps) : null,
        vientoMax: vientos.length ? Math.max(...vientos) : null,
        lluviaMm: prom(lluvias),
        probMax: probs.length ? Math.max(...probs) : null,
        etoMm: prom(etos),
    };
}

// ── NDVI del último mes cerrado y su anomalía ────────────────────────────────
export interface FilaNdviMini { numero_modulo: number; mes: string; ndvi_mediana: number | null }

export interface ResumenNdvi {
    /** Último mes (AAAA-MM) con al menos un módulo con dato; null si no hay serie. */
    mes: string | null;
    /** Promedio simple de módulos con dato en ese mes. */
    valor: number | null;
    nModulos: number;
    /** Valor menos el promedio del mismo mes calendario en años anteriores; null sin historia comparable. */
    anomalia: number | null;
    /** Años anteriores que entran a la referencia. */
    aniosRef: number;
    /** Módulo con menor y mayor NDVI del mes (número); null si <2 módulos con dato. */
    peor: { modulo: number; valor: number } | null;
    mejor: { modulo: number; valor: number } | null;
    /** Promedio de módulos por mes de los últimos 12 meses terminando en `mes`; null = mes sin dato (hueco, nunca 0). */
    serieMensual: (number | null)[];
}

export function resumenNdvi(filas: FilaNdviMini[]): ResumenNdvi {
    const conDato = filas.filter((f) => fin(f.ndvi_mediana));
    if (!conDato.length) return { mes: null, valor: null, nModulos: 0, anomalia: null, aniosRef: 0, peor: null, mejor: null, serieMensual: [] };
    const mes = conDato.reduce((m, f) => (f.mes > m ? f.mes : m), conDato[0].mes);
    const delMes = conDato.filter((f) => f.mes === mes);
    const valor = prom(delMes.map((f) => f.ndvi_mediana as number));
    const mm = mes.slice(5, 7), anio = Number(mes.slice(0, 4));
    const porAnio = new Map<number, number[]>();
    for (const f of conDato) {
        const a = Number(f.mes.slice(0, 4));
        if (f.mes.slice(5, 7) === mm && a < anio) { const arr = porAnio.get(a); if (arr) arr.push(f.ndvi_mediana as number); else porAnio.set(a, [f.ndvi_mediana as number]); }
    }
    const medias = [...porAnio.values()].map((v) => prom(v) as number);
    const ref = prom(medias);
    const idx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
    const fin12 = idx(mes);
    const serieMensual = Array.from({ length: 12 }, (_, k) => {
        const i = fin12 - 11 + k;
        const mm2 = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
        return prom(conDato.filter((f) => f.mes === mm2).map((f) => f.ndvi_mediana as number));
    });
    const ord = [...delMes].sort((a, b) => (a.ndvi_mediana as number) - (b.ndvi_mediana as number));
    return {
        mes, valor, nModulos: delMes.length,
        anomalia: valor != null && ref != null ? valor - ref : null,
        aniosRef: medias.length,
        peor: ord.length >= 2 ? { modulo: ord[0].numero_modulo, valor: ord[0].ndvi_mediana as number } : null,
        mejor: ord.length >= 2 ? { modulo: ord[ord.length - 1].numero_modulo, valor: ord[ord.length - 1].ndvi_mediana as number } : null,
        serieMensual,
    };
}

// ── Serie de almacenamiento agregado (7 d) ───────────────────────────────────
export interface FilaAlmacenamiento { fecha: string; presa_id: string; almacenamiento_mm3: number | null }

/**
 * Almacenamiento total por día, de `hasta` hacia atrás `dias` días. Un día solo cuenta si TODAS las presas esperadas
 * tienen lectura ese día (si falta una, sumar daría una caída falsa): queda null = hueco, nunca 0.
 */
export function serieAlmacenamiento(filas: FilaAlmacenamiento[], hasta: string, dias: number, presasEsperadas: number): (number | null)[] {
    const out: (number | null)[] = [];
    const base = new Date(`${hasta}T00:00:00Z`);
    for (let i = dias - 1; i >= 0; i--) {
        const d = new Date(base); d.setUTCDate(d.getUTCDate() - i);
        const f = d.toISOString().slice(0, 10);
        const delDia = new Map<string, number>();
        for (const r of filas) if (r.fecha === f && fin(r.almacenamiento_mm3)) delDia.set(r.presa_id, r.almacenamiento_mm3);
        out.push(presasEsperadas > 0 && delDia.size === presasEsperadas ? [...delDia.values()].reduce((a, b) => a + b, 0) : null);
    }
    return out;
}

// ── Sparkline: normalización de una serie con huecos ─────────────────────────
export interface PuntoSpark { x: number; y: number }
/** Segmentos continuos (null corta la línea: S/D es hueco, nunca 0). Y invertido para SVG (0 arriba). */
export function segmentosSpark(valores: (number | null)[], ancho: number, alto: number, pad = 3): { segmentos: PuntoSpark[][]; min: number | null; max: number | null; ultimo: PuntoSpark | null } {
    const vs = valores.filter(fin);
    if (!vs.length) return { segmentos: [], min: null, max: null, ultimo: null };
    const min = Math.min(...vs), max = Math.max(...vs);
    const rango = max - min || 1;
    const n = valores.length;
    const x = (i: number) => (n === 1 ? ancho / 2 : pad + (i * (ancho - 2 * pad)) / (n - 1));
    const y = (v: number) => (max === min ? alto / 2 : pad + (1 - (v - min) / rango) * (alto - 2 * pad));
    const segmentos: PuntoSpark[][] = [];
    let actual: PuntoSpark[] = [];
    let ultimo: PuntoSpark | null = null;
    valores.forEach((v, i) => {
        if (!fin(v)) { if (actual.length) segmentos.push(actual); actual = []; return; }
        const p = { x: x(i), y: y(v) };
        actual.push(p); ultimo = p;
    });
    if (actual.length) segmentos.push(actual);
    return { segmentos, min, max, ultimo };
}

// ── Pronóstico: serie horaria de 48 h (promedio de estaciones por hora) ───────
export interface PuntoHora { t: number; lluviaMm: number | null; tempC: number | null; probPct: number | null }

/**
 * Una fila por hora: lluvia y temperatura PROMEDIAN entre estaciones (no se suma lluvia entre estaciones), probabilidad = máxima.
 * Solo horas con datos; no se rellena nada. Ordenada por tiempo.
 */
export function serieHoraria48(filas: FilaPronostico[]): PuntoHora[] {
    const porHora = new Map<number, FilaPronostico[]>();
    for (const f of filas) {
        const t = Date.parse(f.valido_en);
        if (!Number.isFinite(t)) continue;
        const a = porHora.get(t);
        if (a) a.push(f); else porHora.set(t, [f]);
    }
    return [...porHora.entries()].sort((a, b) => a[0] - b[0]).map(([t, hs]) => {
        const ll = hs.map((h) => h.precip_mm).filter(fin);
        const tp = hs.map((h) => h.temp_c_corr ?? h.temp_c).filter(fin);
        const pr = hs.map((h) => h.precip_prob_pct).filter(fin);
        return { t, lluviaMm: prom(ll), tempC: prom(tp), probPct: pr.length ? Math.max(...pr) : null };
    });
}

// ── Demanda de riego de las PRÓXIMAS 24 h (previsión) ────────────────────────
/** Probabilidad a partir de la cual la lluvia prevista cuenta (misma regla que v_clima_alertas_agro_eval). */
export const PROB_LLUVIA_CUENTA_PCT = 60;
/** Horas con ETo prevista que exige una estación para entrar al cálculo (de 24). */
export const HORAS_MIN_ESTACION = 22;
/** Viento máximo (m/s) para una "ventana libre" de aspersión. PROVISIONAL. */
export const VIENTO_VENTANA_MS = 4;
/** Antigüedad máxima de la corrida del pronóstico (min); más vieja = S/D con texto. */
export const EDAD_MAX_PRONOSTICO_MIN = 180;

export interface PuntoHora24 {
    t: number;
    etoMm: number | null;       // promedio de estaciones válidas
    lluviaMm: number | null;    // promedio de estaciones válidas (nunca suma entre estaciones)
    probPct: number | null;     // máxima entre estaciones (peor caso)
    tempC: number | null;       // promedio
    vientoMs: number | null;    // máximo entre estaciones (peor caso para aspersión)
    /** Temperatura mínima / máxima ENTRE ESTACIONES en esa hora (la mínima es el peor caso para helada). */
    tempMinC?: number | null;
    tempMaxC?: number | null;
    vientoMinMs?: number | null;
    /** Ráfaga máxima entre estaciones (corregida si existe). */
    rafagaMs?: number | null;
    /** Humedad relativa: promedio y rango entre estaciones (modelo, sin corregir). */
    humPct?: number | null;
    humMinPct?: number | null;
    humMaxPct?: number | null;
    nubPct?: number | null;
    /** Estaciones que aportaron a esa hora. */
    estaciones?: number;
}

export interface DemandaEstacion {
    estacionId: string; excluida: boolean; horasConDato: number;
    eto24Mm: number | null; lluvia24Mm: number | null; probMaxPct: number | null; lluviaEfectivaMm: number | null; netaMm: number | null;
}

export interface DemandaRiego24h {
    /** ETo prevista − lluvia efectiva prevista, en mm, agregada entre estaciones (mediana ≥3, promedio 2, única 1). */
    netaMm: number | null;
    rangoMm: { min: number; max: number } | null;
    eto24Mm: number | null;
    lluviaEfectivaMm: number | null;
    lluvia24Mm: number | null;
    probMaxPct: number | null;
    estacionesUsadas: number;
    estacionesTotal: number;
    excluidas: string[];
    porEstacion: DemandaEstacion[];
    horas: PuntoHora24[];
    /** Horas de las próximas 24 con viento ≤ VIENTO_VENTANA_MS y sin lluvia probable; null si no hay viento prevista. */
    ventanaLibreHoras: number | null;
    corridaEn: string | null;
    edadMin: number | null;
    /** Pronóstico demasiado viejo: la cifra no se afirma. */
    viejo: boolean;
    /** Alguna estación usada tiene ETo corregido por factor de estación (difiere > 1 % del crudo). */
    etoCorregido: boolean;
}

/** ETo horario a usar: el corregido por estación si existe, si no el crudo del modelo. */
const etoDe = (h: FilaPronostico): number | null => h.eto_fc_mm_corr ?? h.eto_fc_mm;

function agrega(valores: number[]): number | null {
    if (!valores.length) return null;
    if (valores.length >= 3) { const s = [...valores].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
    return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/**
 * @param presaIds estaciones de PRESA (vaso abierto, régimen de viento propio con umbral mayor). El viento, la ráfaga y la
 *   ventana de aspersión de la tarjeta AGRO se calculan sin ellas: si no, el viento de Las Vírgenes (9 m/s) disparaba un
 *   "viento fuerte" que ninguna estación agrícola registraba. Si no queda ninguna estación agrícola en una hora, se usan todas.
 */
export function demanda24h(filas: FilaPronostico[], ahoraMs: number, excluidasIds: ReadonlySet<string> | string[] = [], presaIds: ReadonlySet<string> | string[] = []): DemandaRiego24h {
    const excl = excluidasIds instanceof Set ? excluidasIds : new Set(excluidasIds);
    const presas = presaIds instanceof Set ? presaIds : new Set(presaIds);
    const hasta = ahoraMs + 24 * 3_600_000;
    const ventana = filas.filter((f) => { const t = Date.parse(f.valido_en); return Number.isFinite(t) && t > ahoraMs && t <= hasta; });
    const porEst = new Map<string, FilaPronostico[]>();
    for (const f of ventana) { const a = porEst.get(f.estacion_id); if (a) a.push(f); else porEst.set(f.estacion_id, [f]); }

    const porEstacion: DemandaEstacion[] = [...porEst.entries()].map(([estacionId, hs]) => {
        const eto = hs.map(etoDe).filter(fin);
        const ll = hs.map((h) => h.precip_mm).filter(fin);
        const pr = hs.map((h) => h.precip_prob_pct).filter(fin);
        const probMax = pr.length ? Math.max(...pr) : null;
        const completa = eto.length >= HORAS_MIN_ESTACION;
        const eto24 = completa ? eto.reduce((a, b) => a + b, 0) : null;
        const lluvia24 = ll.length ? ll.reduce((a, b) => a + b, 0) : null;
        const cuenta = probMax != null && probMax >= PROB_LLUVIA_CUENTA_PCT && lluvia24 != null ? lluvia24 : 0;
        const pef = lluviaEfectivaMm(cuenta);
        return { estacionId, excluida: excl.has(estacionId), horasConDato: eto.length, eto24Mm: eto24, lluvia24Mm: lluvia24, probMaxPct: probMax, lluviaEfectivaMm: pef, netaMm: eto24 != null ? Math.max(0, eto24 - (pef ?? 0)) : null };
    });
    const validas = porEstacion.filter((e) => !e.excluida && e.netaMm != null);
    const netas = validas.map((e) => e.netaMm as number);
    const clavesHora = [...new Set(ventana.filter((f) => !excl.has(f.estacion_id)).map((f) => Date.parse(f.valido_en)))].sort((a, b) => a - b);
    const horas: PuntoHora24[] = clavesHora.map((t) => {
        const hs = ventana.filter((f) => Date.parse(f.valido_en) === t && !excl.has(f.estacion_id));
        const e = hs.map(etoDe).filter(fin), l = hs.map((h) => h.precip_mm).filter(fin), p = hs.map((h) => h.precip_prob_pct).filter(fin);
        const agro = hs.filter((h) => !presas.has(h.estacion_id));
        const hv = agro.length ? agro : hs;
        const tp = hs.map((h) => h.temp_c_corr ?? h.temp_c).filter(fin), v = hv.map((h) => h.viento_ms_corr ?? h.viento_ms).filter(fin);
        const rf = hv.map((h) => h.viento_rafaga_ms_corr ?? h.viento_rafaga_ms ?? null).filter(fin);
        const hu = hs.map((h) => h.hum_rel_pct ?? null).filter(fin), nb = hs.map((h) => h.nubosidad_total_pct ?? null).filter(fin);
        const prom = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
        const mn = (a: number[]) => (a.length ? Math.min(...a) : null), mx = (a: number[]) => (a.length ? Math.max(...a) : null);
        return {
            t, etoMm: prom(e), lluviaMm: prom(l), probPct: mx(p), tempC: prom(tp), vientoMs: mx(v),
            tempMinC: mn(tp), tempMaxC: mx(tp), vientoMinMs: mn(v), rafagaMs: mx(rf),
            humPct: prom(hu), humMinPct: mn(hu), humMaxPct: mx(hu), nubPct: prom(nb), estaciones: hs.length,
        };
    });
    const conViento = horas.filter((h) => h.vientoMs != null);
    const ventanaLibreHoras = conViento.length ? conViento.filter((h) => (h.vientoMs as number) <= VIENTO_VENTANA_MS && (h.probPct ?? 0) < 30 && (h.lluviaMm ?? 0) <= 0.2).length : null;
    const corridas = filas.map((f) => f.corrida_en).filter((c): c is string => !!c).sort();
    const corridaEn = corridas.length ? corridas[corridas.length - 1] : null;
    const edadMin = corridaEn ? Math.max(0, (ahoraMs - Date.parse(corridaEn)) / 60000) : null;
    const viejo = edadMin != null && edadMin > EDAD_MAX_PRONOSTICO_MIN;
    return {
        netaMm: viejo ? null : agrega(netas),
        rangoMm: !viejo && netas.length ? { min: Math.min(...netas), max: Math.max(...netas) } : null,
        eto24Mm: viejo ? null : agrega(validas.map((e) => e.eto24Mm as number)),
        lluviaEfectivaMm: viejo ? null : agrega(validas.map((e) => e.lluviaEfectivaMm).filter(fin)), // sin dato (null) no entra como 0 mm
        lluvia24Mm: agrega(validas.map((e) => e.lluvia24Mm).filter(fin)),
        probMaxPct: validas.length ? Math.max(0, ...validas.map((e) => e.probMaxPct ?? 0)) : null,
        estacionesUsadas: validas.length, estacionesTotal: porEst.size,
        excluidas: porEstacion.filter((e) => e.excluida).map((e) => e.estacionId),
        porEstacion, horas, ventanaLibreHoras, corridaEn, edadMin, viejo,
        etoCorregido: ventana.some((f) => !excl.has(f.estacion_id) && f.eto_fc_mm != null && f.eto_fc_mm_corr != null
            && Math.abs(f.eto_fc_mm_corr - f.eto_fc_mm) > Math.max(0.001, f.eto_fc_mm * 0.01)),
    };
}

/** Umbrales operativos (mm de lámina neta por día). PROVISIONALES: <2 baja, 2–5 media, >5 alta. */
export function estadoDemanda24h(d: DemandaRiego24h | null): { tipo: 'ok' | 'info' | 'warn' | 'sd'; texto: string } {
    if (!d || d.estacionesTotal === 0) return { tipo: 'sd', texto: 'S/D' };
    if (d.viejo) return { tipo: 'sd', texto: 'Pronóstico viejo' };
    if (d.netaMm == null) return { tipo: 'sd', texto: 'S/D' };
    return d.netaMm < 2 ? { tipo: 'ok', texto: 'Baja' } : d.netaMm <= 5 ? { tipo: 'info', texto: 'Media' } : { tipo: 'warn', texto: 'Alta' };
}
