import { describe, expect, it } from 'vitest';
import { ANCHO_INFOGRAFIA, htmlInfografiaPresas } from './infografiaPresasHtml';
import type { DatosInfografia, DatosPresaInfografia } from './infografiaPresas';

const vacia = (id: 'PRE-001' | 'PRE-002', nombre: string): DatosPresaInfografia => ({
    id, nombre, volumen: null, pct: null, capacidad: null, fechaDato: null, delta: null, anioPrevio: null,
    posicion: null, posicionTexto: null, semaforo: 'sd', elevacion: null, procedencia: null, salida: null,
});

const completo: DatosInfografia = {
    presas: [
        {
            id: 'PRE-001', nombre: 'La Boquilla', volumen: 704.246, pct: 24.738336, capacidad: 2846.78, fechaDato: '2026-10-06',
            delta: { mm3: 1.78, puntosPct: 0.063, desde: '2026-10-04', dias: 2 },
            anioPrevio: { anio: 2025, fecha: '2025-10-06', valor: 1105, difMm3: -400.754 },
            posicion: { posicion: 2, de: 6, desdeAnio: 2021 }, posicionTexto: '2.º más bajo desde 2021',
            semaforo: 'rojo', elevacion: 1297, procedencia: 'CILA', salida: 12.5,
        },
        {
            id: 'PRE-002', nombre: 'Francisco I. Madero', volumen: 164.083, pct: 49.227164, capacidad: 333.318, fechaDato: '2026-10-06',
            delta: { mm3: -0.219, puntosPct: -0.066, desde: '2026-10-05', dias: 1 },
            anioPrevio: { anio: 2025, fecha: '2025-10-06', valor: 150, difMm3: 14.083 },
            posicion: { posicion: 5, de: 6, desdeAnio: 2021 }, posicionTexto: '5.º más bajo desde 2021',
            semaforo: 'verde', elevacion: 1250.5, procedencia: 'CAMPO', salida: 0,
        },
    ],
    conjunto: { totalMm3: 868.329, presasConDato: 2, presasTotal: 2, parcial: false },
    corte: { fechaDato: '2026-10-06', instante: null, texto: 'Corte: 06 de octubre de 2026 · 08:30 h' },
    vigencia: { estado: 'ACTUALIZADO', texto: 'hace 2 h' },
    fuente: 'Fuente: IBWC.',
    limitacion: 'No equivale a volumen autorizado.',
};

const sinDatos: DatosInfografia = {
    presas: [vacia('PRE-001', 'La Boquilla'), vacia('PRE-002', 'Francisco I. Madero')],
    conjunto: { totalMm3: null, presasConDato: 0, presasTotal: 2, parcial: true },
    corte: { fechaDato: null, instante: null, texto: null },
    vigencia: { estado: 'SD', texto: 'S/D' },
    fuente: 'Fuente: IBWC.',
    limitacion: 'Limitación.',
};

describe('htmlInfografiaPresas', () => {
    it('caso completo: cifras es-MX y sin valores basura', () => {
        const h = htmlInfografiaPresas(completo, '');
        for (const t of ['704.246', '24.738', '868.329', '2,846.78', '(Las Vírgenes)', '+1.780', 'vs 04 oct', 'VERDE · tercio superior histórico', 'ROJO · tercio inferior', '2.º más bajo desde 2021']) {
            expect(h).toContain(t);
        }
        expect(h).not.toMatch(/NaN|undefined|null/);
        expect(h).toContain(`width:${ANCHO_INFOGRAFIA}px`);
    });
    it('caso vacío: S/D, nunca cero ni basura', () => {
        const h = htmlInfografiaPresas(sinDatos, '');
        expect(h).toContain('S/D');
        expect(h).toContain('Corte: S/D');
        expect(h).toContain('SIN CLASIFICAR (S/D)');
        expect(h).toContain('parcial: 0 de 2 presas');
        expect(h).not.toMatch(/NaN|undefined|null/);
        expect(h).not.toMatch(/0.000 (hm|%)/);
    });
    it('escapa texto dinámico y usa logo cuando existe', () => {
        const d = { ...completo, fuente: '<script>x</script>' };
        const h = htmlInfografiaPresas(d, 'data:image/png;base64,AAAA');
        expect(h).not.toContain('<script>');
        expect(h).toContain('data:image/png;base64,AAAA');
    });
});
