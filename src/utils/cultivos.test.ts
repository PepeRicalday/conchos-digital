import { describe, expect, it } from 'vitest';
import {
    CATALOGO_CULTIVOS, CULTIVO_OTROS, claveCultivo, esNombreCompuesto, esCultivoCatalogado, fondoTramaCss, iconoCultivoG, iconoCultivoSvg, infoCultivo, patronTrama, tintaSobre,
} from './cultivos';

// Cultivos reales de superficie_volumen_anual_modulo (ACUM_INF) al 2026-11-03.
const CULTIVOS_BD = ['Alfalfa', 'Algodón', 'Avena', 'Cacahuate', 'Camote', 'Cebolla', 'Chile', 'Maíz', 'Nogal', 'Sandía', 'Sorgo', 'Trigo', 'Varios'];

const lum = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const SUPERFICIE_OSCURA = '#101a2e';

describe('claveCultivo', () => {
    it('quita acentos, mayúsculas y espacios', () => {
        expect(claveCultivo('Maíz')).toBe('maiz');
        expect(claveCultivo('  SANDÍA ')).toBe('sandia');
        expect(claveCultivo('Algodón')).toBe('algodon');
        expect(claveCultivo(null)).toBe('');
        expect(claveCultivo(undefined)).toBe('');
    });
});

describe('catálogo de cultivos', () => {
    it('cubre todos los cultivos de la base de datos con su nombre exacto', () => {
        for (const c of CULTIVOS_BD) {
            const i = infoCultivo(c);
            expect(i.fallback, c).toBeFalsy();
            expect(i.nombre).toBe(c);
        }
    });
    it('resuelve variantes de escritura (acentos, mayúsculas, plural de la fuente)', () => {
        expect(infoCultivo('MAIZ').nombre).toBe('Maíz');
        expect(infoCultivo('algodon').nombre).toBe('Algodón');
        expect(infoCultivo('Nogal pecanero').nombre).toBe('Nogal');
        expect(infoCultivo('Varios cultivos').nombre).toBe('Varios');
        expect(esCultivoCatalogado('Sandía')).toBe(true);
    });
    it('un cultivo nuevo recibe fallback estable (mismo color siempre) con ícono de hoja y su propio nombre', () => {
        const a = infoCultivo('Quinoa'), b = infoCultivo('Quinoa');
        expect(a.fallback).toBe(true);
        expect(a.nombre).toBe('Quinoa');
        expect(a.color).toBe(b.color);
        expect(a.icono.length).toBeGreaterThan(10);
        expect(esCultivoCatalogado('Quinoa')).toBe(false);
        expect(infoCultivo('Quinoa').color).not.toBe(infoCultivo('Otros').color);
    });
    it('«Otros» tiene identidad propia y neutra; un nombre vacío no revienta', () => {
        expect(infoCultivo('Otros 5 cultivos')).toBe(CULTIVO_OTROS);
        expect(infoCultivo('Otros').nombre).toBe('Otros');
        expect(infoCultivo('').nombre).toBe('Sin nombre');
    });
    it('alias: «Otros cultivos» de la fuente es «Varios» (no «Otros»); nombres compuestos con «/», «-» o « y » caen en «Otros»', () => {
        expect(infoCultivo('Otros cultivos')).toBe(infoCultivo('Varios'));
        expect(infoCultivo('Otros cultivos').nombre).toBe('Varios');
        for (const n of ['Maíz/Frijol', 'Chile - Cebolla', 'Alfalfa-Maíz', 'Alfalfa y Maíz', 'Trigo Y Avena']) {
            expect(esNombreCompuesto(n), n).toBe(true);
            expect(infoCultivo(n), n).toBe(CULTIVO_OTROS);
        }
        expect(esNombreCompuesto('Maíz forrajero')).toBe(false);
        expect(infoCultivo('Maíz forrajero').nombre).toBe('Maíz');
    });
    it('«Otros» se distingue de «Varios» (color y trama propia, distinta de la de Maíz y Sandía) y Trigo/Avena se separan de Maíz/Cacahuate', () => {
        const varios = infoCultivo('Varios');
        expect(CULTIVO_OTROS.trama).toBe('onda');
        expect(CATALOGO_CULTIVOS.some(c => c.trama === 'onda')).toBe(false);
        expect(lum(varios.color) / lum(CULTIVO_OTROS.color)).toBeGreaterThan(1.7);
        expect(contraste(CULTIVO_OTROS.color, SUPERFICIE_OSCURA)).toBeGreaterThanOrEqual(3);
        expect(contraste(CULTIVO_OTROS.colorClaro, '#ffffff')).toBeGreaterThanOrEqual(3);
        const luz = (n: string) => lum(infoCultivo(n).color);
        expect(luz('Maíz') / luz('Trigo')).toBeGreaterThan(1.5);
        expect(infoCultivo('Trigo').color).toBe('#C98A12');
        expect(infoCultivo('Avena').color).toBe('#B7B96A');
    });
    it('cada cultivo tiene color y color claro únicos, ícono y clave única', () => {
        const colores = CATALOGO_CULTIVOS.map(c => c.color.toLowerCase());
        const claros = CATALOGO_CULTIVOS.map(c => c.colorClaro.toLowerCase());
        const claves = CATALOGO_CULTIVOS.map(c => c.clave);
        expect(new Set(colores).size).toBe(colores.length);
        expect(new Set(claros).size).toBe(claros.length);
        expect(new Set(claves).size).toBe(claves.length);
        for (const c of CATALOGO_CULTIVOS) {
            expect(c.icono, c.nombre).toMatch(/</);
            expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(c.colorClaro).toMatch(/^#[0-9a-f]{6}$/i);
        }
        const iconos = CATALOGO_CULTIVOS.map(c => c.icono);
        expect(new Set(iconos).size).toBe(iconos.length);
    });
    it('contraste de la marca ≥ 3:1 contra la tarjeta oscura (color) y contra blanco (color claro)', () => {
        for (const c of CATALOGO_CULTIVOS) {
            expect(contraste(c.color, SUPERFICIE_OSCURA), `${c.nombre} oscuro`).toBeGreaterThanOrEqual(3);
            expect(contraste(c.colorClaro, '#ffffff'), `${c.nombre} claro`).toBeGreaterThanOrEqual(3);
        }
    });
    it('la tinta del texto sobre cada color tiene contraste ≥ 4.5:1', () => {
        for (const c of CATALOGO_CULTIVOS) {
            for (const col of [c.color, c.colorClaro]) expect(contraste(tintaSobre(col), col), `${c.nombre} ${col}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(tintaSobre('#F2C230')).toBe('#0b1220');
        expect(tintaSobre('#7A4A1C')).toBe('#ffffff');
        expect(tintaSobre('hsl(40 38% 68%)')).toBe('#0b1220');
        expect(tintaSobre('hsl(40 40% 34%)')).toBe('#ffffff');
    });
    it('los cultivos más fuertes (alfalfa, nogal, maíz, chile) se distinguen entre sí en luminosidad o tono', () => {
        const top = ['Alfalfa', 'Nogal', 'Maíz', 'Chile'].map(c => infoCultivo(c).color);
        expect(new Set(top).size).toBe(4);
        // Semántica pedida: alfalfa verde, maíz amarillo, chile rojo.
        const canal = (h: string, k: number) => parseInt(h.slice(1 + k * 2, 3 + k * 2), 16);
        expect(canal(infoCultivo('Alfalfa').color, 1)).toBeGreaterThan(canal(infoCultivo('Alfalfa').color, 0));
        expect(canal(infoCultivo('Chile').color, 0)).toBeGreaterThan(canal(infoCultivo('Chile').color, 1) * 2);
        expect(canal(infoCultivo('Maíz').color, 0)).toBeGreaterThan(200);
        expect(canal(infoCultivo('Maíz').color, 1)).toBeGreaterThan(160);
    });
});

describe('salidas para el informe', () => {
    it('ícono SVG independiente: aria-hidden y color heredable; sin NaN ni undefined', () => {
        const s = iconoCultivoSvg('Maíz', 14, '#A87F00');
        expect(s).toContain('aria-hidden="true"');
        expect(s).toContain('viewBox="0 0 24 24"');
        expect(s).not.toMatch(/NaN|undefined/);
        const g = iconoCultivoG('Nogal', 10, 20, 12, '#7A4A1C');
        expect(g).toContain('translate(10.0 20.0)');
        expect(g).toContain('scale(0.500)');
    });
    it('cada trama produce un patrón (excepto lisa) y un fondo CSS', () => {
        expect(patronTrama('x', 'liso', '#000')).toContain('<pattern id="x"');
        expect(patronTrama('x', 'cruz', '#000')).toContain('M4 0V8');
        for (const t of ['diag', 'diag-inv', 'puntos', 'cruz', 'horiz', 'vert', 'onda'] as const) expect(fondoTramaCss(t, '#fff')).toContain('#fff');
        expect(fondoTramaCss('liso', '#abc')).toBe('#abc');
    });
});
