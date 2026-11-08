// ═══════════════════════════════════════════════════════════════════════════
// Isolíneas y bandas por marching squares — puro, sin librerías de terceros
// ---------------------------------------------------------------------------
// Entrada: una malla regular de valores (centros de celda, j de norte a sur). Salida: anillos cerrados en lon/lat de la región
// "valor ≥ nivel". Pintando los niveles de menor a mayor (cada uno encima del anterior) se obtienen bandas rellenas SIN costuras y
// con un solo <path> por nivel (decenas de KB menos que un <rect> por celda). La malla debe traer al menos 2 celdas de margen fuera
// de la región de interés: el borde se rellena con -∞ y el recorte con el contorno de la cuenca se hace después (clipPath).
// ═══════════════════════════════════════════════════════════════════════════

export interface Malla { nx: number; ny: number; lon0: number; lat1: number; paso: number; valores: Float64Array }
export type Anillo = [number, number][];

const PAD = -1e12;

const val = (m: Malla, i: number, j: number) => (i < 0 || j < 0 || i >= m.nx || j >= m.ny ? PAD : m.valores[j * m.nx + i]);
const lonDe = (m: Malla, i: number) => m.lon0 + i * m.paso;
const latDe = (m: Malla, j: number) => m.lat1 - j * m.paso;

interface Seg { a: string; b: string; pa: [number, number]; pb: [number, number] }

/** Anillos de la región {valor ≥ nivel}. Los NaN de la malla cuentan como "por debajo de todo". */
export function regionMayorQue(m: Malla, nivel: number): Anillo[] {
    const segs: Seg[] = [];
    const v = (i: number, j: number) => { const x = val(m, i, j); return Number.isFinite(x) ? x : PAD; };
    // punto sobre la arista entre dos vértices (interpolación lineal; una arista con PAD cruza pegada al vértice válido)
    const cruce = (i1: number, j1: number, i2: number, j2: number): { k: string; p: [number, number] } => {
        const a = v(i1, j1), b = v(i2, j2);
        let t = b === a ? 0.5 : (nivel - a) / (b - a);
        t = Math.max(0, Math.min(1, t));
        const k = i1 === i2 ? `v${i1},${Math.min(j1, j2)}` : `h${Math.min(i1, i2)},${j1}`;
        return { k, p: [lonDe(m, i1 + (i2 - i1) * t), latDe(m, j1 + (j2 - j1) * t)] };
    };
    for (let j = -1; j < m.ny; j++) {
        for (let i = -1; i < m.nx; i++) {
            const tl = v(i, j), tr = v(i + 1, j), br = v(i + 1, j + 1), bl = v(i, j + 1);
            const caso = (tl >= nivel ? 8 : 0) | (tr >= nivel ? 4 : 0) | (br >= nivel ? 2 : 0) | (bl >= nivel ? 1 : 0);
            if (caso === 0 || caso === 15) continue;
            const T = () => cruce(i, j, i + 1, j), R = () => cruce(i + 1, j, i + 1, j + 1), B = () => cruce(i, j + 1, i + 1, j + 1), L = () => cruce(i, j, i, j + 1);
            const push = (x: { k: string; p: [number, number] }, y: { k: string; p: [number, number] }) => segs.push({ a: x.k, b: y.k, pa: x.p, pb: y.p });
            switch (caso) {
                case 1: case 14: push(L(), B()); break;
                case 2: case 13: push(B(), R()); break;
                case 3: case 12: push(L(), R()); break;
                case 4: case 11: push(T(), R()); break;
                case 6: case 9: push(T(), B()); break;
                case 7: case 8: push(L(), T()); break;
                case 5: case 10: {
                    // silla: el promedio del centro decide cómo se unen las esquinas
                    const centro = (tl + tr + br + bl) / 4 >= nivel;
                    if ((caso === 5) === centro) { push(L(), T()); push(B(), R()); } else { push(L(), B()); push(T(), R()); }
                    break;
                }
            }
        }
    }
    // unir segmentos por la clave de arista compartida
    const porClave = new Map<string, number[]>();
    segs.forEach((s, n) => { for (const k of [s.a, s.b]) { const l = porClave.get(k); if (l) l.push(n); else porClave.set(k, [n]); } });
    const usado = new Uint8Array(segs.length);
    const anillos: Anillo[] = [];
    for (let n0 = 0; n0 < segs.length; n0++) {
        if (usado[n0]) continue;
        usado[n0] = 1;
        const anillo: Anillo = [segs[n0].pa, segs[n0].pb];
        let fin = segs[n0].b;
        for (;;) {
            const sig = (porClave.get(fin) ?? []).find((n) => !usado[n]);
            if (sig === undefined) break;
            usado[sig] = 1;
            const s = segs[sig];
            if (s.a === fin) { anillo.push(s.pb); fin = s.b; } else { anillo.push(s.pa); fin = s.a; }
        }
        if (anillo.length >= 4) anillos.push(anillo);
    }
    return anillos;
}

/** Chaikin (corte de esquinas) para suavizar anillos cerrados sin desplazarlos más de un cuarto de celda. */
export function suavizaAnillo(a: Anillo, iteraciones = 2): Anillo {
    let p = a.length > 1 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1] ? a.slice(0, -1) : a.slice();
    for (let it = 0; it < iteraciones && p.length >= 3; it++) {
        const q: Anillo = [];
        for (let i = 0; i < p.length; i++) {
            const A = p[i], B = p[(i + 1) % p.length];
            q.push([0.75 * A[0] + 0.25 * B[0], 0.75 * A[1] + 0.25 * B[1]], [0.25 * A[0] + 0.75 * B[0], 0.25 * A[1] + 0.75 * B[1]]);
        }
        p = q;
    }
    return p;
}

export interface Rotulo { lon: number; lat: number; /** grados, en [-90, 90], en coordenadas de pantalla (y hacia abajo) */ angulo: number }

/**
 * Posición de un rótulo sobre una isolínea: el punto del anillo más largo que cumple `valido` (dentro de la cuenca y con cobertura),
 * lo más cercano al "medio" del anillo; el ángulo sigue la tangente local para que el texto corra a lo largo de la línea.
 */
export function rotuloEnAnillos(anillos: Anillo[], valido: (lon: number, lat: number) => boolean, latRef: number): Rotulo | null {
    const orden = anillos.map((a) => ({ a, n: a.length })).sort((x, y) => y.n - x.n);
    for (const { a } of orden) {
        if (a.length < 8) continue;
        const mitad = a.length >> 1;
        for (let d = 0; d < a.length; d++) {
            for (const i of d === 0 ? [mitad] : [(mitad + d) % a.length, (mitad - d + a.length) % a.length]) {
                const [lon, lat] = a[i], pa = a[(i - 2 + a.length) % a.length], pb = a[(i + 2) % a.length];
                if (!valido(lon, lat) || !valido(pa[0], pa[1]) || !valido(pb[0], pb[1])) continue;
                let ang = (Math.atan2(-(pb[1] - pa[1]), (pb[0] - pa[0]) * Math.cos((latRef * Math.PI) / 180)) * 180) / Math.PI;
                if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
                return { lon, lat, angulo: ang };
            }
        }
    }
    return null;
}

/** Path SVG ("M…L…Z") de varios anillos con una función de proyección; se rellena con fill-rule evenodd. */
export function anillosAPath(anillos: Anillo[], x: (lon: number) => number, y: (lat: number) => number): string {
    return anillos.map((r) => r.map(([lo, la], i) => `${i ? 'L' : 'M'}${x(lo).toFixed(1)},${y(la).toFixed(1)}`).join('') + 'Z').join('');
}
