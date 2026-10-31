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
