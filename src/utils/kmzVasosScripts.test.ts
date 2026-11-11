/**
 * Pruebas de los scripts de siembra de la cuenca (scripts/kmz_vasos.mjs y scripts/sina_backfill.mjs).
 * Son .mjs fuera de src: se importan por URL para no depender de tipos. Sin red ni archivos externos.
 */
import { describe, expect, it } from 'vitest';

type Par = [number, number];
interface KmzVasos {
  codificarAnillo: (a: Par[]) => string;
  decodificarAnillo: (t: string) => Par[];
  medidas: (a: Par[]) => { areaSignada: number; perimetroKm: number; centroide: Par };
  autointersecciones: (a: Par[]) => number;
  separarLazos: (a: Par[]) => { exterior: Par[]; lazos: Par[][] };
  simplificar: (a: Par[], tolM: number) => Par[];
  prepararAnillo: (a: Par[]) => { anillo: Par[]; huecos: Par[][]; areaKm2: number; areaIslasKm2: number; areaExteriorKm2: number; bbox: number[]; reparacion: unknown };
  dentro: (p: Par, a: Par[]) => boolean;
}
interface SinaBackfill {
  fechasDeCierre: (desde: string, tope: string) => string[];
  num: (v: unknown) => number | null;
  filaDiaria: (r: Record<string, unknown>) => Record<string, unknown>;
}

const kmz = (await import(/* @vite-ignore */ new URL('../../scripts/kmz_vasos.mjs', import.meta.url).href)) as KmzVasos;
const sina = (await import(/* @vite-ignore */ new URL('../../scripts/sina_backfill.mjs', import.meta.url).href)) as SinaBackfill;

/** Rectángulo antihorario de ~1.09 km² junto a Delicias (lat 28°). */
const RECT: Par[] = [[-105.5, 28], [-105.49, 28], [-105.49, 28.01], [-105.5, 28.01], [-105.5, 28]];

describe('kmz_vasos · geometría', () => {
  it('mide el área de un rectángulo de 0.01° × 0.01° a 28° de latitud (~1.09 km²)', () => {
    const m = kmz.medidas(RECT);
    expect(m.areaSignada).toBeGreaterThan(1.05);
    expect(m.areaSignada).toBeLessThan(1.13);
    expect(m.centroide[0]).toBeCloseTo(-105.495, 4);
    expect(m.centroide[1]).toBeCloseTo(28.005, 4);
  });

  it('codifica y decodifica un anillo sin perder más de 1e-5° (≈1 m)', () => {
    const ida = kmz.decodificarAnillo(kmz.codificarAnillo(RECT));
    expect(ida).toHaveLength(RECT.length);
    ida.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(RECT[i][0], 5);
      expect(p[1]).toBeCloseTo(RECT[i][1], 5);
    });
  });

  it('el alfabeto de la codificación no trae comillas, barras ni puntos (el punto separa anillos)', () => {
    const t = kmz.codificarAnillo([[-105.77453, 27.46027], [-105.37509, 27.57937], [-106.19398, 28.54383], [-105.77453, 27.46027]]);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('simplifica sin abrir ni mover el anillo y conserva el cierre', () => {
    const circulo: Par[] = Array.from({ length: 361 }, (_, i) => [-105.5 + 0.02 * Math.cos((i * Math.PI) / 180), 28 + 0.02 * Math.sin((i * Math.PI) / 180)] as Par);
    circulo[circulo.length - 1] = [...circulo[0]] as Par;
    const s = kmz.simplificar(circulo, 25);
    expect(s.length).toBeLessThan(circulo.length);
    expect(s[0]).toEqual(s[s.length - 1]);
    expect(Math.abs(kmz.medidas(s).areaSignada - kmz.medidas(circulo).areaSignada) / kmz.medidas(circulo).areaSignada).toBeLessThan(0.01);
  });
});

describe('kmz_vasos · cruces del trazo (islas en ojo de cerradura)', () => {
  /** Orilla exterior de 0.04° con un lazo interior que entra y sale por el mismo punto: una isla dibujada de golpe. */
  const OJO: Par[] = [
    [-105.5, 28], [-105.46, 28], [-105.46, 28.04], [-105.5, 28.04],
    // entra a la orilla izquierda, rodea la isla y regresa cruzando su propio trazo
    [-105.5, 28.025], [-105.485, 28.025], [-105.485, 28.015], [-105.475, 28.015], [-105.475, 28.025], [-105.49, 28.02], [-105.49, 28.025], [-105.5, 28.025],
    [-105.5, 28],
  ];

  it('detecta la autointersección', () => {
    expect(kmz.autointersecciones(OJO)).toBeGreaterThan(0);
  });

  it('separarLazos deja un contorno exterior simple y entrega el lazo aparte', () => {
    const { exterior, lazos } = kmz.separarLazos(OJO);
    expect(kmz.autointersecciones(exterior)).toBe(0);
    expect(lazos.length).toBeGreaterThan(0);
  });

  it('prepararAnillo orienta antihorario y acepta un anillo simple sin reparación', () => {
    const horario = [...RECT].reverse();
    const p = kmz.prepararAnillo(horario);
    expect(kmz.medidas(p.anillo).areaSignada).toBeGreaterThan(0);
    expect(p.huecos).toHaveLength(0);
    expect(p.reparacion).toBeNull();
    expect(p.areaKm2).toBeGreaterThan(1.05);
  });

  it('prepararAnillo cierra un anillo abierto y rechaza menos de 4 vértices', () => {
    const abierto = RECT.slice(0, 4);
    expect(kmz.prepararAnillo(abierto).anillo.at(-1)).toEqual(abierto[0]);
    expect(() => kmz.prepararAnillo([[-105.5, 28], [-105.49, 28], [-105.5, 28]])).toThrow(/mínimo 4/);
  });
});

describe('sina_backfill', () => {
  it('genera el último día de cada mes y termina en la fecha tope del portal', () => {
    const f = sina.fechasDeCierre('2021-01', '2025-04-23');
    expect(f[0]).toBe('2021-01-31');
    expect(f).toContain('2024-02-29');
    expect(f).toContain('2025-03-31');
    expect(f.at(-1)).toBe('2025-04-23');
    expect(f).toHaveLength(52); // 51 cierres (ene-2021 → mar-2025) + el tope
  });

  it('si el tope es fin de mes no lo repite', () => {
    const f = sina.fechasDeCierre('2025-01', '2025-03-31');
    expect(f).toEqual(['2025-01-31', '2025-02-28', '2025-03-31']);
  });

  it('num(): vacío y texto son S/D (null); el cero es un valor y se conserva', () => {
    expect(sina.num('')).toBeNull();
    expect(sina.num(null)).toBeNull();
    expect(sina.num(undefined)).toBeNull();
    expect(sina.num('abc')).toBeNull();
    expect(sina.num('0')).toBe(0);
    expect(sina.num(0)).toBe(0);
    expect(sina.num('2893.57104492188')).toBeCloseTo(2893.571, 3);
  });

  it('filaDiaria redondea el ruido de punto flotante del portal y no inventa ceros', () => {
    const f = sina.filaDiaria({
      clavesih: 'LBQCH', fechamonitoreo: '2021-01-31', elevacionactual: 1299.78, almacenaactual: 890.506, llenano: 0.307753286916113,
      namoalmac: 2893.57104492188, namoelev: 1317, namealmac: 3453.576, nameelev: 1320, idmonitoreodiario: 1926753,
    });
    expect(f).toMatchObject({ clave: 'LBQCH', fecha: '2021-01-31', elev: 1299.78, alm: 890.506, namoAlm: 2893.571, id: 1926753 });
    const sd = sina.filaDiaria({ clavesih: 'PAZCH', fechamonitoreo: '2025-05-31', elevacionactual: '', almacenaactual: null });
    expect(sd).toMatchObject({ elev: null, alm: null });
  });
});
