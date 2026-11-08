// ═══════════════════════════════════════════════════════════════════════════
// Capas de REFERENCIA de la cuenca del Conchos (orientación de los planos e informes) — carga + SVG puro
// ---------------------------------------------------------------------------
// El plano de una variable (isoyetas, temperatura…) por sí solo es difícil de ubicar: solo se ve el contorno de la cuenca. Estas capas se activan
// o no según la necesidad: municipios, ríos, subcuencas, poblaciones, carreteras, módulos SRL y presas. Son contexto en tinta tenue: nunca compiten
// con la variable (límites finos, baja opacidad) y el estado nunca va solo en color (ríos = línea continua azul; carreteras = discontinua;
// subcuencas = punteada; municipios = fina continua gris). Todo sale de GeoJSON estático dentro de la app (public/geo/ref_*.geojson, generado
// por scripts/capas_referencia.mjs): sin mapas de terceros en línea. Si una capa no carga, simplemente no se dibuja (nunca se inventa).
// ═══════════════════════════════════════════════════════════════════════════
import { MODULOS_SRL } from './geoDistrito';
import { anilloAPath, type ProyectorMapa } from './geoCuenca';
import { META_PRESAS } from './presasCuencaMeta';

export type CapaId = 'municipios' | 'rios' | 'subcuencas' | 'poblaciones' | 'carreteras' | 'srl' | 'presas';

export const CAPAS_INFO: { id: CapaId; titulo: string; ayuda: string }[] = [
    { id: 'rios', titulo: 'Ríos y arroyos', ayuda: 'Red de ríos principales y rótulos de Conchos, San Pedro y Florido' },
    { id: 'municipios', titulo: 'Municipios', ayuda: 'Límites municipales (Chihuahua y Durango) con su nombre' },
    { id: 'presas', titulo: 'Presas', ayuda: 'Las presas de la cuenca; La Boquilla con su vaso observado' },
    { id: 'srl', titulo: 'SRL Conchos', ayuda: 'Los 6 módulos del distrito de riego' },
    { id: 'subcuencas', titulo: 'Subcuencas', ayuda: 'Las 28 subcuencas hidrológicas de la RH24' },
    { id: 'poblaciones', titulo: 'Poblaciones', ayuda: 'Cabeceras municipales' },
    { id: 'carreteras', titulo: 'Carreteras', ayuda: 'Carreteras federales y estatales' },
];
export const CAPAS_PANTALLA: CapaId[] = ['rios', 'presas'];
export const CAPAS_INFORME: CapaId[] = ['rios', 'municipios', 'presas'];
export const todasLasCapas = (): CapaId[] => CAPAS_INFO.map((c) => c.id);

// ── Tipos mínimos de GeoJSON (solo lo que usamos)
type Par = [number, number];
interface Feat<P> { properties: P; geometry: { type: string; coordinates: unknown } }
interface FC<P> { features: Feat<P>[] }
type PMuni = { n: string; e: string; lon?: number; lat?: number; km2?: number };
type PPobl = { n: string; e: string };
type PRio = { o: number };
type PCarr = { r?: string; k?: string };
type PPresa = { nombre: string; fuente: string; area_km2?: number };
export interface RotuloRio { n: string; lon: number; lat: number; ang: number }

export interface DatosCapas {
    municipios?: FC<PMuni>;
    poblaciones?: FC<PPobl>;
    rios?: FC<PRio>;
    rotulosRios?: RotuloRio[];
    carreteras?: FC<PCarr>;
    subcuencas?: FC<Record<string, unknown>>;
    vasos?: FC<PPresa>;
}

const URL_CAPA: Record<keyof DatosCapas, string> = {
    municipios: '/geo/ref_municipios.geojson', poblaciones: '/geo/ref_poblaciones.geojson', rios: '/geo/ref_rios.geojson',
    rotulosRios: '/geo/ref_rios_rotulos.json', carreteras: '/geo/ref_carreteras.geojson', subcuencas: '/geo/cuenca_conchos_subcuencas.geojson',
    vasos: '/geo/ref_presas_vasos.geojson',
};
/** Qué archivos necesita cada capa. */
const ARCHIVOS: Record<CapaId, (keyof DatosCapas)[]> = {
    municipios: ['municipios'], poblaciones: ['poblaciones'], rios: ['rios', 'rotulosRios'], carreteras: ['carreteras'], subcuencas: ['subcuencas'],
    srl: [], presas: ['vasos'],
};

const cache = new Map<keyof DatosCapas, Promise<unknown | null>>();
function cargaArchivo(k: keyof DatosCapas): Promise<unknown | null> {
    let p = cache.get(k);
    if (!p) {
        p = fetch(URL_CAPA[k]).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
            if (j == null) cache.delete(k); // un fallo no se queda en caché: se reintenta la próxima vez
            return j;
        });
        cache.set(k, p);
    }
    return p;
}

/** Descarga (con caché) los archivos de las capas pedidas. Una capa que no carga queda ausente: el dibujo la omite sin fallar. */
export async function cargarCapas(ids: CapaId[]): Promise<DatosCapas> {
    const claves = [...new Set(ids.flatMap((i) => ARCHIVOS[i]))];
    const out: Record<string, unknown> = {};
    await Promise.all(claves.map(async (k) => { const j = await cargaArchivo(k); if (j != null) out[k] = k === 'rotulosRios' ? (j as { rotulos: RotuloRio[] }).rotulos : j; }));
    return out as DatosCapas;
}

// ── Estilo por tema
interface EstiloCapas {
    muni: string; muniTxt: string; rio: string; rioTxt: string; carr: string; sub: string; srl: string; srlRelleno: string;
    presa: string; presaBorde: string; punto: string; txt: string; halo: string;
}
const ESTILO: Record<'pantalla' | 'papel', EstiloCapas> = {
    pantalla: { muni: 'rgba(180,194,212,0.38)', muniTxt: '#b4c2d4', rio: '#6bbcf0', rioTxt: '#9bd3f7', carr: 'rgba(232,205,130,0.6)', sub: 'rgba(150,170,200,0.55)', srl: '#7dd3a8', srlRelleno: 'rgba(125,211,168,0.12)', presa: 'rgba(63,178,243,0.5)', presaBorde: '#e8eef6', punto: '#e8eef6', txt: '#e8eef6', halo: '#061532' },
    papel: { muni: 'rgba(110,120,135,0.5)', muniTxt: '#4a5565', rio: '#2f6fb0', rioTxt: '#1d4f86', carr: 'rgba(146,112,30,0.75)', sub: 'rgba(90,105,125,0.65)', srl: '#1f7a52', srlRelleno: 'rgba(31,122,82,0.10)', presa: 'rgba(11,49,112,0.55)', presaBorde: '#0B3170', punto: '#0E1B2C', txt: '#0E1B2C', halo: '#ffffff' },
};

export interface OpcionesCapasSvg {
    px: number; tema: 'pantalla' | 'papel'; ancho: number; alto: number;
    /** Cajas [x, y de la línea base, ancho, alto] ya ocupadas (cifras de las estaciones): los rótulos de las capas las esquivan. */
    reservados?: [number, number, number, number][];
}
export interface CapasSvg {
    /** Líneas y rellenos: se dibujan RECORTADOS a la cuenca, debajo de los rótulos de isolíneas. */
    bajo: string;
    /** Rótulos, puntos de poblaciones y presas: encima de las isolíneas, debajo de las estaciones. */
    alto: string;
    /** Entradas de leyenda (glifo SVG de 18×10 y texto) de las capas realmente dibujadas. */
    leyenda: { glifo: string; texto: string }[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (x: number) => x.toFixed(1);
const anillos = (g: Feat<unknown>['geometry']): Par[][] => {
    if (g.type === 'Polygon') return g.coordinates as Par[][];
    if (g.type === 'MultiPolygon') return (g.coordinates as Par[][][]).flat();
    return [];
};
const lineas = (g: Feat<unknown>['geometry']): Par[][] => (g.type === 'LineString' ? [g.coordinates as Par[]] : g.type === 'MultiLineString' ? (g.coordinates as Par[][]) : []);
const trazo = (l: Par[], p: ProyectorMapa) => `M${l.map(([x, y]) => `${n1(p.x(x))},${n1(p.y(y))}`).join('L')}`;

/** Registro de cajas ocupadas por rótulos: evita que dos nombres se encimen (los de mayor prioridad se colocan primero). */
function registroColision(ancho: number, alto: number, previas: [number, number, number, number][] = []) {
    const cajas: [number, number, number, number][] = previas.map(([x, y, w, h]) => [x, y - h, x + w, y]);
    return (x: number, y: number, w: number, h: number): boolean => {
        const c: [number, number, number, number] = [x, y - h, x + w, y];
        if (c[0] < 2 || c[2] > ancho - 2 || c[1] < 2 || c[3] > alto - 2) return false;
        if (cajas.some((b) => c[0] < b[2] && c[2] > b[0] && c[1] < b[3] && c[3] > b[1])) return false;
        cajas.push(c);
        return true;
    };
}

/**
 * SVG de las capas pedidas, ya proyectado. Funciones puras: `datos` viene de cargarCapas (o de los archivos en las pruebas).
 * Capas sin datos cargados se omiten. `ids` define QUÉ se dibuja; el orden de apilado es fijo (de lo más amplio a lo más puntual).
 */
export function capasSvg(datos: DatosCapas, ids: CapaId[], p: ProyectorMapa, op: OpcionesCapasSvg): CapasSvg {
    const E = ESTILO[op.tema], px = op.px, s = px / 12;
    // en pantalla los rótulos de las capas miden lo mismo que el resto del texto (≥ 12 px reales); en papel son algo menores para no recargar
    const kt = op.tema === 'pantalla' ? 1 : 0.8;
    const quiere = (c: CapaId) => ids.includes(c);
    const bajo: string[] = [], alto: string[] = [], leyenda: CapasSvg['leyenda'] = [];
    const libre = registroColision(op.ancho, op.alto, op.reservados);
    const glifoLinea = (stroke: string, w: number, dash?: string) => `<path d="M1,5H17" stroke="${stroke}" stroke-width="${w}" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

    if (quiere('subcuencas') && datos.subcuencas) {
        const d = datos.subcuencas.features.flatMap((f) => anillos(f.geometry)).map((r) => `${trazo(r, p)}Z`).join('');
        bajo.push(`<path d="${d}" fill="none" stroke="${E.sub}" stroke-width="${n1(0.9 * s)}" stroke-dasharray="${n1(2 * s)} ${n1(3 * s)}" stroke-linejoin="round"/>`);
        leyenda.push({ glifo: glifoLinea(E.sub, 1.2, '2 3'), texto: 'subcuencas' });
    }
    if (quiere('municipios') && datos.municipios) {
        const d = datos.municipios.features.flatMap((f) => anillos(f.geometry)).map((r) => `${trazo(r, p)}Z`).join('');
        bajo.push(`<path d="${d}" fill="none" stroke="${E.muni}" stroke-width="${n1(0.8 * s)}" stroke-linejoin="round"/>`);
        leyenda.push({ glifo: glifoLinea(E.muni, 1.2), texto: 'límite municipal' });
    }
    if (quiere('carreteras') && datos.carreteras) {
        const d = datos.carreteras.features.flatMap((f) => lineas(f.geometry)).map((l) => trazo(l, p)).join('');
        bajo.push(`<path d="${d}" fill="none" stroke="${E.carr}" stroke-width="${n1(1.1 * s)}" stroke-dasharray="${n1(5 * s)} ${n1(2.5 * s)}" stroke-linecap="round"/>`);
        leyenda.push({ glifo: glifoLinea(E.carr, 1.4, '4 2'), texto: 'carretera' });
    }
    if (quiere('rios') && datos.rios) {
        // un trazo por orden de Strahler: el grosor jerarquiza el cauce principal sobre sus afluentes
        const porOrden = new Map<number, string[]>();
        for (const f of datos.rios.features) { const o = Math.min(7, f.properties.o); porOrden.set(o, [...(porOrden.get(o) ?? []), ...lineas(f.geometry).map((l) => trazo(l, p))]); }
        for (const [o, ds] of [...porOrden.entries()].sort((a, b) => a[0] - b[0])) {
            bajo.push(`<path d="${ds.join('')}" fill="none" stroke="${E.rio}" stroke-width="${n1((0.5 + (o - 4) * 0.55) * s)}" stroke-opacity="0.9" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
        leyenda.push({ glifo: glifoLinea(E.rio, 2), texto: 'río' });
    }
    if (quiere('srl')) {
        const d = Object.values(MODULOS_SRL).map((r) => `${anilloAPath(r as Par[], p)}`).join(' ');
        bajo.push(`<path d="${d}" fill="${E.srlRelleno}" stroke="${E.srl}" stroke-width="${n1(1.3 * s)}" stroke-linejoin="round"/>`);
        leyenda.push({ glifo: `<rect x="2" y="1" width="14" height="8" rx="1.5" fill="${E.srlRelleno}" stroke="${E.srl}" stroke-width="1.4"/>`, texto: 'módulos SRL' });
    }
    if (quiere('presas') && datos.vasos) {
        for (const f of datos.vasos.features) {
            const d = anillos(f.geometry).map((r) => `${anilloAPath(r, p)}`).join(' ');
            bajo.push(`<path d="${d}" fill="${E.presa}" stroke="${E.presaBorde}" stroke-width="${n1(1 * s)}" stroke-linejoin="round"><title>${esc(f.properties.nombre)}: vaso observado (Sentinel-2)</title></path>`);
        }
    }

    // ── rótulos y puntos (prioridad de colocación: presas → ríos → poblaciones → municipios)
    const tx = (x: number, y: number, t: string, o: { size: number; fill: string; anchor?: string; peso?: number; italica?: boolean; rot?: number; op?: number }) =>
        `<text x="${n1(x)}" y="${n1(y)}" font-size="${n1(o.size)}" fill="${o.fill}"${o.peso ? ` font-weight="${o.peso}"` : ''}${o.italica ? ' font-style="italic"' : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.op ? ` fill-opacity="${o.op}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${n1(x)} ${n1(y)})"` : ''} stroke="${E.halo}" stroke-width="${n1(o.size * 0.3)}" paint-order="stroke">${esc(t)}</text>`;
    const ancho = (t: string, size: number) => t.length * size * 0.56;

    if (quiere('presas')) {
        const pts = Object.values(META_PRESAS).filter((m) => m.coordenadas);
        let hay = false;
        for (const m of pts) {
            const x = p.x(m.coordenadas!.lon), y = p.y(m.coordenadas!.lat);
            const r = 5 * s;
            alto.push(`<path d="M${n1(x)},${n1(y - r)}L${n1(x + r)},${n1(y + r * 0.8)}L${n1(x - r)},${n1(y + r * 0.8)}Z" fill="${E.presaBorde}" stroke="${E.halo}" stroke-width="${n1(1.2 * s)}"><title>${esc(m.etiqueta)}</title></path>`);
            const t = m.nombre, w = ancho(t, px * (kt + 0.05));
            if (libre(x + r + 2, y + 3 * s, w, px)) alto.push(tx(x + r + 2, y + 3 * s, t, { size: px * (kt + 0.05), fill: E.txt, peso: 700 }));
            hay = true;
        }
        if (hay) leyenda.push({ glifo: `<path d="M9,0.5L14,9L4,9Z" fill="${E.presaBorde}" stroke="${E.halo}" stroke-width="1"/>`, texto: 'presa' });
    }
    if (quiere('rios') && datos.rotulosRios) {
        for (const r of datos.rotulosRios) {
            const x = p.x(r.lon), y = p.y(r.lat), w = ancho(r.n, px * (kt + 0.05));
            if (libre(x - w / 2, y - 2, w, px * 0.9)) alto.push(tx(x, y - 3 * s, r.n, { size: px * (kt + 0.05), fill: E.rioTxt, anchor: 'middle', italica: true, peso: 600, rot: r.ang }));
        }
    }
    if (quiere('poblaciones') && datos.poblaciones) {
        for (const f of datos.poblaciones.features) {
            const [lon, lat] = f.geometry.coordinates as Par;
            const x = p.x(lon), y = p.y(lat), t = f.properties.n, w = ancho(t, px * kt);
            alto.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(2 * s)}" fill="${E.punto}" stroke="${E.halo}" stroke-width="${n1(0.8 * s)}"><title>${esc(t)}</title></circle>`);
            if (libre(x + 4 * s, y + 3 * s, w, px * 0.9)) alto.push(tx(x + 4 * s, y + 3 * s, t, { size: px * kt, fill: E.txt }));
        }
        leyenda.push({ glifo: `<circle cx="9" cy="5" r="2.4" fill="${E.punto}" stroke="${E.halo}" stroke-width="0.8"/>`, texto: 'cabecera municipal' });
    }
    if (quiere('municipios') && datos.municipios) {
        // los municipios con más superficie dentro de la cuenca se rotulan primero; los demás solo si caben
        const ordenados = datos.municipios.features.filter((f) => f.properties.lon != null && f.properties.lat != null).sort((a, b) => (b.properties.km2 ?? 0) - (a.properties.km2 ?? 0));
        for (const f of ordenados) {
            const x = p.x(f.properties.lon as number), y = p.y(f.properties.lat as number), t = f.properties.n, w = ancho(t, px * kt);
            if (libre(x - w / 2, y, w, px * 0.9)) alto.push(tx(x, y, t, { size: px * kt, fill: E.muniTxt, anchor: 'middle', op: 0.9 }));
        }
    }
    return { bajo: bajo.join(''), alto: alto.join(''), leyenda };
}
