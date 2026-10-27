/**
 * informeGoesDatos — convierte series crudas de las estaciones GOES en los DATOS del informe (puro: sin React ni red).
 * Usa la estadística de hidroEstadistica.ts componiéndola sobre un rango arbitrario [desde, hasta] (el informe admite fechas
 * personalizadas, la pantalla solo ventanas). Regla rectora: sin dato = null → "S/D", nunca 0; los textos de "lectura en
 * palabras" salen de los números por funciones puras.
 */
import {
    COBERTURA_MIN_CONFIABLE, EPSILON_GASTO_M3S, LATENCIA_COBERTURA_MIN, MAX_HUECO_VOLUMEN_MIN, EPSILON_NIVEL_M, comparaPresaRio, cobertura, enVentana, pendientePorDia, resumenEstacion,
    gastoCensurado, sinCerosSospechosos, variacion, volumenMm3,
    type Cobertura, type GastoCensurado, type ComparacionPresaRio, type ResumenEstacion, type Variacion, type Volumen,
} from './hidroEstadistica';
import {
    CERO_SOSPECHOSO_NIVEL_M, GASTO_UMBRAL_CENSURA_M3S, ORDEN_ESTACIONES, TITULO_GRUPO, ceroSospechoso, colorEstacion, edadMin, estadoEnlace, fmt, fmtDelta, fechaHoraLocal, grupoDeEstacion,
    radiacionConfiable, saludEnlace, tieneMeteo, tiraEnlace, ultimoBueno,
    type CeldaEnlace, type EstacionHidro, type EstadoEnlace, type MensajeHidro, type PuntoHidro, type SaludEnlace, type Tendencia,
} from './hidroEstaciones';
import type { SeriesPorEstacion } from '../hooks/useHidroEstaciones';
import { rangoEfectivo, etiquetaPeriodoGoes, type ConfigInformeGoes } from './informeGoesConfig';

const HORA = 3600000;
const DIA = 24 * HORA;

export const NOMBRE_CORTO: Record<string, string> = {
    C6300760: 'Ojinaga', C63009B2: 'Boca del Río', C6301416: 'Babisas', C6301AC4: 'Madero–Vírgenes',
};

export interface PuntoBanda { t: number; v: number; min: number; max: number }
export interface UltimoValor { v: number; t: number; edadMin: number | null }

/** Promedia por cubetas de `pasoMin` conservando mínimo y máximo de cada cubeta (banda). Cubeta vacía = sin punto. */
export function agregarBanda(puntos: PuntoHidro[], pasoMin: number): PuntoBanda[] {
    const paso = pasoMin * 60000;
    const acc = new Map<number, { s: number; n: number; mn: number; mx: number }>();
    for (const p of puntos) {
        if (!Number.isFinite(p.t) || !Number.isFinite(p.v)) continue;
        const k = Math.floor(p.t / paso) * paso;
        const a = acc.get(k);
        if (a) { a.s += p.v; a.n++; a.mn = Math.min(a.mn, p.v); a.mx = Math.max(a.mx, p.v); } else acc.set(k, { s: p.v, n: 1, mn: p.v, mx: p.v });
    }
    return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([t, a]) => ({ t: t + paso / 2, v: a.s / a.n, min: a.mn, max: a.mx }));
}

/** Paso de agregación (min) para ~240 puntos en el span dado, redondeado a pasos "limpios". */
export function pasoParaSpan(spanMs: number): number {
    const crudo = spanMs / 60000 / 240;
    return [5, 10, 15, 30, 60, 120, 180, 360, 720].find((p) => p >= crudo) ?? 720;
}

export interface EstadisticaRango {
    desde: number; hasta: number;
    nivel: ResumenEstacion | null; gasto: ResumenEstacion | null; velocidad: ResumenEstacion | null;
    cobertura: Cobertura | null; volumen: Volumen | null; excluidas: number;
    /** Lecturas de gasto recibidas (con las excluidas), % excluido y si la cifra representa el periodo (≤ 50 % excluido). */
    gastoRecibidas: number; pctExcluidas: number | null; gastoRepresentativo: boolean;
    /** Media y volumen como rango cuando hay ceros censurados (Babisas: 0 = bajo el umbral del sensor); null si no aplica. */
    censurado: GastoCensurado | null;
    variacionNivel: Variacion; variacionGasto: Variacion; pendienteGastoDia: number | null;
}

/** Misma estadística que `estadisticaEstacion` pero sobre un rango arbitrario [desde, hasta]. */
export function estadisticaRango(id: string, intervaloMin: number | null, series: { nivel_m?: PuntoHidro[]; gasto_m3s?: PuntoHidro[]; velocidad_ms?: PuntoHidro[] }, desde: number, hasta: number, ahoraMs: number = hasta): EstadisticaRango {
    const nivel = enVentana(series.nivel_m, desde, hasta);
    const gastoCrudo = enVentana(series.gasto_m3s, desde, hasta);
    const { validos: gasto, excluidas, tExcluidos } = sinCerosSospechosos(id, gastoCrudo, nivel);
    const pctExcluidas = gastoCrudo.length ? (excluidas / gastoCrudo.length) * 100 : null;
    // Misma regla que la pantalla: el último mensaje llega ~30 min tarde, la cola reciente no cuenta como faltante.
    const latencia = hasta >= ahoraMs - 60000 ? LATENCIA_COBERTURA_MIN * 60000 : 0;
    return {
        desde, hasta,
        nivel: resumenEstacion(nivel), gasto: resumenEstacion(gasto), velocidad: resumenEstacion(enVentana(series.velocidad_ms, desde, hasta)),
        cobertura: nivel.length || gastoCrudo.length ? cobertura(nivel.length >= gastoCrudo.length ? nivel : gastoCrudo, intervaloMin ?? 20, desde, hasta - latencia) : null,
        // Se integra la serie cruda cortando los tramos con extremo excluido (no se puentean los ceros descartados).
        volumen: volumenMm3(gastoCrudo, desde, hasta, MAX_HUECO_VOLUMEN_MIN, tExcluidos),
        excluidas, gastoRecibidas: gastoCrudo.length, pctExcluidas, gastoRepresentativo: pctExcluidas == null || pctExcluidas <= 50,
        censurado: gastoCensurado(id, gastoCrudo, tExcluidos, desde, hasta),
        variacionNivel: variacion(enVentana(series.nivel_m, desde - 8 * DIA, hasta), EPSILON_NIVEL_M, hasta),
        variacionGasto: variacion(sinCerosSospechosos(id, enVentana(series.gasto_m3s, desde - 8 * DIA, hasta), series.nivel_m ?? []).validos, EPSILON_GASTO_M3S, hasta),
        pendienteGastoDia: pendientePorDia(gasto),
    };
}

export type DirTendencia = 'sube' | 'baja' | 'estable' | 'sd';
export const dirDe = (t: Tendencia | null): DirTendencia => (t ? t.dir : 'sd');

export interface MeteoResumen {
    temp: ResumenEstacion | null; viento: ResumenEstacion | null; hr: ResumenEstacion | null; presion: ResumenEstacion | null; rad: ResumenEstacion | null;
    /** Series agregadas (con banda mín–máx) para graficar temperatura y viento. */
    serieTemp: PuntoBanda[]; serieViento: PuntoBanda[];
    /** Lecturas fuera de rango físico descartadas (no se publican). */
    descartadas: number;
}

export interface DatosEstacionGoes {
    id: string; nombre: string; nombreCorto: string; color: string;
    grupo: 'PRE-001' | 'PRE-002' | 'rio'; grupoTitulo: string; intervaloMin: number;
    ultimoNivel: UltimoValor | null; ultimoGasto: UltimoValor | null; ultimaVelocidad: UltimoValor | null;
    /** La última lectura cruda de gasto fue un 0 sospechoso (excluido): se declara en la ficha. */
    ceroReciente: boolean;
    enlace: EstadoEnlace; salud: SaludEnlace; tira: CeldaEnlace[];
    est: EstadisticaRango;
    serieNivel: PuntoBanda[]; serieGasto: PuntoBanda[]; spark: PuntoBanda[];
    meteo: MeteoResumen | null;
    sinDatos: boolean;
}

export type SemaforoCobertura = 'ok' | 'parcial' | 'bajo' | 'sd';
export const semaforoCobertura = (pct: number | null | undefined): SemaforoCobertura => (pct == null || !Number.isFinite(pct) ? 'sd' : pct >= COBERTURA_MIN_CONFIABLE ? 'ok' : pct >= 50 ? 'parcial' : 'bajo');

export interface FilaComparacion { estacionId: string; nombre: string; c: ComparacionPresaRio }
export interface DatosComparacion { sustentable: boolean; motivo: string | null; filas: FilaComparacion[] }

export interface EntradaInformeGoes {
    config: ConfigInformeGoes;
    estaciones: EstacionHidro[];
    series: SeriesPorEstacion;
    meteo: SeriesPorEstacion;
    mensajes: MensajeHidro[];
    ahoraMs: number;
}

export interface InformeGoes {
    config: ConfigInformeGoes;
    desdeMs: number; hastaMs: number; recortado: boolean; horas: number; ahoraMs: number;
    etiquetaPeriodo: string;
    estaciones: DatosEstacionGoes[];
    comparacion: DatosComparacion;
    lectura: string[];
    notasCalidad: string[];
}

const ultimo = (s: PuntoHidro[], ahoraMs: number): UltimoValor | null => {
    const p = s.length ? s[s.length - 1] : null;
    return p ? { v: p.v, t: p.t, edadMin: edadMin(ahoraMs, p.t) } : null;
};

const dentroFisico = (v: number, min: number, max: number) => v >= min && v <= max;

function resumenMeteo(id: string, m: SeriesPorEstacion[string] | undefined, desde: number, hasta: number, pasoMin: number): MeteoResumen | null {
    if (!tieneMeteo(id) || !m) return null;
    let descartadas = 0;
    const filtra = (k: 'temp_c' | 'viento_ms' | 'hr_pct' | 'presion_hpa' | 'rad_wm2', min: number, max: number) => {
        const todas = enVentana(m[k], desde, hasta);
        const ok = todas.filter((p) => dentroFisico(p.v, min, max));
        descartadas += todas.length - ok.length;
        return ok;
    };
    const temp = filtra('temp_c', -40, 60), viento = filtra('viento_ms', 0, 80);
    return {
        temp: resumenEstacion(temp),
        viento: resumenEstacion(viento),
        serieTemp: agregarBanda(temp, pasoMin), serieViento: agregarBanda(viento, pasoMin),
        hr: resumenEstacion(filtra('hr_pct', 0, 100)),
        presion: resumenEstacion(filtra('presion_hpa', 500, 1100)),
        // La radiación de Madero no es confiable: ni se consulta ni se publica. Un negativo de ruido del sensor se descarta.
        rad: radiacionConfiable(id) ? resumenEstacion(filtra('rad_wm2', 0, 1500)) : null,
        descartadas,
    };
}

export function prepararInformeGoes(entrada: EntradaInformeGoes): InformeGoes {
    const { config, ahoraMs } = entrada;
    const r = rangoEfectivo(config.periodo, ahoraMs) ?? { desdeMs: ahoraMs - DIA, hastaMs: ahoraMs, recortado: false, horas: 24 };
    const { desdeMs, hastaMs } = r;
    const paso = pasoParaSpan(hastaMs - desdeMs);
    const ids = ORDEN_ESTACIONES.filter((id) => config.estaciones.includes(id));

    const estaciones: DatosEstacionGoes[] = ids.flatMap((id) => {
        const e = entrada.estaciones.find((x) => x.id === id);
        if (!e) return [];
        const sr = entrada.series[id] ?? {};
        const nivelTodo = enVentana(sr.nivel_m, 0, hastaMs).sort((a, b) => a.t - b.t);
        const gastoCrudoTodo = enVentana(sr.gasto_m3s, 0, hastaMs).sort((a, b) => a.t - b.t);
        const gastoTodo = sinCerosSospechosos(id, gastoCrudoTodo, nivelTodo).validos;
        const velTodo = enVentana(sr.velocidad_ms, 0, hastaMs).sort((a, b) => a.t - b.t);
        const intervalo = e.intervalo_min ?? (id === 'C6300760' ? 15 : 20);
        const est = estadisticaRango(id, intervalo, sr, desdeMs, hastaMs, ahoraMs);
        const ultCrudo = gastoCrudoTodo.length ? gastoCrudoTodo[gastoCrudoTodo.length - 1] : null;
        const nivelCerca = ultCrudo ? nivelTodo.filter((p) => Math.abs(p.t - ultCrudo.t) <= 600000).map((p) => p.v)[0] ?? null : null;
        const ultimoMsg = ultimoBueno(entrada.mensajes, id) ?? (e.ult_dato_en ? Date.parse(e.ult_dato_en) : null);
        const gastoVentana = gastoTodo.filter((p) => p.t >= desdeMs);
        const enlace = estadoEnlace(Number.isFinite(ultimoMsg as number) ? ultimoMsg : null, ahoraMs);
        return [{
            id, nombre: e.nombre, nombreCorto: NOMBRE_CORTO[id] ?? e.nombre, color: colorEstacion(id),
            grupo: grupoDeEstacion(e), grupoTitulo: TITULO_GRUPO[grupoDeEstacion(e)], intervaloMin: intervalo,
            ultimoNivel: ultimo(nivelTodo, ahoraMs), ultimoGasto: ultimo(gastoTodo, ahoraMs), ultimaVelocidad: ultimo(velTodo, ahoraMs),
            ceroReciente: !!ultCrudo && ceroSospechoso(id, ultCrudo.v, nivelCerca) && (!gastoTodo.length || ultCrudo.t > gastoTodo[gastoTodo.length - 1].t),
            enlace, salud: saludEnlace(entrada.mensajes, id, ahoraMs - DIA), tira: tiraEnlace(entrada.mensajes, id, ahoraMs, 24),
            est,
            serieNivel: agregarBanda(nivelTodo.filter((p) => p.t >= desdeMs), paso),
            serieGasto: agregarBanda(gastoVentana, paso),
            spark: agregarBanda(gastoTodo.filter((p) => p.t >= hastaMs - DIA).length ? gastoTodo.filter((p) => p.t >= hastaMs - DIA) : nivelTodo.filter((p) => p.t >= hastaMs - DIA), 60),
            meteo: config.variables.includes('meteo') ? resumenMeteo(id, entrada.meteo[id], desdeMs, hastaMs, paso) : null,
            sinDatos: !est.nivel && !est.gasto && !est.velocidad,
        } satisfies DatosEstacionGoes];
    });

    const comparacion = calcularComparacion(estaciones, entrada, r.horas);
    const base = { desdeMs, hastaMs, ahoraMs, etiquetaPeriodo: etiquetaPeriodoGoes(config.periodo, ahoraMs) };
    const parcial = { config, estaciones, comparacion, ...base, recortado: r.recortado, horas: r.horas };
    return { ...parcial, lectura: redactarLecturaGoes(parcial), notasCalidad: notasCalidadGoes(parcial) };
}

function calcularComparacion(estaciones: DatosEstacionGoes[], entrada: EntradaInformeGoes, horas: number): DatosComparacion {
    const rio = estaciones.find((e) => e.id === 'C6300760');
    const presas = estaciones.filter((e) => e.grupo !== 'rio');
    if (!entrada.config.variables.includes('gasto')) return { sustentable: false, motivo: 'No se incluyó el gasto entre las variables.', filas: [] };
    if (!rio || presas.length === 0) return { sustentable: false, motivo: 'Se necesita Ojinaga (río) y al menos una estación de presa en la selección.', filas: [] };
    if (horas < 24 * 7 - 1) return { sustentable: false, motivo: 'El periodo es menor a 7 días: el tránsito del agua entre la presa y el río (sin medir) distorsiona la diferencia.', filas: [] };
    if (!rio.est.cobertura?.confiable) return { sustentable: false, motivo: `Ojinaga tiene cobertura insuficiente (${fmt(rio.est.cobertura?.pct, 0)} % de las lecturas esperadas).`, filas: [] };
    const { desde, hasta } = rio.est;
    const serieRio = sinCerosSospechosos(rio.id, enVentana(entrada.series[rio.id]?.gasto_m3s, desde, hasta), enVentana(entrada.series[rio.id]?.nivel_m, desde, hasta)).validos;
    const filas: FilaComparacion[] = [];
    for (const p of presas) {
        // Una estación con más de la mitad de sus lecturas excluidas no representa el periodo: no entra a la comparación.
        if (!p.est.cobertura?.confiable || !p.est.gastoRepresentativo) continue;
        const sp = sinCerosSospechosos(p.id, enVentana(entrada.series[p.id]?.gasto_m3s, desde, hasta), enVentana(entrada.series[p.id]?.nivel_m, desde, hasta)).validos;
        const c = comparaPresaRio(sp, serieRio, desde, hasta, 0);
        if (c) filas.push({ estacionId: p.id, nombre: p.nombreCorto, c });
    }
    return filas.length
        ? { sustentable: true, motivo: null, filas }
        : { sustentable: false, motivo: 'Ninguna estación de presa tiene cobertura y lecturas válidas suficientes para comparar.', filas: [] };
}

// ── Lectura en palabras ────────────────────────────────────────────────────────────

const lista = (xs: string[]): string => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

type Parcial = Pick<InformeGoes, 'config' | 'estaciones' | 'comparacion' | 'desdeMs' | 'hastaMs' | 'ahoraMs' | 'etiquetaPeriodo' | 'recortado' | 'horas'>;

/** Variable que manda en la lectura de movimiento: el gasto si se incluyó y la estación lo tiene; si no, el nivel. */
export function movimiento24h(e: DatosEstacionGoes, usaGasto: boolean, usaNivel: boolean): { dir: DirTendencia; delta: number | null; unidad: string; variable: 'gasto' | 'nivel' } | null {
    const g = usaGasto ? e.est.variacionGasto.h24 : null;
    if (g) return { dir: g.dir, delta: g.delta, unidad: 'm³/s', variable: 'gasto' };
    const n = usaNivel ? e.est.variacionNivel.h24 : null;
    if (n) return { dir: n.dir, delta: n.delta, unidad: 'm', variable: 'nivel' };
    return null;
}

export function redactarLecturaGoes(d: Parcial): string[] {
    const out: string[] = [];
    const usaGasto = d.config.variables.includes('gasto'), usaNivel = d.config.variables.includes('nivel');
    const con = d.estaciones.filter((e) => !e.sinDatos), sin = d.estaciones.filter((e) => e.sinDatos);
    const rango = `${fechaHoraLocal(d.desdeMs)} a ${fechaHoraLocal(d.hastaMs)}`;
    out.push(`${d.etiquetaPeriodo} (${rango}, hora de Chihuahua): ${con.length} de ${d.estaciones.length} ${d.estaciones.length === 1 ? 'estación' : 'estaciones'} con lecturas${sin.length ? `; sin datos (S/D): ${lista(sin.map((e) => e.nombreCorto))}` : ''}.`);

    if (usaGasto || usaNivel) {
        const grupos: Record<'sube' | 'baja' | 'estable' | 'sd', string[]> = { sube: [], baja: [], estable: [], sd: [] };
        for (const e of con) {
            const m = movimiento24h(e, usaGasto, usaNivel);
            if (!m) { grupos.sd.push(e.nombreCorto); continue; }
            const dec = m.variable === 'gasto' ? 1 : 2;
            grupos[m.dir === 'sd' ? 'sd' : m.dir].push(m.dir === 'estable' ? e.nombreCorto : `${e.nombreCorto} (${fmtDelta(m.delta, dec)} ${m.unidad}${m.variable === 'nivel' && usaGasto ? ', nivel' : ''})`);
        }
        const frases: string[] = [];
        if (grupos.sube.length) frases.push(`sube en ${lista(grupos.sube)}`);
        if (grupos.baja.length) frases.push(`baja en ${lista(grupos.baja)}`);
        if (grupos.estable.length) frases.push(`se mantiene estable en ${lista(grupos.estable)}`);
        if (frases.length) out.push(`En las 24 h previas al último dato, el ${usaGasto ? 'gasto' : 'nivel'} ${frases.join('; ')}${grupos.sd.length ? `. Sin base suficiente para comparar (S/D): ${lista(grupos.sd)}` : ''}.`);
        else if (grupos.sd.length) out.push(`No hay base suficiente para medir el cambio a 24 h (S/D) en ${lista(grupos.sd)}.`);
    }

    if (usaGasto) {
        const conGasto = con.filter((e) => e.est.gasto && e.est.gastoRepresentativo);
        if (conGasto.length) {
            const may = conGasto.reduce((a, b) => (b.est.gasto!.media > a.est.gasto!.media ? b : a));
            const pico = conGasto.reduce((a, b) => (b.est.gasto!.max > a.est.gasto!.max ? b : a));
            out.push(`El mayor gasto medio del periodo fue el de ${may.nombreCorto}, ${fmt(may.est.gasto!.media, 1)} m³/s; el máximo puntual, ${fmt(pico.est.gasto!.max, 1)} m³/s, se registró en ${pico.nombreCorto} el ${fechaHoraLocal(pico.est.gasto!.tMax)}.`);
        } else out.push(con.some((e) => e.est.gasto) ? 'Ninguna estación tiene suficientes lecturas de gasto válidas para comparar medias.' : 'No hay lecturas de gasto en el periodo (S/D).');
    }

    const ex = d.estaciones.filter((e) => usaGasto && e.est.excluidas > 0);
    if (ex.length) out.push(`${lista(ex.map((e) => `${e.nombreCorto} (${e.est.excluidas} ${e.est.excluidas === 1 ? 'lectura' : 'lecturas'}, ${fmt(e.est.pctExcluidas, 0)} % de las recibidas)`))}: reportaron gasto 0.00, que el sensor emite cuando mide por debajo de su umbral (~${GASTO_UMBRAL_CENSURA_M3S.C6301416} m³/s), no caudal nulo (causa sin confirmar). Su media y volumen se dan como rango: ${lista(ex.filter((e) => e.est.censurado).map((e) => `${e.nombreCorto} media ${fmt(e.est.censurado!.mediaInf, 1)} a ${fmt(e.est.censurado!.mediaSup, 1)} m³/s`))}.${ex.some((e) => !e.est.gastoRepresentativo) ? ` En ${lista(ex.filter((e) => !e.est.gastoRepresentativo).map((e) => e.nombreCorto))} fue más de la mitad: el mínimo, máximo y percentiles describen solo el tiempo sobre el umbral, no todo el periodo.` : ''}`);

    const sinTx = d.estaciones.filter((e) => e.enlace.clave === 'sin_transmision' || e.enlace.clave === 'sd');
    const ok = d.estaciones.length - sinTx.length;
    out.push(`Enlace satelital al momento de emitir: ${ok} de ${d.estaciones.length} ${ok === 1 ? 'estación' : 'estaciones'} transmitiendo${sinTx.length ? `; sin transmisión reciente o sin mensajes: ${lista(sinTx.map((e) => e.nombreCorto))}` : ''}.`);
    return out;
}

export function notasCalidadGoes(d: Parcial): string[] {
    const n: string[] = [];
    const ids = d.estaciones.map((e) => e.id);
    if (ids.includes('C6301416') && d.config.variables.includes('gasto')) {
        const e = d.estaciones.find((x) => x.id === 'C6301416')!;
        n.push(`Babisas: ${e.est.excluidas > 0 ? `${e.est.excluidas} ${e.est.excluidas === 1 ? 'lectura' : 'lecturas'} de gasto 0.00 con nivel igual o superior a ${CERO_SOSPECHOSO_NIVEL_M.C6301416} m se tratan como gasto censurado («por debajo del umbral del sensor», ~${GASTO_UMBRAL_CENSURA_M3S.C6301416} m³/s)` : `no hubo lecturas de gasto 0.00 con nivel alto en el periodo; el criterio (gasto 0.00 con nivel ≥ ${CERO_SOSPECHOSO_NIVEL_M.C6301416} m) sigue vigente`}. El sensor no reporta valores entre 0 y ~${GASTO_UMBRAL_CENSURA_M3S.C6301416} m³/s, así que ese cero no es caudal nulo; la causa NO está confirmada y falta contrastarla con un aforo.${e.est.censurado ? ` La media y el volumen se dan como rango: límite inferior con esos ceros como 0, límite superior como ${e.est.censurado.umbral} m³/s; el valor real está entre ambos.` : ''}${e.est.excluidas > 0 && !e.est.gastoRepresentativo ? ` Como el ${fmt(e.est.pctExcluidas, 0)} % de las lecturas quedó bajo el umbral (más de la mitad), el mínimo, máximo y percentiles de Babisas describen solo el tiempo sobre el umbral.` : ''}`);
    }
    if (ids.includes('C6301AC4') && d.config.variables.includes('meteo')) n.push('Madero–Vírgenes: la radiación solar reporta un valor casi fijo (889–907 W/m²); el canal no es confiable y no se publica.');
    if (ids.includes('C6300760') && d.config.variables.includes('meteo')) n.push('Ojinaga es estación de río: mide nivel, gasto y velocidad; no tiene sensores meteorológicos (S/D).');
    n.push('Intervalo de lectura: 15 min en Ojinaga y 20 min en las demás estaciones. Un hueco de más de 45 min no se integra al volumen: no se inventa caudal donde la estación no midió.');
    n.push('Un canal adicional de presión de las estaciones (pa) no tiene significado confirmado: no se consulta ni se publica.');
    for (const e of d.estaciones) {
        const c = e.est.cobertura;
        if (c && !c.confiable) n.push(`${e.nombreCorto}: cobertura de ${fmt(c.pct, 0)} % (${c.recibidas} de ${c.esperadas} lecturas esperadas); por debajo de ${COBERTURA_MIN_CONFIABLE} % los resultados son indicativos.`);
        if (e.meteo && e.meteo.descartadas > 0) n.push(`${e.nombreCorto}: ${e.meteo.descartadas} lecturas meteorológicas fuera de rango físico se descartaron.`);
    }
    return n;
}
