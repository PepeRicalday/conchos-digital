import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexarSerie, type FilaSerie } from './historicoPresas';
import { construirDatosInfografia, fechaLarga, fmtConSigno, fmtHm3, horaChihuahua, type EntradaPresaInfografia } from './infografiaPresas';

const fila = (fecha: string, alm: number | null): FilaSerie => ({
    presa_id: 'PRE-001', fecha, escala_msnm: null, almacenamiento_mm3: alm, pct: null, fuente: 'HISTORICO', calidad: alm == null ? 'SIN_DATO' : 'OK',
    almacenamiento_reportado_mm3: alm, pct_reportado: null,
});

/** 6-oct de 2021..2025 con volúmenes: 2021 1040.7, 2022 2263.2, 2023 1106.6, 2024 449.9, 2025 1105.0. */
const historico = indexarSerie([
    fila('2021-10-06', 1040.7), fila('2022-10-06', 2263.2), fila('2023-10-06', 1106.6), fila('2024-10-06', 449.9), fila('2025-10-06', 1105.0),
])['PRE-001'];

const boquilla = (over: Partial<EntradaPresaInfografia> = {}): EntradaPresaInfografia => ({
    id: 'PRE-001', nombre: 'La Boquilla',
    actual: { fecha: '2026-10-06', almacenamiento_mm3: 704.246, pct_conservacion: 24.738336, cap_conservacion_mm3: 2846.78, archivo_last_modified: '2026-10-06T15:40:15Z' },
    previa: { fecha: '2026-10-05', almacenamiento_mm3: 702.466, pct_conservacion: 24.675809 },
    historico, elevacion: { valor: 1297, procedencia: 'CILA' }, salida: { valor: 12.5, conocida: true },
    ...over,
});
const madero = (over: Partial<EntradaPresaInfografia> = {}): EntradaPresaInfografia => ({
    id: 'PRE-002', nombre: 'Fco. I. Madero',
    actual: { fecha: '2026-10-06', almacenamiento_mm3: 164.083, pct_conservacion: 49.227164, cap_conservacion_mm3: 333.318, archivo_last_modified: '2026-10-06T15:40:15Z' },
    previa: { fecha: '2026-10-05', almacenamiento_mm3: 164.302, pct_conservacion: 49.292867 },
    historico: undefined, elevacion: { valor: null, procedencia: null }, salida: { valor: 0, conocida: false },
    ...over,
});

describe('formato', () => {
    it('3 decimales es-MX, S/D para null y signo explícito', () => {
        expect(fmtHm3(704.246)).toBe('704.246');
        expect(fmtHm3(2846.78)).toBe('2,846.780');
        expect(fmtHm3(null)).toBe('S/D');
        expect(fmtHm3(NaN)).toBe('S/D');
        expect(fmtConSigno(1.78)).toBe('+1.780');
        expect(fmtConSigno(-0.219)).toBe('−0.219');
        expect(fmtConSigno(0)).toBe('0.000');
        expect(fmtConSigno(null)).toBe('S/D');
    });
    it('fecha larga y hora de Chihuahua (UTC−6)', () => {
        expect(fechaLarga('2026-10-06')).toBe('06 de octubre de 2026');
        expect(fechaLarga(null)).toBeNull();
        expect(horaChihuahua('2026-10-06T15:40:15Z')).toBe('09:40');
        expect(horaChihuahua(null)).toBeNull();
    });
});

describe('construirDatosInfografia', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T16:00:00Z')); });
    afterEach(() => vi.useRealTimers());

    it('cifras CILA tal cual, conjunto y corte', () => {
        const d = construirDatosInfografia([boquilla(), madero()]);
        expect(d.presas[0]).toMatchObject({ volumen: 704.246, pct: 24.738336, capacidad: 2846.78 });
        expect(d.presas[1]).toMatchObject({ volumen: 164.083, pct: 49.227164, capacidad: 333.318 });
        expect(d.conjunto.totalMm3).toBeCloseTo(868.329, 3);
        expect(d.conjunto.parcial).toBe(false);
        expect(d.corte.texto).toBe('Corte: 06 de octubre de 2026 · 09:40 h');
        expect(d.vigencia.estado).toBe('ACTUALIZADO');
    });

    it('cambio vs día anterior (hm³ y puntos de %)', () => {
        const d = construirDatosInfografia([boquilla(), madero()]);
        expect(d.presas[0].delta?.mm3).toBeCloseTo(1.78, 3);
        expect(d.presas[0].delta?.puntosPct).toBeCloseTo(0.0625, 3);
        expect(d.presas[0].delta?.dias).toBe(1);
        expect(d.presas[1].delta?.mm3).toBeCloseTo(-0.219, 3);
    });

    it('sin lectura previa el cambio es S/D (null), nunca 0', () => {
        expect(construirDatosInfografia([boquilla({ previa: null })]).presas[0].delta).toBeNull();
        expect(construirDatosInfografia([boquilla({ previa: { fecha: '2026-10-06', almacenamiento_mm3: 700, pct_conservacion: 24 } })]).presas[0].delta).toBeNull();
    });

    it('mismo día del año anterior y posición histórica (2.º más bajo desde 2021)', () => {
        const p = construirDatosInfografia([boquilla()]).presas[0];
        expect(p.anioPrevio).toMatchObject({ anio: 2025, valor: 1105 });
        expect(p.anioPrevio?.difMm3).toBeCloseTo(-400.754, 3);
        expect(p.posicion).toEqual({ posicion: 2, de: 6, desdeAnio: 2021 });
        expect(p.posicionTexto).toBe('2.º más bajo desde 2021');
        expect(p.semaforo).toBe('rojo'); // (2-1)/(6-1)=0.2 < 1/3
    });

    it('sin histórico: comparativo y posición S/D, semáforo sd', () => {
        const p = construirDatosInfografia([madero()]).presas[0];
        expect(p.anioPrevio).toBeNull();
        expect(p.posicion).toBeNull();
        expect(p.posicionTexto).toBeNull();
        expect(p.semaforo).toBe('sd');
    });

    it('salida no conocida → S/D; elevación ausente → sin procedencia', () => {
        const p = construirDatosInfografia([madero()]).presas[0];
        expect(p.salida).toBeNull();
        expect(p.elevacion).toBeNull();
        expect(p.procedencia).toBeNull();
        expect(construirDatosInfografia([boquilla()]).presas[0]).toMatchObject({ salida: 12.5, elevacion: 1297, procedencia: 'CILA' });
    });

    it('una presa sin lectura queda fuera del conjunto (parcial) y no se inventa 0', () => {
        const d = construirDatosInfografia([boquilla(), madero({ actual: null, previa: null })]);
        expect(d.presas[1].volumen).toBeNull();
        expect(d.presas[1].pct).toBeNull();
        expect(d.conjunto).toMatchObject({ presasConDato: 1, presasTotal: 2, parcial: true });
        expect(d.conjunto.totalMm3).toBeCloseTo(704.246, 3);
    });

    it('sin ninguna lectura: conjunto null, corte null y vigencia SD', () => {
        const d = construirDatosInfografia([boquilla({ actual: null, previa: null }), madero({ actual: null, previa: null })]);
        expect(d.conjunto.totalMm3).toBeNull();
        expect(d.corte.texto).toBeNull();
        expect(d.vigencia.estado).toBe('SD');
    });

    it('lectura vieja → DESFASADO', () => {
        vi.setSystemTime(new Date('2026-10-10T16:00:00Z'));
        expect(construirDatosInfografia([boquilla(), madero()]).vigencia.estado).toBe('DESFASADO');
    });
});
