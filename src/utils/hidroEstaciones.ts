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
export const ORDEN_ESTACIONES = ['C6300760', 'C63009B2', 'C6301416', 'C6301AC4', 'IBWC-08373000'] as const;

/** Id de la estación oficial USIBWC en Ojinaga (mismo sitio que la Sutron C6300760; ingesta ibwc-telemetry-sync). */
export const ID_OJINAGA_SUTRON = 'C6300760';
export const ID_OJINAGA_IBWC = 'IBWC-08373000';
/** Estaciones que no vienen del monitor Sutron/GOES (sin "DCP", sin señal en dBm). */
export const esFuenteIbwc = (id: string) => id.startsWith('IBWC-');

/** Slots 1-5 del categórico (1-4 validados: dataviz, modo oscuro, adyacentes ΔE CVD ≥ 8.4; 5.º violeta, junto al azul de Ojinaga Sutron). */
export const COLOR_SERIE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#a06ee1'] as const;

export function colorEstacion(id: string): string {
    const i = ORDEN_ESTACIONES.indexOf(id as typeof ORDEN_ESTACIONES[number]);
    return COLOR_SERIE[i >= 0 ? i : 0];
}

/** Frescura: mensaje bueno de hace más de 3 h = sin transmisión. Los DCP transmiten cada hora. */
export const STALE_GOES_MIN = 180;
/** Por encima de esto (pero dentro de STALE) se avisa retraso. */
export const RETRASO_GOES_MIN = 90;
/** Estaciones USIBWC: se guarda 1 lectura cada 2 h y el archivo publica con ~40 min de retraso → el último dato tiene 0.7-4 h. */
export const STALE_IBWC_MIN = 300;
export const RETRASO_IBWC_MIN = 200;
export const staleMin = (id?: string) => (id && esFuenteIbwc(id) ? STALE_IBWC_MIN : STALE_GOES_MIN);
/** Máximo hueco que se une con línea al dibujar: Sutron 45 min; USIBWC guarda cada 2 h, se une hasta 4 h 30 min (tolera una lectura faltante). */
export const MAX_PUENTE_IBWC_MIN = 270;
export const puenteMin = (id: string, baseMin: number) => (esFuenteIbwc(id) ? Math.max(baseMin, MAX_PUENTE_IBWC_MIN) : baseMin);
export const retrasoMin = (id?: string) => (id && esFuenteIbwc(id) ? RETRASO_IBWC_MIN : RETRASO_GOES_MIN);

export type ClaveEnlace = 'en_linea' | 'retraso' | 'sin_transmision' | 'sd';

export interface EstadoEnlace { clave: ClaveEnlace; etiqueta: string; edadMin: number | null }

export function edadMin(ahoraMs: number, ultMs: number | null): number | null {
    if (ultMs == null || !Number.isFinite(ultMs) || !ahoraMs) return null;
    return Math.max(0, (ahoraMs - ultMs) / 60000);
}

export function estadoEnlace(ultimoBuenoMs: number | null, ahoraMs: number, id?: string): EstadoEnlace {
    const edad = edadMin(ahoraMs, ultimoBuenoMs);
    if (edad == null) return { clave: 'sd', etiqueta: ahoraMs ? 'Sin mensajes' : 'Calculando', edadMin: null };
    if (edad > staleMin(id)) return { clave: 'sin_transmision', etiqueta: 'Sin transmisión', edadMin: edad };
    if (edad > retrasoMin(id)) return { clave: 'retraso', etiqueta: 'Con retraso', edadMin: edad };
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

export interface EstadiaEnlace {
    /** Instante en que empezó el estado actual: primer mensaje bueno de la racha (en línea/retraso) o último bueno (sin transmisión). */
    desdeMs: number | null;
    /** Minutos transcurridos desde `desdeMs`; null sin base. */
    duracionMin: number | null;
    /** La racha llega al borde de los mensajes cargados: la duración real es MAYOR (se muestra "≥"). */
    acotada: boolean;
}

/**
 * Tiempo de estadía en el estado actual del enlace. En línea/retraso: racha continua de mensajes buenos ('G'), que se rompe
 * si dos consecutivos se separan más de STALE_GOES_MIN. Sin transmisión: desde el último bueno. Los mensajes con falla no cuentan.
 * `ventanaDesdeMs` = inicio de los mensajes cargados (para saber si la racha está acotada).
 */
export function estadiaEnlace(mensajes: MensajeHidro[], estacionId: string, ahoraMs: number, ventanaDesdeMs: number | null = null): EstadiaEnlace {
    const buenos = mensajes
        .filter(m => m.estacion_id === estacionId && m.codigo_falla === 'G')
        .map(m => Date.parse(m.ts_msg)).filter(Number.isFinite).sort((a, b) => b - a);
    if (!buenos.length || !ahoraMs) return { desdeMs: null, duracionMin: null, acotada: false };
    const ultimo = buenos[0];
    if ((ahoraMs - ultimo) / 60000 > STALE_GOES_MIN) return { desdeMs: ultimo, duracionMin: Math.max(0, (ahoraMs - ultimo) / 60000), acotada: false };
    let ini = ultimo;
    let cortada = false;
    for (let i = 1; i < buenos.length; i++) {
        if ((ini - buenos[i]) / 60000 > STALE_GOES_MIN) { cortada = true; break; }
        ini = buenos[i];
    }
    // Sin hueco que la corte: si el primer bueno está pegado al borde de la ventana, la racha podría seguir hacia atrás.
    const acotada = !cortada && (ventanaDesdeMs == null || (ini - ventanaDesdeMs) / 60000 <= STALE_GOES_MIN);
    return { desdeMs: ini, duracionMin: Math.max(0, (ahoraMs - ini) / 60000), acotada };
}

export interface UltimoConocido { v: number; t: number; edadMin: number }

/** Último punto de una serie con su edad. Serie vacía → null (nunca 0); un 0 real se conserva. */
export function ultimoConocido(serie: PuntoHidro[], ahoraMs: number): UltimoConocido | null {
    const p = ultimoPunto(serie);
    if (!p || !ahoraMs) return null;
    return { v: p.v, t: p.t, edadMin: Math.max(0, (ahoraMs - p.t) / 60000) };
}

/** Duración compacta sin "hace": "35 min", "3 h 20 min", "2 d 4 h". */
export function textoDuracion(min: number | null): string {
    if (min == null) return 'S/D';
    if (min < 1) return '<1 min';
    if (min < 60) return `${Math.round(min)} min`;
    if (min < 1440) { const h = Math.floor(min / 60); const m = Math.round(min - h * 60); return m ? `${h} h ${m} min` : `${h} h`; }
    const d = Math.floor(min / 1440); const h = Math.floor((min - d * 1440) / 60);
    return h ? `${d} d ${h} h` : `${d} d`;
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
    '24h': { etiqueta: '24 h', horas: 24, pasoMin: 5 },
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
export function puentearHuecos(filas: FilaGrafica[], ids: string[], maxMin: number | ((id: string) => number)): FilaGrafica[] {
    const salida = filas.map(f => ({ ...f }));
    for (const id of ids) {
        const maxMs = (typeof maxMin === 'function' ? maxMin(id) : maxMin) * 60000;
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

/** Cambio entre el último punto y el más cercano a `horas` antes (tolerancia ±`tolFrac` de la antigüedad, 40 % por defecto). null si no hay base. */
export function tendencia(serie: PuntoHidro[], horas: number, epsilon: number, tolFrac = 0.4): Tendencia | null {
    const fin = ultimoPunto(serie);
    if (!fin) return null;
    const objetivo = fin.t - horas * 3600000;
    const tol = horas * 3600000 * tolFrac;
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

/**
 * Babisas nunca reporta gasto entre 0 y ~15 m³/s (mínimo positivo observado 15.42, p05 17.6; 73 % de lecturas en 0, nivel sin relación
 * con el gasto): el 0 es un dato CENSURADO («por debajo del umbral de medición del sensor»), no un caudal nulo. Valor = umbral, m³/s.
 */
export const GASTO_UMBRAL_CENSURA_M3S: Record<string, number> = { C6301416: 15 };

/** Texto del gasto censurado: «< 15 m³/s» (el 0 de la estación no se presenta como caudal). */
export const textoBajoUmbral = (estacionId: string): string => `< ${GASTO_UMBRAL_CENSURA_M3S[estacionId] ?? 0}`;

export function ceroSospechoso(estacionId: string, gasto: number | null, nivel: number | null): boolean {
    const umbral = CERO_SOSPECHOSO_NIVEL_M[estacionId];
    return umbral != null && gasto === 0 && nivel != null && nivel >= umbral;
}

/** Madero (C6301AC4) reporta radiación fija 889-907 W/m²: canal no confiable. */
export const SIN_RADIACION = new Set(['C6301AC4']);
/** Ojinaga es estación de río: solo nivel, gasto y velocidad. */
export const SIN_METEO = new Set(['C6300760', 'IBWC-08373000']);

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

export type GrupoHidro = 'PRE-001' | 'PRE-002' | 'san_pedro' | 'rio';

/**
 * Agrupación para las tarjetas. Boca del Río (PRE-001) y Madero–Vírgenes (PRE-002) son ENTRADAS a su presa; Babisas
 * (rol 'rio_san_pedro', nombre histórico de la clave) es estación de RÍO sobre el CONCHOS a la salida del distrito: el plano digital de ríos
 * la ubica aguas abajo de las confluencias del San Pedro y del Chuvíscar, antes de la presa Luis L. León (El Granero). Ojinaga es río.
 */
export function grupoDeEstacion(e: Pick<EstacionHidro, 'presa_id'> & { rol?: string | null }): GrupoHidro {
    if (e.rol === 'rio_san_pedro') return 'san_pedro';
    return e.presa_id === 'PRE-001' ? 'PRE-001' : e.presa_id === 'PRE-002' ? 'PRE-002' : 'rio';
}

export const TITULO_GRUPO: Record<GrupoHidro, string> = {
    'PRE-001': 'La Boquilla',
    'PRE-002': 'Francisco I. Madero',
    san_pedro: 'Río Conchos · salida del distrito',
    rio: 'Río Conchos',
};

/** Estación que mide lo que ENTRA a una presa (aportación), no lo que sale de ella. */
export const esEntradaPresa = (e: { rol?: string | null }): boolean => e.rol === 'entrada';
