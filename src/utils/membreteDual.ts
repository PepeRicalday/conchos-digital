/**
 * membreteDual — cabecera común de informes con los DOS logos al mismo peso: escudo de SRL Unidad Conchos (a la izquierda,
 * titular del distrito) y emblema SICA 005 (a la derecha, el sistema que genera el informe).
 *
 * Reglas (auditoría de marca 2026-11-02):
 *  - Misma caja de altura para ambos (`alto`, 60 px = 16 mm por defecto; mínimo 45 px = 12 mm). El emblema SICA se dibuja al 92 %
 *    dentro de su caja: pesa más ópticamente (color y saturación) y así no domina.
 *  - El nombre va SIEMPRE en texto al lado de cada logo. El rótulo interior del escudo SRL solo llega a 7 pt con ~29 mm de alto;
 *    en un membrete de 12-18 mm no se lee, así que el texto es el que identifica. Si un logo no cargó, el texto sigue.
 *  - Fondo oscuro: escudo en versión clara (SVG crema). El marrón sobre navy da 1,5-1,8:1 y no se usa nunca.
 *  - Todas las medidas salen de `--mb-alto` (em), así que el mismo membrete sirve para hoja carta y para infografías de 1080-2000 px.
 */
import { MARCA, FUENTE_MARCA, FUENTE_SRL, esc } from './marcaInforme';
// Montserrat 800 (tipografía del logo SICA 005) embebida: el informe es un HTML autónomo y se abre sin red. Subconjunto latino de 8 KB.
import montserrat800 from '../assets/fonts/montserrat-800-informe.woff2?inline';

export interface MetaMembrete { k: string; v: string }

export interface OpcionesMembrete {
    /** Escudo SRL como data URI/URL; '' = solo texto. Con `fondo: 'oscuro'` debe ser la versión clara. */
    logoSrl: string;
    /** Emblema SICA como data URI/URL; '' = solo texto. */
    logoSica: string;
    /** Nombre del informe («Informe general del sistema»). */
    /** Nombre del informe; '' y sin meta = no se dibuja la fila (infografías con su propio título). */
    titulo: string;
    meta?: MetaMembrete[];
    fondo?: 'claro' | 'oscuro';
    /** Alto en px de la caja de los logos (60 = 16 mm). Infografías: 90 a 1080 px de ancho, 120 a 1440, 140 a 2000. */
    alto?: number;
}

/** Alto de caja por defecto (16 mm) y mínimo permitido (12 mm). */
export const ALTO_MEMBRETE_PX = 60;
export const ALTO_MEMBRETE_MIN_PX = 45;

/** Alto de caja recomendado para una infografía PNG según su ancho de página. */
export function altoMembretePorAncho(anchoPx: number): number {
    if (anchoPx >= 1900) return 140;
    if (anchoPx >= 1300) return 120;
    return 90;
}

export const CSS_MEMBRETE = `
@font-face{font-family:"Montserrat";font-style:normal;font-weight:800;src:url(${montserrat800}) format("woff2")}
.mb{--mb-alto:${ALTO_MEMBRETE_PX}px;--mb-tinta:${MARCA.navy};--mb-sec:#57606a;--mb-linea:${MARCA.navy};--mb-agua:${MARCA.aguaClaro};--mb-marca:${FUENTE_MARCA};--mb-srl:${FUENTE_SRL};margin-bottom:12px}
.mb.mb-oscuro{--mb-tinta:#fff;--mb-sec:${MARCA.cielo};--mb-linea:${MARCA.aguaClaro};--mb-agua:${MARCA.agua}}
.mb-marcas{display:flex;align-items:center;justify-content:space-between;gap:.4em 1em;flex-wrap:wrap;font-size:var(--mb-alto);line-height:1;padding-bottom:.16em;border-bottom:2px solid var(--mb-linea);box-shadow:0 2px 0 var(--mb-agua)}
.mb-marca{display:flex;align-items:center;gap:.2em;min-width:0}
.mb-marca img{display:block;flex:none;height:1em;width:auto;object-fit:contain}
.mb-sica img{height:.92em}
.mb-txt{display:flex;flex-direction:column;gap:.05em;min-width:0;max-width:5em}
.mb-txt b{font-size:.27em;line-height:1.12;color:var(--mb-tinta);font-weight:800}
.mb-txt span{font-size:.17em;line-height:1.25;color:var(--mb-sec);letter-spacing:.04em;text-transform:uppercase}
.mb-srl .mb-txt b{font-family:var(--mb-srl);font-weight:700;letter-spacing:.03em}
.mb-sica .mb-txt b{font-family:var(--mb-marca);letter-spacing:.01em}
.mb-doc{display:flex;justify-content:space-between;align-items:baseline;gap:6px 14px;flex-wrap:wrap;margin-top:10px}
.mb-doc>b{font:800 11pt/1.2 var(--mb-marca);color:var(--mb-tinta);text-transform:uppercase;letter-spacing:.02em}
.mb-meta{font-size:7.5pt;line-height:1.5;color:var(--mb-sec);text-align:right}
.mb-meta b{color:var(--mb-tinta)}
@media screen and (max-width:720px){.mb-meta{text-align:left}.mb-txt{max-width:9em}}
`;

/** Una marca (logo + rótulo de texto). */
function marca(clase: 'mb-srl' | 'mb-sica', logo: string, alt: string, nombre: string, sub: string): string {
    const img = logo ? `<img src="${esc(logo)}" alt="${esc(alt)}">` : '';
    return `<div class="mb-marca ${clase}">${img}<div class="mb-txt"><b>${esc(nombre)}</b><span>${esc(sub)}</span></div></div>`;
}

/** Cabecera institucional con los dos logos al mismo peso. Incluir CSS_MEMBRETE en el CSS del documento. */
export function membreteDual(o: OpcionesMembrete): string {
    const alto = Math.max(ALTO_MEMBRETE_MIN_PX, Math.round(o.alto ?? ALTO_MEMBRETE_PX));
    const oscuro = o.fondo === 'oscuro';
    const meta = (o.meta ?? []).map((m) => `<div><b>${esc(m.k)}:</b> ${esc(m.v)}</div>`).join('');
    return `<header class="mb${oscuro ? ' mb-oscuro' : ''}" style="--mb-alto:${alto}px">
  <div class="mb-marcas">
    ${marca('mb-srl', o.logoSrl, 'SRL Unidad Conchos, Delicias', 'SRL Unidad Conchos', 'Delicias, Chihuahua')}
    ${marca('mb-sica', o.logoSica, 'SICA 005', 'SICA 005', 'Sistema Integral de Control del Agua')}
  </div>
  ${o.titulo || meta ? `<div class="mb-doc">${o.titulo ? `<b>${esc(o.titulo)}</b>` : '<span></span>'}${meta ? `<div class="mb-meta">${meta}</div>` : ''}</div>` : ''}
</header>`;
}
