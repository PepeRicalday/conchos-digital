/**
 * pdfDeImagenes — PDF mínimo (una imagen JPEG por página) sin dependencias.
 *
 * Existe porque Safari en iOS/iPadOS no imprime un iframe de forma fiable (window.print() sobre un iframe no abre el
 * diálogo, o imprime la página padre): en esos equipos el informe se rasteriza y se entrega como PDF por la hoja de Compartir.
 * Cada página mide 612 pt de ancho (carta) y el alto que le corresponda a la imagen, de modo que no se corta nada.
 */

export interface PaginaJpeg { bytes: Uint8Array; ancho: number; alto: number }

const ANCHO_PT = 612;
const enc = new TextEncoder();

/** Convierte una imagen (PNG del rasterizador) a JPEG sobre fondo blanco. */
export async function imagenAJpeg(img: Blob, calidad = 0.92): Promise<PaginaJpeg> {
    const bmp = await createImageBitmap(img);
    try {
        const lienzo = document.createElement('canvas');
        lienzo.width = bmp.width; lienzo.height = bmp.height;
        const ctx = lienzo.getContext('2d');
        if (!ctx) throw new Error('No se pudo preparar el lienzo del PDF.');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, lienzo.width, lienzo.height);
        ctx.drawImage(bmp, 0, 0);
        const jpg = await new Promise<Blob | null>(r => lienzo.toBlob(r, 'image/jpeg', calidad));
        if (!jpg) throw new Error('No se pudo codificar la imagen del PDF.');
        return { bytes: new Uint8Array(await jpg.arrayBuffer()), ancho: bmp.width, alto: bmp.height };
    } finally { bmp.close(); }
}

/** Arma el PDF: catálogo, árbol de páginas y, por página, objeto de página + contenido + imagen. */
export function pdfDePaginas(paginas: PaginaJpeg[]): Blob {
    if (paginas.length === 0) throw new Error('No hay páginas para el PDF.');
    const partes: Uint8Array[] = [];
    const offsets: number[] = [];
    let pos = 0;
    const emite = (b: Uint8Array | string) => { const u = typeof b === 'string' ? enc.encode(b) : b; partes.push(u); pos += u.length; };
    const objeto = (n: number, cuerpo: string, flujo?: Uint8Array) => {
        offsets[n] = pos;
        emite(`${n} 0 obj\n${cuerpo}\n`);
        if (flujo) { emite('stream\n'); emite(flujo); emite('\nendstream\n'); }
        emite('endobj\n');
    };

    emite('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const kids = paginas.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    objeto(1, '<< /Type /Catalog /Pages 2 0 R >>');
    objeto(2, `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`);
    paginas.forEach((p, i) => {
        const base = 3 + i * 3; // página, contenido, imagen
        const alto = Math.round((ANCHO_PT * p.alto) / p.ancho * 100) / 100;
        const contenido = enc.encode(`q ${ANCHO_PT} 0 0 ${alto} 0 0 cm /Im0 Do Q`);
        objeto(base, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO_PT} ${alto}] /Resources << /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>`);
        objeto(base + 1, `<< /Length ${contenido.length} >>`, contenido);
        objeto(base + 2, `<< /Type /XObject /Subtype /Image /Width ${p.ancho} /Height ${p.alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>`, p.bytes);
    });

    const total = 3 + paginas.length * 3;
    const xref = pos;
    let tabla = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let n = 1; n < total; n++) tabla += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    emite(tabla);
    emite(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(partes as BlobPart[], { type: 'application/pdf' });
}
