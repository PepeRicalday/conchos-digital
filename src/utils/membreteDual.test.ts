import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALTO_MEMBRETE_MIN_PX, ALTO_MEMBRETE_PX, CSS_MEMBRETE, altoMembretePorAncho, membreteDual } from './membreteDual';
import { cabeceraInforme } from './informeBase';

const SRL = 'data:image/svg+xml;base64,U1JM';
const SICA = 'data:image/svg+xml;base64,U0lDQQ==';
const base = { logoSrl: SRL, logoSica: SICA, titulo: 'Informe de prueba', meta: [{ k: 'Folio', v: 'X-1' }] };

describe('membrete con los dos logos al mismo peso', () => {
    it('SRL va a la izquierda y SICA a la derecha, cada uno con su rótulo de texto', () => {
        const h = membreteDual(base);
        expect(h.indexOf('mb-srl')).toBeGreaterThan(-1);
        expect(h.indexOf('mb-srl')).toBeLessThan(h.indexOf('mb-sica'));
        expect(h).toContain('<b>SRL Unidad Conchos</b>');
        expect(h).toContain('<b>SICA 005</b>');
        expect(h).toContain('Delicias, Chihuahua');
        expect(h).toContain('Sistema Integral de Control del Agua');
    });
    it('los dos logos salen de la misma caja de altura (--mb-alto) y SICA se dibuja un poco menor', () => {
        const h = membreteDual({ ...base, alto: 72 });
        expect(h).toContain('--mb-alto:72px');
        expect(CSS_MEMBRETE).toMatch(/\.mb-marca img\{[^}]*height:1em/);
        expect(CSS_MEMBRETE).toMatch(/\.mb-sica img\{height:\.92em\}/);
    });
    it('sin logos cargados el nombre sigue en texto: nunca queda un hueco', () => {
        const h = membreteDual({ ...base, logoSrl: '', logoSica: '' });
        expect(h).not.toContain('<img');
        expect(h).toContain('SRL Unidad Conchos');
        expect(h).toContain('SICA 005');
    });
    it('el alto nunca baja de 12 mm (45 px)', () => {
        expect(membreteDual({ ...base, alto: 20 })).toContain(`--mb-alto:${ALTO_MEMBRETE_MIN_PX}px`);
        expect(membreteDual(base)).toContain(`--mb-alto:${ALTO_MEMBRETE_PX}px`);
    });
    it('fondo oscuro usa la variante clara de colores', () => {
        expect(membreteDual({ ...base, fondo: 'oscuro' })).toContain('class="mb mb-oscuro"');
        expect(CSS_MEMBRETE).toMatch(/\.mb\.mb-oscuro\{[^}]*--mb-tinta:#fff/);
    });
    it('sin título ni metadatos no dibuja la fila (las infografías traen su propio h1)', () => {
        expect(membreteDual({ ...base, titulo: '', meta: [] })).not.toContain('mb-doc');
    });
    it('escapa el texto dinámico', () => {
        const h = membreteDual({ ...base, titulo: '<script>x</script>', meta: [{ k: '<k>', v: '"v"' }] });
        expect(h).not.toContain('<script>');
        expect(h).not.toContain('<k>');
    });
    it('la caja de las infografías crece con su ancho: 90, 120 y 140 px', () => {
        expect(altoMembretePorAncho(1080)).toBe(90);
        expect(altoMembretePorAncho(1440)).toBe(120);
        expect(altoMembretePorAncho(2000)).toBe(140);
    });
    it('cabeceraInforme (NDVI, Vaso, GOES, General, Conservación) usa este mismo membrete', () => {
        const h = cabeceraInforme({ logoSrl: SRL, logoSica: SICA, titulo: 'T', meta: [] });
        expect(h).toContain('mb-srl');
        expect(h).toContain('mb-sica');
    });
});

describe('escudo SRL vectorial (scripts/logo/generar-logo-srl.mjs)', () => {
    const dir = resolve(__dirname, '../../public/logos/srl');
    const lee = (n: string) => readFileSync(resolve(dir, n), 'utf8');
    it('pesa poco, no usa <text> ni caja blanca y trae su título accesible', () => {
        for (const n of ['logo-srl.svg', 'logo-srl-claro.svg', 'logo-srl-negro.svg']) {
            expect(statSync(resolve(dir, n)).size).toBeLessThan(14 * 1024);
            const s = lee(n);
            expect(s).not.toMatch(/<text|<rect|<image/);
            expect(s).toContain('<title>SRL Unidad Conchos, Delicias</title>');
        }
    });
    it('marrón institucional en claro, crema en la versión para fondos oscuros', () => {
        expect(lee('logo-srl.svg')).toContain('fill="#6B2D2D"');
        expect(lee('logo-srl-claro.svg')).toContain('fill="#F7F3EA"');
    });
});
