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
import { tablaPrecipitacion, NOTA_TABLA_PRECIPITACION, NOTA_TABLA_PRECIPITACION_PERIODO, NOTA_TABLA_PRECIPITACION_CONSOLA } from './tablaPrecipitacion';
import type { DiaMaxLluvia } from './climaResumenMensual';
import { assetToDataURI } from './assetToDataURI';
import { resuelveFondoHillshade, LEYENDA_VIIRS, type FondoHillshade, type FondoNocturno } from './mapaHillshadeDEM';
import { guardaOComparte } from './descargaArchivo';
import { getTodayString } from './dateHelpers';
import { nombreMes } from './nombreMes';

const SRL_MARRON = '#6B2D2D';

/** Qué variables e periodo incluir — elegido en el modal previo a la
 *  descarga (Clima.tsx). generarGeoInforme en Clima.tsx SIEMPRE resuelve un
 *  rango concreto antes de llamar aquí: si el usuario no elige uno explícito
 *  ("Todo el histórico" en el modal), se usa desde el primer mes con datos de
 *  la red hasta hoy — nunca queda sin periodo. `estaciones` (el argumento de
 *  exportClimaGeoInforme) ya llega resuelto como el AGREGADO de ese rango
 *  (ver estacionesDesdeResumenRango en climaResumenMensual.ts) — este archivo
 *  no distingue instante de agregado, solo usa periodoDesde/periodoHasta para
 *  las etiquetas de texto del documento. Cada bloque de variable incluye
 *  además una gráfica de evolución mes a mes (ver `serieMensual` abajo),
 *  acotada al rango. */
export interface OpcionesGeoInforme {
    variables: Array<VariableMapa['clave']>;
    /** Rango a mostrar (YYYY-MM-DD, inclusive) — generarGeoInforme en
     *  Clima.tsx siempre lo resuelve antes de llegar aquí (ver arriba);
     *  opcional solo porque otros llamadores hipotéticos podrían omitirlo, en
     *  cuyo caso este archivo cae de vuelta al corte actual (última lectura). */
    periodoDesde?: string;
    periodoHasta?: string;
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
        tempCProm: number | null; vientoMsProm: number | null; radSolarWm2Prom: number | null; lluviaMmAcumulada: number | null;
        /** true si este mes es el primero con datos de toda la red (arrancó a
         *  mitad de mes calendario) — ver diasEsperados en climaResumenMensual.ts. */
        parcial?: boolean }>;
    /**
     * Día de mayor lámina de lluvia dentro del periodo, por estación (clave:
     * `EstacionClima.id`) — resuelto en Clima.tsx desde
     * `fn_clima_resumen_mensual` (climaResumenMensual.ts) sin consulta
     * adicional. Solo tiene sentido bajo periodo (con corte instantáneo no
     * hay "día de mayor lluvia" que buscar, la lectura ya es de un solo
     * momento) — la subtabla de precipitación por estación lo usa para
     * distinguir un evento fuerte concentrado en un día de una lluvia ligera
     * repartida en varios (mismo acumulado total, muy distinto para
     * infiltración/escorrentía). Ausente o sin entrada para una estación:
     * esa estación no tuvo lluvia >0 registrada en el rango.
     */
    diaMaxLluviaPorId?: Map<string, DiaMaxLluvia>;
    /**
     * true cuando el valor de precipitación en `estaciones` (lluvia_dia_mm,
     * leído vía estacionAMuestra por todo el generador) YA fue sustituido en
     * Clima.tsx por el contador real "acum. temporada" de cada consola
     * física WeatherLink, en vez del acumulado reconstruido desde la BD —
     * solo ocurre en modo "todo el histórico" (el usuario no eligió fechas en
     * el modal). La consola puede llevar registrando lluvia desde ANTES de
     * que la red se diera de alta en SICA-005 (confirmado 2026-09-16: Módulo
     * 3 real = 174.8 mm "anual como de Jan" en la app WeatherLink nativa,
     * reconstruido desde BD = solo 74.7 mm porque la BD únicamente tiene
     * lecturas desde julio) — 174.8 es la cifra real de cuánto ha llovido,
     * 74.7 es un piso truncado por cuándo empezamos a capturar. Cuando este
     * flag es true, "promedio diario" y "día de mayor lluvia" (que sí
     * dependen de las lecturas día por día que la BD tiene) dejan de
     * calcularse: mezclarían un acumulado de ~8 meses con un promedio o
     * máximo derivado de solo los ~2-3 meses capturados, dos rangos
     * distintos en la misma fila. No aplica a un rango explícito: el
     * contador de consola no puede recortarse a fechas arbitrarias, ahí se
     * sigue usando el acumulado reconstruido con sus 3 columnas completas.
     */
    precipitacionEsRealDeConsola?: boolean;
    /**
     * false (default) = modo SIMPLE: KPIs, mapas y gráficas, pensado para
     * personal no técnico (operadores de campo, gerencia) — se omiten la
     * tabla "Panorama por módulo", la tabla "Promedio mensual dentro del
     * periodo", la tabla "Estaciones de la red" y la subtabla "Precipitación
     * por estación" en su forma de 3 columnas numéricas; la tabla por módulo
     * baja de 4 a 2 columnas; las leyendas de mapa pierden coordenadas/
     * proyección/decimales de rampa; las alertas se redactan en lenguaje
     * llano; la nota de metodología se colapsa en un acordeón. true = modo
     * TÉCNICO: comportamiento históricamente existente, con badges MEDIDO/
     * INTERPOLADO, distancias IDW en km, cobertura de muestras y el texto de
     * alertas orientado a auditoría de datos. Ningún dato ni cálculo cambia
     * entre modos — es puramente qué tanto de lo ya calculado se presenta
     * (pedido del usuario 2026-09-16: la vista técnica completa es ilegible
     * para quien no audita datos, pero la trazabilidad no debe perderse para
     * quien sí la necesita).
     */
    modoTecnico?: boolean;
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

/**
 * Raster de fondo: grilla fina de celdas cuadradas, cada una coloreada por el
 * valor interpolado IDW en su centro (color CONTINUO, no de escalón) —
 * produce el efecto de "isla de calor" suave dentro de cada módulo.
 *
 * Ya NO decide celda por celda si pintar (puntoEnAlgunModulo): un recorte por
 * celda cuadrada de 9px deja un borde "escalonado" (dientes de sierra) contra
 * el contorno real del módulo, que es una curva — detectado por captura de
 * pantalla 2026-09-14 tras el primer intento de recorte estricto. El
 * recorte real ahora lo hace un <clipPath> vectorial con el path exacto de
 * los polígonos (ver clipModulosSVG en mapaVariableSVG), que da un borde
 * perfectamente curvo sin escalones — esta función solo pinta la grilla
 * completa del extent, sin preocuparse de fronteras.
 */
function rasterCalorSVG(
    cfg: VariableMapa, muestras: EstacionMuestra[], rango: { min: number; max: number },
    sx: (lo: number) => number, sy: (la: number) => number,
    minLo: number, maxLo: number, minLa: number, maxLa: number,
): string {
    const CELDA_PX = 9; // tamaño de celda en píxeles de salida — suficientemente fino para verse suave, sin generar miles de <rect>
    const W_PX = sx(maxLo) - sx(minLo);
    const H_PX = sy(minLa) - sy(maxLa);
    const cols = Math.max(1, Math.round(W_PX / CELDA_PX));
    const rows = Math.max(1, Math.round(H_PX / CELDA_PX));
    const rects: string[] = [];
    for (let r = 0; r < rows; r++) {
        const la = maxLa - ((r + 0.5) / rows) * (maxLa - minLa);
        for (let c = 0; c < cols; c++) {
            const lo = minLo + ((c + 0.5) / cols) * (maxLo - minLo);
            const resultado = interpolaClimaEnPunto({ lat: la, lon: lo }, muestras);
            const color = colorContinuoEnRampa(resultado[cfg.clave], cfg, rango);
            const x = sx(minLo) + c * (W_PX / cols), y = sy(maxLa) + r * (H_PX / rows);
            rects.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(W_PX / cols + 0.6).toFixed(1)}" height="${(H_PX / rows + 0.6).toFixed(1)}" fill="${color}"/>`);
        }
    }
    return rects.join('');
}

/**
 * Construye el <clipPath> vectorial con la unión de los 6 polígonos de
 * módulo, ligeramente EXPANDIDOS (dilatación radial simple desde el
 * centroide de cada anillo, ~4px en espacio de pantalla) — el usuario pidió
 * expresamente que el color pueda sobresalir un poco del contorno exacto con
 * tal de que el borde se vea curvo y limpio, no escalonado. Varios <path>
 * dentro de un mismo <clipPath> se unen (nonzero fill-rule por defecto): el
 * área visible es la unión de los 6, exactamente lo que se necesita para
 * recortar un único raster continuo.
 */
function clipModulosSVG(id: string, sx: (lo: number) => number, sy: (la: number) => number): string {
    const EXPANSION_PX = 4;
    const paths = Object.values(MODULOS_SRL).map(ring => {
        const pts = ring.map(([lo, la]) => [sx(lo), sy(la)] as [number, number]);
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        const expandido = pts.map(([x, y]) => {
            const dx = x - cx, dy = y - cy;
            const d = Math.hypot(dx, dy) || 1;
            return [x + (dx / d) * EXPANSION_PX, y + (dy / d) * EXPANSION_PX] as [number, number];
        });
        const d = expandido.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
        return `<path d="${d}"/>`;
    }).join('');
    return `<clipPath id="${id}">${paths}</clipPath>`;
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
    logosModulo: LogosModulo, fondo: FondoHillshade | FondoNocturno | null,
    /** Título a mostrar en la cartela interna del mapa — por defecto
     *  `cfg.titulo`, pero bajo periodo el llamador pasa la variante
     *  "(acumulado del periodo)" para lluviaDiaMm (ver tituloBloque en
     *  buildHTML) — así el mapa sigue siendo autosuficiente si se recorta y
     *  comparte suelto, sin volver a decir "(día)" cuando en realidad
     *  muestra un acumulado de meses. */
    tituloCartela?: string,
    /** false (default) = modo simple: se omiten la retícula de coordenadas
     *  (28.40°, -105.60°...), los 9 decimales de la rampa de color y la nota
     *  de atribución técnica al pie del mapa (fuente/IDW/proyección WGS-84) —
     *  puro ruido para quien no está auditando el dato. El mapa en sí (color,
     *  tramado medido/interpolado, escala, flecha de norte) no cambia entre
     *  modos: solo el texto de apoyo alrededor. */
    modoTecnico = true,
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
    const rasterSVG = rasterCalorSVG(cfg, muestrasIDW, rango, sx, sy, minLo, maxLo, minLa, maxLa);

    // Fondo de relieve/satelital real (mapaHillshadeDEM.ts) — va DETRÁS del
    // raster de color: el dato climático sigue siendo la variable principal,
    // esto solo da textura de terreno sin competir por atención. Se dibuja
    // sobre el extent COMPLETO del lienzo (no solo el de los módulos, como
    // hace el raster con su buffer) para que el hillshade/luces nocturnas
    // cubran también el margen del 12% del encuadre, evitando un borde
    // rectangular visible entre "terreno" y "vacío". El fondo día
    // (escala de grises) se mezcla con `mix-blend-mode:multiply` para que
    // nunca aclare el raster de color por encima de sí mismo (solo puede
    // oscurecerlo, igual que una sombra real sobre un mapa impreso); el
    // fondo noche (VIIRS) usa opacidad reducida en vez de multiply, porque
    // multiply sobre una imagen ya oscura la dejaría casi negra.
    const fondoSVG = fondo ? (() => {
        // Tanto de día como de noche, el fondo se dibuja con SU PROPIO bbox
        // real (fondo.minLon/maxLon/minLat/maxLat), nunca estirado al extent
        // del mapa (minLo/maxLo/minLa/maxLa, que varía por variable e incluye
        // el margen del 12% de extentModulos() y a veces Boquilla) — de lo
        // contrario la imagen se deforma y el terreno real queda desplazado
        // respecto a las coordenadas/estaciones dibujadas encima (bug
        // reportado por el usuario 2026-09-14: Boquilla aparecía sobre tierra
        // seca en vez de junto al vaso visible en la propia foto). El fondo
        // día (BBOX_HILLSHADE_DISTRITO, fijo desde que se generó el asset) y
        // el fondo noche (bbox real del mosaico VIIRS, recortado a tesela
        // completa) NUNCA coinciden exactamente con el extent del lienzo, así
        // que ambos ramas usan el mismo patrón de posicionamiento.
        const px = sx(fondo.minLon), py = sy(fondo.maxLat);
        const pw = sx(fondo.maxLon) - sx(fondo.minLon), ph = sy(fondo.minLat) - sy(fondo.maxLat);
        if (fondo.modo === 'dia') {
            // Opacidad subida de 0.55→0.85: con la imagen ahora en su
            // proporción real (sin el estiramiento que antes difuminaba el
            // detalle), 0.55 se leía como relieve plano — el usuario pidió
            // explícitamente que la diferencia de altitud se note con
            // claridad. mix-blend-mode:multiply sigue garantizando que esta
            // capa solo puede OSCURECER el raster de color de arriba, nunca
            // aclararlo, así que subir la opacidad no compromete la lectura
            // del dato climático (sigue siendo la capa más superficial).
            return `<image href="${fondo.dataURI}" x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" preserveAspectRatio="xMidYMid slice" style="mix-blend-mode:multiply" opacity="0.85"/>`;
        }
        // Sin velo azul plano encima (existía para dar ambiente nocturno
        // cuando VIIRS no tenía relieve propio) — ahora que
        // construyeFondoNocturnoVIIRS() multiplica un hillshade DEM real
        // dentro del propio dataURI (mapaHillshadeDEM.ts, 2026-09-14), un
        // velo uniforme por encima solo apagaba ese relieve recién agregado
        // (bug reportado por el usuario: "lo veo igual" tras el cambio,
        // confirmado numéricamente — el velo bajaba el brillo medio ~29%).
        return `<image href="${fondo.dataURI}" x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" preserveAspectRatio="xMidYMid slice" opacity="0.9"/>`;
    })() : '';

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
    // Todas las estaciones dentro del encuadre llevan su marcador (círculo de
    // identificación) — antes solo las "sin cápsula" (presas, Riego San
    // Rafael) lo tenían, y una estación con cápsula de módulo (M1/3/5) quedaba
    // sin ningún símbolo de "aquí hay una estación física" en el mapa, lo que
    // se leía como si esa estación no existiera (reportado por el usuario
    // 2026-09-14). Solo la ETIQUETA DE TEXTO sigue reservada a las estaciones
    // sin cápsula, para no repetir el mismo valor dos veces en el mapa.
    const estacionesEnEncuadrePre = estaciones.filter(e =>
        e.longitud >= minLo && e.longitud <= maxLo && e.latitud >= minLa && e.latitud <= maxLa);
    const estacionesVisiblesPre = estacionesEnEncuadrePre.filter(e => !nombresEnCapsulaPre.has(e.nombre));
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
        // Badge "estación aquí" COSIDO al borde de la cápsula (esquina
        // superior derecha), en vez de un marcador de 20px independiente
        // dibujado en la coordenada geográfica real de la estación. Antes,
        // en M1/M3/M5 (módulos con estación propia), ambos elementos caían
        // prácticamente en el mismo punto — el centroide del módulo y la
        // estación que le da nombre están a metros de distancia entre sí,
        // muy por debajo de la resolución del mapa — así que el marcador
        // quedaba incrustado sobre el borde de la cápsula, cortándola
        // (detectado por captura de pantalla 2026-09-14). El badge se mueve
        // CON la cápsula (ya resuelta por el solver anti-colisión), nunca
        // queda huérfano en una coordenada que el solver no conoce.
        const badgeMedido = info?.medido
            ? `<circle cx="${(lx + capW / 2 - 3).toFixed(1)}" cy="${(ly - capH / 2 + 3).toFixed(1)}" r="5.5" fill="#fff" stroke="#0f172a" stroke-width="1.8"/>
                <circle cx="${(lx + capW / 2 - 3).toFixed(1)}" cy="${(ly - capH / 2 + 3).toFixed(1)}" r="2.1" fill="#0f172a"/>`
            : '';
        return `<rect x="${(lx - capW / 2).toFixed(1)}" y="${(ly - capH / 2).toFixed(1)}" width="${capW.toFixed(1)}" height="${capH}" rx="7" fill="#fff" fill-opacity="0.95" stroke="${BORDE}" stroke-width="1.5"/>
                ${logoSVG}
                <text x="${cxTexto.toFixed(1)}" y="${(ly - 2).toFixed(1)}" font-size="10.5" font-weight="800" text-anchor="middle" fill="#0f172a" font-family="system-ui">M${num}</text>
                <text x="${cxTexto.toFixed(1)}" y="${(ly + 10.5).toFixed(1)}" font-size="9" font-weight="700" text-anchor="middle" fill="#334155" font-family="system-ui">${etiquetaValor} ${cfg.unidad}</text>
                ${distTxt ? `<text x="${cxTexto.toFixed(1)}" y="${(ly + capH / 2 + 9).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="#64748b" font-family="system-ui">${distTxt}</text>` : ''}
                ${flechaModulo}
                ${badgeMedido}`;
    }).join('');
    const modulosSVG = contornosSVG + etiquetasSVG;

    // Solo se dibujan en el mapa las estaciones que caen dentro del encuadre
    // de los módulos — una presa lejana (Boquilla, Las Vírgenes) sigue
    // contribuyendo a la interpolación IDW (calculaValoresPorModulo usa TODAS
    // las estaciones), pero su marcador no se fuerza dentro de un mapa cuyo
    // encuadre es la geofrontera de los módulos, no el distrito completo.
    // TODAS las estaciones en el encuadre llevan el marcador circular (ver
    // estacionesEnEncuadrePre arriba) — incluidas Módulo 1/3/5, que antes
    // quedaban sin ningún símbolo de "aquí hay una estación física" porque su
    // dato ya vive en la cápsula del módulo (detectado por el usuario
    // 2026-09-14: una estación real sin marcador se leía como ausente). Solo
    // las estaciones SIN cápsula de módulo (Nombres fuera de
    // MODULOS_CON_ESTACION) llevan además la etiqueta de texto al lado —
    // repetirla junto a una cápsula duplicaría el mismo dato dos veces en el
    // mismo punto (detectado por captura de pantalla). La posición del texto
    // (x/y) viene YA resuelta por el solver AABB de arriba (etiquetasEst) — el
    // marcador se queda en su coordenada geográfica real (anclaX/anclaY),
    // solo la caja de texto se desplaza si chocaba con una cápsula de módulo
    // vecina (ej. Las Vírgenes vs M5).
    const etiquetasEstPorNombre = new Map(etiquetasEst.map(et => [et.estacion.nombre, et]));
    const estSVG = estacionesEnEncuadrePre.map(e => {
        const x = sx(e.longitud), y = sy(e.latitud);
        const m = estacionAMuestra(e);
        const et = etiquetasEstPorNombre.get(e.nombre);
        // Estaciones con cápsula de módulo (M1/3/5, ver nombresEnCapsulaPre)
        // YA llevan su indicador de "estación medida" cosido al borde de esa
        // cápsula (badgeMedido, en etiquetasSVG) — su centroide de módulo y
        // su coordenada geográfica real están a metros de distancia, muy por
        // debajo de la resolución del mapa, así que dibujar AQUÍ además un
        // marcador de 20px en su lat/lon real lo incrustaba sobre el borde
        // de la cápsula, cortándola (detectado por captura de pantalla
        // 2026-09-14). Sin marcador propio: el badge en la cápsula ya cubre
        // la necesidad original de "que se vea que aquí hay una estación
        // física" sin competir por el mismo punto en el mapa.
        if (nombresEnCapsulaPre.has(e.nombre)) return '';
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
        const etiquetaTxt = et
            ? `<text x="${et.x.toFixed(1)}" y="${et.y.toFixed(1)}" font-size="9.5" font-weight="700" text-anchor="middle" fill="#0f172a" font-family="system-ui" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(et.txt)}</text>`
            : '';
        return `${marcador}${flecha}${etiquetaTxt}`;
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
    // mostrar. Modo simple: solo mínimo y máximo (2 ticks) — la escala
    // completa en 9 decimales es lectura de instrumento, no de operación;
    // "de qué a qué color" ya se entiende con los dos extremos.
    const ticks = modoTecnico
        ? Array.from({ length: cfg.rampa.length + 1 }, (_, i) => {
            const v = rango.min + (i * (rango.max - rango.min)) / cfg.rampa.length;
            const x = leyX + (i * leyW) / cfg.rampa.length;
            return `<text x="${x.toFixed(1)}" y="${(leyY + 22).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="${VIZ.inkMuted}">${cfg.fmt(v)}</text>`;
        }).join('')
        : [
            `<text x="${leyX.toFixed(1)}" y="${(leyY + 22).toFixed(1)}" font-size="7.5" text-anchor="start" fill="${VIZ.inkMuted}">${cfg.fmt(rango.min)}</text>`,
            `<text x="${(leyX + leyW).toFixed(1)}" y="${(leyY + 22).toFixed(1)}" font-size="7.5" text-anchor="end" fill="${VIZ.inkMuted}">${cfg.fmt(rango.max)}</text>`,
        ].join('');
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
    // líneas o demasiadas según el mapa. Modo simple: se omite del todo — es
    // el tipo de referencia (coordenadas geográficas) que solo un usuario
    // técnico consulta, ruido puro para operación diaria.
    const pasoG = spanLa > 0.6 ? 0.2 : spanLa > 0.25 ? 0.1 : 0.05;
    const decGrid: string[] = [];
    if (modoTecnico) {
        for (let la = Math.ceil(minLa / pasoG) * pasoG; la <= maxLa; la += pasoG) {
            const y = sy(la);
            decGrid.push(`<line x1="${P}" y1="${y.toFixed(1)}" x2="${W - P}" y2="${y.toFixed(1)}" stroke="#0f172a" stroke-opacity="0.07" stroke-width="0.6"/><text x="${(P - 3).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="8" text-anchor="end" fill="${VIZ.inkMuted}">${la.toFixed(2)}°</text>`);
        }
        for (let lo = Math.ceil(minLo / pasoG) * pasoG; lo <= maxLo; lo += pasoG) {
            const x = sx(lo);
            decGrid.push(`<line x1="${x.toFixed(1)}" y1="${P}" x2="${x.toFixed(1)}" y2="${H - P}" stroke="#0f172a" stroke-opacity="0.07" stroke-width="0.6"/><text x="${x.toFixed(1)}" y="${(H - P + 10).toFixed(1)}" font-size="8" text-anchor="middle" fill="${VIZ.inkMuted}">${lo.toFixed(2)}°</text>`);
        }
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
        <text x="${(P + 6).toFixed(1)}" y="${(P + 14).toFixed(1)}" font-size="10.5" font-weight="700" fill="#fff" font-family="system-ui">${esc(tituloCartela ?? cfg.titulo)} · DR-005</text>
        <text x="${(W - P - 6).toFixed(1)}" y="${(P + 14).toFixed(1)}" font-size="8.5" text-anchor="end" fill="#e2e8f0" font-family="system-ui">${esc(corte)}</text>`;

    // Aviso OBLIGATORIO de la capa VIIRS (fondo nocturno): un composite fijo
    // de 2016 nunca debe leerse como "así se ve el distrito esta noche" — se
    // rotula directamente sobre el mapa (no solo en el pie del documento)
    // porque es la condición explícita bajo la que el usuario aprobó usar
    // esta capa. Franja propia debajo de la cartela, mismo estilo visual.
    // Ancho recortado (no W-2*P completo) para dejar libre la esquina
    // superior derecha, donde vive la flecha de norte (norteSVG) — a todo lo
    // ancho, la franja quedaba por debajo de la flecha y la cortaba a la
    // mitad (detectado por captura de pantalla del modo noche).
    const ANCHO_AVISO_VIIRS = W - 2 * P - 26;
    const avisoViirsSVG = fondo?.modo === 'noche'
        ? `<rect x="${P}" y="${(P + 20).toFixed(1)}" width="${ANCHO_AVISO_VIIRS.toFixed(1)}" height="15" fill="#0a1128" opacity="0.78"/>
           <text x="${(P + 6).toFixed(1)}" y="${(P + 31).toFixed(1)}" font-size="7.5" font-weight="600" fill="#fde68a" font-family="system-ui">⚠ ${esc(LEYENDA_VIIRS)}</text>`
        : '';

    // Modo simple: se omite del todo — atribución de fuente/método técnico,
    // sin valor operativo para quien no audita el dato.
    const atribucionSVG = modoTecnico ? `<line x1="${leyX}" y1="${(H + HL - 20).toFixed(1)}" x2="${W - P}" y2="${(H + HL - 20).toFixed(1)}" stroke="${VIZ.grid}" stroke-width="1"/>
        <text x="${(leyX).toFixed(1)}" y="${(H + HL - 6).toFixed(1)}" font-size="7.5" fill="${VIZ.inkMuted}" font-family="system-ui">Fuente: red WeatherLink (Davis) · interpolación IDW p=2 · proyección geográfica WGS-84 (aspecto corregido por cos φ) · SICA-005</text>` : '';

    return `<svg viewBox="0 0 ${W} ${H + HL + 6}" width="100%" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border-radius:10px" font-family="system-ui">
        <defs>
          <pattern id="hatchInterp" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="7" height="7" fill="transparent"/>
            <line x1="0" y1="0" x2="0" y2="7" stroke="#ffffff" stroke-opacity="0.4" stroke-width="3"/>
          </pattern>
          ${marcoClip}
          ${clipModulosSVG(`clipModulos${cfg.clave}`, sx, sy)}
        </defs>
        <rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="#eef2f6"/>
        <g clip-path="url(#marcoGeo${cfg.clave})">
          ${fondoSVG}
          <g clip-path="url(#clipModulos${cfg.clave})">
            ${rasterSVG}
          </g>
        </g>
        ${decGrid.join('')}
        <rect x="${P}" y="${P}" width="${W - 2 * P}" height="${H - 2 * P}" fill="none" stroke="${VIZ.grid}" stroke-width="1.5"/>
        ${modulosSVG}
        ${estSVG}
        ${cartelaSVG}
        ${avisoViirsSVG}
        <g transform="translate(${(W - P - anchoBarraPx - 8).toFixed(1)},${(H - P - 6).toFixed(1)})">
          <rect x="-6" y="-16" width="${(anchoBarraPx + 44).toFixed(1)}" height="24" rx="4" fill="#fff" fill-opacity="0.85"/>
          ${escalaSVG}
          <text x="0" y="-6" font-size="8.5" fill="${VIZ.inkSecondary}" font-family="system-ui">0</text>
          <text x="${anchoBarraPx.toFixed(1)}" y="-6" font-size="8.5" text-anchor="end" fill="${VIZ.inkSecondary}" font-family="system-ui">${kmBarra} km</text>
        </g>
        ${norteSVG}
        ${atribucionSVG}
        <text x="${leyX}" y="${(leyY - 6).toFixed(1)}" font-size="9" font-weight="700" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(tituloCartela ?? cfg.titulo)} (${cfg.unidad})</text>
        ${pasos}
        ${ticks}
        <rect x="${sdX}" y="${leyY}" width="14" height="10" fill="#cbd5e1"/>
        <text x="${(sdX + 18).toFixed(1)}" y="${(leyY + 9).toFixed(1)}" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">S/D</text>
        <rect x="${leyX}" y="${(leyY + 26).toFixed(1)}" width="12" height="12" rx="2" fill="#e2e8f0" stroke="${BORDE}" stroke-width="1.5"/>
        <text x="${(leyX + 16).toFixed(1)}" y="${(leyY + 35).toFixed(1)}" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">medido</text>
        <rect x="${(leyX + 78).toFixed(1)}" y="${(leyY + 26).toFixed(1)}" width="12" height="12" rx="2" fill="url(#hatchInterp)" stroke="${BORDE}" stroke-width="1.5" stroke-dasharray="3,2"/>
        <rect x="${(leyX + 78).toFixed(1)}" y="${(leyY + 26).toFixed(1)}" width="12" height="12" rx="2" fill="#e2e8f0" opacity="0.5"/>
        <text x="${(leyX + 94).toFixed(1)}" y="${(leyY + 35).toFixed(1)}" font-size="8.5" fill="${VIZ.inkMuted}" font-family="system-ui">${modoTecnico ? 'interpolado (IDW)' : 'estimado'}</text>
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

/**
 * Precipitación por estación, modo SIMPLE — reemplaza la subtabla técnica de
 * 3 columnas numéricas (Acumulado/Promedio diario/Día de mayor lluvia) que
 * disparó este rediseño (reportado por el usuario 2026-09-16: en un corte de
 * un solo día sin lluvia, esa tabla era 7 filas de "0.0 / 0.00 / —", ruido
 * puro repitiendo lo que el KPI de arriba ya dice). Sin lluvia en ninguna
 * estación: una sola línea de texto (mismo principio que "S/D nunca 0" del
 * proyecto, en espejo — un cero real se anuncia en prosa, no en una tabla).
 * Con lluvia: gráfica de barras horizontales (mismo patrón que
 * graficaEtoEstaciones en climaCharts.ts — magnitud directa, sin decimales
 * de más ni columnas de análisis que solo tienen sentido para quien audita
 * datos).
 */
function bloquePrecipitacionSimple(estaciones: EstacionConLectura[]): string {
    const datos = estaciones
        .filter(e => e.lectura?.lluvia_dia_mm != null)
        .map(e => ({ nombre: e.nombre, mm: e.lectura!.lluvia_dia_mm as number }));
    const totalDistrito = datos.reduce((a, d) => a + d.mm, 0);
    if (!datos.length || totalDistrito <= 0.05) {
        return `<div class="geoinf-nota" style="margin-top:14px">
            <p style="font-size:0.8rem;color:${VIZ.inkSecondary};margin:0">Sin lluvia registrada en ninguna estación de la red en este periodo.</p>
        </div>`;
    }
    return `<div class="geoinf-nota" style="margin-top:14px">
        <b style="display:block;margin-bottom:8px;color:${SRL_MARRON};font-size:0.8rem">Precipitación por estación (mm)</b>
        ${graficaBarrasLluviaEstacion(datos)}
    </div>`;
}

/**
 * Barras horizontales de precipitación por estación — mismo lenguaje visual
 * que graficaEtoEstaciones (climaCharts.ts), pero con margen derecho más
 * amplio y 1 decimal: la acumulada de lluvia de un periodo largo llega
 * fácilmente a 3 dígitos (ej. "174.8 mm"), un texto más largo que la ETₒ
 * diaria (típicamente <10) para la que se dimensionó el margen original —
 * reusar esa función tal cual cortaba la etiqueta cuando la barra más alta
 * ocupaba casi todo el ancho disponible.
 */
function graficaBarrasLluviaEstacion(datos: { nombre: string; mm: number }[]): string {
    const d = datos.filter(x => x.mm > 0);
    if (!d.length) return '';
    const W = 460, filaH = 30, MT = 8, ML = 104, MR = 64;
    const H = MT + d.length * filaH + 8;
    const max = Math.max(...d.map(x => x.mm), 0.1);
    const iw = W - ML - MR;
    const alto = Math.min(18, filaH - 12);

    const barras = d.map((x, i) => {
        const w = Math.max(2, (x.mm / max) * iw);
        const by = MT + i * filaH + (filaH - alto) / 2;
        const r = Math.min(4, w);
        return `<path d="M${ML},${by.toFixed(1)} L${(ML + w - r).toFixed(1)},${by.toFixed(1)}
                 Q${(ML + w).toFixed(1)},${by.toFixed(1)} ${(ML + w).toFixed(1)},${(by + r).toFixed(1)}
                 L${(ML + w).toFixed(1)},${(by + alto - r).toFixed(1)}
                 Q${(ML + w).toFixed(1)},${(by + alto).toFixed(1)} ${(ML + w - r).toFixed(1)},${(by + alto).toFixed(1)}
                 L${ML},${(by + alto).toFixed(1)} Z" fill="${VIZ.lluvia}"/>
                <text x="${ML - 8}" y="${(by + alto / 2 + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5"
                      font-weight="600" fill="${VIZ.inkSecondary}" font-family="system-ui">${esc(x.nombre)}</text>
                <text x="${(ML + w + 7).toFixed(1)}" y="${(by + alto / 2 + 3.5).toFixed(1)}" font-size="9.5"
                      font-weight="700" fill="${VIZ.inkPrimary}" font-family="system-ui"
                      style="font-variant-numeric:tabular-nums">${x.mm.toFixed(1)} mm</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
                 aria-label="Precipitación acumulada por estación">
        <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${H - 8}" stroke="${VIZ.axis}" stroke-width="1"/>
        ${barras}
    </svg>`;
}

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
    // Sin periodo elegido, el mapa de cada variable es el corte actual
    // (última lectura); con periodo, `estaciones` ya llega como el agregado
    // de ese rango (ver OpcionesGeoInforme arriba). `instanteCorte` marca
    // siempre el momento en que se GENERA el documento (para el fondo de
    // relieve/satelital y el pie "Generado:") — no el periodo que analiza.
    const instanteCorte = new Date();
    const hoy = instanteCorte.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });
    // Versión corta para la cartela dentro del SVG (ancho limitado del mapa) —
    // "hoy" completa se reserva para el header del documento HTML.
    const corteCorto = instanteCorte.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
    // Variables elegidas en el modal — si la selección quedara vacía por
    // algún error de estado, se cae a todas (nunca un informe sin mapas).
    const variablesElegidas = VARIABLES.filter(v => opciones.variables.includes(v.clave));
    const variablesActivas = variablesElegidas.length ? variablesElegidas : VARIABLES;
    const activas = estaciones.filter(e => e.activa !== false);

    // Con periodo elegido en el modal, `estaciones` ya llega como el
    // agregado de ese rango (ver estacionesDesdeResumenRango en
    // climaResumenMensual.ts y generarGeoInforme en Clima.tsx) — aquí solo se
    // arma la etiqueta de texto para header/figcaptions/veredicto. Sin
    // periodo, se mantiene la etiqueta histórica "corte actual".
    const { periodoDesde, periodoHasta } = opciones;
    const formateaFechaCorta = (iso: string) => {
        const [anio, mes, dia] = iso.split('-').map(Number);
        return `${dia} ${nombreMes(mes).slice(0, 3)} ${anio}`;
    };
    const etiquetaPeriodo = periodoDesde && periodoHasta
        ? `${formateaFechaCorta(periodoDesde)} – ${formateaFechaCorta(periodoHasta)}`
        : 'corte actual';
    const hayPeriodo = !!(periodoDesde && periodoHasta);
    const modoTecnico = !!opciones.modoTecnico;
    // Días transcurridos del rango (no el total nominal) — mismo criterio que
    // diasEsperadosRango en climaResumenMensual.ts: un periodo que llega
    // hasta hoy o el futuro se recorta a hoy, para no dividir el acumulado
    // entre días que aún no ocurrieron.
    const diasTranscurridosPeriodo = periodoDesde && periodoHasta ? (() => {
        const hoyStr = getTodayString();
        const hastaEfectivo = periodoHasta > hoyStr ? hoyStr : periodoHasta;
        const msPorDia = 24 * 60 * 60 * 1000;
        return Math.max(1, Math.round((Date.parse(hastaEfectivo) - Date.parse(periodoDesde)) / msPorDia) + 1);
    })() : 0;

    // Fondo de relieve/satelital real (mapaHillshadeDEM.ts) — se resuelve UNA
    // SOLA VEZ para los 4 mapas (mismo extent, mismo instante de corte para
    // todos), no dentro de cada mapaVariableSVG: evita 4 fetches idénticos a
    // GIBS de noche y reutiliza el mismo hillshade elegido de día. `null` si
    // falla (sin red, asset no encontrado) — el mapa sigue mostrando el
    // raster de color sin fondo, nunca se rompe el informe por esto.
    const extentFondo = extentModulos(activas);
    const fondoHillshade = await resuelveFondoHillshade(
        extentFondo.minLo, extentFondo.maxLo, extentFondo.minLa, extentFondo.maxLa, instanteCorte,
    );

    // ── Resumen ejecutivo: KPIs + lectura interpretada + alertas operativas ──
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
        ? `lluvia registrada, máximo ${lluviaMax.toFixed(1)} mm en la red${opciones.precipitacionEsRealDeConsola ? ' (acumulado real de consola, no reconstruido)' : ''}`
        : `sin precipitación registrada ${hayPeriodo ? `en ${etiquetaPeriodo}` : 'hoy'}`;
    const veredicto = `${fraseTemp}, ${fraseViento}, ${fraseLluvia}. `
        + `${interpolados} de ${totalModulos} módulos operan con valor interpolado (sin estación meteorológica propia).`;

    // Modo simple: "Cobertura de red 3/6 módulos" no dice nada por sí solo a
    // quien no sabe qué es un módulo interpolado — se traduce a un semáforo
    // de confiabilidad (mismo lenguaje VIZ.estado que usa el resto del
    // proyecto para calidad de dato), con el detalle ("3 módulos sin estación
    // propia") movido al pie en vez de ser el número grande del KPI.
    const proporcionMedida = (totalModulos - interpolados) / totalModulos;
    const confiabilidad = proporcionMedida >= 0.66
        ? { texto: 'Alta', color: VIZ.estado.bueno }
        : proporcionMedida >= 0.33
            ? { texto: 'Media', color: VIZ.estado.aviso }
            : { texto: 'Baja', color: VIZ.estado.critico };
    const kpis = [
        { l: 'Temperatura', v: tMax != null ? tMax.toFixed(0) : '—', u: '°C máx.', pie: tMin != null ? `mín. ${tMin.toFixed(0)} °C` : 'sin dato' },
        { l: 'Viento', v: vMax != null ? vMax.toFixed(1) : '—', u: 'm/s máx.', pie: viento ? `dominante del ${rumboDe((viento.dirDeg + 180) % 360)}` : 'sin dato' },
        {
            l: 'Precipitación',
            v: lluviaMax != null && lluviaMax > 0.05 ? lluviaMax.toFixed(1) : (modoTecnico ? '0.0' : 'Sin lluvia'),
            u: lluviaMax != null && lluviaMax > 0.05 ? 'mm máx.' : '',
            pie: opciones.precipitacionEsRealDeConsola ? 'máximo acumulado real de consola — no promediar' : hayPeriodo ? 'máximo acumulado del periodo — no promediar' : 'máximo puntual de la red — no promediar',
        },
        modoTecnico
            ? { l: 'Cobertura de red', v: `${totalModulos - interpolados}/${totalModulos}`, u: 'módulos', pie: `${interpolados} con valor interpolado`, colorV: undefined as string | undefined }
            : { l: 'Confiabilidad del dato', v: confiabilidad.texto, u: '', pie: `${interpolados} de ${totalModulos} módulos sin estación propia`, colorV: confiabilidad.color },
    ];

    // Valores por módulo de las 4 variables, calculados una sola vez aquí y
    // reutilizados tanto por el bloque de alertas/tabla consolidada como por
    // cada bloque de variable más abajo (antes cada bloque recalculaba los
    // suyos; con la tabla consolidada nueva hacían falta las 4 de entrada,
    // así que se sube el cálculo a un solo punto en vez de duplicarlo).
    const valoresPorModuloTodas = new Map(VARIABLES.map(cfg => [cfg.clave, calculaValoresPorModulo(activas, cfg.clave)] as const));
    const numsModuloOrdenados = Object.keys(MODULOS_SRL).map(Number).sort((a, b) => a - b);

    /**
     * Alertas operativas: observaciones que se pueden leer directamente de
     * los datos YA calculados para este corte, sin fuente nueva ni supuesto
     * de "normalidad histórica" (el informe no tiene climatología de
     * referencia cargada aquí — declarar esa ausencia es más honesto que
     * simular una comparación). Tres familias de alerta:
     *   1. Estación con lectura vencida/sospechosa (evaluaCalidad, ya
     *      calculado por useClimaEstaciones) — el dato mostrado puede no
     *      reflejar la condición actual del módulo.
     *   2. Módulo cuyo valor medido/interpolado se aparta fuerte del resto
     *      de la red (umbral: separado del rango típico ya usado para
     *      colorear el mapa — rangoDelCorte —, no un valor inventado aparte).
     *   3. Viento por encima del umbral operativo habitual para aspersión
     *      (~3.5 m/s, referencia agronómica estándar de deriva de gota) —
     *      se etiqueta como guía operativa, no como métrica medida.
     * Cada alerta es una oración autocontenida; sin ninguna, se declara
     * explícitamente que no se detectaron desviaciones dignas de nota (nunca
     * se deja el bloque vacío sin explicar por qué).
     */
    interface Alerta { nivel: 'aviso' | 'atencion'; texto: string; }
    const alertas: Alerta[] = [];

    const estacionesVencidas = activas.filter(e => e.calidad.status === 'expired');
    const estacionesSospechosas = activas.filter(e => e.calidad.status === 'suspect');
    // 'expired'/'suspect' significan algo distinto según el origen del dato:
    // sin periodo, vienen de la frescura de una lectura real (edadMin, ver
    // cielo.ts) — "vencida" = más de 60 min de antigüedad, "sospechosa" =
    // valor fuera de rango físico (posible falla de sensor). Con periodo,
    // el mismo status lo asigna estacionesDesdeResumenRango a partir de
    // cobertura de muestras del rango (climaResumenMensual.ts:156-169) —
    // "vencida" ahí es "sin ninguna lectura en todo el periodo" y
    // "sospechosa" es "cobertura de muestras por debajo del 60% del rango",
    // ninguna de las dos habla de antigüedad ni de un sensor físico fallando.
    // Reusar el texto de instante bajo periodo afirmaba cosas falsas
    // (detectado por auditoría 2026-09-16 tras el fix de "Todo el histórico").
    if (estacionesVencidas.length) {
        alertas.push({
            nivel: 'atencion',
            texto: !modoTecnico
                // Modo simple: la acción operativa (revisar equipo), sin
                // hablar de "cobertura", "antigüedad" ni "informe".
                ? `${estacionesVencidas.length === 1 ? 'La estación' : 'Las estaciones'} `
                    + `${estacionesVencidas.map(e => esc(e.nombre)).join(', ')} `
                    + `${estacionesVencidas.length === 1 ? 'no está reportando' : 'no están reportando'} — conviene revisar el equipo en campo.`
                : hayPeriodo
                ? `${estacionesVencidas.length === 1 ? 'La estación' : 'Las estaciones'} `
                    + `${estacionesVencidas.map(e => esc(e.nombre)).join(', ')} `
                    + `${estacionesVencidas.length === 1 ? 'no registró' : 'no registraron'} ninguna lectura dentro de ${esc(etiquetaPeriodo)}; `
                    + `${estacionesVencidas.length === 1 ? 'esa estación no aporta' : 'esas estaciones no aportan'} datos a este informe.`
                : `${estacionesVencidas.length === 1 ? 'La estación' : 'Las estaciones'} `
                    + `${estacionesVencidas.map(e => esc(e.nombre)).join(', ')} `
                    + `${estacionesVencidas.length === 1 ? 'reporta' : 'reportan'} un dato vencido (más de 60 min de antigüedad); `
                    + `los valores de este corte para ${estacionesVencidas.length === 1 ? 'esa estación' : 'esas estaciones'} `
                    + `pueden no reflejar la condición actual.`,
        });
    }
    if (estacionesSospechosas.length) {
        alertas.push({
            nivel: 'aviso',
            texto: !modoTecnico
                ? `${estacionesSospechosas.map(e => esc(e.nombre)).join(', ')} `
                    + `${estacionesSospechosas.length === 1 ? 'tiene un dato poco confiable' : 'tienen datos poco confiables'} en este corte — tratar con cautela antes de decidir con ${estacionesSospechosas.length === 1 ? 'él' : 'ellos'}.`
                : hayPeriodo
                ? `${estacionesSospechosas.map(e => esc(e.nombre)).join(', ')} `
                    + `${estacionesSospechosas.length === 1 ? 'tiene' : 'tienen'} cobertura de muestras por debajo del 60% dentro de ${esc(etiquetaPeriodo)} — sus valores agregados deben tratarse como referencia, no como medición robusta del periodo.`
                : `${estacionesSospechosas.map(e => esc(e.nombre)).join(', ')} `
                    + `${estacionesSospechosas.length === 1 ? 'marca' : 'marcan'} una lectura fuera de rango físico esperado (posible falla de sensor) — verificar antes de usarla para una decisión operativa.`,
        });
    }

    // Módulo fuera de línea respecto al resto de la red, por variable: mismo
    // criterio de dispersión que rangoDelCorte (amplitud mínima por variable,
    // para no marcar como "atípico" una diferencia de 0.3°C que es solo ruido
    // de sensor) — un módulo cuyo valor cae en el escalón más alto o más bajo
    // de la rampa de color, cuando la red tiene variación real, ya se lee
    // visualmente en el mapa; aquí se nombra en texto para quien solo lee el
    // resumen. Solo se reporta el caso más marcado por variable (el mapa ya
    // muestra el resto) para no saturar el resumen ejecutivo de líneas.
    for (const cfg of VARIABLES) {
        const valores = valoresPorModuloTodas.get(cfg.clave)!;
        const entradas = numsModuloOrdenados
            .map(num => ({ num, info: valores.get(num) }))
            .filter((e): e is { num: number; info: InfoModulo } => e.info?.valor != null);
        if (entradas.length < 3) continue; // dispersión no es significativa con tan pocos módulos con dato
        const rango = rangoDelCorte(activas, cfg);
        const amplitud = rango.max - rango.min;
        if (amplitud <= 0) continue;
        const vals = entradas.map(e => e.info.valor!);
        const media = vals.reduce((a, b) => a + b, 0) / vals.length;
        let peor = entradas[0];
        let peorDesvio = 0;
        for (const e of entradas) {
            const desvio = Math.abs(e.info.valor! - media);
            if (desvio > peorDesvio) { peorDesvio = desvio; peor = e; }
        }
        // Umbral: la desviación del módulo más extremo debe superar el 55%
        // de la amplitud del rango dinámico del corte (mismo rango que ya
        // colorea el mapa) — un módulo que ya se ve en el extremo de la
        // rampa de color, no una diferencia menor.
        if (peorDesvio >= amplitud * 0.55 && cfg.clave !== 'lluviaDiaMm') {
            const arriba = peor.info.valor! > media;
            alertas.push({
                nivel: 'aviso',
                texto: `Módulo ${peor.num} destaca ${arriba ? 'por encima' : 'por debajo'} del resto de la red en ${cfg.titulo.toLowerCase()} `
                    + `(${cfg.fmt(peor.info.valor!)} ${cfg.unidad} frente a un promedio de red de ${cfg.fmt(media)} ${cfg.unidad})`
                    + `${!peor.info.medido ? (modoTecnico ? ' — valor interpolado, sin estación propia que lo confirme' : ' — este módulo no tiene estación propia, es un valor estimado') : ''}.`,
            });
        }
    }

    // Umbral operativo de viento para aspersión (deriva de gota): referencia
    // agronómica habitual ~3.5 m/s, declarada como guía, no como límite
    // normativo del distrito — se listan los módulos por encima, con su
    // procedencia (medido/interpolado) porque la decisión de suspender un
    // riego por aspersión no debe tomarse solo sobre un valor interpolado.
    const UMBRAL_VIENTO_ASPERSION = 3.5;
    const valoresViento = valoresPorModuloTodas.get('vientoMs')!;
    const modulosVientoAlto = numsModuloOrdenados
        .map(num => ({ num, info: valoresViento.get(num) }))
        .filter((e): e is { num: number; info: InfoModulo } => (e.info?.valor ?? 0) >= UMBRAL_VIENTO_ASPERSION);
    if (modulosVientoAlto.length) {
        alertas.push({
            nivel: 'aviso',
            texto: modoTecnico
                ? `Viento igual o mayor a ${UMBRAL_VIENTO_ASPERSION} m/s (referencia operativa de deriva de gota en aspersión) en `
                    + `${modulosVientoAlto.map(e => `Módulo ${e.num} (${e.info.valor!.toFixed(1)} m/s${!e.info.medido ? ', interpolado' : ''})`).join(', ')}.`
                : `Viento fuerte en ${modulosVientoAlto.map(e => `Módulo ${e.num} (${e.info.valor!.toFixed(1)} m/s)`).join(', ')} — no recomendable regar por aspersión ahora.`,
        });
    }

    if (interpolados >= totalModulos / 2) {
        alertas.push({
            nivel: 'aviso',
            texto: modoTecnico
                ? `${interpolados} de ${totalModulos} módulos dependen de un valor interpolado en este corte — la cobertura de estaciones propias cubre menos de la mitad del distrito; los valores interpolados deben tratarse como referencia, no como medición.`
                : `${interpolados} de ${totalModulos} módulos no tienen estación propia — sus valores son un cálculo aproximado a partir de las estaciones cercanas.`,
        });
    }

    // Nunca se compara contra "lo normal para la época" sin climatología
    // cargada en esta función — declararlo explícitamente es preferible a
    // omitirlo en silencio (el lector podría asumir que la ausencia de
    // comentario significa "es normal").
    const notaSinHistorico = periodoDesde && periodoHasta
        ? 'Este informe no compara el periodo contra un promedio histórico de la fecha: '
            + 'hacerlo requiere una serie climatológica por estación que aún no está integrada a este documento. '
            + 'Las observaciones de abajo son relativas a la propia red dentro del periodo elegido, no a lo esperado para la temporada.'
        : 'Este informe no compara el corte contra un promedio histórico de la fecha: '
            + 'hacerlo requiere una serie climatológica por estación que aún no está integrada a este documento. '
            + 'Las observaciones de abajo son relativas a la propia red en este corte, no a lo esperado para la temporada.';

    // Titular de una línea: el nivel de alerta más alto presente decide el
    // tono (nunca un adjetivo suelto tipo "buen día" que el dato no respalda
    // sin climatología) — "requiere atención" solo si hay una alerta de nivel
    // atencion (dato vencido/sospechoso), "con observaciones" si solo hay
    // avisos (dispersión, viento, cobertura), "sin observaciones" si no hay
    // ninguna. El propio titular nombra CUÁNTAS alertas hay, no solo el tono.
    const hayAtencion = alertas.some(a => a.nivel === 'atencion');
    const titular = alertas.length === 0
        ? 'Sin observaciones operativas para este corte'
        : hayAtencion
            ? `Requiere atención — ${alertas.length} observación${alertas.length === 1 ? '' : 'es'} operativa${alertas.length === 1 ? '' : 's'} para este corte`
            : `Con observaciones — ${alertas.length} punto${alertas.length === 1 ? '' : 's'} a considerar en este corte`;

    const alertasSVG = alertas.length
        ? `<div class="alertas">${alertas.map(a => `<div class="alerta alerta--${a.nivel}">
              <span class="alerta-icono">${a.nivel === 'atencion' ? '⚠️' : '•'}</span>
              <span>${a.texto}</span>
           </div>`).join('')}</div>`
        : `<div class="alertas-ok"><span>✓</span><span>No se detectaron desviaciones relevantes entre módulos, estaciones vencidas/sospechosas, ni viento por encima del umbral operativo de aspersión en este corte.</span></div>`;
    const kpisSVG = kpis.map(k => `<div class="kpi"><div class="l">${k.l}</div><div class="v"${'colorV' in k && k.colorV ? ` style="color:${k.colorV}"` : ''}>${k.v}${k.u ? `<span class="u">${k.u}</span>` : ''}</div><div class="pie">${k.pie}</div></div>`).join('');

    // ── Tabla consolidada: panorama completo (las 4 variables × 6 módulos)
    // en una sola fila por módulo — para quien quiere el cuadro completo de
    // un vistazo antes de entrar al detalle por variable de cada sección de
    // abajo. Solo incluye las variables elegidas en el modal (variablesActivas),
    // igual que el resto del informe. Cada celda lleva su propio badge
    // medido/interpolado — el mismo lenguaje visual que las tablas por
    // variable, nunca un color o cifra con más confianza que la de origen.
    // Modo simple: se omite — es redundante con los mapas de cada sección
    // (mismos valores, sin el contexto geográfico) y su lenguaje es denso
    // para quien no audita datos (puntito medido/interpolado sin leyenda
    // inline, celdas de puro decimal). Modo técnico: se mantiene tal cual.
    const tablaConsolidadaSVG = modoTecnico && variablesActivas.length > 1 ? `<div class="geoinf-tabla-scroll"><table class="geoinf-consolidada">
        <thead><tr>
            <th>Módulo</th>
            ${variablesActivas.map(cfg => `<th>${esc(cfg.titulo)} <small>${esc(cfg.unidad)}</small></th>`).join('')}
        </tr></thead>
        <tbody>${numsModuloOrdenados.map(num => {
            const logoUri = logosModulo.get(num);
            const logoImgTd = logoUri
                ? `<img src="${logoUri}" alt="" width="20" height="20" style="border-radius:999px;object-fit:cover;border:1px solid ${VIZ.grid};vertical-align:middle;margin-right:6px">`
                : '';
            const celdas = variablesActivas.map(cfg => {
                const v = valoresPorModuloTodas.get(cfg.clave)!.get(num);
                const valorTxt = v?.valor != null ? `${cfg.fmt(v.valor)}` : 'S/D';
                const puntito = v?.medido
                    ? `<span class="geoinf-punto geoinf-punto--medido" title="Medido"></span>`
                    : `<span class="geoinf-punto geoinf-punto--interp" title="Interpolado"></span>`;
                return `<td class="geoinf-consolidada-n">${puntito}${valorTxt}</td>`;
            }).join('');
            return `<tr><td>${logoImgTd}<b>Módulo ${num}</b></td>${celdas}</tr>`;
        }).join('')}</tbody>
    </table></div>
    <p class="geoinf-pienota" style="margin-top:6px">
        <span class="geoinf-punto geoinf-punto--medido" style="margin-right:4px"></span>medido
        &nbsp;&nbsp;<span class="geoinf-punto geoinf-punto--interp" style="margin-right:4px"></span>interpolado (IDW) —
        detalle de procedencia y distancia a la estación más cercana en la tabla de cada variable, más abajo.
    </p>` : '';

    // Estaciones que participan en la interpolación (IDW usa TODAS) pero no
    // se dibujan en el mapa por caer fuera de la geofrontera de los módulos
    // (p.ej. las presas, decenas de km al sur/oeste) — se declara en texto
    // para no dar la impresión de que solo "cuentan" las estaciones visibles.
    // MISMO extent que usa mapaVariableSVG (extentModulos) — antes este
    // cálculo vivía duplicado con parámetros distintos y desalineaba lo que
    // el mapa dibujaba de lo que el texto declaraba fuera de él. Reutiliza
    // extentFondo (ya calculado arriba para el fondo de relieve/satelital),
    // en vez de volver a llamar extentModulos con el mismo resultado.
    const extent = extentFondo;
    const fueraDeMapa = activas.filter(e => e.longitud < extent.minLo || e.longitud > extent.maxLo || e.latitud < extent.minLa || e.latitud > extent.maxLa);
    const notaFueraDeMapa = fueraDeMapa.length
        ? `<p class="geoinf-pienota">También participan en la interpolación (fuera del encuadre de este mapa): ${fueraDeMapa.map(e => esc(e.nombre)).join(', ')}.</p>`
        : '';

    // Nota de lectura por variable, para el figcaption — reemplaza la nota de
    // viento suelta que antes vivía como <p> aparte del mapa. Sin periodo
    // elegido el mapa es el corte actual; con periodo, el agregado del rango
    // (ver etiquetaPeriodo); la vista mensual vive en la gráfica de evolución
    // y en la tabla de desglose aparte (graficaEvolucion / tablaMensualPeriodo).
    const NOTA_LECTURA: Record<VariableMapa['clave'], string> = {
        tempC: 'Raster interpolado (IDW p=2) sobre la geofrontera de los módulos, con halo suave más allá del contorno. Rango de color ajustado al mínimo y máximo real de este corte.',
        vientoMs: 'Las flechas indican hacia dónde sopla el viento en cada punto (estación real o módulo interpolado); su longitud junto a la estación codifica intensidad. El movimiento de la flecha es decorativo (da sensación de flujo), no una simulación del campo de viento real. Interpolado por componentes u/v (no promediando grados) porque la dirección es una variable circular.',
        radSolarWm2: 'Raster interpolado (IDW p=2) sobre la geofrontera de los módulos. De noche o con el sol muy bajo, valores cercanos a 0 W/m² son correctos, no ausencia de dato.',
        lluviaDiaMm: 'Raster interpolado (IDW p=2) — la precipitación es la variable más sensible a convección local: un módulo sin estación puede haber recibido lluvia distinta a la interpolada.',
    };
    // Modo simple: mismo mensaje operativo, sin la jerga de método de cálculo
    // ("IDW p=2", "componentes u/v", "variable circular") — el módulo sin
    // estación propia ya se ve marcado como "estimado" en el mapa y la tabla,
    // no hace falta repetir el método en el pie de cada figura.
    const NOTA_LECTURA_SIMPLE: Record<VariableMapa['clave'], string> = {
        tempC: 'Los módulos sin estación propia muestran un valor estimado a partir de las estaciones cercanas.',
        vientoMs: 'Las flechas indican hacia dónde sopla el viento; su longitud junto a la estación indica la intensidad.',
        radSolarWm2: 'De noche o con el sol muy bajo, valores cercanos a 0 W/m² son correctos, no ausencia de dato.',
        lluviaDiaMm: 'Un módulo sin estación propia puede haber recibido una lluvia distinta a la estimada.',
    };

    // Evolución mensual: meses únicos presentes en la serie, orden
    // cronológico ascendente (para que la gráfica se lea izquierda=antiguo →
    // derecha=reciente), y el campo de EstacionMuestra que corresponde a cada
    // variable del mapa — así una sola función arma la gráfica para las 4.
    // Independiente del corte del mapa: se muestra siempre que haya datos.
    const mesesSerie = opciones.serieMensual?.length
        ? Array.from(new Set(opciones.serieMensual.map(p => `${p.anio}-${p.mes}`)))
            .map(k => {
                const [anio, mes] = k.split('-').map(Number);
                // `parcial` es el mismo valor para todos los puntos de un mes
                // (calculado por mes en obtenSerieMensual, no por estación) —
                // basta con leerlo del primero que coincida.
                const parcial = !!opciones.serieMensual!.find(p => p.anio === anio && p.mes === mes)?.parcial;
                return { anio, mes, parcial };
            })
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

    // "Precipitación (día)" (cfg.titulo) es correcto en el corte instantáneo,
    // pero bajo periodo el mapa/tabla de este mismo bloque en realidad
    // muestran el ACUMULADO de todo el rango, no de un día — el título
    // quedaba contradiciendo su propio contenido (detectado por auditoría
    // 2026-09-16: un informe de 3 meses titulado "(día)"). Solo aplica a
    // lluviaDiaMm: temperatura/viento/radiación ya son promedios en ambos
    // modos, sin calificador de "día" que se vuelva falso.
    const tituloBloque = (cfg: VariableMapa) => (hayPeriodo && cfg.clave === 'lluviaDiaMm')
        ? cfg.titulo.replace(/\s*\(día\)\s*$/, opciones.precipitacionEsRealDeConsola ? ' (acumulado real de consola)' : ' (acumulado del periodo)')
        : cfg.titulo;

    const bloques = variablesActivas.map((cfg, i) => {
        const valores = valoresPorModuloTodas.get(cfg.clave)!;
        const svg = mapaVariableSVG(cfg, activas, valores, corteCorto, logosModulo, fondoHillshade, tituloBloque(cfg), modoTecnico);
        const filas = numsModuloOrdenados.map(num => {
            const v = valores.get(num);
            const valorTxt = v?.valor != null ? `${cfg.fmt(v.valor)} ${cfg.unidad}` : 'S/D';
            const logoUri = logosModulo.get(num);
            const logoImgTd = logoUri
                ? `<img src="${logoUri}" alt="" width="22" height="22" style="border-radius:999px;object-fit:cover;border:1px solid ${VIZ.grid};vertical-align:middle;margin-right:7px">`
                : '';
            // Modo simple: 2 columnas (Módulo | Valor), con el mismo par
            // visual sólido/tramado del mapa junto al valor — nunca solo en
            // el mapa y no en la tabla, para no dejar una textura sin
            // explicación en ningún lado (riesgo señalado en el diseño:
            // discontinuidad mapa↔tabla). Procedencia/distancia detallada
            // (km, "IDW") queda solo en modo técnico.
            if (!modoTecnico) {
                const punto = v?.medido
                    ? `<span class="geoinf-punto geoinf-punto--medido" title="Medido"></span>`
                    : `<span class="geoinf-punto geoinf-punto--interp" title="Estimado"></span>`;
                return `<tr>
                    <td>${logoImgTd}<b>Módulo ${num}</b></td>
                    <td>${punto}${valorTxt}</td>
                </tr>`;
            }
            const badge = v?.medido
                ? `<span class="geoinf-badge geoinf-badge--medido">MEDIDO</span>`
                : `<span class="geoinf-badge geoinf-badge--interp">INTERPOLADO</span>`;
            const detalle = v?.medido
                ? `Estación propia: ${esc(v.fuente)}`
                : `${esc(v?.fuente ?? '')}${v?.distanciaKm != null ? ` (${v.distanciaKm.toFixed(1)} km)` : ''}`;
            return `<tr>
                <td>${logoImgTd}<b>Módulo ${num}</b></td>
                <td>${valorTxt}</td>
                <td>${badge}</td>
                <td class="geoinf-detalle">${detalle}</td>
            </tr>`;
        }).join('');

        // Sin periodo elegido, el mapa es siempre el corte actual
        // (precipitación = lluvia del día); con periodo, el mapa y la tabla
        // de arriba ya son el AGREGADO GLOBAL del rango (ver etiquetaPeriodo)
        // — el bloque de abajo añade el desglose MES A MES dentro de ese
        // mismo rango, para que ambos niveles (global y mensual) queden uno
        // junto al otro. h3 (no h2): estas son subsecciones dentro de
        // "Detalle por variable" — el h2 de nivel de documento ya lo puso el
        // encabezado de grupo, ver más abajo en el ensamblado del HTML.
        // Modo simple: se omite — es la misma información que ya muestra la
        // gráfica de evolución mensual de abajo, solo en forma de tabla; con
        // un rango corto (ej. "Hoy") genera una tabla de una sola fila sin
        // sentido, y con un rango largo duplica la gráfica sin aportar nada
        // para quien no necesita el número exacto por mes.
        const tablaMensualPeriodo = (() => {
            if (!modoTecnico || !periodoDesde || !periodoHasta || !mesesSerie.length || !opciones.serieMensual?.length) return '';
            const campo = CAMPO_SERIE[cfg.clave];
            const esAcumulado = cfg.clave === 'lluviaDiaMm';
            const filasMes = mesesSerie.map(m => {
                const valoresDelMes = opciones.serieMensual!
                    .filter(p => p.anio === m.anio && p.mes === m.mes)
                    .map(p => p[campo]).filter((v): v is number => v != null);
                // Global de red de ese mes: acumulado se SUMA entre estaciones
                // (mismo criterio que un volumen de lluvia real); promedio se
                // promedia — nunca se mezclan ambos criterios entre variables.
                const valorRed = valoresDelMes.length
                    ? (esAcumulado
                        ? valoresDelMes.reduce((a, b) => a + b, 0)
                        : valoresDelMes.reduce((a, b) => a + b, 0) / valoresDelMes.length)
                    : null;
                const etiquetaMes = `${esc(nombreMes(m.mes))} ${m.anio}${m.parcial ? ' *' : ''}`;
                return `<tr><td>${etiquetaMes}</td><td>${valorRed != null ? `${cfg.fmt(valorRed)} ${esc(cfg.unidad)}` : 'S/D'}</td></tr>`;
            }).join('');
            return `<div class="geoinf-nota" style="margin-top:14px">
                <b style="display:block;margin-bottom:8px;color:${SRL_MARRON};font-size:0.8rem">Promedio mensual dentro del periodo — ${esc(cfg.titulo)}</b>
                <table>
                    <thead><tr><th>Mes</th><th>${esAcumulado ? 'Acumulado de red' : 'Promedio de red'}</th></tr></thead>
                    <tbody>${filasMes}</tbody>
                </table>
                <p style="font-size:0.65rem;color:#94a3b8;margin:8px 0 0">
                    ${esAcumulado ? 'Suma' : 'Promedio'} de todas las estaciones activas de ese mes, dentro del periodo elegido (${esc(etiquetaPeriodo)}). El valor global del periodo completo se muestra arriba, en el mapa y la tabla por módulo.
                </p>
            </div>`;
        })();
        return `<section class="geoinf-bloque">
            <h3>${esc(tituloBloque(cfg))} (${cfg.unidad})</h3>
            <figure class="fig">
                <figcaption>
                    <b>${esc(tituloBloque(cfg))} por módulo — ${esc(etiquetaPeriodo)}</b>
                    <span>${modoTecnico ? NOTA_LECTURA[cfg.clave] : NOTA_LECTURA_SIMPLE[cfg.clave]}</span>
                </figcaption>
                <div class="geoinf-mapa">${svg}</div>
            </figure>
            ${i === 0 ? notaFueraDeMapa : ''}
            <table>
                <thead><tr>${modoTecnico ? '<th>Módulo</th><th>Valor</th><th>Procedencia</th><th>Detalle</th>' : '<th>Módulo</th><th>Valor</th>'}</tr></thead>
                <tbody>${filas}</tbody>
            </table>
            ${cfg.clave === 'lluviaDiaMm' ? (modoTecnico ? `<div class="geoinf-nota" style="margin-top:14px">
                <b style="display:block;margin-bottom:8px;color:${SRL_MARRON};font-size:0.8rem">Precipitación por estación</b>
                ${tablaPrecipitacion(activas, periodoDesde && periodoHasta ? {
                    diasTranscurridos: diasTranscurridosPeriodo,
                    diaMaxLluviaPorId: opciones.diaMaxLluviaPorId ?? new Map(),
                    formateaFechaCorta,
                    esRealDeConsola: opciones.precipitacionEsRealDeConsola,
                } : undefined)}
                <p style="font-size:0.65rem;color:#94a3b8;margin:8px 0 0">${esc(
                    opciones.precipitacionEsRealDeConsola ? NOTA_TABLA_PRECIPITACION_CONSOLA
                        : (periodoDesde && periodoHasta) ? NOTA_TABLA_PRECIPITACION_PERIODO
                        : NOTA_TABLA_PRECIPITACION,
                )}</p>
            </div>` : bloquePrecipitacionSimple(activas)) : ''}
            ${tablaMensualPeriodo}
            ${(() => {
                const svgEvolucion = graficaEvolucion(cfg);
                if (!svgEvolucion) return '';
                const mesParcial = mesesSerie.find(m => m.parcial);
                // Nota del asterisco SOLO si el mes parcial realmente entró en
                // esta gráfica (mesesSerie es el mismo para las 4 variables,
                // así que basta con buscarlo una vez) — evita una nota huérfana
                // si en algún momento se filtran los meses por variable.
                const notaParcial = mesParcial
                    ? ` <b>*${esc(nombreMes(mesParcial.mes))} ${mesParcial.anio}</b> es el primer mes con datos de la red — no cubre el mes calendario completo (la red de estaciones se dio de alta a mitad de mes), por eso el valor mostrado cubre solo los días con estación activa, no los 30/31 días.`
                    : '';
                return `<figure class="fig">
                    <figcaption>
                        <b>Evolución mensual — ${esc(cfg.titulo)}</b>
                        <span>${cfg.clave === 'lluviaDiaMm' ? 'Acumulado' : 'Promedio'} por estación, mes a mes. Un hueco en la línea indica un mes sin lectura suficiente, nunca se interpola entre meses.${notaParcial}</span>
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
            <td>${esc(e.rol === 'presa' ? 'Presa' : e.rol === 'modulo' ? 'Módulo' : e.rol === 'unidad_riego' ? 'Unidad de Riego' : e.rol)}</td>
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

  /* Resumen ejecutivo: pensado para leerse completo en ~30 segundos — un
     veredicto de una línea en tamaño grande, seguido de las observaciones
     que lo sustentan. El resto del documento (detalle por variable, tablas,
     metodología) es profundización progresiva para quien sigue leyendo. */
  .veredicto {
    border: 1px solid ${VIZ.grid}; border-left: 4px solid ${SRL_MARRON};
    border-radius: 12px; padding: 17px 20px; margin: 0 0 18px;
    background: ${VIZ.plane};
  }
  .veredicto-eyebrow { font-size: 0.6rem; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; color: ${VIZ.inkMuted}; }
  .veredicto-titular { font-size: 1.18rem; font-weight: 800; color: ${VIZ.inkPrimary}; margin: 5px 0 0; line-height: 1.35; letter-spacing: -0.01em; }
  .veredicto p { font-size: 0.86rem; margin: 8px 0 0; color: ${VIZ.inkSecondary}; max-width: 82ch; line-height: 1.55; }
  .veredicto-nota-historico { font-size: 0.7rem; color: ${VIZ.inkMuted}; margin: 10px 0 0; padding-top: 10px; border-top: 1px dashed ${VIZ.grid}; line-height: 1.5; max-width: 82ch; }

  /* Observaciones operativas: derivadas matemáticamente de los datos del
     propio corte (ver alertas en buildHTML) — nunca decorativas. Dos
     niveles: "atencion" (dato vencido/sospechoso — puede no ser confiable)
     en tono más fuerte, "aviso" (dispersión entre módulos, viento alto,
     cobertura baja) en tono neutro informativo. */
  .alertas { margin: 0 0 24px; display: flex; flex-direction: column; gap: 7px; }
  .alerta { display: flex; align-items: flex-start; gap: 9px; font-size: 0.79rem; line-height: 1.5;
            padding: 9px 13px; border-radius: 9px; border: 1px solid transparent; }
  .alerta-icono { flex: none; font-size: 0.85rem; line-height: 1.4; }
  .alerta--aviso { background: #fffbeb; border-color: #fde8b8; color: #7c5a0b; }
  .alerta--atencion { background: #fef2f2; border-color: #fbd0d0; color: #9f1d1d; }
  .alertas-ok { font-size: 0.79rem; color: ${VIZ.estado.bueno}; background: #f0fdf4; border: 1px solid #d3f0dc;
                border-radius: 9px; padding: 9px 13px; margin: 0 0 24px; display: flex; align-items: center; gap: 9px; }

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
  /* h3: subsección DENTRO de "Detalle por variable" (un peso por debajo de
     h2) — antes cada bloque de variable usaba h2, con el mismo peso visual
     que "Estaciones de la red" o "Metodología", sin distinguir panorama de
     detalle progresivo. */
  h3 {
    color: ${VIZ.inkSecondary}; font-size: 0.92rem; font-weight: 800;
    padding: 0; margin: 26px 0 10px; border: 0;
  }
  .geoinf-grupo-titulo { margin: 6px 0 2px; }
  .geoinf-grupo-sub { font-size: 0.74rem; color: ${VIZ.inkMuted}; margin: -6px 0 14px; line-height: 1.5; max-width: 82ch; }
  .geoinf-bloque { margin-bottom: 8px; }
  .geoinf-bloque + .geoinf-bloque { margin-top: 18px; padding-top: 4px; border-top: 1px solid ${VIZ.grid}; }
  .geoinf-mapa { margin-bottom: 6px; }
  .geoinf-pienota { font-size: 0.74rem; color: ${VIZ.inkMuted}; font-style: italic; margin: 6px 0 10px; }

  /* Tabla consolidada: panorama de las 4 variables × 6 módulos en una fila
     por módulo, antes del detalle por variable — mismo lenguaje visual
     (cabecera marrón, filas pares) que el resto de tablas del informe, con
     un punto de color en vez del badge de texto completo (aquí hay hasta 4
     por fila; el badge de texto se reserva para las tablas de detalle donde
     hay una sola variable por fila y cabe sin apretar). */
  .geoinf-consolidada th, .geoinf-consolidada td { text-align: right; }
  .geoinf-consolidada th:first-child, .geoinf-consolidada td:first-child { text-align: left; }
  .geoinf-consolidada small { font-weight: 500; text-transform: none; letter-spacing: 0; opacity: 0.8; }
  .geoinf-consolidada-n { font-weight: 700; white-space: nowrap; }
  .geoinf-punto { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .geoinf-punto--medido { background: #16a34a; }
  .geoinf-punto--interp { background: #d97706; }
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

  /* Modo simple: la trazabilidad técnica completa (tabla de estaciones,
     metodología) no se elimina, se archiva colapsada — cerrada por defecto,
     un clic la expone para quien la necesite (auditoría, ingeniería). */
  .geoinf-detalle-tecnico { margin-top: 24px; border: 1px solid ${VIZ.grid}; border-radius: 10px; padding: 4px 16px; background: #f8fafc; }
  .geoinf-detalle-tecnico summary { cursor: pointer; padding: 12px 0; font-weight: 700; font-size: 0.85rem; color: ${VIZ.inkSecondary}; }
  .geoinf-detalle-tecnico[open] summary { border-bottom: 1px solid ${VIZ.grid}; margin-bottom: 12px; }
  .geoinf-detalle-tecnico h2 { font-size: 1rem; }

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
    .kpi, table, .veredicto, .alerta, .geoinf-bloque, .franja, .fig { break-inside: avoid; }
    .geoinf-bloque + .geoinf-bloque { break-before: page; border-top: 0; padding-top: 0; margin-top: 0; }
    h2, h3 { break-after: avoid; }
    header { break-after: avoid; }
    /* El grupo "Panorama por módulo" (título + tabla consolidada) se trata
       como una sola unidad: sin esto, el título podía quedar al pie de una
       página y la tabla saltar sola a la siguiente, dejando ambas páginas
       con un hueco grande sin motivo (visto en la primera exportación a PDF
       de este rediseño). Si el grupo completo no cabe en lo que resta de la
       página, se empuja entero a la siguiente. */
    .geoinf-grupo-panorama { break-inside: avoid; }
    th, .geoinf-badge, .alerta, .alertas-ok, .geoinf-punto, .veredicto { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
  /* Contenedor de scroll horizontal para tablas anchas (la consolidada suma
     una columna por variable, hasta 5 en total) — en vez de comprimir el
     texto hasta ilegible en pantallas angostas, la tabla se desplaza dentro
     de su propio marco y el resto del documento nunca se ensancha con ella
     (ver regla del skill de artifacts: overflow-x contenido, nunca en body). */
  .geoinf-tabla-scroll { overflow-x: auto; margin: 10px 0; }
  .geoinf-tabla-scroll table { margin: 0; min-width: 480px; }

  @media (max-width: 720px) {
    body { padding: 14px; }
    .kpis { grid-template-columns: repeat(2, 1fr); }
    header { flex-wrap: wrap; }
    table { font-size: 0.72rem; }
    .veredicto-titular { font-size: 1.02rem; }
  }
</style>
</head><body><div class="wrap">
  <header>
    <div class="logos">${logoImg(logoSICA, 'SICA-005')}</div>
    <div class="titulo">
      <div class="sub">S R L Unidad Conchos · Delicias, Chihuahua</div>
      <h1>Informe Geoclimático por Módulo</h1>
      <div class="meta">Distrito de Riego 005${modoTecnico ? ' · Red WeatherLink (Davis) + interpolación IDW' : ''} · ${periodoDesde && periodoHasta ? `Periodo: ${esc(etiquetaPeriodo)} · Generado: ${hoy}` : `Corte: ${hoy}`}</div>
    </div>
    <div class="logos">${logoImg(logoSRL, 'SRL Unidad Conchos')}</div>
  </header>

  ${modoTecnico ? `<div class="franja">
    <b class="geoinf-badge geoinf-badge--medido">MEDIDO</b> estación propia (Módulo 1, 3, 5)
    <b class="geoinf-badge geoinf-badge--interp">INTERPOLADO</b> IDW p=2 entre estaciones activas (Módulo 2, 4, 12)
    <em>Metodología completa al pie del informe</em>
  </div>` : `<div class="franja">
    <b class="geoinf-badge geoinf-badge--medido">MEDIDO</b> con estación propia
    <b class="geoinf-badge geoinf-badge--interp">ESTIMADO</b> calculado a partir de estaciones cercanas
  </div>`}

  <div class="veredicto">
    <div class="veredicto-eyebrow">${periodoDesde && periodoHasta ? `Lectura del periodo — ${esc(etiquetaPeriodo)}` : 'Lectura del corte'}</div>
    <p class="veredicto-titular">${esc(titular)}</p>
    <p>${veredicto}</p>
    ${modoTecnico ? `<p class="veredicto-nota-historico">${notaSinHistorico}</p>` : ''}
  </div>

  ${alertasSVG}

  <div class="kpis">${kpisSVG}</div>

  ${tablaConsolidadaSVG ? `<div class="geoinf-grupo-panorama">
  <h2 class="geoinf-grupo-titulo">Panorama por módulo</h2>
  <p class="geoinf-grupo-sub">Las ${variablesActivas.length} variables de este informe, una fila por módulo, para el panorama completo de un vistazo. El detalle — mapa, procedencia y evolución mensual de cada variable — sigue abajo.</p>
  ${tablaConsolidadaSVG}
  </div>` : ''}

  <h2 class="geoinf-grupo-titulo">Detalle por variable</h2>
  <p class="geoinf-grupo-sub">Mapa de ${esc(etiquetaPeriodo)}, tabla por módulo con procedencia del dato y evolución mensual — una sección por variable.</p>
  ${bloques}

  ${modoTecnico ? `<h2>Estaciones de la red (fuente de los mapas anteriores)</h2>
  <div class="geoinf-tabla-scroll"><table>
    <thead><tr><th>Estación</th><th>Rol</th><th>Temp.</th><th>Viento</th><th>Radiación</th><th>Precipitación${hayPeriodo ? ' (periodo)' : ''}</th><th>${hayPeriodo ? 'Cobertura' : 'Frescura'}</th></tr></thead>
    <tbody>${filasEstaciones}</tbody>
  </table></div>

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
    Las observaciones operativas de ${hayPeriodo ? `este periodo (${esc(etiquetaPeriodo)})` : 'la lectura del corte'} se calculan sobre los datos de este
    mismo informe — ${hayPeriodo
        ? 'cobertura de muestras de cada estación dentro del rango,'
        : 'antigüedad de la lectura,'} dispersión de un módulo frente al promedio de la
    red (con el mismo rango dinámico que colorea cada mapa) y viento por encima del umbral
    orientativo de deriva de gota en aspersión (3.5 m/s) — y no incorporan ningún promedio
    histórico ni pronóstico.
  </div>` : `<details class="geoinf-detalle-tecnico">
    <summary>Cómo se calculan estos datos (para uso técnico)</summary>
    <h2>Estaciones de la red (fuente de los mapas anteriores)</h2>
    <div class="geoinf-tabla-scroll"><table>
      <thead><tr><th>Estación</th><th>Rol</th><th>Temp.</th><th>Viento</th><th>Radiación</th><th>Precipitación${hayPeriodo ? ' (periodo)' : ''}</th><th>${hayPeriodo ? 'Cobertura' : 'Frescura'}</th></tr></thead>
      <tbody>${filasEstaciones}</tbody>
    </table></div>
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
  </details>`}

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
 *  autónomo. `opciones` (variables a incluir + periodo + serie histórica
 *  opcional) viene del modal de selección en Clima.tsx; se omite para
 *  mantener el comportamiento previo (las 4 variables, sin periodo ni
 *  evolución) en cualquier otro llamador. `estaciones` decide el nivel del
 *  mapa: corte actual si viene tal cual de useClimaEstaciones, o el agregado
 *  de un periodo si viene de estacionesDesdeResumenRango. */
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
