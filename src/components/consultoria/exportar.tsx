import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatMessage, Tarjeta } from '../../hooks/useHydricChat';
import { celda } from '../../utils/consultoria';
import { assetToDataURI } from '../../utils/assetToDataURI';
import { rasterizaHtml } from '../../utils/rasterizaHtml';
import { guardaOComparte } from '../../utils/descargaArchivo';
import { formatDate, formatTime } from '../../utils/dateHelpers';

const ANCHO = 900;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const tablaTarjeta = (t: Tarjeta) =>
    `<h3>${esc(t.titulo)}</h3><table><thead><tr>${t.columnas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.filas
        .map((f) => `<tr>${f.map((v, i) => { const x = celda(v); return `<td class="${i === 0 ? 'p' : x === 'S/D' ? 'sd' : ''}">${esc(x)}</td>`; }).join('')}</tr>`)
        .join('')}</tbody></table>${t.nota ? `<p class="n">${esc(t.nota)}</p>` : ''}`;

const ESTILO = `*{box-sizing:border-box}body{margin:0;width:${ANCHO}px;background:#fff;color:#1c2330;font:15px/1.55 Arial,Helvetica,sans-serif}
.w{padding:28px 32px}.cab{display:flex;align-items:center;gap:14px;border-bottom:3px solid #6B2D2D;padding-bottom:12px;margin-bottom:16px}
.cab img{height:44px}.cab b{display:block;font-size:17px;color:#6B2D2D}.cab span{font-size:12px;color:#5b6575}
h1,h2,h3{color:#6B2D2D;margin:14px 0 6px}h3{font-size:14px;text-transform:uppercase;letter-spacing:.04em}
table{border-collapse:collapse;width:100%;margin:6px 0 10px;font-size:13px}th,td{border:1px solid #d5dae2;padding:5px 8px;text-align:right}
th{background:#f3eded}th:first-child,td:first-child{text-align:left}td.p{font-weight:700}td.sd{color:#8a5a00;font-style:italic}
.n,.pie{font-size:11.5px;color:#5b6575}.pie{border-top:1px solid #d5dae2;margin-top:18px;padding-top:8px}p{margin:6px 0}`;

/** HTML autónomo (CSS en línea, sin JS ni fuentes web) de una respuesta del asistente, listo para rasterizar. */
export function htmlRespuesta(msg: ChatMessage, logo: string): string {
    const cuerpo = renderToStaticMarkup(<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: () => null }}>{msg.content}</ReactMarkdown>);
    const tarjetas = (msg.metadata?.tarjetas ?? []).map(tablaTarjeta).join('');
    const fuentes = (msg.metadata?.fuentes ?? []).map((f) => esc(f.documento)).join(' · ');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${ESTILO}</style></head><body><div class="w">`
        + `<div class="cab">${logo ? `<img src="${logo}" alt="">` : ''}<div><b>Consultoría IA · SICA 005</b><span>SRL Unidad Conchos · ${esc(formatDate(msg.created_at))} ${esc(formatTime(msg.created_at))}</span></div></div>`
        + `${tarjetas}${cuerpo}<div class="pie">${fuentes ? `Fuentes: ${fuentes}<br>` : ''}Respuesta generada por IA a partir de datos del sistema; lo no medido se informa como S/D. Verifique antes de decidir.</div></div></body></html>`;
}

export async function exportarRespuestaPng(msg: ChatMessage): Promise<void> {
    const logo = await assetToDataURI('/logos/logo-srl.png');     // '' si falla: la plantilla lo omite
    const png = await rasterizaHtml(htmlRespuesta(msg, logo), { ancho: ANCHO, escala: 2 });
    await guardaOComparte(png, `consultoria-ia-${msg.created_at.slice(0, 10)}.png`, 'image/png');
}
