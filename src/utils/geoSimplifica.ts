/**
 * geoSimplifica — simplificación de Douglas-Peucker en METROS para contornos y líneas del plano del informe.
 * Reemplaza el submuestreo "uno de cada n vértices" (que recortaba esquinas al azar y podía abrir huecos entre módulos
 * vecinos): DP conserva los vértices que se desvían más de la tolerancia y descarta los que no se ven a la escala del plano.
 * Los vértices compartidos por dos o más anillos (nodos de frontera común) se conservan siempre como anclas, de modo que los
 * vecinos coinciden en esos puntos; entre anclas, ambos anillos se desvían del original como máximo la tolerancia.
 */
export type Punto = [number, number];

const M_POR_GRADO_LAT = 111_320;

/** Distancia (m) de p al segmento a–b en una proyección local plana (lon escalada por cos(lat)). */
function distSegM(p: Punto, a: Punto, b: Punto, cosLat: number): number {
    const x = (q: Punto) => q[0] * cosLat * M_POR_GRADO_LAT, y = (q: Punto) => q[1] * M_POR_GRADO_LAT;
    const px = x(p), py = y(p), ax = x(a), ay = y(a), bx = x(b), by = y(b);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** DP clásico sobre una polilínea abierta (conserva extremos y los índices de `anclas`). Iterativo: sin recursión profunda. */
export function simplificarLineaDP(linea: Punto[], tolM: number, anclas: ReadonlySet<number> = new Set()): Punto[] {
    const n = linea.length;
    if (n <= 2) return linea.slice();
    const cosLat = Math.cos((linea.reduce((s, p) => s + p[1], 0) / n) * Math.PI / 180);
    const guardar = new Uint8Array(n);
    guardar[0] = 1; guardar[n - 1] = 1;
    anclas.forEach((i) => { if (i >= 0 && i < n) guardar[i] = 1; });
    const pila: [number, number][] = [[0, n - 1]];
    while (pila.length) {
        const [i, j] = pila.pop() as [number, number];
        if (j <= i + 1) continue;
        let maxD = -1, k = -1;
        for (let m = i + 1; m < j; m++) {
            if (guardar[m]) { // un ancla interna parte el tramo en dos
                pila.push([i, m], [m, j]);
                k = -2; break;
            }
            const d = distSegM(linea[m], linea[i], linea[j], cosLat);
            if (d > maxD) { maxD = d; k = m; }
        }
        if (k === -2) continue;
        if (maxD > tolM) { guardar[k] = 1; pila.push([i, k], [k, j]); }
    }
    return linea.filter((_, i) => guardar[i]);
}

const llave = (p: Punto) => `${p[0]},${p[1]}`;

/**
 * Simplifica anillos cerrados (el último punto repite el primero) con DP. `anillos` puede mezclar anillos de módulos vecinos:
 * los vértices que aparecen en más de un anillo se conservan como anclas. Devuelve anillos cerrados de al menos 4 puntos.
 */
export function simplificarAnillosDP(anillos: Punto[][], tolM: number): Punto[][] {
    const veces = new Map<string, number>();
    anillos.forEach((a) => { new Set(a.map(llave)).forEach((k) => veces.set(k, (veces.get(k) ?? 0) + 1)); });
    return anillos.map((a) => {
        if (a.length <= 4) return a.slice();
        const abierto = a.slice(0, -1);
        // Anclas: nodos compartidos con otros anillos y el vértice más alejado del primero (para que el anillo no colapse).
        const anclas = new Set<number>();
        abierto.forEach((p, i) => { if ((veces.get(llave(p)) ?? 0) > 1) anclas.add(i); });
        let lejos = 0, dMax = -1;
        const cosLat = Math.cos((abierto.reduce((s, p) => s + p[1], 0) / abierto.length) * Math.PI / 180);
        abierto.forEach((p, i) => { const d = Math.hypot((p[0] - abierto[0][0]) * cosLat, p[1] - abierto[0][1]); if (d > dMax) { dMax = d; lejos = i; } });
        anclas.add(lejos);
        const s = simplificarLineaDP([...abierto, abierto[0]], tolM, anclas);
        return s.length >= 4 ? s : a.slice();
    });
}

/** Distancia máxima (m) de los vértices de `original` a la polilínea `simple` (para probar la cota de error). */
export function desviacionMaximaM(original: Punto[], simple: Punto[]): number {
    const cosLat = Math.cos((original.reduce((s, p) => s + p[1], 0) / original.length) * Math.PI / 180);
    let max = 0;
    for (const p of original) {
        let mejor = Infinity;
        for (let i = 0; i < simple.length - 1; i++) mejor = Math.min(mejor, distSegM(p, simple[i], simple[i + 1], cosLat));
        max = Math.max(max, mejor);
    }
    return max;
}
