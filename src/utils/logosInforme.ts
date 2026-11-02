/**
 * logosInforme — logos de los informes institucionales como data URI, ya optimizados y con caché en memoria.
 * Los originales (public/logos/logo-srl.png —en realidad un JPEG de 399×348— y SICA005.png de 151×157) pesaban ≈ 125 KB en
 * base64 y eran el 65 % del HTML del informe. Las versiones "-informe" están regeneradas al doble del tamaño efectivo
 * (52 px de alto → 104 px) con mejor compresión: ≈ 12 KB en total sin perder nitidez en pantalla ni en impresión.
 * Un fallo de carga NO se guarda en la caché: la siguiente generación vuelve a intentarlo.
 * El emblema SICA 005 es SVG vectorial. Todos los informes lo toman de aquí.
 */
import { assetToDataURI } from './assetToDataURI';

/** Escudo SRL vectorizado (scripts/logo/generar-logo-srl.mjs): marrón institucional, sin caja blanca, nítido a cualquier tamaño. */
export const RUTA_LOGO_SRL_INFORME = '/logos/srl/logo-srl.svg';
/** Mismo escudo en crema, para fondos oscuros (el marrón sobre navy da 1,5-1,8:1). */
export const RUTA_LOGO_SRL_CLARO_INFORME = '/logos/srl/logo-srl-claro.svg';
/** Emblema vectorial SICA 005 (scripts/logo/generar-logo-sica.mjs), cuadrado y sin leyendas: el membrete lo pinta a 52 px. */
export const RUTA_LOGO_SICA_INFORME = '/logos/sica/sica005-emblema.svg';

export interface LogosData { srl: string; sica: string }

let cache: Promise<LogosData> | null = null;

/** Logos del informe (data URI); cadena vacía donde no se pudo cargar. Se comparten entre generaciones. */
export function cargarLogosInforme(): Promise<LogosData> {
    if (!cache) {
        cache = Promise.all([assetToDataURI(RUTA_LOGO_SRL_INFORME), assetToDataURI(RUTA_LOGO_SICA_INFORME)]).then(([srl, sica]) => {
            if (!srl || !sica) cache = null;
            return { srl, sica };
        });
    }
    return cache;
}

/** Escudo SRL en versión clara (data URI SVG) para informes sobre fondo oscuro. Caché propia: solo se pide cuando se usa. */
let cacheClaro: Promise<string> | null = null;
export function cargarLogoSrlClaroInforme(): Promise<string> {
    if (!cacheClaro) cacheClaro = assetToDataURI(RUTA_LOGO_SRL_CLARO_INFORME).then((d) => { if (!d) cacheClaro = null; return d; });
    return cacheClaro;
}

/** Solo el escudo SRL (data URI SVG). Comparte la caché. */
export async function cargarLogoSrlInforme(): Promise<string> {
    return (await cargarLogosInforme()).srl;
}

/** Solo el emblema SICA 005 (data URI SVG), para informes que cargan su propio logo SRL. Comparte la caché. */
export async function cargarLogoSicaInforme(): Promise<string> {
    return (await cargarLogosInforme()).sica;
}

/** Solo para pruebas: vacía la caché. */
export function reiniciarCacheLogos(): void { cache = null; cacheClaro = null; }
