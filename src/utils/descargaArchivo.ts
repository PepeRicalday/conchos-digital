// ═══════════════════════════════════════════════════════════════════════════
// Descarga de archivos generados en cliente (informes, infografías) — SICA-005
// ---------------------------------------------------------------------------
// Safari en iOS/iPadOS ignora el atributo `download` de <a>: en vez de guardar
// el archivo abre el Blob/data URI en una pestaña nueva. Con la barra de
// Safari oculta (pantalla completa, o la PWA instalada) esa pestaña no tiene
// forma de volver ni de localizar el archivo — el usuario se queda viendo el
// contenido sin saber cómo guardarlo. La hoja nativa de "Compartir" (Web Share
// API con archivos) sí es visible y funciona igual en Safari normal, pantalla
// completa y PWA: desde ahí el usuario elige "Guardar en Archivos" o, para
// imágenes, "Guardar en Fotos".
// ═══════════════════════════════════════════════════════════════════════════

/** Detecta iOS/iPadOS, incluyendo iPadOS 13+ que se anuncia como "Macintosh"
 *  con soporte táctil (Apple igualó el user-agent del iPad al de macOS). */
export function esIOS(): boolean {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
}

/**
 * Entrega un archivo generado en cliente al usuario: en iOS/iPadOS intenta la
 * hoja nativa de "Compartir"; en el resto de plataformas (y como respaldo si
 * el usuario cancela por error o el share no está disponible) usa la descarga
 * clásica vía <a download>.
 */
export async function guardaOComparte(blob: Blob, nombreArchivo: string, tipoMime: string): Promise<void> {
    const file = new File([blob], nombreArchivo, { type: tipoMime });

    if (esIOS() && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: nombreArchivo });
            return;
        } catch (err) {
            // AbortError: el usuario canceló la hoja de compartir a propósito, no
            // es un fallo que deba caer al método de descarga de escritorio.
            if (err instanceof Error && err.name === 'AbortError') return;
            // Cualquier otro error (p. ej. share no disponible en este contexto)
            // cae a la descarga normal, mejor que dejar al usuario sin nada.
        }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
