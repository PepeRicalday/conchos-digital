import { describe, expect, it } from 'vitest';
import {
    CSS_FUENTE_SVG, FUENTE_SVG, bloqueFirmas, cssInforme, documentoHtml, fechaLarga, folioConPartes, hashCorto, minificaCss, nombreArchivoConPartes, tablaTrazabilidad,
    ultimoDiaIncluido, unificaFuenteSvg,
} from './informeBase';
import { construirHtmlVaso } from './informeVasoHtml';

describe('informeBase: trazabilidad', () => {
    it('hash corto estable de 8 hex: igual entrada, igual hash; entrada distinta, hash distinto', () => {
        expect(hashCorto('a')).toMatch(/^[0-9a-f]{8}$/);
        expect(hashCorto('configuración')).toBe(hashCorto('configuración'));
        expect(hashCorto('a')).not.toBe(hashCorto('b'));
    });
    it('folio y nombre de archivo con partes legibles (periodo y alcance)', () => {
        const f = new Date(2026, 9, 7, 14, 5);
        expect(folioConPartes('NDVI', ['2026-03a09', 'COMPLETO'], f)).toBe('NDVI-2026-03A09-COMPLETO-20261007-1405');
        expect(folioConPartes('NDVI', ['ra ro!', ''], f)).toBe('NDVI-RARO-20261007-1405');
        expect(nombreArchivoConPartes('informe-ndvi-conchos', ['2026-03a09', 'COMPLETO'], f)).toBe('informe-ndvi-conchos-2026-03a09-completo-2026-10-07.html');
    });
    it('fechas legibles: nunca ISO crudo; la fecha final de una ventana es exclusiva', () => {
        expect(fechaLarga('2026-09-01')).toBe('1 de septiembre de 2026');
        expect(fechaLarga(null)).toBe('S/D');
        expect(fechaLarga('basura')).toBe('S/D');
        expect(ultimoDiaIncluido('2026-10-01')).toBe('2026-09-30');
        expect(ultimoDiaIncluido('2027-01-01')).toBe('2026-12-31');
        expect(ultimoDiaIncluido('2026-03-01')).toBe('2026-02-28');
        expect(ultimoDiaIncluido(undefined)).toBeNull();
    });
    it('bloque de firmas reutilizable (Elaboró / Revisó / Autorizó) y tabla de trazabilidad escapadas', () => {
        const f = bloqueFirmas({ nombres: { Elaboró: 'Ing. <b>X</b>' } });
        for (const r of ['Elaboró', 'Revisó', 'Autorizó']) expect(f).toContain(r);
        expect(f).toContain('Ing. &lt;b&gt;X&lt;/b&gt;');
        expect(f).toContain('Nombre, cargo y firma');
        expect(bloqueFirmas({ roles: ['Solo uno'] })).not.toContain('Autorizó');
        const t = tablaTrazabilidad([{ k: 'Folio', v: 'A<B' }]);
        expect(t).toContain('<th scope="row">Folio</th><td>A&lt;B</td>');
    });
    it('documentoHtml agrega metas de trazabilidad escapadas', () => {
        const h = documentoHtml({ titulo: 'T', css: '', cuerpo: '', metas: { 'sica-folio': 'F"1' } });
        expect(h).toContain('<meta name="sica-folio" content="F&quot;1">');
        expect(documentoHtml({ titulo: 'T', css: '', cuerpo: '' })).not.toContain('sica-folio');
    });
});

describe('informeBase: compactación', () => {
    it('minificaCss quita comentarios y espacios sin cambiar reglas', () => {
        const css = '/* c */\n.a{ color: red ; }\n\n.b , .c{margin:0 auto}\n';
        expect(minificaCss(css)).toBe('.a{color:red;}.b,.c{margin:0 auto}');
        const real = cssInforme();
        const min = minificaCss(real);
        expect(min.length).toBeLessThan(real.length);
        expect(min).toContain('@page{size:letter portrait;margin:0}');
        expect(min).not.toContain('/*');
    });
    it('la tipografía de los SVG se declara una vez en el CSS y se quita de cada <text>', () => {
        const svg = `<svg><text font-size="8" font-family="${FUENTE_SVG}">x</text><text font-family="${FUENTE_SVG}">y</text></svg>`;
        expect(unificaFuenteSvg(svg)).toBe('<svg><text font-size="8">x</text><text>y</text></svg>');
        expect(CSS_FUENTE_SVG).toBe('svg text{font-family:"Segoe UI",Helvetica,Arial,sans-serif}');
        expect(cssInforme()).not.toContain('svg text'); // el CSS común no lo impone: vaso y conservación no cambian
    });
});

describe('informeBase: CSS compartido', () => {
    it('trae los componentes antes duplicados en cada informe (.run, .banda, .datos, .frase, .cols3…) y el comentario de cabecera está al día', () => {
        const css = cssInforme();
        for (const c of ['.run{', '.banda{', '.datos{', '.dato{', '.frase{', '.cols3{', '.def dt', '.nota-pie{', '.cuerpo{', '.firmas{']) expect(css, c).toContain(c);
    });
    it('el informe del vaso conserva su apariencia: su variante de .run/.cuerpo/.nota-pie se superpone al CSS compartido', () => {
        const d = { config: { secciones: [] as string[] }, nombrePresa: 'La Boquilla', folioPrefijo: 'VASO', ahora: new Date(2026, 9, 7), avisos: [], escenas: [], estado: {} } as never;
        const h = construirHtmlVaso(d, { srl: '', sica: '' });
        expect(h).toContain('.run{gap:10px;letter-spacing:normal;text-transform:none;border-bottom-width:2px');
        expect(h).toContain('.cuerpo{display:flex;flex-direction:column;gap:10px}');
        expect(h).toContain('.nota-pie{margin-top:0}');
        // el CSS de vaso va después del compartido: gana la variante
        expect(h.indexOf('.run{display:flex;justify-content:space-between')).toBeLessThan(h.indexOf('.run{gap:10px'));
    });
});
