// ═══════════════════════════════════════════════════════════════════════════
// Modelo de vista de la red JCAS en la cuenca del Conchos — puro (el hook solo trae filas)
// ---------------------------------------------------------------------------
// Une jcas_estaciones + jcas_lecturas_diarias con las reglas de utils/jcasCuenca.ts. Lo usan el panel de pantalla y,
// más adelante, el informe: una sola definición para que las cifras nunca diverjan. Contexto de fuente TERCERA, provisional.
// ═══════════════════════════════════════════════════════════════════════════
import {
    acumuladoLluvia, colapsarGrupos, lluviaAreal, marcarSospechosos, type LluviaAreal, type PuntoLluvia,
} from './jcasCuenca';
import type { PoligonoGeo, ZonaCuenca } from './geoCuenca';

export interface FilaEstacionJcas {
    id_jcas: number; nombre: string; latitud: number; longitud: number; altitud_m: number | null;
    zona: ZonaCuenca; grupo_ciudad: string | null; tiene_pluviometro: boolean; activa: boolean; ult_fecha: string | null;
    /** Elevación del DEM (m); la altitud que reporta JCAS no es confiable. */
    elevacion_dem_m?: number | null;
}
export interface FilaLecturaJcas { estacion_id: number; fecha: string; lluvia_mm: number | null; temp_c: number | null; hum_pct?: number | null; viento_kmh?: number | null }

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
    /** Promedios de la ventana (≥ 80 % de los días con dato; si no, null = S/D). */
    medias: { temp7: number | null; temp30: number | null; hum7: number | null; hum30: number | null; viento7: number | null; viento30: number | null };
}

export interface ModeloRedJcas {
    puntos: PuntoRedJcas[];
    /** Último día COMPLETO sobre el que se calculan los acumulados (ayer, hora local conservadora). */
    fin: string;
    areal7: LluviaAreal; areal30: LluviaAreal;
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

const ISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Una estación con su último día completo a más de 3 días del corte se considera atrasada. */
export const DIAS_ATRASO = 3;

export function construirRedJcas(
    estaciones: FilaEstacionJcas[], lecturas: FilaLecturaJcas[], hoyLocalISO: string, poligonos: PoligonoGeo[],
): ModeloRedJcas {
    const fin = ISO(Date.parse(`${hoyLocalISO}T00:00:00Z`) - 86_400_000);
    const porEst = new Map<number, FilaLecturaJcas[]>();
    for (const l of lecturas) porEst.set(l.estacion_id, [...(porEst.get(l.estacion_id) ?? []), l]);

    const base: (PuntoLluvia & { grupo: string | null })[] = [];
    const puntos: PuntoRedJcas[] = estaciones.map((e) => {
        const ls = porEst.get(e.id_jcas) ?? [];
        const dias = ls.map((l) => ({ fecha: l.fecha, lluviaMm: e.tiene_pluviometro ? l.lluvia_mm : null }));
        const a7 = e.tiene_pluviometro ? acumuladoLluvia(dias, fin, 7) : { mm: null, diasConDato: 0 };
        const a30 = e.tiene_pluviometro ? acumuladoLluvia(dias, fin, 30) : { mm: null, diasConDato: 0 };
        const conDato = ls.filter((l) => l.temp_c != null || l.lluvia_mm != null).map((l) => l.fecha).sort();
        const ult = conDato.length ? conDato[conDato.length - 1] : e.ult_fecha;
        const atraso = ult ? Math.max(0, diasEntre(ult, fin)) : null;
        const ultTemp = [...ls].sort((x, y) => y.fecha.localeCompare(x.fecha)).find((l) => l.temp_c != null)?.temp_c ?? null;
        base.push({ id: String(e.id_jcas), fuente: 'jcas', nombre: e.nombre, lat: e.latitud, lon: e.longitud, mm: a30.mm, grupo: e.grupo_ciudad });
        return {
            id: e.id_jcas, nombre: e.nombre, lat: e.latitud, lon: e.longitud, altitudM: e.altitud_m, zona: e.zona, grupo: e.grupo_ciudad,
            sinPluviometro: !e.tiene_pluviometro, mm7: a7.mm, mm30: a30.mm, diasConDato30: a30.diasConDato,
            ultFecha: ult, atrasoDias: atraso, estado: ult == null ? 'sin-datos' : (atraso ?? 99) <= DIAS_ATRASO ? 'vigente' : 'atrasada',
            sospechosa: false, motivo: null, tempUltima: ultTemp, elevM: e.elevacion_dem_m ?? null,
            medias: {
                temp7: mediaVentana(ls, 'temp_c', fin, 7), temp30: mediaVentana(ls, 'temp_c', fin, 30),
                hum7: mediaVentana(ls, 'hum_pct', fin, 7), hum30: mediaVentana(ls, 'hum_pct', fin, 30),
                viento7: mediaVentana(ls, 'viento_kmh', fin, 7), viento30: mediaVentana(ls, 'viento_kmh', fin, 30),
            },
        };
    });

    // Pluviómetros que marcan 0 mm en 30 días mientras sus vecinas registran lluvia: fuera del promedio (en 7 y 30 días).
    const marcadas = marcarSospechosos(base, 30);
    const sosp = new Map(marcadas.filter((p) => p.sospechosa).map((p) => [p.id, p.motivo ?? '']));
    for (const p of puntos) { const m = sosp.get(String(p.id)); if (m != null) { p.sospechosa = true; p.motivo = m; } }

    const arma = (ventana: 7 | 30): LluviaAreal => {
        const pts = colapsarGrupos(puntos.map((p) => ({
            id: String(p.id), fuente: 'jcas' as const, nombre: p.nombre, lat: p.lat, lon: p.lon,
            mm: p.sospechosa || p.sinPluviometro ? null : (ventana === 7 ? p.mm7 : p.mm30), grupo: p.grupo,
        })));
        // El promedio se calcula DENTRO del polígono de la cuenca; Ojinaga (a la salida) aporta como vecina en el borde.
        return { ...lluviaAreal(poligonos, pts, ventana), nExcluidas: puntos.filter((p) => p.sospechosa).length };
    };

    return {
        puntos, fin, areal7: arma(7), areal30: arma(30),
        vigentes: puntos.filter((p) => p.estado === 'vigente').length, total: puntos.length,
        conLluvia: puntos.filter((p) => p.mm30 != null && !p.sospechosa).length,
    };
}
