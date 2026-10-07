import { describe, expect, it } from 'vitest';
import { construirDatosVaso, filtrarEscenas, mesesSinEscena, validarConfigVaso, configVasoPorDefecto, type EntradaInformeVaso, type EscenaVaso } from './informeVasoDatos';
import { construirHtmlVaso } from './informeVasoHtml';
import { construirInteranual } from './informeVasoInteranual';
import type { MapaPresa, PuntoDia } from './historicoPresas';

const anillo: [number, number][] = [[-105.4, 27.5], [-105.3, 27.5], [-105.3, 27.6], [-105.4, 27.6], [-105.4, 27.5]];
const esc = (f: string, area: number, extra: Partial<EscenaVaso> = {}): EscenaVaso => ({
    fecha_escena: f, area_km2: area, perimetro_km: 100, num_islas: 2, nubosidad_pct: 2, ratio_elongacion: 1.5, delta_area_km2: null, pct_del_maximo_ciclo: 80,
    contorno_geojson: { type: 'Polygon', coordinates: [anillo] }, ...extra,
});
const escenas = [esc('2026-06-10T17:00:00Z', 50), esc('2026-07-10T17:00:00Z', 48), esc('2026-09-10T17:00:00Z', 44), esc('2026-10-01T17:46:00Z', 44.3, { nubosidad_pct: 15.9 })];
const base = (o: Partial<EntradaInformeVaso> = {}): EntradaInformeVaso => ({
    nombrePresa: 'La "Boquilla" <b>', escenas, validacion: [], textura: null, imagenRelieve: null, logoSrlOk: true, ahora: new Date('2026-10-07T18:00:00Z'), emisor: null, version: '2.25.0',
    estado: { nivel: 1297.12, pct: 24.9, volumen: 709.6, capacidad: 2846.8, namo: 1317, deficit: 19.88, fechaLectura: '2026-10-07', procedencia: 'CILA' }, ...o,
});

describe('informe del vaso — datos', () => {
    it('filtra por periodo inclusivo y ordena', () => {
        expect(filtrarEscenas([...escenas].reverse(), { desde: '2026-07-10', hasta: '2026-09-10' }).map((e) => e.fecha_escena.slice(0, 10))).toEqual(['2026-07-10', '2026-09-10']);
    });
    it('huecos reales por mes calendario (no estimados por 30 días)', () => {
        expect(mesesSinEscena(escenas)).toEqual(['2026-08']);
        expect(mesesSinEscena([escenas[0]])).toEqual([]);
    });
    it('valida periodo vacío, invertido y sin secciones', () => {
        const c = configVasoPorDefecto();
        expect(validarConfigVaso({ ...c, desde: '2027-01-01' }, escenas)).toContain('No hay escenas satelitales en el periodo elegido.');
        expect(validarConfigVaso({ ...c, desde: '2026-09-01', hasta: '2026-08-01' }, escenas)[0]).toMatch(/posterior/);
        expect(validarConfigVaso({ ...c, secciones: [] }, escenas)).toContain('Elige al menos una sección.');
    });
    it('avisos de calidad: nubes, hueco, escena vieja', () => {
        const d = construirDatosVaso(base(), configVasoPorDefecto());
        const t = d.avisos.map((a) => a.texto).join('|');
        expect(t).toMatch(/15\.9 % de nubes/);
        expect(t).toMatch(/ago 2026/);
        const viejo = construirDatosVaso(base({ ahora: new Date('2026-12-01T00:00:00Z') }), configVasoPorDefecto());
        expect(viejo.avisos.some((a) => /días/.test(a.texto))).toBe(true);
    });
    it('sin lectura oficial: aviso y S/D, nunca 0', () => {
        const d = construirDatosVaso(base({ estado: { nivel: null, pct: null, volumen: null, capacidad: null, namo: 1317, deficit: null, fechaLectura: null, procedencia: null } }), configVasoPorDefecto());
        expect(d.avisos.some((a) => /S\/D/.test(a.texto))).toBe(true);
        const html = construirHtmlVaso(d, { srl: '', sica: '' });
        expect(html).toContain('S/D');
        expect(html).not.toMatch(/NaN|undefined|null/);
    });
    it('una sola escena: sin tendencia y hallazgo explícito', () => {
        const d = construirDatosVaso(base(), { ...configVasoPorDefecto(), desde: '2026-10-01' });
        expect(d.deltaArea).toBeNull();
        expect(d.hallazgos[0]).toMatch(/insuficiente/);
    });
});

describe('informe del vaso — HTML', () => {
    it('escapa el nombre, trae folio, páginas y deltas con flecha', () => {
        const html = construirHtmlVaso(construirDatosVaso(base(), configVasoPorDefecto()), { srl: 'data:image/png;base64,AA', sica: '' });
        expect(html).not.toContain('<b>"');
        expect(html).toContain('&lt;b&gt;');
        expect(html).toMatch(/VASO-20261007-\d{4}/);
        expect(html).toMatch(/Pág\. 1 de 6/);
        expect(html).toMatch(/[▲▼■]/);
        expect(html).not.toMatch(/NaN|undefined/);
    });
    it('solo las secciones elegidas generan hojas', () => {
        const html = construirHtmlVaso(construirDatosVaso(base(), { ...configVasoPorDefecto(), secciones: ['resumen'] }), { srl: '', sica: '' });
        expect((html.match(/class="pagina"/g) ?? []).length).toBe(1);
        expect(html).not.toContain('Evolución del polígono');
    });
});

const punto = (fecha: string, alm: number | null): PuntoDia => ({ fecha, escala: alm == null ? null : 1280 + alm / 100, alm, pct: alm == null ? null : alm / 28.46, almRep: alm, pctRep: null, fuente: 'HISTORICO', calidad: 'OK' });
const mapaHist = (): MapaPresa => new Map<string, PuntoDia>([
    ['2023-10-07', punto('2023-10-07', 900)], ['2024-10-09', punto('2024-10-09', 400)], ['2025-10-07', punto('2025-10-07', null)], ['2026-10-07', punto('2026-10-07', 709.6)],
]);

describe('informe del vaso — interanual', () => {
    it('mismo día con desfase, S/D si falta y posición entre años', () => {
        const it = construirInteranual(mapaHist(), '2026-10-07', 709.6)!;
        expect(it.filas.map((f) => [f.anio, f.desfaseDias])).toEqual([[2024, 2], [2023, 0]]);
        expect(it.filas.find((f) => f.anio === 2023)!.difVolumen).toBeCloseTo(-190.4);
        expect(it.posicion).toEqual({ posicion: 2, de: 3 });
        expect(construirInteranual(undefined, '2026-10-07', 709.6)).toBeNull();
        expect(construirInteranual(mapaHist(), null, 1)).toBeNull();
    });
    it('sin volumen vigente no hay posición ni diferencias', () => {
        const it = construirInteranual(mapaHist(), '2026-10-07', null)!;
        expect(it.posicion).toBeNull();
        expect(it.filas.every((f) => f.difVolumen === null)).toBe(true);
    });
    it('el HTML trae la tabla y el aviso cuando no hay histórico', () => {
        const con = construirHtmlVaso(construirDatosVaso(base({ historico: mapaHist() }), configVasoPorDefecto()), { srl: '', sica: '' });
        expect(con).toMatch(/Comparativo interanual · mismo día \(07\/10\)/);
        expect(con).toMatch(/lugar 2 de 3/);
        expect(con).not.toMatch(/NaN|undefined/);
        const sin = construirDatosVaso(base(), configVasoPorDefecto());
        expect(sin.avisos.some((a) => /interanual/.test(a.texto))).toBe(true);
    });
});
