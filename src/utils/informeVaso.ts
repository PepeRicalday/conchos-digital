// INFORME DEL VASO — orquestador (única capa con efectos: carga de logos). Datos → HTML son funciones puras.
import { assetToDataURI } from './assetToDataURI';
import { guardaOComparte } from './descargaArchivo';
import { nombreArchivo } from './informeBase';
import { construirDatosVaso, type ConfigInformeVaso, type EntradaInformeVaso } from './informeVasoDatos';
import { construirHtmlVaso } from './informeVasoHtml';

export type EntradaVaso = Omit<EntradaInformeVaso, 'logoSrlOk' | 'ahora' | 'version'>;

const versionApp = (): string => (typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : 's/d');

export async function generarHtmlInformeVaso(e: EntradaVaso, config: ConfigInformeVaso): Promise<string> {
    const [srl, sica] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png').catch(() => ''),
        assetToDataURI('/logos/SICA005.png').catch(() => ''),
    ]);
    const datos = construirDatosVaso({ ...e, logoSrlOk: !!srl, ahora: new Date(), version: versionApp() }, config);
    return construirHtmlVaso(datos, { srl, sica });
}

export const nombreArchivoInformeVaso = (presa: string): string =>
    nombreArchivo(`informe-vaso-${presa.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}`);

export async function descargarInformeVasoHtml(html: string, presa: string): Promise<void> {
    await guardaOComparte(new Blob([html], { type: 'text/html;charset=utf-8;' }), nombreArchivoInformeVaso(presa), 'text/html');
}
