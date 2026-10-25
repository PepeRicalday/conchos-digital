/**
 * informeNdviRaster — cliente de la edge function `sentinel-ndvi-modulo-raster` (imagen NDVI real por módulo
 * y mes cerrado para el informe institucional). Módulo PURO: recibe el cliente de Supabase, no importa nada
 * del informe y NUNCA lanza — todo fallo vuelve como resultado tipado para que el informe salga igual, con
 * aviso explícito y no con un hueco silencioso (S/D, nunca "0").
 *
 * Qué es la imagen: NDVI de la FRONTERA del módulo (mediana mensual por píxel con máscara SCL, mismas cifras
 * metodológicas que ndvi_modulo_mensual_v2). Incluye caminos, canales y suelo sin riego: NO es NDVI de parcela.
 * La función devuelve el rectángulo (bbox); el recorte al polígono lo hace quien la pinte con clipPath.
 */

export type MotivoFalloRaster = 'sin-sesion' | 'cdse-caido' | 'mes-invalido' | 'sin-datos' | 'timeout' | 'error';

export interface RasterOk {
    ok: true;
    /** `data:image/png;base64,...` listo para <image href>. */
    dataUri: string;
    /** CRS84 [minLon, minLat, maxLon, maxLat] exacto de la imagen. */
    bbox: [number, number, number, number];
    ancho: number;
    alto: number;
    /** Escenas (fechas de paso distintas) del mes; null = S/D (el catálogo no respondió). */
    nEscenas: number | null;
    /** Fracción 0–1 de píxeles dentro del polígono con dato; null = S/D (no calculable). */
    pctValidos: number | null;
    resolucionM: number;
    mes: string;
    modulo: number;
    /** Aviso de alcance para el pie de la imagen. */
    nota: string;
}
export interface RasterFallo { ok: false; motivo: MotivoFalloRaster; detalle: string; mes: string; modulo: number }
export type ResultadoRaster = RasterOk | RasterFallo;

/** Subconjunto del cliente de Supabase que se usa (permite simularlo en pruebas). */
export interface ClienteRaster {
    auth: { getSession(): Promise<{ data: { session: unknown | null } }> };
    functions: { invoke(nombre: string, opciones: { body: unknown }): Promise<{ data: any; error: any }> };
}

export interface OpcionesRaster {
    /** Por defecto 45 s por intento. */
    timeoutMs?: number;
    /** Reintentos tras el primer intento, solo para fallos transitorios (timeout / CDSE / error). Por defecto 1. */
    reintentos?: number;
    /** Espera entre intentos. Por defecto 1500 ms. */
    esperaMs?: number;
    /** 20–60 m; por defecto la de la función (20 m). */
    resolucionM?: number;
}

export const FUNCION_RASTER = 'sentinel-ndvi-modulo-raster';
const TIMEOUT_DEFECTO_MS = 45_000;
const NOTA_DEFECTO = 'NDVI de la frontera del módulo (incluye caminos, canales y suelo sin riego); no es NDVI de parcela.';

const falla = (motivo: MotivoFalloRaster, detalle: string, mes: string, modulo: number): RasterFallo => ({ ok: false, motivo, detalle, mes, modulo });
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Motivos que no se arreglan reintentando. */
const DEFINITIVOS: MotivoFalloRaster[] = ['sin-sesion', 'mes-invalido', 'sin-datos'];

async function leeError(error: any): Promise<{ status: number | null; cuerpo: any; texto: string }> {
    const ctx = error?.context;
    let status: number | null = typeof ctx?.status === 'number' ? ctx.status : null;
    let cuerpo: any = null;
    try { if (ctx && typeof ctx.json === 'function') cuerpo = await ctx.json(); } catch { /* cuerpo no JSON */ }
    if (status == null && typeof error?.status === 'number') status = error.status;
    const texto = String(cuerpo?.error ?? error?.message ?? error ?? 'error desconocido');
    return { status, cuerpo, texto };
}

async function unIntento(cliente: ClienteRaster, mes: string, modulo: number, opts: OpcionesRaster): Promise<ResultadoRaster> {
    const timeoutMs = opts.timeoutMs ?? TIMEOUT_DEFECTO_MS;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<'timeout'>((res) => { temporizador = setTimeout(() => res('timeout'), timeoutMs); });
    try {
        const body: Record<string, unknown> = { mes, numero_modulo: modulo };
        if (opts.resolucionM != null) body.resolucion_m = opts.resolucionM;
        const r = await Promise.race([cliente.functions.invoke(FUNCION_RASTER, { body }), limite]);
        if (r === 'timeout') return falla('timeout', `Sin respuesta en ${Math.round(timeoutMs / 1000)} s`, mes, modulo);

        if (r.error) {
            const { status, cuerpo, texto } = await leeError(r.error);
            if (status === 401 || status === 403) return falla('sin-sesion', texto, mes, modulo);
            if (status === 400) return falla(/mes/i.test(texto) ? 'mes-invalido' : 'error', texto, mes, modulo);
            if (status === 502 || status === 503 || status === 504 || cuerpo?.codigo === 'cdse') return falla('cdse-caido', texto, mes, modulo);
            return falla('error', texto, mes, modulo);
        }

        const d = r.data;
        if (!d || typeof d !== 'object') return falla('error', 'Respuesta vacía de la función', mes, modulo);
        if (d.error) return falla('error', String(d.error), mes, modulo);
        if (d.sin_datos === true) return falla('sin-datos', 'El mes no tiene píxeles válidos tras la máscara de nubes (SCL)', mes, modulo);
        const bbox = d.bbox;
        const bboxOk = Array.isArray(bbox) && bbox.length === 4 && bbox.every((x: unknown) => typeof x === 'number' && Number.isFinite(x));
        if (typeof d.png_base64 !== 'string' || !d.png_base64 || !bboxOk || !(d.ancho > 0) || !(d.alto > 0)) {
            return falla('error', 'Respuesta incompleta de la función (imagen o bbox ausentes)', mes, modulo);
        }
        const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
        return {
            ok: true,
            dataUri: `data:image/png;base64,${d.png_base64}`,
            bbox: bbox as [number, number, number, number],
            ancho: d.ancho, alto: d.alto,
            nEscenas: num(d.n_escenas), pctValidos: num(d.pct_pixeles_validos),
            resolucionM: num(d.resolucion_m) ?? 20,
            mes, modulo,
            nota: typeof d.nota === 'string' ? d.nota : NOTA_DEFECTO,
        };
    } catch (e) {
        return falla('error', e instanceof Error ? e.message : String(e), mes, modulo);
    } finally {
        if (temporizador) clearTimeout(temporizador);
    }
}

/** Pide la imagen NDVI de un módulo/mes. Nunca lanza. */
export async function solicitarRasterModulo(cliente: ClienteRaster, mes: string, modulo: number, opts: OpcionesRaster = {}): Promise<ResultadoRaster> {
    try {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return falla('mes-invalido', 'Usa AAAA-MM', mes, modulo);
        let sesion: unknown = null;
        try { sesion = (await cliente.auth.getSession())?.data?.session ?? null; } catch { sesion = null; }
        if (!sesion) return falla('sin-sesion', 'No hay sesión iniciada: la función exige un usuario con rol SRL', mes, modulo);

        const reintentos = Math.max(0, opts.reintentos ?? 1);
        let ultimo: ResultadoRaster = falla('error', 'sin intentos', mes, modulo);
        for (let intento = 0; intento <= reintentos; intento++) {
            ultimo = await unIntento(cliente, mes, modulo, opts);
            if (ultimo.ok || DEFINITIVOS.includes(ultimo.motivo)) return ultimo;
            if (intento < reintentos) await dormir(opts.esperaMs ?? 1500);
        }
        return ultimo;
    } catch (e) {
        return falla('error', e instanceof Error ? e.message : String(e), mes, modulo);
    }
}

export interface OpcionesPeriodoRaster extends OpcionesRaster {
    /** Llamadas simultáneas máximas a la función (cuota CDSE). Por defecto 3, tope duro 6. */
    concurrencia?: number;
    /** Se invoca al terminar cada módulo (aunque haya fallado). Una excepción aquí se ignora. */
    onProgreso?: (hechos: number, total: number, modulo: number, resultado: ResultadoRaster) => void;
}

/** Imágenes de varios módulos con tope de concurrencia. Devuelve módulo → resultado; NUNCA rechaza. */
export async function solicitarRastersDelPeriodo(
    cliente: ClienteRaster, mes: string, modulos: number[], opts: OpcionesPeriodoRaster = {},
): Promise<Record<number, ResultadoRaster>> {
    const salida: Record<number, ResultadoRaster> = {};
    const cola = [...new Set(modulos)];
    const total = cola.length;
    const limite = Math.min(6, Math.max(1, Math.floor(opts.concurrencia ?? 3)));
    let hechos = 0;
    const trabajador = async () => {
        for (;;) {
            const modulo = cola.shift();
            if (modulo === undefined) return;
            const r = await solicitarRasterModulo(cliente, mes, modulo, opts);
            salida[modulo] = r;
            hechos++;
            try { opts.onProgreso?.(hechos, total, modulo, r); } catch { /* el progreso no debe romper la carga */ }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limite, total) }, trabajador));
    return salida;
}

/** Proyección del plano: funciones lon→x y lat→y en las unidades del SVG. */
export interface ProyeccionPlano { px(lon: number): number; py(lat: number): number }

/**
 * Posición y tamaño de un `<image>` SVG para el raster dentro del plano (informeNdviSvg.ts → planoSvg).
 * La proyección del plano es EQUIRRECTANGULAR con corrección cosLat (x = offX + (lon − minLon)·cosLat·escala,
 * y = offY + (maxLat − lat)·escala), es decir lineal en lon y en lat; por eso basta proyectar las esquinas
 * del bbox. Usar con preserveAspectRatio="none" (el bbox ya fija la proporción) y recortar con clipPath.
 */
export function geometriaRasterEnPlano(bbox: [number, number, number, number], proy: ProyeccionPlano): { x: number; y: number; ancho: number; alto: number } {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const x = proy.px(minLon), y = proy.py(maxLat);
    return { x, y, ancho: proy.px(maxLon) - x, alto: proy.py(minLat) - y };
}
