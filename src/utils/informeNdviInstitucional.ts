// ═══════════════════════════════════════════════════════════════════════════
// INFORME INSTITUCIONAL NDVI — SRL Unidad Conchos / SICA-005
// ---------------------------------------------------------------------------
// Orquestador (única parte con efectos): carga contornos (con caché de sesión), logos y volumen; arma el modelo
// (informeNdviDatos, puro) y el documento (informeNdviHtml + informeNdviSvg, puros) y lo entrega como HTML autónomo.
// Cualquier fallo de carga NO se traga: queda como aviso dentro del propio informe.
// ═══════════════════════════════════════════════════════════════════════════
import { guardaOComparte } from './descargaArchivo';
import { volumenAcumuladoPorModuloHm3 } from './indicesSrl';
import { assetToDataURI } from './assetToDataURI';
import { cargarContornosModulos } from './contornosModulos';
import { construirDatosNdvi, type FilaNdviInforme } from './informeNdviDatos';
import { contornosAAnillos, planoSvg } from './informeNdviSvg';
import { construirHtmlNdvi } from './informeNdviHtml';
import { nombreArchivo } from './informeBase';

export interface OpcionesInformeNdvi {
    /** Nombre de quien emite (perfil en sesión). Sin él se rotula "SICA 005". */
    emisor?: string | null;
}

const versionApp = (): string => (typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : 's/d');

async function buildHTML(filas: FilaNdviInforme[], o: OpcionesInformeNdvi): Promise<string> {
    const [logoSrl, logoSica, fc] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png').catch(() => ''),
        assetToDataURI('/logos/SICA005.png').catch(() => ''),
        cargarContornosModulos(),
    ]);
    const contornos = contornosAAnillos(fc);

    const meses = Array.from(new Set(filas.map((f) => f.mes.slice(0, 7)))).sort();
    const mesRef = meses[meses.length - 1] ?? null;
    let volumenPorModulo = new Map<number, number>();
    let volumenMesParcial = false;
    let volumenConError = false;
    if (mesRef) {
        try {
            const v = await volumenAcumuladoPorModuloHm3(mesRef);
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
    });
    return construirHtmlNdvi(datos, { srl: logoSrl, sica: logoSica }, planoSvg(datos.modulos, contornos));
}

/** Genera el informe institucional NDVI y lo entrega como archivo HTML autónomo (imprimible a PDF en Carta). */
export async function generarInformeInstitucional(filas: FilaNdviInforme[], o: OpcionesInformeNdvi = {}): Promise<void> {
    const html = await buildHTML(filas, o);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    await guardaOComparte(blob, nombreArchivo('informe-ndvi-institucional-conchos'), 'text/html');
}
