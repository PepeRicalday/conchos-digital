import { describe, it, expect } from 'vitest';
import { agrupaConversaciones, celda, edadTexto, grupoDeFecha, hrefSeguro, sugerencias, tablaATsv } from './consultoria';

describe('sugerencias', () => {
    it('en vaciado ofrece consultas de vaciado y ninguna sin base (CONAGUA, proyecciones)', () => {
        const s = sugerencias('VACIADO').map((x) => x.texto).join(' | ');
        expect(s).toMatch(/vaciado/i);
        expect(s).not.toMatch(/CONAGUA|proyecci/i);
    });
    it('reconoce ESTABILIZACIÓN con tilde y LLENADO; sin evento ofrece balance y eficiencia', () => {
        expect(sugerencias('LLENADO')[0].contexto).toBe('hidraulica');
        expect(sugerencias('ESTABILIZACIÓN').map((x) => x.texto).join()).toMatch(/balance de continuidad/);
        expect(sugerencias(null).length).toBeGreaterThanOrEqual(4);
    });
    it('todos los contextos son los que el servidor acepta', () => {
        for (const ev of ['VACIADO', 'LLENADO', 'ESTABILIZACION', null]) {
            for (const s of sugerencias(ev)) expect(['general', 'operacion', 'balance', 'hidraulica']).toContain(s.contexto);
        }
    });
});

describe('historial', () => {
    it('grupoDeFecha', () => {
        expect(grupoDeFecha('2026-10-18', '2026-10-18')).toBe('Hoy');
        expect(grupoDeFecha('2026-10-17', '2026-10-18')).toBe('Ayer');
        expect(grupoDeFecha('2026-10-13', '2026-10-18')).toBe('Esta semana');
        expect(grupoDeFecha('2026-10-01', '2026-10-18')).toBe('Anteriores');
    });
    it('agrupa en orden fijo, conserva el orden recibido y filtra sin importar tildes/mayúsculas', () => {
        const dia = (iso: string) => iso.slice(0, 10);
        const items = [
            { id: '1', titulo: 'Balance del canal', updated_at: '2026-10-18T10:00:00Z' },
            { id: '2', titulo: 'Estado de PRESAS', updated_at: '2026-10-17T10:00:00Z' },
            { id: '3', titulo: 'Otra consulta', updated_at: '2026-09-01T10:00:00Z' },
        ];
        const g = agrupaConversaciones(items, '2026-10-18', dia);
        expect(g.map((x) => x.grupo)).toEqual(['Hoy', 'Ayer', 'Anteriores']);
        expect(agrupaConversaciones(items, '2026-10-18', dia, 'balánce').map((x) => x.items[0].id)).toEqual(['1']);
        expect(agrupaConversaciones(items, '2026-10-18', dia, 'presas')[0].items[0].id).toBe('2');
        expect(agrupaConversaciones(items, '2026-10-18', dia, 'zzz')).toEqual([]);
    });
});

describe('tablas', () => {
    it('celda: null/vacío/NaN → S/D, nunca 0', () => {
        expect(celda(null)).toBe('S/D');
        expect(celda(undefined)).toBe('S/D');
        expect(celda('')).toBe('S/D');
        expect(celda(NaN)).toBe('S/D');
        expect(celda(0)).toBe('0');                 // un cero REAL sí se muestra
        expect(celda(25.6612)).toBe('25.661');
        expect(celda('Boquilla')).toBe('Boquilla');
    });
    it('tablaATsv conserva S/D y limpia tabuladores', () => {
        const tsv = tablaATsv({ columnas: ['Presa', 'Llenado %'], filas: [['Bo\tquilla', 25.66], ['Madero', null]] });
        expect(tsv).toBe('Presa\tLlenado %\nBo quilla\t25.66\nMadero\tS/D');
    });
});

describe('edadTexto y enlaces', () => {
    it('edadTexto', () => {
        expect(edadTexto(null)).toBe('S/D');
        expect(edadTexto(30_000)).toBe('hace un momento');
        expect(edadTexto(5 * 60_000)).toBe('hace 5 min');
        expect(edadTexto(3 * 3_600_000)).toBe('hace 3 h');
        expect(edadTexto(72 * 3_600_000)).toBe('hace 3 días');
    });
    it('hrefSeguro descarta esquemas peligrosos', () => {
        expect(hrefSeguro('https://conagua.gob.mx')).toBe('https://conagua.gob.mx');
        expect(hrefSeguro('mailto:a@b.mx')).toBe('mailto:a@b.mx');
        expect(hrefSeguro('javascript:alert(1)')).toBeNull();
        expect(hrefSeguro('data:text/html;base64,AAA')).toBeNull();
        expect(hrefSeguro(undefined)).toBeNull();
    });
});
