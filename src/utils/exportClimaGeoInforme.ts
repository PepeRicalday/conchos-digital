// ═══════════════════════════════════════════════════════════════════════════
// INFORME GEOCLIMÁTICO POR MÓDULO — SICA-005
// ---------------------------------------------------------------------------
// Informe HTML autónomo con un mapa por variable (temperatura, viento,
// radiación solar, precipitación), coloreando la geofrontera real de los 6
// módulos de la SRL Conchos según el valor interpolado (IDW p=2, ver
// utils/interpolacionClima.ts) desde las estaciones WeatherLink activas.
//
// Principio de fuente única aplicado aquí: un módulo con estación propia
// (1, 3, 5) muestra su lectura MEDIDA; un módulo sin estación (2, 4, 12)
// muestra un valor INTERPOLADO y se etiqueta siempre como tal (tramado en el
// mapa + badge en la tabla) — nunca se presenta una estimación con la misma
// confianza visual que una medición.
//
// Lenguaje visual: hereda deliberadamente el mismo sistema de diseño que el
// informe oficial (exportClimaReport.ts) — mismo header de 2 logos, mismo
// h2/tabla con cabecera marrón institucional, mismo footer — para que se lea
// como parte de la misma familia de documentos, no un producto aparte
// (auditoría de diseño 2026-09-11, ver memoria de proyecto
// project_geo_climatico_interpolacion).
// ═══════════════════════════════════════════════════════════════════════════
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';
import { MODULOS_SRL } from './geoDistrito';
import {
    interpolaClimaEnPunto, centroideAnillo, estacionMasCercana,
    type EstacionMuestra,
} from './interpolacionClima';
import { formateaEdad } from './cielo';
import { VIZ, graficaEvolucionMensual } from './climaCharts';
import { tablaPrecipitacion, NOTA_TABLA_PRECIPITACION } from './tablaPrecipitacion';
import { assetToDataURI } from './assetToDataURI';
import { guardaOComparte } from './descargaArchivo';
import { getTodayString } from './dateHelpers';

const SRL_MARRON = '#6B2D2D';

/** Qué variables incluir — elegido en el modal previo a la descarga
 *  (Clima.tsx). El mapa de cada variable es SIEMPRE del corte actual (última
 *  lectura); ya no existe un modo "mes específico" separado — en su lugar,
 *  cada bloque de variable incluye además una gráfica de evolución histórica
 *  mes a mes (ver `serieMensual` abajo), independiente del corte del mapa. */
export interface OpcionesGeoInforme {
    variables: Array<VariableMapa['clave']>;
    /**
     * Serie histórica mes a mes por estación, para la gráfica de EVOLUCIÓN
     * que acompaña cada mapa (temperatura/viento/radiación: promedio del
     * mes; precipitación: acumulado del mes — nunca promedio, ver
     * utils/climaResumenMensual.ts). Se resuelve en Clima.tsx (que sí puede
     * tocar Supabase) y llega aquí ya calculada, para que este archivo siga
     * sin depender de la conexión a BD (ver assetToDataURI.ts/nombreMes.ts,
     * mismo motivo: mantenerlo probable fuera de la UI). Opcional: si no
     * llega o viene vacía, el bloque de variable simplemente no muestra la
     * gráfica de evolución (el mapa del corte actual sí se muestra siempre).
     */
    serieMensual?: Array<{ anio: number; mes: number; estacionId: string; estacionNombre: string;
        tempCProm: number | null; vientoMsProm: number | null; radSolarWm2Prom: number | null; lluviaMmAcumulada: number | null }>;
}

/** Escapa texto para insertarlo dentro de SVG/HTML — un nombre de estación
 *  con "&" o "<" en la BD no debe poder romper el documento completo. */
function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Módulos SRL con estación propia (medición real) — el resto (2, 4, 12) se
 *  resuelve por interpolación y se marca explícitamente como tal. */
const MODULOS_CON_ESTACION: Record<number, string> = { 1: 'Módulo 1', 3: 'Módulo 3', 5: 'Módulo 5' };

interface VariableMapa {
    clave: 'tempC' | 'vientoMs' | 'radSolarWm2' | 'lluviaDiaMm';
    titulo: string;
    unidad: string;
    /** Rampa secuencial de dos hues, claro→oscuro (bajo→alto), 8 pasos. */
    rampa: string[];
    /**
     * Rango de RESPALDO cuando no hay datos suficientes para calcular un
     * rango dinámico (ver rangoDelCorte) — nunca es el rango que realmente
     * colorea el mapa en el caso normal.
     */
    minFallback: number; maxFallback: number;
    /** Piso de amplitud del rango dinámico — evita que una diferencia real
     *  de 0.1° entre estaciones (ruido de sensor) se estire a todo el
     *  contraste de la rampa como si fuera una diferencia significativa. */
    amplitudMinima: number;
    fmt: (v: number) => string;
}

// Rampas de 2 HUES por variable (no arcoíris multi-hue): un tono pálido de
// arranque hasta un segundo hue más intenso en el extremo alto, dentro de la
// misma familia perceptual (cálido→cálido más oscuro, frío→frío más oscuro)
// — da mucho más contraste visual que 5 pasos de un solo tono plano, sin caer
// en el problema de orden perceptual del arcoíris completo (verde/rojo/azul
// mezclados sin jerarquía). 8 pasos para un degradado fino en el raster
// continuo. Viento usa morado/violeta (no verde, que ya usaba una iteración
// anterior y podía leerse como "vegetación/normal") — familia de color
// exclusiva para esta variable, distinta de rojo=temperatura, ámbar=radiación,
// azul=precipitación (auditoría de diseño 2026-09-12).
const VARIABLES: VariableMapa[] = [
    { clave: 'tempC', titulo: 'Temperatura', unidad: '°C', rampa: ['#fff6e0', '#fde3ad', '#fbc178', '#f59349', '#e2622c', '#c13a1f', '#8f1f16', '#5c0f0f'], minFallback: 5, maxFallback: 42, amplitudMinima: 3, fmt: v => v.toFixed(1) },
    { clave: 'vientoMs', titulo: 'Viento (velocidad)', unidad: 'm/s', rampa: ['#f5f0fa', '#ddc9ee', '#c19ee0', '#a06fcf', '#8247bd', '#652da0', '#481d78', '#2c0f4d'], minFallback: 0, maxFallback: 12, amplitudMinima: 2, fmt: v => v.toFixed(1) },
    { clave: 'radSolarWm2', titulo: 'Radiación solar', unidad: 'W/m²', rampa: ['#fffae0', '#fdedad', '#fbd873', '#f7ba3f', '#e8941e', '#c26a10', '#8f4308', '#5c2604'], minFallback: 0, maxFallback: 1000, amplitudMinima: 100, fmt: v => v.toFixed(0) },
    // "No llovió" debe leerse claramente distinto de "llovió": arranca en un
    // gris casi neutro (no azul pálido, que ya se leería como "algo de agua")
    // y solo entra en la familia azul una vez que hay lámina real.
    { clave: 'lluviaDiaMm', titulo: 'Precipitación (día)', unidad: 'mm', rampa: ['#eef1f4', '#dbe8f5', '#b3d3f0', '#7fb5e8', '#4a90da', '#2465b8', '#123f85', '#0a2456'], minFallback: 0, maxFallback: 30, amplitudMinima: 2, fmt: v => v.toFixed(1) },
];

/**
 * Rango de color EFECTIVO para este corte: min/max real entre las
 * estaciones activas, con margen del 10% a cada lado y un piso de amplitud
 * (`amplitudMinima`) para no exagerar diferencias que son solo ruido de
 * sensor. Nunca fijo — antes un rango institucional amplio (ej. 5-42°C)
 * hacía que una diferencia real de 1.5°C entre estaciones (26.6 vs 28.1°C)
 * cayera casi en el mismo escalón de color y el mapa se viera plano incluso
 * en presencia de variación real (detectado por el usuario comparando
 * capturas de pantalla, no por lectura de código). SIEMPRE se declara el
 * rango exacto en la leyenda — nunca se "memoriza" naranja=30° de un
 * informe a otro.
 */
function rangoDelCorte(estaciones: EstacionConLectura[], cfg: VariableMapa): { min: number; max: number } {
    const valores = estaciones
        .map(e => estacionAMuestra(e)[cfg.clave])
        .filter((v): v is number => v != null);
    if (valores.length < 2) return { min: cfg.minFallback, max: cfg.maxFallback };
    let min = Math.min(...valores), max = Math.max(...valores);
    if (max - min < cfg.amplitudMinima) {
        const centro = (max + min) / 2;
        min = centro - cfg.amplitudMinima / 2;
        max = centro + cfg.amplitudMinima / 2;
    }
    const margen = (max - min) * 0.12;
    min -= margen; max += margen;
    // Variables con piso físico real (viento, radiación, lluvia) no bajan de 0.
    if (cfg.clave !== 'tempC') min = Math.max(0, min);
    return { min, max };
}

function hexA(h: string) { return parseInt(h.slice(1), 16); }
function mezclaHex(h1: string, h2: string, t: number): string {
    const a = hexA(h1), b = hexA(h2);
    const ch = (shift: number) => {
        const c1 = (a >> shift) & 255, c2 = (b >> shift) & 255;
        return Math.round(c1 + (c2 - c1) * t);
    };
    const r = ch(16), g = ch(8), bch = ch(0);
    return `#${((1 << 24) + (r << 16) + (g << 8) + bch).toString(16).slice(1)}`;
}

/** Color CONTINUO de la rampa (interpola entre los 8 pasos, no un escalón) —
 *  usado en el raster de fondo para producir el efecto de gradiente/isla de
 *  calor suave (como el mapa de referencia de CONABIO/SDR), conservando la
 *  misma rampa secuencial de dos hues ya validada (nunca arcoíris). El rango
 *  [min,max] es el del CORTE ACTUAL (rangoDelCorte), no un fijo institucional
 *  — así el contraste completo de la rampa se usa aunque la variación real
 *  del día sea pequeña. */
function colorContinuoEnRampa(v: number | null, cfg: VariableMapa, rango: { min: number; max: number }): string {
    if (v == null) return '#cbd5e1';
    const t = Math.max(0, Math.min(1, (v - rango.min) / (rango.max - rango.min)));
    const n = cfg.rampa.length;
    const pos = t * (n - 1);
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(pos)));
    const frac = pos - i0;
    return mezclaHex(cfg.rampa[i0], cfg.rampa[i0 + 1], frac);
}

function estacionAMuestra(e: EstacionConLectura): EstacionMuestra {
    return {
        nombre: e.nombre,
        lat: e.latitud, lon: e.longitud,
        tempC: e.lectura?.temp_c ?? null,
        vientoMs: e.lectura?.viento_ms ?? null,
        vientoDirDeg: e.lectura?.viento_dir_deg ?? null,
        radSolarWm2: e.lectura?.rad_solar_wm2 ?? null,
        lluviaDiaMm: e.lectura?.lluvia_dia_mm ?? null,
    };
}

/** Color de acento único de la flecha de viento — ámbar de alto contraste,
 *  visible tanto sobre el raster morado oscuro como sobre el claro, y
 *  distinto tanto del morado de la variable como del BORDE de los contornos
 *  (para que la flecha no se confunda con ninguno de los dos). */
const COLOR_FLECHA_VIENTO = '#f5a524';

/** Flecha de dirección de viento — estilo "cometa" ahusado (cuerpo cónico que
 *  se afina hacia la punta, como en apps meteorológicas modernas tipo
 *  Windy/Ventusky), no línea+triángulo separados. Apunta hacia donde SOPLA
 *  (no de donde viene). Su longitud codifica intensidad — explicado en el
 *  pie del bloque de viento del informe. Lleva animación CSS de flujo
 *  (marcha de guiones sobre el eje central, ver .geoinf-flecha-viento) —
 *  decorativa, no una simulación real de campo de viento.
 *  color/halo se ignoran salvo compatibilidad de firma con llamadas previas;
 *  el color de la flecha es siempre COLOR_FLECHA_VIENTO. */
function flechaViento(x: number, y: number, dirDeg: number, tam: number, _color: string, halo = false): string {
    const rad = ((dirDeg + 180) * Math.PI) / 180; // +180: la flecha apunta hacia donde va el viento
    const ux = Math.sin(rad), uy = -Math.cos(rad); // vector unitario en la dirección de la flecha
    const px = -uy, py = ux; // perpendicular, para el ancho del cuerpo
    const x2 = x + ux * tam, y2 = y + uy * tam;

    // Cuerpo: cometa/rombo alargado — ancho en la base (cola), afinado a la
    // mitad, culmina en punta. Un solo <path> en vez de línea+triángulo
    // separados: se ve como una pieza sólida, no dos formas pegadas.
    const anchoBase = 3.2;
    const puntoMedio = tam * 0.42; // dónde está el "hombro" más ancho del cuerpo
    const bx = x + ux * puntoMedio, by = y + uy * puntoMedio;
    const colaX1 = x + px * anchoBase * 0.4, colaY1 = y + py * anchoBase * 0.4;
    const colaX2 = x - px * anchoBase * 0.4, colaY2 = y - py * anchoBase * 0.4;
    const hombroX1 = bx + px * anchoBase, hombroY1 = by + py * anchoBase;
    const hombroX2 = bx - px * anchoBase, hombroY2 = by - py * anchoBase;
    const cuerpo = `M${colaX1.toFixed(1)},${colaY1.toFixed(1)}
                     L${hombroX1.toFixed(1)},${hombroY1.toFixed(1)}
                     L${x2.toFixed(1)},${y2.toFixed(1)}
                     L${hombroX2.toFixed(1)},${hombroY2.toFixed(1)}
                     L${colaX2.toFixed(1)},${colaY2.toFixed(1)} Z`;

    // Halo oscuro opcional detrás: la flecha DIBUJADA SOBRE EL RASTER (no
    // sobre la cápsula blanca) necesita el mismo despegue que el contorno de
    // módulo — ver comentario del halo en contornosSVG.
    const haloSVG = halo
        ? `<path d="${cuerpo}" fill="#0f172a" opacity="0.55" transform="translate(0,0)" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>`
        : '';
    // Línea de flujo animada sobre el eje central de la flecha — el
    // stroke-dasharray "viaja" dando la sensación decorativa de movimiento.
    const lineaFlujo = `<line class="geoinf-flecha-viento" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-opacity="0.55" stroke-width="1.1" stroke-linecap="round"/>`;
    return `${haloSVG}
            <path d="${cuerpo}" fill="${COLOR_FLECHA_VIENTO}" stroke="#0f172a" stroke-width="0.7" stroke-linejoin="round"/>
            ${lineaFlujo}`;
}

interface InfoModulo {
    valor: number | null; medido: boolean; fuente: string; distanciaKm: number | null;
    /** Solo poblado para la variable viento — dirección (medida o
     *  interpolada por componentes u/v) para dibujar la flecha en CADA
     *  módulo, no solo donde hay estación real. */
    vientoDirDeg?: number | null;
}

/** Logos oficiales A.C.U. por módulo (`public/logos/modulo_<N>.jpg`), ya
 *  usados en otras pantallas de la app — cargados una vez en buildHTML como
 *  data URI (mismo patrón que logoSRL/logoSICA) para que el informe siga
 *  siendo un HTML autónomo sin dependencias externas al abrirse offline. */
type LogosModulo = Map<number, string>;

/**
 * Extent geográfico único de los mapas del informe: la geofrontera de los 6
 * módulos + las estaciones que están DENTRO de un módulo (rol ≠ 'presa'),
 * con margen del 12%. Extraído a función compartida para que "qué se dibuja
 * en el mapa" (mapaVariableSVG) y "qué se declara fuera del mapa" (buildHTML,
 * nota al pie) usen exactamente el mismo criterio — antes cada uno calculaba
 * el extent por su cuenta con parámetros ligeramente distintos (uno con
 * margen y estaciones de módulo, el otro sin margen y solo polígonos), lo
 * que hacía que una estación (Las Vírgenes) apareciera dibujada en el mapa
 * mientras el texto decía que estaba "fuera del encuadre" — detectado solo
 * por captura de pantalla, no por lectura del código.
 */
/** Presa Boquilla se incluye SIEMPRE en el encuadre, aunque esté ~60 km al
 *  sur de los módulos (pedido explícito del usuario) — a diferencia de Las
 *  Vírgenes, que ya cae dentro del extent natural de los módulos y no
 *  necesita este trato especial. */
const NOMBRE_BOQUILLA = 'Boquilla';

function extentModulos(estaciones: EstacionConLectura[]): { minLo: number; maxLo: number; minLa: number; maxLa: number } {
    const modPts = Object.values(MODULOS_SRL).flat();
    const estPtsModulo = estaciones.filter(e => e.rol !== 'presa').map(e => [e.longitud, e.latitud] as [number, number]);
    const boquilla = estaciones.find(e => e.nombre === NOMBRE_BOQUILLA);
    const ptsExtra = boquilla ? [[boquilla.longitud, boquilla.latitud] as [number, number]] : [];
    const allLon = [...modPts.map(p => p[0]), ...estPtsModulo.map(p => p[0]), ...ptsExtra.map(p => p[0])];
    const allLat = [...modPts.map(p => p[1]), ...estPtsModulo.map(p => p[1]), ...ptsExtra.map(p => p[1])];
    let minLo = Math.min(...allLon), maxLo = Math.max(...allLon);
    let minLa = Math.min(...allLat), maxLa = Math.max(...allLat);
    const mLo = (maxLo - minLo) * 0.12, mLa = (maxLa - minLa) * 0.12;
    return { minLo: minLo - mLo, maxLo: maxLo + mLo, minLa: minLa - mLa, maxLa: maxLa + mLa };
}

/** Ray-casting estándar: ¿el punto [lon,lat] cae dentro del anillo? */
function puntoEnPoligono(lon: number, lat: number, ring: [number, number][]): boolean {
    let dentro = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        const cruza = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (cruza) dentro = !dentro;
    }
    return dentro;
}

function puntoEnAlgunModulo(lon: number, lat: number): boolean {
    return Object.values(MODULOS_SRL).some(ring => puntoEnPoligono(lon, lat, ring));
}

/** Distancia mínima (en grados, aproximada) de un punto a un segmento. */
function distPuntoSegmento(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
}

/** Distancia mínima de un punto al borde de CUALQUIER módulo (en grados de
 *  longitud, ya corregidos por cos(lat) para que sea comparable a distancia
 *  real, no solo grados crudos). Usada para el buffer suave del raster. */
function distanciaABordeModulos(lon: number, lat: number, kx: number): number {
    let min = Infinity;
    for (const ring of Object.values(MODULOS_SRL)) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const d = distPuntoSegmento(lon * kx, lat, ring[i][0] * kx, ring[i][1], ring[j][0] * kx, ring[j][1]);
            if (d < min) min = d;
        }
    }
    return min;
}

/**
 * Raster de fondo: grilla fina de celdas cuadradas, cada una coloreada por el
 * valor interpolado IDW en su centro (color CONTINUO, no de escalón) —
 * produce el efecto de "isla de calor" suave alrededor de cada estación, en
 * vez de polígonos de color plano. El color se extiende un BUFFER suave más
 * allá del borde de cada módulo (con opacidad decreciente hacia el límite del
 * buffer) — los contornos de módulo son una referencia visual encima, no una
 * máscara de recorte estricta (pedido explícito del usuario: que el color
 * "no se limite al polígono", como en los mapas de referencia gubernamentales
 * que pintan todo el estado, no solo cada municipio). Referencia visual:
 * mapas de precipitación CONABIO/SDR Chihuahua.
 */
function rasterCalorSVG(
    cfg: VariableMapa, muestras: EstacionMuestra[], rango: { min: number; max: number },
    sx: (lo: number) => number, sy: (la: number) => number,
    minLo: number, maxLo: number, minLa: number, maxLa: number,
    kx: number,
): string {
    const CELDA_PX = 9; // tamaño de celda en píxeles de salida — suficientemente fino para verse suave, sin generar miles de <rect>
    // Buffer en grados: ~12% del ancho del extent (mismo orden que el margen
    // de encuadre), suficiente para que el color respire más allá del borde
    // sin llegar a cubrir todo el rectángulo del lienzo.
    const BUFFER_DEG = (maxLo - minLo) * 0.1;
    const W_PX = sx(maxLo) - sx(minLo);
    const H_PX = sy(minLa) - sy(maxLa);
    const cols = Math.max(1, Math.round(W_PX / CELDA_PX));
    const rows = Math.max(1, Math.round(H_PX / CELDA_PX));
    const rects: string[] = [];
    for (let r = 0; r < rows; r++) {
        const la = maxLa - ((r + 0.5) / rows) * (maxLa - minLa);
        for (let c = 0; c < cols; c++) {
            const lo = minLo + ((c + 0.5) / cols) * (maxLo - minLo);
            const dentro = puntoEnAlgunModulo(lo, la);
            // Fuera del polígono: se pinta igual dentro del BUFFER, con
            // opacidad decreciente hacia el límite — así el color "respira"
            // más allá del contorno en vez de cortar en seco, sin llegar a
            // cubrir el rectángulo completo del lienzo.
            let opacidad = 1;
            if (!dentro) {
                const d = distanciaABordeModulos(lo, la, kx);
                if (d > BUFFER_DEG) continue;
                opacidad = 1 - d / BUFFER_DEG;
            }
            const resultado = interpolaClimaEnPunto({ lat: la, lon: lo }, muestras);
            const color = colorContinuoEnRampa(resultado[cfg.clave], cfg, rango);
            const x = sx(minLo) + c * (W_PX / cols), y = sy(maxLa) + r * (H_PX / rows);
            const op = opacidad < 1 ? ` fill-opacity="${opacidad.toFixed(2)}"` : '';
            rects.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(W_PX / cols + 0.6).toFixed(1)}" height="${(H_PX / rows + 0.6).toFixed(1)}" fill="${color}"${op}/>`);
        }
    }
    return rects.join('');
}

/**
 * Construye el mapa SVG de una variable: proyecta lat/lon→SVG con corrección
 * de aspecto, pinta un raster de "isla de calor" (color continuo, IDW por
 * celda) recortado a la geofrontera de los módulos, superpone el contorno y
 * la cápsula de valor por módulo (medido si tiene estación propia,
 * interpolado IDW si no) y dibuja las estaciones reales encima. La leyenda
 * de color vive en una banda propia debajo del mapa (nunca superpuesta a un
 * polígono).
 */
function mapaVariableSVG(
    cfg: VariableMapa, estaciones: EstacionConLectura[], valorPorModulo: Map<number, InfoModulo>, corte: string,
    logosModulo: LogosModulo,
): string {
    // El encuadre lo definen los 6 módulos (el sujeto real del informe): las
    // presas (Boquilla, Las Vírgenes) NO entran en el extent — están decenas
    // de km al sur/oeste de los módulos y forzarían un zoom-out que reduce el
    // distrito a una franja diminuta del lienzo (bug detectado por captura de
    // pantalla; siguen contribuyendo como muestras de la interpolación IDW,
    // solo se excluyen del cálculo de encuadre). Ver extentModulos().
    const { minLo, maxLo, minLa, maxLa } = extentModulos(estaciones);
    const latMed = (minLa + maxLa) / 2;
    const kx = Math.cos((latMed * Math.PI) / 180);
    const spanLo = (maxLo - minLo) * kx, spanLa = maxLa - minLa;
    const P = 34, W = 560, HL = 72; // P un poco mayor que antes para dejar sitio a retícula/escala/norte; HL: banda de leyenda + atribución, FUERA del área del mapa
    // Techo de alto generoso (antes 680): con Boquilla siempre incluida en el
    // extent (~60 km al sur de los módulos), un techo bajo comprimía los 6
    // módulos a la mitad superior del lienzo y dejaba una franja vacía hacia
    // el sur — se prefiere un mapa más alto (con su scroll) a perder detalle
    // en los módulos, que son el sujeto real del informe.
    const H = Math.min(1400, Math.round((W - 2 * P) * (spanLa / Math.max(1e-6, spanLo)) + 2 * P));
    const sx = (lo: number) => P + (((lo - minLo) * kx) / Math.max(1e-6, spanLo)) * (W - 2 * P);
    const sy = (la: number) => H - P - ((la - minLa) / Math.max(1e-6, spanLa)) * (H - 2 * P);

    // Rango de color de ESTE corte (ver rangoDelCorte) — se calcula una vez
    // y se reutiliza en el raster, la saturación de etiqueta y la leyenda,
    // para que los tres sean consistentes entre sí.
    const rango = rangoDelCorte(estaciones, cfg);

    // El tramo simplificado del Canal Conchos (utils/geoDistrito.ts, RIO) cae
    // enteramente al sur de este encuadre (cerca de Presa Boquilla, fuera del
    // rango de los 6 módulos) — dibujarlo aquí dejaba una línea suelta sin
    // relación visual con nada, así que este mapa no lo incluye.

    // Borde único para todos los módulos: en este mapa el COLOR ya codifica el
    // dato (rampa secuencial), así que el borde no debe competir con una
    // segunda paleta categórica — solo distingue medido (sólido) de
    // interpolado (tramado), ver E2 de la auditoría de diseño.
    const BORDE = '#334155';

    // Raster de "isla de calor" (gradiente continuo, IDW por celda, con
    // buffer suave más allá del borde de cada módulo) en vez de color plano
    // recortado al polígono — ver rasterCalorSVG(). Referencia visual: mapas
    // de precipitación CONABIO/SDR Chihuahua.
    const muestrasIDW = estaciones.map(estacionAMuestra);
    const rasterSVG = rasterCalorSVG(cfg, muestrasIDW, rango, sx, sy, minLo, maxLo, minLa, maxLa, kx);

    // Contornos: SOLO borde + tramado sobre módulos interpolados (el color ya
    // lo aporta el raster de fondo) — nunca se desplazan; las etiquetas van
    // en una segunda pasada porque algunos módulos (M3, M12) tienen
    // centroides muy cercanos y sus cápsulas chocarían si se dibujaran
    // exactamente sobre cada centroide (detectado por captura de pantalla).
    const contornosSVG = Object.entries(MODULOS_SRL).map(([numStr, ring]) => {
        const num = Number(numStr);
        const info = valorPorModulo.get(num);
        const d = ring.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ') + ' Z';
        const interpolado = info && !info.medido;
        // Halo blanco DEBAJO del trazo oscuro: con el rango de color dinámico
        // (rangoDelCorte), el extremo alto de las 4 rampas es más oscuro que
        // BORDE (#334155) — viento #2c0f4d, temperatura #5c0f0f, radiación
        // #5c2604, precipitación #0a2456 — así que en cualquier corte con
        // buena variación el contorno se volvía invisible contra su propio
        // raster (bug latente introducido por el rango dinámico, nunca visto
        // en las capturas de prueba porque tenían poca variación). El halo
        // separa el trazo del fondo sin depender de qué tan oscuro sea el dato.
        return `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="4.2" stroke-opacity="0.6"/>
                <path d="${d}" fill="none" stroke="${BORDE}" stroke-width="2"${interpolado ? ' stroke-dasharray="6,4"' : ''}/>
                ${interpolado ? `<path d="${d}" fill="url(#hatchInterp)"/>` : ''}`;
    }).join('');

    // Etiquetas: centroide propuesto por módulo, con separación mínima entre
    // cápsulas — si dos caen a menos de su radio combinado, se empujan en
    // dirección opuesta a lo largo de la línea que las une (simple, suficiente
    // para 6 módulos; no es un solver general de layout).
    // Ancho de logo + separación: solo se reserva espacio si el módulo TIENE
    // logo cargado (assetToDataURI puede devolver '' si el fetch falla) — así
    // un logo faltante no deja un hueco vacío en la cápsula.
    const LOGO_D = 20; // diámetro del ícono de logo dentro de la cápsula
    const etiquetas = Object.entries(MODULOS_SRL).map(([numStr, ring]) => {
        const num = Number(numStr);
        const info = valorPorModulo.get(num);
        const { lat: cla, lon: clo } = centroideAnillo(ring);
        const satura = info?.valor != null && info.valor >= rango.max;
        const etiquetaValor = info?.valor != null ? `${cfg.fmt(info.valor)}${satura ? '+' : ''}` : 'S/D';
        // El ancho debe medir la línea de valor TAL COMO SE RENDERIZA
        // ("110 W/m²", no solo "110") — con unidades largas (W/m², la más
        // ancha de las 4 variables) medir solo el número subestimaba el
        // ancho necesario y el texto quedaba encimado con el logo (detectado
        // por captura de pantalla en el mapa de Radiación solar).
        const lineaValor = `${etiquetaValor} ${cfg.unidad}`;
        const tieneLogo = !!logosModulo.get(num);
        const anchoExtra = tieneLogo ? LOGO_D + 6 : 0;
        const anchoTxt = Math.max(30, lineaValor.length * 6 + 12, `M${num}`.length * 7 + 12) + anchoExtra;
        return { tipo: 'modulo' as const, num, info, x: sx(clo), y: sy(cla), capW: anchoTxt, capH: 30, tieneLogo, anchoExtra };
    });
    // Etiquetas de estación (las no absorbidas por una cápsula de módulo, ver
    // nombresEnCapsula más abajo) entran al MISMO solver que las cápsulas de
    // módulo — antes se posicionaban con un offset fijo respecto al marcador,
    // sin saber dónde terminaba la cápsula del módulo vecino, así que una
    // estación geográficamente pegada a un centroide (Las Vírgenes vs M5)
    // quedaba siempre encimada con su cápsula (detectado por captura de
    // pantalla). anclaX/anclaY es la posición del marcador (no se mueve); el
    // solver ajusta el CENTRO de la caja de texto alrededor de esa ancla.
    const nombresEnCapsulaPre = new Set(Object.values(MODULOS_CON_ESTACION));
    const estacionesVisiblesPre = estaciones.filter(e =>
        e.longitud >= minLo && e.longitud <= maxLo && e.latitud >= minLa && e.latitud <= maxLa &&
        !nombresEnCapsulaPre.has(e.nombre));
    const etiquetasEst = estacionesVisiblesPre.map(e => {
        const m = estacionAMuestra(e);
        const valor = m[cfg.clave];
        const txt = valor != null ? `${e.nombre} · ${cfg.fmt(valor)}${cfg.unidad !== '°C' ? ' ' + cfg.unidad : '°'}` : `${e.nombre} · S/D`;
        const anclaX = sx(e.longitud), anclaY = sy(e.latitud);
        return { tipo: 'estacion' as const, estacion: e, txt, anclaX, anclaY, x: anclaX + 9 + (txt.length * 5) / 2, y: anclaY - 6, capW: txt.length * 5 + 8, capH: 13 };
    });
    // Colisión de rectángulos (AABB), no distancia circular: las cápsulas son
    // anchas y bajas (capW≈60-70, capH=30), así que un par alineado
    // verticalmente choca por altura mucho antes que por ancho — un radio
    // único subestimaba ese caso (M3/M12 seguían solapados tras el primer
    // intento con distancia euclidiana).
    const SEP_MIN = 5; // holgura extra entre cápsulas vecinas
    const todasLasEtiquetas: Array<{ x: number; y: number; capW: number; capH: number }> = [...etiquetas, ...etiquetasEst];
    for (let iter = 0; iter < 12; iter++) {
        let movido = false;
        for (let i = 0; i < todasLasEtiquetas.length; i++) {
            for (let j = i + 1; j < todasLasEtiquetas.length; j++) {
                const a = todasLasEtiquetas[i], b = todasLasEtiquetas[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const solapX = (a.capW + b.capW) / 2 + SEP_MIN - Math.abs(dx);
                const solapY = (a.capH + b.capH) / 2 + SEP_MIN - Math.abs(dy);
                if (solapX > 0 && solapY > 0) {
                    // Empuja por el eje de MENOR solape (separación más barata).
                    const empuje = Math.min(solapX, solapY) / 2 + 0.5;
                    if (solapX < solapY) {
                        const s = dx >= 0 ? 1 : -1;
                        a.x -= s * empuje; b.x += s * empuje;
                    } else {
                        const s = dy >= 0 ? 1 : -1;
                        a.y -= s * empuje; b.y += s * empuje;
                    }
                    movido = true;
                }
            }
        }
        if (!movido) break;
    }

    const etiquetasSVG = etiquetas.map(({ num, info, x: lx, y: ly, capW, capH, tieneLogo, anchoExtra }) => {
        const interpolado = info && !info.medido;
        const satura = info?.valor != null && info.valor >= rango.max;
        const etiquetaValor = info?.valor != null ? `${cfg.fmt(info.valor)}${satura ? '+' : ''}` : 'S/D';
        const distTxt = interpolado && info?.distanciaKm != null ? `~${info.distanciaKm.toFixed(0)} km` : '';
        // Flecha de dirección en CADA módulo (no solo donde hay estación
        // real) — dirección medida si el módulo tiene estación propia,
        // interpolada por componentes u/v si no (ver calculaValoresPorModulo).
        // Se dibuja sobre la cápsula, apuntando hacia donde sopla el viento,
        // con tamaño fijo (la magnitud ya la dice el texto de valor).
        const flechaModulo = (cfg.clave === 'vientoMs' && info?.vientoDirDeg != null && (info?.valor ?? 0) > 0.15)
            ? flechaViento(lx, ly - capH / 2 - 9, info.vientoDirDeg, 11, BORDE, true)
            : '';
        // Logo A.C.U. del módulo, en un disco a la izquierda de la cápsula —
        // el texto se recentra en el espacio restante (capW - anchoExtra) para
        // que el logo no quede pegado al valor numérico. Sin logo (fetch
        // fallido), el texto ocupa el ancho completo como antes.
        const logoUri = logosModulo.get(num);
        const cxTexto = tieneLogo ? lx - capW / 2 + anchoExtra + (capW - anchoExtra) / 2 : lx;
        const logoSVG = tieneLogo && logoUri ? (() => {
            const lcx = lx - capW / 2 + 4 + LOGO_D / 2, lcy = ly;
            const r = LOGO_D / 2;
            return `<clipPath id="logoClip${cfg.clave}${num}"><circle cx="${lcx.toFixed(1)}" cy="${lcy.toFixed(1)}" r="${(r - 0.5).toFixed(1)}"/></clipPath>
                <circle cx="${lcx.toFixed(1)}" cy="${lcy.toFixed(1)}" r="${r.toFixed(1)}" fill="#fff" stroke="${BORDE}" stroke-width="1"/>
                <image href="${logoUri}" x="${(lcx - r).toFixed(1)}" y="${(lcy - r).toFixed(1)}" width="${LOGO_D}" height="${LOGO_D}" clip-path="url(#logoClip${cfg.clave}${num})" preserveAspectRatio="xMidYMid slice"/>`;
        })() : '';
        return `<rect x="${(lx - capW / 2).toFixed(1)}" y="${(ly - capH / 2).toFixed(1)}" width="${capW.toFixed(1)}" height="${capH}" rx="7" fill="#fff" fill-opacity="0.95" stroke="${BORDE}" stroke-width="1.5"/>
                ${logoSVG}
                <text x="${cxTexto.toFixed(1)}" y="${(ly - 2).toFixed(1)}" font-size="10.5" font-weight="800" text-anchor="middle" fill="#0f172a" font-family="system-ui">M${num}</text>
                <text x="${cxTexto.toFixed(1)}" y="${(ly + 10.5).toFixed(1)}" font-size="9" font-weight="700" text-anchor="middle" fill="#334155" font-family="system-ui">${etiquetaValor} ${cfg.unidad}</text>
                ${distTxt ? `<text x="${cxTexto.toFixed(1)}" y="${(ly + capH / 2 + 9).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="#64748b" font-family="system-ui">${distTxt}</text>` : ''}
                ${flechaModulo}`;
    }).join('');
    const modulosSVG = contornosSVG + etiquetasSVG;

    // Solo se dibujan en el mapa las estaciones que caen dentro del encuadre
    // de los módulos — una presa lejana (Boquilla, Las Vírgenes) sigue
    // contribuyendo a la interpolación IDW (calculaValoresPorModulo usa TODAS
    // las estaciones), pero su marcador no se fuerza dentro de un mapa cuyo
    // encuadre es la geofrontera de los módulos, no el distrito completo.
    // Nombres de estaciones que YA tienen su valor mostrado en una cápsula de
    // módulo (Módulo 1/3/5) — su marcador se dibuja sin repetir el texto al
    // lado, porque quedaría pegado a la cápsula del módulo y duplicaría el
    // mismo dato dos veces en el mismo punto (detectado por captura de pantalla).
    // La posición del texto (x/y) viene YA resuelta por el solver AABB de
    // arriba (etiquetasEst) — el marcador se queda en su coordenada geográfica
    // real (anclaX/anclaY), solo la caja de texto se desplaza si chocaba con
    // una cápsula de módulo vecina (ej. Las Vírgenes vs M5).
    const etiquetasEstPorNombre = new Map(etiquetasEst.map(et => [et.estacion.nombre, et]));
    const estSVG = estacionesVisiblesPre.map(e => {
        const x = sx(e.longitud), y = sy(e.latitud);
        const m = estacionAMuestra(e);
        const et = etiquetasEstPorNombre.get(e.nombre)!;
        // Símbolo convencional de estación de observación (halo de contacto +
        // disco blanco + anillo + núcleo oscuro) — más grande que la versión
        // anterior (r=9 vs r=7) y con un halo de contacto adicional para que
        // nunca se pierda contra el raster, sea cual sea su color de fondo.
        // Reconocible como "estación medida" incluso sin leer la etiqueta —
        // ver entrada en la leyenda.
        const marcador = `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="#0f172a" opacity="0.18"/>
                <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="#fff" stroke="#0f172a" stroke-width="2.2"/>
                <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="#0f172a"/>`;
        const flecha = (cfg.clave === 'vientoMs' && m.vientoDirDeg != null && m.vientoMs != null && m.vientoMs > 0.3)
            ? flechaViento(x, y, m.vientoDirDeg, 14 + Math.min(14, m.vientoMs * 2), '#0f172a', true)
            : '';
        return `${marcador}${flecha}
                <text x="${et.x.toFixed(1)}" y="${et.y.toFixed(1)}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#0f172a" font-family="system-ui" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(et.txt)}</text>`;
    }).join('');

    // Leyenda: banda propia bajo el mapa (nunca sobre un polígono), con
    // título de variable, ticks intermedios, cheurón de saturación y
    // muestra de "S/D" — y mini-leyenda de simbología medido/interpolado.
    const leyW = 190, leyX = P, leyY = H + 14;
    const pasos = cfg.rampa.map((c, i) => {
        const x0 = leyX + (i * leyW) / cfg.rampa.length;
        const w = leyW / cfg.rampa.length;
        return `<rect x="${x0.toFixed(1)}" y="${leyY}" width="${w.toFixed(1)}" height="10" fill="${c}"/>`;
    }).join('');
    // Rango DINÁMICO de este corte (rangoDelCorte) — con amplitud pequeña
    // (ej. 26.6-28.1°C) Math.round colapsaría varios ticks al mismo entero;
    // se usa cfg.fmt (mismo formato que los valores del mapa) para que la
    // leyenda muestre la resolución real que el rango dinámico existe para
    // mostrar.
    const ticks = Array.from({ length: cfg.rampa.length + 1 }, (_, i) => {
        const v = rango.min + (i * (rango.max - rango.min)) / cfg.rampa.length;
        const x = leyX + (i * leyW) / cfg.rampa.length;
        return `<text x="${x.toFixed(1)}" y="${(leyY + 22).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="${VIZ.inkMuted}">${cfg.fmt(v)}</text>`;
    }).join('');
    const sdX = leyX + leyW + 16;

    // ── Elementos cartográficos convencionales (retícula, marco, escala,
    // norte, cartela) — portados del informe hermano exportClimaReport.ts
    // (mapaSVG), adaptados al extent más pequeño de los 6 módulos. Sin esto
    // el mapa se lee como "gráfico de colores"; con esto se lee como mapa
    // (auditoría de diseño 2026-09-12).
    const marcoClip = `<clipPath id="marcoGeo${cfg.clave}"><rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" rx="3"/></clipPath>`;

    // NO se aplica feGaussianBlur al raster (se probó y se descartó): sobre
    // ~1,700 <rect> por mapa, el filtro dispara el peso de la exportación a
    // PDF de ~520 KB a ~4.8 MB (Chromium rasteriza el filtro a alta
    // resolución al imprimir) sin una mejora visual que lo justifique — el
    // solape de 0.6px entre celdas ya suaviza lo suficiente las costuras.

    // Paso de retícula adaptactivo: el extent de los módulos es más chico
    // que el del distrito completo (sin presas) — 0.1° fijo daría muy pocas
    // líneas o demasiadas según el mapa.
    const pasoG = spanLa > 0.6 ? 0.2 : spanLa > 0.25 ? 0.1 : 0.05;
    const decGrid: string[] = [];
    for (let la = Math.ceil(minLa / pasoG) * pasoG; la <= maxLa; la += pasoG) {
        const y = sy(la);
        decGrid.push(`<line x1="${P}" y1="${y.toFixed(1)}" x2="${W - P}" y2="${y.toFixed(1)}" stroke="#0f172a" stroke-opacity="0.07" stroke-width="0.6"/><text x="${(P - 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="${VIZ.inkMuted}">${la.toFixed(2)}°</text>`);
    }
    for (let lo = Math.ceil(minLo / pasoG) * pasoG; lo <= maxLo; lo += pasoG) {
        const x = sx(lo);
        decGrid.push(`<line x1="${x.toFixed(1)}" y1="${P}" x2="${x.toFixed(1)}" y2="${H - P}" stroke="#0f172a" stroke-opacity="0.07" stroke-width="0.6"/><text x="${x.toFixed(1)}" y="${(H - P + 10).toFixed(1)}" font-size="8" text-anchor="middle" fill="${VIZ.inkMuted}">${lo.toFixed(2)}°</text>`);
    }

    // Escala gráfica: elige una distancia redonda (10 o 20 km según el
    // tamaño del mapa) y calcula su ancho real en px — no una aproximación
    // fija como "~10 km" sin verificar que quepa cómodamente en el lienzo.
    const kmBarra = spanLa * 111 > 60 ? 20 : 10;
    const gradosBarra = kmBarra / 111.32;
    const anchoBarraPx = (gradosBarra * kx / spanLo) * (W - 2 * P);
    const segEscala = 4; // barra bicolor de 4 segmentos alternos, convención cartográfica
    const escalaSVG = Array.from({ length: segEscala }, (_, i) => {
        const x0 = (i * anchoBarraPx) / segEscala;
        const w = anchoBarraPx / segEscala;
        return `<rect x="${x0.toFixed(1)}" y="-4" width="${w.toFixed(1)}" height="4" fill="${i % 2 === 0 ? '#0f172a' : '#ffffff'}" stroke="#0f172a" stroke-width="0.6"/>`;
    }).join('');

    // Flecha de norte: pequeña y en tinta secundaria — con las flechas de
    // dirección de viento ya en el mapa, un símbolo de norte grande se
    // confundiría con ellas.
    const norteSVG = `<g transform="translate(${(W - P - 12).toFixed(1)},${(P + 16).toFixed(1)})">
        <path d="M0,-11 L4,4 L0,1 L-4,4 Z" fill="${VIZ.inkSecondary}"/>
        <text x="0" y="14" font-size="9" font-weight="700" text-anchor="middle" fill="${VIZ.inkSecondary}" font-family="system-ui">N</text>
    </g>`;

    // Cartela: título + fecha del corte dentro del propio SVG — si el mapa se
    // recorta y se comparte suelto (capturas, oficios), sigue siendo
    // autosuficiente: se sabe qué es, de cuándo y de dónde sale el dato.
    const cartelaSVG = `<rect x="${P}" y="${P}" width="${W - 2 * P}" height="20" fill="#0f172a" opacity="0.72"/>
        <text x="${(P + 6).toFixed(1)}" y="${(P + 14).toFixed(1)}" font-size="10.5" font-weight="700" fill="#fff" font-family="system-ui">${esc(cfg.titulo)} · DR-005</text>
        <text x="${(W - P - 6).toFixed(1)}" y="${(P + 14).toFixed(1)}" font-size="8.5" text-anchor="end" fill="#e2e8f0" font-family="system-ui">${esc(corte)}</text>`;

    const atribucionSVG = `<line x1="${leyX}" y1="${(H + HL - 20).toFixed(1)}" x2="${W - P}" y2="${(H + HL - 20).toFixed(1)}" stroke="${VIZ.grid}" stroke-width="1"/>
        <text x="${(leyX).toFixed(1)}" y="${(H + HL - 6).toFixed(1)}" font-size="7.5" fill="${VIZ.inkMuted}" font-family="system-ui">Fuente: red WeatherLink (Davis) · interpolación IDW p=2 · proyección geográfica WGS-84 (aspecto corregido por cos φ) · SICA-005</text>`;

    return `<svg viewBox="0 0 ${W} ${H + HL + 6}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border-radius:10px" font-family="system-ui">
        <defs>
          <pattern id="hatchInterp" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" fill="transparent"/>
            <line x1="0" y1="0" x2="0" y2="7" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3"/>
          </pattern>
          ${marcoClip}
        </defs>
        <rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="#eef2f6"/>
        <g clip-path="url(#marcoGeo${cfg.clave})">
          ${rasterSVG}
        </g>
        ${decGrid.join('')}
        <rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="none" stroke="${VIZ.grid}" stroke-width="1.5"/>
        ${modulosSVG}
        ${estSVG}
        ${cartelaSVG}
        <g transform="translate(${(W - P - anchoBarraPx - 8).toFixed(1)},${(H - P - 6).toFixed(1)})">
          <rect x="-6" y="-16" width="${(anchoBarraPx + 44).toFixed(1)}" height="24" rx="4" fill="#fff" fill-opacity="0.85"/>
          ${escalaSVG}
          <text x="0" y="-6" font-size="8.5" fill="${VIZ.inkSecondary}" font-family="system-ui">0</text>
          <text x="${anchoBarraPx.toFixed(1)}" y="-6" font-size="8.5" text-anchor="end" fill="${VIZ.inkSecondary}" font-family="system-ui">${kmBarra} km</text>
        </g>
        ${norteSVG}
        ${atribucionSVG}
        <text x="${leyX}" y="${(leyY - 6).toFixed(1)}" font-size="9" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(cfg.titulo)} (${cfg.unidad})</text>
        ${pasos}
        ${ticks}
        <rect x="${sdX}" y="${leyY}" width="14" height="10" fill="#cbd5e1"/>
        <text x="${(sdX + 18).toFixed(1)}" y="${(leyY + 9).toFixed(1)}" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">S/D</text>
        <rect x="${leyX}" y="${(leyY + 26).toFixed(1)}" width="12" height="12" rx="2" fill="#e2e8f0" stroke="${BORDE}" stroke-width="1.5"/>
        <text x="${(leyX + 16).toFixed(1)}" y="${(leyY + 35).toFixed(1)}" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">medido</text>
        <rect x="${(leyX + 78).toFixed(1)}" y="${(leyY + 26).toFixed(1)}" width="12" height="12" rx="2" fill="url(#hatchInterp)" stroke="${BORDE}" stroke-width="1.5" stroke-dasharray="3,2"/>
        <rect x="${(leyX + 78).toFixed(1)}" y="${(leyY + 26).toFixed(1)}" width="12" height="12" rx="2" fill="#e2e8f0" opacity="0.5"/>
        <text x="${(leyX + 94).toFixed(1)}" y="${(leyY + 35).toFixed(1)}" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">interpolado (IDW)</text>
        <circle cx="${(leyX + 187).toFixed(1)}" cy="${(leyY + 32).toFixed(1)}" r="6" fill="#fff" stroke="#0f172a" stroke-width="1.6"/>
        <circle cx="${(leyX + 187).toFixed(1)}" cy="${(leyY + 32).toFixed(1)}" r="2.4" fill="#0f172a"/>
        <text x="${(leyX + 197).toFixed(1)}" y="${(leyY + 35).toFixed(1)}" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">estación</text>
    </svg>`;
}

/** Calcula, para cada uno de los 6 módulos SRL, el valor medido (si tiene
 *  estación propia) o interpolado IDW (si no), con su procedencia declarada. */
function calculaValoresPorModulo(estaciones: EstacionConLectura[], clave: VariableMapa['clave']): Map<number, InfoModulo> {
    const muestras = estaciones.map(estacionAMuestra);
    const out = new Map<number, InfoModulo>();
    for (const [numStr, ring] of Object.entries(MODULOS_SRL)) {
        const num = Number(numStr);
        const nombreEst = MODULOS_CON_ESTACION[num];
        if (nombreEst) {
            const est = estaciones.find(e => e.nombre === nombreEst);
            const m = est ? estacionAMuestra(est) : null;
            out.set(num, {
                valor: m ? m[clave] : null, medido: true, fuente: nombreEst, distanciaKm: 0,
                vientoDirDeg: clave === 'vientoMs' ? m?.vientoDirDeg ?? null : undefined,
            });
            continue;
        }
        const centro = centroideAnillo(ring);
        const resultado = interpolaClimaEnPunto(centro, muestras);
        const cercana = estacionMasCercana(centro, estaciones.map(e => ({ ...e, lat: e.latitud, lon: e.longitud })));
        out.set(num, {
            valor: resultado[clave],
            medido: false,
            fuente: cercana ? `IDW · más cercana: ${cercana.estacion.nombre}` : 'sin estaciones de referencia',
            distanciaKm: cercana ? cercana.distanciaKm : null,
            vientoDirDeg: clave === 'vientoMs' ? resultado.vientoDirDeg : undefined,
        });
    }
    return out;
}

/** Componentes u/v promedio de la red (para el veredicto: dirección
 *  dominante del viento del distrito), reconstruidos a magnitud+dirección. */
function vientoDominante(estaciones: EstacionConLectura[]): { velMs: number; dirDeg: number } | null {
    const conViento = estaciones.filter(e => e.lectura?.viento_ms != null && e.lectura?.viento_dir_deg != null);
    if (!conViento.length) return null;
    const rad = (d: number) => (d * Math.PI) / 180;
    let u = 0, v = 0;
    for (const e of conViento) {
        const vel = e.lectura!.viento_ms as number, dir = e.lectura!.viento_dir_deg as number;
        u += -vel * Math.sin(rad(dir));
        v += -vel * Math.cos(rad(dir));
    }
    u /= conViento.length; v /= conViento.length;
    const velMs = Math.sqrt(u * u + v * v);
    const dirDeg = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
    return { velMs, dirDeg };
}

const RUMBOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const rumboDe = (deg: number) => RUMBOS[Math.round(deg / 22.5) % 16];

async function buildHTML(estaciones: EstacionConLectura[], opciones: OpcionesGeoInforme): Promise<string> {
    const numsModulo = Object.keys(MODULOS_SRL).map(Number);
    const [logoSRL, logoSICA, ...logosArr] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'),
        assetToDataURI('/logos/SICA005.png'),
        ...numsModulo.map(n => assetToDataURI(`/logos/modulo_${n}.jpg`)),
    ]);
    // Mapa módulo→logo A.C.U.: un módulo cuyo archivo no cargó (404, offline)
    // queda sin entrada en vez de con string vacío — así el resto del código
    // solo pregunta "¿existe?" (logosModulo.get(num)) sin tener que filtrar
    // strings vacíos en cada punto de uso.
    const logosModulo: LogosModulo = new Map(
        numsModulo.map((n, i) => [n, logosArr[i]] as const).filter((par): par is [number, string] => !!par[1]),
    );
    // El mapa de cada variable es SIEMPRE el corte actual (última lectura) —
    // ya no hay modo "mes específico" separado; la vista mensual vive en la
    // gráfica de evolución de cada bloque (ver graficaEvolucion más abajo).
    const hoy = new Date().toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });
    // Versión corta para la cartela dentro del SVG (ancho limitado del mapa) —
    // "hoy" completa se reserva para el header del documento HTML.
    const corteCorto = new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
    // Variables elegidas en el modal — si la selección quedara vacía por
    // algún error de estado, se cae a todas (nunca un informe sin mapas).
    const variablesElegidas = VARIABLES.filter(v => opciones.variables.includes(v.clave));
    const variablesActivas = variablesElegidas.length ? variablesElegidas : VARIABLES;
    const activas = estaciones.filter(e => e.activa !== false);

    // ── Resumen ejecutivo: KPIs + veredicto de una frase ────────────────────
    const temps = activas.map(e => e.lectura?.temp_c).filter((v): v is number => v != null);
    const vientos = activas.map(e => e.lectura?.viento_ms).filter((v): v is number => v != null);
    const lluvias = activas.map(e => e.lectura?.lluvia_dia_mm).filter((v): v is number => v != null);
    const tMin = temps.length ? Math.min(...temps) : null;
    const tMax = temps.length ? Math.max(...temps) : null;
    const vMax = vientos.length ? Math.max(...vientos) : null;
    const lluviaMax = lluvias.length ? Math.max(...lluvias) : null;
    const viento = vientoDominante(activas);
    const totalModulos = Object.keys(MODULOS_SRL).length;
    const interpolados = totalModulos - Object.keys(MODULOS_CON_ESTACION).length;

    const fraseTemp = tMin != null && tMax != null
        ? `Temperatura entre ${tMin.toFixed(0)} y ${tMax.toFixed(0)} °C entre estaciones`
        : 'Sin lectura de temperatura disponible';
    const fraseViento = viento
        ? `viento ${viento.velMs < 2 ? 'ligero' : viento.velMs < 6 ? 'moderado' : 'fuerte'} del ${rumboDe((viento.dirDeg + 180) % 360)} (máx. ${vMax?.toFixed(1) ?? '—'} m/s)`
        : 'sin dato de viento';
    const fraseLluvia = lluviaMax != null && lluviaMax > 0.1
        ? `lluvia registrada, máximo ${lluviaMax.toFixed(1)} mm en la red`
        : 'sin precipitación registrada hoy';
    const veredicto = `${fraseTemp}, ${fraseViento}, ${fraseLluvia}. `
        + `${interpolados} de ${totalModulos} módulos operan con valor interpolado (sin estación meteorológica propia).`;

    const kpis = [
        { l: 'Temperatura', v: tMax != null ? tMax.toFixed(0) : '—', u: '°C máx.', pie: tMin != null ? `mín. ${tMin.toFixed(0)} °C` : 'sin dato' },
        { l: 'Viento', v: vMax != null ? vMax.toFixed(1) : '—', u: 'm/s máx.', pie: viento ? `dominante del ${rumboDe((viento.dirDeg + 180) % 360)}` : 'sin dato' },
        { l: 'Precipitación', v: lluviaMax != null ? lluviaMax.toFixed(1) : '—', u: 'mm máx.', pie: 'máximo puntual de la red — no promediar' },
        { l: 'Cobertura de red', v: `${totalModulos - interpolados}/${totalModulos}`, u: 'módulos', pie: `${interpolados} con valor interpolado` },
    ];
    const kpisSVG = kpis.map(k => `<div class="kpi"><div class="l">${k.l}</div><div class="v">${k.v}<span class="u">${k.u}</span></div><div class="pie">${k.pie}</div></div>`).join('');

    // Estaciones que participan en la interpolación (IDW usa TODAS) pero no
    // se dibujan en el mapa por caer fuera de la geofrontera de los módulos
    // (p.ej. las presas, decenas de km al sur/oeste) — se declara en texto
    // para no dar la impresión de que solo "cuentan" las estaciones visibles.
    // MISMO extent que usa mapaVariableSVG (extentModulos) — antes este
    // cálculo vivía duplicado con parámetros distintos y desalineaba lo que
    // el mapa dibujaba de lo que el texto declaraba fuera de él.
    const extent = extentModulos(activas);
    const fueraDeMapa = activas.filter(e => e.longitud < extent.minLo || e.longitud > extent.maxLo || e.latitud < extent.minLa || e.latitud > extent.maxLa);
    const notaFueraDeMapa = fueraDeMapa.length
        ? `<p class="geoinf-pienota">También participan en la interpolación (fuera del encuadre de este mapa): ${fueraDeMapa.map(e => esc(e.nombre)).join(', ')}.</p>`
        : '';

    // Nota de lectura por variable, para el figcaption — reemplaza la nota de
    // viento suelta que antes vivía como <p> aparte del mapa. El mapa es
    // siempre del corte actual; la vista mensual vive en la gráfica de
    // evolución aparte (graficaEvolucion), no aquí.
    const NOTA_LECTURA: Record<VariableMapa['clave'], string> = {
        tempC: 'Raster interpolado (IDW p=2) sobre la geofrontera de los módulos, con halo suave más allá del contorno. Rango de color ajustado al mínimo y máximo real de este corte.',
        vientoMs: 'Las flechas indican hacia dónde sopla el viento en cada punto (estación real o módulo interpolado); su longitud junto a la estación codifica intensidad. El movimiento de la flecha es decorativo (da sensación de flujo), no una simulación del campo de viento real. Interpolado por componentes u/v (no promediando grados) porque la dirección es una variable circular.',
        radSolarWm2: 'Raster interpolado (IDW p=2) sobre la geofrontera de los módulos. De noche o con el sol muy bajo, valores cercanos a 0 W/m² son correctos, no ausencia de dato.',
        lluviaDiaMm: 'Raster interpolado (IDW p=2) — la precipitación es la variable más sensible a convección local: un módulo sin estación puede haber recibido lluvia distinta a la interpolada.',
    };

    const etiquetaPeriodo = 'corte actual';

    // Evolución mensual: meses únicos presentes en la serie, orden
    // cronológico ascendente (para que la gráfica se lea izquierda=antiguo →
    // derecha=reciente), y el campo de EstacionMuestra que corresponde a cada
    // variable del mapa — así una sola función arma la gráfica para las 4.
    // Independiente del corte del mapa: se muestra siempre que haya datos.
    const mesesSerie = opciones.serieMensual?.length
        ? Array.from(new Set(opciones.serieMensual.map(p => `${p.anio}-${p.mes}`)))
            .map(k => { const [anio, mes] = k.split('-').map(Number); return { anio, mes }; })
            .sort((a, b) => a.anio - b.anio || a.mes - b.mes)
        : [];
    const CAMPO_SERIE: Record<VariableMapa['clave'], 'tempCProm' | 'vientoMsProm' | 'radSolarWm2Prom' | 'lluviaMmAcumulada'> = {
        tempC: 'tempCProm', vientoMs: 'vientoMsProm', radSolarWm2: 'radSolarWm2Prom', lluviaDiaMm: 'lluviaMmAcumulada',
    };
    const graficaEvolucion = (cfg: VariableMapa): string => {
        if (!mesesSerie.length || !opciones.serieMensual?.length) return '';
        const campo = CAMPO_SERIE[cfg.clave];
        const porEstacion = new Map<string, { nombre: string; valores: (number | null)[] }>();
        for (const p of opciones.serieMensual) {
            if (!porEstacion.has(p.estacionId)) {
                porEstacion.set(p.estacionId, { nombre: p.estacionNombre, valores: mesesSerie.map(() => null) });
            }
            const idx = mesesSerie.findIndex(m => m.anio === p.anio && m.mes === p.mes);
            if (idx >= 0) porEstacion.get(p.estacionId)!.valores[idx] = p[campo];
        }
        const series = Array.from(porEstacion.values());
        // Precipitación es un acumulado mensual DISCRETO (agosto no "fluye"
        // desde julio) → barras agrupadas por mes, nunca línea, que sugeriría
        // una continuidad inexistente entre meses (skill dataviz,
        // choosing-a-form.md). Temperatura/viento/radiación sí tienen una
        // trayectoria mensual con sentido de continuidad → se mantienen como
        // línea, tal como antes.
        const forma: 'linea' | 'barras' = cfg.clave === 'lluviaDiaMm' ? 'barras' : 'linea';
        return graficaEvolucionMensual(cfg.titulo, cfg.unidad, mesesSerie, series, cfg.clave !== 'tempC', forma);
    };

    const bloques = variablesActivas.map((cfg, i) => {
        const valores = calculaValoresPorModulo(activas, cfg.clave);
        const svg = mapaVariableSVG(cfg, activas, valores, corteCorto, logosModulo);
        const filas = Object.keys(MODULOS_SRL).map(Number).sort((a, b) => a - b).map(num => {
            const v = valores.get(num);
            const valorTxt = v?.valor != null ? `${cfg.fmt(v.valor)} ${cfg.unidad}` : 'S/D';
            const badge = v?.medido
                ? `<span class="geoinf-badge geoinf-badge--medido">MEDIDO</span>`
                : `<span class="geoinf-badge geoinf-badge--interp">INTERPOLADO</span>`;
            const detalle = v?.medido
                ? `Estación propia: ${esc(v.fuente)}`
                : `${esc(v?.fuente ?? '')}${v?.distanciaKm != null ? ` (${v.distanciaKm.toFixed(1)} km)` : ''}`;
            const logoUri = logosModulo.get(num);
            const logoImgTd = logoUri
                ? `<img src="${logoUri}" alt="" width="22" height="22" style="border-radius:999px;object-fit:cover;border:1px solid ${VIZ.grid};vertical-align:middle;margin-right:7px">`
                : '';
            return `<tr>
                <td>${logoImgTd}<b>Módulo ${num}</b></td>
                <td>${valorTxt}</td>
                <td>${badge}</td>
                <td class="geoinf-detalle">${detalle}</td>
            </tr>`;
        }).join('');

        // El mapa siempre es del corte actual (precipitación = lluvia del
        // día); el acumulado mensual vive en la gráfica de evolución debajo.
        return `<section class="geoinf-bloque">
            <h2>${esc(cfg.titulo)} (${cfg.unidad})</h2>
            <figure class="fig">
                <figcaption>
                    <b>${esc(cfg.titulo)} por módulo — ${esc(etiquetaPeriodo)}</b>
                    <span>${NOTA_LECTURA[cfg.clave]}</span>
                </figcaption>
                <div class="geoinf-mapa">${svg}</div>
            </figure>
            ${i === 0 ? notaFueraDeMapa : ''}
            <table>
                <thead><tr><th>Módulo</th><th>Valor</th><th>Procedencia</th><th>Detalle</th></tr></thead>
                <tbody>${filas}</tbody>
            </table>
            ${cfg.clave === 'lluviaDiaMm' ? `<div class="geoinf-nota" style="margin-top:14px">
                <b style="display:block;margin-bottom:8px;color:${SRL_MARRON};font-size:0.8rem">Precipitación por estación</b>
                ${tablaPrecipitacion(activas)}
                <p style="font-size:0.65rem;color:#94a3b8;margin:8px 0 0">${esc(NOTA_TABLA_PRECIPITACION)}</p>
            </div>` : ''}
            ${(() => {
                const svgEvolucion = graficaEvolucion(cfg);
                if (!svgEvolucion) return '';
                return `<figure class="fig">
                    <figcaption>
                        <b>Evolución mensual — ${esc(cfg.titulo)}</b>
                        <span>${cfg.clave === 'lluviaDiaMm' ? 'Acumulado' : 'Promedio'} por estación, mes a mes. Un hueco en la línea indica un mes sin lectura suficiente, nunca se interpola entre meses.</span>
                    </figcaption>
                    ${svgEvolucion}
                </figure>`;
            })()}
        </section>`;
    }).join('');

    const filasEstaciones = activas.map(e => {
        const q = e.calidad;
        return `<tr>
            <td>${esc(e.nombre)}</td>
            <td>${esc(e.rol)}</td>
            <td>${e.lectura?.temp_c != null ? e.lectura.temp_c.toFixed(1) + ' °C' : '—'}</td>
            <td>${e.lectura?.viento_ms != null ? e.lectura.viento_ms.toFixed(1) + ' m/s' : '—'}${e.lectura?.viento_dir_deg != null ? ` (${e.lectura.viento_dir_deg.toFixed(0)}°)` : ''}</td>
            <td>${e.lectura?.rad_solar_wm2 != null ? e.lectura.rad_solar_wm2.toFixed(0) + ' W/m²' : '—'}</td>
            <td>${e.lectura?.lluvia_dia_mm != null ? e.lectura.lluvia_dia_mm.toFixed(1) + ' mm' : '—'}</td>
            <td><span style="color:${q.color}">● ${esc(q.etiqueta)}</span>${q.edadMin != null ? ` · ${formateaEdad(q.edadMin)}` : ''}</td>
        </tr>`;
    }).join('');

    const logoImg = (src: string, alt: string) => src
        ? `<img src="${src}" alt="${alt}" style="height:52px;width:auto;object-fit:contain">`
        : `<div style="height:52px;display:flex;align-items:center;color:#94a3b8;font-size:0.7rem">${alt}</div>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Informe Geoclimático por Módulo — SRL Unidad Conchos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 26px; color: #1e293b; background: #fff; line-height: 1.5; }
  .wrap { max-width: 920px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 18px; border-bottom: 3px solid ${SRL_MARRON}; padding-bottom: 16px; margin-bottom: 22px; }
  header .titulo { flex: 1; }
  header .sub { color: #64748b; font-size: 0.78rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  header h1 { color: ${SRL_MARRON}; margin: 2px 0; font-size: 1.5rem; letter-spacing: -0.01em; }
  header .meta { color: #94a3b8; font-size: 0.74rem; }
  .logos { display: flex; align-items: center; gap: 14px; }

  .franja { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.7rem;
            background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; margin: 4px 0 18px; }
  .franja em { color: #94a3b8; font-size: 0.68rem; margin-left: auto; font-style: normal; }
  .franja b.geoinf-badge--medido, .franja b.geoinf-badge--interp { font-weight: 800; }

  .veredicto {
    display: flex; align-items: flex-start; gap: 14px;
    border: 1px solid ${VIZ.grid}; border-left: 4px solid ${VIZ.inkMuted};
    border-radius: 12px; padding: 15px 18px; margin: 0 0 22px;
    background: ${VIZ.plane};
  }
  .veredicto-eyebrow { font-size: 0.6rem; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; color: ${VIZ.inkMuted}; }
  .veredicto p { font-size: 0.86rem; margin: 4px 0 0; color: ${VIZ.inkSecondary}; max-width: 82ch; line-height: 1.55; }

  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 0 0 24px; }
  .kpi { border: 1px solid ${VIZ.grid}; border-radius: 12px; padding: 13px 14px; background: ${VIZ.surface}; }
  .kpi .l { font-size: 0.58rem; color: ${VIZ.inkMuted}; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; }
  .kpi .v { font-size: 1.75rem; font-weight: 700; color: ${VIZ.inkPrimary}; line-height: 1.15; margin: 5px 0 2px; display: flex; align-items: baseline; gap: 3px; }
  .kpi .v .u { font-size: 0.72rem; font-weight: 600; color: ${VIZ.inkMuted}; }
  .kpi .pie { font-size: 0.63rem; color: ${VIZ.inkMuted}; line-height: 1.35; }

  h2 {
    color: ${SRL_MARRON}; font-size: 0.78rem; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.08em;
    padding: 0 0 7px; margin: 34px 0 12px;
    border: 0; border-bottom: 2px solid ${SRL_MARRON};
  }
  .geoinf-bloque { margin-bottom: 8px; }
  .geoinf-mapa { margin-bottom: 6px; }
  .geoinf-pienota { font-size: 0.74rem; color: ${VIZ.inkMuted}; font-style: italic; margin: 6px 0 10px; }
  /* Mismo patrón .fig/figcaption que exportClimaReport.ts — el mapa se lee
     como figura de un documento técnico, no como bloque suelto. */
  .fig { margin: 14px 0 18px; padding: 14px 16px 10px; border: 1px solid ${VIZ.grid}; border-radius: 12px; background: ${VIZ.surface}; }
  .fig figcaption { margin-bottom: 10px; }
  .fig figcaption b { display: block; font-size: 0.83rem; color: ${VIZ.inkPrimary}; }
  .fig figcaption span { display: block; font-size: 0.7rem; color: ${VIZ.inkMuted}; margin-top: 2px; }
  .geoinf-detalle { color: ${VIZ.inkSecondary}; font-size: 0.75rem; }
  .geoinf-badge { font-size: 0.6rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; letter-spacing: 0.03em; }
  .geoinf-badge--medido { background: #dcfce7; color: #15803d; }
  .geoinf-badge--interp { background: #fef3c7; color: #92400e; }

  table { width: 100%; border-collapse: collapse; font-size: 0.79rem; margin: 10px 0; font-variant-numeric: tabular-nums; }
  th { background: ${SRL_MARRON}; color: #fff; padding: 8px 7px; text-align: left; font-size: 0.63rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  th:first-child { border-radius: 7px 0 0 0; }
  th:last-child { border-radius: 0 7px 0 0; }
  td { padding: 8px 7px; border-bottom: 1px solid ${VIZ.grid}; }
  tbody tr:nth-child(even) { background: ${VIZ.plane}; }

  .geoinf-nota { font-size: 0.8rem; color: ${VIZ.inkSecondary}; background: #f8fafc; border-radius: 8px; padding: 12px 16px; margin: 4px 0 8px; border: 1px solid ${VIZ.grid}; line-height: 1.6; }

  /* Tabla de precipitación por estación (24h/mes/temporada) — namespaced
     geoinf-pp-* para no heredar el selector genérico table/td del documento
     (que tiñe filas pares y usa cabecera marrón sólida, pensada para 4
     columnas categóricas, no 3 numéricas + total). */
  .geoinf-pp-tabla { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  .geoinf-pp-tabla th { text-align: left; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: ${VIZ.inkMuted}; padding: 5px 8px; border-bottom: 2px solid ${VIZ.grid}; }
  .geoinf-pp-tabla th small { font-weight: 500; text-transform: none; letter-spacing: 0; }
  .geoinf-pp-tabla td { padding: 6px 8px; border-bottom: 1px solid ${VIZ.grid}; }
  .geoinf-pp-tabla .geoinf-pp-n { text-align: right; font-variant-numeric: tabular-nums; color: ${VIZ.serie[0]}; font-weight: 700; white-space: nowrap; }
  .geoinf-pp-tabla tfoot td { border-bottom: none; border-top: 2px solid ${SRL_MARRON}; font-weight: 800; color: ${VIZ.inkPrimary}; }
  .geoinf-pp-tabla tfoot .geoinf-pp-n { color: ${SRL_MARRON}; }

  .foot { margin-top: 36px; padding-top: 15px; border-top: 2px solid ${SRL_MARRON}; font-size: 0.67rem; color: ${VIZ.inkMuted}; line-height: 1.6; display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
  .foot b { color: ${SRL_MARRON}; }
  .foot-sello { text-align: right; white-space: nowrap; color: ${VIZ.inkSecondary}; font-weight: 600; }
  .foot-sello em { font-weight: 400; color: ${VIZ.inkMuted}; font-style: normal; }

  @page { margin: 14mm; }
  /* Flujo decorativo de las flechas de viento: marcha de guiones a lo largo
     de la línea, para dar sensación de movimiento — NO es una simulación de
     campo de viento (eso requeriría una densidad de datos que esta red de 5
     estaciones no tiene); es la misma flecha estática de siempre, con vida
     visual. Ver flechaViento() en el generador. */
  @keyframes geoinf-flujo-viento { to { stroke-dashoffset: -16; } }
  .geoinf-flecha-viento { stroke-dasharray: 4 4; animation: geoinf-flujo-viento 0.9s linear infinite; }

  @media print {
    body { padding: 0; background: #fff; }
    .kpi, table, .veredicto, .geoinf-bloque, .franja, .fig { break-inside: avoid; }
    .geoinf-bloque + .geoinf-bloque { break-before: page; }
    h2 { break-after: avoid; }
    header { break-after: avoid; }
    th, .geoinf-badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    /* Impreso/exportado a PDF es una foto fija: se congela con línea sólida
       (sin el guión de la animación) en vez de dejar un patrón detenido a
       medio ciclo, que se vería como una línea punteada sin motivo. */
    .geoinf-flecha-viento { animation: none; stroke-dasharray: none; }
    /* Mapas altos (el extent ahora incluye Boquilla, ~60 km al sur de los
       módulos, así que el lienzo puede superar una página A4 completa):
       se escalan hacia ABAJO solo al imprimir para que quepan enteros en una
       página, sin perder el tamaño grande y detallado en pantalla. El SVG ya
       tiene viewBox, así que limitar max-height mantiene la proporción. */
    .geoinf-mapa svg { max-height: 620px; width: auto; max-width: 100%; }
  }
  @media (max-width: 720px) {
    body { padding: 14px; }
    .kpis { grid-template-columns: repeat(2, 1fr); }
    header { flex-wrap: wrap; }
    table { font-size: 0.72rem; }
  }
</style>
</head><body><div class="wrap">
  <header>
    <div class="logos">${logoImg(logoSICA, 'SICA-005')}</div>
    <div class="titulo">
      <div class="sub">S R L Unidad Conchos · Delicias, Chihuahua</div>
      <h1>Informe Geoclimático por Módulo</h1>
      <div class="meta">Distrito de Riego 005 · Red WeatherLink (Davis) + interpolación IDW · Corte: ${hoy}</div>
    </div>
    <div class="logos">${logoImg(logoSRL, 'SRL Unidad Conchos')}</div>
  </header>

  <div class="franja">
    <b class="geoinf-badge geoinf-badge--medido">MEDIDO</b> estación propia (Módulo 1, 3, 5)
    <b class="geoinf-badge geoinf-badge--interp">INTERPOLADO</b> IDW p=2 entre estaciones activas (Módulo 2, 4, 12)
    <em>Metodología completa al pie del informe</em>
  </div>

  <div class="veredicto">
    <div>
      <div class="veredicto-eyebrow">Lectura del corte</div>
      <p>${veredicto}</p>
    </div>
  </div>

  <div class="kpis">${kpisSVG}</div>

  ${bloques}

  <h2>Estaciones de la red (fuente de los mapas anteriores)</h2>
  <table>
    <thead><tr><th>Estación</th><th>Rol</th><th>Temp.</th><th>Viento</th><th>Radiación</th><th>Precipitación</th><th>Frescura</th></tr></thead>
    <tbody>${filasEstaciones}</tbody>
  </table>

  <h2>Metodología, fuentes y limitaciones</h2>
  <div class="geoinf-nota">
    Cada módulo con estación meteorológica propia (Módulo 1, 3, 5) muestra su <b>lectura medida</b>.
    Los módulos sin estación (2, 4, 12) muestran un valor <b>interpolado</b> por distancia inversa
    (IDW, potencia 2) entre las estaciones activas de la red — nunca se le asigna a un módulo el
    dato de otro como si fuera propio. El viento se interpola por componentes (velocidad
    este-oeste / norte-sur), no promediando grados directamente, porque la dirección es una
    variable circular: promediar 350° y 10° daría 180°, la dirección opuesta a ambas. Radiación
    solar y precipitación son las variables más sensibles a nubosidad/convección local — su valor
    interpolado en un módulo sin estación debe leerse con más cautela que temperatura o viento,
    especialmente en módulos alejados de toda estación (ver distancia declarada en cada mapa).
    Un valor con "+" en un mapa indica que supera el máximo de la escala de color declarada.
  </div>

  <div class="foot">
    <span>
      <b>Informe Geoclimático por Módulo · SICA-005</b><br>
      Estaciones Davis/WeatherLink · Interpolación IDW p=2 sobre la geofrontera real de los 6 módulos SRL.<br>
      Documento generado automáticamente.
    </span>
    <span class="foot-sello">
      SRL Unidad Conchos<br>
      <em>Distrito de Riego 005 · Delicias, Chih.</em>
    </span>
  </div>
</div></body></html>`;
}

/** Opciones por defecto: las 4 variables — mismo comportamiento que el
 *  informe tenía antes del modal de selección. */
const OPCIONES_POR_DEFECTO: OpcionesGeoInforme = {
    variables: ['tempC', 'vientoMs', 'radSolarWm2', 'lluviaDiaMm'],
};

/** Genera el Informe Geoclimático por Módulo y lo entrega como archivo HTML
 *  autónomo. `opciones` (variables a incluir + serie histórica opcional)
 *  viene del modal de selección en Clima.tsx; se omite para mantener el
 *  comportamiento previo (las 4 variables, sin evolución) en cualquier otro
 *  llamador. El mapa siempre es del corte actual. */
export async function exportClimaGeoInforme(
    estaciones: EstacionConLectura[], opciones: OpcionesGeoInforme = OPCIONES_POR_DEFECTO,
): Promise<void> {
    const html = await buildHTML(estaciones, opciones);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const date = getTodayString();
    await guardaOComparte(blob, `informe-geoclimatico-modulos-${date}.html`, 'text/html');
}

// Exportado para pruebas fuera de la UI (ver scratchpad de la auditoría).
export { buildHTML };
