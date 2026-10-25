import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { solicitarRasterModulo, solicitarRastersDelPeriodo, geometriaRasterEnPlano, type ClienteRaster } from './informeNdviRaster';

// El cliente real debe ser asignable al subconjunto que usa el módulo.
const _compat = (c: SupabaseClient): ClienteRaster => c as unknown as ClienteRaster;
void _compat;

const OK = { mes: '2026-08', numero_modulo: 1, bbox: [-105.6, 27.76, -105.18, 28.03], ancho: 800, alto: 600, resolucion_m: 20, png_base64: 'QUJD', n_escenas: 6, pct_pixeles_validos: 0.93, nota: 'nota' };
const respuestaHttp = (status: number, cuerpo: unknown) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => cuerpo } } });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cliente(invoke: ClienteRaster['functions']['invoke'], sesion: unknown = { user: 'x' }): ClienteRaster {
    return { auth: { getSession: async () => ({ data: { session: sesion } }) }, functions: { invoke } };
}
const rapido = { reintentos: 0, esperaMs: 1 };

describe('solicitarRasterModulo', () => {
    it('éxito: dataUri, bbox, escenas y % válidos tipados', async () => {
        let llamado: any;
        const r = await solicitarRasterModulo(cliente(async (n, o) => { llamado = { n, o }; return { data: OK, error: null }; }), '2026-08', 1, rapido);
        expect(r).toMatchObject({ ok: true, dataUri: 'data:image/png;base64,QUJD', ancho: 800, alto: 600, nEscenas: 6, pctValidos: 0.93, resolucionM: 20, mes: '2026-08', modulo: 1 });
        expect(llamado.n).toBe('sentinel-ndvi-modulo-raster');
        expect(llamado.o.body).toEqual({ mes: '2026-08', numero_modulo: 1 });
    });

    it('n_escenas / pct nulos quedan en null (S/D), nunca 0', async () => {
        const r = await solicitarRasterModulo(cliente(async () => ({ data: { ...OK, n_escenas: null, pct_pixeles_validos: null }, error: null })), '2026-08', 1, rapido);
        expect(r).toMatchObject({ ok: true, nEscenas: null, pctValidos: null });
    });

    it('sin sesión: no llama a la función', async () => {
        let n = 0;
        const r = await solicitarRasterModulo(cliente(async () => { n++; return { data: OK, error: null }; }, null), '2026-08', 1, rapido);
        expect(r).toMatchObject({ ok: false, motivo: 'sin-sesion' });
        expect(n).toBe(0);
    });

    it('HTTP 401 → sin-sesion y no se reintenta', async () => {
        let n = 0;
        const r = await solicitarRasterModulo(cliente(async () => { n++; return respuestaHttp(401, { error: 'No autorizado' }); }), '2026-08', 1, { reintentos: 3, esperaMs: 1 });
        expect(r).toMatchObject({ ok: false, motivo: 'sin-sesion', detalle: 'No autorizado' });
        expect(n).toBe(1);
    });

    it('mes inválido: localmente y por HTTP 400', async () => {
        let n = 0;
        const c = cliente(async () => { n++; return respuestaHttp(400, { error: 'mes inválido: usa AAAA-MM' }); });
        expect(await solicitarRasterModulo(c, '2026-13', 1, rapido)).toMatchObject({ ok: false, motivo: 'mes-invalido' });
        expect(n).toBe(0);
        expect(await solicitarRasterModulo(c, '2026-10', 1, rapido)).toMatchObject({ ok: false, motivo: 'mes-invalido' });
        expect(n).toBe(1);
    });

    it('CDSE caído: 502 y 500 con codigo cdse → cdse-caido; reintenta y luego se rinde', async () => {
        let n = 0;
        const r = await solicitarRasterModulo(cliente(async () => { n++; return respuestaHttp(502, { error: 'Process API HTTP 500', codigo: 'cdse' }); }), '2026-08', 2, { reintentos: 1, esperaMs: 1 });
        expect(r).toMatchObject({ ok: false, motivo: 'cdse-caido', modulo: 2 });
        expect(n).toBe(2);
        expect(await solicitarRasterModulo(cliente(async () => respuestaHttp(500, { error: 'OAuth', codigo: 'cdse' })), '2026-08', 2, rapido)).toMatchObject({ motivo: 'cdse-caido' });
        expect(await solicitarRasterModulo(cliente(async () => respuestaHttp(500, { error: 'boom' })), '2026-08', 2, rapido)).toMatchObject({ motivo: 'error', detalle: 'boom' });
    });

    it('un fallo transitorio seguido de éxito se recupera con el reintento', async () => {
        let n = 0;
        const r = await solicitarRasterModulo(cliente(async () => (++n === 1 ? respuestaHttp(502, { error: 'x', codigo: 'cdse' }) : { data: OK, error: null })), '2026-08', 1, { reintentos: 1, esperaMs: 1 });
        expect(r.ok).toBe(true);
        expect(n).toBe(2);
    });

    it('timeout → motivo timeout', async () => {
        const r = await solicitarRasterModulo(cliente(() => new Promise(() => { /* nunca responde */ })), '2026-08', 1, { timeoutMs: 20, reintentos: 0 });
        expect(r).toMatchObject({ ok: false, motivo: 'timeout' });
    });

    it('sin_datos del mes → sin-datos (no se reintenta)', async () => {
        let n = 0;
        const r = await solicitarRasterModulo(cliente(async () => { n++; return { data: { ...OK, png_base64: null, sin_datos: true }, error: null }; }), '2026-08', 1, { reintentos: 2, esperaMs: 1 });
        expect(r).toMatchObject({ ok: false, motivo: 'sin-datos' });
        expect(n).toBe(1);
    });

    it('respuesta incompleta o con excepciones → error tipado, nunca lanza', async () => {
        expect(await solicitarRasterModulo(cliente(async () => ({ data: { ...OK, bbox: null }, error: null })), '2026-08', 1, rapido)).toMatchObject({ ok: false, motivo: 'error' });
        expect(await solicitarRasterModulo(cliente(async () => { throw new Error('red caída'); }), '2026-08', 1, rapido)).toMatchObject({ ok: false, motivo: 'error', detalle: 'red caída' });
        const roto: ClienteRaster = { auth: { getSession: async () => { throw new Error('x'); } }, functions: { invoke: async () => ({ data: OK, error: null }) } };
        expect(await solicitarRasterModulo(roto, '2026-08', 1, rapido)).toMatchObject({ ok: false, motivo: 'sin-sesion' });
    });
});

describe('solicitarRastersDelPeriodo', () => {
    it('respeta la concurrencia máxima y devuelve todos los módulos', async () => {
        let activas = 0, pico = 0;
        const c = cliente(async (_n, o: any) => {
            activas++; pico = Math.max(pico, activas);
            await espera(8);
            activas--;
            return { data: { ...OK, numero_modulo: o.body.numero_modulo }, error: null };
        });
        const progreso: number[] = [];
        const r = await solicitarRastersDelPeriodo(c, '2026-08', [1, 2, 3, 4, 5, 12], { ...rapido, concurrencia: 3, onProgreso: (h) => progreso.push(h) });
        expect(Object.keys(r).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 12]);
        expect(Object.values(r).every((x) => x.ok)).toBe(true);
        expect(pico).toBeLessThanOrEqual(3);
        expect(pico).toBeGreaterThan(1);
        expect(progreso).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('concurrencia absurda se topa en 6; 0 o negativa equivale a 1', async () => {
        let activas = 0, pico = 0;
        const mk = () => cliente(async () => { activas++; pico = Math.max(pico, activas); await espera(5); activas--; return { data: OK, error: null }; });
        await solicitarRastersDelPeriodo(mk(), '2026-08', Array.from({ length: 12 }, (_, i) => i + 1), { ...rapido, concurrencia: 99 });
        expect(pico).toBeLessThanOrEqual(6);
        pico = 0;
        await solicitarRastersDelPeriodo(mk(), '2026-08', [1, 2, 3], { ...rapido, concurrencia: 0 });
        expect(pico).toBe(1);
    });

    it('nunca rechaza: fallos mezclados, onProgreso que lanza, lista vacía y duplicados', async () => {
        const c = cliente(async (_n, o: any) => {
            const m = o.body.numero_modulo;
            if (m === 2) throw new Error('boom');
            if (m === 3) return respuestaHttp(502, { error: 'x', codigo: 'cdse' });
            return { data: OK, error: null };
        });
        const r = await solicitarRastersDelPeriodo(c, '2026-08', [1, 2, 3, 3], { ...rapido, onProgreso: () => { throw new Error('ui'); } });
        expect(r[1].ok).toBe(true);
        expect(r[2]).toMatchObject({ ok: false, motivo: 'error' });
        expect(r[3]).toMatchObject({ ok: false, motivo: 'cdse-caido' });
        expect(await solicitarRastersDelPeriodo(c, '2026-08', [], rapido)).toEqual({});
        const sinSesion = await solicitarRastersDelPeriodo(cliente(async () => ({ data: OK, error: null }), null), '2026-08', [1, 2], rapido);
        expect(Object.values(sinSesion).every((x) => !x.ok && x.motivo === 'sin-sesion')).toBe(true);
    });
});

describe('geometriaRasterEnPlano', () => {
    it('proyecta las esquinas del bbox con la proyección equirrectangular del plano', () => {
        const minLon = -105.7, maxLat = 28.1, cosLat = Math.cos(27.9 * Math.PI / 180), escala = 4000, offX = 10, offY = 20;
        const proy = { px: (lon: number) => offX + (lon - minLon) * cosLat * escala, py: (lat: number) => offY + (maxLat - lat) * escala };
        const g = geometriaRasterEnPlano([-105.6, 27.76, -105.18, 28.03], proy);
        expect(g.x).toBeCloseTo(proy.px(-105.6), 6);
        expect(g.y).toBeCloseTo(proy.py(28.03), 6);
        expect(g.ancho).toBeCloseTo(0.42 * cosLat * escala, 6);
        expect(g.alto).toBeCloseTo(0.27 * escala, 6);
        expect(g.ancho).toBeGreaterThan(0);
        expect(g.alto).toBeGreaterThan(0);
    });
});
