import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseEstaciones, parseSerie, depuraPunto, diasCompletos, hoyConservador, puntoParcial, horasDelPortal, HUSO_PORTAL_H, FormatoJcasError, LIMITES_MES, type PuntoSerie,
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
  it('horaria → instantes UTC: etiquetas en UTC-7; la última es la última hora COMPLETA y las demás retroceden hora por hora', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    const { horas } = horasDelPortal(r.puntos, new Date('2026-11-08T17:20:00Z'), true); // 10:20 en el reloj del portal → última completa = etiqueta 09:00
    expect(horas).toHaveLength(24);
    expect(horas[23].ts).toBe('2026-11-08T16:00:00.000Z'); // 09:00 UTC-7 = 16:00 UTC
    expect(horas[0].ts).toBe('2026-11-07T17:00:00.000Z'); // 10:00 UTC-7 del día anterior
    expect(horas[0].temp_c).toBe(16.24);
    expect(new Set(horas.map((x) => x.ts)).size).toBe(24);
    expect(HUSO_PORTAL_H).toBe(7);
  });
  it('horaria: trae todas las variables y la lluvia de una estación sin pluviómetro es null (el 0.0 del portal no es medición)', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    const con = horasDelPortal(r.puntos, new Date('2026-11-08T17:20:00Z'), true).horas[10];
    expect(Object.keys(con).sort()).toEqual(['hum_pct', 'lluvia_mm', 'presion_hpa', 'rocio_c', 'temp_c', 'ts', 'viento_kmh']);
    const sin = horasDelPortal(r.puntos, new Date('2026-11-08T17:20:00Z'), false).horas;
    expect(sin.every((h) => h.lluvia_mm === null)).toBe(true);
    expect(sin.some((h) => h.temp_c != null)).toBe(true);
  });
  it('horaria: la hora en curso (si el portal la trajera) se descarta por incompleta', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    const { horas } = horasDelPortal(r.puntos, new Date('2026-11-08T16:20:00Z'), true); // 09:20 portal: la etiqueta 09:00 está en curso
    expect(horas).toHaveLength(23);
    expect(horas[22].ts).toBe('2026-11-08T15:00:00.000Z');
  });
  it('horaria: si la última etiqueta se desfasa > 3 h de la hora del portal (estación detenida o huso distinto) no guarda nada', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    expect(() => horasDelPortal(r.puntos, new Date('2026-11-08T22:00:00Z'), true)).toThrow(FormatoJcasError);
  });
  it('horaria: horas no consecutivas o variable fuera de rango (S/D, no se corrige)', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    const ref = new Date('2026-11-08T17:20:00Z');
    const roto = r.puntos.map((p, i) => (i === 5 ? { ...p, clave: '20:00' } : p));
    expect(() => horasDelPortal(roto, ref, true)).toThrow(/consecutivas/);
    const raro = r.puntos.map((p, i) => (i === 3 ? { ...p, temp_c: 80, hum_pct: 140 } : p));
    const { horas, descartes } = horasDelPortal(raro, ref, true);
    expect(horas[3].temp_c).toBeNull();
    expect(horas[3].hum_pct).toBeNull();
    expect(descartes).toBeGreaterThanOrEqual(2);
  });
  it('etiqueta "NA" (estación con la serie rota) → error explícito, no se inventa la hora', () => {
    const r = parseSerie(fx('ojinaga_dia.js.html'), REF);
    expect(() => horasDelPortal(r.puntos.map((p, i) => (i === 7 ? { ...p, clave: 'NA' } : p)), new Date('2026-11-08T17:20:00Z'), true)).toThrow(/ilegible/);
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

describe('JCAS · huso del portal con datos REALES (2026-11-13 08:24 UTC)', () => {
  const REF13 = new Date('2026-11-13T08:24:25Z');
  const horas = (dia: string, pluv = true) => horasDelPortal(parseSerie(fx(dia), REF13).puntos, REF13, pluv).horas;
  const hoyUtc = (mes: string) => parseSerie(fx(mes), REF13).puntos.find((p) => p.clave === '2026-11-13')!;
  const sumaLluviaDesdeUtc = (hs: { ts: string; lluvia_mm: number | null }[]) => Math.round(hs.filter((h) => h.ts >= '2026-11-13T00:00:00.000Z').reduce((a, h) => a + (h.lluvia_mm ?? 0), 0) * 10) / 10;

  it('a las 08:24 UTC la última hora completa es la etiqueta 00:00 (UTC-7) = 07:00 UTC', () => {
    const h = horas('borja_dia_20261113.html');
    expect(h).toHaveLength(24);
    expect(h[23].ts).toBe('2026-11-13T07:00:00.000Z');
  });
  it('el «día» del portal es UTC: la lluvia horaria desde 00:00 UTC reproduce exactamente el total diario del 13 (Borja 7.8 mm, Balleza 1.2 mm)', () => {
    expect(sumaLluviaDesdeUtc(horas('borja_dia_20261113.html'))).toBe(7.8);
    expect(hoyUtc('borja_mes_20261113.html').lluvia_mm).toBe(7.8);
    expect(sumaLluviaDesdeUtc(horas('balleza_dia_20261113.html'))).toBe(1.2);
    expect(hoyUtc('balleza_mes_20261113.html').lluvia_mm).toBe(1.2);
  });
  it('las lluvias de las 17:00 y 18:00 locales de Chihuahua del día 12 caen en el «día» 13 del portal (por eso hay que reconstruir días locales)', () => {
    const h = horas('borja_dia_20261113.html');
    const tarde = h.filter((x) => x.lluvia_mm != null && x.lluvia_mm > 0);
    expect(tarde.map((x) => x.lluvia_mm)).toEqual([5.6, 2.2]);
    // 5.6 mm a las 00:00 UTC del 13 = 18:00 del 12 en Chihuahua (UTC-6)
    expect(tarde[0].ts).toBe('2026-11-13T00:00:00.000Z');
    const localChihuahua = new Date(Date.parse(tarde[0].ts) - 6 * 3_600_000).toISOString().slice(0, 13);
    expect(localChihuahua).toBe('2026-11-12T18');
  });
  it('San Antonio (sin pluviómetro): trae temperatura, humedad y viento por hora; la lluvia es S/D', () => {
    const h = horas('sanantonio_dia_20261113.html', false);
    expect(h.every((x) => x.lluvia_mm === null)).toBe(true);
    expect(h.filter((x) => x.temp_c != null && x.hum_pct != null && x.viento_kmh != null).length).toBeGreaterThanOrEqual(22);
  });
});
