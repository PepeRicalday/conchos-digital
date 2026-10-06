import { describe, it, expect } from 'vitest';
import { conduccionTramo, etiquetaEficiencia } from './conduccion';
import {
    STALE_MIN_ESCALA, esFrescaEscala, estadoCompuertas, extraccionPresa, presaBaja, valorGrafica, kmTexto, ordenarPorKm, escalaEnKm, minutosDesde, escapaHtml, gastoDeLectura,
} from './geoKpis';

const ok = (gasto: number) => ({ gasto, fresca: true });

describe('conduccion — eficiencia y pérdida (fuente única)', () => {
    it('eficiencia = Q salida / Q entrada (misma fórmula que Monitor Público)', () => {
        const c = conduccionTramo(ok(20), ok(17));
        // Monitor Público: (qFinal / qK0Medido) * 100
        expect(c.eficienciaPct).toBeCloseTo((17 / 20) * 100, 10);
        expect(c.perdidaPct).toBeCloseTo(15, 10);
        expect(c.perdidaM3s).toBeCloseTo(3, 10);
        expect(c.completo).toBe(true);
        expect(c.incoherente).toBe(false);
    });

    it('NO es la pérdida con nombre de eficiencia (el bug de Geo-Monitor)', () => {
        const c = conduccionTramo(ok(20), ok(17));
        const formulaVieja = ((20 - 17) / 20) * 100; // = 15 → es la pérdida
        expect(c.eficienciaPct).not.toBeCloseTo(formulaVieja, 5);
        expect(c.perdidaPct).toBeCloseTo(formulaVieja, 10);
    });

    it('un extremo sin lectura fresca → todo null (S/D), no 0 %', () => {
        expect(conduccionTramo({ gasto: 20, fresca: false }, ok(17))).toEqual({ completo: false, eficienciaPct: null, perdidaPct: null, perdidaM3s: null, incoherente: false });
        expect(conduccionTramo(ok(20), { gasto: 17, fresca: false }).eficienciaPct).toBeNull();
    });

    it('extremo sin gasto, con gasto 0 o negativo no cuenta (igual que el filtro del Monitor)', () => {
        expect(conduccionTramo(ok(20), { gasto: null, fresca: true }).completo).toBe(false);
        expect(conduccionTramo(ok(20), { gasto: undefined, fresca: true }).completo).toBe(false);
        expect(conduccionTramo(ok(20), ok(0)).completo).toBe(false);
        expect(conduccionTramo(ok(0), ok(10)).completo).toBe(false);
        expect(conduccionTramo(ok(20), ok(-1)).completo).toBe(false);
    });

    it('salida mayor que entrada se marca incoherente (aforos desfasados)', () => {
        const c = conduccionTramo(ok(10), ok(12));
        expect(c.completo).toBe(true);
        expect(c.eficienciaPct).toBeCloseTo(120, 10);
        expect(c.incoherente).toBe(true);
    });

    it('etiqueta de eficiencia', () => {
        expect(etiquetaEficiencia(null)).toBe('S/D');
        expect(etiquetaEficiencia(92)).toBe('Óptima');
        expect(etiquetaEficiencia(80)).toBe('Aceptable');
        expect(etiquetaEficiencia(60)).toBe('Baja');
    });
});

describe('geoKpis — S/D nunca cero', () => {
    const ahora = Date.parse('2026-10-05T18:00:00Z');

    it('frescura de una escala con el umbral de 240 min', () => {
        expect(STALE_MIN_ESCALA).toBe(240);
        expect(esFrescaEscala(ahora - 239 * 60000, ahora)).toBe(true);
        expect(esFrescaEscala(ahora - 241 * 60000, ahora)).toBe(false);
        expect(esFrescaEscala(null, ahora)).toBe(false);
        expect(esFrescaEscala(undefined, ahora)).toBe(false);
        expect(minutosDesde(null, ahora)).toBeNull();
    });

    it('apertura nula → S/D (no "CERRADAS"); 0 sí es cerrado medido', () => {
        expect(estadoCompuertas(null)).toBe('S/D');
        expect(estadoCompuertas(undefined)).toBe('S/D');
        expect(estadoCompuertas(Number.NaN)).toBe('S/D');
        expect(estadoCompuertas(0)).toBe('CERRADAS');
        expect(estadoCompuertas(0.35)).toBe('ABIERTAS');
    });

    it('extracción: lo medido prevalece; lo solicitado se rotula; nada se inventa (adiós 30 m³/s por defecto)', () => {
        expect(extraccionPresa(0, 30)).toEqual({ valorM3s: 0, fuente: 'MEDIDO' });
        expect(extraccionPresa(28.5, null)).toEqual({ valorM3s: 28.5, fuente: 'MEDIDO' });
        expect(extraccionPresa(null, 25)).toEqual({ valorM3s: 25, fuente: 'SOLICITADO' });
        expect(extraccionPresa(null, null)).toEqual({ valorM3s: null, fuente: null });
        expect(extraccionPresa(undefined, 0)).toEqual({ valorM3s: null, fuente: null });
    });

    it('presa baja: sin dato NO alerta (antes null → 0 % → alerta falsa)', () => {
        expect(presaBaja(null)).toBe(false);
        expect(presaBaja(undefined)).toBe(false);
        expect(presaBaja(24.7)).toBe(true);
        expect(presaBaja(40)).toBe(false);
        expect(presaBaja(0)).toBe(true); // un 0 % medido sí es presa baja
    });

    it('serie graficable: null/vacío se quedan huecos, 0 se conserva', () => {
        expect(valorGrafica(null)).toBeNull();
        expect(valorGrafica('')).toBeNull();
        expect(valorGrafica('abc')).toBeNull();
        expect(valorGrafica('2.5')).toBe(2.5);
        expect(valorGrafica(0)).toBe(0);
    });

    it('km: null → S/D, el km 0 real se muestra', () => {
        expect(kmTexto(null)).toBe('S/D');
        expect(kmTexto(0)).toBe('0.000');
        expect(kmTexto(104)).toBe('104.000');
    });

    it('ordena por km (los nulos al final) y encuentra extremos exactos', () => {
        const e = [{ km: 104, n: 'K104' }, { km: null, n: 'sin km' }, { km: 0, n: 'K0' }, { km: 44, n: 'K44' }];
        expect(ordenarPorKm(e).map(x => x.n)).toEqual(['K0', 'K44', 'K104', 'sin km']);
        expect(escalaEnKm(e, 0)?.n).toBe('K0');
        expect(escalaEnKm(e, 104)?.n).toBe('K104');
        expect(escalaEnKm(e, 50)).toBeUndefined();
    });
});

describe('escapaHtml — popups de Leaflet', () => {
    it('neutraliza etiquetas y comillas', () => {
        expect(escapaHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(escapaHtml("O'Brien & Co")).toBe('O&#39;Brien &amp; Co');
    });
    it('null/undefined → cadena vacía; números se conservan', () => {
        expect(escapaHtml(null)).toBe('');
        expect(escapaHtml(undefined)).toBe('');
        expect(escapaHtml(12.5)).toBe('12.5');
    });
});

describe('gastoDeLectura — misma regla que Geo-Monitor y Monitor Público', () => {
    it('curva nivel-gasto de campo manda sobre todo', () => {
        expect(gastoDeLectura({ gasto_metodo: 'curva_nivel', gasto_calculado_m3s: '12.5', nivel_m: 2 }, { pzas_radiales: 3, ancho: 2, nombre: 'K-0', km: 0 })).toBe(12.5);
        expect(gastoDeLectura({ gasto_metodo: 'curva_nivel', gasto_calculado_m3s: null }, { nombre: 'K-0', km: 0 })).toBeNull();
    });
    it('sin radiales usa el gasto calculado crudo; sin dato → null (no 0)', () => {
        expect(gastoDeLectura({ gasto_calculado_m3s: '0.79' }, { nombre: 'K-23', km: 23 })).toBeCloseTo(0.79, 5);
        expect(gastoDeLectura({}, { nombre: 'K-23', km: 23 })).toBeNull();
    });
    it('con radiales y nivel nulo → null; nivel 0 no inventa caudal', () => {
        expect(gastoDeLectura({ nivel_m: null }, { pzas_radiales: 3, ancho: 2, nombre: 'K-0', km: 0 })).toBeNull();
        expect(gastoDeLectura({ nivel_m: 0 }, { pzas_radiales: 3, ancho: 2, nombre: 'K-0', km: 0 })).toBe(0);
    });
});
