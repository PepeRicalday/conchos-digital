// Genera y descarga un INFORME TÉCNICO DE CLIMA (HTML autónomo) desde las
// estaciones WeatherLink: lecturas actuales, mapa georreferenciado con el trazo
// del Canal Conchos de fondo, análisis técnico interpretativo (demanda hídrica,
// balance, riesgo agronómico) y logos institucionales embebidos.
import type { EstacionConLectura, LecturaClima } from '../hooks/useClimaEstaciones';
import {
    describePrecipitacion, formateaEdad, clasificaCielo, PROCEDENCIA_LABEL,
    type DiagnosticoCielo,
} from './cielo';
import {
    VIZ, medidorNubosidad, graficaNubosidad24h, graficaPrecipitacion24h,
    graficaTemperatura24h, graficaEtoEstaciones, franjaCalidad,
    medidorIndice, barraNivel,
    type PuntoSerie,
} from './climaCharts';
import { guardaOComparte } from './descargaArchivo';
import { calculaIndices, entradasDesdeEstaciones } from './indicesAgro';
import type { FondoSatelital } from './mapaSatelital';
import { getTodayString } from './dateHelpers';

const SRL_MARRON = '#6B2D2D';
const AZUL = '#1e5b8f';

// Versión del algoritmo de diagnóstico: se imprime en el informe para poder
// reproducir cualquier corte emitido (§10, "versión del algoritmo").
// v2.0 = separación cielo/lluvia, QA/QC y nubosidad multifuente.
// v2.1 = tablero ejecutivo con índices ICA-005/IDR/IRO/IHE y lámina por cultivo.
const ALGORITMO_VERSION = 'SICA-AGC v2.1 (cielo/lluvia separados · QA-QC · índices agroclimáticos)';

const fmt = (v: number | null | undefined, d = 1, u = '') =>
    v == null ? '—' : `${v.toFixed(d)}${u ? ' ' + u : ''}`;

// Trazo simplificado del Canal Principal Conchos (K0→K104) para el mapa de fondo.
// [lon, lat] cada ~1 km; de public/geo/canal_conchos.geojson (submuestreado).
const CANAL: [number, number][] = [[-105.2099,27.668],[-105.2089,27.6712],[-105.2046,27.6749],[-105.2018,27.6848],[-105.2004,27.6902],[-105.1987,27.7],[-105.1985,27.7045],[-105.1971,27.7133],[-105.1951,27.7221],[-105.1936,27.7308],[-105.1904,27.7402],[-105.1877,27.7439],[-105.1842,27.7495],[-105.1847,27.7556],[-105.1848,27.7636],[-105.1868,27.7714],[-105.1854,27.7821],[-105.1848,27.7978],[-105.1888,27.8029],[-105.1876,27.8124],[-105.1885,27.8203],[-105.1955,27.8335],[-105.1981,27.8435],[-105.2004,27.8499],[-105.2017,27.854],[-105.2085,27.8578],[-105.2069,27.8668],[-105.2071,27.8725],[-105.2055,27.8832],[-105.2096,27.8869],[-105.207,27.8942],[-105.2218,27.904],[-105.2265,27.914],[-105.2296,27.9256],[-105.2412,27.9307],[-105.2363,27.9416],[-105.239,27.9502],[-105.249,27.954],[-105.2651,27.9516],[-105.2853,27.9699],[-105.2905,27.9779],[-105.2992,27.9899],[-105.3033,27.99],[-105.3138,27.9894],[-105.3131,27.9956],[-105.3163,28.0087],[-105.3249,28.0128],[-105.3239,28.0184],[-105.3281,28.0252],[-105.34,28.0299],[-105.339,28.0369],[-105.3399,28.0436],[-105.345,28.0448],[-105.3558,28.0548],[-105.3593,28.0595],[-105.3617,28.0681],[-105.3686,28.0653],[-105.3736,28.0698],[-105.3813,28.0678],[-105.3854,28.074],[-105.3934,28.0808],[-105.3939,28.0918],[-105.3989,28.0957],[-105.3967,28.1001],[-105.4004,28.1047],[-105.3995,28.1126],[-105.3952,28.1266],[-105.3999,28.1331],[-105.4098,28.1316],[-105.4232,28.13],[-105.4311,28.1306],[-105.4382,28.1291],[-105.4449,28.1312],[-105.4524,28.1303],[-105.4603,28.1276],[-105.4676,28.1243],[-105.4697,28.1164],[-105.4795,28.1066],[-105.4806,28.1001],[-105.4802,28.0952],[-105.4826,28.083],[-105.4874,28.0767],[-105.4985,28.0744],[-105.5056,28.0758],[-105.515,28.0861],[-105.5224,28.0911],[-105.5317,28.0959],[-105.5354,28.0952],[-105.5389,28.0994],[-105.5443,28.107],[-105.5503,28.1118],[-105.5558,28.1127],[-105.5608,28.117],[-105.5746,28.1251],[-105.5791,28.1289],[-105.5849,28.1327],[-105.5936,28.1374],[-105.5992,28.1423],[-105.6042,28.1455],[-105.609,28.1495],[-105.6124,28.1544],[-105.6148,28.157],[-105.6177,28.1581]];

// Presas del distrito (contexto del mapa).
const PRESAS: { nombre: string; lat: number; lon: number }[] = [
    { nombre: 'P. Boquilla', lat: 27.5517, lon: -105.4375 },
    { nombre: 'P. Fco. I. Madero', lat: 28.3364, lon: -105.5278 },
];

// Contornos de los 6 módulos de la SRL Conchos (anillo exterior simplificado,
// [lon,lat]). Extraídos de modulos.geojson con el mapeo REAL polígono→módulo SRL
// (ver utils/modulosSRL.ts). Clave = nº de Módulo SRL.
const MODULOS_SRL: Record<number, [number, number][]> = {
    1: [[-105.2868,28.0272],[-105.2777,27.9983],[-105.2338,27.9941],[-105.2215,27.9879],[-105.2215,27.9657],[-105.2143,27.9572],[-105.2067,27.949],[-105.2026,27.942],[-105.1939,27.9344],[-105.1874,27.9272],[-105.183,27.9206],[-105.1846,27.909],[-105.1898,27.8987],[-105.1811,27.8855],[-105.1873,27.8745],[-105.1912,27.8646],[-105.1839,27.8581],[-105.1791,27.8532],[-105.1848,27.8407],[-105.1779,27.8348],[-105.1705,27.8295],[-105.1692,27.8212],[-105.1736,27.8134],[-105.1774,27.806],[-105.1759,27.7973],[-105.1782,27.7861],[-105.1716,27.7782],[-105.1731,27.7683],[-105.1867,27.7755],[-105.1888,27.8031],[-105.195,27.8317],[-105.2022,27.8548],[-105.2029,27.879],[-105.2108,27.8975],[-105.2286,27.9184],[-105.2387,27.95],[-105.2863,27.9716],[-105.3127,27.9893],[-105.3145,28.0188],[-105.3024,28.023],[-105.2874,28.0264],[-105.2868,28.0272]],
    2: [[-105.3372,28.1189],[-105.3399,28.1147],[-105.3374,28.1082],[-105.3299,28.1066],[-105.3258,28.0997],[-105.3215,28.0938],[-105.3186,28.0882],[-105.3164,28.0845],[-105.3135,28.0806],[-105.3125,28.0769],[-105.311,28.0713],[-105.3085,28.0661],[-105.3061,28.0605],[-105.2979,28.0463],[-105.2966,28.0435],[-105.2943,28.0378],[-105.288,28.0282],[-105.2912,28.0249],[-105.2995,28.0235],[-105.3157,28.0186],[-105.3252,28.0134],[-105.3255,28.0231],[-105.3397,28.0359],[-105.3418,28.0446],[-105.3523,28.0546],[-105.3581,28.0615],[-105.3662,28.0667],[-105.3761,28.0701],[-105.3869,28.0802],[-105.3942,28.0856],[-105.3963,28.0989],[-105.4,28.1049],[-105.3993,28.1176],[-105.3977,28.1351],[-105.3963,28.1432],[-105.3903,28.1492],[-105.3635,28.1463],[-105.345,28.1473],[-105.3401,28.1464],[-105.3391,28.1409],[-105.3386,28.1324],[-105.3374,28.1217],[-105.3372,28.1189]],
    3: [[-105.3893,28.2185],[-105.3943,28.2354],[-105.4016,28.2521],[-105.3998,28.2573],[-105.3991,28.2627],[-105.3948,28.2737],[-105.3952,28.2836],[-105.3912,28.2859],[-105.3824,28.2773],[-105.3786,28.2693],[-105.3701,28.2652],[-105.3616,28.2549],[-105.3526,28.2522],[-105.3574,28.2486],[-105.3514,28.2463],[-105.3475,28.2341],[-105.349,28.2287],[-105.3464,28.228],[-105.344,28.2214],[-105.3457,28.2144],[-105.3414,28.2106],[-105.3365,28.2038],[-105.3348,28.1978],[-105.3325,28.1935],[-105.3352,28.1899],[-105.3383,28.1853],[-105.3374,28.1749],[-105.3418,28.1597],[-105.3524,28.1489],[-105.3739,28.1463],[-105.3936,28.1488],[-105.3924,28.1642],[-105.3835,28.1678],[-105.3924,28.1799],[-105.4003,28.1924],[-105.4082,28.193],[-105.4098,28.1977],[-105.4043,28.201],[-105.4009,28.1937],[-105.3838,28.2047],[-105.3809,28.2056],[-105.3827,28.219],[-105.3893,28.2185]],
    4: [[-105.396,28.2318],[-105.3903,28.2139],[-105.4073,28.2],[-105.4101,28.1974],[-105.4107,28.1916],[-105.3997,28.1913],[-105.3944,28.1581],[-105.4002,28.1453],[-105.3969,28.1364],[-105.409,28.1325],[-105.4243,28.1309],[-105.4374,28.1298],[-105.4453,28.1622],[-105.4503,28.1823],[-105.4794,28.2127],[-105.4983,28.2398],[-105.4827,28.26],[-105.4737,28.2559],[-105.455,28.2577],[-105.4518,28.2597],[-105.4511,28.2601],[-105.4479,28.2615],[-105.4483,28.2686],[-105.4449,28.2757],[-105.4409,28.2801],[-105.4392,28.284],[-105.4363,28.2888],[-105.4342,28.2919],[-105.4315,28.2957],[-105.4295,28.3003],[-105.4272,28.3032],[-105.4241,28.3082],[-105.4216,28.3112],[-105.4049,28.3128],[-105.4,28.3082],[-105.4027,28.296],[-105.4003,28.2841],[-105.3937,28.2774],[-105.4002,28.2608],[-105.3998,28.2553],[-105.4021,28.2491],[-105.396,28.2318]],
    5: [[-105.4381,28.1299],[-105.4544,28.131],[-105.4691,28.1234],[-105.4799,28.1075],[-105.4818,28.0897],[-105.4984,28.0747],[-105.5247,28.0928],[-105.5364,28.095],[-105.5469,28.1088],[-105.5558,28.113],[-105.5774,28.1267],[-105.5871,28.1346],[-105.604,28.1457],[-105.6122,28.1524],[-105.6143,28.1571],[-105.6184,28.1593],[-105.6087,28.159],[-105.5904,28.1599],[-105.5837,28.1639],[-105.5791,28.1663],[-105.576,28.1675],[-105.5729,28.169],[-105.5663,28.169],[-105.5609,28.1706],[-105.556,28.175],[-105.5508,28.1809],[-105.5451,28.1839],[-105.5434,28.1855],[-105.5396,28.1909],[-105.5354,28.1949],[-105.5314,28.1972],[-105.5257,28.2031],[-105.5245,28.209],[-105.5187,28.2144],[-105.5116,28.2222],[-105.5093,28.2322],[-105.503,28.2372],[-105.4826,28.2179],[-105.4684,28.2008],[-105.4496,28.1676],[-105.4379,28.1353],[-105.4381,28.1299]],
    12: [[-105.321,28.1879],[-105.3222,28.175],[-105.3272,28.162],[-105.3185,28.159],[-105.3181,28.1513],[-105.3225,28.1464],[-105.3208,28.1377],[-105.3255,28.1266],[-105.3181,28.1187],[-105.3155,28.1131],[-105.3145,28.1054],[-105.3106,28.097],[-105.2988,28.0845],[-105.2869,28.0754],[-105.2852,28.0616],[-105.2844,28.0513],[-105.2879,28.0409],[-105.2734,28.034],[-105.2582,28.021],[-105.2637,28.0114],[-105.2519,28.0035],[-105.2596,27.9884],[-105.2776,27.9991],[-105.2814,28.0131],[-105.2881,28.0287],[-105.2962,28.0429],[-105.3009,28.0516],[-105.3096,28.0679],[-105.3126,28.0778],[-105.3164,28.0847],[-105.3218,28.0947],[-105.3287,28.106],[-105.3388,28.1149],[-105.3371,28.1266],[-105.3398,28.1447],[-105.3391,28.1575],[-105.3358,28.1827],[-105.3353,28.1888],[-105.3265,28.1911],[-105.32,28.1962],[-105.3134,28.1959],[-105.3196,28.1881],[-105.321,28.1879]],
};
const COLOR_MODULO: Record<number, string> = { 1: '#3b82f6', 2: '#10b981', 3: '#f59e0b', 4: '#8b5cf6', 5: '#ef4444', 12: '#06b6d4' };

// Río Conchos (tramo sur, aguas abajo de la Boquilla) para el fondo geomorfológico.
const RIO: [number, number][] = [[-105.4141,27.5456],[-105.4029,27.5537],[-105.4051,27.5579],[-105.4099,27.5656],[-105.4148,27.5663],[-105.4219,27.5679],[-105.4269,27.5808],[-105.4293,27.5881],[-105.4281,27.5908],[-105.4207,27.5862],[-105.4126,27.5893],[-105.4023,27.5939],[-105.399,27.5831],[-105.3902,27.5748],[-105.3803,27.5763],[-105.3694,27.5769],[-105.3629,27.5805],[-105.36,27.584],[-105.3564,27.5858],[-105.3523,27.586],[-105.3465,27.59],[-105.3428,27.5941],[-105.3375,27.595],[-105.3317,27.5923],[-105.327,27.5964],[-105.321,27.5999],[-105.3142,27.6029],[-105.3067,27.604],[-105.3005,27.6061],[-105.2953,27.6085],[-105.2882,27.6104],[-105.2823,27.6159],[-105.2808,27.621],[-105.2766,27.6227],[-105.2728,27.6272],[-105.2688,27.631],[-105.264,27.6333],[-105.2578,27.6338],[-105.2544,27.6351],[-105.2504,27.6334],[-105.2443,27.6384],[-105.2392,27.6426],[-105.2363,27.6414],[-105.2315,27.6465],[-105.2294,27.6513],[-105.223,27.6537],[-105.2183,27.6536],[-105.2162,27.6586],[-105.2128,27.6626],[-105.2103,27.6675]];

// Coloca etiquetas evitando solapamiento: prueba varias posiciones (arriba,
// abajo, izq, der de un punto ancla) y elige la primera que no choque con las ya
// colocadas. Devuelve x,y del texto y su anchor. Simple pero efectivo para pocos rótulos.
interface Rotulo { x: number; y: number; w: number; h: number; }
// Coloca una etiqueta evitando (a) solaparse con las ya puestas y (b) salirse del
// área [bx0,bx1]×[by0,by1]. Prueba varias posiciones y elige la primera válida.
function colocaEtiqueta(
    ax: number, ay: number, ancho: number, colocados: Rotulo[],
    limites: { bx0: number; bx1: number; by0: number; by1: number },
): { x: number; y: number; anchor: string } {
    const alto = 12;
    // Distancias mayores que el radio del marcador de pronóstico (r≈12 + anillo),
    // para que el rótulo nunca quede encima del icono de cielo.
    const cand = [
        { dx: 19, dy: 4, anchor: 'start' }, { dx: -19, dy: 4, anchor: 'end' },
        { dx: 0, dy: -21, anchor: 'middle' }, { dx: 0, dy: 26, anchor: 'middle' },
        { dx: 19, dy: -14, anchor: 'start' }, { dx: -19, dy: -14, anchor: 'end' },
        { dx: 19, dy: 20, anchor: 'start' }, { dx: -19, dy: 20, anchor: 'end' },
    ];
    let fallback: { x: number; y: number; anchor: string } | null = null;
    for (const c of cand) {
        const cx = ax + c.dx, cy = ay + c.dy;
        const x0 = c.anchor === 'middle' ? cx - ancho / 2 : c.anchor === 'end' ? cx - ancho : cx;
        const dentro = x0 >= limites.bx0 && x0 + ancho <= limites.bx1 && cy - alto >= limites.by0 && cy + 4 <= limites.by1;
        if (!dentro) continue;                                   // descarta si se sale del lienzo
        const box = { x: x0, y: cy - alto, w: ancho, h: alto + 4 };
        const choca = colocados.some(r => box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y);
        if (!choca) { colocados.push(box); return { x: cx, y: cy, anchor: c.anchor }; }
        if (!fallback) fallback = { x: cx, y: cy, anchor: c.anchor }; // 1ª que cabe aunque choque
    }
    if (fallback) return fallback;
    return { x: ax, y: ay - 16, anchor: 'middle' };
}

// Carga un asset público y lo devuelve como data URI base64 (para el HTML offline).
export async function assetToDataURI(path: string): Promise<string> {
    try {
        const res = await fetch(path);
        if (!res.ok) return '';
        const blob = await res.blob();
        return await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : '');
            r.readAsDataURL(blob);
        });
    } catch { return ''; }
}

// ── Mapa georreferenciado con el Canal Conchos de fondo (proyección lat/lon
//    con corrección de aspecto por latitud), presas y estaciones ─────────────
// Si se pasan `preds`, el mapa se vuelve de PRONÓSTICO: cada estación lleva el
// ícono/color de su predicción a 24 h (capa de estado sobre el plano).
/**
 * Extensión geográfica que abarcará el plano (canal + presas + estaciones +
 * módulos, con 8 % de margen). Se exporta para que quien construya el fondo
 * satelital pida EXACTAMENTE la misma ventana que dibuja `mapaSVG`; si cada uno
 * calculara la suya por su cuenta, la imagen quedaría descuadrada del trazo.
 */
export function extensionMapa(ests: EstacionConLectura[]): {
    minLat: number; maxLat: number; minLon: number; maxLon: number;
} | null {
    const pts = ests.filter(e => e.latitud && e.longitud);
    if (!pts.length) return null;
    const modPts = Object.values(MODULOS_SRL).flat();
    const allLat = [...CANAL.map(p => p[1]), ...PRESAS.map(p => p.lat), ...pts.map(e => e.latitud), ...modPts.map(p => p[1])];
    const allLon = [...CANAL.map(p => p[0]), ...PRESAS.map(p => p.lon), ...pts.map(e => e.longitud), ...modPts.map(p => p[0])];
    let minLa = Math.min(...allLat), maxLa = Math.max(...allLat);
    let minLo = Math.min(...allLon), maxLo = Math.max(...allLon);
    const mLa = (maxLa - minLa) * 0.08, mLo = (maxLo - minLo) * 0.08;
    return {
        minLat: minLa - mLa, maxLat: maxLa + mLa,
        minLon: minLo - mLo, maxLon: maxLo + mLo,
    };
}

export function mapaSVG(
    ests: EstacionConLectura[], preds?: Pred24[], fondo?: FondoSatelital | null,
): string {
    const pts = ests.filter(e => e.latitud && e.longitud);
    if (!pts.length) return '';
    const predDe = (nombre: string) => preds?.find(p => p.estacion === nombre);
    // Extensión que abarca canal + presas + estaciones + módulos SRL, con MARGEN
    // geográfico (8 %) para que nada quede pegado al borde.
    const modPts = Object.values(MODULOS_SRL).flat();
    const allLat = [...CANAL.map(p => p[1]), ...PRESAS.map(p => p.lat), ...pts.map(e => e.latitud), ...modPts.map(p => p[1])];
    const allLon = [...CANAL.map(p => p[0]), ...PRESAS.map(p => p.lon), ...pts.map(e => e.longitud), ...modPts.map(p => p[0])];
    let minLa = Math.min(...allLat), maxLa = Math.max(...allLat);
    let minLo = Math.min(...allLon), maxLo = Math.max(...allLon);
    const mLa = (maxLa - minLa) * 0.08, mLo = (maxLo - minLo) * 0.08;
    minLa -= mLa; maxLa += mLa; minLo -= mLo; maxLo += mLo;
    // Corrección de aspecto: 1° lon = cos(lat)·(1° lat) → mapa con proporción real.
    const latMed = (minLa + maxLa) / 2;
    const kx = Math.cos((latMed * Math.PI) / 180);
    const spanLo = (maxLo - minLo) * kx, spanLa = maxLa - minLa;
    const P = 34, W = 640;
    // Altura por proporción real, pero acotada para que el mapa no sea excesivamente largo.
    const H = Math.min(760, Math.round((W - 2 * P) * (spanLa / Math.max(1e-6, spanLo)) + 2 * P));
    const sx = (lo: number) => P + ((lo - minLo) * kx / Math.max(1e-6, spanLo)) * (W - 2 * P);
    const sy = (la: number) => H - P - ((la - minLa) / Math.max(1e-6, spanLa)) * (H - 2 * P);

    // Contornos de los 6 módulos SRL Conchos (relleno tenue + borde + etiqueta al centroide)
    const modulosSVG = Object.entries(MODULOS_SRL).map(([numStr, ring]) => {
        const num = Number(numStr);
        const col = COLOR_MODULO[num] ?? '#64748b';
        const d = ring.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ') + ' Z';
        let cx = 0, cy = 0; for (const p of ring) { cx += p[0]; cy += p[1]; } cx /= ring.length; cy /= ring.length;
        const lx = sx(cx), ly = sy(cy);
        // Sobre satélite el relleno se reduce: la imagen debe leerse a través
        // del módulo, que aquí solo delimita, no colorea.
        return `<path d="${d}" fill="${col}" fill-opacity="${fondo ? 0.11 : 0.20}" stroke="${col}" stroke-width="${fondo ? 2.2 : 2}" stroke-dasharray="5,3" stroke-linejoin="round"/>
                <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="11.5" fill="#fff" fill-opacity="0.95" stroke="${col}" stroke-width="2"/>
                <text x="${lx.toFixed(1)}" y="${(ly+4).toFixed(1)}" font-size="11" font-weight="800" text-anchor="middle" fill="${col}" font-family="system-ui">M${num}</text>`;
    }).join('');

    const canalPath = CANAL.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
    const rioPath = RIO.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');

    // Registro de cajas ocupadas (íconos/marcadores) para el anti-solapamiento de rótulos.
    const ocupados: Rotulo[] = [];
    // Área válida para etiquetas: dentro del lienzo, bajo la barra de título superior.
    const limites = { bx0: P + 2, bx1: W - P - 2, by0: P + 20, by1: H - P - 12 };
    // Reserva el área de cada etiqueta M# de módulo (ya colocada al centroide).
    for (const ring of Object.values(MODULOS_SRL)) {
        let cx = 0, cy = 0; for (const p of ring) { cx += p[0]; cy += p[1]; }
        ocupados.push({ x: sx(cx / ring.length) - 12, y: sy(cy / ring.length) - 12, w: 24, h: 24 });
    }

    // Sobre imagen satelital el rótulo va en blanco con halo oscuro; sobre el
    // fondo claro vectorial, al revés. Si no, uno de los dos casos queda ilegible.
    const tintaRotulo = fondo ? '#ffffff' : '#155e75';
    const haloRotulo = fondo ? '#0b1f38' : '#ffffff';
    const presasSVG = PRESAS.map(pr => {
        const x = sx(pr.lon), y = sy(pr.lat);
        ocupados.push({ x: x - 6, y: y - 10, w: 12, h: 12 });
        const lbl = colocaEtiqueta(x, y, pr.nombre.length * 5, ocupados, limites);
        return `<path d="M${(x-5).toFixed(0)},${y.toFixed(0)} L${x.toFixed(0)},${(y-8).toFixed(0)} L${(x+5).toFixed(0)},${y.toFixed(0)} Z" fill="#22d3ee" stroke="#fff" stroke-width="1.2"/>
                <text x="${lbl.x.toFixed(0)}" y="${lbl.y.toFixed(0)}" font-size="8.5" font-weight="600" text-anchor="${lbl.anchor}" fill="${tintaRotulo}" font-family="system-ui" paint-order="stroke" stroke="${haloRotulo}" stroke-width="2.5">${pr.nombre}</text>`;
    }).join('');

    // Estaciones: marcador + ícono; nombre y "máx N°" en UN rótulo compacto, anti-solape.
    const estSVG = pts.map(e => {
        const x = sx(e.longitud), y = sy(e.latitud);
        const pr = predDe(e.nombre);
        const col = pr ? pr.color : (e.enLinea ? '#0284c7' : '#94a3b8');
        // Reserva acorde al marcador real (r=12 + anillo) para que el rótulo no lo pise.
        const rMarca = pr ? 17 : 13;
        ocupados.push({ x: x - rMarca, y: y - rMarca, w: rMarca * 2, h: rMarca * 2 });
        // Con pronóstico: icono de cielo SOLO si hay fuente de nubosidad; si no,
        // un signo de interrogación — nunca un sol que insinúe cielo despejado.
        const marca = pr
            ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="#fff" fill-opacity="0.85" stroke="${col}" stroke-width="2"${pr.icono ? '' : ' stroke-dasharray="3,2"'}/>
               <text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" font-size="${pr.icono ? 12 : 11}" text-anchor="middle"${pr.icono ? '' : ` fill="${col}" font-weight="700" font-family="system-ui"`}>${pr.icono || '?'}</text>`
            : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" fill="${col}" stroke="#fff" stroke-width="2"/>
               <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="none" stroke="${col}" stroke-width="1" opacity="0.4"/>`;
        // Estaciones DENTRO de un módulo (Módulo 3/5) ya se identifican por el "M#"
        // del contorno: se evita repetir "Módulo N" y se rotula solo la temp.
        const enModulo = /m[oó]dulo/i.test(e.nombre);
        const txt = enModulo
            ? (pr?.tMaxEsp != null ? `máx ${pr.tMaxEsp}°` : '')
            : (pr?.tMaxEsp != null ? `${e.nombre} · máx ${pr.tMaxEsp}°` : e.nombre);
        const lbl = txt ? colocaEtiqueta(x, y, txt.length * 4.8, ocupados, limites) : null;
        const lblSVG = lbl
            ? `<text x="${lbl.x.toFixed(1)}" y="${lbl.y.toFixed(1)}" font-size="9" font-weight="700" text-anchor="${lbl.anchor}" fill="${fondo ? '#ffffff' : '#0c4a6e'}" font-family="system-ui" paint-order="stroke" stroke="${fondo ? '#0b1f38' : '#ffffff'}" stroke-width="3">${txt}</text>`
            : '';
        return `${marca}\n${lblSVG}`;
    }).join('');

    // Retícula de grados tenue (referencia de coordenadas)
    const grid: string[] = [];
    for (let la = Math.ceil(minLa * 10) / 10; la <= maxLa; la += 0.1) {
        const y = sy(la);
        grid.push(`<line x1="${P}" y1="${y.toFixed(0)}" x2="${W-P}" y2="${y.toFixed(0)}" stroke="${fondo ? '#fff' : '#000'}" stroke-opacity="${fondo ? 0.14 : 0.05}" stroke-width="0.6"/><text x="${P-3}" y="${(y+3).toFixed(0)}" font-size="7" text-anchor="end" fill="${fondo ? '#c3d3e2' : '#94a3b8'}">${la.toFixed(1)}°</text>`);
    }
    for (let lo = Math.ceil(minLo * 10) / 10; lo <= maxLo; lo += 0.1) {
        const x = sx(lo);
        grid.push(`<line x1="${x.toFixed(0)}" y1="${P}" x2="${x.toFixed(0)}" y2="${H-P}" stroke="${fondo ? '#fff' : '#000'}" stroke-opacity="${fondo ? 0.14 : 0.05}" stroke-width="0.6"/><text x="${x.toFixed(0)}" y="${(H-P+10).toFixed(0)}" font-size="7" text-anchor="middle" fill="${fondo ? '#c3d3e2' : '#94a3b8'}">${lo.toFixed(1)}°</text>`);
    }

    // ── Fondo GEOMORFOLÓGICO estilizado (SVG): terreno árido del semidesierto
    //    chihuahuense con el valle de riego más verde, hillshade sutil y ruido tenue.
    const bandas: string[] = [];
    const NB = 7;                                       // bandas horizontales de "relieve"
    for (let i = 0; i < NB; i++) {
        const y0 = P + (i / NB) * (H - 2 * P), h = (H - 2 * P) / NB;
        const t = i / (NB - 1);                          // 0 arriba → 1 abajo
        // tono tierra: más claro/verdoso en el centro (valle), más árido a los extremos
        const verde = 1 - Math.abs(t - 0.45) * 1.6;
        bandas.push(`<rect x="${P}" y="${y0.toFixed(1)}" width="${W-2*P}" height="${(h+1).toFixed(1)}" fill="url(#terr${i % 2})" opacity="${(0.5 + verde * 0.25).toFixed(2)}"/>`);
    }

    // ── Fondo satelital georreferenciado (si se pudo construir) ─────────────
    // La imagen viene en Web Mercator y el plano proyecta lineal en lat/lon. Se
    // coloca por sus bordes reales: sobre los ~0.9° de latitud del distrito la
    // diferencia entre ambas proyecciones es < 1 px, así que estirar la imagen
    // linealmente no descuadra el trazo del canal ni los contornos de módulo.
    // Se recorta al marco del mapa para que no invada los márgenes de rótulos.
    const fondoSVG = fondo ? (() => {
        const fx0 = sx(fondo.minLon), fx1 = sx(fondo.maxLon);
        const fy0 = sy(fondo.maxLat), fy1 = sy(fondo.minLat);
        return `<clipPath id="marco"><rect x="${P}" y="${P}" width="${W-2*P}" height="${H-2*P}" rx="3"/></clipPath>
                <g clip-path="url(#marco)">
                  <image href="${fondo.dataURI}" x="${fx0.toFixed(1)}" y="${fy0.toFixed(1)}"
                         width="${(fx1-fx0).toFixed(1)}" height="${(fy1-fy0).toFixed(1)}"
                         preserveAspectRatio="none"/>
                  <rect x="${P}" y="${P}" width="${W-2*P}" height="${H-2*P}" fill="#0b1f38" opacity="0.10"/>
                </g>`;
    })() : '';

    // Alto extra al pie cuando hay leyenda de iconos de cielo, para que no se recorte.
    const HL = preds ? 26 : 0;
    return `<svg viewBox="0 0 ${W} ${H + HL}" width="100%" style="background:${fondo ? '#0b1f38' : '#f4f8fb'};border:1px solid ${fondo ? '#1e3a5c' : '#cbd5e1'};border-radius:10px">
        <defs>
          <linearGradient id="terr0" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#e8e0cf"/><stop offset="0.5" stop-color="#dfe6cf"/><stop offset="1" stop-color="#e5dcc7"/>
          </linearGradient>
          <linearGradient id="terr1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#e2d9c4"/><stop offset="0.5" stop-color="#d7e2c6"/><stop offset="1" stop-color="#ded3bd"/>
          </linearGradient>
          <radialGradient id="valle" cx="45%" cy="42%" r="60%">
            <stop offset="0" stop-color="#cfe0b8" stop-opacity="0.55"/><stop offset="1" stop-color="#cfe0b8" stop-opacity="0"/>
          </radialGradient>
          <filter id="relieve"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="3" seed="7" result="n"/>
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0 0.42  0 0 0 0.5 0"/>
            <feComposite operator="in" in2="SourceGraphic"/></filter>
        </defs>
        ${fondo
            // Con imagen satelital, el terreno sintético sobra: sería una capa
            // decorativa tapando datos reales.
            ? fondoSVG
            : `<rect x="${P}" y="${P}" width="${W-2*P}" height="${H-2*P}" fill="#e6ddc9"/>
               ${bandas.join('')}
               <rect x="${P}" y="${P}" width="${W-2*P}" height="${H-2*P}" fill="url(#valle)"/>
               <rect x="${P}" y="${P}" width="${W-2*P}" height="${H-2*P}" filter="url(#relieve)" opacity="0.28"/>`}
        ${grid.join('')}
        <path d="${rioPath}" fill="none" stroke="#3b82f6" stroke-width="1.6" stroke-linejoin="round" opacity="${fondo ? 0.75 : 0.55}"/>
        ${modulosSVG}
        ${fondo
            // Sobre satélite el canal lleva contorno oscuro + núcleo cian: el
            // azul plano se confundía con el agua realzada de los vasos.
            ? `<path d="${canalPath}" fill="none" stroke="#0b1f38" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>
               <path d="${canalPath}" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
            : `<path d="${canalPath}" fill="none" stroke="#1d4ed8" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>
               <path d="${canalPath}" fill="none" stroke="#bfdbfe" stroke-width="0.8" stroke-dasharray="1,4"/>`}
        ${presasSVG}${estSVG}
        <rect x="${P}" y="${P}" width="${W-2*P}" height="17" fill="#0f172a" opacity="0.35"/>
        <text x="${P+5}" y="${P+12}" font-size="9" font-weight="600" fill="#fff" font-family="system-ui">${preds ? 'Nubosidad prevista 24 h — Módulos SRL Conchos · DR-005' : 'Módulos SRL Conchos (M1-M5, M12) · Valle del Conchos, DR-005'}</text>
        ${preds ? `<g transform="translate(${P+4},${H-P+22})">
          <rect x="-3" y="-11" width="${W-2*P+6}" height="17" rx="4" fill="#f1f5f9"/>
          <text x="2" y="1.5" font-size="7.6" fill="#475569" font-family="system-ui">☀️ despejado · 🌤️ mayorm. despejado · ⛅ parcial · 🌥️ mayorm. nublado · ☁️ cubierto · ? sin fuente de nubosidad</text>
        </g>` : ''}
        <g transform="translate(${W-98},${H-24})">
          <rect x="-6" y="-14" width="${(0.1*kx/spanLo*(W-2*P)+40).toFixed(0)}" height="22" rx="4" fill="#fff" opacity="0.75"/>
          <line x1="0" y1="0" x2="${(0.1*kx/spanLo*(W-2*P)).toFixed(0)}" y2="0" stroke="#334155" stroke-width="1.5"/>
          <text x="0" y="-4" font-size="7.5" fill="#475569" font-family="system-ui">~10 km</text>
        </g>
    </svg>`;
}

// ── Análisis técnico interpretativo desde los datos reales ──────────────────
interface Analisis { demanda: string; balance: string; termico: string; viento: string; nubosidad: string; recomendaciones: string[]; }

/**
 * @param etoProm   ETₒ observada: ACUMULADO del día hasta la hora del corte.
 * @param etoDiario ETₒ TOTAL del día (del modelo). Es la magnitud correcta para
 *                  dimensionar la lámina de riego; el acumulado parcial la
 *                  subestimaría en proporción a las horas de sol que faltan.
 */
function analisisTecnico(
    ests: EstacionConLectura[], etoProm: number | null, gddProm: number | null,
    lluviaTotal: number, etoDiario: number | null,
): Analisis {
    const enLinea = ests.filter(e => e.enLinea && e.lectura);
    const temps = enLinea.map(e => e.lectura!.temp_c).filter((v): v is number => v != null);
    const hums = enLinea.map(e => e.lectura!.hum_rel_pct).filter((v): v is number => v != null);
    const vientos = enLinea.map(e => e.lectura!.viento_ms).filter((v): v is number => v != null);
    const tMax = temps.length ? Math.max(...temps) : null;
    const hrMin = hums.length ? Math.min(...hums) : null;
    const vMax = vientos.length ? Math.max(...vientos) : null;

    // Lámina de riego: SIEMPRE sobre el ETₒ del DÍA COMPLETO. Usar el acumulado
    // parcial del corte subestimaría la lámina en proporción a las horas de sol
    // que aún faltan (a media mañana, hasta 4-5 veces menos).
    const ETO = etoDiario ?? etoProm ?? 0;
    const usaParcial = etoDiario == null && etoProm != null;
    const laminaNeta = ETO * 0.85;          // ETc nogal en brotación (Kc 0.85)
    const laminaBruta = laminaNeta / 0.70;  // corrige por eficiencia de riego

    const clasifETo = ETO < 3 ? 'baja' : ETO < 5 ? 'moderada' : ETO < 7 ? 'alta' : 'muy alta';

    const demanda = `La evapotranspiración de referencia del distrito para el <b>día completo</b> es ` +
        `<b>${ETO.toFixed(2)} mm/día</b> (demanda atmosférica <b>${clasifETo}</b>` +
        `${etoDiario != null ? ', según el modelo de pronóstico' : ''}). ` +
        `Para nogal en brotación (Kc 0.85) la demanda del cultivo (ETc) es <b>${laminaNeta.toFixed(2)} mm/día</b>; ` +
        `considerando una eficiencia de aplicación del 70 % en riego rodado, la <b>lámina bruta requerida ≈ ${laminaBruta.toFixed(2)} mm/día</b> ` +
        `(equivalente a <b>${(laminaBruta * 10).toFixed(0)} m³/ha·día</b>).` +
        (usaParcial
            ? ` <b>Advertencia:</b> sin total diario disponible se ha empleado el acumulado parcial del corte, ` +
              `por lo que esta lámina <b>subestima</b> la demanda real del día.`
            : '');

    const balance = lluviaTotal > 0
        ? `Se registró precipitación (<b>${lluviaTotal.toFixed(1)} mm</b> promedio de la red de estaciones), que aporta al balance hídrico y reduce la lámina neta a reponer en las parcelas bajo lluvia.`
        : `Sin precipitación <b>observada</b> en las estaciones: la reposición hídrica depende íntegramente del riego. `
          + `El déficit diario a cubrir equivale a la ETc del cultivo. `
          + `<b>La ausencia de lluvia no describe el estado del cielo</b>, que se trata por separado.`;

    // Nubosidad: variable propia, nunca deducida de la lluvia.
    const conCob = ests.map(e => e.cielo).filter(c => c.coberturaPct != null);
    const nubosidad = conCob.length === 0
        ? 'No determinada con las fuentes disponibles en este corte. Debe incorporarse mediante modelo de '
          + 'pronóstico, clasificación satelital o estimación radiométrica antes de emitir un estado del cielo.'
        : (() => {
            const media = conCob.reduce((a, c) => a + (c.coberturaPct ?? 0), 0) / conCob.length;
            const cl = clasificaCielo(media);
            const procs = [...new Set(conCob.map(c => PROCEDENCIA_LABEL[c.procedencia]))].join(', ');
            const disc = conCob.filter(c => c.discrepancias.length).length;
            return `Cobertura nubosa media del distrito <b>${media.toFixed(0)} %</b> (<b>${cl.etiqueta.toLowerCase()}</b>), `
                + `procedencia: ${procs.toLowerCase()}. `
                + (disc > 0
                    ? `Se detectaron discrepancias entre fuentes en ${disc} estación(es); ver el detalle en «Condición del cielo y nubosidad».`
                    : 'Las fuentes disponibles son coherentes entre sí.');
        })();

    const termico = tMax != null
        ? `Temperatura máxima observada <b>${tMax.toFixed(1)} °C</b>${hrMin != null ? ` con humedad relativa mínima ${hrMin.toFixed(0)} %` : ''}. ` +
          (tMax > 38 ? 'Condición de <b>estrés térmico severo</b>: adelantar riegos a primeras horas y evitar riego al mediodía.'
            : tMax > 34 ? 'Estrés térmico <b>moderado</b>: monitorear cultivos sensibles.'
            : 'Rango térmico dentro de parámetros normales para la operación.') +
          (gddProm != null ? ` Acumulación térmica de <b>${gddProm.toFixed(0)} °C-día</b> (base 10 °C) para seguimiento fenológico.` : '')
        : 'Sin lectura térmica disponible.';

    const viento = vMax != null
        ? `Viento máximo <b>${vMax.toFixed(1)} m/s</b>. ` +
          (vMax > 5 ? '<b>Precaución</b>: por encima del umbral recomendado para riego por aspersión (deriva y pérdida por evaporación).'
            : 'Dentro del rango operativo para todos los métodos de riego.')
        : 'Sin lectura de viento disponible.';

    const recomendaciones: string[] = [];
    if (ETO >= 5) recomendaciones.push(`Programar riego para reponer ~${laminaBruta.toFixed(1)} mm/día; priorizar turnos nocturnos o de madrugada para minimizar pérdidas por evaporación.`);
    else recomendaciones.push(`Demanda ${clasifETo}: intervalos de riego pueden ampliarse; ajustar según humedad del suelo y etapa del cultivo.`);
    if (vMax != null && vMax > 5) recomendaciones.push('Suspender o posponer riego por aspersión hasta que el viento baje de 5 m/s.');
    if (lluviaTotal > 10) recomendaciones.push('Evaluar cierre preventivo de tomas por precipitación significativa.');
    if (tMax != null && tMax > 38) recomendaciones.push('Vigilar estrés hídrico en frutales; considerar riego de auxilio.');
    recomendaciones.push('Contrastar la ETₒ de la red con la programación de entregas del distrito (balance oferta–demanda por módulo).');
    // Recomendación permanente del documento (§11.6): el icono no manda sobre la operación.
    recomendaciones.push('No modificar entregas por el icono meteorológico: decidir con ETₒ validada, humedad de suelo y demanda programada.');
    if (conCob.length === 0) {
        recomendaciones.push('Incorporar la capa de nubosidad (modelo o satélite) antes de emitir diagnósticos de cielo en el informe.');
    }

    return { demanda, balance, termico, viento, nubosidad, recomendaciones };
}

// ── Pronóstico a 24 h por estación ──────────────────────────────────────────
// CAMBIO DE FONDO respecto a la versión anterior: la condición del cielo ya no
// se deduce de la tendencia barométrica. Antes, una presión en ascenso producía
// "☀️ Estable / despejado" sin ninguna medición de nubosidad — exactamente el
// error que el módulo debe evitar. Ahora:
//   · La NUBOSIDAD viene del modelo de pronóstico (cobertura total y por capas)
//     o de la estimación radiométrica local; si no hay ninguna, queda NO
//     DETERMINADA y no se emite icono.
//   · La PROBABILIDAD DE LLUVIA es una escala independiente: el modelo la aporta
//     directamente y la tendencia barométrica solo se usa como respaldo cuando
//     no hay pronóstico disponible.
// "Sin lluvia prevista" y "cubierto" pueden coexistir, y el informe lo refleja.
export interface Pred24 {
    estacion: string; lat: number; lon: number; enLinea: boolean;
    /** Diagnóstico del cielo con procedencia y confianza; sin icono si no hay fuente. */
    cielo: DiagnosticoCielo;
    icono: string; color: string; etiqueta: string;
    tMaxEsp: number | null; tMinEsp: number | null; etoEsp: number | null;
    /** Probabilidad de precipitación (escala independiente de la nubosidad). */
    pLluvia: number | null;
    lluviaMm: number | null;
    /** Procedencia de la probabilidad de lluvia. */
    fuenteLluvia: 'modelo' | 'tendencia_local' | 'ninguna';
    nota: string;
    /** Aviso operativo de viento; ya no compite con el estado del cielo. */
    avisoViento: string | null;
}

/**
 * Probabilidad de lluvia de respaldo desde la tendencia barométrica.
 * Solo se usa cuando NO hay pronóstico de modelo. Se reporta siempre como
 * estimación local para no confundirla con una probabilidad de modelo.
 */
function pLluviaPorTendencia(l: LecturaClima): number {
    const trend = l.bar_trend_hpa;           // hPa/3h
    const hum = l.hum_rel_pct ?? 0;
    let p = 0;
    const subiendo = trend != null && trend > 0.3;
    if (trend != null) {
        if (trend <= -2) p += 55;
        else if (trend <= -1) p += 40;
        else if (trend <= -0.3) p += 20;
        else if (trend >= 1) p -= 15;          // ascenso marcado = muy estable
    }
    if (!subiendo) {                            // humedad solo si no hay ascenso
        if (hum >= 85) p += 20; else if (hum >= 75) p += 8;
    }
    if ((l.lluvia_24h_mm ?? 0) > 0.5) p += 15;  // ya llovió = sistema activo
    return Math.max(0, Math.min(90, p));
}

export function predice24h(e: EstacionConLectura): Pred24 {
    const l = e.lectura;
    const base = { estacion: e.nombre, lat: e.latitud, lon: e.longitud, enLinea: e.enLinea };

    if (!l) {
        return {
            ...base, cielo: e.cielo, icono: '', color: '#94a3b8',
            etiqueta: 'Estado no determinado', tMaxEsp: null, tMinEsp: null, etoEsp: null,
            pLluvia: null, lluviaMm: null, fuenteLluvia: 'ninguna',
            nota: 'Sin lectura reciente de la estación: no se emite diagnóstico.',
            avisoViento: null,
        };
    }

    // Ventana de 24 h del pronóstico horario, si está sincronizado.
    const serie24 = e.pronosticoSerie.filter(p => (p.horizonte_h ?? 0) <= 24);
    const tempsFc = serie24.map(p => p.temp_c).filter((v): v is number => v != null);
    const probsFc = serie24.map(p => p.precip_prob_pct).filter((v): v is number => v != null);
    const lluviaFc = serie24.map(p => p.precip_mm).filter((v): v is number => v != null);
    const etoFc = serie24.map(p => p.eto_fc_mm).filter((v): v is number => v != null);

    // Temperaturas: del modelo si hay serie; si no, amplitud diurna típica del
    // desierto chihuahuense (~14 °C) sobre la temperatura actual.
    const AMPL = 14;
    const tActual = l.temp_c;
    const tMaxEsp = tempsFc.length ? +Math.max(...tempsFc).toFixed(0)
        : tActual != null ? +(tActual + AMPL * 0.55).toFixed(0) : null;
    const tMinEsp = tempsFc.length ? +Math.min(...tempsFc).toFixed(0)
        : tActual != null ? +(tActual - AMPL * 0.45).toFixed(0) : null;
    const etoEsp = etoFc.length ? +etoFc.reduce((a, b) => a + b, 0).toFixed(2)
        : (l.eto_mm ?? l.et_dia_mm ?? null);

    // Probabilidad de lluvia: del modelo (máximo de la ventana) o, en su
    // ausencia, de la tendencia barométrica local marcada como tal.
    let pLluvia: number | null;
    let fuenteLluvia: Pred24['fuenteLluvia'];
    if (probsFc.length) { pLluvia = Math.round(Math.max(...probsFc)); fuenteLluvia = 'modelo'; }
    else { pLluvia = pLluviaPorTendencia(l); fuenteLluvia = 'tendencia_local'; }
    const lluviaMm = lluviaFc.length ? +lluviaFc.reduce((a, b) => a + b, 0).toFixed(1) : null;

    // El cielo llega ya fusionado desde el hook (modelo → radiación → nada).
    const cielo = e.cielo;

    // El viento es un AVISO operativo independiente: antes secuestraba el estado
    // del cielo ("Ventoso" desplazaba a la nubosidad), lo que mezclaba variables.
    const viento = l.viento_ms ?? 0;
    const avisoViento = viento > 6
        ? `Viento sostenido ${viento.toFixed(1)} m/s: posible deriva en aspersión.`
        : null;

    const notaLluvia = describePrecipitacion(pLluvia, lluviaMm)
        + (fuenteLluvia === 'tendencia_local'
            ? ' Estimada por tendencia barométrica local (sin pronóstico de modelo disponible).'
            : '');

    return {
        ...base, cielo, icono: cielo.icono, color: cielo.color, etiqueta: cielo.etiqueta,
        tMaxEsp, tMinEsp, etoEsp, pLluvia, lluviaMm, fuenteLluvia,
        nota: `${cielo.nota} ${notaLluvia}`, avisoViento,
    };
}

async function buildHTML(ests: EstacionConLectura[]): Promise<string> {
    const [logoSRL, logoSICA] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'),
        assetToDataURI('/logos/SICA005.png'),
    ]);

    const hoy = new Date().toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });
    const enLinea = ests.filter(e => e.enLinea);
    const etos = enLinea.map(e => e.lectura?.eto_mm).filter((v): v is number => v != null);
    const etoProm = etos.length ? etos.reduce((a, b) => a + b, 0) / etos.length : null;
    const gdds = ests.map(e => e.lectura?.gdd).filter((v): v is number => v != null);
    const gddProm = gdds.length ? gdds.reduce((a, b) => a + b, 0) / gdds.length : null;
    // PROMEDIO entre estaciones con lectura, no suma: sumar mm entre pluviómetros
    // distintos no tiene lectura hidrológica y crece con cada estación conectada.
    const conLecturaLluvia = ests.filter(e => e.lectura);
    const lluviaTotal = conLecturaLluvia.length
        ? conLecturaLluvia.reduce((a, e) => a + (e.lectura!.lluvia_dia_mm ?? 0), 0) / conLecturaLluvia.length
        : 0;
    // ETₒ TOTAL prevista para hoy (24 h del modelo). Es la magnitud con la que se
    // dimensiona la lámina de riego; `etoProm` es solo el acumulado hasta el corte.
    const etoFcHoy = (() => {
        const hoyLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });
        // Estación sin ninguna fila de pronóstico para hoy → sin dato, se excluye.
        // Un total de 0 mm (día nublado/lluvioso) SÍ es un valor real y debe
        // contarse en el promedio, no descartarse como si la estación no
        // hubiera reportado — filtrar por `> 0` trataba un dato legítimo igual
        // que uno ausente.
        const porEstacion = ests.map(e => e.pronosticoSerie
            .filter(p => p.fecha_local === hoyLocal && p.eto_fc_mm != null));
        const sumas = porEstacion
            .filter(serie => serie.length > 0)
            .map(serie => serie.reduce((a, p) => a + (p.eto_fc_mm ?? 0), 0));
        return sumas.length ? sumas.reduce((a, b) => a + b, 0) / sumas.length : null;
    })();
    const an = analisisTecnico(ests, etoProm, gddProm, lluviaTotal, etoFcHoy);
    // Predicción por tendencia (nowcasting) a 24 h por estación en línea
    const preds = ests.filter(e => e.enLinea && e.lectura).map(predice24h);

    // Filas de la tabla de pronóstico 24 h. Nubosidad y lluvia en COLUMNAS
    // SEPARADAS: son variables distintas y conservan escalas independientes.
    const filasPred = preds.map(p => {
        // Identidad por la MARCA (icono + punto de color), no coloreando el texto:
        // los tonos claros de la rampa son ilegibles como tinta sobre blanco.
        const nub = p.cielo.coberturaPct != null
            ? `<span class="pt" style="background:${p.color}"></span>${p.icono ? p.icono + ' ' : ''}`
              + `<b>${p.cielo.coberturaPct}%</b> ${p.etiqueta}`
            : `<span class="nodet">Dato requerido</span>`;
        return `<tr>
        <td><b>${p.estacion}</b></td>
        <td class="celda-cielo">${nub}</td>
        <td>${p.pLluvia != null ? p.pLluvia + ' %' : '—'}${p.fuenteLluvia === 'tendencia_local' ? '<br><small>est. local</small>' : ''}</td>
        <td>${p.lluviaMm != null ? p.lluviaMm.toFixed(1) + ' mm' : '—'}</td>
        <td>${p.tMinEsp != null ? p.tMinEsp + '°' : '—'} / <b>${p.tMaxEsp != null ? p.tMaxEsp + '°' : '—'}</b></td>
        <td>${p.etoEsp != null ? p.etoEsp.toFixed(1) + ' mm' : '—'}</td>
        <td><span class="conf conf-${p.cielo.confianzaEtiqueta.toLowerCase().replace(/\s/g, '-')}">${p.cielo.confianzaEtiqueta}</span></td>
    </tr>`;
    }).join('');

    // Tabla de lecturas observadas: incluye EDAD DEL DATO y bandera de calidad,
    // para que ningún valor se lea como "actual" sin saber cuándo se midió.
    const filas = ests.map(e => {
        const l = e.lectura;
        const q = e.calidad;
        return `<tr class="${q.usableComoActual ? '' : 'off'}">
            <td><b>${e.nombre}</b><br><small>${e.ciudad ?? ''} · #${e.station_id}</small></td>
            <td><span class="qa" style="color:${q.color}">● ${q.etiqueta}</span>
                ${q.flags.length ? `<br><small>${q.flags.join(', ')}</small>` : ''}</td>
            <td>${formateaEdad(q.edadMin)}</td>
            <td>${fmt(l?.temp_c, 1, '°C')}</td>
            <td>${l?.hum_rel_pct != null ? Math.round(l.hum_rel_pct) + ' %' : '—'}</td>
            <td>${fmt(l?.viento_ms, 1, 'm/s')}</td>
            <td>${fmt(l?.lluvia_dia_mm, 1, 'mm')}</td>
            <td><b>${fmt(l?.eto_mm ?? l?.et_dia_mm, 2, 'mm')}</b></td>
            <td>${l?.gdd != null ? l.gdd.toFixed(0) : '—'}</td>
        </tr>`;
    }).join('');

    // ── Condición del cielo actual (§11.3): sección propia, separada de la lluvia
    const filasCielo = ests.filter(e => e.lectura).map(e => {
        const c = e.cielo;
        const fc = e.pronostico;
        const capas = fc && (fc.nubosidad_baja_pct != null || fc.nubosidad_media_pct != null || fc.nubosidad_alta_pct != null)
            ? `${fc.nubosidad_baja_pct ?? '—'} / ${fc.nubosidad_media_pct ?? '—'} / ${fc.nubosidad_alta_pct ?? '—'}`
            : '—';
        return `<tr>
            <td><b>${e.nombre}</b></td>
            <td class="celda-cielo"><span class="pt" style="background:${c.color}"></span>${c.icono ? c.icono + ' ' : ''}${c.etiqueta}</td>
            <td>${c.coberturaPct != null ? c.coberturaPct + ' %' : '<span class="nodet">no determinada</span>'}</td>
            <td><small>${capas}</small></td>
            <td><span class="proc proc-${c.procedencia}">${PROCEDENCIA_LABEL[c.procedencia]}</span></td>
            <td><span class="conf conf-${c.confianzaEtiqueta.toLowerCase().replace(/\s/g, '-')}">${c.confianzaEtiqueta} · ${c.confianzaPct}%</span></td>
        </tr>`;
    }).join('');

    // Discrepancias entre fuentes: se MUESTRAN, no se ocultan (§6).
    const discrepancias = ests.flatMap(e =>
        e.cielo.discrepancias.map(d => `<li><b>${e.nombre}:</b> ${d}</li>`));

    // ¿Hay alguna fuente de nubosidad? Determina el aviso de la sección.
    const conNubosidad = ests.filter(e => e.cielo.coberturaPct != null).length;
    const avisoCielo = conNubosidad === 0
        ? `<div class="alerta">
             <b>Estado del cielo: NO DETERMINADO.</b> No se dispone de cobertura nubosa de modelo,
             clasificación satelital ni radiación utilizable en este corte. El estado del cielo
             <b>no se infiere de la lluvia observada</b>: una precipitación de 0.0 mm y una
             probabilidad de lluvia de 0 % son compatibles con cielo cubierto.
             Ejecutar <code>clima-pronostico-sync</code> para incorporar la capa de nubosidad.
           </div>`
        : '';

    // Avisos de viento, ya independientes del estado del cielo.
    const avisosViento = preds.filter(p => p.avisoViento)
        .map(p => `<li><b>${p.estacion}:</b> ${p.avisoViento}</li>`);

    // ── Serie distrital 24 h: promedio horario entre estaciones ─────────────
    // El distrito se opera como una unidad, así que la evolución se presenta
    // agregada; el detalle por estación queda en las tablas y los medidores.
    const serieDistrital: PuntoSerie[] = (() => {
        // Acumuladores + contador de estaciones CON DATO, uno por campo: si una
        // estación reporta null en un campo puntual para esa hora (dato parcial
        // faltante del proveedor), esa estación queda fuera del promedio de ESE
        // campo en vez de contar como 0. Compartir un solo contador `n` sumaba
        // null??0 mientras igual incrementaba n, hundiendo el promedio hacia 0
        // en cualquier hora con datos parciales — la huella de un "salto" 0→100%
        // que no reflejaba nubosidad real, solo datos faltantes de una estación.
        interface Acc {
            hora: string; horizonte: number;
            sTotal: number; nTotal: number; sBaja: number; nBaja: number;
            sMedia: number; nMedia: number; sAlta: number; nAlta: number;
            sProb: number; nProb: number; sMm: number; nMm: number;
            sTemp: number; nTemp: number;
        }
        const suma = (acc: Acc, campoS: keyof Acc, campoN: keyof Acc, v: number | null) => {
            if (v == null) return;
            (acc[campoS] as number) += v;
            (acc[campoN] as number) += 1;
        };
        const porHora = new Map<string, Acc>();
        for (const e of ests) {
            for (const p of e.pronosticoSerie) {
                if ((p.horizonte_h ?? 99) > 24) continue;
                const k = p.valido_en;
                const hora = new Date(p.valido_en).toLocaleTimeString('es-MX', {
                    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chihuahua',
                });
                const acc = porHora.get(k) ?? {
                    hora, horizonte: p.horizonte_h ?? 0,
                    sTotal: 0, nTotal: 0, sBaja: 0, nBaja: 0, sMedia: 0, nMedia: 0,
                    sAlta: 0, nAlta: 0, sProb: 0, nProb: 0, sMm: 0, nMm: 0, sTemp: 0, nTemp: 0,
                };
                suma(acc, 'sTotal', 'nTotal', p.nubosidad_total_pct);
                suma(acc, 'sBaja', 'nBaja', p.nubosidad_baja_pct);
                suma(acc, 'sMedia', 'nMedia', p.nubosidad_media_pct);
                suma(acc, 'sAlta', 'nAlta', p.nubosidad_alta_pct);
                suma(acc, 'sProb', 'nProb', p.precip_prob_pct);
                suma(acc, 'sMm', 'nMm', p.precip_mm);
                suma(acc, 'sTemp', 'nTemp', p.temp_c);
                porHora.set(k, acc);
            }
        }
        return [...porHora.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([, v]) => ({
                hora: v.hora, horizonte: v.horizonte,
                total: v.nTotal ? +(v.sTotal / v.nTotal).toFixed(0) : null,
                baja: v.nBaja ? +(v.sBaja / v.nBaja).toFixed(0) : null,
                media: v.nMedia ? +(v.sMedia / v.nMedia).toFixed(0) : null,
                alta: v.nAlta ? +(v.sAlta / v.nAlta).toFixed(0) : null,
                prob: v.nProb ? +(v.sProb / v.nProb).toFixed(0) : null,
                mm: v.nMm ? +(v.sMm / v.nMm).toFixed(2) : null,
                temp: v.nTemp ? +(v.sTemp / v.nTemp).toFixed(1) : null,
            }));
    })();

    // Gráficas del tablero (vacías si no hay serie: el informe sigue siendo válido)
    const svgNub24 = graficaNubosidad24h(serieDistrital);
    const svgPrecip24 = graficaPrecipitacion24h(serieDistrital);
    const svgTemp24 = graficaTemperatura24h(serieDistrital);
    const svgEto = graficaEtoEstaciones(ests.map(e => ({
        nombre: e.nombre, eto: e.lectura?.eto_mm ?? e.lectura?.et_dia_mm ?? null,
    })));
    const svgCalidad = franjaCalidad(ests.map(e => ({
        nombre: e.nombre, edadMin: e.calidad.edadMin, status: e.calidad.status,
    })));

    // Medidores por estación: cobertura actual con su procedencia
    const medidores = ests.map(e => medidorNubosidad(
        e.cielo.coberturaPct,
        e.nombre,
        e.cielo.coberturaPct != null ? e.cielo.etiqueta : 'sin fuente',
    )).join('');

    // Máximo real de probabilidad de lluvia en 24 h, exista o no ventana
    // operativa: para el KPI "sin ventana relevante" (prob < 20 %) NO es lo
    // mismo que "0 % de probabilidad" — mostrar 0 sería un dato falso.
    const probMaxima = (() => {
        const conProb = serieDistrital.filter(p => p.prob != null);
        return conProb.length ? conProb.reduce((a, b) => (b.prob! > a.prob! ? b : a)) : null;
    })();
    // Ventana de máxima probabilidad de lluvia: dato ACCIONABLE para la
    // operación, con el umbral de 20 % que separa "vigilar" de "sin ajuste".
    const ventanaLluvia = probMaxima && probMaxima.prob! >= 20
        ? { hora: probMaxima.hora, prob: probMaxima.prob!, mm: probMaxima.mm ?? 0 } : null;

    // ── Veredicto operativo: la conclusión que el informe debe entregar ─────
    // Un centro de inteligencia no expone datos, entrega un juicio accionable.
    const veredicto = (() => {
        const vencidas = ests.filter(e => e.calidad.status === 'expired').length;
        const sinCielo = ests.filter(e => e.cielo.coberturaPct == null).length;
        if (sinCielo === ests.length) {
            return { nivel: 'aviso', titulo: 'Diagnóstico incompleto',
                txt: 'Sin fuente de nubosidad en este corte. Las decisiones de riego deben apoyarse en ETₒ y humedad de suelo, no en el estado del cielo.' };
        }
        if (ventanaLluvia && ventanaLluvia.prob >= 50) {
            return { nivel: 'critico', titulo: 'Precipitación probable en 24 h',
                txt: `Máximo de ${ventanaLluvia.prob} % hacia las ${ventanaLluvia.hora} h. Evaluar diferimiento de turnos y cierre preventivo de tomas en los módulos expuestos.` };
        }
        if (vencidas > 0) {
            return { nivel: 'aviso', titulo: 'Datos parcialmente vencidos',
                txt: `${vencidas} de ${ests.length} estaciones superan los 60 min sin reportar. Refrescar desde el módulo Clima antes de tomar decisiones sobre este corte.` };
        }
        if (ventanaLluvia) {
            return { nivel: 'aviso', titulo: 'Vigilancia por precipitación',
                txt: `Probabilidad máxima de ${ventanaLluvia.prob} % hacia las ${ventanaLluvia.hora} h. Mantener la programación y revisar la evolución en el siguiente corte.` };
        }
        return { nivel: 'normal', titulo: 'Operación sin restricción climática',
            txt: 'Sin precipitación relevante prevista y con datos válidos. La programación de riego se rige por la demanda atmosférica (ETₒ).' };
    })();

    // ── Índices agroclimáticos del distrito (tablero ejecutivo) ─────────────
    const entradasIdx = entradasDesdeEstaciones(ests, etoFcHoy);
    const indices = calculaIndices(entradasIdx);
    const svgIndices = indices.map(i => `<div class="idx-item">${
        medidorIndice(i.valor, i.clave === 'ICA' ? 'ICA-005' : i.clave, i.descripcion,
            i.etiqueta, i.color, i.implicacion)
    }</div>`).join('');

    // Nivel de demanda: el IDR ya expresa la fracción del máximo del ciclo.
    const idr = indices.find(i => i.clave === 'IDR')!;

    // ── Lámina bruta por cultivo ───────────────────────────────────────────
    // ETc = ETₒ × Kc, corregida por eficiencia de aplicación en riego rodado.
    // Se calcula SIEMPRE sobre la ETₒ del día completo (nunca el acumulado parcial).
    const EFIC_RODADO = 0.70;
    const CULTIVOS: { nombre: string; kc: number; etapa: string }[] = [
        { nombre: 'Nogal', kc: 0.85, etapa: 'brotación' },
        { nombre: 'Alfalfa', kc: 0.95, etapa: 'corte medio' },
        { nombre: 'Maíz', kc: 0.75, etapa: 'desarrollo' },
        { nombre: 'Chile', kc: 0.80, etapa: 'floración' },
    ];
    // Lámina de referencia para el tablero: nogal, el cultivo predominante del
    // distrito. Es la cifra que el operador traduce a entregas.
    const laminaRefM3 = etoFcHoy != null
        ? (etoFcHoy * 0.85 / EFIC_RODADO) * 10
        : null;

    const filasCultivo = etoFcHoy != null
        ? CULTIVOS.map(c => {
            const neta = etoFcHoy * c.kc;
            const bruta = neta / EFIC_RODADO;
            return `<tr>
                <td><b>${c.nombre}</b> <small>${c.etapa}</small></td>
                <td>${c.kc.toFixed(2)}</td>
                <td>${neta.toFixed(2)} mm</td>
                <td><b>${(bruta * 10).toFixed(0)} m³</b></td>
            </tr>`;
        }).join('')
        : '';

    // ── Semáforo operativo ─────────────────────────────────────────────────
    // Cada luz lleva etiqueta de texto: el color nunca porta el significado solo.
    const iro = indices.find(i => i.clave === 'IRO')!;
    const semaforo = [
        {
            rotulo: 'Demanda hídrica',
            estado: idr.valor == null ? 'S/D' : idr.etiqueta,
            color: idr.valor == null ? '#94a3b8' : idr.color,
        },
        {
            rotulo: 'Riesgo climático',
            estado: iro.valor == null ? 'S/D' : iro.etiqueta,
            color: iro.valor == null ? '#94a3b8' : iro.color,
        },
        {
            rotulo: 'Integridad de la red',
            estado: `${entradasIdx.estacionesOk}/${entradasIdx.estacionesTotal} válidas`,
            color: entradasIdx.estacionesOk === entradasIdx.estacionesTotal ? VIZ.estado.bueno
                : entradasIdx.estacionesOk > 0 ? VIZ.estado.aviso : VIZ.estado.critico,
        },
    ].map(s => `<div class="sem-item">
        <span class="sem-luz" style="background:${s.color}"></span>
        <span class="sem-rotulo">${s.rotulo}</span>
        <span class="sem-estado" style="color:${s.color}">${s.estado}</span>
    </div>`).join('');

    // ── Recomendaciones ligadas al diagnóstico ─────────────────────────────
    // La primera recomendación se DERIVA del veredicto: antes el informe podía
    // abrir advirtiendo de lluvia y recomendar solo cosas de ETₒ, sin que ninguna
    // acción respondiera al riesgo anunciado.
    const recoDelVeredicto = (() => {
        if (conNubosidad === 0) {
            return 'Sin fuente de nubosidad en este corte: no ajustar entregas por el estado del cielo; '
                + 'decidir con ETₒ, humedad de suelo y demanda programada.';
        }
        if (ventanaLluvia && ventanaLluvia.prob >= 50) {
            return `<b>Ventana de lluvia hacia las ${ventanaLluvia.hora} h (${ventanaLluvia.prob} %`
                + `${ventanaLluvia.mm > 0 ? `, ${ventanaLluvia.mm.toFixed(1)} mm` : ''}):</b> `
                + 'evaluar diferimiento de los turnos de esa ventana y cierre preventivo de tomas '
                + 'en los módulos expuestos.';
        }
        const vencidas = ests.filter(e => e.calidad.status === 'expired').length;
        if (vencidas > 0) {
            return `<b>${vencidas} de ${ests.length} estaciones sin reportar hace más de 1 h:</b> `
                + 'pulsar «Actualizar datos» en el módulo Clima y reemitir el informe antes de '
                + 'decidir sobre este corte.';
        }
        if (ventanaLluvia) {
            return `<b>Vigilar la ventana de las ${ventanaLluvia.hora} h (${ventanaLluvia.prob} % de lluvia):</b> `
                + 'mantener la programación y verificar la evolución antes del riego de esa franja.';
        }
        return '<b>Sin restricción climática:</b> ejecutar la programación prevista y regirse por '
            + 'la demanda atmosférica del día.';
    })();
    const recomendaciones = [recoDelVeredicto, ...an.recomendaciones];

    // KPI de cielo: cobertura media distrital cuando hay fuente; si no, el
    // indicador dice explícitamente que no está determinado (nunca un icono solar).
    const cobs = ests.map(e => e.cielo.coberturaPct).filter((v): v is number => v != null);
    const cieloKpi = cobs.length
        ? (() => {
            const media = cobs.reduce((a, b) => a + b, 0) / cobs.length;
            const cl = clasificaCielo(media);
            return `<span style="font-size:1.1rem">${cl.icono}</span> ${media.toFixed(0)}%`;
        })()
        : `<span class="nodet" style="font-size:0.82rem">No determinado</span>`;

    // Numeración de secciones: varias son condicionales (dependen de que haya
    // pronóstico), así que se numeran en orden de emisión en vez de a mano.
    let nSec = 0;
    const sec = () => ++nSec;

    // ── Normalización de periodos de ETₒ (§11.1) ───────────────────────────
    // La ETₒ observada es el ACUMULADO DEL DÍA HASTA LA HORA DEL CORTE, mientras
    // que la pronosticada es el TOTAL DE 24 H. Compararlas sin decirlo sugiere
    // un salto de demanda que no existe. Se declara la hora del corte y, cuando
    // hay sol suficiente, se ofrece una proyección a cierre del día.
    const horaCorte = (() => {
        const ts = ests.map(e => e.lectura?.ts).filter((v): v is string => v != null).sort().at(-1);
        return ts ? new Date(ts) : null;
    })();
    const horaLocal = horaCorte
        ? horaCorte.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chihuahua' })
        : null;
    const notaPeriodoEto = etoProm != null
        ? `<div class="nota-periodo">
             <b>Periodos no comparables.</b> La ETₒ <b>observada</b> (${etoProm.toFixed(2)} mm) es el
             acumulado del día <b>hasta las ${horaLocal ?? '—'} h</b>, no el total diario.
             ${etoFcHoy != null
                ? `El total previsto para hoy es de <b>${etoFcHoy.toFixed(2)} mm</b>; la lámina de riego
                   debe dimensionarse con esa cifra, no con el acumulado parcial.`
                : 'Para dimensionar la lámina de riego se requiere el total del día, no este parcial.'}
           </div>`
        : '';

    // Frescura del corte: deja constancia de la antigüedad de cada lectura para
    // que el informe sea auditable y se sepa si convenía refrescar antes de emitirlo.
    const edades = ests.map(e => e.calidad.edadMin).filter((v): v is number => v != null);
    const edadMax = edades.length ? Math.max(...edades) : null;
    const edadesTxt = edades.length
        ? `mín ${formateaEdad(Math.min(...edades))} · máx ${formateaEdad(edadMax)}`
        : 'sin lecturas disponibles';

    // Procedencia del pronóstico para la sección de metodología.
    const fcRef = ests.find(e => e.pronostico)?.pronostico ?? null;
    const provTxt = fcRef
        ? `${fcRef.proveedor}${fcRef.modelo ? ` (${fcRef.modelo})` : ''}, corrida ${
            fcRef.corrida_en ? new Date(fcRef.corrida_en).toLocaleString('es-MX') : 's/d'}`
        : 'no sincronizado en este corte (ejecutar <code>clima-pronostico-sync</code>)';

    const logoImg = (src: string, alt: string) => src
        ? `<img src="${src}" alt="${alt}" style="height:52px;width:auto;object-fit:contain">`
        : `<div style="height:52px;display:flex;align-items:center;color:#94a3b8;font-size:0.7rem">${alt}</div>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe Técnico de Clima — SRL Unidad Conchos</title>
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

  /* ── Tablero ejecutivo: lectura de un vistazo para dirección ───────────── */
  .tablero {
    border: 1px solid ${VIZ.grid}; border-radius: 12px; overflow: hidden;
    margin: 18px 0 20px; background: ${VIZ.surface};
  }
  .tab-cab {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    background: #0f2942; color: #fff; padding: 9px 16px;
    font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.09em;
  }
  .tab-sello {
    background: rgba(255,255,255,0.10); border: 1.5px solid; border-radius: 999px;
    padding: 3px 12px; font-size: 0.63rem; white-space: nowrap; letter-spacing: 0.04em;
  }
  /* Semáforo: la luz acompaña SIEMPRE a una etiqueta de texto */
  .semaforo {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 4px 18px; padding: 12px 16px; border-bottom: 1px solid ${VIZ.grid};
    background: ${VIZ.plane};
  }
  .sem-item { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
  .sem-luz { width: 11px; height: 11px; border-radius: 50%; flex: none; }
  .sem-rotulo { color: ${VIZ.inkSecondary}; }
  .sem-estado { font-weight: 700; margin-left: auto; white-space: nowrap; }
  /* Medidores de índice */
  .indices {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    padding: 14px 16px 6px;
  }
  .idx-item { min-width: 0; }
  .idx-nota {
    font-size: 0.66rem; color: ${VIZ.inkMuted}; margin: 0; padding: 0 16px 13px;
    line-height: 1.5;
  }
  /* Nivel de demanda (barra segmentada) */
  .nivel-demanda {
    border: 1px solid ${VIZ.grid}; border-radius: 12px; padding: 15px 16px;
    background: ${VIZ.surface}; align-self: start;
  }
  .nivel-cab {
    font-size: 0.58rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.07em; color: ${VIZ.inkMuted};
  }
  .nivel-valor { font-size: 1.35rem; font-weight: 700; margin: 4px 0 10px; }
  .nivel-pie { font-size: 0.7rem; color: ${VIZ.inkSecondary}; margin-top: 9px; line-height: 1.45; }
  /* Tabla de fórmulas: el código no debe desbordar la página */
  .tabla-formulas code { font-size: 0.66rem; white-space: normal; word-break: break-word; }
  .tabla-formulas td { vertical-align: top; }

  /* ── Veredicto operativo: la conclusión antes que el dato ───────────────── */
  .veredicto {
    display: flex; align-items: flex-start; gap: 14px;
    border: 1px solid ${VIZ.grid}; border-left: 4px solid ${VIZ.inkMuted};
    border-radius: 12px; padding: 15px 18px; margin: 18px 0 22px;
    background: ${VIZ.plane};
  }
  .veredicto-marca { font-size: 1.05rem; line-height: 1.5; flex: none; }
  .veredicto-eyebrow {
    font-size: 0.6rem; font-weight: 800; letter-spacing: 0.09em;
    text-transform: uppercase; color: ${VIZ.inkMuted};
  }
  .veredicto-tit { font-size: 1.06rem; margin: 3px 0 5px; color: ${VIZ.inkPrimary};
                   border: 0; padding: 0; letter-spacing: -0.01em; }
  .veredicto p { font-size: 0.83rem; margin: 0; color: ${VIZ.inkSecondary}; max-width: 78ch; }
  .v-normal  { border-left-color: ${VIZ.estado.bueno}; }
  .v-normal  .veredicto-marca { color: ${VIZ.estado.bueno}; }
  .v-aviso   { border-left-color: ${VIZ.estado.aviso}; background: #fffbeb; }
  .v-aviso   .veredicto-marca { color: ${VIZ.estado.aviso}; }
  .v-critico { border-left-color: ${VIZ.estado.critico}; background: #fef2f2; }
  .v-critico .veredicto-marca { color: ${VIZ.estado.critico}; }

  /* ── Fila de indicadores ────────────────────────────────────────────────── */
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0 24px; }
  .kpi {
    border: 1px solid ${VIZ.grid}; border-radius: 12px; padding: 13px 14px;
    background: ${VIZ.surface};
  }
  .kpi .l {
    font-size: 0.58rem; color: ${VIZ.inkMuted}; text-transform: uppercase;
    letter-spacing: 0.07em; font-weight: 700;
  }
  .kpi .v {
    font-size: 1.75rem; font-weight: 700; color: ${VIZ.inkPrimary};
    line-height: 1.15; margin: 5px 0 2px; display: flex; align-items: baseline; gap: 3px;
  }
  .kpi .v .u { font-size: 0.72rem; font-weight: 600; color: ${VIZ.inkMuted}; }
  .kpi .pie { font-size: 0.63rem; color: ${VIZ.inkMuted}; line-height: 1.35; }

  /* ── Figuras y medidores ────────────────────────────────────────────────── */
  .fig { margin: 14px 0 18px; padding: 0; border: 1px solid ${VIZ.grid};
         border-radius: 12px; background: ${VIZ.surface}; padding: 14px 16px 10px; }
  .fig figcaption { margin-bottom: 10px; }
  .fig figcaption b { display: block; font-size: 0.83rem; color: ${VIZ.inkPrimary}; }
  .fig figcaption span { display: block; font-size: 0.7rem; color: ${VIZ.inkMuted}; margin-top: 2px; }
  .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .duo .fig { margin: 0; }
  .medidores {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 6px; margin: 12px 0 16px; padding: 12px 8px;
    border: 1px solid ${VIZ.grid}; border-radius: 12px; background: ${VIZ.surface};
    justify-items: center;
  }
  /* Leyenda: identidad por marca, nunca por color del texto */
  .leyenda { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px;
             font-size: 0.68rem; color: ${VIZ.inkSecondary}; }
  .leyenda span { display: inline-flex; align-items: center; gap: 5px; }
  .leyenda i { display: inline-block; flex: none; }
  .k-linea { width: 16px; height: 3px; border-radius: 2px; }
  .k-dash { width: 16px; height: 0; border-top: 2px dashed; }
  .k-punto { width: 9px; height: 9px; border-radius: 50%; }
  /* Aviso de normalización de periodos: acumulado parcial vs total diario */
  .nota-periodo {
    background: #fffbeb; border: 1px solid #fcd34d; border-left: 3px solid ${VIZ.estado.aviso};
    border-radius: 6px; padding: 9px 13px; font-size: 0.77rem; color: #78350f;
    margin: 2px 0 12px; line-height: 1.5;
  }
  .destacado {
    background: #eff6ff; border: 1px solid #bfdbfe; border-left: 3px solid ${VIZ.lluvia};
    border-radius: 8px; padding: 10px 14px; font-size: 0.8rem; color: #1e3a8a; margin: 4px 0 14px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.79rem; margin: 10px 0;
          font-variant-numeric: tabular-nums; }
  th { background: ${SRL_MARRON}; color: #fff; padding: 8px 7px; text-align: left;
       font-size: 0.63rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  th:first-child { border-radius: 7px 0 0 0; }
  th:last-child { border-radius: 0 7px 0 0; }
  td { padding: 8px 7px; border-bottom: 1px solid ${VIZ.grid}; }
  tbody tr:nth-child(even) { background: ${VIZ.plane}; }
  tr.off td { opacity: 0.55; }
  .on { color: ${VIZ.estado.bueno}; font-weight: 700; font-size: 0.72rem; }
  .offs { color: ${VIZ.inkMuted}; font-size: 0.72rem; }
  small { color: ${VIZ.inkMuted}; }
  h2 {
    color: ${SRL_MARRON}; font-size: 0.78rem; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.08em;
    padding: 0 0 7px; margin: 34px 0 12px;
    border: 0; border-bottom: 2px solid ${SRL_MARRON};
  }
  .analisis { background: #f8fafc; border: 1px solid #eef2f7; border-radius: 10px; padding: 4px 16px; }
  .analisis h4 { color: ${AZUL}; font-size: 0.86rem; margin: 14px 0 4px; }
  .analisis p { font-size: 0.82rem; margin: 4px 0 12px; }
  .reco { list-style: none; padding: 0; margin: 6px 0; }
  .reco li { font-size: 0.82rem; padding: 7px 12px; margin: 6px 0; background: #eff6ff; border-left: 3px solid ${AZUL}; border-radius: 4px; }
  /* La primera recomendación deriva del veredicto: se destaca como la acción principal */
  .reco li.reco-clave {
    background: ${SRL_MARRON}0d; border-left-color: ${SRL_MARRON};
    font-size: 0.86rem; padding: 11px 14px;
  }
  /* Frontera entre el bloque ejecutivo y el sustento técnico */
  .corte-ejecutivo {
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    margin: 26px 0 6px; padding: 11px 15px;
    border-top: 2px solid ${SRL_MARRON}; border-bottom: 1px solid ${VIZ.grid};
    background: ${VIZ.plane};
  }
  .corte-ejecutivo span {
    font-size: 0.66rem; font-weight: 800; letter-spacing: 0.09em;
    text-transform: uppercase; color: ${SRL_MARRON};
  }
  .corte-ejecutivo em { font-size: 0.72rem; color: ${VIZ.inkMuted}; font-style: normal; }
  .pred-nota { font-size: 0.76rem; color: #64748b; font-style: italic; margin: 4px 0 10px; }
  /* Franja de procedencia: qué fuente respalda cada dato del informe */
  .franja { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.7rem;
            background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; margin: 4px 0 8px; }
  .franja em { color: #94a3b8; font-size: 0.68rem; margin-left: auto; }
  .proc { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 0.62rem;
          font-weight: 800; letter-spacing: 0.4px; color: #fff; }
  .proc-observado { background: #16a34a; }
  .proc-estimado { background: #f59e0b; }
  .proc-pronosticado { background: ${AZUL}; }
  .proc-satelite { background: #7c3aed; }
  .proc-ninguna { background: #94a3b8; }
  /* Confianza del diagnóstico (§6) */
  .conf { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 0.66rem; font-weight: 700; }
  .conf-alta { background: #dcfce7; color: #15803d; }
  .conf-media { background: #fef3c7; color: #b45309; }
  .conf-baja { background: #ffedd5; color: #c2410c; }
  .conf-no-concluyente { background: #f1f5f9; color: #64748b; }
  /* Identidad del estado del cielo: punto de color + icono junto a texto en tinta.
     El texto nunca lleva el color de la serie (los tonos claros no son legibles). */
  .celda-cielo { font-weight: 600; color: ${VIZ.inkPrimary}; white-space: nowrap; }
  .pt { display: inline-block; width: 9px; height: 9px; border-radius: 50%;
        margin-right: 6px; vertical-align: baseline; }
  /* Estado sin fuente: nunca se dibuja un icono solar aquí */
  .nodet { color: #b45309; font-weight: 700; font-style: italic; }
  .qa { font-size: 0.7rem; font-weight: 700; }
  .alerta { background: #fffbeb; border: 1px solid #fcd34d; border-left: 4px solid #f59e0b;
            border-radius: 6px; padding: 11px 14px; font-size: 0.8rem; color: #78350f; margin: 8px 0 12px; }
  .discrep { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626;
             border-radius: 6px; padding: 10px 14px; font-size: 0.78rem; color: #7f1d1d; margin: 10px 0; }
  .discrep ul { margin: 6px 0 2px; padding-left: 18px; }
  .discrep li { margin: 4px 0; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.92em; }
  .pred-tabla { margin-top: 12px; } .pred-tabla th { background: ${AZUL}; }
  .pred-tabla td { vertical-align: top; }
  .foot {
    margin-top: 36px; padding-top: 15px; border-top: 2px solid ${SRL_MARRON};
    font-size: 0.67rem; color: ${VIZ.inkMuted}; line-height: 1.6;
    display: flex; justify-content: space-between; gap: 20px; align-items: flex-start;
  }
  .foot b { color: ${SRL_MARRON}; }
  .foot-sello { text-align: right; white-space: nowrap; color: ${VIZ.inkSecondary}; font-weight: 600; }
  .foot-sello em { font-weight: 400; color: ${VIZ.inkMuted}; font-style: normal; }
  /* Impresión / exportación a PDF: el informe es un documento institucional */
  @page { margin: 14mm; }
  @media print {
    body { padding: 0; }
    .kpi, .analisis, table, .fig, .veredicto, .medidores, .discrep, .destacado,
    .tablero, .nivel-demanda { break-inside: avoid; }
    /* El tablero ejecutivo debe caber en la primera página */
    .tablero { page-break-after: auto; }
    .tab-cab { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { break-after: avoid; }
    .fig, .kpi, .medidores { box-shadow: none; }
    header { break-after: avoid; }
  }
  /* Pantallas estrechas: el informe también se consulta desde tableta */
  @media (max-width: 720px) {
    body { padding: 14px; }
    .kpis { grid-template-columns: repeat(2, 1fr); }
    .duo { grid-template-columns: 1fr; }
    .indices { grid-template-columns: repeat(2, 1fr); }
    header { flex-wrap: wrap; }
    table { font-size: 0.72rem; }
    .tab-cab { flex-wrap: wrap; gap: 6px; }
  }
</style></head><body><div class="wrap">
  <header>
    <div class="logos">${logoImg(logoSICA, 'SICA-005')}</div>
    <div class="titulo">
      <div class="sub">S R L Unidad Conchos · Delicias, Chihuahua</div>
      <h1>Centro de Inteligencia Agroclimática</h1>
      <div class="meta">Distrito de Riego 005 · Red WeatherLink (Davis) + modelo de pronóstico · Corte: ${hoy}</div>
    </div>
    <div class="logos">${logoImg(logoSRL, 'SRL Unidad Conchos')}</div>
  </header>

  <!-- ══ TABLERO EJECUTIVO ══════════════════════════════════════════════ -->
  <!-- Lectura de un vistazo para dirección; el detalle técnico va debajo. -->
  <section class="tablero">
    <div class="tab-cab">
      <span>Estado operativo del distrito</span>
      <span class="tab-sello" style="border-color:${veredicto.nivel === 'critico' ? VIZ.estado.critico
        : veredicto.nivel === 'aviso' ? VIZ.estado.aviso : VIZ.estado.bueno};
        color:${veredicto.nivel === 'critico' ? VIZ.estado.critico
        : veredicto.nivel === 'aviso' ? VIZ.estado.aviso : VIZ.estado.bueno}">
        ${veredicto.nivel === 'critico' ? '▲ Requiere atención'
        : veredicto.nivel === 'aviso' ? '◆ Con vigilancia' : '● Operación normal'}
      </span>
    </div>

    <!-- Semáforo: color + etiqueta de texto, nunca color solo -->
    <div class="semaforo">${semaforo}</div>

    <!-- Índices agroclimáticos, con fórmula declarada en la metodología -->
    <div class="indices">${svgIndices}</div>
    <p class="idx-nota">
      Índices calculados a partir de datos observados y pronosticados; sus fórmulas se
      detallan en «Metodología, fuentes y limitaciones». <b>S/D</b> indica entrada
      insuficiente — nunca se sustituye por cero.
    </p>
  </section>

  <!-- Veredicto operativo: la conclusión primero, el sustento después -->
  <section class="veredicto v-${veredicto.nivel}">
    <div class="veredicto-marca" aria-hidden="true">${
      veredicto.nivel === 'critico' ? '▲' : veredicto.nivel === 'aviso' ? '◆' : '●'}</div>
    <div>
      <div class="veredicto-eyebrow">Síntesis operativa</div>
      <h2 class="veredicto-tit">${veredicto.titulo}</h2>
      <p>${veredicto.txt}</p>
    </div>
  </section>

  <div class="kpis">
    <div class="kpi">
      <div class="l">Condición del cielo</div>
      <div class="v">${cieloKpi}</div>
      <div class="pie">${conNubosidad}/${ests.length} estaciones con fuente</div>
    </div>
    <!-- La cifra que se opera: lámina bruta a entregar, no la ETₒ en bruto -->
    <div class="kpi">
      <div class="l">Lámina a entregar</div>
      <div class="v">${laminaRefM3 != null ? laminaRefM3.toFixed(0) : '—'}<span class="u">m³/ha</span></div>
      <div class="pie">${laminaRefM3 != null
        ? `Nogal (Kc 0.85) · ETₒ ${etoFcHoy!.toFixed(2)} mm/día · eficiencia 70 %`
        : 'Sin ETₒ diaria para dimensionar la lámina'}</div>
    </div>
    <div class="kpi">
      <div class="l">Lluvia prevista 24 h</div>
      <div class="v">${probMaxima ? probMaxima.prob : '—'}<span class="u">%</span></div>
      <div class="pie">${ventanaLluvia ? `máximo hacia las ${ventanaLluvia.hora} h`
        : probMaxima ? `máximo ${probMaxima.prob} % hacia las ${probMaxima.hora} h · sin ventana operativa`
        : 'sin pronóstico sincronizado'}</div>
    </div>
    <div class="kpi">
      <div class="l">Integridad del dato</div>
      <div class="v">${ests.filter(e => e.calidad.usableComoActual).length}/${ests.length}</div>
      <div class="pie">lecturas dentro de validez</div>
    </div>
  </div>

  <div class="franja">
    <span class="proc proc-observado">OBSERVADO</span> estación ·
    <span class="proc proc-estimado">ESTIMADO</span> radiación local ·
    <span class="proc proc-pronosticado">PRONOSTICADO</span> modelo ·
    <span class="proc proc-satelite">SATÉLITE</span> pendiente (etapa 4)
    <em>Cada valor del informe indica su procedencia y la edad del dato.</em>
  </div>

  <h2>${sec()}. Recomendaciones operativas</h2>
  <ul class="reco">
    ${recomendaciones.map((r, i) => `<li${i === 0 ? ' class="reco-clave"' : ''}>${r}</li>`).join('')}
  </ul>

  <!-- Cierre del bloque ejecutivo: quien solo necesita decidir puede parar aquí -->
  <div class="corte-ejecutivo">
    <span>Fin del resumen ejecutivo</span>
    <em>Lo que sigue es el sustento técnico: series horarias, mapa, tablas por estación y metodología.</em>
  </div>


  <h2>${sec()}. Lecturas observadas</h2>
  <table>
    <thead><tr><th>Estación</th><th>Calidad</th><th>Edad del dato</th><th>Temp</th><th>HR</th><th>Viento</th><th>Lluvia día</th><th>ETₒ acum.</th><th>GDD</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>
  <p class="pred-nota">
    Frescura: ≤20 min válido · 21-60 min retrasado · &gt;60 min vencido. Un campo no entregado
    se marca <code>missing</code> y no se sustituye por cero.
  </p>

  <h2>${sec()}. Condición del cielo y nubosidad</h2>
  ${avisoCielo}
  <p class="pred-nota">
    La cobertura nubosa y la probabilidad de lluvia son <b>variables distintas</b> y conservan
    escalas independientes. El icono del cielo solo se asigna cuando existe cobertura nubosa
    de modelo, clasificación satelital o estimación radiométrica válida.
  </p>

  <!-- Medidores por estación: un ratio contra un límite se lee mejor así que en tabla -->
  <div class="medidores">${medidores}</div>

  ${svgNub24 ? `
  <figure class="fig">
    <figcaption>
      <b>Pronóstico de cobertura nubosa · próximas 24 h</b>
      <span>Modelo horario, promedio del distrito — no es una medición. La línea sólida es la cobertura total; las punteadas, las capas baja, media y alta. Cambios abruptos entre horas seguidas reflejan el modelo, no necesariamente el cielo real.</span>
    </figcaption>
    ${svgNub24}
    <div class="leyenda">
      <span><i class="k-linea" style="background:${VIZ.nube[3]}"></i>Total</span>
      <span><i class="k-dash" style="border-color:${VIZ.nube[4]}"></i>Baja</span>
      <span><i class="k-dash" style="border-color:${VIZ.nube[1]}"></i>Media</span>
      <span><i class="k-dash" style="border-color:${VIZ.nube[0]}"></i>Alta</span>
    </div>
  </figure>` : ''}

  <table>
    <thead><tr><th>Estación</th><th>Estado del cielo</th><th>Cobertura total</th><th>Capas baja/media/alta</th><th>Procedencia</th><th>Confianza</th></tr></thead>
    <tbody>${filasCielo}</tbody>
  </table>
  ${discrepancias.length ? `
  <div class="discrep">
    <b>Discrepancias entre fuentes</b>
    <ul>${discrepancias.join('')}</ul>
  </div>` : ''}

  ${svgPrecip24 ? `
  <h2>${sec()}. Precipitación prevista</h2>
  <p class="pred-nota">
    Escala <b>independiente</b> de la nubosidad: una probabilidad baja es compatible con cielo
    cubierto. El umbral del 50 % marca el punto en que conviene evaluar el diferimiento de turnos.
  </p>
  <figure class="fig">
    <figcaption>
      <b>Probabilidad de precipitación por hora · próximas 24 h</b>
      <span>Promedio del distrito. Las columnas llenas superan el umbral operativo.</span>
    </figcaption>
    ${svgPrecip24}
  </figure>
  ${ventanaLluvia ? `
  <div class="destacado">
    <b>Ventana de mayor probabilidad:</b> ${ventanaLluvia.prob} % hacia las ${ventanaLluvia.hora} h
    ${ventanaLluvia.mm > 0 ? `· lámina prevista ${ventanaLluvia.mm.toFixed(1)} mm` : '· sin lámina significativa'}.
  </div>` : ''}` : ''}

  ${svgTemp24 ? `
  <h2>${sec()}. Marcha térmica prevista</h2>
  <figure class="fig">
    <figcaption>
      <b>Temperatura esperada · próximas 24 h</b>
      <span>Promedio del distrito, con máximo y mínimo señalados.</span>
    </figcaption>
    ${svgTemp24}
  </figure>` : ''}

  ${filasCultivo ? `
  <h2>${sec()}. Lámina de riego por cultivo</h2>
  <div class="duo">
    <div>
      <p class="pred-nota">
        Lámina bruta requerida hoy, calculada sobre la <b>ETₒ del día completo</b>
        (${etoFcHoy!.toFixed(2)} mm) y una eficiencia de aplicación del 70 % en riego rodado.
      </p>
      <table>
        <thead><tr><th>Cultivo</th><th>Kc</th><th>ETc neta</th><th>Bruta m³/ha·día</th></tr></thead>
        <tbody>${filasCultivo}</tbody>
      </table>
    </div>
    <div class="nivel-demanda">
      <div class="nivel-cab">Nivel de demanda del distrito</div>
      <div class="nivel-valor" style="color:${idr.color}">${idr.etiqueta}</div>
      ${barraNivel(idr.valor, idr.color)}
      <div class="nivel-pie">
        ${idr.valor != null
          ? `<b>${idr.valor} %</b> de la demanda máxima de referencia del ciclo (${'9.0'} mm/día).`
          : 'Sin ETₒ diaria disponible para situar la demanda.'}
      </div>
    </div>
  </div>` : ''}

  <h2>${sec()}. Demanda hídrica y calidad del dato</h2>
  <div class="duo">
    <figure class="fig">
      <figcaption>
        <b>ETₒ por estación</b>
        <span>Evapotranspiración de referencia del día (mm).</span>
      </figcaption>
      ${svgEto || '<p class="pred-nota">Sin ETₒ disponible en este corte.</p>'}
    </figure>
    <figure class="fig">
      <figcaption>
        <b>Edad del dato por estación</b>
        <span>Frente a los umbrales de 20 min (válido) y 60 min (vencido).</span>
      </figcaption>
      ${svgCalidad}
      <div class="leyenda">
        <span><i class="k-punto" style="background:${VIZ.estado.bueno}"></i>● Válido</span>
        <span><i class="k-punto" style="background:${VIZ.estado.aviso}"></i>◆ Retrasado</span>
        <span><i class="k-punto" style="background:${VIZ.estado.critico}"></i>▲ Vencido</span>
      </div>
    </figure>
  </div>

  <h2>${sec()}. Ubicación geográfica</h2>
  <table>
    <thead><tr><th>Estación</th><th>Rol</th><th>Latitud</th><th>Longitud</th><th>Elevación</th></tr></thead>
    <tbody>${ests.map(e => `<tr>
      <td><b>${e.nombre}</b></td>
      <td>${e.rol === 'presa' ? 'Presa' : e.rol === 'modulo' ? 'Módulo' : 'Canal'}</td>
      <td>${e.latitud.toFixed(4)}°</td>
      <td>${e.longitud.toFixed(4)}°</td>
      <td>${e.elevacion_msnm != null ? e.elevacion_msnm + ' msnm' : '—'}</td>
    </tr>`).join('')}</tbody>
  </table>
  ${preds.length
    ? `<p class="pred-nota">Ubicación espacial ilustrada en el mapa de «Pronóstico a 24 h por estación».</p>`
    : mapaSVG(ests)}

  <h2>${sec()}. Análisis técnico</h2>
  <div class="analisis">
    <h4>Demanda hídrica y lámina de riego</h4>
    <p>${an.demanda}</p>
    ${notaPeriodoEto}
    <h4>Balance hídrico</h4>
    <p>${an.balance}</p>
    <h4>Nubosidad</h4>
    <p>${an.nubosidad}</p>
    <h4>Condición térmica</h4>
    <p>${an.termico}</p>
    <h4>Viento y riego</h4>
    <p>${an.viento}</p>
  </div>

  ${preds.length ? `
  <h2>${sec()}. Pronóstico a 24 h por estación</h2>
  <p class="pred-nota">
    Nubosidad y precipitación provienen del modelo horario cuando está sincronizado; las columnas
    marcadas <i>est. local</i> se derivan de la tendencia barométrica de la propia estación.
    <b>«Sin lluvia prevista» no implica «despejado»</b>: ambas columnas se leen por separado.
  </p>
  ${mapaSVG(ests, preds)}
  <table class="pred-tabla">
    <thead><tr><th>Estación</th><th>Nubosidad</th><th>Prob. lluvia</th><th>Lluvia prevista</th><th>Temp mín/máx</th><th>ETₒ 24 h</th><th>Confianza</th></tr></thead>
    <tbody>${filasPred}</tbody>
  </table>
  ${avisosViento.length ? `
  <div class="discrep">
    <b>Avisos de viento</b>
    <ul>${avisosViento.join('')}</ul>
  </div>` : ''}` : ''}

  <h2>${sec()}. Metodología, fuentes y limitaciones</h2>
  <div class="analisis">
    <h4>Fuentes</h4>
    <p>
      <b>Observación:</b> red de estaciones Davis/WeatherLink (API v2), convertida a métrico por SICA-005.
      <b>Pronóstico:</b> ${provTxt}. <b>Satélite:</b> no integrado en esta versión (etapa 4 del plan).
    </p>
    <h4>Cálculo</h4>
    <p>
      ETₒ de referencia por FAO-56 Penman-Monteith; se prioriza el acumulado diario de la estación
      (<code>et_day</code>) sobre el cálculo instantáneo. GDD en base 10 °C (nogal/alfalfa).
      Nubosidad estimada localmente como 100·(1−kt), con kt = radiación medida / radiación de cielo
      despejado (Haurwitz corregido por altitud).
    </p>
    <h4>Limitaciones</h4>
    <p>
      La estimación de nubosidad por radiación <b>no es una medición directa</b>: responde también a
      polvo, humo, aerosoles, sombra y suciedad del sensor, y solo es calculable con elevación solar
      ≥ 10°. Sin capa satelital, el estado del cielo no puede confirmarse regionalmente.
      La ETₒ del pronóstico procede del modelo y puede diferir de la medida en estación.
    </p>
    <h4>Índices agroclimáticos</h4>
    <p>
      Los cuatro índices del tablero se derivan de datos observados y pronosticados.
      Se publican con su fórmula para que cualquier valor pueda reproducirse y auditarse:
    </p>
    <table class="tabla-formulas">
      <thead><tr><th>Índice</th><th>Fórmula</th><th>Procedencia de las entradas</th></tr></thead>
      <tbody>${indices.map(i => `<tr>
        <td><b>${i.clave === 'ICA' ? 'ICA-005' : i.clave}</b><br><small>${i.nombre}</small></td>
        <td><code>${i.formula}</code></td>
        <td><small>${i.procedencia}</small></td>
      </tr>`).join('')}</tbody>
    </table>
    <p class="pred-nota">
      Escala 0-100 en todos los casos. En IRO un valor <b>alto significa más riesgo</b>;
      en ICA-005, IDR e IHE el valor alto indica mayor magnitud de lo que cada uno mide.
      Un índice sin entradas suficientes vale <b>S/D</b> y no se computa como cero.
    </p>

    <h4>Frescura del corte</h4>
    <p>
      Edad de las lecturas al generar este informe: ${edadesTxt}.
      ${edadMax != null && edadMax > 60
        ? '<b>Aviso:</b> alguna estación supera los 60 min sin reportar. Para un corte más preciso, '
          + 'pulsar <b>«Actualizar datos»</b> en el módulo Clima antes de emitir el informe.'
        : 'Todas las lecturas están dentro de la ventana de validez.'}
    </p>
    <h4>Versión del algoritmo</h4>
    <p><code>${ALGORITMO_VERSION}</code> · Corte generado: ${hoy}</p>
  </div>

  <div class="foot">
    <span>
      <b>Centro de Inteligencia Agroclimática · SICA-005</b><br>
      Estaciones Davis/WeatherLink · ETₒ FAO-56 Penman-Monteith · nubosidad por modelo horario.<br>
      Documento generado automáticamente; la condición del cielo y la precipitación se
      reportan como variables independientes.
    </span>
    <span class="foot-sello">
      SRL Unidad Conchos<br>
      <em>Distrito de Riego 005 · Delicias, Chih.</em><br>
      <em>${ALGORITMO_VERSION.split(' (')[0]}</em>
    </span>
  </div>
</div></body></html>`;
}

/** Genera el informe técnico y lo entrega como archivo HTML autónomo. */
export async function exportClimaReport(ests: EstacionConLectura[]): Promise<void> {
    const html = await buildHTML(ests);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const date = getTodayString();
    await guardaOComparte(blob, `informe-clima-conchos-${date}.html`, 'text/html');
}
