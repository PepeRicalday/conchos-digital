import { describe, expect, it } from 'vitest';
import {
    contarPorTab, edadDias, etiquetaCategoria, haceTexto, kmDeAlerta, lugarDeAlerta, ordenaDespacho, resumenPeriodo, tabDeAlerta,
    type AlertaFila,
} from './alertasPantalla';

const AHORA = Date.parse('2026-10-07T17:00:00Z');
const dias = (n: number) => new Date(AHORA - n * 86_400_000).toISOString();
const fila = (p: Partial<AlertaFila>): AlertaFila => ({
    id: 'x', tipo_riesgo: 'warning', categoria: 'agroclimatica', titulo: 't', mensaje: null, origen_id: null, fecha_deteccion: dias(0.1), ...p,
});

describe('clasificación vigente / antigua', () => {
    it('una crítica de hoy es vigente; la de marzo es antigua; info nunca es antigua', () => {
        expect(tabDeAlerta(fila({ tipo_riesgo: 'critical' }), AHORA)).toBe('criticas');
        expect(tabDeAlerta(fila({ tipo_riesgo: 'warning', fecha_deteccion: dias(200) }), AHORA)).toBe('antiguas');
        expect(tabDeAlerta(fila({ tipo_riesgo: 'info', fecha_deteccion: dias(200) }), AHORA)).toBe('info');
    });
    it('sin fecha cuenta como antigua (nunca como de hoy)', () => {
        expect(edadDias({ fecha_deteccion: null }, AHORA)).toBe(Infinity);
        expect(tabDeAlerta(fila({ fecha_deteccion: null }), AHORA)).toBe('antiguas');
    });
    it('reproduce la fotografía del 2026-10-07: 2 críticas + 4 avisos vigentes, 21 antiguas', () => {
        const filas = [
            ...Array.from({ length: 2 }, () => fila({ tipo_riesgo: 'critical' })),
            ...Array.from({ length: 4 }, () => fila({ tipo_riesgo: 'warning' })),
            ...Array.from({ length: 21 }, () => fila({ tipo_riesgo: 'warning', categoria: 'infraestructura', fecha_deteccion: dias(200) })),
        ];
        expect(contarPorTab(filas, AHORA)).toEqual({ criticas: 2, avisos: 4, info: 0, antiguas: 21 });
    });
});

describe('orden del despacho', () => {
    it('críticas primero y, dentro de la severidad, la más vieja primero', () => {
        const o = ordenaDespacho([
            fila({ id: 'a', tipo_riesgo: 'warning', fecha_deteccion: dias(1) }),
            fila({ id: 'b', tipo_riesgo: 'critical', fecha_deteccion: dias(0.5) }),
            fila({ id: 'c', tipo_riesgo: 'warning', fecha_deteccion: dias(3) }),
        ]).map((f) => f.id);
        expect(o).toEqual(['b', 'c', 'a']);
    });
});

describe('ubicación', () => {
    it('extrae el km de títulos tipo K-23+820', () => {
        expect(kmDeAlerta({ titulo: 'Tensión en Red K-23+820', mensaje: null, origen_id: null })).toBeCloseTo(23.82, 3);
        expect(kmDeAlerta({ titulo: 'Viento fuerte', mensaje: 'sin km', origen_id: 'CLIMA-viento-abc' })).toBeNull();
    });
    it('descarta km imposibles (fuera del canal)', () => {
        expect(kmDeAlerta({ titulo: 'K-250+000', mensaje: null, origen_id: null })).toBeNull();
    });
    it('lugar: módulo, parte tras " · " o punto PE-xxx', () => {
        expect(lugarDeAlerta({ titulo: 'Viento fuerte (máx. en 48 h) · Módulo 1', origen_id: null })).toBe('Módulo 1');
        expect(lugarDeAlerta({ titulo: 'Viento fuerte · Boquilla', origen_id: null })).toBe('Boquilla');
        expect(lugarDeAlerta({ titulo: 'Tensión en Red', origen_id: 'PE-075' })).toBe('PE-075');
        expect(lugarDeAlerta({ titulo: 'Algo', origen_id: null })).toBeNull();
    });
});

describe('textos', () => {
    it('hace X', () => {
        expect(haceTexto(dias(0.0001), AHORA)).toBe('hace instantes');
        expect(haceTexto(new Date(AHORA - 3 * 3600_000).toISOString(), AHORA)).toBe('hace 3 h');
        expect(haceTexto(dias(2), AHORA)).toBe('hace 2 d');
        expect(haceTexto(null, AHORA)).toBe('sin fecha');
    });
    it('categorías conocidas y desconocidas', () => {
        expect(etiquetaCategoria('agroclimatica')).toBe('Agroclima');
        expect(etiquetaCategoria('algo_nuevo')).toBe('Algo nuevo');
        expect(etiquetaCategoria(null)).toBe('Sistema');
    });
});

describe('resumen del periodo: alertas distintas, no filas', () => {
    it('15 reaperturas de 6 estaciones son 6 alertas distintas', () => {
        const filas: AlertaFila[] = [];
        for (let i = 0; i < 15; i++) filas.push(fila({ id: `r${i}`, origen_id: `CLIMA-viento-est${i % 6}`, tipo_riesgo: i === 3 ? 'critical' : 'warning' }));
        const r = resumenPeriodo(filas);
        expect(r.distintas).toBe(6);
        expect(r.aperturas).toBe(15);
        expect(r.porCategoria).toHaveLength(1);
        expect(r.porCategoria[0]).toMatchObject({ clave: 'agroclimatica', etiqueta: 'Agroclima', distintas: 6 });
        expect(r.porCategoria[0].criticas).toBe(1);
    });
});
