import { describe, expect, it } from 'vitest';
import {
    UMBRAL_BAJO_PCT, UMBRAL_CRITICO_PCT, areaKm2PorElevacion, conciliaSuperficie, cotasDePresa, deficitBajoNamo, estadoEmbalse, mensajeEstado,
    sinComillas, tendenciaNivel, volumenPorElevacion, type PuntoCurva,
} from './presaNiveles';

const CURVA: PuntoCurva[] = [
    { elevacion_msnm: 1290, volumen_mm3: 500, area_ha: 5000 },
    { elevacion_msnm: 1300, volumen_mm3: 800, area_ha: 6000 },
    { elevacion_msnm: 1310, volumen_mm3: 1300, area_ha: 7000 },
];

describe('estado del embalse', () => {
    it('umbrales únicos 20 / 40 y S/D sin dato (con el 24.9 % real → BAJO)', () => {
        expect(UMBRAL_CRITICO_PCT).toBe(20); expect(UMBRAL_BAJO_PCT).toBe(40);
        expect(estadoEmbalse(24.93)).toEqual({ clave: 'warn', etiqueta: 'BAJO' });
        expect(estadoEmbalse(19.99).clave).toBe('crit');
        expect(estadoEmbalse(20).clave).toBe('warn');
        expect(estadoEmbalse(40).clave).toBe('ok');
        expect(estadoEmbalse(null).clave).toBe('sd');
        expect(estadoEmbalse(NaN).clave).toBe('sd');
    });
});

describe('cotas y déficit', () => {
    it('NAMO/NAME de La Boquilla y Madero; presa desconocida → null', () => {
        expect(cotasDePresa('PRE-001')).toMatchObject({ namo: 1317, name: 1319.1, muerta: 1278.9, fondo: 1265 });
        expect(cotasDePresa('PRE-002')).toMatchObject({ namo: 1239.3, name: 1242.56 });
        expect(cotasDePresa('PRE-999').namo).toBeNull();
    });
    it('déficit bajo el NAMO: 1317.00 − 1297.12 = 19.88 m; sin nivel o sin cota → null', () => {
        expect(deficitBajoNamo(1297.12, 1317)).toBeCloseTo(19.88, 9);
        expect(deficitBajoNamo(1318, 1317)).toBeCloseTo(-1, 9);
        expect(deficitBajoNamo(null, 1317)).toBeNull();
        expect(deficitBajoNamo(1297, null)).toBeNull();
    });
});

describe('curva', () => {
    it('interpola volumen y área; sin curva o con 1 punto → null', () => {
        expect(volumenPorElevacion(CURVA, 1295)).toBeCloseTo(650, 9);
        expect(areaKm2PorElevacion(CURVA, 1305)).toBeCloseTo(65, 9);
        expect(volumenPorElevacion(CURVA, 1280)).toBe(500); // por debajo: tope inferior
        expect(volumenPorElevacion(undefined, 1295)).toBeNull();
        expect(volumenPorElevacion([CURVA[0]], 1295)).toBeNull();
    });
    it('área faltante en el tramo → null (no 0)', () => {
        const c: PuntoCurva[] = [{ elevacion_msnm: 1, volumen_mm3: 1, area_ha: null }, { elevacion_msnm: 2, volumen_mm3: 2, area_ha: 10 }];
        expect(areaKm2PorElevacion(c, 1.5)).toBeNull();
    });
});

describe('tendencia real del nivel', () => {
    it('usa la mayor base dentro de 7 días: 1297.12 (7-oct) vs 1297.00 (5-oct) = +0.06 m/día', () => {
        const t = tendenciaNivel([
            { fecha: '2026-10-05', escala_msnm: 1297.0 }, { fecha: '2026-10-06', escala_msnm: 1297.03 }, { fecha: '2026-10-07', escala_msnm: 1297.12 },
        ]);
        expect(t.direccion).toBe('sube');
        expect(t.dias).toBe(2);
        expect(t.mPorDia).toBeCloseTo(0.06, 9);
    });
    it('estable, baja, y sin base suficiente (S/D)', () => {
        expect(tendenciaNivel([{ fecha: '2026-10-05', escala_msnm: 1297.0 }, { fecha: '2026-10-07', escala_msnm: 1297.02 }]).direccion).toBe('estable');
        expect(tendenciaNivel([{ fecha: '2026-10-05', escala_msnm: 1298 }, { fecha: '2026-10-07', escala_msnm: 1297 }]).direccion).toBe('baja');
        expect(tendenciaNivel([{ fecha: '2026-10-07', escala_msnm: 1297 }]).direccion).toBe('sd');
        // la lectura previa está a más de 7 días: no hay tendencia que declarar
        expect(tendenciaNivel([{ fecha: '2026-09-01', escala_msnm: 1290 }, { fecha: '2026-10-07', escala_msnm: 1297 }]).direccion).toBe('sd');
        expect(tendenciaNivel([{ fecha: '2026-10-06', escala_msnm: null }, { fecha: '2026-10-07', escala_msnm: 1297 }]).direccion).toBe('sd');
    });
});

describe('mensaje de estado (nunca "estable" sin datos)', () => {
    const base = { tieneNivel: true, estado: estadoEmbalse(24.93), deficitM: 19.88, simulado: false, deltaSimM: null };
    it('con tendencia al alza: severidad ámbar, déficit y velocidad', () => {
        const m = mensajeEstado({ ...base, tendencia: { mPorDia: 0.06, dias: 2, direccion: 'sube' } });
        expect(m.severidad).toBe('warn');
        expect(m.titulo).toBe('Embalse bajo');
        expect(m.detalle).toContain('19.88 m por debajo del NAMO');
        expect(m.detalle).toContain('subiendo +0.06 m/día (2 d)');
        expect(m.detalle).not.toMatch(/estable/);
    });
    it('sin tendencia dice que faltan datos en vez de afirmar estabilidad', () => {
        const m = mensajeEstado({ ...base, tendencia: { mPorDia: null, dias: null, direccion: 'sd' } });
        expect(m.detalle).toContain('tendencia sin datos suficientes');
        expect(m.detalle).not.toMatch(/estable/);
    });
    it('simulación y sin lectura', () => {
        expect(mensajeEstado({ ...base, simulado: true, deltaSimM: -2.5, tendencia: { mPorDia: null, dias: null, direccion: 'sd' } }).detalle).toContain('−2.50 m');
        expect(mensajeEstado({ ...base, tieneNivel: false, tendencia: { mPorDia: null, dias: null, direccion: 'sd' } }).severidad).toBe('sd');
    });
    it('sobre el NAMO', () => {
        const m = mensajeEstado({ ...base, estado: estadoEmbalse(95), deficitM: -0.5, tendencia: { mPorDia: 0, dias: 3, direccion: 'estable' } });
        expect(m.detalle).toContain('0.50 m sobre el NAMO');
        expect(m.detalle).toContain('nivel estable (3 d)');
    });
});

describe('conciliación de superficies', () => {
    it('ordena curva, Sentinel y visual con su diferencia contra la curva (58.86 / 44.27 / 47.5 km²)', () => {
        const r = conciliaSuperficie({ curvaKm2: 58.86, sentinel: { km2: 44.27, fecha: '2026-10-01', nubesPct: 15.9 }, visual: { km2: 47.5, cobertura: 1 } });
        expect(r.map((f) => f.clave)).toEqual(['curva', 'sentinel', 'visual']);
        expect(r[0].difVsCurvaPct).toBeNull();
        expect(r[1].difVsCurvaPct).toBeCloseTo(-24.8, 0);
        expect(r[2].difVsCurvaPct).toBeCloseTo(-19.3, 0);
        expect(r[1].validada).toBe(true); expect(r[2].validada).toBe(false);
        expect(r[1].detalle).toContain('15.9 % de nubes');
    });
    it('sin curva no inventa diferencias; sin fuentes devuelve lista vacía', () => {
        const r = conciliaSuperficie({ curvaKm2: null, sentinel: null, visual: { km2: 47.5, cobertura: 1 } });
        expect(r).toHaveLength(1);
        expect(r[0].difVsCurvaPct).toBeNull();
        expect(conciliaSuperficie({ curvaKm2: null, sentinel: null, visual: null })).toEqual([]);
    });
});

describe('título', () => {
    it('quita las comillas literales del dato', () => {
        expect(sinComillas('PRESA LA "BOQUILLA"')).toBe('PRESA LA BOQUILLA');
        expect(sinComillas('Presa “Fco. I. Madero”')).toBe('Presa Fco. I. Madero');
    });
});
