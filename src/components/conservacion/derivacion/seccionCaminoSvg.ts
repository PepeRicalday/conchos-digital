import type { DiagramaComp } from '../../../conservacion/verificacion/comprobacion';
import type { OpcionesSeccion, PaletaSeccion } from './seccionCanalSvg';
import { EXAGERACION_VERTICAL } from './seccionLeyenda';

const f2 = (x: number): string => x.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (x: number): string => x.toFixed(1);

/** Medidas ILUSTRATIVAS (el libro no las trae): base de la calzada, berma y cuneta. Nunca se rotulan como dato. */
const BASE_ILUS = 0.3;
const BERMA_ILUS = 0.6;
const CUNETA_ILUS = 1.2;
const PROF_CUNETA_ILUS = 0.35;

/**
 * Sección de calzada de un camino como cadena <svg>. La ÚNICA dimensión que sale del inventario es el ancho de la carpeta (IO3,
 * cota azul); el parámetro del PacOT va en violeta. Bermas y cunetas se dibujan tenues y rotuladas «ilustrativo». El espesor de
 * la carpeta solo se dibuja en la reposición de revestimiento con coeficiente distinto de cero y se rotula «(inferencia)».
 * null si el inventario no trae el ancho. El texto del dibujo es mínimo: lo descriptivo vive en la leyenda HTML.
 */
export function seccionCaminoSvg(d: DiagramaComp, paleta: PaletaSeccion, op: OpcionesSeccion = {}): string | null {
    const a = d.ancho;
    if (a === null || a === undefined || !(a > 0)) return null;
    const idPatron = op.idPatron ?? 'cons-camino-trama';
    const { pac, inv } = paleta;
    const tenue = paleta.tenue ?? '#8b7d63';
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const espesor = d.modo === 'camino-revestimiento' && d.espesor !== null && d.espesor !== undefined && d.espesor > 0 ? d.espesor : null;
    const tb = BASE_ILUS;
    const hCarpeta = espesor ?? 0;
    const mitadCalz = a / 2;
    const mitad = mitadCalz + BERMA_ILUS + CUNETA_ILUS + 0.9;
    const W = 480;
    const S = (W - 24) / (2 * mitad);
    const V = S * EXAGERACION_VERTICAL;
    const cx = W / 2;
    const yTop = 64;
    const yMax = tb + Math.max(hCarpeta, 0.15) + 0.4;
    const yMin = -0.5;
    const alto = Math.round(yTop + (yMax - yMin) * V + 54);
    const X = (x: number): number => cx + x * S;
    const Y = (y: number): number => yTop + (yMax - y) * V;
    const P = (pts: ReadonlyArray<readonly [number, number]>): string => pts.map(([x, y]) => `${n1(X(x))},${n1(Y(y))}`).join(' ');
    const out: string[] = [];
    const sup = d.superficie ?? 'superficie S/D';
    const etiqueta = d.modo === 'camino-conformacion' ? 'Conformación' : d.modo === 'camino-rastreo' ? 'Rastreo' : d.modo === 'camino-revestimiento' ? 'Reposición de revestimiento' : 'Terracerías';

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${alto}" role="img" aria-label="${esc(`Sección de calzada, ${etiqueta}: ancho ${f2(a)} m, superficie ${sup}. Cunetas y bermas ilustrativas.`)}" style="${op.estilo ?? 'width:100%;height:auto'}">`);
    out.push(`<defs><pattern id="${idPatron}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#9aa5b1"/><line x1="0" y1="0" x2="0" y2="8" stroke="#5f6b78" stroke-width="2"/></pattern></defs>`);

    // Terreno con bermas y cunetas ILUSTRATIVAS (tenue)
    const lado = (s: 1 | -1): Array<readonly [number, number]> => [
        [s * mitadCalz, tb], [s * (mitadCalz + BERMA_ILUS), tb], [s * (mitadCalz + BERMA_ILUS + CUNETA_ILUS / 2), tb - PROF_CUNETA_ILUS], [s * (mitadCalz + BERMA_ILUS + CUNETA_ILUS), tb], [s * mitad, tb],
    ];
    const izq = lado(-1).slice().reverse();
    const der = lado(1);
    out.push(`<polygon points="${P([[-mitad, yMin], [mitad, yMin], ...der.slice().reverse(), ...izq.slice().reverse()])}" fill="#8b7d63" opacity="0.28"/>`);
    out.push(`<polyline points="${P([...izq, ...der])}" fill="none" stroke="#8b7d63" stroke-width="2" stroke-dasharray="5 4" opacity="0.6"/>`);
    out.push(`<text x="${n1(X(-(mitadCalz + BERMA_ILUS + CUNETA_ILUS / 2)))}" y="${n1(Y(yMin) - 8)}" text-anchor="middle" font-size="18" fill="${tenue}">ilustrativo</text>`);
    out.push(`<text x="${n1(X(mitadCalz + BERMA_ILUS + CUNETA_ILUS / 2))}" y="${n1(Y(yMin) - 8)}" text-anchor="middle" font-size="18" fill="${tenue}">ilustrativo</text>`);

    // Calzada: base de terracería y, si hay reposición, la carpeta encima
    out.push(`<polygon points="${P([[-mitadCalz, 0], [mitadCalz, 0], [mitadCalz, tb], [-mitadCalz, tb]])}" fill="#b08d57" stroke="#7d6232" stroke-width="1.5"/>`);
    if (espesor !== null) {
        out.push(`<polygon points="${P([[-mitadCalz, tb], [mitadCalz, tb], [mitadCalz, tb + espesor], [-mitadCalz, tb + espesor]])}" fill="url(#${idPatron})" stroke="#4d5865" stroke-width="1.5"/>`);
    } else if (d.modo === 'camino-revestimiento') {
        out.push(`<rect x="${n1(X(-mitadCalz))}" y="${n1(Y(tb + 0.15))}" width="${n1(a * S)}" height="${n1(0.15 * V)}" fill="none" stroke="${pac}" stroke-width="2" stroke-dasharray="6 5"/>`);
    }
    const ySup = Y(tb + hCarpeta);

    // Lo que fija el PacOT (violeta)
    if (d.modo === 'camino-conformacion') {
        out.push(`<path d="M${n1(X(-mitadCalz))},${n1(ySup)} Q${n1(cx)},${n1(ySup - 14)} ${n1(X(mitadCalz))},${n1(ySup)}" fill="none" stroke="${pac}" stroke-width="3" stroke-dasharray="7 5"/>`);
    } else if (d.modo === 'camino-rastreo') {
        for (let i = 1; i <= 5; i++) {
            const x = X(-mitadCalz + (a * i) / 6);
            out.push(`<line x1="${n1(x - 7)}" y1="${n1(ySup - 12)}" x2="${n1(x + 7)}" y2="${n1(ySup + 2)}" stroke="${pac}" stroke-width="3" stroke-linecap="round"/>`);
        }
    } else if (espesor !== null) {
        const xr = X(mitadCalz);
        out.push(
            `<line x1="${n1(xr + 12)}" x2="${n1(xr + 12)}" y1="${n1(Y(tb))}" y2="${n1(Y(tb + espesor))}" stroke="${pac}" stroke-width="3"/>`,
            `<line x1="${n1(xr + 6)}" x2="${n1(xr + 18)}" y1="${n1(Y(tb))}" y2="${n1(Y(tb))}" stroke="${pac}" stroke-width="3"/>`,
            `<line x1="${n1(xr + 6)}" x2="${n1(xr + 18)}" y1="${n1(Y(tb + espesor))}" y2="${n1(Y(tb + espesor))}" stroke="${pac}" stroke-width="3"/>`,
        );
    }
    const rotuloPac = espesor !== null ? `espesor ${f2(espesor)} m (inferencia)` : d.modo === 'camino-revestimiento' ? 'sin reposición' : (d.rotulo ?? '');
    if (rotuloPac !== '') out.push(`<text x="${n1(cx)}" y="${n1(Math.max(26, ySup - 30))}" text-anchor="middle" font-size="18" font-weight="700" fill="${pac}">${esc(rotuloPac)}</text>`);

    // Cota del inventario (azul): ancho de la carpeta
    const yc = Y(0) + 22;
    out.push(
        `<line x1="${n1(X(-mitadCalz))}" x2="${n1(X(mitadCalz))}" y1="${n1(yc)}" y2="${n1(yc)}" stroke="${inv}" stroke-width="2.5"/>`,
        `<line x1="${n1(X(-mitadCalz))}" x2="${n1(X(-mitadCalz))}" y1="${n1(yc - 7)}" y2="${n1(yc + 7)}" stroke="${inv}" stroke-width="2.5"/>`,
        `<line x1="${n1(X(mitadCalz))}" x2="${n1(X(mitadCalz))}" y1="${n1(yc - 7)}" y2="${n1(yc + 7)}" stroke="${inv}" stroke-width="2.5"/>`,
        `<text x="${n1(cx)}" y="${n1(yc + 26)}" text-anchor="middle" font-size="18" font-weight="700" fill="${inv}">ancho ${f2(a)} m</text>`,
        `<text x="${n1(cx)}" y="${n1((Y(0) + Y(tb)) / 2 + 5)}" text-anchor="middle" font-size="18" font-weight="700" fill="#fff" stroke="#00000055" stroke-width="0.4">${esc(sup)}</text>`,
    );
    out.push('</svg>');
    return out.join('');
}
