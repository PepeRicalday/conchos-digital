// ═══════════════════════════════════════════════════════════════════════════
// Interpolación espacial de variables climáticas — SICA-005
// ---------------------------------------------------------------------------
// IDW (Inverse Distance Weighting, p=2) sobre las estaciones WeatherLink
// activas, para estimar temperatura/viento/radiación/precipitación en
// cualquier punto del distrito — en particular el centroide de los módulos
// que no tienen estación propia (Módulo 2, 4, 12).
//
// Elección de método (auditoría 2026-09-11, ver memoria de proyecto
// project_geo_climatico_interpolacion): con solo 5 estaciones dispersas de
// forma irregular sobre ~40×45 km, Kriging ordinario no es calibrable de
// forma estadísticamente seria (10 pares de puntos, muy por debajo del
// mínimo práctico para ajustar un variograma) y produciría una falsa
// precisión. Bilineal/spline está pensado para grilla regular, no para 5
// puntos dispersos. IDW p=2 es el estándar de facto en SIG (ArcGIS/QGIS) y
// no requiere calibrar ningún parámetro estadístico — apropiado con tan
// pocos puntos. Se usa el MISMO método para las 4 variables por decisión
// explícita del usuario (simplicidad de lectura del informe), aceptando que
// radiación solar y precipitación son físicamente menos "interpolables"
// (dominadas por nubosidad/convección local) que temperatura y viento — por
// eso cada módulo interpolado sigue etiquetándose "sin estación propia" en
// vez de presentarse con la misma confianza que un módulo con estación real.
//
// Regla no negociable: la dirección del viento es una variable CIRCULAR
// (0°=360°). Promediar/ponderar grados directamente es un error físico (ej.
// 350° y 10° promediarían a 180°, la dirección opuesta a ambas). Por eso el
// viento se descompone en componentes u/v ANTES de interpolar, y se
// reconstruye magnitud+dirección después — nunca se pondera el ángulo.
// ═══════════════════════════════════════════════════════════════════════════

export interface PuntoMuestra {
    nombre: string;
    lat: number;
    lon: number;
    valor: number;
}

/** Distancia aproximada en km entre dos puntos lat/lon (haversine). */
export function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * IDW clásico (p=2 por defecto): valor interpolado = promedio ponderado por
 * 1/distancia². Si el punto de destino coincide con una muestra (distancia
 * ~0), devuelve el valor medido exacto en vez de dividir por 0.
 */
export function idw(destino: { lat: number; lon: number }, muestras: PuntoMuestra[], potencia = 2): number | null {
    if (!muestras.length) return null;
    let sumaPesos = 0, sumaValores = 0;
    for (const m of muestras) {
        const d = distanciaKm(destino.lat, destino.lon, m.lat, m.lon);
        if (d < 0.05) return m.valor; // prácticamente en la misma estación
        const peso = 1 / Math.pow(d, potencia);
        sumaPesos += peso;
        sumaValores += peso * m.valor;
    }
    return sumaPesos > 0 ? sumaValores / sumaPesos : null;
}

/** Estación con lo mínimo necesario para interpolar (evita acoplar este
 *  módulo al tipo completo EstacionConLectura del hook de React). */
export interface EstacionMuestra {
    nombre: string;
    lat: number;
    lon: number;
    tempC: number | null;
    vientoMs: number | null;
    vientoDirDeg: number | null;
    radSolarWm2: number | null;
    lluviaDiaMm: number | null;
}

export interface ResultadoInterpolado {
    tempC: number | null;
    vientoMs: number | null;
    vientoDirDeg: number | null;
    radSolarWm2: number | null;
    lluviaDiaMm: number | null;
}

/**
 * Interpola las 4 variables en un punto de destino. El viento se descompone
 * en componentes u/v, se interpola cada una por separado con IDW, y se
 * reconstruye magnitud/dirección — nunca se hace IDW sobre viento_dir_deg
 * directamente (ver cabecera del archivo).
 */
export function interpolaClimaEnPunto(
    destino: { lat: number; lon: number },
    estaciones: EstacionMuestra[],
    potencia = 2,
): ResultadoInterpolado {
    const muestra = (campo: (e: EstacionMuestra) => number | null): PuntoMuestra[] =>
        estaciones
            .filter(e => campo(e) != null)
            .map(e => ({ nombre: e.nombre, lat: e.lat, lon: e.lon, valor: campo(e) as number }));

    const tempC = idw(destino, muestra(e => e.tempC), potencia);
    const radSolarWm2 = idw(destino, muestra(e => e.radSolarWm2), potencia);
    const lluviaDiaMm = idw(destino, muestra(e => e.lluviaDiaMm), potencia);

    // Viento: componentes u/v (convención meteorológica — "dirección" es de
    // dónde viene el viento, signo negativo al proyectar).
    const conViento = estaciones.filter(e => e.vientoMs != null && e.vientoDirDeg != null);
    let vientoMs: number | null = null, vientoDirDeg: number | null = null;
    if (conViento.length) {
        const rad = (d: number) => (d * Math.PI) / 180;
        const muestrasU: PuntoMuestra[] = conViento.map(e => ({
            nombre: e.nombre, lat: e.lat, lon: e.lon,
            valor: -(e.vientoMs as number) * Math.sin(rad(e.vientoDirDeg as number)),
        }));
        const muestrasV: PuntoMuestra[] = conViento.map(e => ({
            nombre: e.nombre, lat: e.lat, lon: e.lon,
            valor: -(e.vientoMs as number) * Math.cos(rad(e.vientoDirDeg as number)),
        }));
        const u = idw(destino, muestrasU, potencia);
        const v = idw(destino, muestrasV, potencia);
        if (u != null && v != null) {
            vientoMs = Math.sqrt(u * u + v * v);
            const dirRad = Math.atan2(-u, -v);
            vientoDirDeg = ((dirRad * 180) / Math.PI + 360) % 360;
        }
    }

    return { tempC, vientoMs, vientoDirDeg, radSolarWm2, lluviaDiaMm };
}

/** Estación más cercana a un punto (para reportar "fuente" / distancia en el
 *  informe, y como referencia de confianza — cuanto más lejos, menos fiable
 *  es el valor interpolado). */
export function estacionMasCercana<T extends { lat: number; lon: number }>(
    destino: { lat: number; lon: number }, estaciones: T[],
): { estacion: T; distanciaKm: number } | null {
    if (!estaciones.length) return null;
    let mejor = estaciones[0];
    let mejorD = distanciaKm(destino.lat, destino.lon, mejor.lat, mejor.lon);
    for (const e of estaciones.slice(1)) {
        const d = distanciaKm(destino.lat, destino.lon, e.lat, e.lon);
        if (d < mejorD) { mejor = e; mejorD = d; }
    }
    return { estacion: mejor, distanciaKm: mejorD };
}

/** Centroide simple (promedio de vértices) de un anillo [lon,lat]. */
export function centroideAnillo(anillo: [number, number][]): { lat: number; lon: number } {
    let lon = 0, lat = 0;
    for (const [lo, la] of anillo) { lon += lo; lat += la; }
    return { lat: lat / anillo.length, lon: lon / anillo.length };
}
