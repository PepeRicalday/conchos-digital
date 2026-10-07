// ═══════════════════════════════════════════════════════════════════════════
// INFORME INSTITUCIONAL NDVI — SRL Unidad Conchos / SICA-005
// ---------------------------------------------------------------------------
// Orquestador (única parte con efectos): carga contornos (con caché de sesión), logos y volumen; arma el modelo
// (informeNdviDatos, puro) y el documento (informeNdviHtml + informeNdviSvg, puros). La configuración (periodo, módulos,
// indicadores, secciones…) viene de la ventana "Configurar informe". Cualquier fallo de carga NO se traga: queda como aviso
// dentro del propio informe.
// ═══════════════════════════════════════════════════════════════════════════
import { guardaOComparte } from './descargaArchivo';
import { volumenAcumuladoPorModuloHm3 } from './indicesSrl';
import { assetToDataURI } from './assetToDataURI';
import { cargarContornosModulos } from './contornosModulos';
import { construirDatosNdvi, type FilaNdviInforme } from './informeNdviDatos';
import { contornosAAnillos, planoSvg } from './informeNdviSvg';
import { construirHtmlNdvi } from './informeNdviHtml';
import { configPorDefecto, inicioCiclo, mesReferenciaDe, mesesDisponibles, type ConfigInformeNdvi } from './informeNdviConfig';
import { nombreArchivo } from './informeBase';

export interface OpcionesInformeNdvi {
    /** Nombre de quien emite (perfil en sesión). Sin él se rotula "SICA 005". */
    emisor?: string | null;
    /** Filtros de la ventana; sin ella, el informe completo de siempre (todo el ciclo, 6 módulos). */
    config?: ConfigInformeNdvi;
}

const versionApp = (): string => (typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : 's/d');

/** Arma el HTML del informe (sin descargarlo): lo usan la vista previa y la descarga. */
export async function generarHtmlInformeNdvi(filas: FilaNdviInforme[], o: OpcionesInformeNdvi = {}): Promise<string> {
    const config = o.config ?? configPorDefecto(mesesDisponibles(filas));
    const [logoSrl, logoSica, fc] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png').catch(() => ''),
        assetToDataURI('/logos/SICA005.png').catch(() => ''),
        cargarContornosModulos(),
    ]);
    const contornos = contornosAAnillos(fc);

    const mesRef = mesReferenciaDe(filas, config);
    let volumenPorModulo = new Map<number, number>();
    let volumenMesParcial = false;
    let volumenConError = false;
    if (mesRef && config.indicadores.includes('iehp')) {
        try {
            const v = await volumenAcumuladoPorModuloHm3(mesRef, inicioCiclo(mesRef));
            volumenPorModulo = v.porModulo;
            volumenMesParcial = v.ultimoMesEsParcial;
        } catch {
            volumenConError = true;
        }
    }

    const datos = construirDatosNdvi(filas, {
        volumenPorModulo, volumenMesParcial, volumenConError,
        contornosDisponibles: Object.keys(contornos).length > 0,
        logoSrlOk: !!logoSrl, ahora: new Date(), emisor: o.emisor ?? null, version: versionApp(),
    }, config);
    return construirHtmlNdvi(datos, { srl: logoSrl, sica: logoSica }, planoSvg(datos.modulos, contornos));
}

/** Nombre de archivo del informe descargado. */
export const nombreArchivoInformeNdvi = (): string => nombreArchivo('informe-ndvi-institucional-conchos');

/** Entrega el HTML ya generado como archivo (en iOS, por la hoja de compartir). */
export async function descargarInformeNdviHtml(html: string): Promise<void> {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    await guardaOComparte(blob, nombreArchivoInformeNdvi(), 'text/html');
}

/** Genera el informe y lo entrega como archivo HTML autónomo (imprimible a PDF). */
export async function generarInformeInstitucional(filas: FilaNdviInforme[], o: OpcionesInformeNdvi = {}): Promise<void> {
    await descargarInformeNdviHtml(await generarHtmlInformeNdvi(filas, o));
}
