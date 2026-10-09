import { describe, expect, it } from 'vitest';
import { leerInforme, type ArchivoInforme } from '../conservacion/informe/esquemaInforme';
import { informeDePrueba } from '../conservacion/pruebas/ayuda/informeDePrueba';
import { generarHtmlInformeConservacion } from './informeConservacion';

function archivo(): ArchivoInforme {
    const r = leerInforme(informeDePrueba());
    if (!r.ok) throw new Error(r.error);
    return r.archivo;
}

describe('informe imprimible de SICA Conservación', () => {
    const html = generarHtmlInformeConservacion(archivo(), { logoSrl: 'data:image/png;base64,AAAA', logoSica: 'data:image/png;base64,BBBB' });

    it('escapa el texto que viene del PacOT: no se inyecta HTML', () => {
        expect(html).toContain('Concreto &lt;b&gt;no&lt;/b&gt; concilia');
        expect(html).not.toContain('Concreto <b>no</b>');
    });

    it('lleva los dos logos institucionales incrustados y la identidad de la SRL', () => {
        expect(html).toContain('data:image/png;base64,AAAA');
        expect(html).toContain('data:image/png;base64,BBBB');
        expect(html).toContain('Unidad Conchos');
    });

    it('declara el alcance: cobertura parcial y "sin hallazgos no equivale a correcto"', () => {
        expect(html).toContain('3 de 4 reglas');
        expect(html).toContain('no equivale a que el programa sea correcto');
    });

    it('muestra la regla no implementada como tal y las cifras del resumen', () => {
        expect(html).toContain('No implementada');
        expect(html).toContain('Sin datos');
        expect(html).toContain('Severidad alta');
    });

    it('numera las páginas con el total real', () => {
        const total = (html.match(/class="pagina"/g) ?? []).length;
        expect(total).toBeGreaterThan(1);
        expect(html).toContain(`Pág. 1 de ${total}`);
        expect(html).toContain(`Pág. ${total} de ${total}`);
    });

    it('es un documento autónomo con folio determinista a partir de la fecha del informe', () => {
        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toMatch(/SCONS-20261009-\d{4}/);
        expect(generarHtmlInformeConservacion(archivo(), { logoSrl: 'x' })).toBe(generarHtmlInformeConservacion(archivo(), { logoSrl: 'x' }));
    });
});
