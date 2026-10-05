import { describe, it, expect } from 'vitest';
import { interpolarElevacion, resolverNivel, curvaValida, MARCA_CILA } from '../../supabase/functions/presas-cila-sync/resolver';
import { estadoReporteCila, fechaLocalChihuahua } from '../../supabase/functions/presas-cila-sync/vigencia';

const curva = [
    { elevacion_msnm: 1296.0, volumen_mm3: 646.0 },
    { elevacion_msnm: 1297.0, volumen_mm3: 706.0 },
];

describe('interpolarElevacion', () => {
    it('interpola linealmente entre dos puntos', () => {
        expect(interpolarElevacion(curva, 676)).toBe(1296.5);
    });
    it('fuera de curva o sin curva → null (nunca inventa)', () => {
        expect(interpolarElevacion(curva, 100)).toBeNull();
        expect(interpolarElevacion(curva, 9999)).toBeNull();
        expect(interpolarElevacion([], 700)).toBeNull();
    });
});

describe('curvaValida — protege contra curvas placeholder', () => {
    it('curva que reproduce la elevación de conservación → válida', () => {
        const c = [{ elevacion_msnm: 1316.99, volumen_mm3: 2846.0 }, { elevacion_msnm: 1317.01, volumen_mm3: 2847.5 }];
        expect(curvaValida(c, 2846.78, 1317)).toBe(true);
    });
    it('curva de Madero (1180 msnm a 333.32 Mm³ vs 1239.3 publicado) → inválida', () => {
        const c = [{ elevacion_msnm: 1145, volumen_mm3: 300 }, { elevacion_msnm: 1180, volumen_mm3: 333.32 }];
        expect(curvaValida(c, 333.318, 1239.3)).toBe(false);
    });
    it('sin datos de conservación → inválida', () => {
        expect(curvaValida([], null, null)).toBe(false);
    });
});

describe('resolverNivel — el campo prevalece sobre CILA', () => {
    it('sin almacenamiento CILA → sin_dato', () => {
        expect(resolverNivel(null, null, 2893.571, curva).accion).toBe('sin_dato');
    });
    it('sin lectura previa → insertar con % sobre NAMO SICA (no sobre conservación CILA)', () => {
        const r = resolverNivel(null, 702.466, 2893.571, [{ elevacion_msnm: 1296, volumen_mm3: 646 }, { elevacion_msnm: 1297, volumen_mm3: 706 }]);
        expect(r.accion).toBe('insertar');
        expect(r.valores!.porcentaje_llenado).toBeCloseTo(24.28, 2);
        expect(r.valores!.escala_msnm).toBeCloseTo(1296.94, 2);
        expect(r.notas).toContain(MARCA_CILA);
    });
    it('lectura de campo con almacenamiento → campo_prevalece', () => {
        const r = resolverNivel({ almacenamiento_mm3: 646.69, escala_msnm: 1296.01, porcentaje_llenado: 22.35, notas: null }, 702.466, 2893.571, curva);
        expect(r.accion).toBe('campo_prevalece');
        expect(r.valores).toBeNull();
    });
    it('fila solo de gasto (sin nivel) → actualizar solo nivel y conservar notas', () => {
        const r = resolverNivel({ almacenamiento_mm3: null, escala_msnm: null, porcentaje_llenado: null, notas: 'cierre de compuertas' }, 702.466, 2893.571, curva);
        expect(r.accion).toBe('actualizar');
        expect(r.notas).toContain('cierre de compuertas');
    });
    it('fila propia de CILA con valor igual al previo → se actualiza (revisión de CILA)', () => {
        const ex = { almacenamiento_mm3: 700, escala_msnm: 1296.9, porcentaje_llenado: 24.19, notas: `${MARCA_CILA} (x)` };
        expect(resolverNivel(ex, 702.466, 2893.571, curva, 700).accion).toBe('actualizar');
    });
    it('capturista corrigió el nivel aunque la nota sobreviva → campo_prevalece', () => {
        const ex = { almacenamiento_mm3: 650, escala_msnm: 1296.1, porcentaje_llenado: 22.5, notas: `${MARCA_CILA} (x)` };
        expect(resolverNivel(ex, 702.466, 2893.571, curva, 700).accion).toBe('campo_prevalece');
    });
});

describe('elevación estimada (Madero)', () => {
    it('con incertidumbre, la nota rotula ESTIMADA ±m', () => {
        const r = resolverNivel(null, 702.466, 2893.571, curva, null, 0.5);
        expect(r.notas).toContain('ESTIMADA ±0.5 m');
    });
    it('sin incertidumbre (Boquilla) rotula calculada', () => {
        expect(resolverNivel(null, 702.466, 2893.571, curva).notas).toContain('elevación calculada');
    });
});

describe('estadoReporteCila (hora Chihuahua = UTC-6)', () => {
    const utc = (iso: string) => new Date(iso);
    it('hora local', () => {
        expect(fechaLocalChihuahua(utc('2026-10-06T16:30:00Z'))).toEqual({ fecha: '2026-10-06', minutos: 630 });
    });
    it('reporte de hoy → ACTUALIZADO', () => {
        expect(estadoReporteCila('2026-10-06', utc('2026-10-06T16:40:00Z')).estado).toBe('ACTUALIZADO');
    });
    it('10:30 con fecha de ayer → ESPERANDO', () => {
        expect(estadoReporteCila('2026-10-05', utc('2026-10-06T16:30:00Z')).estado).toBe('ESPERANDO');
    });
    it('11:30 con fecha de ayer → RETRASADO', () => {
        expect(estadoReporteCila('2026-10-05', utc('2026-10-06T17:30:00Z')).estado).toBe('RETRASADO');
    });
    it('dos días o más → SIN_ACTUALIZACION', () => {
        const r = estadoReporteCila('2026-10-04', utc('2026-10-06T20:00:00Z'));
        expect(r).toEqual({ estado: 'SIN_ACTUALIZACION', diasAtraso: 2 });
    });
    it('sin fecha → SIN_DATO', () => {
        expect(estadoReporteCila(null).estado).toBe('SIN_DATO');
    });
});
