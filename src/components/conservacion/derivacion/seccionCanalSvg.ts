import type { DiagramaComp } from '../../../conservacion/verificacion/comprobacion';
import { EXAGERACION_VERTICAL } from './seccionLeyenda';

/** Colores que cambian entre la app (variables CSS del tema oscuro) y la infografía (hexadecimales sobre fondo claro). */
export interface PaletaSeccion {
    /** Cotas que fija el PacOT (ancho de franja, espesor de azolve, rótulos). */
    readonly pac: string;
    /** Cotas que vienen del inventario (plantilla). */
    readonly inv: string;
    /** Línea del hombro. */
    readonly hombro: string;
    /** Texto tenue de lo ilustrativo (caminos); si falta se usa un gris cálido. */
    readonly tenue?: string;
}

export const PALETA_APP: PaletaSeccion = { pac: 'var(--o-pac)', inv: 'var(--o-inv)', hombro: 'var(--sc-crit)', tenue: '#b8ad92' };
export const PALETA_INFOGRAFIA: PaletaSeccion = { pac: '#6D3FC0', inv: '#1C5E95', hombro: '#B3261E', tenue: '#5E533C' };

const f2 = (x: number): string => x.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (x: number): string => x.toFixed(1);

export interface OpcionesSeccion {
    /** Identificador del patrón de hierba (único si hay varios dibujos en la misma página). */
    readonly idPatron?: string;
    /** Estilo en línea del <svg>. */
    readonly estilo?: string;
}

/** Sección tipo de lo que el concepto toca, como cadena <svg>. null si el inventario no trae plantilla, talud, tirante o libre bordo. */
export function seccionCanalSvg(d: DiagramaComp, paleta: PaletaSeccion, op: OpcionesSeccion = {}): string | null {
    const { b, z, d: tir, lb } = d;
    if (b === null || z === null || tir === null || lb === null) return null;
    const idPatron = op.idPatron ?? 'cons-sec-hierba';
    const H = tir + lb;
    const hb = b / 2;
    const ht = hb + z * H;
    const franja = d.modo === 'limpia' && d.anchoFranja !== null ? d.anchoFranja : 0;
    const mitad = ht + Math.max(franja, ht * 0.3, 3.2);
    const W = 480;
    const S = (W - 24) / (2 * mitad);
    const V = S * EXAGERACION_VERTICAL;
    const cx = W / 2;
    const yTop = 58;
    const alto = Math.round(yTop + H * V + 46);
    const X = (x: number): number => cx + x * S;
    const Y = (y: number): number => yTop + (H - y) * V;
    const P = (pts: ReadonlyArray<readonly [number, number]>): string => pts.map(([x, y]) => `${n1(X(x))},${n1(Y(y))}`).join(' ');
    const hAz = d.modo === 'desazolve' && d.h !== null ? Math.min(d.h, tir) : 0;
    const { pac, inv, hombro } = paleta;
    const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const out: string[] = [];

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${alto}" role="img" aria-label="${esc(`Sección trapecial: plantilla ${f2(b)} m, talud ${f2(z)}, tirante ${f2(tir)} m, libre bordo ${f2(lb)} m.`)}" style="${op.estilo ?? 'width:100%;height:auto'}">`);
    out.push(`<defs><pattern id="${idPatron}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#7cb342"/><line x1="0" y1="0" x2="0" y2="7" stroke="#33691e" stroke-width="2"/></pattern></defs>`);
    out.push(`<polygon points="${P([[-mitad, H], [mitad, H], [mitad, -0.7], [-mitad, -0.7]])}" fill="#8b7d63" opacity="0.5"/>`);

    if (d.modo === 'limpia' && franja > 0) {
        for (const s of [-1, 1]) {
            const a = s * ht, c = s * (ht + franja);
            const xa = X(a), xc = X(c);
            out.push(
                `<g>`,
                `<rect x="${n1(Math.min(xa, xc))}" y="${n1(Y(H) - 7)}" width="${n1(Math.abs(xc - xa))}" height="7" fill="url(#${idPatron})" stroke="#33691e" stroke-width="1.2"/>`,
                `<line x1="${n1(xa)}" x2="${n1(xc)}" y1="${n1(Y(H) - 20)}" y2="${n1(Y(H) - 20)}" stroke="${pac}" stroke-width="2"/>`,
                `<line x1="${n1(xa)}" x2="${n1(xa)}" y1="${n1(Y(H) - 26)}" y2="${n1(Y(H) - 14)}" stroke="${pac}" stroke-width="2"/>`,
                `<line x1="${n1(xc)}" x2="${n1(xc)}" y1="${n1(Y(H) - 26)}" y2="${n1(Y(H) - 14)}" stroke="${pac}" stroke-width="2"/>`,
                `<text x="${n1((xa + xc) / 2)}" y="${n1(Y(H) - 29)}" text-anchor="middle" font-size="18" font-weight="700" fill="${pac}">${f2(franja)} m</text>`,
                `<line x1="${n1(xa)}" x2="${n1(xa)}" y1="${n1(Y(H) - 14)}" y2="${n1(Y(H) + 30)}" stroke="${hombro}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
                `</g>`,
            );
        }
    }
    if (d.modo === 'descopete' || d.modo === 'terracerias') {
        for (const s of [-1, 1]) out.push(`<polygon points="${P([[s * (ht - 0.3), H], [s * (ht + 2.6), H], [s * (ht + 0.9), H + 1.3]])}" fill="#ef9a3c" stroke="#b25e00" stroke-width="1.5"/>`);
        if (d.rotulo) out.push(`<text x="${n1(cx)}" y="${n1(Y(H) - 14)}" text-anchor="middle" font-size="18" font-weight="700" fill="${pac}">${esc(d.rotulo)}</text>`);
    }
    out.push(`<polygon points="${P([[-hb, 0], [hb, 0], [ht, H], [-ht, H]])}" fill="#dfeaf5" opacity="0.92"/>`);
    out.push(`<polygon points="${P([[-hb - z * tir, tir], [hb + z * tir, tir], [hb, 0], [-hb, 0]])}" fill="#4fa3e0" opacity="0.9"/>`);
    if (hAz > 0) {
        out.push(`<polygon points="${P([[-hb, 0], [hb, 0], [hb + z * hAz, hAz], [-hb - z * hAz, hAz]])}" fill="#8d6e3f" stroke="#5d4524" stroke-width="1.2"/>`);
        const xl = X(-hb - z * hAz);
        out.push(
            `<g><line x1="${n1(xl - 6)}" x2="${n1(xl - 6)}" y1="${n1(Y(0))}" y2="${n1(Y(hAz))}" stroke="${pac}" stroke-width="2"/>`,
            `<text x="${n1(xl - 12)}" y="${n1(Y(hAz / 2) + 5)}" text-anchor="end" font-size="18" font-weight="700" fill="${pac}">h ${f2(hAz)} m</text></g>`,
        );
    }
    if (d.modo === 'acuaticas') out.push(`<line x1="${n1(X(-hb))}" x2="${n1(X(hb))}" y1="${n1(Y(0) - 3)}" y2="${n1(Y(0) - 3)}" stroke="#43a047" stroke-width="7" stroke-linecap="round"/>`);
    const rev = d.modo === 'revestimiento';
    out.push(`<polyline points="${P([[-ht, H], [-hb, 0], [hb, 0], [ht, H]])}" fill="none" stroke="${rev ? '#ef9a3c' : '#aab8c8'}" stroke-width="${rev ? 6 : 5}" stroke-linejoin="round" stroke-linecap="round"${rev ? ' stroke-dasharray="12 7"' : ''}/>`);
    // T-25: el tirante va como cota al costado del talud (dato del inventario, azul) y no como rótulo blanco montado sobre el agua.
    {
        const xr = Math.min(X(ht), W - 24 - 82);
        out.push(
            `<g><line x1="${n1(xr + 12)}" x2="${n1(xr + 12)}" y1="${n1(Y(0))}" y2="${n1(Y(tir))}" stroke="${inv}" stroke-width="2"/>`,
            `<line x1="${n1(xr + 6)}" x2="${n1(xr + 18)}" y1="${n1(Y(0))}" y2="${n1(Y(0))}" stroke="${inv}" stroke-width="2"/>`,
            `<line x1="${n1(xr + 6)}" x2="${n1(xr + 18)}" y1="${n1(Y(tir))}" y2="${n1(Y(tir))}" stroke="${inv}" stroke-width="2"/>`,
            `<text x="${n1(xr + 24)}" y="${n1(Y(tir / 2) + 6)}" text-anchor="start" font-size="18" font-weight="700" fill="${inv}">d ${f2(tir)} m</text></g>`,
        );
    }
    out.push(`<text x="${n1(cx)}" y="${n1(Y(0) + 22)}" text-anchor="middle" font-size="18" font-weight="700" fill="${inv}">b ${f2(b)} m</text>`);
    if (rev && d.rotulo) out.push(`<text x="${n1(cx)}" y="${n1(Y(0) - 10)}" text-anchor="middle" font-size="18" font-weight="700" fill="${pac}">${esc(d.rotulo)}</text>`);
    out.push('</svg>');
    return out.join('');
}
