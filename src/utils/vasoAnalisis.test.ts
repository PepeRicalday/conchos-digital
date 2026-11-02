import { describe, expect, it } from 'vitest';
import { diferenciaPoligonos, indiceFragmentacion, nivelEnFecha, resumenRecalibracion, unirNiveles, validacionCruzada } from './vasoAnalisis';
import { bboxComun } from './informeVasoSvg';
import { semaforoDesvio } from './vasoUmbrales';
import type { EscenaVaso } from './informeVasoDatos';
import type { PuntoCurva } from './presaNiveles';

const CURVA: PuntoCurva[] = [
    { elevacion_msnm: 1290, volumen_mm3: 500, area_ha: 5000 },
    { elevacion_msnm: 1300, volumen_mm3: 800, area_ha: 6000 },
];
const cuadrado = (lon: number, lat: number, d: number): [number, number][] => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]];
const escena = (p: Partial<EscenaVaso>): EscenaVaso => ({
    fecha_escena: '2026-09-26T17:56:00Z', area_km2: 50, perimetro_km: 100, num_islas: 2, ratio_elongacion: 4, delta_area_km2: null, pct_del_maximo_ciclo: null,
    contorno_geojson: { type: 'Polygon', coordinates: [cuadrado(-105.5, 27.5, 0.1)] }, ...p,
});

describe('nivel del día', () => {
    const niveles = unirNiveles(
        [{ fecha: '2026-09-26', escala_msnm: 1295.21 }],
        [{ fecha: '2026-09-26', escala_msnm: 1295.0 }, { fecha: '2026-09-20', escala_msnm: 1294 }],
    );
    it('el histórico CILA gana a la captura el mismo día', () => {
        expect(niveles.find((n) => n.fecha === '2026-09-26')).toMatchObject({ escala_msnm: 1295.21, fuente: 'historico' });
    });
    it('usa la fecha local de Chihuahua y respeta ±2 días', () => {
        expect(nivelEnFecha('2026-09-26T17:56:00Z', niveles)?.dias).toBe(0);
        expect(nivelEnFecha('2026-09-22T17:56:00Z', niveles)).toMatchObject({ fecha: '2026-09-20', dias: 2 });
        expect(nivelEnFecha('2026-09-15T17:56:00Z', niveles)).toBeNull();
    });
});

describe('validación cruzada', () => {
    const niveles = unirNiveles([{ fecha: '2026-09-26', escala_msnm: 1295 }], []);
    it('compara contra la curva a la cota del día (55 km² a 1295)', () => {
        const [v] = validacionCruzada([escena({ area_km2: 49.5 })], niveles, CURVA);
        expect(v.sinReferencia).toBe(false);
        expect(v.areaEsperadaKm2).toBeCloseTo(55, 6);
        expect(v.pctCoincidencia).toBeCloseTo(90, 6);
        expect(v.fuenteNivel).toBe('historico');
    });
    it('escena nublada sobre el vaso, sin nivel o sin curva → sin referencia con motivo (nunca 0)', () => {
        expect(validacionCruzada([escena({ cobertura_nubes_vaso_pct: 15.9 })], niveles, CURVA)[0]).toMatchObject({ sinReferencia: true, motivo: 'nubes' });
        expect(validacionCruzada([escena({ fecha_escena: '2026-08-01T17:00:00Z' })], niveles, CURVA)[0]).toMatchObject({ sinReferencia: true, motivo: 'sin_nivel' });
        expect(validacionCruzada([escena({})], niveles, undefined)[0]).toMatchObject({ sinReferencia: true, motivo: 'sin_curva' });
    });
    it('usa la fecha de los píxeles (v2) en vez de la de la escena', () => {
        const [v] = validacionCruzada([escena({ fecha_escena: '2026-09-01T00:00:00Z', fecha_pixeles: '2026-09-26T17:56:00Z' })], niveles, CURVA);
        expect(v.sinReferencia).toBe(false);
    });
});

describe('semáforo de desvío', () => {
    it('15 / 25 % y S/D (el sesgo −11 % del sensor coincide)', () => {
        expect(semaforoDesvio(-11.6).clave).toBe('ok');
        expect(semaforoDesvio(-15).clave).toBe('ok');
        expect(semaforoDesvio(-16.9).clave).toBe('warn');
        expect(semaforoDesvio(26).clave).toBe('crit');
        expect(semaforoDesvio(null).clave).toBe('sd');
    });
});

describe('índice de fragmentación', () => {
    it('S/D con menos de 3 escenas del mismo método', () => {
        expect(indiceFragmentacion([escena({ metodo: 'v1' }), escena({ metodo: 'v2' }), escena({ metodo: 'v2', fecha_escena: '2026-10-31T00:00:00Z' })]).disponible).toBe(false);
    });
    it('desvío del ratio y agravante por islas', () => {
        const f = indiceFragmentacion([
            escena({ fecha_escena: 'a', ratio_elongacion: 4, num_islas: 2 }), escena({ fecha_escena: 'b', ratio_elongacion: 4, num_islas: 2 }),
            escena({ fecha_escena: 'c', ratio_elongacion: 4.4, num_islas: 6 }),
        ]);
        expect(f.disponible && f.desviacionPct).toBeCloseTo(10, 6);
        expect(f.disponible && f.nivel).toBe('atencion');
    });
});

describe('diferencia de polígonos (azolve)', () => {
    it('km² reales, no inflados (bug 111.32 km/px)', () => {
        // base: 0.1° × 0.1°; comparado: la mitad oeste → banco expuesto ≈ mitad del área de la base
        const base = [cuadrado(-105.5, 27.5, 0.1)];
        const comp = [[[-105.5, 27.5], [-105.45, 27.5], [-105.45, 27.6], [-105.5, 27.6], [-105.5, 27.5]] as [number, number][]];
        const b = bboxComun([base[0], comp[0]]);
        const d = diferenciaPoligonos(base, comp, b, 640, 380, 2);
        const areaBase = 0.1 * 111.32 * Math.cos((27.55 * Math.PI) / 180) * 0.1 * 111.32;
        expect(d.areaAzolveKm2).toBeGreaterThan(areaBase / 2 * 0.93);
        expect(d.areaAzolveKm2).toBeLessThan(areaBase / 2 * 1.07);
        expect(d.areaNuevaKm2).toBe(0);
    });
});

describe('recalibración', () => {
    it('null sin observaciones; banda de mayor |desvío| (también positivo)', () => {
        expect(resumenRecalibracion([])).toBeNull();
        const r = resumenRecalibracion([
            { banda_elevacion_msnm: 1295, factor_area: 0.92, desviacion_pct_prom: -8, n_observaciones: 1 },
            { banda_elevacion_msnm: 1300, factor_area: 1.12, desviacion_pct_prom: 12, n_observaciones: 1 },
        ])!;
        expect(r.bandaMayorDesvio.banda_elevacion_msnm).toBe(1300);
        expect(r.desviacionPonderada).toBeCloseTo(2, 6);
    });
});
