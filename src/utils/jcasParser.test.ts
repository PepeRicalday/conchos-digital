import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseEstaciones, parseSerie, depuraPunto, diasCompletos, hoyConservador, puntoParcial, puntosHorarios, FormatoJcasError, LIMITES_MES, type PuntoSerie,
} from '../../supabase/functions/jcas-sync/parser';

const fx = (n: string) => readFileSync(`supabase/functions/jcas-sync/fixtures/${n}`, 'utf8');
const REF = new Date('2026-11-08T17:00:00Z');

describe('JCAS · lista de estaciones', () => {
  const est = parseEstaciones(JSON.parse(fx('estaciones.json')));
  it('lee las 42 estaciones con coordenadas finitas', () => {
    expect(est).toHaveLength(42);
    expect(est.every((e) => Number.isFinite(e.latitud) && Number.isFinite(e.longitud))).toBe(true);
  });
  it('Ojinaga: coordenadas, altitud, pluviómetro y última actualización', () => {
    const o = est.find((e) => e.id === 30)!;
    expect(o.nombre).toBe('Ojinaga');
    expect(o.latitud).toBeCloseTo(29.566, 3);
    expect(o.altitud_m).toBe(800);
    expect(o.tienePluviometro).toBe(true);
    expect(o.actualizada).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
  it('altitud vacía → null, no 0 (Satevó y San Juanito no la reportan)', () => {
    expect(est.find((e) => e.nombre === 'Satevó')!.altitud_m).toBeNull();
  });
  it('estación sin pluviómetro (Temósachi) se marca', () => {
    expect(est.find((e) => e.nombre === 'Temósachi')!.tienePluviometro).toBe(false);
  });
  it('descarta filas sin coordenadas y falla si no hay lista ni estaciones válidas', () => {
    expect(parseEstaciones([{ id: 1, latitud: 'x', longitud: '1' }, { id: 2, nombre: 'a', latitud: '28', longitud: '-105' }])).toHaveLength(1);
    expect(() => parseEstaciones({})).toThrow(FormatoJcasError);
    expect(() => parseEstaciones([{ id: 1, latitud: null, longitud: null }])).toThrow(FormatoJcasError);
  });
  it('no conserva identificadores de acceso remoto', () => {
    expect(fx('estaciones.json')).not.toMatch(/teamviewer/i);
    expect(Object.keys(est[0])).not.toContain('teamviewer');
  });
});

describe('JCAS · serie mensual (por día)', () => {
  const { modo, puntos } = parseSerie(fx('ojinaga_mes.js.html'), REF);
  it('modo "mes", 32 días, claves YYYY-MM-DD con el año completado', () => {
    expect(modo).toBe('mes');
    expect(puntos).toHaveLength(32);
    expect(puntos[0].clave).toBe('2026-10-08');
    expect(puntos[31].clave).toBe('2026-11-08');
  });
  it('cruza el cambio de año: 31/12 visto el 3-ene pertenece al año anterior', () => {
    const html = fx('ojinaga_mes.js.html').replace(/var graph_label = \[[^\]]*\];/, 'var graph_label = ["31/12","01/01"];')
      .replace(/(var (?:temp|bar|rain|hum|wind|dew_pt)_value = )\[[^\]]*\];/g, '$1[1.5,2.5];');
    const r = parseSerie(html, new Date('2027-01-03T12:00:00Z'));
    expect(r.puntos.map((p) => p.clave)).toEqual(['2026-12-31', '2027-01-01']);
  });
  it('lluvia del 16-oct = 26.0 mm y 8-nov = 15.6 mm (valores reales del fixture)', () => {
    expect(puntos.find((p) => p.clave === '2026-10-16')!.lluvia_mm).toBe(26);
    expect(puntos.find((p) => p.clave === '2026-11-08')!.lluvia_mm).toBe(15.6);
  });
  it('diasCompletos descarta el día en curso (parcial)', () => {
    const d = diasCompletos(puntos, REF, true);
    expect(d.at(-1)!.fecha).toBe('2026-11-07');
    expect(d).toHaveLength(31);
  });
  it('puntoParcial devuelve el día en curso (8-nov, 15.6 mm) y nunca un día completo', () => {
    const p = puntoParcial(puntos, REF, true)!;
    expect(p.fecha).toBe('2026-11-08');
    expect(p.punto.lluvia_mm).toBe(15.6);
    expect(puntoParcial(puntos.filter((x) => x.clave < '2026-11-08'), REF, true)).toBeNull();
  });
  it('puntoParcial: sin pluviómetro la lluvia de hoy es S/D (el 0.0 del portal no es "no llovió")', () => {
    expect(puntoParcial(puntos, REF, false)!.punto.lluvia_mm).toBeNull();
  });
  it('estación que dejó de transmitir: se enlaza por etiqueta, no por posición (Temósachi, 6 días)', () => {
    const r = parseSerie(fx('temosachi_mes.js.html'), REF);
    expect(r.puntos).toHaveLength(6);
    expect(r.puntos.at(-1)!.clave).toBe('2026-10-13');
  });
});

describe('JCAS · serie anual (mensual) y horaria', () => {
  it('anual: claves YYYY-MM y lluvia de octubre 2026 = 54.2', () => {
    const r = parseSerie(fx('ojinaga_anio.js.html'), REF);
    expect(r.modo).toBe('anio');
    expect(r.puntos).toHaveLength(13);
    expect(r.puntos.find((p) => p.clave === '2026-10')!.lluvia_mm).toBe(54.2);
  });
  it('horaria: 24 puntos HH:00', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    expect(r.modo).toBe('dia');
    expect(r.puntos).toHaveLength(24);
    expect(r.puntos[0].clave).toBe('10:00');
  });
  it('horaria → instantes UTC: la última hora (09:00 local) es la hora de consulta y las demás retroceden hora por hora', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    const h = puntosHorarios(r.puntos, new Date('2026-11-08T15:20:00Z')); // 09:20 hora local (UTC-6)
    expect(h).toHaveLength(24);
    expect(h[23].ts).toBe('2026-11-08T15:00:00.000Z');
    expect(h[0].ts).toBe('2026-11-07T16:00:00.000Z'); // 10:00 local del día anterior
    expect(h[0].temp_c).toBe(16.24);
    expect(new Set(h.map((x) => x.ts)).size).toBe(24);
  });
  it('horaria: si la última etiqueta no coincide con la hora local de consulta (huso distinto) no guarda nada', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    expect(() => puntosHorarios(r.puntos, new Date('2026-11-08T22:00:00Z'))).toThrow(FormatoJcasError);
  });
  it('horaria: horas no consecutivas o temperatura fuera de rango (S/D, no se corrige)', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    const roto = r.puntos.map((p, i) => (i === 5 ? { ...p, clave: '20:00' } : p));
    expect(() => puntosHorarios(roto, new Date('2026-11-08T15:20:00Z'))).toThrow(/consecutivas/);
    const raro = r.puntos.map((p, i) => (i === 3 ? { ...p, temp_c: 80 } : p));
    expect(puntosHorarios(raro, new Date('2026-11-08T15:20:00Z'))[3].temp_c).toBeNull();
  });
});

describe('JCAS · cambio de formato → error explícito, nunca datos inventados', () => {
  const base = fx('ojinaga_mes.js.html');
  it('falta un arreglo', () => {
    expect(() => parseSerie(base.replace('var rain_value', 'var lluvia'), REF)).toThrow(/rain_value/);
  });
  it('longitudes distintas', () => {
    expect(() => parseSerie(base.replace(/var rain_value = \[[^\]]*\];/, 'var rain_value = [1.0];'), REF)).toThrow(FormatoJcasError);
  });
  it('etiqueta ilegible o fecha inexistente', () => {
    expect(() => parseSerie(base.replace(/var graph_label = \[[^\]]*\];/, 'var graph_label = ["ayer"];'), REF)).toThrow(FormatoJcasError);
    const una = (v: string) => base.replace(/var graph_label = \[[^\]]*\];/, 'var graph_label = ["31/04"];')
      .replace(/(var (?:temp|bar|rain|hum|wind|dew_pt)_value = )\[[^\]]*\];/g, `$1[${v}];`);
    expect(() => parseSerie(una('1'), REF)).toThrow(/inexistente/);
  });
  it('xLabel desconocido y HTML ajeno', () => {
    expect(() => parseSerie(base.replace('"Día"', '"Semana"'), REF)).toThrow(/xLabel/);
    expect(() => parseSerie('<html>Mantenimiento</html>', REF)).toThrow(FormatoJcasError);
  });
  it('NaN/null/cadenas en valores → S/D (null), nunca 0', () => {
    const html = base.replace(/var graph_label = \[[^\]]*\];/, 'var graph_label = ["01/11","02/11"];')
      .replace(/(var (?:temp|bar|hum|wind|dew_pt)_value = )\[[^\]]*\];/g, '$1[null,"--"];')
      .replace(/var rain_value = \[[^\]]*\];/, 'var rain_value = [null,0.0];');
    const r = parseSerie(html, REF);
    expect(r.puntos[0].temp_c).toBeNull();
    expect(r.puntos[1].temp_c).toBeNull();
    expect(r.puntos[0].lluvia_mm).toBeNull();
    expect(r.puntos[1].lluvia_mm).toBe(0);
  });
});

describe('JCAS · depuración', () => {
  const p = (o: Partial<PuntoSerie>): PuntoSerie => ({ clave: '2026-11-01', temp_c: 20, hum_pct: 50, viento_kmh: 5, presion_hpa: 1010, rocio_c: 8, lluvia_mm: 0, ...o });
  it('anula valores imposibles sin tocar el resto', () => {
    const r = depuraPunto(p({ temp_c: 85, lluvia_mm: 400, presion_hpa: 12 }), true);
    expect(r.punto.temp_c).toBeNull();
    expect(r.punto.lluvia_mm).toBeNull();
    expect(r.punto.presion_hpa).toBeNull();
    expect(r.punto.hum_pct).toBe(50);
    expect(r.descartados).toHaveLength(3);
  });
  it('sin pluviómetro la lluvia es S/D aunque el portal diga 0.0', () => {
    expect(depuraPunto(p({ lluvia_mm: 0 }), false).punto.lluvia_mm).toBeNull();
    expect(depuraPunto(p({ lluvia_mm: 0 }), true).punto.lluvia_mm).toBe(0);
  });
  it('el total mensual de lluvia de julio (> 150 mm) es válido; el techo diario no se aplica a meses', () => {
    expect(depuraPunto(p({ lluvia_mm: 212.4 }), true).punto.lluvia_mm).toBeNull();           // como lluvia DIARIA es imposible
    expect(depuraPunto(p({ lluvia_mm: 212.4 }), true, LIMITES_MES).punto.lluvia_mm).toBe(212.4); // como total MENSUAL es real
    expect(depuraPunto(p({ lluvia_mm: 5000 }), true, LIMITES_MES).punto.lluvia_mm).toBeNull();
  });
  it('hoyConservador usa UTC-7', () => {
    expect(hoyConservador(new Date('2026-11-08T05:00:00Z'))).toBe('2026-11-07');
    expect(hoyConservador(new Date('2026-11-08T07:00:00Z'))).toBe('2026-11-08');
  });
});
