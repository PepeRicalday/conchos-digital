import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import { type DemGrid, type PuntoCampo, elevacionDem } from './camposCuenca';
import { construirPlano, planoSvg, tituloPlano } from './planosCuenca';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const dem = JSON.parse(readFileSync('public/geo/cuenca_dem_grid.json', 'utf8')) as DemGrid;
const RED: [string, number, number, number][] = [
    ['Chihuahua', 28.64, -106.08, 55], ['Aldama', 28.84, -105.91, 70], ['Satevó', 27.96, -106.11, 55], ['Camargo', 27.7, -105.17, 76],
    ['V. Zaragoza', 27.46, -105.81, 29], ['Jiménez', 27.12, -104.9, 89], ['Balleza', 26.95, -106.35, 63], ['Coronado', 26.74, -105.16, 118],
    ['Borja', 27.9, -106.68, 34], ['San Juanito', 27.97, -107.6, 3], ['Santa Isabel', 28.34, -106.4, 53], ['Ojinaga', 29.57, -104.4, 54],
];
const pts = (o: Partial<PuntoCampo> = {}): PuntoCampo[] => RED.map(([nombre, lat, lon, valor]) => ({ id: nombre, nombre, lat, lon, valor, elevM: elevacionDem(dem, lon, lat), ...o }));

describe('construirPlano · lluvia observada 30 d', () => {
    const m = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos: pts(), contorno: c, dem });
    it('niveles fijos de isoyetas y una banda por nivel alcanzado', () => {
        expect(m.niveles).toEqual([1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150]);
        expect(m.bandas.length).toBeGreaterThanOrEqual(5);
        expect(m.bandas.every((b) => b.anillos.length > 0)).toBe(true);
        const niv = m.bandas.map((b) => b.nivel);
        expect(niv).toEqual([...niv].sort((a, b) => a - b));
    });
    it('resumen coherente con los datos: media entre extremos y n de estaciones', () => {
        expect(m.motivoSD).toBeNull();
        expect(m.resumen.n).toBe(12);
        expect(m.resumen.media!).toBeGreaterThan(m.resumen.min!);
        expect(m.resumen.media!).toBeLessThan(m.resumen.max!);
        expect(m.resumen.maxEn).toEqual({ nombre: 'Coronado', valor: 118 });
        expect(m.resumen.coberturaPct).toBeGreaterThan(50);
    });
    it('hay zonas sin cobertura dibujables y rótulos sobre las líneas', () => {
        expect(m.sinCobertura.length).toBeGreaterThan(0);
        expect(m.rotulos.length).toBeGreaterThan(0);
        expect(m.rotulos.every((r) => Math.abs(r.angulo) <= 90)).toBe(true);
    });
    it('título legible', () => {
        expect(m.titulo).toBe('Isoyetas observadas · últimos 30 días');
        expect(tituloPlano('lluvia', { tipo: 'pron', dias: 7 })).toBe('Isoyetas pronosticadas · próximos 7 días');
        expect(tituloPlano('temperatura', { tipo: 'obs', dias: 7 })).toBe('Temperatura media observada · últimos 7 días');
    });
});

describe('construirPlano · reglas S/D', () => {
    it('con pocas estaciones: S/D con motivo, sin bandas', () => {
        const m = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 7 }, puntos: pts().slice(0, 3), contorno: c, dem });
        expect(m.motivoSD).toMatch(/solo 3/);
        expect(m.bandas).toEqual([]);
        expect(m.resumen.media).toBeNull();
    });
    it('una estación sospechosa no entra al campo pero se lista como excluida', () => {
        const p = pts(); p[3] = { ...p[3], valor: 0, sospechosa: true };
        const m = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos: p, contorno: c, dem });
        expect(m.excluidos.map((x) => x.nombre)).toEqual(['Camargo']);
        expect(m.resumen.n).toBe(11);
    });
    it('estaciones de una misma ciudad pesan una vez', () => {
        const p = [...pts(), { id: 'x', nombre: 'CHIH_B', lat: 28.62, lon: -106.1, valor: 70, grupo: 'chihuahua' }, { id: 'y', nombre: 'CHIH_C', lat: 28.68, lon: -106.08, valor: 80, grupo: 'chihuahua' }];
        const m = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos: p, contorno: c, dem });
        expect(m.resumen.n).toBe(13); // 12 + 1 grupo
        expect(m.puntos.some((x) => x.nombre === 'Chihuahua (2 est.)')).toBe(true);
    });
});

describe('construirPlano · otras variables', () => {
    it('temperatura: niveles de 2 °C que cubren el rango y ajuste por altitud declarado', () => {
        const p = pts().map((x) => ({ ...x, valor: 30 - 0.0065 * (x.elevM ?? 1500) }));
        const m = construirPlano({ variable: 'temperatura', periodo: { tipo: 'obs', dias: 7 }, puntos: p, contorno: c, dem });
        expect(m.niveles.every((n) => n % 2 === 0)).toBe(true);
        expect(m.niveles.length).toBeGreaterThanOrEqual(3);
        expect(m.ajuste.n).toBe(12);
        expect(m.ajuste.aplicado).toBe(true);
    });
    it('humedad: nunca pasa de 100 % y usa niveles de 10 en 10', () => {
        const m = construirPlano({ variable: 'humedad', periodo: { tipo: 'pron', dias: 3 }, puntos: pts().map((x) => ({ ...x, valor: 95 })), contorno: c, dem });
        expect(m.resumen.max!).toBeLessThanOrEqual(100);
        expect(m.niveles).toEqual([20, 30, 40, 50, 60, 70, 80, 90]);
    });
    it('viento: niveles en km/h', () => {
        const m = construirPlano({ variable: 'viento', periodo: { tipo: 'obs', dias: 7 }, puntos: pts().map((x, i) => ({ ...x, valor: 3 + i })), contorno: c, dem });
        expect(m.unidad).toBe('km/h');
        expect(m.niveles).toEqual([2, 4, 6, 8, 10, 15, 20]);
    });
});

describe('planoSvg', () => {
    const m = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos: pts(), contorno: c, dem });
    it('SVG bien formado, sin NaN/undefined/null y de tamaño razonable', () => {
        const s = planoSvg(m, c, { tema: 'papel', idPrefijo: 't1' });
        expect(s.startsWith('<svg')).toBe(true);
        expect(s.endsWith('</svg>')).toBe(true);
        expect(s).not.toMatch(/NaN|undefined|Infinity|="null"/);
        expect(s.length).toBeLessThan(150_000);
        expect(s).toContain('clipPath id="t1-cl"');
        expect(s).toContain('sin cobertura');
        expect(s).toContain('role="img"');
    });
    it('el tema papel y el de pantalla usan tintas distintas', () => {
        expect(planoSvg(m, c, { tema: 'papel' })).toContain('#0E1B2C');
        expect(planoSvg(m, c, { tema: 'pantalla' })).toContain('#e8eef6');
    });
    it('ids distintos por plano para que no choquen varios en una hoja', () => {
        expect(planoSvg(m, c, { idPrefijo: 'a' })).not.toContain('id="b-cl"');
        expect(planoSvg(m, c, { idPrefijo: 'a' })).toContain('id="a-cl"');
    });
    it('S/D: dibuja la cuenca con trama y el motivo, sin colores de banda', () => {
        const sd = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 7 }, puntos: pts().slice(0, 3), contorno: c, dem });
        const s = planoSvg(sd, c, { tema: 'papel' });
        expect(s).toContain('>S/D<');
        expect(s).toMatch(/solo 3/);
        expect(s).not.toMatch(/fill-rule="evenodd"/);
    });
    it('una estación excluida se dibuja con ✕ y sin cifra, y la S/D con "S/D"', () => {
        const p = pts(); p[3] = { ...p[3], valor: 0, sospechosa: true }; p[4] = { ...p[4], valor: null };
        const s = planoSvg(construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos: p, contorno: c, dem }), c, { tema: 'papel' });
        expect(s).toContain('Camargo: excluida');
        expect(s).toContain('>S/D<');
    });
    it('textoPx mayor agranda el texto (teléfono)', () => {
        const a = planoSvg(m, c, { textoPx: 12 }), b = planoSvg(m, c, { textoPx: 17 });
        expect(b).toContain('font-size="29.5"'.replace('29.5', String(17 * 0.9 > 0 ? (17 * 0.9).toFixed(1) : '')) );
        expect(a).not.toEqual(b);
    });
    it('sin leyenda es más corto', () => {
        expect(planoSvg(m, c, { leyenda: false }).length).toBeLessThan(planoSvg(m, c, { leyenda: true }).length);
    });
});

describe('planoSvg · flechas de viento', () => {
    const viento = (dir: number | null) => construirPlano({ variable: 'viento', periodo: { tipo: 'pron', dias: 3 }, puntos: pts({ dirDeg: dir }).map((x, i) => ({ ...x, valor: 6 + (i % 4) })), contorno: c, dem });
    it('con dirección dibuja una flecha por estación hacia donde sopla (dirección + 180°)', () => {
        const s = planoSvg(viento(270), c, { tema: 'papel' });
        expect((s.match(/rotate\(90\)/g) ?? []).length).toBeGreaterThanOrEqual(10); // viento del oeste → flecha hacia el este
        expect(s).toContain('hacia donde sopla la flecha');
    });
    it('sin dirección (observado o S/D) no dibuja flechas', () => {
        expect(planoSvg(viento(null), c, { tema: 'papel' })).not.toContain('hacia donde sopla la flecha');
    });
    it('la lluvia nunca lleva flechas aunque el punto traiga dirección', () => {
        const l = construirPlano({ variable: 'lluvia', periodo: { tipo: 'obs', dias: 30 }, puntos: pts({ dirDeg: 90 }), contorno: c, dem });
        expect(planoSvg(l, c, { tema: 'papel' })).not.toContain('hacia donde sopla la flecha');
    });
});
