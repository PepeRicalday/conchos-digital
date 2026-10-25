import { beforeEach, describe, expect, it, vi } from 'vitest';

// El orquestador toca red y DOM: se simulan las fuentes para probar lo que decide (qué consulta, qué cachea, qué muestra).
const m = vi.hoisted(() => ({
    logos: vi.fn(async () => ({ srl: 'data:image/jpeg;base64,AAAA', sica: 'data:image/png;base64,BBBB' })),
    contornos: vi.fn(async () => null as GeoJSON.FeatureCollection | null),
    volumen: vi.fn(async () => ({ porModulo: new Map<number, number>([[1, 5]]), mesesPorModulo: new Map<number, number>([[1, 7]]), mesesParciales: [] as string[], ultimoMesEsParcial: false, error: null as string | null })),
    supVol: vi.fn(async () => ({ filas: [] as unknown[], error: null as string | null })),
    guarda: vi.fn(async () => undefined),
}));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('./logosInforme', () => ({ cargarLogosInforme: m.logos }));
vi.mock('./contornosModulos', () => ({ cargarContornosModulos: m.contornos }));
vi.mock('./indicesSrl', async (orig) => ({ ...(await orig<typeof import('./indicesSrl')>()), volumenAcumuladoPorModuloHm3: m.volumen }));
vi.mock('./supVolAnual', () => ({ cargarSupVolAnual: m.supVol }));
vi.mock('./descargaArchivo', () => ({ guardaOComparte: m.guarda }));

import { reiniciarCacheVolumenActual } from './ndviVolumen';
import { claveDocumento, descargarInformeNdviHtml, firmaDatos, generarDocumentoNdvi, generarHtmlInformeNdvi, reiniciarCacheDocumentos } from './informeNdviInstitucional';
import { configPorDefecto, type ConfigInformeNdvi } from './informeNdviConfig';
import type { FilaNdviInforme } from './informeNdviDatos';

const ANIOS = [2024, 2025, 2026];
const MM = ['03', '04', '05', '06', '07', '08', '09'];
const FILAS: FilaNdviInforme[] = [1, 2, 3].flatMap((mod) => ANIOS.flatMap((a) => MM.map((mm, k) => ({
    numero_modulo: mod, nombre_modulo: `Módulo ${mod}`, mes: `${a}-${mm}`, ndvi_medio: 0.2 + 0.05 * k + 0.01 * mod, ndvi_desv: 0.07, kc_estimado: null, delta_ndvi: null,
    superficie_ha: 1000, fraccion_cobertura_activa: 0.5, n_escenas: 4, pct_pixeles_validos: 0.9, ventana_desde: `${a}-${mm}-01`, ventana_hasta: `${a}-${mm}-28`,
})))).sort((a, b) => (a.mes < b.mes ? -1 : 1));
const MESES = [...new Set(FILAS.map((f) => f.mes))].sort();
const cfg = (o: Partial<ConfigInformeNdvi> = {}): ConfigInformeNdvi => ({ ...configPorDefecto(MESES), modulos: [1, 2, 3], ...o });

beforeEach(() => {
    reiniciarCacheDocumentos();
    reiniciarCacheVolumenActual();
    for (const f of [m.logos, m.contornos, m.volumen, m.supVol, m.guarda]) f.mockClear();
});

describe('generación única y estable', () => {
    it('vista previa y descarga entregan el MISMO documento (mismo folio) y no vuelven a consultar', async () => {
        const a = await generarDocumentoNdvi(FILAS, { config: cfg(), emisor: 'Ing. A' });
        const b = await generarDocumentoNdvi(FILAS, { config: cfg(), emisor: 'Ing. A' });
        expect(b).toBe(a);
        expect(b.folio).toBe(a.folio);
        expect(m.logos).toHaveBeenCalledTimes(1);
        expect(await generarHtmlInformeNdvi(FILAS, { config: cfg(), emisor: 'Ing. A' })).toBe(a.html);
        expect(m.logos).toHaveBeenCalledTimes(1);
    });
    it('dos generaciones simultáneas con el mismo contenido comparten la misma promesa', async () => {
        const [a, b] = await Promise.all([generarDocumentoNdvi(FILAS, { config: cfg() }), generarDocumentoNdvi(FILAS, { config: cfg() })]);
        expect(a).toBe(b);
        expect(m.logos).toHaveBeenCalledTimes(1);
    });
    it('si el contenido cambia (configuración, datos o emisor) se genera otro documento', async () => {
        const a = await generarDocumentoNdvi(FILAS, { config: cfg() });
        const otraBase = await generarDocumentoNdvi(FILAS, { config: cfg({ basePromedio: 'ponderado' }) });
        const otroEmisor = await generarDocumentoNdvi(FILAS, { config: cfg(), emisor: 'Otra' });
        const otrosDatos = await generarDocumentoNdvi(FILAS.map((f, i) => (i === 0 ? { ...f, ndvi_medio: f.ndvi_medio + 0.01 } : f)), { config: cfg() });
        expect(new Set([a, otraBase, otroEmisor, otrosDatos]).size).toBe(4);
        expect(claveDocumento(FILAS, cfg(), null)).not.toBe(claveDocumento(FILAS, cfg({ hoja: 'a4' }), null));
        expect(firmaDatos(FILAS)).not.toBe(firmaDatos(FILAS.slice(1)));
    });
    it('el nombre de archivo trae periodo y alcance; la descarga usa ese nombre', async () => {
        const doc = await generarDocumentoNdvi(FILAS, { config: cfg() });
        expect(doc.nombreArchivo).toMatch(/^informe-ndvi-conchos-2026-03a09-completo-[0-9a-f]{6}-\d{4}-\d{2}-\d{2}\.html$/);
        const solo = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen'] }) });
        expect(solo.nombreArchivo).toContain('-resumen-');
        expect(solo.folio).toContain('-RESUMEN-');
        await descargarInformeNdviHtml(doc);
        expect(m.guarda).toHaveBeenCalledWith(expect.any(Blob), doc.nombreArchivo, 'text/html');
    });
    it('una generación fallida no se queda en la caché', async () => {
        m.logos.mockRejectedValueOnce(new Error('sin red'));
        await expect(generarDocumentoNdvi(FILAS, { config: cfg() })).rejects.toThrow('sin red');
        await expect(generarDocumentoNdvi(FILAS, { config: cfg() })).resolves.toMatchObject({ folio: expect.stringContaining('NDVI-') });
    });
});

describe('un solo cargador: solo se consulta lo que alguna sección imprime', () => {
    it('resumen solo: no pide contornos, volumen ni superficie/volumen', async () => {
        await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen'], indicadores: ['iehp'] }) });
        expect(m.contornos).not.toHaveBeenCalled();
        expect(m.volumen).not.toHaveBeenCalled();
        expect(m.supVol).not.toHaveBeenCalled();
    });
    it('el plano pide contornos; el IEHP en las fichas pide volumen (hasta el mes de referencia); el anexo pide superficie/volumen', async () => {
        await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen', 'situacion', 'modulos', 'anexoSupVol'], indicadores: ['iehp'] }) });
        expect(m.contornos).toHaveBeenCalledTimes(1);
        expect(m.volumen).toHaveBeenCalledWith('2026-09', '2026-03');
        expect(m.supVol).toHaveBeenCalledTimes(1);
    });
    it('sin IEHP no se consulta el volumen aunque haya fichas', async () => {
        await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen', 'modulos'], indicadores: ['ihr'] }) });
        expect(m.volumen).not.toHaveBeenCalled();
    });
    it('el anexo de superficie y volumen no consulta con un solo año de referencia', async () => {
        await generarDocumentoNdvi(FILAS.filter((f) => f.mes.startsWith('2026')), { config: cfg({ secciones: ['resumen', 'anexoSupVol'] }) });
        expect(m.supVol).not.toHaveBeenCalled();
    });
});

describe('errores de consulta visibles', () => {
    it('un error de volumen se declara en la calidad del dato y en la trazabilidad (no se traga)', async () => {
        m.volumen.mockResolvedValueOnce({ porModulo: new Map(), mesesPorModulo: new Map(), mesesParciales: [], ultimoMesEsParcial: false, error: 'permiso denegado' });
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen', 'modulos', 'metodologia'], indicadores: ['iehp'] }) });
        expect(html).toContain('No se pudo consultar el volumen entregado (permiso denegado)');
        expect(html).toMatch(/Consultas fallidas<\/th><td>el volumen entregado \(permiso denegado\)/);
    });
    it('un error de superficie y volumen anual deja el anexo en S/D con aviso', async () => {
        m.supVol.mockResolvedValueOnce({ filas: [], error: 'timeout' });
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen', 'anexoSupVol', 'metodologia'] }) });
        expect(html).toContain('No se pudo consultar la superficie y el volumen anual (timeout)');
        expect(html).toContain('No se pudo consultar el informe de superficie y volumen');
    });
    it('un rechazo de red al consultar se vuelve error visible, no excepción', async () => {
        m.volumen.mockRejectedValueOnce(new Error('sin conexión'));
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen', 'modulos', 'metodologia'], indicadores: ['iehp'] }) });
        expect(html).toContain('sin conexión');
    });
    it('la imagen satelital que falla no tumba el informe: sale con aviso visible', async () => {
        const obtenerImagenes = vi.fn(async () => { throw new Error('CDSE caído'); });
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen', 'situacion', 'metodologia'], imagenSatelital: true }), obtenerImagenes });
        expect(obtenerImagenes).toHaveBeenCalledTimes(1);
        expect(html).toContain('No se pudo obtener la imagen satelital (CDSE caído)');
        expect(html).toContain('Imagen satelital no disponible');
    });
    it('la imagen satelital solo se pide si el interruptor está activo', async () => {
        const obtenerImagenes = vi.fn(async () => '<div id="x">IMG</div>');
        await generarDocumentoNdvi(FILAS, { config: cfg({ imagenSatelital: false }), obtenerImagenes });
        expect(obtenerImagenes).not.toHaveBeenCalled();
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ imagenSatelital: true }), obtenerImagenes });
        expect(html).toContain('<div id="x">IMG</div>');
    });
    it('sin gancho propio, con la imagen activa usa el cliente real: sin sesión cada módulo sale con aviso, el avance se informa y el informe no se cae', async () => {
        const avance: string[] = [];
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: ['resumen', 'situacion', 'metodologia'], imagenSatelital: true }), onProgresoImagenes: (h, t) => avance.push(`${h}/${t}`) });
        expect(avance[0]).toBe('0/3');
        expect(avance[avance.length - 1]).toBe('3/3');
        expect(html.match(/Imagen satelital no disponible para 3 de 3 módulos:/g)).toHaveLength(1);
        expect(html.match(/Sin imagen satelital:/g)).toHaveLength(3);
        expect(html).toContain('Imagen satelital por módulo');
    });
    it('el relieve y el contexto del plano se piden solo con "mapa con relieve" activo', async () => {
        m.contornos.mockResolvedValueOnce(null);
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ mapaRelieve: false, secciones: ['resumen', 'situacion'] }) });
        expect(html).not.toContain('Relieve: Copernicus');
    });
});

describe('anexo B: lectura por módulo con el volumen provisional del año actual', () => {
    const secs: ConfigInformeNdvi['secciones'] = ['resumen', 'anexoSupVol', 'metodologia'];
    const sup = [1, 2, 3].flatMap((mod) => [2024, 2025].map((anio, i) => ({ anio, numero_modulo: mod, cultivo: 'Maíz', superficie_ha: 1000, volumen_miles_m3: 20000 + i * 5000 + mod * 100, atipico: false })));
    it('pide una sola vez el volumen del año actual a la carga compartida y lo imprime provisional', async () => {
        m.supVol.mockResolvedValueOnce({ filas: sup, error: null });
        m.volumen.mockResolvedValue({ porModulo: new Map([[1, 31.2], [2, 30.8], [3, 29.1]]), mesesPorModulo: new Map([[1, 7], [2, 7], [3, 7]]), mesesParciales: [], ultimoMesEsParcial: false, error: null });
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: secs }) });
        expect(m.volumen).toHaveBeenCalledTimes(1);
        expect(m.volumen).toHaveBeenCalledWith('2026-09', '2026-03');
        expect(html).toContain('Lectura por módulo');
        expect(html).toContain('31.2 hm³');
        expect(html).toContain('2026 provisional (fuera del ajuste)');
    });
    it('si la hoja SRL falla, el 2026 queda S/D con aviso y nunca en cero', async () => {
        m.supVol.mockResolvedValueOnce({ filas: sup, error: null });
        m.volumen.mockResolvedValue({ porModulo: new Map(), mesesPorModulo: new Map(), mesesParciales: [], ultimoMesEsParcial: false, error: 'sin red' });
        const { html } = await generarDocumentoNdvi(FILAS, { config: cfg({ secciones: secs }) });
        expect(html).toContain('No se pudo leer el volumen 2026 de la hoja SRL (sin red)');
        expect(html).not.toMatch(/0\.0 hm³/);
    });
});

