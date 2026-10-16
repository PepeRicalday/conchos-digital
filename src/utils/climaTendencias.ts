// ═══════════════════════════════════════════════════════════════════════════
// Tendencias del periodo (diaria / semanal / horaria) — SICA-005
// ---------------------------------------------------------------------------
// Alimenta las gráficas opcionales de "tendencias" del Informe Geoclimático.
// Parte de las lecturas crudas de `clima_estacion_lecturas` (≈ 1 por hora) y las
// agrega en hora LOCAL de Chihuahua — nunca en UTC (ver el fix de
// fn_clima_resumen_mensual: una lectura de las 20:51 locales ya es "mañana" en
// UTC y la lluvia nocturna se perdía).
//
// Reglas (las mismas del resto del informe):
//   · Lluvia diaria = ÚLTIMA `lluvia_dia_mm` del día local (es un contador que
//     se reinicia a medianoche). Es el mismo criterio de la RPC, así que la
//     suma del periodo coincide con `lluvia_mm_acumulada`.
//   · Temperatura / viento / radiación = promedio del día; si hay menos del 60 %
//     de las lecturas esperadas, el día es S/D (null = hueco), nunca 0.
//   · Nada se interpola. Un hueco es un hueco.
//
// `construyeTendencias` es una función PURA (sin red) para poder probarla.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from '../lib/supabase';
import { addDays, getTodayString } from './dateHelpers';
import { valorPlausible } from './plausibilidadClima';

const TZ = 'America/Chihuahua';
const LECTURAS_ESPERADAS_DIA = 13;     // misma cadencia que usa climaResumenMensual.ts
const COBERTURA_MIN = 0.6;
/** Hasta este nº de días la tendencia es diaria; más allá se agrega por semana. */
export const MAX_DIAS_DIARIA = 45;
/** Intervalo máximo entre lecturas para repartir su lluvia por horas (min). */
const MAX_INTERVALO_MIN = 180;
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export interface FilaCruda {
    estacion_id: string;
    ts: string;
    temp_c: number | null;
    viento_ms: number | null;
    rad_solar_wm2: number | null;
    lluvia_dia_mm: number | null;
}

export interface EstacionRef { id: string; nombre: string }

export interface SerieTendencia { id: string; nombre: string; valores: (number | null)[] }

export interface PicoLluvia {
    estacionId: string;
    nombre: string;
    /** Índice del cubo (día o semana) que contiene el día pico. */
    indice: number;
    /** Día pico (YYYY-MM-DD) y su lámina — SIEMPRE diarios, aunque la serie sea semanal. */
    fecha: string;
    mm: number;
}

export interface CoberturaEstacion {
    id: string;
    nombre: string;
    lecturas: number;
    esperadas: number;
    pct: number;
}

export interface BloqueHorario {
    dia: string;          // YYYY-MM-DD local
    hora: number;         // hora local de inicio del bloque
    /** Promedio de la red en mm/h entre las estaciones que sí leyeron; null = sin lectura. */
    red: number | null;
    /** Estación con mayor intensidad en el bloque. */
    max: { nombre: string; mmh: number } | null;
}

export interface EpisodioHorario {
    anchoH: number;
    bloques: BloqueHorario[];
    indicePico: number;
    /** Lámina total del episodio por estación (mm), de mayor a menor. */
    totales: { id: string; nombre: string; mm: number }[];
    totalRedMm: number;
    /** mm caídos en intervalos de más de 3 h sin lectura (no repartibles en bloques). */
    mmSinDetalle: number;
}

export interface TendenciasPeriodo {
    desde: string;
    hasta: string;
    resolucion: 'diaria' | 'semanal';
    /** Una etiqueta por cubo (día o semana), ya legible ("15 oct", "sem 13 oct"). */
    etiquetas: string[];
    tempC: SerieTendencia[];
    vientoMs: SerieTendencia[];
    radSolarWm2: SerieTendencia[];
    /** Lámina por cubo (suma de los días del cubo; null si el cubo no tiene cobertura). */
    lluvia: SerieTendencia[];
    /** Acumulado corrido del periodo por estación (null antes del primer dato). */
    lluviaAcumulada: SerieTendencia[];
    picos: PicoLluvia[];
    /** Episodio de lluvia por bloques de 1-3 h (el más lluvioso del periodo, o de
     *  la víspera del periodo); null si no llovió. */
    horaria: EpisodioHorario | null;
    cobertura: CoberturaEstacion[];
}

// ── Hora local ──────────────────────────────────────────────────────────────
const FMT_LOCAL = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function partesLocales(ts: string | number | Date): { dia: string; hora: number; min: number } {
    const p = FMT_LOCAL.formatToParts(new Date(ts));
    const g = (t: string) => p.find(x => x.type === t)!.value;
    return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: Number(g('hour')) % 24, min: Number(g('minute')) };
}

function etiquetaDia(dia: string): string {
    const [, m, d] = dia.split('-').map(Number);
    return `${d} ${MES_CORTO[m - 1]}`;
}

function listaDias(desde: string, hasta: string): string[] {
    const dias: string[] = [];
    for (let d = desde; d <= hasta && dias.length < 800; d = addDays(d, 1)) dias.push(d);
    return dias;
}

function lunesDe(dia: string): string {
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();   // 0 = domingo
    return addDays(dia, -((dow + 6) % 7));
}

/** Etiqueta solo 1 de cada `paso` para que el eje no se amontone. */
function ralea(etiquetas: string[], maxVisibles = 12): string[] {
    const paso = Math.max(1, Math.ceil(etiquetas.length / maxVisibles));
    return etiquetas.map((e, i) => (i % paso === 0 ? e : ''));
}

// ── Consulta ────────────────────────────────────────────────────────────────
/** Lecturas crudas del periodo. Pide un día de margen a cada lado (en UTC) y
 *  deja que `construyeTendencias` filtre por día LOCAL; pagina porque PostgREST
 *  corta en 1000 filas y 6 estaciones × 90 días × ~16 lecturas pasa de 8 000. */
export async function obtenLecturasPeriodo(estacionIds: string[], desde: string, hasta: string): Promise<FilaCruda[]> {
    if (!estacionIds.length) return [];
    const ini = `${addDays(desde, -1)}T00:00:00Z`;
    const fin = `${addDays(hasta, 2)}T00:00:00Z`;
    const PAGINA = 1000;
    const filas: FilaCruda[] = [];
    for (let desdeFila = 0; desdeFila < 200 * PAGINA; desdeFila += PAGINA) {
        const { data, error } = await supabase
            .from('clima_estacion_lecturas')
            .select('estacion_id, ts, temp_c, viento_ms, rad_solar_wm2, lluvia_dia_mm')
            .in('estacion_id', estacionIds)
            .gte('ts', ini)
            .lt('ts', fin)
            .order('ts', { ascending: true })
            .order('id', { ascending: true })
            .range(desdeFila, desdeFila + PAGINA - 1);
        if (error) throw error;
        const lote = (data ?? []) as FilaCruda[];
        filas.push(...lote);
        if (lote.length < PAGINA) break;
    }
    return filas;
}

// ── Agregación (pura) ───────────────────────────────────────────────────────
interface AcumDia {
    n: number;
    sumT: number; nT: number;
    sumV: number; nV: number;
    sumR: number; nR: number;
    lluvia: number | null;     // última lluvia_dia_mm no nula del día (filas llegan en orden de ts)
}

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const redondea = (v: number, dec = 1) => Math.round(v * 10 ** dec) / 10 ** dec;

/** Días enteros entre dos YYYY-MM-DD (sin DST: Chihuahua ya no lo usa). */
const difDias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/**
 * Episodio de lluvia por bloques. Se escoge el día más lluvioso de la red entre
 * la víspera del periodo y `hasta` (así "Hoy" también muestra una tormenta de
 * anoche) y se analiza ese día ±1. Cada diferencia del contador diario entre
 * dos lecturas se reparte uniformemente sobre el tiempo que cubre (supuesto
 * declarado en el informe), así el total del episodio se conserva exacto; un
 * intervalo de más de MAX_INTERVALO_MIN sin lectura no se reparte: sus mm van a
 * `mmSinDetalle` y los bloques que cubre quedan "sin lectura" (nunca 0).
 */
function construyeEpisodioHorario(
    porEstacion: Map<string, FilaCruda[]>, orden: EstacionRef[], desde: string, hasta: string,
): EpisodioHorario | null {
    const minDia = addDays(desde, -1);
    // Último valor del contador de cada día local por estación; lecturas en
    // minutos locales desde minDia 00:00.
    const lluviaDia = new Map<string, number>();
    const lecturas = new Map<string, { t: number; dia: string; l: number }[]>();
    const dif: number[] = [];
    for (const e of orden) {
        const lista: { t: number; dia: string; l: number }[] = [];
        for (const f of porEstacion.get(e.id) ?? []) {
            const { dia, hora, min } = partesLocales(f.ts);
            const l = num(f.lluvia_dia_mm);
            if (l == null || dia < minDia || dia > hasta) continue;
            lista.push({ t: difDias(minDia, dia) * 1440 + hora * 60 + min, dia, l });
            lluviaDia.set(`${dia}|${e.id}`, l);
        }
        lista.forEach((r, i) => { if (i && lista[i - 1].dia === r.dia) dif.push(r.t - lista[i - 1].t); });
        lecturas.set(e.id, lista);
    }
    const dias = listaDias(minDia, hasta);
    const redDia = dias.map(d => orden.reduce((s, e) => s + (lluviaDia.get(`${d}|${e.id}`) ?? 0), 0));
    const maxRed = Math.max(0, ...redDia);
    if (maxRed <= 0) return null;
    const diaPico = dias[redDia.indexOf(maxRed)];

    // Ancho de bloque según la cadencia mediana de lecturas.
    const mediana = dif.length ? [...dif].sort((a, b) => a - b)[Math.floor(dif.length / 2)] : 60;
    const anchoH = mediana <= 60 ? 1 : mediana <= 120 ? 2 : 3;
    const W = anchoH * 60;

    const dIni = addDays(diaPico, -1) < minDia ? minDia : addDays(diaPico, -1);
    const dFin = diaPico < hasta ? addDays(diaPico, 1) : diaPico;
    const t0 = difDias(minDia, dIni) * 1440, t1 = (difDias(minDia, dFin) + 1) * 1440;
    const nB = Math.round((t1 - t0) / W);

    // Reparto por bloque y estación.
    const mm = orden.map(() => new Array<number>(nB).fill(0));
    const cubierto = orden.map(() => new Array<number>(nB).fill(0));
    let mmSinDetalle = 0;
    orden.forEach((e, k) => {
        const lista = lecturas.get(e.id) ?? [];
        lista.forEach((r, i) => {
            const mismoDia = i > 0 && lista[i - 1].dia === r.dia;
            const ini = mismoDia ? lista[i - 1].t : difDias(minDia, r.dia) * 1440;
            const delta = mismoDia ? (r.l >= lista[i - 1].l ? r.l - lista[i - 1].l : r.l) : r.l;
            const largo = r.t - ini;
            if (largo <= 0) return;
            const a = Math.max(ini, t0), z = Math.min(r.t, t1);
            if (z <= a) return;
            if (largo > MAX_INTERVALO_MIN) { mmSinDetalle += delta * ((z - a) / largo); return; }
            for (let b = Math.floor((a - t0) / W); b <= Math.floor((z - 1 - t0) / W) && b < nB; b++) {
                const sol = Math.min(z, t0 + (b + 1) * W) - Math.max(a, t0 + b * W);
                if (sol <= 0) continue;
                mm[k][b] += delta * (sol / largo);
                cubierto[k][b] += sol;
            }
        });
    });

    const bloquesTodos: BloqueHorario[] = Array.from({ length: nB }, (_, b) => {
        const inicio = t0 + b * W;
        const vals = orden
            .map((e, k) => (cubierto[k][b] >= 0.5 * W ? { nombre: e.nombre, mmh: mm[k][b] / anchoH } : null))
            .filter((v): v is { nombre: string; mmh: number } => v != null);
        return {
            dia: addDays(minDia, Math.floor(inicio / 1440)), hora: Math.floor((inicio % 1440) / 60),
            red: vals.length ? vals.reduce((s, v) => s + v.mmh, 0) / vals.length : null,
            max: vals.length ? vals.reduce((m, v) => (v.mmh > m.mmh ? v : m)) : null,
        };
    });

    // Episodio: de 1 bloque antes del primer bloque con lluvia a 1 después del último.
    // "Con lluvia" = al menos 5 % de la intensidad pico: una llovizna de horas antes
    // no debe estirar el eje con un tramo casi plano.
    const picoRed = Math.max(0, ...bloquesTodos.map(b => b.red ?? 0));
    const llueve = bloquesTodos.map(b => (b.red ?? 0) > 0 && (b.red ?? 0) >= picoRed * 0.05);
    const primero = llueve.indexOf(true), ultimo = llueve.lastIndexOf(true);
    if (primero < 0) return null;
    const iA = Math.max(0, primero - 1);
    // Un bloque final sin lectura es solo donde terminan los datos: no se dibuja.
    const iZ = Math.min(nB - 1, ultimo + (bloquesTodos[ultimo + 1]?.red != null ? 1 : 0));
    const bloques = bloquesTodos.slice(iA, iZ + 1).map(b => ({
        ...b,
        red: b.red == null ? null : redondea(b.red, 2),
        max: b.max ? { nombre: b.max.nombre, mmh: redondea(b.max.mmh, 2) } : null,
    }));
    const totales = orden
        .map((e, k) => ({ id: e.id, nombre: e.nombre, mm: redondea(mm[k].slice(iA, iZ + 1).reduce((a, b) => a + b, 0), 1) }))
        .filter(t => (lecturas.get(t.id)?.length ?? 0) > 0)
        .sort((a, b) => b.mm - a.mm);
    const redVals = bloques.map(b => b.red ?? -1);
    return {
        anchoH, bloques, indicePico: redVals.indexOf(Math.max(...redVals)), totales,
        totalRedMm: totales.length ? redondea(totales.reduce((s, t) => s + t.mm, 0) / totales.length, 1) : 0,
        mmSinDetalle: redondea(mmSinDetalle, 1),
    };
}

export function construyeTendencias(
    filas: FilaCruda[], estaciones: EstacionRef[], desde: string, hasta: string, ahora: Date = new Date(),
): TendenciasPeriodo {
    const orden = [...estaciones].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const dias = listaDias(desde, hasta);
    const hoyLocal = partesLocales(ahora);
    const semanal = dias.length > MAX_DIAS_DIARIA;

    // Filas ordenadas por ts por estación (la consulta ya las trae así, pero la
    // función pura no debe depender de eso).
    const porEstacion = new Map<string, FilaCruda[]>();
    for (const f of [...filas].sort((a, b) => a.ts.localeCompare(b.ts))) {
        if (!porEstacion.has(f.estacion_id)) porEstacion.set(f.estacion_id, []);
        porEstacion.get(f.estacion_id)!.push(f);
    }

    // Primer día con datos de la red dentro del periodo: antes de esa fecha no
    // existía la estación, no se penaliza como cobertura baja.
    let primerDia: string | null = null;
    for (const lista of porEstacion.values()) {
        for (const f of lista) {
            const { dia } = partesLocales(f.ts);
            if (dia >= desde && dia <= hasta && (primerDia == null || dia < primerDia)) primerDia = dia;
        }
    }

    // Acumulado por (estación, día local).
    const diario = new Map<string, Map<string, AcumDia>>();
    for (const e of orden) {
        const m = new Map<string, AcumDia>();
        for (const f of porEstacion.get(e.id) ?? []) {
            const { dia } = partesLocales(f.ts);
            if (dia < desde || dia > hasta) continue;
            const a = m.get(dia) ?? { n: 0, sumT: 0, nT: 0, sumV: 0, nV: 0, sumR: 0, nR: 0, lluvia: null };
            a.n++;
            // Lecturas físicamente imposibles (sensor averiado) → S/D, no entran al promedio.
            const t = valorPlausible('tempC', num(f.temp_c)), v = valorPlausible('vientoMs', num(f.viento_ms)),
                r = valorPlausible('radSolarWm2', num(f.rad_solar_wm2)), l = num(f.lluvia_dia_mm);
            if (t != null) { a.sumT += t; a.nT++; }
            if (v != null) { a.sumV += v; a.nV++; }
            if (r != null) { a.sumR += r; a.nR++; }
            if (l != null) a.lluvia = l;
            m.set(dia, a);
        }
        diario.set(e.id, m);
    }

    // Lecturas esperadas de un día: el día en curso solo exige lo transcurrido.
    const esperadasDia = (dia: string) => dia === hoyLocal.dia
        ? Math.max(1, (LECTURAS_ESPERADAS_DIA * (hoyLocal.hora + 1)) / 24)
        : LECTURAS_ESPERADAS_DIA;
    const cubreDia = (dia: string, n: number) => n >= COBERTURA_MIN * esperadasDia(dia);

    // Valor diario por variable (null = S/D).
    const valorDia = (id: string, dia: string, campo: 'T' | 'V' | 'R' | 'L'): number | null => {
        const a = diario.get(id)?.get(dia);
        if (!a) return null;
        if (campo === 'L') return a.lluvia;
        const [suma, n] = campo === 'T' ? [a.sumT, a.nT] : campo === 'V' ? [a.sumV, a.nV] : [a.sumR, a.nR];
        return n > 0 && cubreDia(dia, n) ? suma / n : null;
    };

    // Cubos: un día por cubo, o una semana (lunes-domingo, recortada al periodo).
    const cubos: string[][] = semanal
        ? Array.from(dias.reduce((m, d) => {
            const k = lunesDe(d);
            if (!m.has(k)) m.set(k, []);
            m.get(k)!.push(d);
            return m;
        }, new Map<string, string[]>()).values())
        : dias.map(d => [d]);
    const etiquetas = cubos.map(c => semanal ? `sem ${etiquetaDia(c[0])}` : etiquetaDia(c[0]));
    const indiceCubo = new Map<string, number>();
    cubos.forEach((c, i) => c.forEach(d => indiceCubo.set(d, i)));

    // Cubo semanal con cobertura < 60 % de sus días válidos → null (no se muestra
    // una suma o un promedio que cubre solo la mitad de la semana).
    const agregaCubo = (id: string, cubo: string[], campo: 'T' | 'V' | 'R' | 'L'): number | null => {
        const vals = cubo.map(d => valorDia(id, d, campo)).filter((v): v is number => v != null);
        if (!vals.length || vals.length < COBERTURA_MIN * cubo.length) return null;
        const suma = vals.reduce((a, b) => a + b, 0);
        return campo === 'L' ? suma : suma / vals.length;
    };

    // Sin redondear: el acumulado debe sumar los valores reales (redondear cada
    // día a 0.1 y luego sumar arrastra hasta ±0.1 mm frente a la RPC).
    const serieCruda = (campo: 'T' | 'V' | 'R' | 'L'): SerieTendencia[] => orden.map(e => ({
        id: e.id, nombre: e.nombre,
        valores: cubos.map(c => agregaCubo(e.id, c, campo)),
    }));
    const redondeaSerie = (ss: SerieTendencia[], dec: number): SerieTendencia[] => ss.map(s => ({
        ...s, valores: s.valores.map(v => (v == null ? null : redondea(v, dec))),
    }));

    const lluviaCruda = serieCruda('L');
    const lluvia = redondeaSerie(lluviaCruda, 1);
    const lluviaAcumulada: SerieTendencia[] = redondeaSerie(lluviaCruda.map(s => {
        let corrido = 0, visto = false;
        return {
            ...s,
            valores: s.valores.map(v => {
                if (v != null) { corrido += v; visto = true; }
                return visto ? corrido : null;
            }),
        };
    }), 1);

    // Día pico por estación (siempre sobre valores DIARIOS).
    const picos: PicoLluvia[] = [];
    for (const e of orden) {
        let mejor: { dia: string; mm: number } | null = null;
        for (const d of dias) {
            const v = valorDia(e.id, d, 'L');
            if (v != null && v > 0 && (mejor == null || v >= mejor.mm)) mejor = { dia: d, mm: v };
        }
        if (mejor) picos.push({ estacionId: e.id, nombre: e.nombre, indice: indiceCubo.get(mejor.dia) ?? 0, fecha: mejor.dia, mm: redondea(mejor.mm, 1) });
    }

    const horaria = construyeEpisodioHorario(porEstacion, orden, desde, hasta);

    // Cobertura por estación sobre los días que la red ya operaba.
    const diasConRed = primerDia ? dias.filter(d => d >= primerDia!) : [];
    const esperadasTotal = diasConRed.reduce((s, d) => s + esperadasDia(d), 0);
    const cobertura: CoberturaEstacion[] = orden.map(e => {
        const lecturas = Array.from(diario.get(e.id)?.values() ?? []).reduce((s, a) => s + a.n, 0);
        return {
            id: e.id, nombre: e.nombre, lecturas,
            esperadas: Math.round(esperadasTotal),
            pct: esperadasTotal ? Math.min(100, Math.round((lecturas / esperadasTotal) * 100)) : 0,
        };
    });

    return {
        desde, hasta, resolucion: semanal ? 'semanal' : 'diaria',
        etiquetas: ralea(etiquetas),
        tempC: redondeaSerie(serieCruda('T'), 1), vientoMs: redondeaSerie(serieCruda('V'), 2),
        radSolarWm2: redondeaSerie(serieCruda('R'), 0),
        lluvia, lluviaAcumulada, picos, horaria, cobertura,
    };
}

/** Atajo para Clima.tsx: consulta + agregación del periodo. `hasta` se recorta a hoy. */
export async function obtenTendenciasPeriodo(
    estaciones: EstacionRef[], desde: string, hasta: string,
): Promise<TendenciasPeriodo> {
    const hoy = getTodayString();
    const hastaEf = hasta > hoy ? hoy : hasta;
    const filas = await obtenLecturasPeriodo(estaciones.map(e => e.id), desde, hastaEf);
    return construyeTendencias(filas, estaciones, desde, hastaEf);
}
