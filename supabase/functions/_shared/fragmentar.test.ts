import { describe, expect, it } from 'vitest';
import { encabezadoContexto, esTitulo, fragmentar, limpiaPagina, paginasSinTexto, textoParaVector } from './fragmentar';

const parrafo = (n: number, palabra = 'canal') => Array.from({ length: n }, (_, i) => `${palabra}${i}`).join(' ') + '.';

describe('limpiaPagina', () => {
    it('une palabras cortadas con guion al final de línea y compacta espacios', () => {
        expect(limpiaPagina('desa-\nzolve   del\r\ncanal')).toBe('desazolve del\ncanal');
    });
});

describe('esTitulo', () => {
    it.each([
        ['4.2.1 Desazolve de canales', true],
        ['ANEXO 3', true],
        ['CAPÍTULO II Conservación normal', true],
        ['3. Maquinaria', true],
        ['El canal se desazolva cada año.', false],
        ['2026', false],
        ['x'.repeat(130), false],
    ])('%s → %s', (linea, esperado) => expect(esTitulo(linea)).toBe(esperado));
});

describe('paginasSinTexto', () => {
    it('detecta páginas vacías o casi vacías (candidatas a OCR)', () => {
        expect(paginasSinTexto([{ pagina: 1, texto: parrafo(30) }, { pagina: 2, texto: '  12 ' }, { pagina: 3, texto: '' }])).toEqual([2, 3]);
    });
});

describe('fragmentar', () => {
    it('conserva páginas de inicio y fin', () => {
        const f = fragmentar([{ pagina: 7, texto: parrafo(40) }, { pagina: 8, texto: parrafo(40, 'bordo') }], { maxChars: 2000 });
        expect(f).toHaveLength(1);
        expect(f[0].pagina_ini).toBe(7);
        expect(f[0].pagina_fin).toBe(8);
    });

    it('ningún fragmento rebasa maxChars + solape y todos tienen contenido', () => {
        const paginas = Array.from({ length: 5 }, (_, i) => ({ pagina: i + 1, texto: parrafo(200) }));
        const f = fragmentar(paginas, { maxChars: 800, solape: 120 });
        expect(f.length).toBeGreaterThan(3);
        for (const x of f) {
            expect(x.contenido.length).toBeLessThanOrEqual(800 + 120 + 2);
            expect(x.contenido.trim().length).toBeGreaterThan(0);
        }
    });

    it('el fragmento siguiente repite el final del anterior (solapamiento) en límite de palabra', () => {
        const f = fragmentar([{ pagina: 1, texto: parrafo(400) }], { maxChars: 600, solape: 100 });
        expect(f.length).toBeGreaterThan(1);
        const cabeza = f[1].contenido.slice(0, 40);
        expect(f[0].contenido.slice(-100)).toContain(cabeza);
        const primeraPalabra = f[1].contenido.split(' ')[0];
        expect(f[0].contenido.split(' ')).toContain(primeraPalabra);      // empieza en palabra completa, no a media palabra
    });

    it('un título es corte duro y define la sección del fragmento', () => {
        const texto = `${parrafo(30)}\n\n4.2 Desazolve de canales\n${parrafo(30, 'lodo')}\n\nANEXO 3\n${parrafo(30, 'precio')}`;
        const f = fragmentar([{ pagina: 12, texto }], { maxChars: 3000 });
        expect(f.map((x) => x.seccion)).toEqual([null, '4.2 Desazolve de canales', 'ANEXO 3']);
        expect(f[1].contenido.startsWith('4.2 Desazolve de canales')).toBe(true);
        expect(f[1].contenido).not.toContain('canal0');     // sin solapamiento entre secciones distintas
    });

    it('un fragmento final diminuto de la misma sección se une al anterior', () => {
        const f = fragmentar([{ pagina: 1, texto: `${parrafo(130)} fin.` }], { maxChars: 900, solape: 0, minChars: 200 });
        expect(f[f.length - 1].contenido.endsWith('fin.')).toBe(true);
        expect(f.every((x) => x.contenido.length >= 200 || f.length === 1)).toBe(true);
    });

    it('documento vacío no produce fragmentos', () => {
        expect(fragmentar([{ pagina: 1, texto: '   ' }])).toEqual([]);
    });

    it('ordena los fragmentos de forma consecutiva', () => {
        const f = fragmentar([{ pagina: 1, texto: parrafo(500) }], { maxChars: 500 });
        expect(f.map((x) => x.orden)).toEqual(f.map((_, i) => i));
    });
});

describe('encabezado de contexto', () => {
    it('incluye título, sección y páginas', () => {
        expect(encabezadoContexto('Manual de Conservación 2026', { seccion: '4.2 Desazolve', pagina_ini: 45, pagina_fin: 46 }))
            .toBe('[Manual de Conservación 2026 · 4.2 Desazolve · pp. 45–46]');
        expect(encabezadoContexto('Anexo 7', { seccion: null, pagina_ini: 3, pagina_fin: 3 })).toBe('[Anexo 7 · p. 3]');
    });
    it('el texto para el vector lleva el encabezado y el contenido', () => {
        const f = fragmentar([{ pagina: 2, texto: parrafo(20) }])[0];
        expect(textoParaVector('Doc', f)).toMatch(/^\[Doc · p\. 2\]\ncanal0/);
    });
});
