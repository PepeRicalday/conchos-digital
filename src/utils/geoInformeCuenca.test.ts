import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import type { DemGrid } from './camposCuenca';
import { construirRedJcas, type FilaEstacionJcas, type FilaLecturaJcas } from './jcasModelo';
import { seccionCuencaGeo, ventanaParaPeriodo } from './geoInformeCuenca';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const dem = JSON.parse(readFileSync('public/geo/cuenca_dem_grid.json', 'utf8')) as DemGrid;
const HOY = '2026-11-08';

describe('ventanaParaPeriodo', () => {
    it('sin periodo = hoy (parcial); un día = hoy o ayer', () => {
        expect(ventanaParaPeriodo(undefined, undefined, HOY)).toEqual({ ventana: 'hoy', exacta: true, motivo: null });
        expect(ventanaParaPeriodo(HOY, HOY, HOY).ventana).toBe('hoy');
        expect(ventanaParaPeriodo('2026-11-07', '2026-11-07', HOY).ventana).toBe(1);
    });
    it('7 y 30 días terminando hoy o ayer son exactos', () => {
        expect(ventanaParaPeriodo('2026-11-02', '2026-11-08', HOY)).toMatchObject({ ventana: 7, exacta: true });
        expect(ventanaParaPeriodo('2026-10-10', '2026-11-08', HOY)).toMatchObject({ ventana: 30, exacta: true });
    });
    it('60 y 90 días y el ciclo agrícola (1-oct) terminando hoy o ayer son exactos', () => {
        expect(ventanaParaPeriodo('2026-09-10', '2026-11-08', HOY)).toMatchObject({ ventana: 60, exacta: true });
        expect(ventanaParaPeriodo('2026-08-11', '2026-11-08', HOY)).toMatchObject({ ventana: 90, exacta: true });
        expect(ventanaParaPeriodo('2026-10-01', '2026-11-08', HOY)).toMatchObject({ ventana: 'ciclo', exacta: true });
    });
    it('un periodo que no coincide usa la ventana más cercana y lo declara', () => {
        const r = ventanaParaPeriodo('2026-01-01', '2026-06-30', HOY);
        expect(r.ventana).toBe('ciclo'); // 180 días: la más larga disponible
        expect(r.exacta).toBe(false);
        expect(r.motivo).toMatch(/ventanas de 7, 30, 60 y 90 días y del ciclo agrícola/);
        expect(ventanaParaPeriodo('2026-09-01', '2026-11-08', HOY)).toMatchObject({ ventana: 90, exacta: false });
        expect(ventanaParaPeriodo('2026-11-04', '2026-11-06', HOY)).toMatchObject({ ventana: 7, exacta: false });
    });
});

describe('seccionCuencaGeo', () => {
    const NOMBRES: [string, number, number][] = [['A', 28.64, -106.08], ['B', 28.84, -105.91], ['C', 27.96, -106.11], ['D', 27.7, -105.17], ['E', 27.46, -105.81], ['F', 27.12, -104.9], ['G', 26.95, -106.35], ['H', 26.74, -105.16]];
    const est: FilaEstacionJcas[] = NOMBRES.map(([nombre, la, lo], i) => ({ id_jcas: i + 1, nombre, latitud: la, longitud: lo, altitud_m: null, zona: 'cuenca', grupo_ciudad: null, tiene_pluviometro: true, activa: true, ult_fecha: '2026-11-07' }));
    const lec: FilaLecturaJcas[] = est.flatMap((e) => Array.from({ length: 30 }, (_, i) => ({ estacion_id: e.id_jcas, fecha: new Date(Date.parse('2026-11-07T00:00:00Z') - (29 - i) * 86_400_000).toISOString().slice(0, 10), lluvia_mm: 2, temp_c: 15, hum_pct: 50, viento_kmh: 6 })));
    const red = construirRedJcas(est, lec, HOY, c.poligonos);
    const entrada = { red, contorno: c, dem, variables: ['tempC', 'vientoMs', 'radSolarWm2', 'lluviaDiaMm'] as ('tempC' | 'vientoMs' | 'radSolarWm2' | 'lluviaDiaMm')[], hoy: HOY };

    it('un plano por variable con fuente, S/D explícito para radiación y sin NaN/undefined/null', () => {
        const h = seccionCuencaGeo({ ...entrada, periodoDesde: '2026-10-10', periodoHasta: '2026-11-08' });
        expect((h.match(/<svg /g) ?? []).length).toBe(3); // lluvia, temperatura, viento
        expect(h).toMatch(/Radiación solar/);
        expect(h).toMatch(/JCAS no mide radiación solar/);
        expect(h).toMatch(/provisional/);
        expect(h).toMatch(/n = \d+ estaciones/);
        const visible = h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
        expect(visible).not.toMatch(/\b(NaN|undefined|Infinity|null)\b/);
        expect(h).not.toMatch(/Aquarius|<script/i);
    });
    it('solo las variables elegidas', () => {
        const h = seccionCuencaGeo({ ...entrada, variables: ['lluviaDiaMm'] });
        expect((h.match(/<svg /g) ?? []).length).toBe(1);
        expect(h).not.toMatch(/Radiación solar/);
    });
    it('sin periodo la ventana es hoy y se avisa que es parcial', () => {
        expect(seccionCuencaGeo(entrada)).toMatch(/parcial/);
    });
    it('periodo que no coincide: aviso de ventana más cercana', () => {
        expect(seccionCuencaGeo({ ...entrada, periodoDesde: '2026-01-01', periodoHasta: '2026-06-30' })).toMatch(/ventana más cercana/);
    });
    it('sin red de la cuenca: S/D explícito, nunca se omite la sección ni se inventan ceros', () => {
        const h = seccionCuencaGeo({ ...entrada, red: null });
        expect(h).toMatch(/Cuenca del Conchos/);
        expect(h).toMatch(/S\/D/);
        expect(h).not.toMatch(/<svg /);
    });
});
