// ═══════════════════════════════════════════════════════════════════════════
// Pronóstico de la cuenca del Conchos: consenso entre modelos y confiabilidad medida — puro
// ---------------------------------------------------------------------------
// Fuente TERCERA y provisional: Open-Meteo con 3 modelos (ECMWF, GFS, ICON) en las coordenadas de cada estación. El consenso es la MEDIANA de los
// modelos; el desacuerdo (mínimo–máximo) se muestra siempre junto al valor: con pocos puntos y lluvia convectiva el número solo engaña.
// La confiabilidad sale de fn_cuenca_verificacion (pronóstico de víspera contra lo que midió JCAS); con pocos días se rotula "en construcción".
// ═══════════════════════════════════════════════════════════════════════════

export interface FilaPronostico {
    punto_id: string; modelo: string; fecha: string;
    precip_mm: number | null; temp_media_c: number | null; hum_media_pct: number | null; viento_medio_kmh: number | null;
    /** Grados desde donde sopla el viento (0 = norte); null = S/D. */
    viento_dir_deg?: number | null;
    /** Extremos diarios del modelo (temperature_2m_max/min); null = S/D. */
    temp_max_c?: number | null; temp_min_c?: number | null;
}

export interface DiaConsenso {
    fecha: string;
    mm: number | null; mmMin: number | null; mmMax: number | null;
    /** % de modelos que dan ≥ 1 mm. */
    probPct: number | null;
    temp: number | null; hum: number | null; viento: number | null;
    /** Dirección del viento (grados desde donde sopla) como media circular de los modelos; null si no hay o los modelos se contradicen. */
    dirDeg?: number | null;
    /** Máxima y mínima del día: mediana de los modelos; null = S/D. */
    tMax?: number | null; tMin?: number | null;
    nModelos: number;
}

export const UMBRAL_LLUVIA_MM = 1;
export const MIN_COBERTURA_DIAS = 0.8;
/** Con menos de este total de pares día-estación la confiabilidad es "en construcción": no se afirma un acierto. */
export const MIN_PARES_CONFIABILIDAD = 60;

const mediana = (v: number[]): number | null => {
    if (!v.length) return null;
    const a = [...v].sort((x, y) => x - y), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
/**
 * Media CIRCULAR de direcciones (grados), opcionalmente ponderada. 350° y 10° dan 0°, no 180°. Si los vectores casi se anulan (resultante < 0.25)
 * la dirección no es representativa y devuelve null (S/D): un promedio de vientos contrarios no es un viento.
 */
export function mediaCircular(dirs: { deg: number; peso?: number }[]): number | null {
    const v = dirs.filter((d) => Number.isFinite(d.deg));
    if (!v.length) return null;
    let sx = 0, sy = 0, sw = 0;
    for (const d of v) { const w = d.peso ?? 1, r = (d.deg * Math.PI) / 180; sx += Math.sin(r) * w; sy += Math.cos(r) * w; sw += w; }
    if (sw <= 0 || Math.hypot(sx, sy) / sw < 0.25) return null;
    return Math.round(((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360);
}
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
const validos = (v: (number | null)[]) => v.filter((x): x is number => x != null && Number.isFinite(x));

/** Consenso por día de UN punto, desde `desde` (YYYY-MM-DD) en adelante; las filas deben ser la corrida vigente de cada modelo. */
export function consensoPorPunto(filas: FilaPronostico[], puntoId: string, desde: string): DiaConsenso[] {
    const porFecha = new Map<string, FilaPronostico[]>();
    for (const f of filas) {
        if (f.punto_id !== puntoId || f.fecha < desde) continue;
        porFecha.set(f.fecha, [...(porFecha.get(f.fecha) ?? []), f]);
    }
    return [...porFecha.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, fs]) => {
        const mm = validos(fs.map((x) => x.precip_mm));
        return {
            fecha,
            mm: r1(mediana(mm)), mmMin: mm.length ? r1(Math.min(...mm)) : null, mmMax: mm.length ? r1(Math.max(...mm)) : null,
            probPct: mm.length ? Math.round((mm.filter((x) => x >= UMBRAL_LLUVIA_MM).length / mm.length) * 100) : null,
            temp: r1(mediana(validos(fs.map((x) => x.temp_media_c)))),
            tMax: r1(mediana(validos(fs.map((x) => x.temp_max_c ?? null)))),
            tMin: r1(mediana(validos(fs.map((x) => x.temp_min_c ?? null)))),
            hum: r1(mediana(validos(fs.map((x) => x.hum_media_pct)))),
            viento: r1(mediana(validos(fs.map((x) => x.viento_medio_kmh)))),
            dirDeg: mediaCircular(fs.filter((x) => x.viento_dir_deg != null).map((x) => ({ deg: x.viento_dir_deg as number }))),
            nModelos: new Set(fs.map((x) => x.modelo)).size,
        };
    });
}

export type VariableValor = 'lluvia' | 'temperatura' | 'viento' | 'humedad';

/**
 * Valor de un periodo de `n` días que empieza en `desde`: lluvia = suma de la mediana diaria (exige los n días); temperatura, viento y humedad =
 * media (exige ≥ 80 % de los días). null = S/D (nunca 0).
 */
export function valorPronosticoPeriodo(dias: DiaConsenso[], variable: VariableValor, desde: string, n: number): { valor: number | null; min: number | null; max: number | null } {
    const fin = new Date(Date.parse(`${desde}T00:00:00Z`) + (n - 1) * 86_400_000).toISOString().slice(0, 10);
    const sel = dias.filter((d) => d.fecha >= desde && d.fecha <= fin);
    const get = (d: DiaConsenso) => (variable === 'lluvia' ? d.mm : variable === 'temperatura' ? d.temp : variable === 'viento' ? d.viento : d.hum);
    const vals = validos(sel.map(get));
    if (variable === 'lluvia') {
        if (vals.length < n) return { valor: null, min: null, max: null };
        const suma = (xs: (number | null)[]) => (xs.some((x) => x == null) ? null : (xs as number[]).reduce((a, b) => a + b, 0));
        return {
            valor: r1(suma(sel.map((d) => d.mm))), min: r1(suma(sel.map((d) => d.mmMin))), max: r1(suma(sel.map((d) => d.mmMax))),
        };
    }
    if (vals.length < Math.ceil(n * MIN_COBERTURA_DIAS)) return { valor: null, min: null, max: null };
    return { valor: r1(vals.reduce((a, b) => a + b, 0) / vals.length), min: null, max: null };
}

export interface FilaVerificacion {
    punto_id: string; nombre: string; n_dias: number; aciertos: number; omisiones: number; falsas_alarmas: number; correctos_negativos: number;
    pod: number | null; far: number | null; brier: number | null; mm_fc_medio: number | null; mm_obs_medio: number | null;
    n_temp: number; temp_mae: number | null; temp_sesgo: number | null; n_viento: number; viento_mae: number | null; viento_sesgo: number | null;
}

export interface Confiabilidad {
    estado: 'construccion' | 'medida';
    paresLluvia: number;
    /** Aciertos de la categoría "llovió ≥ 1 mm". */
    pod: number | null; far: number | null;
    paresTemp: number; tempMae: number | null; tempSesgo: number | null;
    paresViento: number; vientoMae: number | null; vientoSesgo: number | null;
    texto: string;
}

const ponderado = (filas: FilaVerificacion[], n: (f: FilaVerificacion) => number, v: (f: FilaVerificacion) => number | null): number | null => {
    let s = 0, w = 0;
    for (const f of filas) { const x = v(f), k = n(f); if (x != null && k > 0) { s += x * k; w += k; } }
    return w ? Math.round((s / w) * 100) / 100 : null;
};

export function resumenConfiabilidad(filas: FilaVerificacion[]): Confiabilidad {
    const pares = filas.reduce((a, f) => a + f.n_dias, 0);
    const ac = filas.reduce((a, f) => a + f.aciertos, 0), om = filas.reduce((a, f) => a + f.omisiones, 0), fa = filas.reduce((a, f) => a + f.falsas_alarmas, 0);
    const base = {
        paresLluvia: pares,
        pod: ac + om > 0 ? Math.round((ac / (ac + om)) * 1000) / 1000 : null,
        far: ac + fa > 0 ? Math.round((fa / (ac + fa)) * 1000) / 1000 : null,
        paresTemp: filas.reduce((a, f) => a + f.n_temp, 0), tempMae: ponderado(filas, (f) => f.n_temp, (f) => f.temp_mae), tempSesgo: ponderado(filas, (f) => f.n_temp, (f) => f.temp_sesgo),
        paresViento: filas.reduce((a, f) => a + f.n_viento, 0), vientoMae: ponderado(filas, (f) => f.n_viento, (f) => f.viento_mae), vientoSesgo: ponderado(filas, (f) => f.n_viento, (f) => f.viento_sesgo),
    };
    if (pares < MIN_PARES_CONFIABILIDAD) {
        return { ...base, estado: 'construccion', texto: `En construcción: ${pares} día${pares === 1 ? '' : 's'}-estación comparados (se necesitan ${MIN_PARES_CONFIABILIDAD}). Todavía no se puede decir qué tan bien acierta en esta cuenca.` };
    }
    const partes = [
        base.pod != null ? `acierta ${Math.round(base.pod * 100)} % de los días con lluvia` : null,
        base.far != null ? `${Math.round(base.far * 100)} % de sus avisos de lluvia no se cumplen` : null,
        base.tempMae != null ? `error de temperatura ${base.tempMae.toFixed(1)} °C` : null,
    ].filter(Boolean);
    return { ...base, estado: 'medida', texto: `Medida con ${pares} días-estación: ${partes.join('; ')}.` };
}

/** Corrección de sesgo SOLO con ≥ 30 pares y un sesgo apreciable; devuelve el valor y si se corrigió (nunca silencioso). */
export function corrigeSesgo(valor: number | null, sesgo: number | null, pares: number, umbral: number): { valor: number | null; corregido: boolean } {
    if (valor == null) return { valor: null, corregido: false };
    if (sesgo == null || pares < 30 || Math.abs(sesgo) < umbral) return { valor, corregido: false };
    return { valor: Math.round((valor - sesgo) * 10) / 10, corregido: true };
}

/**
 * Extremos de un periodo de `n` días: máxima = la mayor de las máximas diarias (consenso), mínima = la menor de las mínimas.
 * Exige ≥ 80 % de los días con dato; null = S/D (nunca 0).
 */
export function extremosPronosticoPeriodo(dias: DiaConsenso[], desde: string, n: number): { tMax: number | null; tMin: number | null } {
    const fin = new Date(Date.parse(`${desde}T00:00:00Z`) + (n - 1) * 86_400_000).toISOString().slice(0, 10);
    const sel = dias.filter((d) => d.fecha >= desde && d.fecha <= fin);
    const min = Math.ceil(n * MIN_COBERTURA_DIAS);
    const mx = validos(sel.map((d) => d.tMax ?? null)), mn = validos(sel.map((d) => d.tMin ?? null));
    return { tMax: mx.length >= min ? Math.max(...mx) : null, tMin: mn.length >= min ? Math.min(...mn) : null };
}

/** Dirección del viento de un periodo (media circular de los días, ponderada por la velocidad). null = S/D. */
export function direccionPronosticoPeriodo(dias: DiaConsenso[], desde: string, n: number): number | null {
    const fin = new Date(Date.parse(`${desde}T00:00:00Z`) + (n - 1) * 86_400_000).toISOString().slice(0, 10);
    const sel = dias.filter((d) => d.fecha >= desde && d.fecha <= fin && d.dirDeg != null);
    if (sel.length < Math.ceil(n * MIN_COBERTURA_DIAS)) return null;
    return mediaCircular(sel.map((d) => ({ deg: d.dirDeg as number, peso: Math.max(d.viento ?? 0, 0.1) })));
}
