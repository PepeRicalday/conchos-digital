// ═══════════════════════════════════════════════════════════════════════════
// Campos continuos (lluvia, temperatura, viento, humedad) sobre la cuenca del Conchos — puro
// ---------------------------------------------------------------------------
// IDW p=2 sobre las estaciones útiles, con máscara de COBERTURA: donde ninguna estación útil queda a ≤ radioKm el campo no se pinta
// (se dibuja con trama) y no entra a las estadísticas — nunca se inventa un valor lejos de toda medición. Una estación por ciudad (la
// del grupo ya viene colapsada), sospechosas fuera, S/D nunca 0, y con < minPuntos estaciones o < minCoberturaPct del área el resultado es
// S/D con su motivo.
// Ajuste por altitud (opcional): residuos de una regresión valor~elevación con la elevación del DEM (no la de JCAS, que no es confiable);
// solo se aplica con n ≥ 12 y R² ≥ 0.5, y se declara con su R² y n.
// ═══════════════════════════════════════════════════════════════════════════
import { distanciaKm } from './interpolacionClima';
import { dentroDeCuenca, type ContornoCuenca } from './geoCuenca';
import type { Malla } from './isolineas';

export interface PuntoCampo {
    id: string;
    nombre: string;
    lat: number;
    lon: number;
    /** null = S/D. */
    valor: number | null;
    /** Elevación del DEM (m), no la que reporta la fuente. */
    elevM?: number | null;
    sospechosa?: boolean;
}

/** Malla de elevación generada por scripts/cuenca_dem_grid.mjs (public/geo/cuenca_dem_grid.json). */
export interface DemGrid { paso_grados: number; lon0: number; lat1: number; nx: number; ny: number; valores: (number | null)[][] }

export interface OpcionesCampo {
    paso?: number;
    radioKm?: number;
    potencia?: number;
    minPuntos?: number;
    minCoberturaPct?: number;
    piso?: number | null;
    techo?: number | null;
    dem?: DemGrid | null;
    ajusteAltitud?: 'auto' | 'no';
}

export interface AjusteAltitud { aplicado: boolean; n: number; r2: number | null; pendientePor100m: number | null; motivo: string }

export interface CampoCuenca {
    malla: Malla;
    /** true = hay estación útil a ≤ radioKm Y la celda está dentro de la cuenca. */
    cubierta: Uint8Array;
    dentro: Uint8Array;
    coberturaPct: number;
    nEstaciones: number;
    media: number | null; min: number | null; max: number | null;
    ajuste: AjusteAltitud;
    motivoSD: string | null;
}

export const MIN_PUNTOS_CAMPO = 5;
export const MIN_COBERTURA_CAMPO_PCT = 50;
export const RADIO_CAMPO_KM = 90;
export const MIN_PUNTOS_AJUSTE = 12;
export const MIN_R2_AJUSTE = 0.5;

/** Elevación del DEM en (lon, lat) por interpolación bilineal; si falta una esquina usa la celda válida más cercana; null fuera de la malla. */
export function elevacionDem(dem: DemGrid | null | undefined, lon: number, lat: number): number | null {
    if (!dem) return null;
    const fx = (lon - dem.lon0) / dem.paso_grados, fy = (dem.lat1 - lat) / dem.paso_grados;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0;
    const g = (i: number, j: number) => (i >= 0 && j >= 0 && i < dem.nx && j < dem.ny ? dem.valores[j]?.[i] ?? null : null);
    const c = [g(i0, j0), g(i0 + 1, j0), g(i0, j0 + 1), g(i0 + 1, j0 + 1)];
    if (c.every((x) => x != null)) {
        const [a, b, d, e] = c as number[];
        return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + d * (1 - tx) * ty + e * tx * ty;
    }
    let mejor: number | null = null, dist = Infinity;
    for (const [di, dj, v] of [[0, 0, c[0]], [1, 0, c[1]], [0, 1, c[2]], [1, 1, c[3]]] as [number, number, number | null][]) {
        if (v == null) continue;
        const d2 = (tx - di) ** 2 + (ty - dj) ** 2;
        if (d2 < dist) { dist = d2; mejor = v; }
    }
    return mejor;
}

/** Regresión lineal simple valor~elevación. null si no hay varianza. */
export function regresionAltitud(pts: { elev: number; valor: number }[]): { a: number; b: number; r2: number } | null {
    const n = pts.length;
    if (n < 3) return null;
    const mx = pts.reduce((s, p) => s + p.elev, 0) / n, my = pts.reduce((s, p) => s + p.valor, 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) { sxx += (p.elev - mx) ** 2; sxy += (p.elev - mx) * (p.valor - my); syy += (p.valor - my) ** 2; }
    if (sxx === 0 || syy === 0) return null;
    const b = sxy / sxx;
    return { a: my - b * mx, b, r2: (sxy * sxy) / (sxx * syy) };
}

export function construirCampo(puntos: PuntoCampo[], contorno: ContornoCuenca, op: OpcionesCampo = {}): CampoCuenca {
    const paso = op.paso ?? 0.05, radio = op.radioKm ?? RADIO_CAMPO_KM, pot = op.potencia ?? 2;
    const minPuntos = op.minPuntos ?? MIN_PUNTOS_CAMPO, minCob = op.minCoberturaPct ?? MIN_COBERTURA_CAMPO_PCT;
    const b = contorno.bbox, margen = 2 * paso;
    const lon0 = Math.floor((b.minLon - margen) / paso) * paso, lat1 = Math.ceil((b.maxLat + margen) / paso) * paso;
    const nx = Math.ceil((b.maxLon + margen - lon0) / paso) + 1, ny = Math.ceil((lat1 - (b.minLat - margen)) / paso) + 1;
    const malla: Malla = { nx, ny, lon0, lat1, paso, valores: new Float64Array(nx * ny).fill(NaN) };
    const cubierta = new Uint8Array(nx * ny), dentro = new Uint8Array(nx * ny);

    const utiles = puntos.filter((p) => p.valor != null && Number.isFinite(p.valor) && !p.sospechosa);
    const base = { malla, cubierta, dentro, nEstaciones: utiles.length, media: null, min: null, max: null, coberturaPct: 0 };
    const sinAjuste = (motivo: string): AjusteAltitud => ({ aplicado: false, n: 0, r2: null, pendientePor100m: null, motivo });

    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (dentroDeCuenca(contorno, lon0 + i * paso, lat1 - j * paso)) dentro[j * nx + i] = 1;
    }
    if (utiles.length < minPuntos) {
        return { ...base, ajuste: sinAjuste('sin ajuste: pocas estaciones'), motivoSD: `solo ${utiles.length} estación(es) con dato útil (mínimo ${minPuntos})` };
    }

    // ajuste por altitud (solo con elevación del DEM de todas las estaciones útiles)
    let ajuste = sinAjuste(op.dem ? 'sin ajuste: no solicitado' : 'sin ajuste: sin DEM');
    let reg: { a: number; b: number; r2: number } | null = null;
    const conElev = utiles.filter((p) => p.elevM != null) as (PuntoCampo & { elevM: number; valor: number })[];
    if (op.ajusteAltitud === 'auto' && op.dem) {
        if (conElev.length < MIN_PUNTOS_AJUSTE) ajuste = { ...sinAjuste(`sin ajuste: ${conElev.length} estaciones con elevación (mínimo ${MIN_PUNTOS_AJUSTE})`), n: conElev.length };
        else {
            const r = regresionAltitud(conElev.map((p) => ({ elev: p.elevM, valor: p.valor })));
            if (!r) ajuste = { ...sinAjuste('sin ajuste: sin variación'), n: conElev.length };
            else if (r.r2 < MIN_R2_AJUSTE) ajuste = { aplicado: false, n: conElev.length, r2: r.r2, pendientePor100m: r.b * 100, motivo: `sin ajuste: R² = ${r.r2.toFixed(2)} (mínimo ${MIN_R2_AJUSTE})` };
            else { reg = r; ajuste = { aplicado: true, n: conElev.length, r2: r.r2, pendientePor100m: r.b * 100, motivo: `ajustado por altitud (R² = ${r.r2.toFixed(2)}, n = ${conElev.length})` }; }
        }
    }
    const residuos = reg ? conElev.map((p) => ({ ...p, valor: p.valor - (reg!.a + reg!.b * p.elevM) })) : null;

    let suma = 0, nCub = 0, nDentro = 0, mn = Infinity, mx = -Infinity;
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
            const lon = lon0 + i * paso, lat = lat1 - j * paso, k = j * nx + i;
            let sw = 0, sv = 0, sr = 0, cerca = false, exacto: number | null = null;
            for (const p of utiles) {
                const d = distanciaKm(lat, lon, p.lat, p.lon);
                if (d <= radio) cerca = true;
                if (d < 0.05) { exacto = p.valor as number; break; }
                const w = 1 / Math.pow(d, pot);
                sw += w; sv += w * (p.valor as number);
            }
            let v = exacto ?? (sw > 0 ? sv / sw : NaN);
            if (reg && residuos) {
                const e = elevacionDem(op.dem, lon, lat);
                if (e != null) {
                    sw = 0; sr = 0;
                    for (const p of residuos) { const d = Math.max(distanciaKm(lat, lon, p.lat, p.lon), 0.05); const w = 1 / Math.pow(d, pot); sw += w; sr += w * p.valor; }
                    v = reg.a + reg.b * e + (sw > 0 ? sr / sw : 0);
                }
            }
            if (Number.isFinite(v)) {
                if (op.piso != null && v < op.piso) v = op.piso;
                if (op.techo != null && v > op.techo) v = op.techo;
            }
            malla.valores[k] = v;
            if (dentro[k]) {
                nDentro++;
                if (cerca) { cubierta[k] = 1; nCub++; suma += v; mn = Math.min(mn, v); mx = Math.max(mx, v); }
            }
        }
    }
    const cob = nDentro ? (nCub / nDentro) * 100 : 0;
    if (cob < minCob) return { ...base, cubierta, coberturaPct: cob, ajuste, motivoSD: `las estaciones cubren solo el ${cob.toFixed(0)} % del área (mínimo ${minCob} %)` };
    return { ...base, cubierta, coberturaPct: cob, ajuste, motivoSD: null, media: suma / nCub, min: mn, max: mx };
}

let promesaDem: Promise<DemGrid | null> | null = null;
/** Descarga una vez por sesión la malla de elevación; si falla no cachea el error. */
export function cargarDemCuenca(): Promise<DemGrid | null> {
    if (!promesaDem) {
        promesaDem = fetch('/geo/cuenca_dem_grid.json').then((r) => (r.ok ? (r.json() as Promise<DemGrid>) : null)).catch(() => null)
            .then((d) => { if (!d) promesaDem = null; return d; });
    }
    return promesaDem;
}
