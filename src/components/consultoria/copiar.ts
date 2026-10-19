/** Copia texto al portapapeles; en contextos sin Clipboard API (HTTP, algunos iOS/PWA) usa un textarea temporal. */
export async function copiarTexto(texto: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); return true; }
    } catch { /* se intenta el método alterno */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.fontSize = '16px';   // evita el zoom automático de iOS
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch { return false; }
}
