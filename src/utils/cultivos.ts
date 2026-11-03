/**
 * cultivos — catálogo ÚNICO de identidad visual de cada cultivo (color + ícono + trama) para el panel «Consumo por cultivo»,
 * sus gráficas, las leyendas y el informe PDF. Ningún otro archivo escribe un color ni un ícono de cultivo a mano.
 *
 * Regla de diseño: el color NUNCA es el único portador. Cada cultivo va siempre con su ícono y su nombre escrito; en el informe
 * (que se imprime en blanco y negro) además lleva una trama distintiva. Los colores son semánticos (alfalfa verde, nogal café,
 * chile rojo…) para reconocerse de un vistazo; por eso no son una paleta «optimizada» y varios quedan fuera de la banda de
 * luminosidad/croma del validador de dataviz (grises, arenas y amarillos son claros por naturaleza).
 *
 * Contrastes MEDIDOS (WCAG, marca contra la superficie de las tarjetas; validador dataviz `validate_palette.js`):
 *   oscuro  = contra #101a2e (la tarjeta real es más oscura, así que son cifras conservadoras); mínimo exigido para marcas 3:1.
 *   claro   = contra #ffffff.
 *   Cultivo     oscuro            claro
 *   Alfalfa     #4FB84A  6.9:1    #2E7D32  5.1:1
 *   Nogal       #B5702F  4.4:1    #7A4A1C  7.4:1
 *   Maíz        #F2C230 10.4:1    #A87F00  3.7:1
 *   Chile       #E5484D  4.4:1    #C62828  5.6:1
 *   Cacahuate   #DCC7A0 10.5:1    #8A6D3B  4.8:1
 *   Varios      #8B97A8  5.9:1    #5B6573  5.9:1
 *   Trigo       #C98A12  5.9:1    #946200  5.2:1   (ámbar-ocre: ya no se confunde con el amarillo de Maíz)
 *   Cebolla     #A778E0  5.3:1    #6A3FB5  7.0:1
 *   Algodón     #A9C4E8  9.7:1    #4A6FA5  5.1:1
 *   Sandía      #F06C9B  6.1:1    #C2185B  5.9:1
 *   Sorgo       #9C7A2E  4.3:1    #7A5C14  6.2:1
 *   Camote      #F2802E  6.5:1    #C2570C  4.5:1
 *   Avena       #B7B96A  8.4:1    #74772A  4.8:1   (verde-oliva: ya no se confunde con la arena de Cacahuate)
 *   Otros       #5570A0  3.5:1    #34496B  9.1:1   (gris-azulado oscuro, trama de onda; «Varios» es el gris claro #8B97A8)
 * Distinguibilidad (validador, fijo el ORDEN del catálogo, pares vecinos): los 6 cultivos que concentran el agua (Alfalfa, Nogal,
 * Maíz, Chile, Cacahuate, Varios) pasan separación para daltonismo (ΔE ≥ 8.2) y visión normal (ΔE ≥ 18.6). Los 7 cultivos chicos
 * quedan en banda de piso (Camote–Avena ΔE ≈ 14.5, Sorgo–Camote ΔE ≈ 7 en protanopía): se distinguen por ícono + nombre +
 * posición, nunca por color solo. Lo que el validador marca FAIL (banda de luminosidad y croma) es inherente a un color
 * semántico (gris «Varios», arena «Cacahuate», amarillo «Maíz») y se compensa con ícono, etiqueta y trama.
 */

export type TramaCultivo = 'liso' | 'diag' | 'diag-inv' | 'puntos' | 'cruz' | 'horiz' | 'vert' | 'onda';

export interface InfoCultivo {
    /** Clave normalizada: minúsculas y sin acentos («maiz»). */
    clave: string;
    /** Nombre para mostrar («Maíz»). */
    nombre: string;
    /** Color de identificación sobre fondo oscuro. */
    color: string;
    /** Variante para fondo claro (tarjetas claras, papel del informe). */
    colorClaro: string;
    /** Marcas internas del ícono (viewBox 24, trazo currentColor). */
    icono: string;
    /** Trama distintiva para impresión en blanco y negro. */
    trama: TramaCultivo;
    /** true = no es un cultivo del catálogo (cultivo nuevo u «Otros»). */
    fallback?: boolean;
}


// Íconos propios: trazo uniforme (2), puntas redondeadas, 1 idea por cultivo, legibles a 16-24 px.
const ICONOS: Record<string, string> = {
    // trébol de tres hojas con tallo
    alfalfa: '<ellipse cx="12" cy="6.4" rx="2.9" ry="3.7"/><ellipse cx="7" cy="11.4" rx="2.9" ry="3.7" transform="rotate(-62 7 11.4)"/><ellipse cx="17" cy="11.4" rx="2.9" ry="3.7" transform="rotate(62 17 11.4)"/><path d="M12 11V21"/>',
    // nuez con costura central
    nogal: '<path d="M12 3.2c4.6 0 7.6 3.6 7.6 8.2 0 5-3.4 9.4-7.6 9.4s-7.6-4.4-7.6-9.4C4.4 6.800 7.400 3.200 12 3.200z"/><path d="M12 3.200c-2.600 5-2.600 12.600 0 17.600"/><path d="M12 3.200c2.600 5 2.600 12.600 0 17.600"/>',
    // mazorca con hojas
    maiz: '<path d="M12 2.500c3.200 2 4.200 6 3.500 10.500-.5 3.200-1.800 5-3.500 5s-3-1.800-3.500-5C7.800 8.500 8.800 4.500 12 2.500z"/><path d="M12 5V16M9.200 8.500h5.600M8.800 12h6.400"/><path d="M12 21.500c-4.500-.8-6.500-4-6.500-8.500M12 21.500c4.500-.8 6.500-4 6.500-8.500"/>',
    // vaina de chile curva con rabito
    chile: '<path d="M8 8.500c4.500-1.800 9.500.8 10.500 6.500.6 3.500-.8 5.500-2.800 4.800C11.800 18.500 9 14 8 8.500z"/><path d="M8 8.500c-1.800-.8-2.400-2.800-1.200-4.800M8 8.500l-2 .5"/>',
    // cacahuate: vaina con cintura y granitos
    cacahuate: '<path d="M12 2.500c3.200 0 4.500 2.500 3.800 4.900-.5 1.600-1.600 2.600-1.600 4.100s1.300 2.500 1.600 4.500c.5 3-1.300 5.500-3.800 5.500s-4.300-2.500-3.800-5.500c.3-2 1.600-3 1.600-4.500S8.700 9 8.200 7.400C7.500 5 8.800 2.500 12 2.500z"/><path d="M11 6h.01M13.200 7.200h.01M10.600 17h.01M13 16.500h.01"/>',
    // cuatro semillas: mezcla de cultivos
    varios: '<circle cx="7.500" cy="7.500" r="3.200"/><circle cx="16.500" cy="7.500" r="3.200"/><circle cx="7.500" cy="16.500" r="3.200"/><circle cx="16.500" cy="16.500" r="3.200"/>',
    // espiga: granos en pares sobre el tallo
    trigo: '<path d="M12 22V8"/><path d="M12 8c-1.300-1.600-1.300-4 0-5.600 1.300 1.600 1.300 4 0 5.600z"/><path d="M12 12.500c-2.800.4-4.600-1.200-4.800-3.400 2.600-.2 4.400 1.200 4.800 3.400zM12 12.500c2.800.4 4.600-1.200 4.800-3.400-2.600-.2-4.400 1.200-4.800 3.400z"/><path d="M12 17.500c-2.800.4-4.600-1.200-4.800-3.400 2.600-.2 4.400 1.200 4.800 3.400zM12 17.500c2.800.4 4.600-1.200 4.800-3.400-2.600-.2-4.400 1.200-4.800 3.400z"/>',
    // bulbo con capas y raicilla
    cebolla: '<path d="M12 2.800c.5 3.200 6.500 5 6.500 10.700 0 4.200-3 7.200-6.500 7.200s-6.500-3-6.500-7.200C5.500 7.800 11.500 6 12 2.800z"/><path d="M12 6.500c-2.600 3.500-3 9.500 0 14.200M12 6.500c2.600 3.500 3 9.500 0 14.200"/><path d="M10.500 22.200h3"/>',
    // cápsula de algodón abierta: tres lóbulos de fibra (rellenos) sobre tres brácteas puntiagudas
    algodon: '<circle cx="12" cy="7" r="3.200" fill="currentColor"/><circle cx="7.200" cy="11.500" r="3" fill="currentColor"/><circle cx="16.800" cy="11.500" r="3" fill="currentColor"/><path d="M5.500 15.500L4 21l5-2.800 3 3.300 3-3.300 5 2.800-1.500-5.500"/>',
    // rebanada de sandía con semillas
    sandia: '<path d="M3 9h18a9 9 0 0 1-18 0z"/><path d="M6 9a6 6 0 0 0 12 0"/><path d="M9.500 12.500h.01M12 14.500h.01M14.500 12.500h.01"/>',
    // espiga de sorgo: panoja densa con granos
    sorgo: '<ellipse cx="12" cy="8" rx="4" ry="5.500"/><path d="M12 13.500V22M12 18.500c3-.8 5.200-2.600 6.200-5"/><path d="M10 5.500h.01M14 5.500h.01M12 8h.01M10 10.500h.01M14 10.500h.01"/>',
    // tubérculo alargado con raicillas
    camote: '<path d="M4.500 17.500C4 12 9 7.500 14.500 6.200c3.500-.8 5.500 1.400 4.500 4.500-1.500 4.600-7 9.800-11.500 9C6 19.500 4.700 18.800 4.500 17.500z"/><path d="M3 20.500l1.800-2.400M10 12q1 2 0 4M14.500 10q.5 2-1 4"/>',
    // panoja de avena con espiguillas colgantes
    avena: '<path d="M12 22V8"/><ellipse cx="12" cy="4.600" rx="1.800" ry="2.700"/><path d="M12 11.500Q8.200 11 7.600 14.200"/><ellipse cx="7.300" cy="16.400" rx="1.900" ry="2.800"/><path d="M12 11.500q3.800-.5 4.400 2.700"/><ellipse cx="16.700" cy="16.400" rx="1.900" ry="2.800"/>',
    // fallback: hoja genérica (cultivo nuevo no catalogado)
    hoja: '<path d="M5 19c-.5-8 4-14 14.500-14.500C20 15 14 19.500 5 19z"/><path d="M5 19c3-4.500 6-7.500 10-10"/>',
    // «Otros»: tres puntos dentro de un círculo
    otros: '<circle cx="12" cy="12" r="9"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
};

const mk = (nombre: string, color: string, colorClaro: string, trama: TramaCultivo): InfoCultivo =>
    ({ clave: claveCultivo(nombre), nombre, color, colorClaro, icono: ICONOS[claveCultivo(nombre)], trama });

/** Quita acentos, pasa a minúsculas y recorta espacios y signos sobrantes: «  Maíz» → «maiz». */
export function claveCultivo(nombre: string | null | undefined): string {
    return String(nombre ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Catálogo en ORDEN FIJO (es también el orden de apilado de las gráficas): los vecinos se eligen para que dos colores parecidos
 * no queden juntos. El color sigue al cultivo, nunca a su lugar en el ranking.
 */
export const CATALOGO_CULTIVOS: readonly InfoCultivo[] = [
    mk('Alfalfa', '#4FB84A', '#2E7D32', 'liso'),
    mk('Nogal', '#B5702F', '#7A4A1C', 'puntos'),
    mk('Maíz', '#F2C230', '#A87F00', 'diag'),
    mk('Chile', '#E5484D', '#C62828', 'cruz'),
    mk('Cacahuate', '#DCC7A0', '#8A6D3B', 'diag-inv'),
    mk('Varios', '#8B97A8', '#5B6573', 'horiz'),
    mk('Trigo', '#C98A12', '#946200', 'vert'),
    mk('Cebolla', '#A778E0', '#6A3FB5', 'puntos'),
    mk('Algodón', '#A9C4E8', '#4A6FA5', 'horiz'),
    mk('Sandía', '#F06C9B', '#C2185B', 'diag'),
    mk('Sorgo', '#9C7A2E', '#7A5C14', 'cruz'),
    mk('Camote', '#F2802E', '#C2570C', 'diag-inv'),
    mk('Avena', '#B7B96A', '#74772A', 'vert'),
];

/**
 * «Otros»: resto de cultivos agrupado en una gráfica. Gris-azulado oscuro (claramente más hundido que el gris claro de «Varios») con
 * trama de onda propia (ningún cultivo la usa) y borde punteado en la web; a propósito sin identidad de cultivo.
 */
export const CULTIVO_OTROS: InfoCultivo = { clave: 'otros', nombre: 'Otros', color: '#5570A0', colorClaro: '#34496B', icono: ICONOS.otros, trama: 'onda', fallback: true };

const POR_CLAVE = new Map(CATALOGO_CULTIVOS.map(c => [c.clave, c]));
/** Alias de la fuente: variantes de escritura que llegan de ACUM_INF y mapean a un cultivo del catálogo. */
const ALIAS: Record<string, string> = { 'nuez': 'nogal', 'nuez pecanera': 'nogal', 'pecan': 'nogal', 'maiz grano': 'maiz', 'maiz forrajero': 'maiz', 'chile jalapeno': 'chile', 'chile chilaca': 'chile', 'cacahuete': 'cacahuate', 'mani': 'cacahuate', 'varios cultivos': 'varios', 'otros cultivos': 'varios' };

/** «Maíz/Frijol», «Chile - Cebolla», «Alfalfa y Maíz»: la fuente junta varios cultivos en un renglón. */
export const esNombreCompuesto = (nombre: string | null | undefined): boolean => /[/\-]|\s[yY]\s/.test(String(nombre ?? ''));

/**
 * Identidad de un cultivo por nombre. Un cultivo que no está en el catálogo (nuevo en la fuente) recibe un color neutro estable
 * (derivado del nombre, para que no cambie entre vistas) y el ícono de hoja: nunca se pierde ni se pinta como otro cultivo.
 */
export function infoCultivo(nombre: string | null | undefined): InfoCultivo {
    const clave = claveCultivo(nombre);
    // Nombre compuesto («Maíz/Frijol», «Chile-Cebolla», «Alfalfa y Maíz»): no es ninguno de sus cultivos; se agrupa en «Otros» en vez de pintarse como el primero.
    if (esNombreCompuesto(nombre)) return CULTIVO_OTROS;
    const c = ALIAS[clave] ?? clave;
    if (c === 'otros' || c.startsWith('otros ')) return CULTIVO_OTROS;
    const hit = POR_CLAVE.get(c) ?? CATALOGO_CULTIVOS.find(x => c.startsWith(`${x.clave} `));
    if (hit) return hit;
    // Cultivo nuevo: tono estable por nombre, con baja saturación para no hacerse pasar por uno del catálogo.
    let h = 0;
    for (const ch of clave) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return { clave, nombre: String(nombre ?? '').trim() || 'Sin nombre', color: `hsl(${h} 38% 68%)`, colorClaro: `hsl(${h} 40% 34%)`, icono: ICONOS.hoja, trama: 'horiz', fallback: true };
}

export const nombreCultivo = (nombre: string | null | undefined): string => infoCultivo(nombre).nombre;
/** Cultivos que el catálogo reconoce de una lista (sin los «otros» ni los nuevos). */
export const esCultivoCatalogado = (nombre: string): boolean => !infoCultivo(nombre).fallback;

const INK_OSCURA = '#0b1220', INK_CLARA = '#ffffff';
function luminancia(hex: string): number | null {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return null;
    const c = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** Tinta (oscura o blanca) con más contraste sobre el color dado. Colores no hexadecimales (cultivo nuevo): se decide por su luminosidad HSL. */
export function tintaSobre(color: string): string {
    const L = luminancia(color);
    if (L == null) { const l = /(\d+)%\s*\)$/.exec(color); return l && Number(l[1]) < 50 ? INK_CLARA : INK_OSCURA; }
    const conOscura = (L + 0.05) / (luminancia(INK_OSCURA)! + 0.05), conClara = 1.05 / (L + 0.05);
    return conOscura >= conClara ? INK_OSCURA : INK_CLARA;
}

// ───────────────────────── Salidas para HTML/SVG puro (informe PDF) ─────────────────────────

const ATR_ICONO = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** `<svg>` independiente del ícono, para insertar en HTML. `color` va en `currentColor`. aria-hidden: el nombre siempre va escrito al lado. */
export function iconoCultivoSvg(nombre: string | null | undefined, tam = 14, color = 'currentColor'): string {
    const i = infoCultivo(nombre);
    return `<svg class="ico-cul" viewBox="0 0 24 24" width="${tam}" height="${tam}" ${ATR_ICONO} style="color:${color};vertical-align:-2px" aria-hidden="true" focusable="false">${i.icono}</svg>`;
}

/** Ícono como `<g>` para dibujar dentro de otro SVG, con la esquina superior izquierda en (x, y) y lado `tam`. */
export function iconoCultivoG(nombre: string | null | undefined, x: number, y: number, tam: number, color: string): string {
    const k = tam / 24;
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(3)})" color="${color}" ${ATR_ICONO} aria-hidden="true">${infoCultivo(nombre).icono}</g>`;
}

/** Definición `<pattern>` de una trama (para leer el informe en blanco y negro). Se pinta sobre el color del cultivo. */
export function patronTrama(id: string, trama: TramaCultivo, tinta: string): string {
    const l = (d: string, w = 1.1) => `<path d="${d}" stroke="${tinta}" stroke-width="${w}" fill="none"/>`;
    const cuerpo: Record<TramaCultivo, string> = {
        liso: '',
        diag: l('M-1 7L7 -1M-1 1L1 -1M5 9L9 5', 1.2),
        'diag-inv': l('M-1 1L7 9M-1 7L1 9M5 -1L9 3', 1.2),
        puntos: `<circle cx="2" cy="2" r="1" fill="${tinta}"/><circle cx="6" cy="6" r="1" fill="${tinta}"/>`,
        cruz: l('M4 0V8M0 4H8', 1),
        horiz: l('M0 2H8M0 6H8', 1),
        vert: l('M2 0V8M6 0V8', 1),
        onda: l('M0 2Q2 -.5 4 2T8 2M0 6Q2 3.500 4 6T8 6', 1),
    };
    return `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse">${cuerpo[trama]}</pattern>`;
}

/** Mismo fondo como CSS (para la web): trama sobre el color. Sin trama = color liso. */
export function fondoTramaCss(trama: TramaCultivo, color: string, tinta = 'rgba(0,0,0,.34)'): string {
    const rep = (ang: number) => `repeating-linear-gradient(${ang}deg, ${tinta} 0 1.5px, transparent 1.5px 6px), ${color}`;
    switch (trama) {
        case 'diag': return rep(45);
        case 'diag-inv': return rep(135);
        case 'horiz': return rep(0);
        case 'vert': return rep(90);
        case 'cruz': return `repeating-linear-gradient(0deg, ${tinta} 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, ${tinta} 0 1px, transparent 1px 6px), ${color}`;
        case 'onda': {
            // SVG codificado entero (sin comillas) para poder ir dentro de un atributo style="…" o de un style de React.
            const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="M0 2Q2 -.5 4 2T8 2M0 6Q2 3.5 4 6T8 6" stroke="${tinta}" stroke-width="1.1" fill="none"/></svg>`).replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27');
            return `url(data:image/svg+xml,${svg}) 0 0 / 8px 8px, ${color}`;
        }
        case 'puntos': return `radial-gradient(${tinta} 1px, transparent 1.4px) 0 0 / 6px 6px, ${color}`;
        default: return color;
    }
}
