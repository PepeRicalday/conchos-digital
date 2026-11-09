// ═══════════════════════════════════════════════════════════════════════════
// Modelo de vista de la red JCAS en la cuenca del Conchos — puro (el hook solo trae filas)
// ---------------------------------------------------------------------------
// Une jcas_estaciones + jcas_lecturas_diarias con las reglas de utils/jcasCuenca.ts. Lo usan el panel de pantalla y,
// más adelante, el informe: una sola definición para que las cifras nunca diverjan. Contexto de fuente TERCERA, provisional.
// ═══════════════════════════════════════════════════════════════════════════
import {
    acumuladoLluvia, colapsarGrupos, lluviaAreal, deduplicarSitios, marcarSospechosos, PLUVIOMETROS_EXCLUIDOS, type LluviaAreal, type PuntoLluvia,
} from './jcasCuenca';
import type { PoligonoGeo, ZonaCuenca } from './geoCuenca';
import { dentroDelPoligono } from './vasoAnalisis';
import { anioInicioCiclo, diaDeCiclo } from './analiticaPresas';

export interface FilaEstacionJcas {
    id_jcas: number; nombre: string; latitud: number; longitud: number; altitud_m: number | null;
    zona: ZonaCuenca; grupo_ciudad: string | null; tiene_pluviometro: boolean; activa: boolean; ult_fecha: string | null;
    /** Elevación del DEM (m); la altitud que reporta JCAS no es confiable. */
    elevacion_dem_m?: number | null;
}
export interface FilaLecturaJcas { estacion_id: number; fecha: string; lluvia_mm: number | null; temp_c: number | null; hum_pct?: number | null; viento_kmh?: number | null }

/** Lectura PARCIAL del día en curso (jcas_lecturas_hoy): lo acumulado/promediado hasta `actualizadoEn`. */
export interface FilaHoyJcas { estacion_id: number; fecha: string; lluvia_mm: number | null; temp_c: number | null; hum_pct: number | null; viento_kmh: number | null; actualizado_en: string }

/** Lluvia diaria de una estación PROPIA (WeatherLink), de fn_cuenca_lluvia_propia: el valor del día es la última lectura del contador del día local. */
export interface FilaLluviaPropia { estacion_id: string; nombre: string; latitud: number; longitud: number; fecha: string; lluvia_mm: number; ult_lectura: string }
/** Medias diarias de una estación PROPIA (fn_cuenca_clima_propio): temperatura, humedad y viento (km/h) del día local; null = S/D (sensor no confiable o sin lectura). */
export interface FilaClimaPropio { estacion_id: string; fecha: string; temp_c: number | null; hum_pct: number | null; viento_kmh: number | null }
/**
 * Estación propia con sus valores por ventana: lluvia (contador diario) y, desde v2.93, temperatura, humedad y viento (medias de sus lecturas).
 * Misma forma de valores que PuntoRedJcas (`ayer`, `hoy`, `medias`, `mm7`, `mm30`): `valorObs` sirve para ambas fuentes.
 */
export interface PuntoPropio {
    id: string; nombre: string; lat: number; lon: number; mmHoy: number | null; mm1: number | null; mm7: number | null; mm30: number | null; ultFecha: string | null; hoyEn: string | null;
    ayer: ValoresDia; hoy: ValoresDia | null; medias: PuntoRedJcas['medias']; tempUltima: number | null;
    largas?: Record<string, ValoresDia>;
}
/** Lo mínimo que `valorObs` necesita de un punto (JCAS o propio). */
export type PuntoConValores = Pick<PuntoRedJcas, 'hoy' | 'ayer' | 'medias' | 'mm7' | 'mm30' | 'largas'>;

/**
 * Ventana de lo observado: el día en curso (parcial), el último día completo (ayer), los últimos 7 / 30 / 60 / 90 días completos o el ciclo agrícola en
 * curso (1-oct hasta ayer). Las ventanas largas dependen de la historia diaria guardada: con menos del 80 % de los días con dato son S/D (nunca 0).
 */
export type VentanaObs = 'hoy' | 1 | 7 | 30 | 60 | 90 | 'ciclo';
export const VENTANAS_OBS: { v: VentanaObs; t: string }[] = [
    { v: 'hoy', t: 'Hoy' }, { v: 1, t: 'Ayer' }, { v: 7, t: '7 días' }, { v: 30, t: '30 días' }, { v: 60, t: '60 días' }, { v: 90, t: '90 días' }, { v: 'ciclo', t: 'Ciclo agrícola' },
];
export type VentanaLarga = 60 | 90 | 'ciclo';
const VENTANAS_LARGAS: VentanaLarga[] = [60, 90, 'ciclo'];
export const esVentanaLarga = (v: VentanaObs): v is VentanaLarga => v === 60 || v === 90 || v === 'ciclo';
/** Rótulo corto de una ventana para títulos y tarjetas ("hoy (parcial)", "ayer", "7 d", "ciclo"). */
export const etiquetaVentana = (v: VentanaObs): string => (v === 'hoy' ? 'hoy (parcial)' : v === 1 ? 'ayer' : v === 'ciclo' ? 'ciclo' : `${v} d`);
/** Rótulo largo ("hoy, parcial", "ayer", "últimos 7 días", "ciclo agrícola en curso"). */
export const cuandoVentana = (v: VentanaObs): string => (v === 'hoy' ? 'hoy, día en curso (parcial)' : v === 1 ? 'ayer (día completo)' : v === 'ciclo' ? 'ciclo agrícola en curso (desde el 1-oct)' : `últimos ${v} días`);

const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Días de una ventana que termina en `fin` (último día completo). 'ciclo' = del 1-oct del ciclo en curso hasta `fin`; si hoy es 1-oct aún no hay
 * días del ciclo nuevo y devuelve 0 (= S/D). Una sola definición para el modelo, las escalas y los rótulos.
 */
export function diasDeVentana(v: VentanaObs, fin: string): number {
    if (v === 'hoy') return 1;
    if (v !== 'ciclo') return v;
    const hoy = ISO(Date.parse(`${fin}T00:00:00Z`) + 86_400_000);
    return Math.max(0, diaDeCiclo(fin, anioInicioCiclo(hoy)) + 1);
}
/** Cuántos días de lecturas diarias hay que traer para cubrir todas las ventanas (90 d o el ciclo en curso, lo que sea mayor, + margen). */
export function diasDeCarga(hoyLocalISO: string): number {
    const fin = ISO(Date.parse(`${hoyLocalISO}T00:00:00Z`) - 86_400_000);
    return Math.max(95, diasDeVentana('ciclo', fin) + 4);
}

/** Valores de una ventana corta (un día): lluvia acumulada y medias de temperatura, humedad y viento. */
export interface ValoresDia { mm: number | null; temp: number | null; hum: number | null; viento: number | null }

export type EstadoEstacion = 'vigente' | 'atrasada' | 'sin-datos';

export interface PuntoRedJcas {
    id: number; nombre: string; lat: number; lon: number; altitudM: number | null; zona: ZonaCuenca; grupo: string | null;
    sinPluviometro: boolean;
    mm7: number | null; mm30: number | null; diasConDato30: number;
    ultFecha: string | null; atrasoDias: number | null; estado: EstadoEstacion;
    sospechosa: boolean; motivo: string | null;
    /** Temperatura media del último día completo con dato (°C). */
    tempUltima: number | null;
    elevM: number | null;
    /** Último día COMPLETO (ayer): lluvia y medias del día. */
    ayer: ValoresDia;
    /** Día en curso, PARCIAL (hasta `hoyEn`); null si la estación no tiene lectura de hoy. */
    hoy: ValoresDia | null;
    hoyEn: string | null;
    /** Promedios de la ventana (≥ 80 % de los días con dato; si no, null = S/D). */
    medias: { temp7: number | null; temp30: number | null; hum7: number | null; hum30: number | null; viento7: number | null; viento30: number | null };
    /** Ventanas largas (60 d, 90 d, ciclo): lluvia acumulada y medias, con la misma regla del 80 % de días con dato. Clave: '60' | '90' | 'ciclo'. */
    largas?: Record<string, ValoresDia>;
}

export interface ModeloRedJcas {
    puntos: PuntoRedJcas[];
    /** Último día COMPLETO sobre el que se calculan los acumulados (ayer, hora local conservadora). */
    fin: string;
    areal7: LluviaAreal; areal30: LluviaAreal;
    /** Lluvia areal del último día completo y del día en curso (parcial). */
    areal1: LluviaAreal; arealHoy: LluviaAreal;
    /** Lluvia areal de las ventanas largas (clave '60' | '90' | 'ciclo'). */
    arealesLargas?: Record<string, LluviaAreal>;
    /** Primer día con lectura diaria guardada: la historia disponible empieza ahí (las ventanas largas dependen de ella). */
    inicioHistoria?: string | null;
    /** Fecha del día en curso con lectura (null si ninguna estación tiene) y la hora de la lectura parcial más reciente. */
    fechaHoy: string | null; hoyEn: string | null;
    /** Estaciones propias (WeatherLink) dentro de la cuenca: suman a la lluvia observada. */
    propias: PuntoPropio[];
    vigentes: number; total: number; conLluvia: number;
}

/** Promedio de un campo diario en los `dias` que terminan en `fin`; null si hay menos del 80 % de los días con dato. */
export function mediaVentana(ls: FilaLecturaJcas[], campo: 'temp_c' | 'hum_pct' | 'viento_kmh', fin: string, dias: number): number | null {
    const t1 = Date.parse(`${fin}T00:00:00Z`), t0 = t1 - (dias - 1) * 86_400_000;
    const v = new Map<string, number>();
    for (const l of ls) {
        const t = Date.parse(`${l.fecha}T00:00:00Z`), x = l[campo];
        if (t >= t0 && t <= t1 && x != null && Number.isFinite(x)) v.set(l.fecha, x);
    }
    if (v.size < Math.ceil(dias * 0.8)) return null;
    let s = 0; for (const x of v.values()) s += x;
    return Math.round((s / v.size) * 10) / 10;
}

/** Valor de un punto en una ventana: una sola definición para la tabla, el mapa, los planos y el informe. */
export function valorObs(p: PuntoConValores, variable: 'lluvia' | 'temperatura' | 'viento' | 'humedad', v: VentanaObs): number | null {
    if (v === 'hoy' || v === 1) {
        const d = v === 'hoy' ? p.hoy : p.ayer;
        if (!d) return null;
        return variable === 'lluvia' ? d.mm : variable === 'temperatura' ? d.temp : variable === 'viento' ? d.viento : d.hum;
    }
    if (esVentanaLarga(v)) {
        const d = p.largas?.[String(v)];
        if (!d) return null;
        return variable === 'lluvia' ? d.mm : variable === 'temperatura' ? d.temp : variable === 'viento' ? d.viento : d.hum;
    }
    const m = p.medias;
    return variable === 'lluvia' ? (v === 7 ? p.mm7 : p.mm30) : variable === 'temperatura' ? (v === 7 ? m.temp7 : m.temp30)
        : variable === 'viento' ? (v === 7 ? m.viento7 : m.viento30) : (v === 7 ? m.hum7 : m.hum30);
}
export const mmPropio = (p: PuntoPropio, v: VentanaObs): number | null => (v === 'hoy' ? p.mmHoy : v === 1 ? p.mm1 : v === 7 ? p.mm7 : esVentanaLarga(v) ? (p.largas?.[String(v)]?.mm ?? null) : p.mm30);
const SIN_AREAL = (dias: number): LluviaAreal => ({ mm: null, motivoSD: 'sin historia diaria guardada para esta ventana', nEstaciones: 0, nExcluidas: 0, coberturaPct: 0, ventanaDias: dias, min: null, max: null });
export const arealDe = (m: ModeloRedJcas, v: VentanaObs): LluviaAreal => (v === 'hoy' ? m.arealHoy : v === 1 ? m.areal1 : v === 7 ? m.areal7 : esVentanaLarga(v) ? (m.arealesLargas?.[String(v)] ?? SIN_AREAL(diasDeVentana(v, m.fin))) : m.areal30);
/** Una estación con su último día completo a más de 3 días del corte se considera atrasada. */
export const DIAS_ATRASO = 3;

export function construirRedJcas(
    estaciones: FilaEstacionJcas[], lecturas: FilaLecturaJcas[], hoyLocalISO: string, poligonos: PoligonoGeo[], lecturasHoy: FilaHoyJcas[] = [], lluviaPropia: FilaLluviaPropia[] = [],
    climaPropio: FilaClimaPropio[] = [],
): ModeloRedJcas {
    const fin = ISO(Date.parse(`${hoyLocalISO}T00:00:00Z`) - 86_400_000);
    const porEst = new Map<number, FilaLecturaJcas[]>();
    for (const l of lecturas) porEst.set(l.estacion_id, [...(porEst.get(l.estacion_id) ?? []), l]);

    // Día en curso: solo lecturas de HOY (o posteriores por el desfase de huso); una fila de ayer que no se actualizó es S/D, no se arrastra.
    const hoyPorEst = new Map<number, FilaHoyJcas>();
    for (const h of lecturasHoy) if (h.fecha >= hoyLocalISO) hoyPorEst.set(h.estacion_id, h);
    const fechaHoy = [...hoyPorEst.values()].map((h) => h.fecha).sort().pop() ?? null;
    const hoyEnGlobal = [...hoyPorEst.values()].map((h) => h.actualizado_en).sort().pop() ?? null;

    // Estaciones propias: una fila por (estación, día local). El día en curso (≥ hoy) es parcial y va aparte de los días completos.
    const porPropia = new Map<string, FilaLluviaPropia[]>();
    for (const r of lluviaPropia) porPropia.set(r.estacion_id, [...(porPropia.get(r.estacion_id) ?? []), r]);
    const climaPorPropia = new Map<string, FilaLecturaJcas[]>();
    const climaHoyPropia = new Map<string, FilaClimaPropio>();
    for (const c of climaPropio) {
        // Misma forma que la lectura diaria de JCAS para reutilizar mediaVentana (la lluvia propia va por su contador, no por aquí).
        if (c.fecha <= fin) climaPorPropia.set(c.estacion_id, [...(climaPorPropia.get(c.estacion_id) ?? []), { estacion_id: 0, fecha: c.fecha, lluvia_mm: null, temp_c: c.temp_c, hum_pct: c.hum_pct, viento_kmh: c.viento_kmh }]);
        else if (c.fecha >= hoyLocalISO) climaHoyPropia.set(c.estacion_id, c);
    }
    const propias: PuntoPropio[] = [...porPropia.entries()].map(([id, rs]) => {
        const dias = rs.filter((r) => r.fecha <= fin).map((r) => ({ fecha: r.fecha, lluviaMm: r.lluvia_mm }));
        const h = rs.filter((r) => r.fecha >= hoyLocalISO).sort((a, b) => a.fecha.localeCompare(b.fecha)).pop();
        const ult = rs.map((r) => r.fecha).sort().pop() ?? null;
        const cl = climaPorPropia.get(id) ?? [], ch = climaHoyPropia.get(id);
        const largas: Record<string, ValoresDia> = {};
        for (const w of VENTANAS_LARGAS) {
            const n = diasDeVentana(w, fin);
            largas[String(w)] = n < 1 ? { mm: null, temp: null, hum: null, viento: null }
                : { mm: acumuladoLluvia(dias, fin, n).mm, temp: mediaVentana(cl, 'temp_c', fin, n), hum: mediaVentana(cl, 'hum_pct', fin, n), viento: mediaVentana(cl, 'viento_kmh', fin, n) };
        }
        const mm1 = acumuladoLluvia(dias, fin, 1).mm, mm7 = acumuladoLluvia(dias, fin, 7).mm, mm30 = acumuladoLluvia(dias, fin, 30).mm;
        const mmHoy = h ? h.lluvia_mm : null;
        const ultTemp = [...cl].sort((x, y) => y.fecha.localeCompare(x.fecha)).find((l) => l.temp_c != null)?.temp_c ?? null;
        return { id: `wl:${id}`, nombre: rs[0].nombre, lat: rs[0].latitud, lon: rs[0].longitud, mmHoy, mm1, mm7, mm30, ultFecha: ult, hoyEn: h?.ult_lectura ?? null,
            ayer: { mm: mm1, temp: mediaVentana(cl, 'temp_c', fin, 1), hum: mediaVentana(cl, 'hum_pct', fin, 1), viento: mediaVentana(cl, 'viento_kmh', fin, 1) },
            hoy: h || ch ? { mm: mmHoy, temp: ch?.temp_c ?? null, hum: ch?.hum_pct ?? null, viento: ch?.viento_kmh ?? null } : null,
            medias: {
                temp7: mediaVentana(cl, 'temp_c', fin, 7), temp30: mediaVentana(cl, 'temp_c', fin, 30),
                hum7: mediaVentana(cl, 'hum_pct', fin, 7), hum30: mediaVentana(cl, 'hum_pct', fin, 30),
                viento7: mediaVentana(cl, 'viento_kmh', fin, 7), viento30: mediaVentana(cl, 'viento_kmh', fin, 30),
            },
            tempUltima: ultTemp, largas };
    }).filter((p) => poligonos.some((g) => dentroDelPoligono(g, p.lon, p.lat))).sort((a, b) => a.nombre.localeCompare(b.nombre));

    const base: (PuntoLluvia & { grupo: string | null })[] = [];
    const puntos: PuntoRedJcas[] = estaciones.map((e) => {
        const ls = porEst.get(e.id_jcas) ?? [];
        const dias = ls.map((l) => ({ fecha: l.fecha, lluviaMm: e.tiene_pluviometro ? l.lluvia_mm : null }));
        const a7 = e.tiene_pluviometro ? acumuladoLluvia(dias, fin, 7) : { mm: null, diasConDato: 0 };
        const a30 = e.tiene_pluviometro ? acumuladoLluvia(dias, fin, 30) : { mm: null, diasConDato: 0 };
        const a1 = e.tiene_pluviometro ? acumuladoLluvia(dias, fin, 1) : { mm: null, diasConDato: 0 };
        const h = hoyPorEst.get(e.id_jcas);
        const conDato = ls.filter((l) => l.temp_c != null || l.lluvia_mm != null).map((l) => l.fecha).sort();
        const ult = conDato.length ? conDato[conDato.length - 1] : e.ult_fecha;
        const atraso = ult ? Math.max(0, diasEntre(ult, fin)) : null;
        const ultTemp = [...ls].sort((x, y) => y.fecha.localeCompare(x.fecha)).find((l) => l.temp_c != null)?.temp_c ?? null;
        const largas: Record<string, ValoresDia> = {};
        for (const w of VENTANAS_LARGAS) {
            const n = diasDeVentana(w, fin);
            largas[String(w)] = n < 1 ? { mm: null, temp: null, hum: null, viento: null }
                : { mm: e.tiene_pluviometro ? acumuladoLluvia(dias, fin, n).mm : null, temp: mediaVentana(ls, 'temp_c', fin, n), hum: mediaVentana(ls, 'hum_pct', fin, n), viento: mediaVentana(ls, 'viento_kmh', fin, n) };
        }
        base.push({ id: String(e.id_jcas), fuente: 'jcas', nombre: e.nombre, lat: e.latitud, lon: e.longitud, mm: a30.mm, grupo: e.grupo_ciudad });
        return {
            id: e.id_jcas, nombre: e.nombre, lat: e.latitud, lon: e.longitud, altitudM: e.altitud_m, zona: e.zona, grupo: e.grupo_ciudad,
            sinPluviometro: !e.tiene_pluviometro, mm7: a7.mm, mm30: a30.mm, diasConDato30: a30.diasConDato,
            ultFecha: ult, atrasoDias: atraso, estado: ult == null ? 'sin-datos' : (atraso ?? 99) <= DIAS_ATRASO ? 'vigente' : 'atrasada',
            sospechosa: false, motivo: null, tempUltima: ultTemp, elevM: e.elevacion_dem_m ?? null,
            ayer: { mm: a1.mm, temp: mediaVentana(ls, 'temp_c', fin, 1), hum: mediaVentana(ls, 'hum_pct', fin, 1), viento: mediaVentana(ls, 'viento_kmh', fin, 1) },
            hoy: h ? { mm: e.tiene_pluviometro ? h.lluvia_mm : null, temp: h.temp_c, hum: h.hum_pct, viento: h.viento_kmh } : null,
            hoyEn: h?.actualizado_en ?? null, largas,
            medias: {
                temp7: mediaVentana(ls, 'temp_c', fin, 7), temp30: mediaVentana(ls, 'temp_c', fin, 30),
                hum7: mediaVentana(ls, 'hum_pct', fin, 7), hum30: mediaVentana(ls, 'hum_pct', fin, 30),
                viento7: mediaVentana(ls, 'viento_kmh', fin, 7), viento30: mediaVentana(ls, 'viento_kmh', fin, 30),
            },
        };
    });

    // Pluviómetros que marcan 0 mm en 30 días mientras sus vecinas registran lluvia: fuera del promedio (en 7 y 30 días).
    const inicioHistoria = lecturas.length ? lecturas.reduce((m, l) => (l.fecha < m ? l.fecha : m), lecturas[0].fecha) : null;
    const marcadas = marcarSospechosos(base, 30);
    const sosp = new Map(marcadas.filter((p) => p.sospechosa).map((p) => [p.id, p.motivo ?? '']));
    for (const p of puntos) { const m = sosp.get(String(p.id)) ?? PLUVIOMETROS_EXCLUIDOS[p.id]; if (m != null) { p.sospechosa = true; p.motivo = m; } }

    const arma = (ventana: VentanaObs): LluviaAreal => {
        const nDias = diasDeVentana(ventana, fin);
        if (nDias < 1) return { mm: null, motivoSD: 'el ciclo agrícola apenas comienza: aún no hay días completos', nEstaciones: 0, nExcluidas: 0, coberturaPct: 0, ventanaDias: 0, min: null, max: null };
        const pts = deduplicarSitios(colapsarGrupos(puntos.map((p): PuntoLluvia & { grupo: string | null } => ({
            id: String(p.id), fuente: 'jcas', nombre: p.nombre, lat: p.lat, lon: p.lon,
            mm: p.sospechosa || p.sinPluviometro ? null : valorObs(p, 'lluvia', ventana), grupo: p.grupo,
        })).concat(propias.map((p) => ({ id: p.id, fuente: 'weatherlink' as const, nombre: p.nombre, lat: p.lat, lon: p.lon, mm: mmPropio(p, ventana), grupo: null })))));
        // El promedio se calcula DENTRO del polígono de la cuenca; Ojinaga (a la salida) aporta como vecina en el borde.
        const a = lluviaAreal(poligonos, pts, nDias);
        // En ventanas largas, un S/D casi siempre es historia corta: se dice con la fecha de inicio de lo guardado.
        const motivo = a.mm == null && esVentanaLarga(ventana) && inicioHistoria
            ? `la historia diaria guardada empieza el ${inicioHistoria}: faltan días para cubrir ${nDias} (mínimo 80 % con dato); se completa sola con el tiempo`
            : a.motivoSD;
        return { ...a, motivoSD: motivo, nExcluidas: puntos.filter((p) => p.sospechosa).length };
    };

    return {
        puntos, fin, areal7: arma(7), areal30: arma(30), areal1: arma(1), arealHoy: arma('hoy'), fechaHoy, hoyEn: hoyEnGlobal,
        arealesLargas: { '60': arma(60), '90': arma(90), ciclo: arma('ciclo') }, inicioHistoria,
        vigentes: puntos.filter((p) => p.estado === 'vigente').length, total: puntos.length,
        conLluvia: puntos.filter((p) => p.mm30 != null && !p.sospechosa).length + propias.filter((p) => p.mm30 != null).length, propias,
    };
}
