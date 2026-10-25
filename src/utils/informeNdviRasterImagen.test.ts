// Imagen NDVI por módulo en el informe: reducción, PNG indexado, tarjetas y obtención con respuestas simuladas (éxito, 401, timeout, CDSE caído, parcial).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { construirDatosNdvi, type ContextoInforme, type FilaNdviInforme, type InformeNdvi } from './informeNdviDatos';
import { configPorDefecto, mesesDisponibles } from './informeNdviConfig';
import { contornosAAnillos } from './informeNdviSvg';
import { MODULOS_SRL_IDS } from './modulosSRL';
import { CLASES_NDVI } from './ndviRampa';
import type { ClienteRaster, RasterOk } from './informeNdviRaster';
import {
    LADOS_PROBADOS, PRESUPUESTO_IMAGEN_BYTES, bytesADataUriPng, imagenesHtml, indiceDePixel, miniMapaModuloSvg, obtenerImagenesNdvi, pngIndexado, reducirAPresupuesto, reducirVecino, tarjetaImagenModulo,
} from './informeNdviRasterImagen';

const GEO = JSON.parse(fs.readFileSync(new URL('../../public/geo/modulos.geojson', import.meta.url), 'utf-8')) as GeoJSON.FeatureCollection;
const CONTORNOS = contornosAAnillos(GEO);

function datos(): InformeNdvi {
    const filas: FilaNdviInforme[] = MODULOS_SRL_IDS.flatMap((m, i) => ['2026-08', '2026-09'].map((mes) => ({
        numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes, ndvi_medio: 0.2 + 0.05 * i, ndvi_desv: 0.08, kc_estimado: 0.3, delta_ndvi: null, superficie_ha: 5000,
        fraccion_cobertura_activa: 0.5, ventana_desde: `${mes}-01`, ventana_hasta: `${mes}-28`, nubosidad_max_pct: 40, n_escenas: 5, pct_pixeles_validos: 0.9,
    })));
    const ctx: ContextoInforme = { volumenPorModulo: new Map(), volumenMesParcial: false, contornosDisponibles: true, logoSrlOk: true, ahora: new Date(2026, 9, 7), emisor: 'P', version: '2.23.0' };
    return construirDatosNdvi(filas, ctx, { ...configPorDefecto(mesesDisponibles(filas)), imagenSatelital: true });
}

/** PNG sintético de 1x1 (válido) como respuesta de la función. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const respuestaOk = (modulo: number) => ({ data: { mes: '2026-09', numero_modulo: modulo, bbox: [-105.6, 27.76, -105.18, 28.3], ancho: 400, alto: 500, resolucion_m: 33, png_base64: PNG_1X1, n_escenas: 6, pct_pixeles_validos: 0.91, nota: 'n' }, error: null });
const http = (status: number, cuerpo: unknown) => ({ data: null, error: { message: 'non-2xx', context: { status, json: async () => cuerpo } } });
const cliente = (invoke: ClienteRaster['functions']['invoke'], sesion: unknown = { u: 1 }): ClienteRaster => ({ auth: { getSession: async () => ({ data: { session: sesion } }) }, functions: { invoke } });
const sinReducir = async (r: RasterOk) => r;
const rapido = { reducir: sinReducir, timeoutPorModuloMs: 200 };

describe('reducción y PNG indexado', () => {
    const rgbaDeClases = (w: number, h: number, f: (x: number, y: number) => number): { rgba: Uint8Array; ancho: number; alto: number } => {
        const rgba = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const k = f(x, y), o = (y * w + x) * 4;
            if (k < 0) continue; // transparente
            const c = CLASES_NDVI[k].color;
            rgba[o] = parseInt(c.slice(1, 3), 16); rgba[o + 1] = parseInt(c.slice(3, 5), 16); rgba[o + 2] = parseInt(c.slice(5, 7), 16); rgba[o + 3] = 255;
        }
        return { rgba, ancho: w, alto: h };
    };
    it('reducirVecino deja el lado mayor en el máximo, sin mezclar colores (solo clases originales)', () => {
        const img = rgbaDeClases(800, 400, (x) => Math.floor(x / 160));
        const r = reducirVecino(img, 200);
        expect([r.ancho, r.alto]).toEqual([200, 100]);
        const colores = new Set<string>();
        for (let i = 0; i < r.ancho * r.alto; i++) colores.add([...r.rgba.subarray(i * 4, i * 4 + 4)].join(','));
        expect(colores.size).toBe(5);
        expect(reducirVecino(img, 1000)).toBe(img); // ya cabe: no se toca
    });
    it('indiceDePixel: 0 = transparente (S/D), 1..5 = clase por color más cercano', () => {
        expect(indiceDePixel(0, 0, 0, 0)).toBe(0);
        CLASES_NDVI.forEach((c, i) => expect(indiceDePixel(parseInt(c.color.slice(1, 3), 16), parseInt(c.color.slice(3, 5), 16), parseInt(c.color.slice(5, 7), 16), 255)).toBe(i + 1));
    });
    it('pngIndexado produce un PNG válido de 4 bits con paleta de clases y tRNS; los índices se recuperan al descomprimir', async () => {
        const img = rgbaDeClases(7, 3, (x, y) => (x === 3 && y === 1 ? -1 : (x + y) % 5));
        const b = await pngIndexado(img);
        expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        const v = new DataView(b.buffer, b.byteOffset);
        expect([v.getUint32(16), v.getUint32(20), b[24], b[25]]).toEqual([7, 3, 4, 3]); // ancho, alto, 4 bits, indexado
        const texto = Buffer.from(b).toString('latin1');
        expect(texto).toContain('PLTE'); expect(texto).toContain('tRNS'); expect(texto).toContain('IEND');
        const iIdat = texto.indexOf('IDAT'), largo = v.getUint32(iIdat - 4);
        const crudo = inflateSync(Buffer.from(b.subarray(iIdat + 4, iIdat + 4 + largo)));
        const fila = Math.ceil(7 / 2);
        expect(crudo.length).toBe((fila + 1) * 3);
        const idx = (x: number, y: number) => { const byte = crudo[y * (fila + 1) + 1 + (x >> 1)]; return x & 1 ? byte & 15 : byte >> 4; };
        expect(idx(3, 1)).toBe(0);
        expect(idx(2, 0)).toBe(1 + 2);
        expect(bytesADataUriPng(b)).toMatch(/^data:image\/png;base64,/);
    });
    it('reducirAPresupuesto baja la resolución de una imagen ruidosa hasta entrar en el presupuesto (o devuelve el último intento)', async () => {
        let s = 7;
        const ruido = rgbaDeClases(900, 900, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >> 8) % 5; });
        const holgado = await reducirAPresupuesto(ruido, 10 * 1024 * 1024);
        expect(Math.max(holgado.imagen.ancho, holgado.imagen.alto)).toBe(LADOS_PROBADOS[0]);
        const r = await reducirAPresupuesto(ruido, PRESUPUESTO_IMAGEN_BYTES);
        expect(Math.max(r.imagen.ancho, r.imagen.alto)).toBeLessThan(LADOS_PROBADOS[0]);
        const liso = rgbaDeClases(900, 900, (x) => (x < 450 ? 2 : 3));
        expect((await reducirAPresupuesto(liso)).bytes.length).toBeLessThan(PRESUPUESTO_IMAGEN_BYTES);
    });

    it('PESO con rasters RUIDOSOS realistas (461×886 a 20 m, moteado entre clases, ~20 % transparente): seis módulos ≤ 100 KiB en base64 y cada uno dentro del presupuesto', async () => {
        const rng = (semilla: number) => { let s = semilla >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
        const ruidoso = (w: number, h: number, semilla: number, sal: number) => {
            const r = rng(semilla), c = [3, 7, 19], gw = (k: number) => Math.ceil(w / k) + 2;
            const capas = c.map((k) => Array.from({ length: gw(k) * (Math.ceil(h / k) + 2) }, () => r())), pesos = [0.25, 0.35, 0.4];
            return rgbaDeClases(w, h, (x, y) => {
                const parche = ((Math.imul((Math.floor(x / 11) * 73856093) ^ (Math.floor(y / 11) * 19349663), 2654435761) >>> 0) / 4294967296) < 0.16;
                if (parche || r() < 0.04) return -1; // ≈ 20 % sin dato
                const t = c.reduce((a, k, i) => a + capas[i][Math.floor(y / k) * gw(k) + Math.floor(x / k)] * pesos[i], 0);
                return r() < sal ? Math.floor(r() * 5) : Math.min(4, Math.floor(t * 5));
            });
        };
        for (const sal of [0.1, 0.4]) { // moteado moderado y extremo
            let total = 0;
            for (let m = 0; m < 6; m++) {
                const { imagen, bytes } = await reducirAPresupuesto(ruidoso(461, 886, 100 + m, sal));
                expect(bytes.length, `M${m} sal ${sal}`).toBeLessThanOrEqual(PRESUPUESTO_IMAGEN_BYTES);
                expect(Math.max(imagen.ancho, imagen.alto)).toBeGreaterThanOrEqual(LADOS_PROBADOS[LADOS_PROBADOS.length - 1]); // sigue legible
                total += bytes.length;
            }
            expect(Math.ceil((total * 4) / 3) / 1024, `total 6 módulos, sal ${sal}`).toBeLessThanOrEqual(100);
        }
    }, 60_000);
});

describe('tarjetas e imagen HTML', () => {
    const d = datos();
    const ok: RasterOk = { ok: true, dataUri: `data:image/png;base64,${PNG_1X1}`, bbox: [-105.6, 27.76, -105.18, 28.3], ancho: 400, alto: 500, nEscenas: 6, pctValidos: 0.91, resolucionM: 33, mes: '2026-09', modulo: 1, nota: '' };
    it('con imagen: raster recortado al polígono por clipPath, contorno, escala y pie con pasos y % válido', () => {
        const m = d.modulos[0];
        const svg = miniMapaModuloSvg(m, CONTORNOS[m.numero], ok);
        expect(svg).toContain('<image href="data:image/png;base64,');
        expect(svg).toContain('clip-path="url(#mm1c)"');
        expect(svg).toContain('<clipPath id="mm1c">');
        expect(svg).toMatch(/\d+ km/);
        expect(svg).toContain('>N</text>');
        const tarjeta = tarjetaImagenModulo(m, CONTORNOS[m.numero], ok);
        expect(tarjeta).toContain('6 pasos de satélite');
        expect(tarjeta).toContain('91 % de píxeles válidos');
    });
    it('sin imagen: plano vectorial en el color de su clase y aviso con el motivo (nunca un hueco)', () => {
        const m = d.modulos[2];
        const t = tarjetaImagenModulo(m, CONTORNOS[m.numero], { ok: false, motivo: 'cdse-caido', detalle: 'x', mes: '2026-09', modulo: 3 });
        expect(t).toContain('Sin imagen satelital:'); // estado breve; el motivo va una sola vez en el aviso agregado
        expect(t).not.toContain('Sentinel (Copernicus) no respondió');
        expect(t).not.toContain('<image');
        expect(t).toContain(CLASES_NDVI[2].color); // 0.30 → vigor medio (el corte pertenece a la clase superior)
        expect(tarjetaImagenModulo(m, CONTORNOS[m.numero], undefined)).toContain('Sin imagen satelital');
        expect(tarjetaImagenModulo(m, undefined, undefined)).toContain('no hay contorno');
    });
    it('NDVI S/D: el plano de la tarjeta va hachurado y el valor dice S/D, nunca 0', () => {
        const m = { ...d.modulos[0], ndvi: null };
        const t = tarjetaImagenModulo(m, CONTORNOS[m.numero], { ok: false, motivo: 'sin-datos', detalle: '', mes: '2026-09', modulo: 1 });
        expect(t).toContain('S/D');
        expect(t).toContain('fill="url(#mm1h)"');
        expect(t).not.toContain('>0.00<');
    });
    it('imagenesHtml: leyenda de clases, una tarjeta por módulo y el recuento de módulos sin imagen', () => {
        const res = { 1: ok, 2: { ...ok, modulo: 2 }, 3: { ok: false as const, motivo: 'sin-sesion' as const, detalle: '', mes: '2026-09', modulo: 3 } };
        const h = imagenesHtml(d.modulos, CONTORNOS, res, '2026-09');
        expect(h.match(/class="im"/g)).toHaveLength(6);
        expect(h).toContain('Vigor muy alto');
        expect(h).toContain('4 de 6 sin imagen');
        expect(h).toContain('no de parcela');
        expect(h).toContain('Imagen satelital no disponible para 1 de 6 módulos:'); // M3 sin sesión
        expect(h).toContain('Imagen satelital no disponible para 3 de 6 módulos:'); // M4, M5 y M12 sin resultado: otra causa, otro aviso
        expect(h).toContain('(M3)');
        expect(h).toContain('(M4, M5, M12)');
    });
});

describe('obtenerImagenesNdvi con respuestas simuladas', () => {
    const d = datos();
    it('éxito: seis imágenes, progreso 0→6 y concurrencia máxima de 3', async () => {
        let activas = 0, maximo = 0;
        const progreso: number[] = [];
        const h = await obtenerImagenesNdvi(d, CONTORNOS, {
            cliente: cliente(async (_n, o) => { activas++; maximo = Math.max(maximo, activas); await new Promise((r) => setTimeout(r, 15)); activas--; return respuestaOk((o.body as { numero_modulo: number }).numero_modulo); }),
            onProgreso: (hechos, total) => progreso.push(hechos * 100 + total), ...rapido,
        });
        expect(h.match(/<image /g)).toHaveLength(6);
        expect(h).not.toContain('Imagen no disponible');
        expect(h).not.toContain('Imagen satelital no disponible'); // éxito total: ningún aviso
        expect(h).not.toContain('Sin imagen satelital');
        expect(maximo).toBeLessThanOrEqual(3);
        expect(progreso[0]).toBe(6);
        expect(progreso[progreso.length - 1]).toBe(606);
    });
    it('401 / sin sesión: ninguna imagen, aviso por módulo y el informe no se cae', async () => {
        const h = await obtenerImagenesNdvi(d, CONTORNOS, { cliente: cliente(async () => http(401, { error: 'No autorizado' })), ...rapido });
        expect(h).not.toContain('<image ');
        expect(h.match(/Imagen satelital no disponible para 6 de 6 módulos:/g)).toHaveLength(1); // UN aviso, no seis
        expect(h.match(/Sin imagen satelital:/g)).toHaveLength(6);
        expect(h.match(/no hay sesión con permiso/g)).toHaveLength(1);
        expect(h).toContain('(M1, M2, M3, M4, M5, M12)');
        expect(h.match(/class="im"/g)).toHaveLength(6); // el plano vectorial por módulo se conserva
        const h2 = await obtenerImagenesNdvi(d, CONTORNOS, { cliente: cliente(async () => respuestaOk(1), null), ...rapido });
        expect(h2.match(/Imagen satelital no disponible para 6 de 6 módulos:/g)).toHaveLength(1);
    });
    it('CDSE caído (502): UN aviso "el servicio de Sentinel no respondió" con los seis módulos', async () => {
        const h = await obtenerImagenesNdvi(d, CONTORNOS, { cliente: cliente(async () => http(502, { error: 'Process API', codigo: 'cdse' })), ...rapido });
        expect(h.match(/Sentinel \(Copernicus\) no respondió/g)).toHaveLength(1);
    });
    it('timeout por módulo y tope total: lo que no responde queda con aviso y la generación termina', async () => {
        const t0 = Date.now();
        const h = await obtenerImagenesNdvi(d, CONTORNOS, { cliente: cliente(() => new Promise(() => undefined)), reducir: sinReducir, timeoutPorModuloMs: 5000, limiteTotalMs: 80 });
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(h.match(/Imagen satelital no disponible para 6 de 6 módulos:/g)).toHaveLength(1);
        expect(h).toContain('se agotó el tiempo de espera');
        const h2 = await obtenerImagenesNdvi(d, CONTORNOS, { cliente: cliente(() => new Promise(() => undefined)), reducir: sinReducir, timeoutPorModuloMs: 20 });
        expect(h2.match(/se agotó el tiempo de espera/g)).toHaveLength(1);
    });
    it('parcial: unos módulos con imagen y otros con aviso; el recuento lo dice', async () => {
        const h = await obtenerImagenesNdvi(d, CONTORNOS, {
            cliente: cliente(async (_n, o) => {
                const m = (o.body as { numero_modulo: number }).numero_modulo;
                if (m === 3) return http(401, { error: 'x' });
                if (m === 12) return { data: { sin_datos: true }, error: null };
                return respuestaOk(m);
            }), ...rapido,
        });
        expect(h.match(/<image /g)).toHaveLength(4);
        // Falla parcial: un aviso POR CAUSA (sin sesión → M3; sin píxeles limpios → M12), no uno por módulo.
        expect(h.match(/Imagen satelital no disponible para 1 de 6 módulos:/g)).toHaveLength(2);
        expect(h.match(/Sin imagen satelital:/g)).toHaveLength(2);
        expect(h).toContain('(M3)');
        expect(h).toContain('(M12)');
        expect(h).toContain('2 de 6 sin imagen');
        expect(h).toContain('no tiene píxeles limpios');
    });
    it('un fallo al reducir no tira el informe: se usa la imagen original', async () => {
        const h = await obtenerImagenesNdvi(d, CONTORNOS, { cliente: cliente(async (_n, o) => respuestaOk((o.body as { numero_modulo: number }).numero_modulo)), reducir: async () => { throw new Error('canvas'); }, timeoutPorModuloMs: 200 });
        expect(h.match(/<image /g)).toHaveLength(6);
    });
    it('sin mes de referencia: aviso explícito, sin llamar a la función', async () => {
        let n = 0;
        const h = await obtenerImagenesNdvi({ ...d, mesReferencia: null }, CONTORNOS, { cliente: cliente(async () => { n++; return respuestaOk(1); }), ...rapido });
        expect(h).toContain('Imagen satelital no disponible');
        expect(n).toBe(0);
    });
    it('un callback de progreso que lanza no rompe la carga', async () => {
        const h = await obtenerImagenesNdvi(d, CONTORNOS, { cliente: cliente(async (_n, o) => respuestaOk((o.body as { numero_modulo: number }).numero_modulo)), onProgreso: () => { throw new Error('ui'); }, ...rapido });
        expect(h.match(/<image /g)).toHaveLength(6);
    });
});
