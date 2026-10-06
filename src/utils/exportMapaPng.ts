import { toPng } from 'html-to-image';

export interface OpcionesExportMapa {
    /** Nombre de la capa base visible (se imprime en el pie). */
    capaBase: string;
    /** Capas activas (se imprimen en el pie). */
    capas: string[];
    /** Texto de la escena satelital si aplica, p. ej. "1 oct 2026 · nubes 16 %". */
    escena?: string | null;
    /** Atribución del proveedor de la capa base (obligatoria en la imagen). */
    atribucion: string;
}

const PIXEL_VACIO = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Recorta el texto con "…" para que quepa en `ancho` px con la fuente actual del contexto. */
function ajusta(ctx: CanvasRenderingContext2D, texto: string, ancho: number): string {
    if (ctx.measureText(texto).width <= ancho) return texto;
    let t = texto;
    while (t.length > 1 && ctx.measureText(t + '…').width > ancho) t = t.slice(0, -1);
    return t + '…';
}

function cargaImagen(src: string): Promise<HTMLImageElement> {
    return new Promise((ok, fallo) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => fallo(new Error('No se pudo componer la imagen del mapa.'));
        img.src = src;
    });
}

/**
 * Exporta la vista actual del mapa (Leaflet) a PNG con un pie con fecha, capa base, capas activas y atribución.
 * Los controles interactivos (zoom) se excluyen; la barra de escala y la atribución del proveedor se conservan.
 * Un mosaico cuyo servidor no permita CORS queda en blanco en lugar de abortar toda la exportación.
 */
export async function exportaMapaPng(nodo: HTMLElement, opciones: OpcionesExportMapa): Promise<void> {
    const ancho = nodo.clientWidth;
    const alto = nodo.clientHeight;
    const mapaUrl = await toPng(nodo, {
        pixelRatio: 2, width: ancho, height: alto, cacheBust: true, imagePlaceholder: PIXEL_VACIO,
        filter: (n) => !(n instanceof HTMLElement && (n.classList.contains('leaflet-control-zoom') || n.classList.contains('geo-ley'))),
    });
    const img = await cargaImagen(mapaUrl);

    const PIE = 64 * 2;
    const lienzo = document.createElement('canvas');
    lienzo.width = img.width;
    lienzo.height = img.height + PIE;
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite crear el lienzo de exportación.');
    ctx.drawImage(img, 0, 0);

    ctx.fillStyle = '#020a14';
    ctx.fillRect(0, img.height, lienzo.width, PIE);
    const ahora = new Date();
    const fecha = ahora.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Chihuahua' });
    ctx.fillStyle = '#e8eef6';
    ctx.font = '700 28px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillText(`Geo-Monitor · SICA-005 · ${fecha}`, 28, img.height + 44);
    ctx.fillStyle = '#b4c2d4';
    ctx.font = '400 22px "IBM Plex Sans", system-ui, sans-serif';
    const linea2 = [`Base: ${opciones.capaBase}`, opciones.escena ? `Escena: ${opciones.escena}` : null,
        opciones.capas.length ? `Capas: ${opciones.capas.join(', ')}` : null].filter(Boolean).join('  ·  ');
    ctx.fillText(ajusta(ctx, linea2, lienzo.width - 56), 28, img.height + 82);
    ctx.fillStyle = '#8396ad';
    ctx.font = '400 18px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillText(ajusta(ctx, opciones.atribucion, lienzo.width - 56), 28, img.height + 112);

    const a = document.createElement('a');
    a.download = `geo-monitor_${ahora.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
    a.href = lienzo.toDataURL('image/png');
    a.click();
}
