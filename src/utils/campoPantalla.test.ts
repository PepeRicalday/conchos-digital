import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, proyectorCuenca, type ContornoCuenca } from './geoCuenca';
import { construirPlano } from './planosCuenca';
import type { PuntoCampo, CampoCuenca } from './camposCuenca';
import { VARIABLES_PLANO, type VariablePlano } from './paletasClima';
import { capasSvg } from './capasCuenca';
import { campoSvg, colorPantalla, lonLatDe, leyendaCampo, luminancia, LUM_MIN_PANTALLA, paletaPantalla, valorEnCampo } from './campoPantalla';

const contorno = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const RED: [string, number, number, number][] = [
  ['Chihuahua', 28.64, -106.08, 55], ['Aldama', 28.84, -105.91, 70], ['Satevó', 27.96, -106.11, 55], ['Camargo', 27.7, -105.17, 76],
  ['Valle de Zaragoza', 27.46, -105.81, 29], ['Jiménez', 27.12, -104.9, 89], ['Balleza', 26.95, -106.35, 63], ['Coronado', 26.74, -105.16, 118],
  ['San Fco. de Borja', 27.9, -106.68, 34], ['Santa Isabel', 28.34, -106.4, 53], ['Ojinaga', 29.57, -104.4, 54],
];
const puntos = (f = 1): PuntoCampo[] => RED.map(([nombre, lat, lon, v], i) => ({ id: `j${i}`, nombre, lat, lon, valor: v * f, elevM: null, grupo: null }));
const plano = (variable: VariablePlano = 'lluvia', pts = puntos()) => construirPlano({ variable, periodo: { tipo: 'obs', dias: 30 }, puntos: pts, contorno, dem: null });
const P = proyectorCuenca(contorno.bbox, 900, 0.04, 700);

describe('campoPantalla · colores que no se pierden en el fondo oscuro', () => {
  it('luminancia: negro 0, blanco 1', () => {
    expect(luminancia('#000000')).toBeCloseTo(0, 3);
    expect(luminancia('#ffffff')).toBeCloseTo(1, 3);
  });
  it('los extremos oscuros se aclaran y los medios/claros no se tocan', () => {
    expect(colorPantalla('#0a2456')).not.toBe('#0a2456');
    expect(luminancia(colorPantalla('#0a2456'))).toBeGreaterThanOrEqual(LUM_MIN_PANTALLA);
    expect(colorPantalla('#7fb5e8')).toBe('#7fb5e8');
    expect(colorPantalla('#eef1f4')).toBe('#eef1f4');
  });
  it('en las 6 variables TODA la rampa queda legible sobre el fondo del mapa (luminancia ≥ mínimo) y conserva su tono', () => {
    for (const v of Object.keys(VARIABLES_PLANO) as VariablePlano[]) {
      const pal = paletaPantalla(v, 7);
      expect(pal).toHaveLength(8);
      expect(pal.every((c) => luminancia(c) >= LUM_MIN_PANTALLA - 0.004)).toBe(true);
    }
  });
  it('el aclarado solo afecta a pantalla: la rampa de los informes no cambia', () => {
    expect(VARIABLES_PLANO.lluvia.rampa[7]).toBe('#0a2456');
  });
});

describe('campoPantalla · capa de campo desde el MISMO modelo del motor', () => {
  const m = plano();
  it('el motor da bandas para este caso (sanidad del fixture)', () => {
    expect(m.motivoSD).toBeNull();
    expect(m.bandas.length).toBeGreaterThan(2);
  });
  it('una ruta de relleno y una de contorno por banda (con casing), en el proyector del mapa', () => {
    const s = campoSvg(m, P, { opacidad: 0.62, idTrama: 'mc-tr' });
    expect(s.relleno).toContain('opacity="0.62"');
    expect(s.relleno).toContain('fill-rule="evenodd"');
    expect((s.relleno.match(/fill-rule="evenodd"/g) ?? []).length).toBe(m.bandas.length);
    expect((s.contornos.match(/stroke="#ffffff"/g) ?? []).length).toBe(m.bandas.length);
    expect((s.contornos.match(/stroke="#04122b"/g) ?? []).length).toBe(m.bandas.length); // casing oscuro debajo de cada trazo claro
    expect(s.relleno + s.contornos).not.toMatch(/NaN|undefined|Infinity/);
  });
  it('el relleno usa colores de pantalla (nunca más oscuros que el mínimo) y nunca es opaco del todo si se pide opacidad', () => {
    const s = campoSvg(m, P, { opacidad: 0.6, idTrama: 'mc-tr' });
    const cols = [...s.relleno.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((x) => x[1]).filter((c) => c.toLowerCase() !== '#061532');
    expect(cols.length).toBeGreaterThan(0);
    expect(cols.every((c) => luminancia(c) >= LUM_MIN_PANTALLA - 0.004)).toBe(true);
  });
  it('sin cobertura (a más de 90 km) se vela y se rotula con trama; con pocos puntos el modelo es S/D y no hay capa', () => {
    const solo2 = campoSvg(plano('lluvia', puntos().slice(0, 2)), P, { opacidad: 0.6, idTrama: 'mc-tr' });
    expect(solo2).toEqual({ relleno: '', contornos: '' });
    const poca = plano('lluvia', [puntos()[0], puntos()[1], puntos()[2], puntos()[3], puntos()[4], puntos()[5]]);
    if (poca.sinCobertura.length) expect(campoSvg(poca, P, { opacidad: 0.6, idTrama: 'mc-tr' }).relleno).toContain('url(#mc-tr)');
  });
  it('la leyenda usa los mismos niveles y la misma rampa que el relleno', () => {
    const l = leyendaCampo(m);
    expect(l).toHaveLength(m.niveles.length + 1);
    expect(l[0]).toMatchObject({ desde: null, hasta: m.niveles[0] });
    expect(l[l.length - 1]).toMatchObject({ desde: m.niveles[m.niveles.length - 1], hasta: null });
    expect(l.map((c) => c.color)).toEqual(paletaPantalla('lluvia', m.niveles.length));
  });
  it('S/D nunca es 0: sin valores no hay bandas', () => {
    const sd = plano('lluvia', puntos().map((p) => ({ ...p, valor: null })));
    expect(sd.motivoSD).toBeTruthy();
    expect(campoSvg(sd, P, { opacidad: 0.6, idTrama: 'mc-tr' }).relleno).toBe('');
  });
});

describe('campoPantalla · valor interpolado en un punto', () => {
  const m = plano();
  const c: CampoCuenca = m.campo;
  it('en una estación el valor es casi el de la estación; entre estaciones queda dentro del rango del campo', () => {
    const v = valorEnCampo(c, -106.08, 28.64);
    expect(v.dentro && v.cubierta).toBe(true);
    expect(v.valor).not.toBeNull();
    expect(Math.abs((v.valor as number) - 55)).toBeLessThan(15);
    const e = valorEnCampo(c, -105.5, 27.9);
    expect(e.valor).not.toBeNull();
    expect(e.valor as number).toBeGreaterThanOrEqual((c.min ?? 0) - 1);
    expect(e.valor as number).toBeLessThanOrEqual((c.max ?? 0) + 1);
  });
  it('fuera de la cuenca o de la malla: S/D (null, nunca 0)', () => {
    expect(valorEnCampo(c, -100, 20)).toEqual({ valor: null, dentro: false, cubierta: false });
    const fuera = valorEnCampo(c, -108.5, 28.0);
    expect(fuera.valor).toBeNull();
  });
  it('lonLatDe invierte el proyector', () => {
    const { lon, lat } = lonLatDe(P, P.x(-106.1), P.y(28.6));
    expect(lon).toBeCloseTo(-106.1, 4);
    expect(lat).toBeCloseTo(28.6, 4);
  });
});

describe('capasCuenca · tema «campo»: casing oscuro y trazos claros que no se pierden en el relleno', () => {
  const op = { px: 12, ancho: 900, alto: 700 };
  it('con campo, módulos SRL con casing oscuro, trazo blanco y sin relleno propio', () => {
    const s = capasSvg({}, ['srl'], P, { ...op, tema: 'campo' }).bajo;
    expect(s).toContain('stroke="#04122b"');
    expect(s).toContain('stroke="#ffffff"');
    expect(s).toContain('fill="none"');
  });
  it('sin campo (pantalla) el dibujo NO cambia: sin casing', () => {
    const s = capasSvg({}, ['srl'], P, { ...op, tema: 'pantalla' }).bajo;
    expect(s).not.toContain('#04122b');
  });
});
