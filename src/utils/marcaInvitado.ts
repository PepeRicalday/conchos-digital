/**
 * Marca "Vista de invitado" para informes impresos / PDF generados por una cuenta INVITADO.
 * AuthContext activa la bandera al cargar el perfil; imprimirOPdf la aplica al HTML (iOS)
 * o al documento del iframe (escritorio) justo antes de imprimir.
 */
let activa = false;
export const setMarcaInvitado = (v: boolean): void => { activa = v; };
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
