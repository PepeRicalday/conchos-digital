import { describe, it, expect } from 'vitest';
import {
    agregarSerie, ceroSospechoso, estadoEnlace, fmt, fmtDelta, fusionarSeries, horaLocal, puntoCardinal, saludEnlace,
    puentearHuecos, tendencia, textoEdad, tiraEnlace, ultimoBueno, radiacionConfiable, tieneMeteo, colorEstacion, type MensajeHidro,
} from './hidroEstaciones';

const MIN = 60000;
const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

describe('frescura del enlace', () => {
    it('en línea / retraso / sin transmisión según la edad del último mensaje bueno', () => {
        expect(estadoEnlace(T0 - 30 * MIN, T0).clave).toBe('en_linea');
        expect(estadoEnlace(T0 - 120 * MIN, T0).clave).toBe('retraso');
        expect(estadoEnlace(T0 - 181 * MIN, T0).clave).toBe('sin_transmision');
    });
    it('sin mensajes o sin reloj = S/D, nunca en línea', () => {
        expect(estadoEnlace(null, T0).clave).toBe('sd');
        expect(estadoEnlace(T0, 0).clave).toBe('sd');
    });
    it('el límite de 180 min todavía cuenta como retraso', () => {
        expect(estadoEnlace(T0 - 180 * MIN, T0).clave).toBe('retraso');
    });
    it('textoEdad', () => {
        expect(textoEdad(null)).toBe('S/D');
        expect(textoEdad(12)).toBe('hace 12 min');
        expect(textoEdad(130)).toBe('hace 2 h 10 min');
        expect(textoEdad(60 * 24 * 3)).toBe('hace 3 d');
    });
});

describe('mensajes', () => {
    const msgs: MensajeHidro[] = [
        { estacion_id: 'A', ts_msg: new Date(T0 - 10 * MIN).toISOString(), codigo_falla: '?', senal_dbm: 30 },
        { estacion_id: 'A', ts_msg: new Date(T0 - 70 * MIN).toISOString(), codigo_falla: 'G', senal_dbm: 38 },
        { estacion_id: 'A', ts_msg: new Date(T0 - 130 * MIN).toISOString(), codigo_falla: 'G', senal_dbm: 36 },
        { estacion_id: 'B', ts_msg: new Date(T0 - 5 * MIN).toISOString(), codigo_falla: 'G', senal_dbm: 40 },
    ];
    it('el último bueno ignora mensajes con falla', () => {
        expect(ultimoBueno(msgs, 'A')).toBe(T0 - 70 * MIN);
        expect(ultimoBueno(msgs, 'Z')).toBeNull();
    });
    it('salud cuenta buenos vs falla y toma la señal del último mensaje', () => {
        const s = saludEnlace(msgs, 'A', T0 - 24 * 60 * MIN);
        expect(s.buenos).toBe(2);
        expect(s.conFalla).toBe(1);
        expect(s.pctBuenos).toBeCloseTo(66.67, 1);
        expect(s.senalDbm).toBe(30);
    });
    it('sin mensajes: porcentaje null, no 0', () => {
        expect(saludEnlace(msgs, 'Z', 0).pctBuenos).toBeNull();
    });
});

describe('tira de enlace 24 h', () => {
    const m = (min: number, c: string): MensajeHidro => ({ estacion_id: 'A', ts_msg: new Date(T0 - min * MIN).toISOString(), codigo_falla: c, senal_dbm: 30 });
    it('marca bueno, falla y sin mensaje por hora; un bueno gana a una falla de la misma hora', () => {
        const t = tiraEnlace([m(10, 'G'), m(70, '?'), m(75, 'G'), m(190, '?')], 'A', T0);
        expect(t).toHaveLength(24);
        expect(t[23]).toBe('bueno');
        expect(t[22]).toBe('bueno');
        expect(t[20]).toBe('falla');
        expect(t[0]).toBe('sin');
    });
    it('sin reloj todo es sin dato', () => {
        expect(tiraEnlace([m(10, 'G')], 'A', 0).every(c => c === 'sin')).toBe(true);
    });
});

describe('agregación y huecos', () => {
    it('promedia por cubeta de 30 min', () => {
        const base = Math.floor(T0 / (30 * MIN)) * 30 * MIN;
        const r = agregarSerie([{ t: base, v: 2 }, { t: base + 15 * MIN, v: 4 }, { t: base + 30 * MIN, v: 10 }], 30);
        expect(r).toEqual([{ t: base, v: 3 }, { t: base + 30 * MIN, v: 10 }]);
    });
    it('descarta no finitos', () => {
        expect(agregarSerie([{ t: T0, v: NaN }], 15)).toEqual([]);
    });
    it('la rejilla deja null (no 0) donde no hay dato', () => {
        const a = Math.floor(T0 / (15 * MIN)) * 15 * MIN;
        const filas = fusionarSeries({ X: [{ t: a, v: 1 }, { t: a + 30 * MIN, v: 3 }] }, 15, a, a + 30 * MIN);
        expect(filas.map(f => f.X)).toEqual([1, null, 3]);
    });
});

describe('puente de huecos cortos', () => {
    const a = Math.floor(T0 / (15 * MIN)) * 15 * MIN;
    const fila = (i: number, v: number | null) => ({ t: a + i * 15 * MIN, X: v });
    it('une huecos de ≤ 45 min y no toca los crudos', () => {
        const crudas = [fila(0, 0), fila(1, null), fila(2, 10), fila(3, null), fila(4, null), fila(5, null), fila(6, null), fila(7, 20)];
        const p = puentearHuecos(crudas, ['X'], 45);
        expect(p[1].X).toBe(5);
        expect(p[3].X).toBeNull();
        expect(p[6].X).toBeNull();
        expect(crudas[1].X).toBeNull();
    });
    it('el hueco de justo 45 min se une; el de 60 min no', () => {
        expect(puentearHuecos([fila(0, 1), fila(1, null), fila(2, null), fila(3, 4)], ['X'], 45)[1].X).toBe(2);
        expect(puentearHuecos([fila(0, 1), fila(1, null), fila(2, null), fila(3, null), fila(4, 5)], ['X'], 45)[1].X).toBeNull();
    });
});

describe('tendencia', () => {
    const serie = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180].map((m, i) => ({ t: T0 + m * MIN, v: 5 + i * 0.1 }));
    it('sube con delta de 1 h', () => {
        const t = tendencia(serie, 1, 0.01)!;
        expect(t.dir).toBe('sube');
        expect(t.delta).toBeCloseTo(0.4, 5);
    });
    it('estable bajo epsilon', () => {
        expect(tendencia(serie, 1, 1)!.dir).toBe('estable');
    });
    it('sin base suficiente devuelve null', () => {
        expect(tendencia([{ t: T0, v: 1 }], 1, 0.01)).toBeNull();
        expect(tendencia([], 1, 0.01)).toBeNull();
    });
});

describe('veracidad', () => {
    it('fmt: null y NaN son S/D, el cero real es 0,00', () => {
        expect(fmt(null)).toBe('S/D');
        expect(fmt(undefined)).toBe('S/D');
        expect(fmt(NaN)).toBe('S/D');
        expect(fmt(0)).toBe('0.00');
        expect(fmtDelta(-0.5)).toBe('−0.50');
        expect(fmtDelta(null)).toBe('S/D');
    });
    it('cero sospechoso solo en Babisas con nivel alto', () => {
        expect(ceroSospechoso('C6301416', 0, 6.2)).toBe(true);
        expect(ceroSospechoso('C6301416', 0, 5.0)).toBe(false);
        expect(ceroSospechoso('C6301416', 1.2, 6.2)).toBe(false);
        expect(ceroSospechoso('C6301416', null, 6.2)).toBe(false);
        expect(ceroSospechoso('C63009B2', 0, 6)).toBe(false);
    });
    it('Madero sin radiación, Ojinaga sin meteo', () => {
        expect(radiacionConfiable('C6301AC4')).toBe(false);
        expect(radiacionConfiable('C63009B2')).toBe(true);
        expect(tieneMeteo('C6300760')).toBe(false);
        expect(tieneMeteo('C6301AC4')).toBe(true);
    });
    it('color por entidad estable', () => {
        expect(colorEstacion('C63009B2')).toBe('#d95926');
    });
    it('puntos cardinales', () => {
        expect(puntoCardinal(0)).toBe('N');
        expect(puntoCardinal(90)).toBe('E');
        expect(puntoCardinal(270)).toBe('O');
        expect(puntoCardinal(null)).toBe('S/D');
    });
    it('hora local de Chihuahua (UTC-6)', () => {
        expect(horaLocal(Date.UTC(2026, 9, 26, 21, 0, 0))).toBe('15:00');
        expect(horaLocal(null)).toBe('S/D');
    });
});
