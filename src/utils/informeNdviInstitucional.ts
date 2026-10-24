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
import { supabase } from '../lib/supabase';
import { MODULOS_SRL_IDS } from './modulosSRL';
import { construirInteranual, type DatosInteranual } from './informeNdviInteranual';
import { construirHtmlInteranual } from './informeNdviInteranualHtml';
import type { FilaSupVol } from './ndviInteranual';
import { cargarSerieNdviV2 } from './ndviSerie';

export interface OpcionesInformeNdvi {
    /** Nombre de quien emite (perfil en sesión). Sin él se rotula "SICA 005". */
    emisor?: string | null;
    /** Filtros de la ventana; sin ella, el informe completo de siempre (todo el ciclo, 6 módulos). */
    config?: ConfigInformeNdvi;
    /** Modo interanual: datos ya cargados (la ventana los lee al elegir el modo); sin ellos se consultan aquí. */
    datosInteranual?: DatosInteranual;
}

const versionApp = (): string => (typeof __V2_APP_VERSION__ !== 'undefined' ? __V2_APP_VERSION__ : 's/d');

/** Lee la serie v2 y el informe de superficie/volumen (solo lectura). Un fallo en superficie/volumen no tumba la serie: queda marcado. */
export async function cargarDatosInteranual(): Promise<DatosInteranual> {
    const [a, b] = await Promise.all([
        cargarSerieNdviV2(supabase),
        supabase.from('superficie_volumen_anual_modulo').select('anio, numero_modulo, cultivo, superficie_ha, volumen_miles_m3, atipico').limit(2000),
    ]);
    if (a.error) throw new Error(`No se pudo leer la serie de NDVI interanual: ${a.error}`);
    return { ndvi: a.filas, supVol: b.error ? [] : ((b.data ?? []) as FilaSupVol[]), errorSupVol: !!b.error };
}

async function htmlInteranual(config: ConfigInformeNdvi, o: OpcionesInformeNdvi): Promise<string> {
    const [datos, logoSrl, logoSica] = await Promise.all([
        o.datosInteranual ? Promise.resolve(o.datosInteranual) : cargarDatosInteranual(),
        assetToDataURI('/logos/logo-srl.png').catch(() => ''),
        assetToDataURI('/logos/SICA005.png').catch(() => ''),
    ]);
    const modulos = config.modulos.length ? config.modulos : [...MODULOS_SRL_IDS];
    const modelo = construirInteranual(datos, { anios: config.interanual?.anios ?? [], modulos }, { ahora: new Date(), emisor: o.emisor ?? null, version: versionApp(), logoSrlOk: !!logoSrl });
    return construirHtmlInteranual(modelo, { srl: logoSrl, sica: logoSica }, config.hoja);
}

/** Arma el HTML del informe (sin descargarlo): lo usan la vista previa y la descarga. */
export async function generarHtmlInformeNdvi(filas: FilaNdviInforme[], o: OpcionesInformeNdvi = {}): Promise<string> {
    const config = o.config ?? configPorDefecto(mesesDisponibles(filas));
    if (config.modo === 'interanual') return htmlInteranual(config, o);
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
