// Pruebas de la lógica pura de la edge function sentinel-ndvi-modulo-raster (sin red, sin Deno).
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { CLASES_NDVI } from './ndviRampa';
import {
    CLASES_RASTER, SCL_EXCLUIDAS, alfaDePng, bboxDe, bytesABase64, claveCache, construirEvalscript, construirPeticionProcess,
    fraccionValidos, mascaraPoligono, tamanoImagen, validarMes, type Geom,
} from '../../supabase/functions/sentinel-ndvi-modulo-raster/rasterLogica';
import { MODULOS_SRL_GEOMETRY } from '../../supabase/functions/sentinel-ndvi-modulo-raster/modulosGeometry';

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

describe('clases del raster = CLASES_NDVI', () => {
    it('mismos colores y cortes que ndviRampa.ts (sin rampa propia)', () => {
        expect(CLASES_RASTER.map((c) => c.color.toLowerCase())).toEqual(CLASES_NDVI.map((c) => c.color.toLowerCase()));
        expect(CLASES_RASTER.map((c) => c.hasta)).toEqual(CLASES_NDVI.map((c) => c.hasta));
    });
    it('el evalscript embebe esos cortes/colores, la máscara SCL y la mediana ORBIT', () => {
        const es = construirEvalscript();
        expect(es).toContain('mosaicking: "ORBIT"');
        expect(es).toContain('var CORTES = [0.15,0.3,0.5,0.7];');
        expect(es).toContain(`var COLORES = ${JSON.stringify(CLASES_NDVI.map((c) => hex(c.color)))};`);
        expect(es).toContain(`var EXCLUIDAS = ${JSON.stringify([0, 1, 3, 8, 9, 10, 11])};`);
        expect(SCL_EXCLUIDAS).toEqual([0, 1, 3, 8, 9, 10, 11]);
        expect(es).toContain('return [0, 0, 0, 0];'); // sin dato = transparente
        expect(es).toContain('sampleType: "UINT8"');
    });
    it('el evalscript es JavaScript válido y colorea como CLASES_NDVI', () => {
        const es = construirEvalscript().replace('//VERSION=3', '');
        const f = new Function(`${es}; return { setup, evaluatePixel };`)();
        const muestra = (b04: number, b08: number, scl = 4) => ({ B04: b04, B08: b08, SCL: scl, dataMask: 1 });
        // NDVI ≈ 0.1, 0.2, 0.4, 0.6, 0.8 → una clase cada uno
        const pares: [number, number][] = [[0.45, 0.55], [0.4, 0.6], [0.3, 0.7], [0.2, 0.8], [0.1, 0.9]];
        pares.forEach(([r, n], i) => expect(f.evaluatePixel([muestra(r, n)])).toEqual([...hex(CLASES_NDVI[i].color), 255]));
        // Mediana: (0.1, 0.8, 0.8) → 0.8; la nube (SCL 9) se ignora aunque tenga NDVI altísimo.
        expect(f.evaluatePixel([muestra(0.45, 0.55), muestra(0.1, 0.9), muestra(0.1, 0.9), muestra(0.5, 0.5, 9)])).toEqual([...hex(CLASES_NDVI[4].color), 255]);
        // Todo enmascarado o dataMask 0 → transparente
        expect(f.evaluatePixel([muestra(0.1, 0.9, 9), muestra(0.1, 0.9, 3)])).toEqual([0, 0, 0, 0]);
        expect(f.evaluatePixel([{ B04: 0.1, B08: 0.9, SCL: 4, dataMask: 0 }])).toEqual([0, 0, 0, 0]);
        expect(f.evaluatePixel([])).toEqual([0, 0, 0, 0]);
    });
});

describe('validarMes', () => {
    const ahora = new Date(Date.UTC(2026, 9, 24)); // 24-oct-2026
    it('acepta meses cerrados desde 2021-03', () => {
        const v = validarMes('2026-09', ahora);
        expect(v.ok && v.inicio.toISOString()).toBe('2026-09-01T00:00:00.000Z');
        expect(v.ok && v.fin.toISOString()).toBe('2026-10-01T00:00:00.000Z');
        expect(validarMes('2021-03', ahora).ok).toBe(true);
    });
    it('rechaza mes en curso, futuro, anterior a la serie y formatos inválidos', () => {
        for (const m of ['2026-10', '2026-11', '2021-02', '2026-13', '2026-00', '2026-9', '', null, undefined, 202609, '2026-09-01']) {
            expect(validarMes(m, ahora).ok).toBe(false);
        }
    });
});

describe('tamaño de imagen y bbox', () => {
    it('cada módulo: bbox contiene el polígono, ≥20 m efectivos, lado ≤ ~900 px, nunca > 2500', () => {
        for (const [n, geom] of Object.entries(MODULOS_SRL_GEOMETRY)) {
            const g = geom as Geom;
            const bb = bboxDe(g);
            const polis = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
            const pts = polis.flatMap((p) => p[0]);
            expect(Math.min(...pts.map((c) => c[0]))).toBeGreaterThanOrEqual(bb[0]);
            expect(Math.max(...pts.map((c) => c[0]))).toBeLessThanOrEqual(bb[2]);
            expect(Math.min(...pts.map((c) => c[1]))).toBeGreaterThanOrEqual(bb[1]);
            expect(Math.max(...pts.map((c) => c[1]))).toBeLessThanOrEqual(bb[3]);
            const t = tamanoImagen(bb);
            expect(t.resolucionM, `M${n}`).toBeGreaterThanOrEqual(20);
            expect(Math.max(t.ancho, t.alto)).toBeLessThanOrEqual(901);
            expect(t.ancho).toBeGreaterThan(0);
        }
    });
    it('resolución pedida acotada a 20–60 m; proporción conservada; bbox enorme no pasa de 2500 px', () => {
        const bb: [number, number, number, number] = [-105.4, 28.0, -105.3, 28.05];
        expect(tamanoImagen(bb, 5).resolucionM).toBe(20);
        expect(tamanoImagen(bb, 500).resolucionM).toBe(60);
        expect(tamanoImagen(bb, NaN).resolucionM).toBe(20);
        const t = tamanoImagen(bb, 20);
        const razonM = ((bb[2] - bb[0]) * 111320 * Math.cos(28.025 * Math.PI / 180)) / ((bb[3] - bb[1]) * 110574);
        expect(t.ancho / t.alto).toBeCloseTo(razonM, 1);
        const g = tamanoImagen([-110, 25, -100, 35]);
        expect(Math.max(g.ancho, g.alto)).toBeLessThanOrEqual(901);
        expect(g.resolucionM).toBeGreaterThan(20);
    });
});

describe('petición Process API', () => {
    it('mes calendario completo, sentinel-2-l2a, bbox CRS84, PNG con el tamaño pedido', () => {
        const p = construirPeticionProcess({ bbox: [-105.4, 28.0, -105.3, 28.05], ancho: 500, alto: 300, inicio: new Date(Date.UTC(2026, 8, 1)), fin: new Date(Date.UTC(2026, 9, 1)) });
        expect(p.input.bounds.bbox).toEqual([-105.4, 28.0, -105.3, 28.05]);
        expect(p.input.bounds.properties.crs).toContain('CRS84');
        expect(p.input.data[0].type).toBe('sentinel-2-l2a');
        expect(p.input.data[0].dataFilter.timeRange).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
        expect(p.output).toMatchObject({ width: 500, height: 300 });
        expect(p.output.responses[0].format.type).toBe('image/png');
        expect(p.evalscript).toBe(construirEvalscript());
    });
    it('clave de caché', () => { expect(claveCache('2026-09', 12)).toBe('2026-09/M12.json'); });
});

describe('máscara del polígono, PNG y % válidos', () => {
    // Mitad izquierda del bbox con un hueco de 0.1x0.1 en la esquina inferior izquierda.
    const geom: Geom = { type: 'Polygon', coordinates: [
        [[0, 0], [0.5, 0], [0.5, 1], [0, 1], [0, 0]],
        [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2], [0.1, 0.1]],
    ] };
    const bb: [number, number, number, number] = [0, 0, 1, 1];

    it('mascaraPoligono cubre la mitad y respeta el hueco', () => {
        const m = mascaraPoligono(geom, bb, 100, 100);
        expect(m.reduce((s, x) => s + x, 0)).toBe(50 * 100 - 10 * 10);
        expect(m[0]).toBe(1);
        expect(m[99]).toBe(0);               // extremo derecho de la primera fila: fuera
        expect(m[85 * 100 + 15]).toBe(0);    // dentro del hueco (lat 0.1–0.2 ↔ filas 80–89)
        expect(m[85 * 100 + 5]).toBe(1);     // junto al hueco: dentro
    });

    function pngRGBA(w: number, h: number, alfa: (i: number) => number, filtro = 0): Uint8Array {
        const filas: number[] = [];
        const px = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) px.set([10, 20, 30, alfa(i)], i * 4);
        for (let y = 0; y < h; y++) {
            filas.push(filtro);
            for (let x = 0; x < w * 4; x++) {
                const v = px[y * w * 4 + x], a = x >= 4 ? px[y * w * 4 + x - 4] : 0, b = y > 0 ? px[(y - 1) * w * 4 + x] : 0;
                filas.push(filtro === 1 ? (v - a) & 255 : filtro === 2 ? (v - b) & 255 : v);
            }
        }
        const comp = deflateSync(Buffer.from(filas));
        const trozo = (tipo: string, datos: Uint8Array) => {
            const b = Buffer.alloc(12 + datos.length);
            b.writeUInt32BE(datos.length, 0); b.write(tipo, 4, 'latin1'); Buffer.from(datos).copy(b, 8);
            return b; // el CRC no se valida en el decodificador
        };
        const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
        return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', comp), trozo('IEND', new Uint8Array(0))]));
    }

    it('alfaDePng recupera el plano alfa (filtros None/Sub/Up)', async () => {
        for (const filtro of [0, 1, 2]) {
            const alfa = await alfaDePng(pngRGBA(6, 4, (i) => (i % 3 === 0 ? 255 : 0), filtro), 6, 4);
            expect(alfa && Array.from(alfa)).toEqual(Array.from({ length: 24 }, (_, i) => (i % 3 === 0 ? 255 : 0)));
        }
    });
    it('alfaDePng devuelve null (S/D) ante tamaño distinto o basura', async () => {
        expect(await alfaDePng(pngRGBA(6, 4, () => 255), 7, 4)).toBeNull();
        expect(await alfaDePng(new Uint8Array([1, 2, 3]), 1, 1)).toBeNull();
    });
    it('fraccionValidos cuenta solo dentro del polígono; sin píxeles dentro → null', () => {
        const m = mascaraPoligono(geom, bb, 100, 100);
        expect(fraccionValidos(new Uint8Array(10000).fill(255), m)).toBe(1);
        const izq = new Uint8Array(10000).map((_, i) => ((i % 100) < 25 ? 255 : 0)); // solo columnas 0–24
        const f = fraccionValidos(izq, m)!;
        expect(f).toBeGreaterThan(0.4);
        expect(f).toBeLessThan(0.6);
        expect(fraccionValidos(new Uint8Array(10000), m)).toBe(0);
        expect(fraccionValidos(new Uint8Array(10000).fill(255), new Uint8Array(10000))).toBeNull();
    });
    it('bytesABase64 coincide con Buffer y soporta binarios grandes', () => {
        const b = new Uint8Array(200_000).map((_, i) => i % 251);
        expect(bytesABase64(b)).toBe(Buffer.from(b).toString('base64'));
    });
});
