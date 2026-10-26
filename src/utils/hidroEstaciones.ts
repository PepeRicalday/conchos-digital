/**
 * hidroEstaciones — utilidades PURAS de las estaciones hidrométricas GOES (telemetría satelital DCP).
 * Sin React ni red: frescura, agregación, tendencia y formato "S/D nunca cero".
 */

export type VariableHidro =
    | 'nivel_m' | 'gasto_m3s' | 'velocidad_ms' | 'temp_c' | 'viento_ms' | 'viento_dir_deg'
    | 'hr_pct' | 'presion_hpa' | 'rad_wm2';
// `pa_sin_confirmar` existe en BD pero su significado se desconoce: nunca se consulta ni se muestra.

export interface PuntoHidro { t: number; v: number }

export interface EstacionHidro {
    id: string;
    nombre: string;
    presa_id: string | null;
    rol: string | null;
    latitud: number | null;
    longitud: number | null;
    intervalo_min: number | null;
    activa: boolean;
    ult_sync_en: string | null;
    ult_dato_en: string | null;
}

export interface MensajeHidro { estacion_id: string; ts_msg: string; codigo_falla: string | null; senal_dbm: number | null }

/** Orden fijo = color por entidad (la estación conserva su color aunque cambie la selección). */
export const ORDEN_ESTACIONES = ['C6300760', 'C63009B2', 'C6301416', 'C6301AC4'] as const;

/** Slots 1-4 del categórico validado (dataviz, modo oscuro, adyacentes ΔE CVD ≥ 8.4). */
export const COLOR_SERIE = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const;

export function colorEstacion(id: string): string {
    const i = ORDEN_ESTACIONES.indexOf(id as typeof ORDEN_ESTACIONES[number]);
    return COLOR_SERIE[i >= 0 ? i : 0];
}

/** Frescura: mensaje bueno de hace más de 3 h = sin transmisión. Los DCP transmiten cada hora. */
export const STALE_GOES_MIN = 180;
/** Por encima de esto (pero dentro de STALE) se avisa retraso. */
export const RETRASO_GOES_MIN = 90;

export type ClaveEnlace = 'en_linea' | 'retraso' | 'sin_transmision' | 'sd';

export interface EstadoEnlace { clave: ClaveEnlace; etiqueta: string; edadMin: number | null }

export function edadMin(ahoraMs: number, ultMs: number | null): number | null {
    if (ultMs == null || !Number.isFinite(ultMs) || !ahoraMs) return null;
    return Math.max(0, (ahoraMs - ultMs) / 60000);
}

export function estadoEnlace(ultimoBuenoMs: number | null, ahoraMs: number): EstadoEnlace {
    const edad = edadMin(ahoraMs, ultimoBuenoMs);
    if (edad == null) return { clave: 'sd', etiqueta: ahoraMs ? 'Sin mensajes' : 'Calculando', edadMin: null };
    if (edad > STALE_GOES_MIN) return { clave: 'sin_transmision', etiqueta: 'Sin transmisión', edadMin: edad };
    if (edad > RETRASO_GOES_MIN) return { clave: 'retraso', etiqueta: 'Con retraso', edadMin: edad };
    return { clave: 'en_linea', etiqueta: 'En línea', edadMin: edad };
}

/** "hace 12 min", "hace 2 h 10 min", "hace 3 d". */
export function textoEdad(min: number | null): string {
    if (min == null) return 'S/D';
    if (min < 1) return 'ahora';
    if (min < 60) return `hace ${Math.round(min)} min`;
    if (min < 1440) {
        const h = Math.floor(min / 60);
        const m = Math.round(min - h * 60);
        return m ? `hace ${h} h ${m} min` : `hace ${h} h`;
    }
    return `hace ${Math.floor(min / 1440)} d`;
}

/** Último mensaje bueno ('G') por estación, en ms. */
export function ultimoBueno(mensajes: MensajeHidro[], estacionId: string): number | null {
    let max: number | null = null;
    for (const m of mensajes) {
        if (m.estacion_id !== estacionId || m.codigo_falla !== 'G') continue;
        const t = Date.parse(m.ts_msg);
        if (Number.isFinite(t) && (max == null || t > max)) max = t;
    }
    return max;
}

export interface SaludEnlace {
    estacion_id: string;
    buenos: number;
    conFalla: number;
    total: number;
    /** % de mensajes buenos; null si no hubo mensajes. */
    pctBuenos: number | null;
    senalDbm: number | null;
    ultimoMsMs: number | null;
}

/** Salud del enlace en una ventana: mensajes buenos vs con falla y señal media/última. */
export function saludEnlace(mensajes: MensajeHidro[], estacionId: string, desdeMs: number): SaludEnlace {
    let buenos = 0;
    let conFalla = 0;
    let ultimo: MensajeHidro | null = null;
    let ultimoT = -Infinity;
    for (const m of mensajes) {
        if (m.estacion_id !== estacionId) continue;
        const t = Date.parse(m.ts_msg);
        if (!Number.isFinite(t) || t < desdeMs) continue;
        if (m.codigo_falla === 'G') buenos++; else conFalla++;
        if (t > ultimoT) { ultimoT = t; ultimo = m; }
    }
    const total = buenos + conFalla;
    return {
        estacion_id: estacionId, buenos, conFalla, total,
        pctBuenos: total ? (buenos / total) * 100 : null,
        senalDbm: ultimo?.senal_dbm ?? null,
        ultimoMsMs: ultimo ? ultimoT : null,
    };
}

export type CeldaEnlace = 'bueno' | 'falla' | 'sin';

/** Una celda por hora (la más antigua primero): bueno si hubo mensaje 'G'; falla si solo hubo mensajes con falla; sin si no llegó ninguno. */
export function tiraEnlace(mensajes: MensajeHidro[], estacionId: string, ahoraMs: number, horas = 24): CeldaEnlace[] {
    const celdas: CeldaEnlace[] = Array.from({ length: horas }, () => 'sin');
    if (!ahoraMs) return celdas;
    const HORA = 3600000;
    const ini = ahoraMs - horas * HORA;
    for (const m of mensajes) {
        if (m.estacion_id !== estacionId) continue;
        const t = Date.parse(m.ts_msg);
        if (!Number.isFinite(t) || t < ini || t > ahoraMs) continue;
        const i = Math.min(horas - 1, Math.floor((t - ini) / HORA));
        if (m.codigo_falla === 'G') celdas[i] = 'bueno';
        else if (celdas[i] === 'sin') celdas[i] = 'falla';
    }
    return celdas;
}

// ── Series ──────────────────────────────────────────────────────────────────────

export type VentanaHidro = '24h' | '7d' | '30d';

export const VENTANAS: Record<VentanaHidro, { etiqueta: string; horas: number; pasoMin: number }> = {
    '24h': { etiqueta: '24 h', horas: 24, pasoMin: 15 },
    '7d': { etiqueta: '7 días', horas: 24 * 7, pasoMin: 30 },
    '30d': { etiqueta: '30 días', horas: 24 * 30, pasoMin: 60 },
};

/** Promedia por cubetas alineadas a múltiplos absolutos de `pasoMin` (todas las estaciones comparten rejilla). Cubeta vacía = sin punto. */
export function agregarSerie(puntos: PuntoHidro[], pasoMin: number): PuntoHidro[] {
    const paso = pasoMin * 60000;
    const acc = new Map<number, { s: number; n: number }>();
    for (const p of puntos) {
        if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
        const k = Math.floor(p.t / paso) * paso;
        const a = acc.get(k);
        if (a) { a.s += p.v; a.n++; } else acc.set(k, { s: p.v, n: 1 });
    }
    return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([t, a]) => ({ t, v: a.s / a.n }));
}

export type FilaGrafica = { t: number } & Record<string, number | null>;

/** Rejilla regular desde `desdeMs` hasta `hastaMs`; el hueco queda null (nunca 0) para que la línea se corte. */
export function fusionarSeries(series: Record<string, PuntoHidro[]>, pasoMin: number, desdeMs: number, hastaMs: number): FilaGrafica[] {
    const paso = pasoMin * 60000;
    const ini = Math.floor(desdeMs / paso) * paso;
    const ids = Object.keys(series);
    const mapas = ids.map(id => new Map(series[id].map(p => [p.t, p.v])));
    const filas: FilaGrafica[] = [];
    for (let t = ini; t <= hastaMs; t += paso) {
        const fila: FilaGrafica = { t };
        ids.forEach((id, i) => { fila[id] = mapas[i].get(t) ?? null; });
        filas.push(fila);
    }
    return filas;
}

/** Los DCP entregan 3-4 lecturas por hora (suele faltar la de :30): un hueco corto es cadencia normal, no ausencia.
 *  Para DIBUJAR se unen los vecinos reales con una recta si los separa ≤ `maxMin`; más allá la línea se corta.
 *  Solo afecta al trazo: el tooltip y las cifras usan las filas crudas (ahí el hueco sigue siendo S/D). */
export function puentearHuecos(filas: FilaGrafica[], ids: string[], maxMin: number): FilaGrafica[] {
    const salida = filas.map(f => ({ ...f }));
    const maxMs = maxMin * 60000;
    for (const id of ids) {
        let prev = -1;
        for (let i = 0; i < filas.length; i++) {
            if (filas[i][id] == null) continue;
            if (prev >= 0 && i - prev > 1 && filas[i].t - filas[prev].t <= maxMs) {
                const v0 = filas[prev][id] as number;
                const v1 = filas[i][id] as number;
                for (let k = prev + 1; k < i; k++) salida[k][id] = v0 + ((v1 - v0) * (filas[k].t - filas[prev].t)) / (filas[i].t - filas[prev].t);
            }
            prev = i;
        }
    }
    return salida;
}

export function ultimoPunto(serie: PuntoHidro[]): PuntoHidro | null {
    return serie.length ? serie[serie.length - 1] : null;
}

export interface Tendencia { delta: number; horas: number; dir: 'sube' | 'baja' | 'estable' }

/** Cambio entre el último punto y el más cercano a `horas` antes (tolerancia ±40 % del salto). null si no hay base. */
export function tendencia(serie: PuntoHidro[], horas: number, epsilon: number): Tendencia | null {
    const fin = ultimoPunto(serie);
    if (!fin) return null;
    const objetivo = fin.t - horas * 3600000;
    const tol = horas * 3600000 * 0.4;
    let mejor: PuntoHidro | null = null;
    for (const p of serie) {
        if (p.t >= fin.t) continue;
        if (Math.abs(p.t - objetivo) <= tol && (mejor == null || Math.abs(p.t - objetivo) < Math.abs(mejor.t - objetivo))) mejor = p;
    }
    if (!mejor) return null;
    const delta = fin.v - mejor.v;
    return { delta, horas, dir: Math.abs(delta) < epsilon ? 'estable' : delta > 0 ? 'sube' : 'baja' };
}

// ── Formato y reglas de veracidad ──────────────────────────────────────────────

/** "S/D" para null/NaN; el 0 real se escribe "0.00". */
export function fmt(v: number | null | undefined, dec = 2): string {
    if (v == null || !Number.isFinite(v)) return 'S/D';
    return v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtDelta(v: number | null | undefined, dec = 2): string {
    if (v == null || !Number.isFinite(v)) return 'S/D';
    const s = Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${s}`;
}

/**
 * Babisas reporta gasto 0.00 en ~72 % de las lecturas aun con nivel 5.7-6.75 m (probable corte de la curva de gasto del
 * sensor; sin confirmar). Solo se marca donde está observado; el valor se muestra tal cual lo reporta la estación.
 */
export const CERO_SOSPECHOSO_NIVEL_M: Record<string, number> = { C6301416: 5.7 };

export function ceroSospechoso(estacionId: string, gasto: number | null, nivel: number | null): boolean {
    const umbral = CERO_SOSPECHOSO_NIVEL_M[estacionId];
    return umbral != null && gasto === 0 && nivel != null && nivel >= umbral;
}

/** Madero (C6301AC4) reporta radiación fija 889-907 W/m²: canal no confiable. */
export const SIN_RADIACION = new Set(['C6301AC4']);
/** Ojinaga es estación de río: solo nivel, gasto y velocidad. */
export const SIN_METEO = new Set(['C6300760']);

export const tieneMeteo = (id: string) => !SIN_METEO.has(id);
export const radiacionConfiable = (id: string) => !SIN_RADIACION.has(id);

const PUNTOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
/** Grados (de dónde viene el viento) → punto cardinal en español. */
export function puntoCardinal(deg: number | null | undefined): string {
    if (deg == null || !Number.isFinite(deg)) return 'S/D';
    return PUNTOS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Etiqueta de zona horaria fija de SICA. */
export const TZ_SICA = 'America/Chihuahua';

export function horaLocal(ms: number | string | null | undefined): string {
    if (ms == null) return 'S/D';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return 'S/D';
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ_SICA });
}

export function fechaHoraLocal(ms: number | string | null | undefined): string {
    if (ms == null) return 'S/D';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return 'S/D';
    const f = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: TZ_SICA }).replace('.', '');
    return `${f} ${horaLocal(ms)}`;
}

/** Rótulo de eje X: hora en 24 h; con ventanas largas, día + mes. */
export function rotuloEje(ms: number, ventana: VentanaHidro): string {
    if (ventana === '24h') return horaLocal(ms);
    return new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: TZ_SICA }).replace('.', '');
}

/** Agrupación por presa para las tarjetas. */
export function grupoDeEstacion(e: Pick<EstacionHidro, 'presa_id'>): 'PRE-001' | 'PRE-002' | 'rio' {
    return e.presa_id === 'PRE-001' ? 'PRE-001' : e.presa_id === 'PRE-002' ? 'PRE-002' : 'rio';
}

export const TITULO_GRUPO: Record<'PRE-001' | 'PRE-002' | 'rio', string> = {
    'PRE-001': 'La Boquilla',
    'PRE-002': 'Francisco I. Madero',
    rio: 'Río Conchos',
};
