import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { interpretaContorno, type ContornoCuenca } from './geoCuenca';
import {
    arealDe, construirRedJcas, diasDeCarga, diasDeVentana, esVentanaLarga, valorObs, VENTANAS_OBS,
    type FilaEstacionJcas, type FilaLecturaJcas, type FilaLluviaPropia, type FilaClimaPropio,
} from './jcasModelo';
import { puntosObservados, rankingDePuntos } from './planosDatos';
import { escalaDe, familiaLluvia } from './escalasCuenca';
import { PLUVIOMETROS_EXCLUIDOS } from './jcasCuenca';
import { hoyJcasISO, hoyLocalISO } from './hoyLocal';
import type { PuntoCampo } from './camposCuenca';

const c = interpretaContorno(JSON.parse(readFileSync('public/geo/cuenca_conchos.geojson', 'utf8'))) as ContornoCuenca;
const HOY = '2026-11-08', FIN = '2026-11-07';
const SITIOS: [number, string, number, number][] = [
    [1, 'Chihuahua', 28.64, -106.08], [2, 'Aldama', 28.84, -105.91], [3, 'Satevó', 27.96, -106.11], [4, 'Camargo', 27.7, -105.17],
    [5, 'Zaragoza', 27.46, -105.81], [6, 'Parral', 26.93, -105.69], [7, 'Jiménez', 27.12, -104.9], [8, 'Balleza', 26.95, -106.35],
];
const est = (): FilaEstacionJcas[] => SITIOS.map(([id, nombre, latitud, longitud]) => ({ id_jcas: id, nombre, latitud, longitud, altitud_m: null, zona: 'cuenca', grupo_ciudad: null, tiene_pluviometro: true, activa: true, ult_fecha: FIN }));
const dia = (i: number) => new Date(Date.parse(`${FIN}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
/** `n` días de lectura (el último = FIN): 1 mm y 15 °C por día en todas las estaciones. */
const lecturas = (n: number): FilaLecturaJcas[] => SITIOS.flatMap(([id]) => Array.from({ length: n }, (_, i) => ({ estacion_id: id, fecha: dia(i), lluvia_mm: 1, temp_c: 15, hum_pct: 50, viento_kmh: 5 })));

describe('ventanas largas (60 d, 90 d, ciclo agrícola)', () => {
    it('hay 7 ventanas y las largas se reconocen', () => {
        expect(VENTANAS_OBS.map((x) => x.v)).toEqual(['hoy', 1, 7, 30, 60, 90, 'ciclo']);
        expect([60, 90, 'ciclo', 30, 'hoy'].map((v) => esVentanaLarga(v as never))).toEqual([true, true, true, false, false]);
    });
    it('días del ciclo: del 1-oct al último día completo; 0 el 1-oct (aún no hay días del ciclo nuevo)', () => {
        expect(diasDeVentana('ciclo', FIN)).toBe(38); // 1-oct … 7-nov
        expect(diasDeVentana('ciclo', '2026-09-30')).toBe(0);
        expect(diasDeVentana('ciclo', '2027-09-29')).toBe(364); // casi todo el ciclo 2026-27 (el 30-sep es el último día)
        expect(diasDeVentana(60, FIN)).toBe(60);
        expect(diasDeVentana('hoy', FIN)).toBe(1);
    });
    it('se piden al menos 95 días de lecturas y todo el ciclo en curso', () => {
        expect(diasDeCarga(HOY)).toBe(95);
        expect(diasDeCarga('2027-09-01')).toBeGreaterThan(300);
    });
    it('con historia suficiente: 60, 90 y ciclo dan lluvia areal y valores por estación', () => {
        const m = construirRedJcas(est(), lecturas(100), HOY, c.poligonos);
        expect(arealDe(m, 60).mm).toBeCloseTo(60, 0);
        expect(arealDe(m, 90).mm).toBeCloseTo(90, 0);
        expect(arealDe(m, 'ciclo').mm).toBeCloseTo(38, 0);
        expect(valorObs(m.puntos[0], 'lluvia', 90)).toBe(90);
        expect(valorObs(m.puntos[0], 'temperatura', 60)).toBe(15);
        expect(valorObs(m.puntos[0], 'humedad', 'ciclo')).toBe(50);
        expect(valorObs(m.puntos[0], 'viento', 90)).toBe(5);
    });
    it('con historia corta (40 días): 60 y 90 son S/D con el motivo y la fecha de inicio, nunca 0; el ciclo (38 d) sí', () => {
        const m = construirRedJcas(est(), lecturas(40), HOY, c.poligonos);
        expect(m.inicioHistoria).toBe(dia(39));
        for (const v of [60, 90] as const) {
            expect(arealDe(m, v).mm).toBeNull();
            expect(arealDe(m, v).motivoSD).toMatch(/historia diaria guardada empieza el 2026-09-29/);
            expect(valorObs(m.puntos[0], 'lluvia', v)).toBeNull();
            expect(valorObs(m.puntos[0], 'temperatura', v)).toBeNull();
        }
        expect(arealDe(m, 'ciclo').mm).not.toBeNull();
    });
    it('el 1-oct el ciclo nuevo aún no tiene días: S/D con motivo', () => {
        const m = construirRedJcas(est(), lecturas(100), '2026-10-01', c.poligonos);
        expect(arealDe(m, 'ciclo').mm).toBeNull();
        expect(arealDe(m, 'ciclo').motivoSD).toMatch(/apenas comienza/);
    });
    it('las propias también tienen ventanas largas (lluvia y clima) y puntosObservados las usa', () => {
        const fila = (n: number): FilaLluviaPropia[] => Array.from({ length: n }, (_, i) => ({ estacion_id: 'wl', nombre: 'Módulo 1', latitud: 27.97, longitud: -105.28, fecha: dia(i), lluvia_mm: 2, ult_lectura: `${dia(i)}T20:00:00Z` }));
        const clima: FilaClimaPropio[] = Array.from({ length: 100 }, (_, i) => ({ estacion_id: 'wl', fecha: dia(i), temp_c: 18, hum_pct: 40, viento_kmh: 3 }));
        const m = construirRedJcas(est(), lecturas(100), HOY, c.poligonos, [], fila(100), clima);
        const p = puntosObservados(m, 'lluvia', 90).find((x) => x.nombre === 'Módulo 1')!;
        expect(p.valor).toBe(180);
        expect(puntosObservados(m, 'temperatura', 60).find((x) => x.nombre === 'Módulo 1')!.valor).toBe(18);
    });
    it('escala de lluvia larga: familia propia sin base multianual declarada', () => {
        expect([30, 45, 60, 90, 'ciclo'].map((d) => familiaLluvia(d as number))).toEqual(['mes', 'mes', 'largo', 'largo', 'largo']);
        const e = escalaDe('lluvia', 'ciclo');
        expect(e.niveles[e.niveles.length - 1]).toBeGreaterThan(300);
        expect(e.base).toMatch(/sin base multianual/);
        expect(e.base).not.toMatch(/normal|percentil|anomal/i);
    });
});

describe('pendientes menores', () => {
    it('Parral (6) queda excluido de la lluvia por criterio explícito aunque registre lluvia, con motivo; su temperatura sigue valiendo', () => {
        expect(PLUVIOMETROS_EXCLUIDOS[6]).toMatch(/criterio de SICA/);
        const m = construirRedJcas(est(), lecturas(40), HOY, c.poligonos);
        const parral = m.puntos.find((p) => p.id === 6)!;
        expect(parral.sospechosa).toBe(true);
        expect(parral.motivo).toMatch(/criterio de SICA/);
        expect(m.areal30.nExcluidas).toBeGreaterThanOrEqual(1);
        const pts = puntosObservados(m, 'temperatura', 30);
        expect(pts.find((p) => p.nombre === 'Parral')!.sospechosa).toBe(false);
        expect(pts.find((p) => p.nombre === 'Parral')!.valor).toBe(15);
    });
    it('una propia y una JCAS del mismo sitio (< 3 km) son una estación: gana la propia', () => {
        const prop: FilaLluviaPropia[] = Array.from({ length: 40 }, (_, i) => ({ estacion_id: 'wl', nombre: 'Módulo X', latitud: 28.645, longitud: -106.082, fecha: dia(i), lluvia_mm: 3, ult_lectura: `${dia(i)}T20:00:00Z` }));
        const m = construirRedJcas(est(), lecturas(40), HOY, c.poligonos, [], prop);
        const pts = puntosObservados(m, 'lluvia', 30);
        expect(pts.some((p) => p.nombre === 'Chihuahua')).toBe(false);
        expect(pts.some((p) => p.nombre === 'Módulo X')).toBe(true);
        expect(pts.some((p) => p.nombre === 'Aldama')).toBe(true); // las demás siguen
    });
    it('ranking: parte de los puntos colapsados, sin sospechosas, S/D aparte y nunca como 0', () => {
        const pts: PuntoCampo[] = [
            { id: 'a', nombre: 'A', lat: 0, lon: 0, valor: 50 }, { id: 'b', nombre: 'B', lat: 0, lon: 0, valor: 120 },
            { id: 'c', nombre: 'C', lat: 0, lon: 0, valor: null }, { id: 'd', nombre: 'Parral', lat: 0, lon: 0, valor: 0, sospechosa: true },
            { id: 'g', nombre: 'Chihuahua (4 est.)', lat: 0, lon: 0, valor: 80 },
        ];
        const r = rankingDePuntos(pts);
        expect(r.filas.map((f) => f.nombre)).toEqual(['B', 'Chihuahua (4 est.)', 'A']);
        expect(r.sinDato).toBe(1);
        expect(rankingDePuntos([])).toEqual({ filas: [], sinDato: 0 });
    });
    it('hoy local: UTC-6 para el distrito y UTC-7 conservador para JCAS (entre 00:00 y 01:00 locales difieren a propósito)', () => {
        const t = Date.parse('2026-11-08T06:30:00Z'); // 00:30 locales del 8-nov
        expect(hoyLocalISO(t)).toBe('2026-11-08');
        expect(hoyJcasISO(t)).toBe('2026-11-07');
    });
});
