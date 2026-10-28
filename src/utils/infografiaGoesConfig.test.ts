import { describe, expect, it } from 'vitest';
import {
    HOJAS_INFOGRAFIA, dimensionHoja, avisosConfigInfografia, cambiarFormatoInfografia, configInfografiaPorDefecto, contarPaginasInfografia, contenidoEfectivo, validarConfigInfografia,
} from './infografiaGoesConfig';

const AHORA = Date.UTC(2026, 9, 28, 0, 0);

describe('configInfografiaPorDefecto y formato', () => {
    it('el resumen es ligero (plano, vasos, lectura, minigráficas) y no trae estadística ni enlace', () => {
        const c = configInfografiaPorDefecto('24h');
        expect(c).toMatchObject({ formato: 'resumen', mapa: true, vasos: true, lectura: true, minigraficas: true, estadistica: false, enlace: false });
        expect(c.estaciones).toHaveLength(4);
        expect(c.periodo.tipo).toBe('24h');
    });
    it('cambiar a técnico agrega estadística y enlace; estaciones y periodo se conservan', () => {
        const base = { ...configInfografiaPorDefecto('7d'), estaciones: ['C63009B2', 'C6301416'] };
        const t = cambiarFormatoInfografia(base, 'tecnico');
        expect(t).toMatchObject({ formato: 'tecnico', estadistica: true, enlace: true });
        expect(t.estaciones).toEqual(['C63009B2', 'C6301416']);
        expect(t.periodo.tipo).toBe('7d');
        expect(cambiarFormatoInfografia(t, 'tecnico')).toBe(t);
    });
    it('contenidoEfectivo: sin plano no hay vasos; en resumen no hay estadística ni enlace aunque estén marcados', () => {
        const c = { ...configInfografiaPorDefecto('24h'), mapa: false, vasos: true, estadistica: true, enlace: true };
        expect(contenidoEfectivo(c)).toMatchObject({ mapa: false, vasos: false, estadistica: false, enlace: false });
        // Cambiar de formato reinicia el contenido: el plano se apaga después.
        const t = { ...cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico'), mapa: false };
        expect(contenidoEfectivo(t)).toMatchObject({ vasos: false, estadistica: true, enlace: true });
    });
});

describe('validación y avisos', () => {
    it('sin estaciones o con rango invertido es error; el periodo estándar es válido', () => {
        expect(validarConfigInfografia(configInfografiaPorDefecto('24h'), AHORA)).toEqual([]);
        expect(validarConfigInfografia({ ...configInfografiaPorDefecto('24h'), estaciones: [] }, AHORA).length).toBeGreaterThan(0);
        const rango = { ...configInfografiaPorDefecto('24h'), periodo: { tipo: 'rango' as const, desde: '2026-10-20', hasta: '2026-10-10' } };
        expect(validarConfigInfografia(rango, AHORA).length).toBeGreaterThan(0);
        const bien = { ...configInfografiaPorDefecto('24h'), periodo: { tipo: 'rango' as const, desde: '2026-10-20', hasta: '2026-10-25' } };
        expect(validarConfigInfografia(bien, AHORA)).toEqual([]);
    });
    it('avisa: vasos sin plano, periodos sin cambio 24 h/7 d y Babisas bajo umbral', () => {
        const a = avisosConfigInfografia({ ...configInfografiaPorDefecto('30d'), mapa: false, vasos: true }, AHORA).join('\n');
        expect(a).toMatch(/vasos de presa se dibujan sobre el plano/);
        expect(a).toMatch(/solo se calcula con esos periodos/);
        expect(a).toMatch(/Babisas: su gasto 0\.00 es «< 15 m³\/s»/);
        expect(avisosConfigInfografia({ ...configInfografiaPorDefecto('24h'), estaciones: ['C63009B2'] }, AHORA)).toEqual([]);
    });
});

describe('contarPaginasInfografia', () => {
    it('el resumen es una imagen; el técnico, panorama (si hay plano o lectura) más una ficha por estación', () => {
        expect(contarPaginasInfografia(configInfografiaPorDefecto('24h'))).toBe(1);
        const t = cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico');
        expect(contarPaginasInfografia(t)).toBe(5);
        expect(contarPaginasInfografia({ ...t, mapa: false, lectura: false })).toBe(4);
        expect(contarPaginasInfografia({ ...t, estaciones: ['C63009B2'] })).toBe(2);
    });
});

describe('hoja', () => {
    it('medidas a 96 dpi: Carta 816×1056, media Carta 528×816, mitad de página 816×528', () => {
        expect(dimensionHoja('carta-v')).toMatchObject({ ancho: 816, alto: 1056, orientacion: 'vertical', papel: true });
        expect(dimensionHoja('carta-h')).toMatchObject({ ancho: 1056, alto: 816, orientacion: 'horizontal' });
        expect(dimensionHoja('media-v')).toMatchObject({ ancho: 528, alto: 816 });
        expect(dimensionHoja('media-h')).toMatchObject({ ancho: 816, alto: 528 });
        expect(dimensionHoja('pantalla')).toMatchObject({ ancho: 1080, alto: null, papel: false });
        expect(HOJAS_INFOGRAFIA.map((h) => h.id)).toEqual(['pantalla', 'carta-v', 'carta-h', 'media-v', 'media-h', 'mitad-2']);
    });
    it('el resumen siempre es pantalla; cambiar de formato conserva o reinicia la hoja según corresponda', () => {
        const t = { ...cambiarFormatoInfografia(configInfografiaPorDefecto('7d'), 'tecnico'), hoja: 'carta-h' as const };
        expect(contenidoEfectivo(t).hoja).toBe('carta-h');
        expect(contenidoEfectivo({ ...t, formato: 'resumen' }).hoja).toBe('pantalla');
        expect(cambiarFormatoInfografia(t, 'resumen').hoja).toBe('pantalla');
        expect(configInfografiaPorDefecto('24h').hoja).toBe('pantalla');
    });
    it('«dos por hoja» agrupa las fichas de a dos; la media hoja avisa que es compacta', () => {
        const t = { ...cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico'), mapa: false, lectura: false };
        expect(contarPaginasInfografia({ ...t, hoja: 'mitad-2' })).toBe(2);
        expect(contarPaginasInfografia({ ...t, hoja: 'mitad-2', estaciones: ['C63009B2', 'C6301AC4', 'C6301416'] })).toBe(2);
        expect(contarPaginasInfografia({ ...t, hoja: 'carta-v' })).toBe(4);
        // Con plano y lectura activos, el papel sigue siendo solo fichas; la pantalla suma el panorama.
        const conPlano = { ...cambiarFormatoInfografia(configInfografiaPorDefecto('24h'), 'tecnico') };
        expect(contarPaginasInfografia({ ...conPlano, hoja: 'carta-v' })).toBe(4);
        expect(contarPaginasInfografia({ ...conPlano, hoja: 'pantalla' })).toBe(5);
        expect(avisosConfigInfografia({ ...t, hoja: 'media-h' }, AHORA).join(' ')).toMatch(/media hoja es compacta/);
        expect(avisosConfigInfografia({ ...t, hoja: 'carta-v' }, AHORA).join(' ')).not.toMatch(/media hoja es compacta/);
    });
});
