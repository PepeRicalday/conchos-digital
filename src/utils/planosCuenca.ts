// ═══════════════════════════════════════════════════════════════════════════
// Planos de la cuenca (isoyetas y planos de temperatura, viento y humedad) — modelo puro + SVG compartido por la pantalla y el informe
// ---------------------------------------------------------------------------
// construirPlano: puntos → campo (IDW con vecindad y máscara de cobertura) → bandas rellenas y isolíneas por marching squares, con rótulo
// de valor sobre la línea. planoSvg: el MISMO dibujo para la pantalla (tema oscuro) y el papel (tema claro): una sola definición, así las
// cifras y los colores nunca divergen. Niveles fijos (comparables entre informes), zonas sin cobertura con TRAMA (nunca un color inventado),
// estación excluida con ✕, S/D con su motivo. Contexto provisional, no medición oficial.
// ═══════════════════════════════════════════════════════════════════════════
import { colapsaGrupos, construirCampo, type CampoCuenca, type DemGrid, type PuntoCampo, type AjusteAltitud } from './camposCuenca';
import { anilloAPath, proyectorCuenca, SALIDA_CUENCA, type ContornoCuenca, type ProyectorMapa } from './geoCuenca';
import { anillosAPath, regionMayorQue, rotuloEnAnillos, simplificaAnillo, suavizaAnillo, type Anillo } from './isolineas';
import { cuandoVentana, type VentanaObs } from './jcasModelo';
import { capasSvg, type CapaId, type DatosCapas } from './capasCuenca';
import { escalaDe } from './escalasCuenca';
import { colorBanda, fmtNivel, VARIABLES_PLANO, type VariablePlano } from './paletasClima';

export type PeriodoPlano = { tipo: 'obs'; dias: VentanaObs } | { tipo: 'pron'; dias: 3 | 7 };

export interface BandaPlano { nivel: number; color: string; anillos: Anillo[] }
export interface RotuloPlano { nivel: number; lon: number; lat: number; angulo: number }

export interface PlanoModelo {
    variable: VariablePlano;
    periodo: PeriodoPlano;
    titulo: string;
    unidad: string;
    niveles: number[];
    /** Base de la escala de color («escala basada en n = … lecturas, periodo …»); se muestra en la leyenda. */
    escalaBase: string;
    colorBase: string;
    bandas: BandaPlano[];
    rotulos: RotuloPlano[];
    /** Celdas dentro de la cuenca SIN cobertura, como rectángulos [lon0, lat0, lon1, lat1] (corridas por fila). */
    sinCobertura: [number, number, number, number][];
    puntos: PuntoCampo[];
    excluidos: PuntoCampo[];
    campo: CampoCuenca;
    resumen: { media: number | null; min: number | null; max: number | null; coberturaPct: number; n: number; nExcluidas: number; maxEn: { nombre: string; valor: number } | null };
    ajuste: AjusteAltitud;
    motivoSD: string | null;
}

export interface EntradaPlano {
    variable: VariablePlano;
    periodo: PeriodoPlano;
    puntos: PuntoCampo[];
    contorno: ContornoCuenca;
    dem?: DemGrid | null;
}

export function tituloPlano(variable: VariablePlano, periodo: PeriodoPlano): string {
    const que = variable === 'lluvia' ? 'Isoyetas' : VARIABLES_PLANO[variable].titulo;
    const cuando = periodo.tipo === 'obs' ? cuandoVentana(periodo.dias) : `próximos ${periodo.dias} días`;
    return `${que} ${periodo.tipo === 'obs' ? 'observadas' : 'pronosticadas'} · ${cuando}`.replace(/^(Temperatura media|Viento medio|Humedad relativa) (observadas|pronosticadas)/, (_, a, b) => `${a} ${b.replace('adas', a === 'Viento medio' ? 'ado' : 'ada')}`);
}

/** Área (grados²) de un anillo, para descartar islas diminutas. */
function areaGrados(a: Anillo): number {
    let s = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1];
    return Math.abs(s / 2);
}

export function construirPlano(e: EntradaPlano): PlanoModelo {
    const cfg = VARIABLES_PLANO[e.variable];
    const puntos = colapsaGrupos(e.puntos); // una estación por ciudad, tanto en el campo como en el dibujo
    const campo = construirCampo(puntos, e.contorno, { piso: cfg.piso, techo: cfg.techo, dem: e.dem ?? null, ajusteAltitud: e.dem ? 'auto' : 'no' });
    const excluidos = puntos.filter((p) => p.sospechosa);
    const utiles = puntos.filter((p) => p.valor != null && !p.sospechosa);
    const mayor = utiles.length ? utiles.reduce((a, b) => ((b.valor as number) > (a.valor as number) ? b : a)) : null;
    const base = {
        variable: e.variable, periodo: e.periodo, titulo: tituloPlano(e.variable, e.periodo), unidad: cfg.unidad, puntos, excluidos, campo,
        resumen: { media: campo.media, min: campo.min, max: campo.max, coberturaPct: campo.coberturaPct, n: campo.nEstaciones, nExcluidas: excluidos.length, maxEn: mayor ? { nombre: mayor.nombre, valor: mayor.valor as number } : null },
        ajuste: campo.ajuste, motivoSD: campo.motivoSD,
    };
    const diasEscala = e.periodo.dias === 'hoy' ? 1 : e.periodo.dias;
    const escala = escalaDe(e.variable, diasEscala);
    if (campo.motivoSD) return { ...base, niveles: [], escalaBase: escala.base, colorBase: colorBanda(e.variable, 0, 1), bandas: [], rotulos: [], sinCobertura: [] };

    const niveles = escala.niveles;
    // Escala fija: los niveles por debajo del mínimo del campo cubren todo el plano y no dibujan contorno; el fondo toma el color de la banda en que cae el mínimo.
    const k0 = campo.min == null ? 0 : niveles.filter((n) => n <= (campo.min as number)).length;
    const { malla, cubierta, dentro } = campo;
    const latRef = (e.contorno.bbox.minLat + e.contorno.bbox.maxLat) / 2;
    const valido = (lon: number, lat: number) => {
        const i = Math.round((lon - malla.lon0) / malla.paso), j = Math.round((malla.lat1 - lat) / malla.paso);
        return i >= 0 && j >= 0 && i < malla.nx && j < malla.ny && !!cubierta[j * malla.nx + i];
    };
    const bandas: BandaPlano[] = [], rotulos: RotuloPlano[] = [];
    niveles.forEach((nivel, k) => {
        if (k < k0) return;
        // En campos de gradiente (temperatura, viento, humedad) las islas de pocas celdas son ruido del relieve: no se dibujan.
        const minArea = e.variable === 'lluvia' ? 0 : malla.paso * malla.paso * 5;
        const anillos = regionMayorQue(malla, nivel).filter((a) => areaGrados(a) >= minArea).map((a) => simplificaAnillo(suavizaAnillo(a, 2), malla.paso * 0.06));
        if (!anillos.length) return;
        bandas.push({ nivel, color: colorBanda(e.variable, k + 1, niveles.length), anillos });
        const r = rotuloEnAnillos(anillos, valido, latRef);
        if (r) rotulos.push({ nivel, ...r });
    });
    const sinCobertura: [number, number, number, number][] = [];
    const h = malla.paso / 2;
    for (let j = 0; j < malla.ny; j++) {
        let i = 0;
        while (i < malla.nx) {
            const k = j * malla.nx + i;
            if (dentro[k] && !cubierta[k]) {
                let i2 = i;
                while (i2 + 1 < malla.nx && dentro[j * malla.nx + i2 + 1] && !cubierta[j * malla.nx + i2 + 1]) i2++;
                const lat = malla.lat1 - j * malla.paso;
                sinCobertura.push([malla.lon0 + i * malla.paso - h, lat - h, malla.lon0 + i2 * malla.paso + h, lat + h]);
                i = i2 + 1;
            } else i++;
        }
    }
    return { ...base, niveles, escalaBase: escala.base, colorBase: colorBanda(e.variable, k0, niveles.length), bandas, rotulos, sinCobertura };
}

// ───────────────────────────── SVG ─────────────────────────────

export type TemaPlano = 'pantalla' | 'papel';
export interface OpcionesSvg {
    ancho?: number;
    tema?: TemaPlano;
    /** Tamaño de texto en unidades del viewBox (para que en pantallas chicas siga ≥ 12 px reales). */
    textoPx?: number;
    idPrefijo?: string;
    leyenda?: boolean;
    /** Texto alternativo del dibujo (role="img"). */
    descripcion?: string;
    /** Capas de referencia (municipios, ríos, presas…) ya cargadas (utils/capasCuenca.ts). Sin esto el plano sale como siempre. */
    capas?: { ids: CapaId[]; datos: DatosCapas };
    /** Largo de la barra de escala en km (100 en la cuenca; 10 en el acercamiento al distrito). */
    escalaKm?: number;
    /** false = sin la flecha «Salida · Ojinaga» (acercamientos que no la contienen). */
    salida?: boolean;
}

const TEMAS: Record<TemaPlano, { texto: string; suave: string; halo: string; borde: string; velo: string; trama: string; punto: string; excluido: string }> = {
    pantalla: { texto: '#e8eef6', suave: '#b4c2d4', halo: '#061532', borde: '#3FB2F3', velo: '#0b1d3f', trama: 'rgba(180,194,212,0.6)', punto: '#e8eef6', excluido: '#f87171' },
    papel: { texto: '#0E1B2C', suave: '#4a5565', halo: '#ffffff', borde: '#0B3170', velo: '#ffffff', trama: '#8a94a3', punto: '#0E1B2C', excluido: '#b42318' },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (x: number) => x.toFixed(1);

export function planoSvg(m: PlanoModelo, c: ContornoCuenca, op: OpcionesSvg = {}): string {
    const W = op.ancho ?? 500, T = TEMAS[op.tema ?? 'pantalla'], px = op.textoPx ?? 12, id = op.idPrefijo ?? 'pl';
    const p: ProyectorMapa = proyectorCuenca(c.bbox, W);
    const cuenca = c.poligonos.map((poli) => anilloAPath(poli[0], p)).join(' ');
    const hayLeyenda = op.leyenda !== false;
    // las cifras de las estaciones tienen prioridad: los rótulos de las capas no se colocan encima de ellas
    const reservados: [number, number, number, number][] = m.puntos.flatMap((s) => {
        const x = p.x(s.lon), y = p.y(s.lat), w = (s.valor == null ? 3 : s.valor.toFixed(1).length) * px * 0.62 + 4;
        return [[x - 6, y + 6, 12, 12], [x > W * 0.86 ? x - 5 - w : x + 5, y - 3, w, px + 2]] as [number, number, number, number][];
    });
    const capas = op.capas && op.capas.ids.length ? capasSvg(op.capas.datos, op.capas.ids, p, { px, tema: op.tema ?? 'pantalla', ancho: W, alto: p.alto, reservados }) : null;
    // leyenda de capas: filas con salto automático (ancho estimado por entrada)
    const filasCapas: { glifo: string; texto: string; x: number }[][] = [];
    if (hayLeyenda && capas && capas.leyenda.length) {
        let fila: { glifo: string; texto: string; x: number }[] = [], x = px;
        for (const it of capas.leyenda) {
            const w = 22 + it.texto.length * px * 0.55 + 12;
            if (x + w > W - px && fila.length) { filasCapas.push(fila); fila = []; x = px; }
            fila.push({ ...it, x }); x += w;
        }
        if (fila.length) filasCapas.push(fila);
    }
    // base de la escala (rótulo honesto: de qué datos salen los cortes de color), en líneas de ancho acotado
    const lineasBase: string[] = [];
    if (hayLeyenda && m.escalaBase) {
        const maxCar = Math.max(30, Math.floor((W - px * 2) / (px * 0.8 * 0.52)));
        let l = 'Escala basada en ';
        for (const w of m.escalaBase.split(' ')) { if ((l + w).length > maxCar && l.trim()) { lineasBase.push(l.trim()); l = ''; } l += `${w} `; }
        if (l.trim()) lineasBase.push(l.trim());
    }
    const nLey = m.niveles.length + 1, altoLey = hayLeyenda ? Math.round(px * 5.4) + Math.round(filasCapas.length * px * 1.7) + (lineasBase.length ? Math.round(px * 0.5 + lineasBase.length * px * 1.15) : 0) : 0;
    const H = p.alto + altoLey;
    const fuente = "font-family=\"'Segoe UI',system-ui,sans-serif\"";
    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(op.descripcion ?? m.titulo)}" ${fuente}>`);
    out.push(`<defs><clipPath id="${id}-cl"><path d="${cuenca}"/></clipPath>` +
        `<pattern id="${id}-tr" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${T.trama}" stroke-width="1.4"/></pattern></defs>`);

    if (m.motivoSD) {
        out.push(`<path d="${cuenca}" fill="url(#${id}-tr)" fill-opacity="0.55" stroke="${T.borde}" stroke-width="1.6" stroke-linejoin="round"/>`);
        if (capas) out.push(`<g clip-path="url(#${id}-cl)">${capas.bajo}</g>`);
        const cx = p.x((c.bbox.minLon + c.bbox.maxLon) / 2), cy = p.y((c.bbox.minLat + c.bbox.maxLat) / 2);
        out.push(`<text x="${n1(cx)}" y="${n1(cy - px)}" text-anchor="middle" font-size="${px * 1.6}" font-weight="800" fill="${T.texto}" stroke="${T.halo}" stroke-width="${px * 0.35}" paint-order="stroke">S/D</text>`);
        const palabras = m.motivoSD.split(' ');
        let linea = '', y = cy + px * 0.6;
        for (const w of palabras) {
            if ((linea + ' ' + w).length > 34) { out.push(`<text x="${n1(cx)}" y="${n1(y)}" text-anchor="middle" font-size="${px}" fill="${T.texto}" stroke="${T.halo}" stroke-width="${px * 0.3}" paint-order="stroke">${esc(linea.trim())}</text>`); linea = w; y += px * 1.3; } else linea += ' ' + w;
        }
        if (linea.trim()) out.push(`<text x="${n1(cx)}" y="${n1(y)}" text-anchor="middle" font-size="${px}" fill="${T.texto}" stroke="${T.halo}" stroke-width="${px * 0.3}" paint-order="stroke">${esc(linea.trim())}</text>`);
    } else {
        out.push(`<g clip-path="url(#${id}-cl)"><rect width="${W}" height="${p.alto}" fill="${m.colorBase}"/>`);
        for (const b of m.bandas) out.push(`<path d="${anillosAPath(b.anillos, p.x, p.y)}" fill="${b.color}" fill-rule="evenodd" stroke="${T.texto}" stroke-opacity="0.5" stroke-width="0.9" stroke-linejoin="round"/>`);
        if (m.sinCobertura.length) {
            const d = m.sinCobertura.map(([x0, y0, x1, y1]) => `M${n1(p.x(x0))},${n1(p.y(y1))}H${n1(p.x(x1))}V${n1(p.y(y0))}H${n1(p.x(x0))}Z`).join('');
            out.push(`<path d="${d}" fill="${T.velo}" fill-opacity="0.9"/><path d="${d}" fill="url(#${id}-tr)"/>`);
        }
        out.push('</g>');
        out.push(`<path d="${cuenca}" fill="none" stroke="${T.borde}" stroke-width="1.8" stroke-linejoin="round"/>`);
        if (capas) out.push(`<g clip-path="url(#${id}-cl)">${capas.bajo}</g>`);
        for (const r of m.rotulos) {
            out.push(`<text transform="translate(${n1(p.x(r.lon))} ${n1(p.y(r.lat))}) rotate(${r.angulo.toFixed(0)})" text-anchor="middle" dy="${n1(px * 0.35)}" font-size="${px * 0.95}" font-weight="700" fill="${T.texto}" stroke="${T.halo}" stroke-width="${px * 0.3}" paint-order="stroke">${esc(String(r.nivel))}</text>`);
        }
    }

    if (capas) out.push(capas.alto);

    // estaciones: punto + cifra del periodo (las excluidas con ✕ y sin cifra; las S/D con "S/D")
    for (const s of m.puntos) {
        const x = p.x(s.lon), y = p.y(s.lat);
        if (s.sospechosa) { out.push(`<path d="M${n1(x - 4)},${n1(y - 4)}L${n1(x + 4)},${n1(y + 4)}M${n1(x + 4)},${n1(y - 4)}L${n1(x - 4)},${n1(y + 4)}" stroke="${T.excluido}" stroke-width="2" stroke-linecap="round"><title>${esc(s.nombre)}: excluida</title></path>`); continue; }
        out.push(s.propia
            ? `<rect x="${n1(x - 3.4)}" y="${n1(y - 3.4)}" width="6.8" height="6.8" rx="1" fill="${T.punto}" stroke="${T.halo}" stroke-width="1.2"><title>${esc(s.nombre)} (estación propia)</title></rect>`
            : `<circle cx="${n1(x)}" cy="${n1(y)}" r="3.2" fill="${T.punto}" stroke="${T.halo}" stroke-width="1.2"><title>${esc(s.nombre)}</title></circle>`);
        // flecha de viento (solo pronóstico): apunta HACIA donde sopla (dirección meteorológica + 180°); su largo es fijo, la cifra da la velocidad
        if (m.variable === 'viento' && s.valor != null && s.dirDeg != null) {
            const L = px * 1.5;
            out.push(`<g transform="translate(${n1(x)} ${n1(y)}) rotate(${((s.dirDeg + 180) % 360).toFixed(0)})"><path d="M0,${n1(L * 0.5)}L0,${n1(-L)}M${n1(-L * 0.38)},${n1(-L * 0.55)}L0,${n1(-L)}L${n1(L * 0.38)},${n1(-L * 0.55)}" fill="none" stroke="${T.halo}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M0,${n1(L * 0.5)}L0,${n1(-L)}M${n1(-L * 0.38)},${n1(-L * 0.55)}L0,${n1(-L)}L${n1(L * 0.38)},${n1(-L * 0.55)}" fill="none" stroke="${T.texto}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><title>${esc(s.nombre)}: viento del ${s.dirDeg.toFixed(0)}° (hacia donde sopla la flecha)</title></g>`);
        }
        const txt = s.valor == null ? 'S/D' : s.valor.toFixed(m.variable === 'temperatura' || (m.variable === 'lluvia' && s.valor < 10) ? 1 : 0);
        const alDerecha = x > W * 0.86;
        out.push(`<text x="${n1(alDerecha ? x - 5 : x + 5)}" y="${n1(y - 4)}"${alDerecha ? ' text-anchor="end"' : ''} font-size="${px}" font-weight="700" fill="${T.texto}" stroke="${T.halo}" stroke-width="${px * 0.3}" paint-order="stroke">${esc(txt)}</text>`);
    }
    // salida de la cuenca
    const sx = p.x(SALIDA_CUENCA.lon), sy = p.y(SALIDA_CUENCA.lat);
    if (op.salida !== false) out.push(`<path d="M${n1(sx - 7)},${n1(sy + 11)}L${n1(sx)},${n1(sy + 19)}L${n1(sx + 7)},${n1(sy + 11)}" fill="none" stroke="${T.suave}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (op.salida !== false) out.push(`<text x="${n1(sx + 8)}" y="${n1(sy + 30)}" text-anchor="end" font-size="${px * 0.9}" font-weight="700" fill="${T.texto}" stroke="${T.halo}" stroke-width="${px * 0.3}" paint-order="stroke">Salida · Ojinaga</text>`);
    // norte y escala (100 km)
    out.push(`<g transform="translate(${n1(px * 1.6)} ${n1(px * 3.2)})"><path d="M0,${n1(-px * 1.1)}L${n1(px * 0.55)},${n1(px * 0.4)}L0,${n1(-px * 0.1)}L${n1(-px * 0.55)},${n1(px * 0.4)}Z" fill="${T.texto}"/><text y="${n1(px * 1.6)}" text-anchor="middle" font-size="${px}" font-weight="700" fill="${T.texto}">N</text></g>`);
    const cosLat = Math.cos((((c.bbox.minLat + c.bbox.maxLat) / 2) * Math.PI) / 180);
    const kmEscala = op.escalaKm ?? 100;
    const km100 = (kmEscala / (111.32 * cosLat)) * (p.x(c.bbox.minLon + 1) - p.x(c.bbox.minLon));
    const bx = px * 1.2, by = p.alto - px * 1.6;
    out.push(`<g><path d="M${n1(bx)},${n1(by)}h${n1(km100)}M${n1(bx)},${n1(by - 4)}v8M${n1(bx + km100)},${n1(by - 4)}v8" stroke="${T.texto}" stroke-width="1.6" fill="none"/><text x="${n1(bx)}" y="${n1(by - 7)}" font-size="${px * 0.9}" fill="${T.texto}">${kmEscala} km</text></g>`);

    if (hayLeyenda) {
        const x0 = px, ancho = W - px * 2, w = ancho / nLey, y0 = p.alto + px * 0.8, hSw = px * 1.1;
        out.push(`<g aria-hidden="true">`);
        for (let k = 0; k < nLey; k++) {
            out.push(`<rect x="${n1(x0 + k * w)}" y="${n1(y0)}" width="${n1(w)}" height="${n1(hSw)}" fill="${m.motivoSD ? 'none' : colorBanda(m.variable, k, m.niveles.length || 1)}" stroke="${T.suave}" stroke-width="0.6"/>`);
            if (k > 0 && m.niveles[k - 1] !== undefined) out.push(`<text x="${n1(x0 + k * w)}" y="${n1(y0 + hSw + px * 1.15)}" text-anchor="middle" font-size="${px * 0.9}" fill="${T.texto}">${m.niveles[k - 1]}</text>`);
        }
        out.push(`<text x="${n1(x0)}" y="${n1(y0 + hSw + px * 1.15)}" font-size="${px * 0.9}" fill="${T.suave}">${esc(m.unidad)}</text>`);
        const yh = y0 + hSw + px * 2.3;
        out.push(`<rect x="${n1(x0)}" y="${n1(yh - px * 0.8)}" width="${n1(px * 1.6)}" height="${n1(px * 0.9)}" fill="${T.velo}" stroke="${T.suave}" stroke-width="0.6"/><rect x="${n1(x0)}" y="${n1(yh - px * 0.8)}" width="${n1(px * 1.6)}" height="${n1(px * 0.9)}" fill="url(#${id}-tr)"/>`);
        out.push(`<text x="${n1(x0 + px * 2.1)}" y="${n1(yh)}" font-size="${px * 0.9}" fill="${T.texto}">sin cobertura (a más de 90 km de una estación)</text>`);
        filasCapas.forEach((fila, i) => {
            const yf = yh + px * 1.7 * (i + 1);
            for (const it of fila) out.push(`<g transform="translate(${n1(it.x)} ${n1(yf - px * 0.8)}) scale(${n1(px / 12)})">${it.glifo}</g><text x="${n1(it.x + 22 * (px / 12))}" y="${n1(yf)}" font-size="${px * 0.9}" fill="${T.texto}">${esc(it.texto)}</text>`);
        });
        if (lineasBase.length) {
            const yb = yh + px * 1.7 * filasCapas.length + px * 1.5;
            lineasBase.forEach((t, i) => out.push(`<text x="${n1(x0)}" y="${n1(yb + i * px * 1.15)}" font-size="${px * 0.8}" fill="${T.suave}">${esc(t)}</text>`));
        }
        out.push('</g>');
    }
    out.push('</svg>');
    return out.join('');
}

export { fmtNivel };
