/**
 * Marca "Vista de invitado" para informes impresos / PDF generados por una cuenta INVITADO.
 * AuthContext activa la bandera al cargar el perfil; imprimirOPdf la aplica al HTML (iOS)
 * o al documento del iframe (escritorio) justo antes de imprimir.
 */
let activa = false;
export const setMarcaInvitado = (v: boolean): void => {
    activa = v;
    if (typeof document === 'undefined') return;
    document.body?.classList.toggle('sica-invitado', v);
    if (v) instalarMarcaGlobal();
};
export const marcaInvitadoActiva = (): boolean => activa;

const ID = 'sica-marca-invitado';
const ESTILO = `<style id="${ID}-css">
#${ID}{position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden}
#${ID} span{transform:rotate(-30deg);font:800 64px/1 system-ui,sans-serif;letter-spacing:6px;color:rgba(100,116,139,.16);white-space:nowrap;text-transform:uppercase}
#${ID}-pie{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;text-align:center;font:600 10px system-ui,sans-serif;color:#64748b;padding:4px;pointer-events:none}
</style>`;
const CAPA = `<div id="${ID}"><span>Vista de invitado</span></div><div id="${ID}-pie">Vista de invitado · solo lectura · no es documento oficial</div>`;

/** Devuelve el HTML con la marca (idempotente). Sin bandera activa lo devuelve intacto. */
export function conMarcaInvitado(html: string): string {
    if (!activa || html.includes(`id="${ID}"`)) return html;
    const conCss = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${ESTILO}</head>`) : ESTILO + html;
    return /<\/body>/i.test(conCss) ? conCss.replace(/<\/body>/i, `${CAPA}</body>`) : conCss + CAPA;
}

/** Inserta la marca en un documento ya cargado (iframe de vista previa). */
export function marcarDocumento(doc: Document | null | undefined): void {
    if (!activa || !doc || doc.getElementById(ID)) return;
    const host = doc.head ?? doc.documentElement;
    host.insertAdjacentHTML('beforeend', ESTILO);
    (doc.body ?? doc.documentElement).insertAdjacentHTML('beforeend', CAPA);
}

// ─── Interceptores globales (solo actúan con la bandera activa) ───────────────────────────────────────────────────
// ~19 generadores arman su propio HTML y varios imprimen por rutas propias (blob + window.print, window.open +
// document.write, iframes, rasterizado). En vez de parchear cada uno, el HTML se marca donde nace o se muestra.
let instalado = false;
const ESTILO_PAGINA = `@media print{body.sica-invitado::after{content:"Vista de invitado";position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2147483647;transform:rotate(-30deg);font:800 64px system-ui,sans-serif;letter-spacing:6px;text-transform:uppercase;color:rgba(100,116,139,.16)}}`;

function instalarMarcaGlobal(): void {
    if (instalado || typeof window === 'undefined') return;
    instalado = true;

    // 1) La página misma (window.print() de pantallas como Balance o Modelación).
    const st = document.createElement('style');
    st.id = `${ID}-pagina`; st.textContent = ESTILO_PAGINA; document.head.appendChild(st);

    // 2) Todo Blob text/html (informes que se abren en pestaña nueva, rasterizado a PNG/PDF).
    const BlobOriginal = window.Blob;
    window.Blob = class extends BlobOriginal {
        constructor(partes?: BlobPart[], opciones?: BlobPropertyBag) {
            const esHtml = activa && !!opciones?.type?.toLowerCase().startsWith('text/html');
            super(esHtml && partes ? partes.map((p) => (typeof p === 'string' ? conMarcaInvitado(p) : p)) : partes, opciones);
        }
    } as typeof Blob;

    // 3) window.open('') + document.write(html completo).
    const write = Document.prototype.write;
    Document.prototype.write = function (this: Document, ...texto: string[]) {
        return write.apply(this, texto.map((t) => (activa && typeof t === 'string' && /<!doctype|<html/i.test(t) ? conMarcaInvitado(t) : t)) as [string]);
    };

    // 3b) Ventanas emergentes: tienen su propio Document.prototype, así que se parchea el de cada una al abrirla.
    const abrir = window.open.bind(window);
    window.open = (...args: Parameters<typeof window.open>) => {
        const w = abrir(...args);
        try {
            const proto = (w as (Window & { Document: typeof Document }) | null)?.Document?.prototype;
            if (proto && !Object.prototype.hasOwnProperty.call(proto, '__sicaMarca')) {
                const escribe = proto.write;
                proto.write = function (this: Document, ...texto: string[]) {
                    return escribe.apply(this, texto.map((t) => (activa && typeof t === 'string' && /<!doctype|<html/i.test(t) ? conMarcaInvitado(t) : t)) as [string]);
                };
                Object.defineProperty(proto, '__sicaMarca', { value: true });
            }
        } catch { /* ventana de otro origen */ }
        return w;
    };

    // 4) Vistas previas en iframe (srcdoc / blob del mismo origen): se marcan al cargar.
    const marca = (f: HTMLIFrameElement) => {
        const poner = () => { try { marcarDocumento(f.contentDocument); } catch { /* otro origen */ } };
        f.addEventListener('load', poner);
        if (f.contentDocument?.readyState === 'complete') poner();
    };
    new MutationObserver((muts) => {
        if (!activa) return;
        for (const m of muts) m.addedNodes.forEach((n) => {
            if (!(n instanceof Element)) return;
            if (n instanceof HTMLIFrameElement) marca(n);
            n.querySelectorAll?.('iframe').forEach(marca);
        });
    }).observe(document.documentElement, { childList: true, subtree: true });
}
