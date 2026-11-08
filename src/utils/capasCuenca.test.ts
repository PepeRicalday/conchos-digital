import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, proyectorCuenca, type ContornoCuenca } from './geoCuenca';
import type { DemGrid, PuntoCampo } from './camposCuenca';
import { CAPAS_INFO, CAPAS_INFORME, CAPAS_PANTALLA, capasSvg, todasLasCapas, type DatosCapas } from './capasCuenca';
import { construirPlano, planoSvg } from './planosCuenca';

const G = (f: string) => JSON.parse(readFileSync(`public/geo/${f}`, 'utf8'));
const c = interpretaContorno(G('cuenca_conchos.geojson')) as ContornoCuenca;
const dem = G('cuenca_dem_grid.json') as DemGrid;
const datos: DatosCapas = {
    municipios: G('ref_municipios.geojson'), poblaciones: G('ref_poblaciones.geojson'), rios: G('ref_rios.geojson'), rotulosRios: G('ref_rios_rotulos.json').rotulos,
    carreteras: G('ref_carreteras.geojson'), subcuencas: G('cuenca_conchos_subcuencas.geojson'), vasos: G('ref_presas_vasos.geojson'),
};
const p = proyectorCuenca(c.bbox, 500);
const op = { px: 12, tema: 'pantalla' as const, ancho: p.ancho, alto: p.alto };

describe('archivos de capas generados', () => {
    it('municipios con nombre y punto de rótulo; acentos bien (UTF-8, no «�»)', () => {
        const nombres = datos.municipios!.features.map((f) => f.properties.n);
        expect(nombres.length).toBeGreaterThanOrEqual(40);
        expect(nombres).toContain('Hidalgo del Parral');
        expect(nombres.join('')).not.toMatch(/�/);
        expect(nombres).toContain('Jiménez');
    });
    it('ríos: orden de Strahler ≥ 4 y rótulos de los ríos principales dentro de la cuenca', () => {
        expect(datos.rios!.features.every((f) => f.properties.o >= 4)).toBe(true);
        expect(datos.rotulosRios!.map((r) => r.n)).toEqual(expect.arrayContaining(['Río Conchos', 'Río San Pedro', 'Río Florido']));
    });
    it('cada archivo pesa lo razonable para viajar con la app (< 150 KB)', () => {
        for (const f of ['ref_municipios', 'ref_poblaciones', 'ref_rios', 'ref_carreteras']) expect(readFileSync(`public/geo/${f}.geojson`).length).toBeLessThan(150_000);
    });
    it('La Boquilla trae su vaso real de Sentinel-2 y está marcado como tal', () => {
        const f = datos.vasos!.features[0];
        expect(f.properties.fuente).toBe('sentinel2_ndwi');
        expect(f.properties.area_km2).toBeGreaterThan(50);
    });
});

describe('capasSvg', () => {
    it('sin ids no dibuja nada', () => {
        const r = capasSvg(datos, [], p, op);
        expect(r.bajo + r.alto).toBe('');
        expect(r.leyenda).toEqual([]);
    });
    it('cada capa dibuja lo suyo y aparece en la leyenda con forma distinta (no solo color)', () => {
        const r = capasSvg(datos, todasLasCapas(), p, op);
        expect(r.leyenda.map((l) => l.texto)).toEqual(expect.arrayContaining(['río', 'límite municipal', 'carretera', 'subcuencas', 'módulos SRL', 'presa', 'cabecera municipal']));
        expect(r.bajo).toMatch(/stroke-dasharray/); // carreteras y subcuencas discontinuas
        expect(r.alto).toMatch(/Río Conchos/);
        expect(r.alto).toMatch(/Hidalgo del Parral/);
        expect(r.alto).toMatch(/<title>/);
    });
    it('una capa sin datos cargados se omite sin fallar ni inventar', () => {
        const r = capasSvg({}, todasLasCapas(), p, op);
        expect(r.bajo).not.toMatch(/NaN/);
        expect(r.leyenda.map((l) => l.texto)).toEqual(['módulos SRL', 'presa']); // módulos y puntos de presas vienen de código, no de archivo
    });
    it('sin NaN/undefined y con texto escapado', () => {
        const sucio: DatosCapas = { ...datos, poblaciones: { features: [{ properties: { n: 'A<b>&"c', e: 'X' }, geometry: { type: 'Point', coordinates: [-105.5, 28.2] } }] } };
        const r = capasSvg(sucio, ['poblaciones'], p, op);
        expect(r.alto).not.toMatch(/NaN|undefined/);
        expect(r.alto).toContain('A&lt;b&gt;&amp;&quot;c');
        expect(r.alto).not.toContain('<b>');
    });
    it('los rótulos esquivan las cajas reservadas (cifras de estaciones)', () => {
        const libre = capasSvg(datos, ['municipios'], p, op).alto;
        const reservados: [number, number, number, number][] = [[0, p.alto, p.ancho, p.alto]]; // todo el lienzo ocupado
        const bloqueado = capasSvg(datos, ['municipios'], p, { ...op, reservados }).alto;
        expect(libre.length).toBeGreaterThan(0);
        expect(bloqueado).toBe('');
    });
    it('el tema papel usa otra tinta que el de pantalla', () => {
        expect(capasSvg(datos, ['rios'], p, { ...op, tema: 'papel' }).bajo).not.toBe(capasSvg(datos, ['rios'], p, op).bajo);
    });
});

describe('planoSvg con capas', () => {
    const RED: [string, number, number, number][] = [['A', 28.64, -106.08, 55], ['B', 28.84, -105.91, 70], ['C', 27.96, -106.11, 55], ['D', 27.7, -105.17, 76], ['E', 27.46, -105.81, 29], ['F', 27.12, -104.9, 89]];
    const puntos: PuntoCampo[] = RED.map(([nombre, lat, lon, valor]) => ({ id: nombre, nombre, lat, lon, valor }));
    const m = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos, contorno: c, dem });
    it('sin capas el plano sale como siempre; con capas añade las capas y su leyenda', () => {
        const sin = planoSvg(m, c, { tema: 'papel', idPrefijo: 'a' });
        const con = planoSvg(m, c, { tema: 'papel', idPrefijo: 'a', capas: { ids: CAPAS_INFORME, datos } });
        expect(con.length).toBeGreaterThan(sin.length);
        expect(con).toMatch(/límite municipal/);
        expect(sin).not.toMatch(/límite municipal/);
        expect(con).not.toMatch(/NaN|undefined|Infinity/);
        expect(con.length).toBeLessThan(300_000);
    });
    it('la leyenda declara la base de la escala de color', () => {
        expect(planoSvg(m, c, { tema: 'papel' })).toMatch(/Escala basada en acumulado de 30 días: n = 2,048 ventanas/);
    });
    it('las capas por defecto de pantalla son ligeras y todas tienen descripción', () => {
        expect(CAPAS_PANTALLA.length).toBeLessThanOrEqual(3);
        expect(CAPAS_INFO.every((i) => i.titulo.length > 0 && i.ayuda.length > 0)).toBe(true);
    });
});
