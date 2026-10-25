/**
 * imprimirInforme — "Imprimir / PDF" de los informes HTML institucionales que se previsualizan en un iframe.
 *
 * Safari en iOS/iPadOS no imprime un iframe de forma fiable (window.print() no abre el diálogo o imprime la página
 * padre). En esos equipos el informe se rasteriza hoja por hoja y se entrega como PDF por la hoja de Compartir; en el
 * resto se usa el diálogo de impresión del navegador (PDF vectorial, texto seleccionable).
 */
import { rasterizaHtml } from './rasterizaHtml';
import { esIOS, guardaOComparte } from './descargaArchivo';
import { imagenAJpegPaginas, pdfDePaginas, type PaginaJpeg } from './pdfDeImagenes';

const ANCHO_CARTA_PX = 816;
const ANCHO_A4_PX = 794;
/** Neutraliza lo que solo existe en pantalla: fondo gris, sombra, márgenes entre hojas y botones. */
const CSS_RASTER = 'html,body{background:#fff!important}.pagina,.hoja{margin:0 auto!important;box-shadow:none!important;border-radius:0!important}'
    + '.pagina{max-width:none!important;width:100%!important;min-height:1056px!important}.no-print,.btn-imprimir{display:none!important}';

/** Divide el informe en sus hojas (`.pagina`, o `.hoja`, o el documento completo) y devuelve un HTML por hoja. */
export function htmlPorHoja(html: string): { htmls: string[]; ancho: number } {
    const ancho = /size:\s*A4/i.test(html) ? ANCHO_A4_PX : ANCHO_CARTA_PX;
    const sel = (d: Document) => (d.querySelector('.pagina') ? '.pagina' : d.querySelector('.hoja') ? '.hoja' : null);
    const base = new DOMParser().parseFromString(html, 'text/html');
    const selector = sel(base);
    const n = selector ? base.querySelectorAll(selector).length : 1;
    const htmls: string[] = [];
    for (let i = 0; i < n; i++) {
        const d = new DOMParser().parseFromString(html, 'text/html');
        if (selector) d.querySelectorAll(selector).forEach((el, j) => { if (j !== i) el.remove(); });
        const st = d.createElement('style');
        st.textContent = CSS_RASTER;
        d.head.appendChild(st);
        htmls.push(`<!doctype html>${d.documentElement.outerHTML}`);
    }
    return { htmls, ancho };
}

/** Rasteriza cada hoja del informe y arma el PDF. */
export async function htmlAPdf(html: string): Promise<Blob> {
    const { htmls, ancho } = htmlPorHoja(html);
    const paginas: PaginaJpeg[] = [];
    for (const h of htmls) paginas.push(...await imagenAJpegPaginas(await rasterizaHtml(h, { ancho, escala: 2 })));
    return pdfDePaginas(paginas);
}

/**
 * Imprimir / PDF. `nombre` sin extensión. En iOS entrega un PDF; en el resto imprime el iframe.
 * Devuelve true si se entregó un archivo (iOS) y false si solo se abrió el diálogo de impresión.
 */
export async function imprimirOPdf(opts: { html: string | null; frame: HTMLIFrameElement | null; nombre: string }): Promise<boolean> {
    if (!esIOS()) {
        const w = opts.frame?.contentWindow;
        if (w) { w.focus(); w.print(); }
        return false;
    }
    if (!opts.html) throw new Error('El informe aún no está listo.');
    await guardaOComparte(await htmlAPdf(opts.html), `${opts.nombre}.pdf`, 'application/pdf');
    return true;
}
