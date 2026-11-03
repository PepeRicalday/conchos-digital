/**
 * informeVolumenCultivo — orquestador (única parte con efectos) del informe «Consumo por año, módulo y cultivo (ACUM_INF 2020-2024)».
 * Carga ACUM_INF (misma consulta con caché de sesión que el panel), el volumen provisional del ciclo actual y los logos, arma el
 * documento con informeVolumenCultivoHtml (puro) y lo entrega como HTML autónomo. Un fallo de consulta queda visible dentro del informe.
 */
import { supabase } from '../lib/supabase';
import { guardaOComparte } from './descargaArchivo';
import { cargarLogosInforme } from './logosInforme';
import { cargarSupVolAnual } from './supVolAnual';
import { cargarVolumenActual } from './ndviVolumen';
import { construirHtmlVolumenCultivo, nombreArchivoVolumenCultivo, folioVolumenCultivo, type DatosInformeVolumenCultivo } from './informeVolumenCultivoHtml';

export interface DocumentoVolumenCultivo { html: string; folio: string; nombreArchivo: string }

const versionApp = (): string => (typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : 's/d');

export async function generarDocumentoVolumenCultivo(o: { emisor?: string | null } = {}): Promise<DocumentoVolumenCultivo> {
    const [logos, sv, volumenActual] = await Promise.all([
        cargarLogosInforme(),
        cargarSupVolAnual(supabase).catch((e: unknown) => ({ filas: [], error: e instanceof Error ? e.message : 'Error de red.' })),
        cargarVolumenActual(),
    ]);
    const datos: DatosInformeVolumenCultivo = {
        filas: sv.filas, volumenActual, errorSupVol: sv.error, emisor: o.emisor?.trim() || 'SICA 005', emitidoEn: new Date(), version: versionApp(),
    };
    return { html: construirHtmlVolumenCultivo(datos, logos), folio: folioVolumenCultivo(datos), nombreArchivo: nombreArchivoVolumenCultivo(datos) };
}

/** Genera el informe y lo entrega como archivo HTML autónomo (imprimible a PDF; en iOS, por la hoja de compartir). */
export async function descargarInformeVolumenCultivo(o: { emisor?: string | null } = {}): Promise<DocumentoVolumenCultivo> {
    const doc = await generarDocumentoVolumenCultivo(o);
    await guardaOComparte(new Blob([doc.html], { type: 'text/html;charset=utf-8;' }), doc.nombreArchivo, 'text/html');
    return doc;
}
