/**
 * informeNdviMarcas — identidad de módulo SIN color para el informe de NDVI.
 * Regla del informe: el color es solo de la clase de vigor; el marrón institucional es solo de la marca. Cada módulo se
 * reconoce por su MONOGRAMA (M1…M12 en cajita), un MARCADOR de forma (los mismos nombres de SIMBOLO_MODULO del panel:
 * círculo, cuadrado, triángulo, rombo, flecha, gota) y un estilo de trazo en las gráficas de línea. Así se distinguen en
 * blanco y negro y para daltónicos. Todo es SVG/HTML puro (strings), sin DOM.
 */
import { SIMBOLO_MODULO } from './ndviGrafica';
import { CLASES_NDVI, SD_FONDO, SD_TRAZO, SUELO_CONTORNO, tintaSobre } from './ndviRampa';
import { esc } from './informeBase';

/**
 * Tamaño mínimo de texto dentro de un SVG del informe, en unidades del viewBox. Cada figura se dibuja a su ancho nominal
 * (1 unidad = 1 px CSS = 0.75 pt al imprimir; el SVG lleva max-width = su ancho), así que 10.4 u ≈ 7.8 pt ≥ el mínimo de 7.5 pt.
 */
export const FS_MIN = 10.4;

const INK = '#1f2328';
const f1 = (n: number) => String(Number(n.toFixed(1)));

/** Trazo por módulo (identidad en gráficas de línea junto al marcador y la etiqueta): ninguno repite el de otro. */
export const TRAZO_MODULO: Record<number, string> = { 1: '', 2: '6 3', 3: '1.5 3', 4: '9 3 2 3', 5: '3 2', 12: '12 4' };

export type FormaMarcador = 'circle' | 'rect' | 'triangle' | 'diamond' | 'arrow' | 'pin';
export const formaDeModulo = (numero: number): FormaMarcador => (SIMBOLO_MODULO[numero] as FormaMarcador | undefined) ?? 'circle';

/** Nombre en español de la forma (leyenda y texto alterno). */
export const NOMBRE_FORMA: Record<FormaMarcador, string> = { circle: 'círculo', rect: 'cuadrado', triangle: 'triángulo', diamond: 'rombo', arrow: 'flecha', pin: 'gota' };

/** Contorno de la forma centrada en (x, y) con radio r, sin atributos de pintura. */
export function formaSvg(forma: FormaMarcador, x: number, y: number, r: number, attrs: string): string {
    const p = (pts: [number, number][]) => `<polygon points="${pts.map(([a, b]) => `${f1(x + a * r)},${f1(y + b * r)}`).join(' ')}" ${attrs}/>`;
    switch (forma) {
        case 'rect': return `<rect x="${f1(x - r * 0.88)}" y="${f1(y - r * 0.88)}" width="${f1(r * 1.76)}" height="${f1(r * 1.76)}" ${attrs}/>`;
        case 'triangle': return p([[0, -1.05], [1.0, 0.8], [-1.0, 0.8]]);
        case 'diamond': return p([[0, -1.15], [1.0, 0], [0, 1.15], [-1.0, 0]]);
        case 'arrow': return p([[0, -1.1], [1.05, 0.05], [0.42, 0.05], [0.42, 1.0], [-0.42, 1.0], [-0.42, 0.05], [-1.05, 0.05]]);
        case 'pin': return `<path d="M${f1(x)},${f1(y + r * 1.15)}L${f1(x - r * 0.8)},${f1(y - r * 0.15)}A${f1(r * 0.9)},${f1(r * 0.9)} 0 1 1 ${f1(x + r * 0.8)},${f1(y - r * 0.15)}Z" ${attrs}/>`;
        default: return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" ${attrs}/>`;
    }
}

/** Marcador de un módulo (relleno de tinta, borde blanco para que se lea sobre cualquier fondo). */
export const marcadorModuloSvg = (numero: number, x: number, y: number, r: number, relleno = INK, borde = '#fff'): string =>
    formaSvg(formaDeModulo(numero), x, y, r, `fill="${relleno}" stroke="${borde}" stroke-width="1"`);

/** Marcador pequeño para HTML (tablas, fichas, leyenda): SVG en línea de 12 px. */
export function marcadorModuloHtml(numero: number, px = 12): string {
    return `<svg class="mk" width="${px}" height="${px}" viewBox="0 0 12 12" aria-hidden="true">${formaSvg(formaDeModulo(numero), 6, 6, 4.6, `fill="${INK}"`)}</svg>`;
}

/** Símbolos de los marcadores, definidos UNA vez por documento (cada monograma los reutiliza con <use>: ≈ 100 bytes en vez de ≈ 330). */
export function defsMarcadoresHtml(numeros: readonly number[] = [1, 2, 3, 4, 5, 12]): string {
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${numeros.map((n) => `<symbol id="mk${n}" viewBox="0 0 12 12">${formaSvg(formaDeModulo(n), 6, 6, 4.6, `fill="${INK}"`)}</symbol>`).join('')}</defs></svg>`;
}

/** Monograma M# en cajita con su marcador (HTML). Requiere defsMarcadoresHtml() una vez en el documento. */
export function monogramaHtml(numero: number): string {
    return `<span class="mono" title="Módulo ${numero}"><svg class="mk" width="11" height="11" aria-hidden="true"><use href="#mk${numero}"/></svg><b>M${numero}</b></span>`;
}

/** Rótulo SVG de módulo: marcador + cajita con M#; (x, y) = centro vertical, x = borde izquierdo. Devuelve el SVG y su ancho. */
export function rotuloModuloSvg(numero: number, x: number, y: number, o: { fs?: number; relleno?: string } = {}): { svg: string; w: number; h: number } {
    const fs = o.fs ?? FS_MIN;
    const txt = `M${numero}`;
    const wTxt = txt.length * fs * 0.62 + 6, h = fs + 5, r = h * 0.36;
    const caja = `<rect x="${f1(x + r * 2 + 3)}" y="${f1(y - h / 2)}" width="${f1(wTxt)}" height="${f1(h)}" rx="2" fill="${o.relleno ?? '#fff'}" stroke="${INK}" stroke-width="1"/>`;
    const t = `<text x="${f1(x + r * 2 + 3 + wTxt / 2)}" y="${f1(y + fs * 0.35)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${INK}">${txt}</text>`;
    return { svg: `${marcadorModuloSvg(numero, x + r, y, r)}${caja}${t}`, w: r * 2 + 3 + wTxt, h };
}

/** Rótulo de la media SRL (sin marcador de módulo): cajita "SRL" en tinta invertida. */
export function rotuloSrlSvg(x: number, y: number, fs = FS_MIN): { svg: string; w: number; h: number } {
    const w = 3 * fs * 0.62 + 8, h = fs + 5;
    return { svg: `<rect x="${f1(x)}" y="${f1(y - h / 2)}" width="${f1(w)}" height="${f1(h)}" rx="2" fill="${INK}"/><text x="${f1(x + w / 2)}" y="${f1(y + fs * 0.35)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="#fff">SRL</text>`, w, h };
}

/** Pasos de la tinta única marrón (ICV/IHR): intensidad = valor, no clase de vigor. Una sola definición para la tabla y la leyenda. */
export const PASOS_TINTA = 6;
export function colorPasoTinta(i: number): { fondo: string; texto: string } {
    const t = (i + 0.5) / PASOS_TINTA;
    const mez = (x: number, y: number) => Math.round(x + (y - x) * t);
    const fondo = `#${[mez(255, 0x6b), mez(255, 0x2d), mez(255, 0x2d)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return { fondo, texto: tintaSobre(fondo) };
}

/** Estilo CSS del hachurado S/D (celdas, barras y leyenda comparten uno solo). */
export const CSS_HACHURADO = `.hach{background:repeating-linear-gradient(45deg,${SD_FONDO} 0 3px,${SD_TRAZO} 3px 5px)}`;

/**
 * Leyenda única del documento: qué significa cada color, cada forma y cada símbolo. Va una sola vez (hoja de situación);
 * las demás hojas la mencionan en una línea.
 */
export function leyendaSistemaVisual(modulos: { numero: number; nombre: string }[], o: { indices: boolean; plano?: { canal: boolean; vecinos: boolean; relieve: boolean } }): string {
    const clases = CLASES_NDVI.map((c) => `<li><i style="background:${c.color}${c.clave === 'suelo' ? `;border-color:${SUELO_CONTORNO}` : ''}"></i><span>${esc(c.etiqueta)}</span></li>`).join('');
    const formas = modulos.map((m) => `<li>${marcadorModuloHtml(m.numero, 13)}<b class="mono-t">M${m.numero}</b></li>`).join('');
    const pasos = Array.from({ length: PASOS_TINTA }, (_, i) => `<i style="background:${colorPasoTinta(i).fondo}"></i>`).join('');
    return `<div class="sis" aria-label="Qué significa cada color y cada forma">
<h3>Cómo leer los colores y las formas</h3>
<p class="sis-k"><b>Color = vigor de la vegetación</b> (clase de NDVI)</p>
<ul class="sis-l">${clases}<li><i class="hach"></i><span>S/D: sin dato</span></li></ul>
<p class="sis-k"><b>Forma = módulo</b> (nunca color)</p>
<ul class="sis-f">${formas}</ul>
${o.plano ? `<p class="sis-k"><b>En el plano:</b> <span class="sis-c"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="${INK}" stroke-width="1.5" stroke-dasharray="7 2.5"/></svg> canal Conchos</span> · <span class="sis-c"><i class="vec"></i> otros módulos del DR-005 (trama punteada, sin dato)</span> · relieve sombreado de fondo</p>` : ''}
<p class="sis-k"><b>▲ ▼ ■</b> sube, baja o sin cambio · el texto trae la cifra</p>${o.indices
        ? `<p class="sis-k"><b>Tinta marrón = valor del índice</b> (ICV o IHR, 0–100): más oscuro, mayor valor</p><div class="sis-t">${pasos}<span>0</span><span>100</span></div>` : ''}
<p class="sis-k"><b>Marrón institucional</b> = solo marca y títulos. <b>Negro grueso</b> = año de interés o promedio SRL.</p>
</div>`;
}

/** CSS de las marcas y la leyenda (se agrega al CSS del informe). */
export const CSS_MARCAS = `
.mk{vertical-align:-1px;flex:none}
.mono{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--ink);border-radius:2px;padding:0 3px 0 2px;font-size:7.5pt;line-height:1.35;white-space:nowrap;background:#fff}
.mono b{font-weight:700}
${CSS_HACHURADO}
.sis h3{margin:0 0 4px}
.sis-k{margin:5px 0 2px;font-size:7.5pt;color:var(--ink)}
.sis ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:2px 10px;font-size:7.5pt}
.sis-l{flex-direction:column;flex-wrap:nowrap!important;gap:2px!important}
.sis-l li{display:flex;align-items:center;gap:5px}
.sis-l i{width:18px;height:11px;border:1px solid rgba(0,0,0,.4);display:inline-block}
.sis-f li{display:inline-flex;align-items:center;gap:3px;width:46px}
.mono-t{font-size:7.5pt}
.sis-c{white-space:nowrap}
.sis-c i.vec{display:inline-block;width:16px;height:10px;background:radial-gradient(circle,#2f363d .6px,rgba(255,255,255,.85) .7px 1.25px,transparent 1.35px) 0 0/4px 4px,#fff;border:1px dashed #2f363d;vertical-align:-1px}
.sis-t{display:flex;align-items:center;gap:0;font-size:7.5pt;margin-top:2px}
.sis-t i{width:16px;height:9px;display:inline-block;border:1px solid rgba(0,0,0,.25)}
.sis-t span{margin-left:4px}
`;
