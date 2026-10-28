/**
 * infografiaGoesRecursos — todo lo que la infografía GOES necesita de la red o del navegador, aparte de la telemetría:
 * logos oficiales, teselas del mapa y contorno de los vasos (Manejo de vaso). Cada recurso falla por separado y NUNCA bloquea:
 * sin logo queda el hueco, sin teselas un fondo liso con aviso, sin contorno solo se marca la presa.
 * También la preparación de la vista previa (zoom) y de la impresión a PDF del iframe.
 */
import { assetToDataURI } from './assetToDataURI';
import { detectaSuperficieVaso } from './mapaSatelital';
import { descargarTeselas, type TeselaConUri } from './mapaTeselas';
import { vistaInfografiaGoes, vistaVaso, ANCHO_INFOGRAFIA_GOES, type OpcionesInfografiaGoes, type VasoContorno } from './infografiaGoesHtml';
import { dimensionHoja, type HojaInfografiaGoes } from './infografiaGoesConfig';
import type { DatosInfografiaGoes } from './infografiaGoes';
import type { ConfigInfografiaGoes } from './infografiaGoesConfig';

/** presa_id → nombre del vaso en Manejo de vaso (VASOS_CONOCIDOS de mapaSatelital). */
const VASOS: { id: string; nombre: string }[] = [{ id: 'PRE-001', nombre: 'La Boquilla' }, { id: 'PRE-002', nombre: 'Fco. I. Madero' }];
const ESPERA_VASO_MS = 25000;

/** Contornos reales del espejo de agua (mismo módulo de Manejo de vaso). */
export async function cargarVasos(): Promise<VasoContorno[]> {
    const una = async (v: { id: string; nombre: string }): Promise<VasoContorno | null> => {
        const s = await Promise.race([detectaSuperficieVaso(v.nombre), new Promise<null>((r) => setTimeout(() => r(null), ESPERA_VASO_MS))]).catch(() => null);
        return s && s.contorno.length >= 4 ? { id: v.id, areaKm2: s.areaKm2, contorno: s.contorno } : null;
    };
    return (await Promise.all(VASOS.map(una))).filter((x): x is VasoContorno => x != null);
}

/**
 * Logos, teselas del plano, contornos de vaso y teselas de cada recuadro, solo lo que el contenido pedido necesita
 * (`cfg` ya con el contenido efectivo: sin plano no se baja nada del mapa).
 */
export async function cargarRecursosInfografiaGoes(datos: DatosInfografiaGoes, cfg: ConfigInfografiaGoes): Promise<Omit<OpcionesInfografiaGoes, 'config'>> {
    const vista = cfg.mapa ? vistaInfografiaGoes(datos.estaciones) : null;
    const [logo, logoSica, teselas, vasos] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'), assetToDataURI('/logos/SICA005.png'),
        vista ? descargarTeselas(vista) : Promise.resolve([] as TeselaConUri[]),
        vista && cfg.vasos ? cargarVasos() : Promise.resolve([] as VasoContorno[]),
    ]);
    const teselasVaso: Record<string, TeselaConUri[]> = {};
    await Promise.all(vasos.map(async (v) => { const vv = vistaVaso(v); if (vv) teselasVaso[v.id] = await descargarTeselas(vv); }));
    return { logo, logoSica, teselas, vasos, teselasVaso };
}

/** Ajusta el zoom de la vista previa para que las páginas (1080 px o el ancho de la hoja) quepan en el ancho del iframe (nunca agranda). */
export function ajustarZoomVistaPrevia(frame: HTMLIFrameElement | null, ancho: number = ANCHO_INFOGRAFIA_GOES): void {
    const doc = frame?.contentDocument;
    if (!frame || !doc?.documentElement) return;
    const z = Math.min(1, Math.max(0.2, (frame.clientWidth - 8) / ancho));
    (doc.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(z);
}

/**
 * Prepara el iframe para imprimir a PDF: quita el zoom de la vista previa y fija una hoja de 1080 px con el alto de la página más
 * alta (cada `.pagina` ocupa su propia hoja, sin cortar tarjetas). Devuelve la función que restaura la vista previa.
 */
export function prepararImpresionInfografia(frame: HTMLIFrameElement | null, hoja: HojaInfografiaGoes = 'pantalla'): () => void {
    const doc = frame?.contentDocument;
    if (!frame || !doc) return () => undefined;
    const raiz = doc.documentElement.style as CSSStyleDeclaration & { zoom: string };
    const zoomPrevio = raiz.zoom;
    raiz.zoom = '1';
    const dim = dimensionHoja(hoja);
    // Hoja de papel: medidas fijas (Carta, media Carta…). Pantalla: el alto de la página más alta, para no partir tarjetas.
    const paginas = Array.from(doc.querySelectorAll<HTMLElement>('.pagina'));
    const alto = dim.alto ?? (Math.ceil(Math.max(0, ...paginas.map((p) => p.getBoundingClientRect().height))) || 1500);
    const st = doc.createElement('style');
    st.id = 'goes-print';
    st.textContent = `@page{size:${dim.ancho}px ${alto}px;margin:0}@media print{.pagina{height:${alto}px;overflow:hidden}}`;
    doc.head.appendChild(st);
    return () => { st.remove(); raiz.zoom = zoomPrevio; };
}
