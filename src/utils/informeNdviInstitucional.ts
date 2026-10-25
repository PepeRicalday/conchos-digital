// ═══════════════════════════════════════════════════════════════════════════
// INFORME TÉCNICO NDVI — SRL Unidad Conchos / SICA-005
// ---------------------------------------------------------------------------
// Orquestador (única parte con efectos). UN solo cargador por generación: parte de la serie v2 que el panel ya cargó (no se
// vuelve a consultar), y solo pide lo que alguna sección imprime — contornos (plano), volumen (IEHP en las fichas) y
// superficie/volumen anual (su anexo). Logos optimizados con caché. El modelo (informeNdviDatos) y el documento
// (informeNdviHtml) son puros. Todo fallo de consulta queda VISIBLE dentro del informe (calidad del dato y trazabilidad).
// La vista previa y la descarga entregan el MISMO documento: si el contenido no cambió, no se regenera (mismo folio).
// ═══════════════════════════════════════════════════════════════════════════
import { guardaOComparte } from './descargaArchivo';
import { volumenAcumuladoPorModuloHm3 } from './indicesSrl';
import { cargarContornosModulos } from './contornosModulos';
import { construirDatosNdvi, type ErrorConsulta, type FilaNdviInforme, type InformeNdvi } from './informeNdviDatos';
import { contornosAAnillos, planoSvg } from './informeNdviSvg';
import { cargarContextoPlano } from './contextoPlanoNdvi';
import { obtenerImagenesNdvi } from './informeNdviRasterImagen';
import { construirHtmlNdvi, type ExtrasHtml } from './informeNdviHtml';
import {
    aniosDeFilas, aniosDeReferencia, configPorDefecto, huellaConfig, inicioCiclo, mesReferenciaDe, mesesDisponibles, type ConfigInformeNdvi,
} from './informeNdviConfig';
import { hashCorto } from './informeBase';
import { supabase } from '../lib/supabase';
import { cargarLogosInforme } from './logosInforme';
import { cargarSupVolAnual } from './supVolAnual';
import type { FilaSupVol } from './ndviInteranual';
import type { ClienteRaster } from './informeNdviRaster';

export interface OpcionesInformeNdvi {
    /** Nombre de quien emite (perfil en sesión). Sin él se rotula "SICA 005". */
    emisor?: string | null;
    /** Alcance elegido en la ventana; sin él, el informe completo (ciclo, 6 módulos, todas las secciones). */
    config?: ConfigInformeNdvi;
    /**
     * Gancho para la imagen satelital por módulo (la arma otro módulo): recibe el modelo ya calculado y devuelve el HTML de las
     * imágenes. Solo se llama si config.imagenSatelital; si falla, el informe sale igual con un aviso visible, nunca con hueco.
     * Sin este gancho, con imagenSatelital se usa el cliente real (función sentinel-ndvi-modulo-raster con la sesión en curso).
     */
    obtenerImagenes?: (datos: InformeNdvi) => Promise<string | undefined>;
    /** Avance de la obtención de imágenes (módulos terminados de total): el modal lo muestra mientras se genera. */
    onProgresoImagenes?: (hechos: number, total: number) => void;
}

/** Documento generado: lo que se muestra en la vista previa es exactamente lo que se descarga. */
export interface DocumentoNdvi { html: string; folio: string; nombreArchivo: string; clave: string }

const versionApp = (): string => (typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : 's/d');

/** Firma barata de las filas cargadas (cuántas, último mes y suma de NDVI): cambia si cambia el dato, no por el tiempo. */
export function firmaDatos(filas: FilaNdviInforme[]): string {
    const ult = filas.reduce((m, f) => (f.mes > m ? f.mes : m), '');
    const suma = filas.reduce((s, f) => s + f.ndvi_medio, 0);
    return `${filas.length}|${ult}|${suma.toFixed(6)}`;
}

/** Clave del contenido: misma configuración, mismos datos y mismo emisor → mismo documento. */
export function claveDocumento(filas: FilaNdviInforme[], config: ConfigInformeNdvi, emisor: string | null | undefined): string {
    return hashCorto(`${huellaConfig(config)}#${firmaDatos(filas)}#${emisor ?? ''}`);
}

const MAX_CACHE = 3;
const cacheDocs = new Map<string, Promise<DocumentoNdvi>>();

async function armarDocumento(filas: FilaNdviInforme[], config: ConfigInformeNdvi, o: OpcionesInformeNdvi, clave: string): Promise<DocumentoNdvi> {
    const sec = new Set(config.secciones);
    const mesRef = mesReferenciaDe(filas, config);
    const errores: ErrorConsulta[] = [];
    const aniosRef = aniosDeReferencia(config, aniosDeFilas(filas));

    const pideVolumen = !!mesRef && config.indicadores.includes('iehp') && sec.has('modulos');
    const pideSupVol = sec.has('anexoSupVol') && aniosRef.length >= 2;
    const [logos, fc, contexto, volumen, supVol] = await Promise.all([
        cargarLogosInforme(),
        sec.has('situacion') || config.imagenSatelital ? cargarContornosModulos() : Promise.resolve(null),
        sec.has('situacion') && config.mapaRelieve ? cargarContextoPlano() : Promise.resolve(null),
        pideVolumen ? volumenAcumuladoPorModuloHm3(mesRef as string, inicioCiclo(mesRef as string)).catch((e: unknown) => ({ porModulo: new Map<number, number>(), ultimoMesEsParcial: false, error: e instanceof Error ? e.message : 'Error de red.' })) : Promise.resolve(null),
        pideSupVol ? cargarSupVolAnual(supabase).catch((e: unknown) => ({ filas: [] as FilaSupVol[], error: e instanceof Error ? e.message : 'Error de red.' })) : Promise.resolve(null),
    ]);
    const contornos = fc ? contornosAAnillos(fc) : {};

    if (volumen?.error) errores.push({ fuente: 'el volumen entregado', mensaje: volumen.error, consecuencia: 'el IEHP aparece como S/D.' });
    if (supVol?.error) errores.push({ fuente: 'la superficie y el volumen anual', mensaje: supVol.error, consecuencia: 'el anexo de superficie y volumen aparece como S/D.' });

    const datos = construirDatosNdvi(filas, {
        volumenPorModulo: volumen?.porModulo ?? new Map(), volumenMesParcial: volumen?.ultimoMesEsParcial ?? false,
        volumenConError: !!volumen?.error, volumenSolicitado: pideVolumen,
        supVol: supVol?.filas ?? [], errorSupVol: !!supVol?.error, erroresConsulta: errores,
        // Sin sección de situación no se carga el plano: no se avisa de contornos que nadie pidió.
        contornosDisponibles: !sec.has('situacion') || Object.keys(contornos).length > 0,
        logoSrlOk: !!logos.srl, ahora: new Date(), emisor: o.emisor ?? null, version: versionApp(),
    }, config);

    const extras: ExtrasHtml = { contornos, conContexto: !!contexto };
    const obtener = o.obtenerImagenes ?? ((x: InformeNdvi) => obtenerImagenesNdvi(x, contornos, { cliente: supabase as unknown as ClienteRaster, onProgreso: o.onProgresoImagenes }));
    if (config.imagenSatelital) {
        try { extras.imagenes = await obtener(datos); }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Error de red.';
            datos.erroresConsulta.push({ fuente: 'la imagen satelital', mensaje: msg, consecuencia: 'el informe sale sin ella.' });
            datos.avisos.push({ nivel: 'warn', texto: `No se pudo obtener la imagen satelital (${msg}): el informe sale sin ella.` });
        }
    }
    const html = construirHtmlNdvi(datos, logos, sec.has('situacion') ? planoSvg(datos.modulos, contornos, undefined, undefined, contexto) : '', extras);
    return { html, folio: datos.folio, nombreArchivo: datos.traza.nombreArchivo, clave };
}

/**
 * Genera el documento (con caché por contenido). Vista previa y descarga llaman aquí: la segunda llamada con la misma
 * configuración y los mismos datos devuelve el mismo documento (mismo folio) sin volver a consultar nada.
 */
export function generarDocumentoNdvi(filas: FilaNdviInforme[], o: OpcionesInformeNdvi = {}): Promise<DocumentoNdvi> {
    const config = o.config ?? configPorDefecto(mesesDisponibles(filas));
    const clave = claveDocumento(filas, config, o.emisor);
    const previo = cacheDocs.get(clave);
    if (previo) return previo;
    const p = armarDocumento(filas, config, o, clave);
    cacheDocs.set(clave, p);
    // Una generación fallida no se queda en la caché; la más antigua sale cuando hay más de MAX_CACHE.
    p.catch(() => { cacheDocs.delete(clave); });
    if (cacheDocs.size > MAX_CACHE) cacheDocs.delete(cacheDocs.keys().next().value as string);
    return p;
}

/** Solo para pruebas: vacía la caché de documentos. */
export function reiniciarCacheDocumentos(): void { cacheDocs.clear(); }

/** Arma el HTML del informe (sin descargarlo). */
export async function generarHtmlInformeNdvi(filas: FilaNdviInforme[], o: OpcionesInformeNdvi = {}): Promise<string> {
    return (await generarDocumentoNdvi(filas, o)).html;
}

/** Entrega el HTML ya generado como archivo (en iOS, por la hoja de compartir). El nombre trae alcance y periodo. */
export async function descargarInformeNdviHtml(doc: Pick<DocumentoNdvi, 'html' | 'nombreArchivo'>): Promise<void> {
    const blob = new Blob([doc.html], { type: 'text/html;charset=utf-8;' });
    await guardaOComparte(blob, doc.nombreArchivo, 'text/html');
}

/** Genera el informe (misma caché que la vista previa) y lo entrega como archivo HTML autónomo (imprimible a PDF). */
export async function generarInformeInstitucional(filas: FilaNdviInforme[], o: OpcionesInformeNdvi = {}): Promise<void> {
    await descargarInformeNdviHtml(await generarDocumentoNdvi(filas, o));
}
