// ═══════════════════════════════════════════════════════════════════════════
// Geografía de la cuenca del río Conchos — fuente única del contorno
// ---------------------------------------------------------------------------
// public/geo/cuenca_conchos.geojson lo genera scripts/cuenca_a_geojson.mjs a partir de la capa oficial de subcuencas
// (INEGI-CONAGUA, RH24 cuencas J-N, difundida por CONABIO, CC BY-NC 2.5 MX). Misma proyección equirectangular local que
// usan los informes del distrito (x escalada por cos(latMedia)), sin teselas de terceros.
// ═══════════════════════════════════════════════════════════════════════════
import { dentroDelPoligono } from './vasoAnalisis';
import { distanciaKm } from './interpolacionClima';

export type Anillo = [number, number][];
/** Polígono GeoJSON: anillo exterior + huecos. */
export type PoligonoGeo = Anillo[];

export interface ContornoCuenca {
    poligonos: PoligonoGeo[];
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number };
    areaKm2: number | null;
    fuente: string;
}

/** Boca de la cuenca: confluencia del Conchos con el río Bravo, frente a Ojinaga (Chih.) / Presidio (Tex.). */
export const SALIDA_CUENCA = { nombre: 'Ojinaga (salida de la cuenca)', lat: 29.55, lon: -104.4 } as const;
/** Radio desde la boca dentro del cual una estación se considera "a la salida" aunque el polígono la deje justo fuera. */
export const RADIO_SALIDA_KM = 30;

export type ZonaCuenca = 'cuenca' | 'salida' | 'fuera';

/** Interpreta el GeoJSON del contorno. Devuelve null si no trae geometría utilizable (nunca un contorno vacío). */
export function interpretaContorno(fc: unknown): ContornoCuenca | null {
    const f = (fc as GeoJSON.FeatureCollection | null)?.features?.[0];
    const g = f?.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
    const poligonos = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as unknown as PoligonoGeo[];
    if (!poligonos.length || !poligonos[0]?.[0]?.length) return null;
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const p of poligonos) for (const [x, y] of p[0]) {
        if (x < minLon) minLon = x; if (x > maxLon) maxLon = x;
        if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
    }
    const props = (f?.properties ?? {}) as { area_km2?: number; fuente?: string };
    return { poligonos, bbox: { minLon, maxLon, minLat, maxLat }, areaKm2: Number.isFinite(props.area_km2) ? (props.area_km2 as number) : null, fuente: props.fuente ?? 'INEGI-CONAGUA' };
}

let promesa: Promise<ContornoCuenca | null> | null = null;

/** Descarga UNA vez por sesión el contorno de la cuenca; si falla no cachea el error (como contornosModulos). */
export function cargarContornoCuenca(): Promise<ContornoCuenca | null> {
    if (!promesa) {
        promesa = fetch('/geo/cuenca_conchos.geojson')
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => interpretaContorno(j))
            .catch(() => null)
            .then((c) => { if (!c) promesa = null; return c; });
    }
    return promesa;
}

/** ¿El punto (lon, lat) cae dentro de la cuenca? Valores no finitos → false (S/D no es "dentro"). */
export function dentroDeCuenca(c: ContornoCuenca, lon: number | null | undefined, lat: number | null | undefined): boolean {
    if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    const b = c.bbox;
    if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) return false;
    return c.poligonos.some((p) => dentroDelPoligono(p, lon, lat));
}

/**
 * Zona de una estación: "salida" (≤ RADIO_SALIDA_KM de la boca), "cuenca" (dentro del polígono) o "fuera".
 * La salida se evalúa primero: el contorno simplificado pasa por la boca y un pluviómetro a unos metros del borde
 * (Ojinaga) caería a uno u otro lado según el redondeo de sus coordenadas.
 */
export function zonaDeEstacion(c: ContornoCuenca, lon: number | null | undefined, lat: number | null | undefined): ZonaCuenca {
    if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return 'fuera';
    if (distanciaKm(lat, lon, SALIDA_CUENCA.lat, SALIDA_CUENCA.lon) <= RADIO_SALIDA_KM) return 'salida';
    return dentroDeCuenca(c, lon, lat) ? 'cuenca' : 'fuera';
}

export interface ProyectorMapa { x: (lon: number) => number; y: (lat: number) => number; ancho: number; alto: number }

/** Proyección equirectangular que encuadra `bbox` (con margen relativo) dentro de un lienzo W × (alto proporcional, máx. `altoMax`). */
export function proyectorCuenca(bbox: ContornoCuenca['bbox'], W: number, margen = 0.04, altoMax = 1400): ProyectorMapa {
    const cosLat = Math.cos(((bbox.minLat + bbox.maxLat) / 2) * Math.PI / 180);
    const spanLon = (bbox.maxLon - bbox.minLon) * cosLat * (1 + margen * 2);
    const spanLat = (bbox.maxLat - bbox.minLat) * (1 + margen * 2);
    const k = W / spanLon;
    const alto = Math.min(altoMax, Math.round(spanLat * k));
    const kk = Math.min(k, alto / spanLat);
    const offX = (W - spanLon * kk) / 2, offY = (alto - spanLat * kk) / 2;
    const lon0 = bbox.minLon - (bbox.maxLon - bbox.minLon) * margen;
    const lat1 = bbox.maxLat + (bbox.maxLat - bbox.minLat) * margen;
    return { x: (lon) => offX + (lon - lon0) * cosLat * kk, y: (lat) => offY + (lat1 - lat) * kk, ancho: W, alto };
}

/** Path SVG ("M…L…Z") de un anillo con el proyector dado. */
export function anilloAPath(anillo: Anillo, p: ProyectorMapa): string {
    return anillo.map(([lo, la], i) => `${i ? 'L' : 'M'}${p.x(lo).toFixed(1)},${p.y(la).toFixed(1)}`).join('') + 'Z';
}
