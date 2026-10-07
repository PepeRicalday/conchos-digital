/**
 * rasterizaHtml — convierte un HTML autónomo en un PNG, sin librerías nuevas ni motor de impresión.
 *
 * Técnica (extraída de la infografía de Clima): el HTML se carga en un iframe oculto para medir su alto real,
 * luego ese documento completo se envuelve en un SVG `<foreignObject>` y se rasteriza a un `<canvas>` escalado.
 *
 * Requisitos del HTML: CSS en <style> en línea, imágenes como data URI, sin fuentes web externas ni JS
 * (foreignObject no hereda las @fontsource de la página) y sin `backdrop-filter`.
 */

export interface OpcionesRaster {
    /** Ancho lógico del documento en px (el alto se mide del contenido). */
    ancho: number;
    /** Factor de escala del canvas (2 = nitidez de impresión). */
    escala?: number;
}

/**
 * Codifica un string UTF-8 (con emojis y acentos) a base64. btoa() sólo acepta Latin1, así que se pasa por
 * TextEncoder en vez del patrón unescape(encodeURIComponent(...)), ya deprecado.
 */
function utf8ToBase64(texto: string): string {
    const bytes = new TextEncoder().encode(texto);
    let binario = '';
    for (const b of bytes) binario += String.fromCharCode(b);
    return btoa(binario);
}

/**
 * Espera a que todas las <img> de un documento terminen de cargar (o fallen). Los logos ya llegan como data URI,
 * pero el navegador aún necesita un tick para decodificarlos antes de dibujarlos en el <canvas>.
 */
function esperaImagenes(doc: Document): Promise<void> {
    return Promise.all(
        Array.from(doc.images).map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
        })),
    ).then(() => undefined);
}

export async function rasterizaHtml(html: string, { ancho, escala = 2 }: OpcionesRaster): Promise<Blob> {
    const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8;' }));
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;top:-99999px;left:-99999px;width:${ancho}px;height:800px;border:0;visibility:hidden;`;

    try {
        // Navegar por src (en vez de document.write, ya deprecado) deja que el navegador parsee el documento de
        // forma normal y dispare 'load' cuando el HTML ya resolvió — el Blob hereda el origen de la página, así que
        // contentDocument sigue siendo accesible (no hay problema de CORS).
        const cargaLista = new Promise<void>(resolve => {
            iframe.addEventListener('load', () => resolve(), { once: true });
        });
        iframe.src = blobUrl;
        document.body.appendChild(iframe);
        await cargaLista;

        const doc = iframe.contentDocument;
        if (!doc) throw new Error('No se pudo preparar el lienzo de captura.');
        await esperaImagenes(doc);

        // Alto real del documento ya renderizado: el contenido es dinámico y no puede fijarse a mano.
        const alto = Math.ceil(doc.documentElement.scrollHeight);

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('xmlns', svgNS);
        svg.setAttribute('width', String(ancho));
        svg.setAttribute('height', String(alto));
        svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
        const foreign = document.createElementNS(svgNS, 'foreignObject');
        foreign.setAttribute('width', '100%');
        foreign.setAttribute('height', '100%');
        // xhtml namespace requerido: un <div> plano dentro de foreignObject se ignora en Chrome si no lo declara.
        const htmlNode = doc.documentElement.cloneNode(true) as HTMLElement;
        htmlNode.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        foreign.appendChild(htmlNode);
        svg.appendChild(foreign);

        const svgData = new XMLSerializer().serializeToString(svg);
        // Data URI en vez de Blob URL: Chrome marca como "tainted" cualquier canvas donde se dibuje un SVG cargado
        // desde un Blob URL, y eso hace fallar toBlob/toDataURL. Con data: en base64 no se aplica esa marca.
        const svgDataUri = `data:image/svg+xml;charset=utf-8;base64,${utf8ToBase64(svgData)}`;

        const img = new Image();
        img.width = ancho;
        img.height = alto;
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('No se pudo rasterizar la imagen.'));
            img.src = svgDataUri;
        });

        const canvas = document.createElement('canvas');
        canvas.width = ancho * escala;
        canvas.height = alto * escala;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No se pudo preparar el lienzo de captura.');
        ctx.scale(escala, escala);
        ctx.drawImage(img, 0, 0, ancho, alto);

        const blobPng: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blobPng) throw new Error('No se pudo generar el archivo de imagen.');
        return blobPng;
    } finally {
        if (iframe.parentNode) document.body.removeChild(iframe);
        URL.revokeObjectURL(blobUrl);
    }
}
