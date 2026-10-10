/**
 * infografiaComprobacionHtml — plantillas HTML autónomas de las infografías de «Comprobación por tramo».
 * Se rasterizan con rasterizaHtml: CSS en <style> en línea, imagen solo como data URI, sin JS, sin fuentes web,
 * sin filter/backdrop-filter/position:fixed. Regla rectora: S/D nunca cero; jamás NaN/undefined/null.
 * El color nunca va solo: el parámetro del PacOT lleva caja punteada, la constante subrayado punteado, el estado un glifo.
 */
import type { Comprobacion, EntradaComp, EstadoComp, OrigenEntrada, TokenEc } from '../conservacion/verificacion/comprobacion';
import { nombreConcepto } from '../conservacion/vocabulario';
import { fmt, TEXTO_BASE } from '../components/conservacion/derivacion/fmt';
import { PALETA_INFOGRAFIA, seccionCanalSvg } from '../components/conservacion/derivacion/seccionCanalSvg';
import { seccionCaminoSvg } from '../components/conservacion/derivacion/seccionCaminoSvg';
import { EXAGERACION_VERTICAL, NOTA_150_INFERENCIA, NOTA_CAMINO_ILUSTRATIVO, leyendaSeccion, type ItemLeyenda } from '../components/conservacion/derivacion/seccionLeyenda';
import { TEXTO_POSICION_ESTIMADA, TEXTO_UBICACION_DECLARADA, conteoPorClave, etiquetaPk, obrasEnTramo, type ModeloCanal } from '../components/conservacion/derivacion/ubicacionModelo';
import { leyendaFamiliasHtml, miniMapaCanalSvg, miniMapaTramoSvg, perfilesHtml } from './infografiaPerfilSvg';
import {
    NOTA_CONFIRMAR, NOTA_HONESTIDAD, fechaLarga,
    type AtipicoResumen, type ContextoComprobacion, type DatosConcepto,
} from './infografiaComprobacion';

export const ANCHO_COMPROBACION = 1080;

export const esc = (s: unknown): string =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const cifra = (v: string | null | undefined): string => fmt(v ?? null, 4);
export const txt = (s: string | null | undefined): string => (s === null || s === undefined || s.trim() === '' ? 'S/D' : s);

export const ESTADO = {
    atipico: { glifo: '!', etiqueta: 'Atípico: candidato a revisión', tinta: '#7A4A00', fondo: '#FCEBC4', borde: '#D9920B' },
    cuadra: { glifo: '✔', etiqueta: 'Sigue el criterio del libro', tinta: '#0B5A3A', fondo: '#DDF3E6', borde: '#1B8A5A' },
    no_evaluable: { glifo: '?', etiqueta: 'No evaluable', tinta: '#3F4852', fondo: '#E6E9EC', borde: '#6B7785' },
} as const satisfies Record<EstadoComp, { glifo: string; etiqueta: string; tinta: string; fondo: string; borde: string }>;

const TITULO_ORIGEN: Readonly<Record<OrigenEntrada, string>> = {
    parametro_libre: 'Lo que fija el PacOT', inventario: 'Dimensiones del canal', diagnostico: 'Dato de DIAG-01', constante: 'Conversiones',
};
const esCamino = (c: Comprobacion): boolean => c.red === 'caminos';
const tituloOrigen = (c: Comprobacion, o: OrigenEntrada): string => (o === 'inventario' && esCamino(c) ? 'Dimensiones del camino' : TITULO_ORIGEN[o]);
const CLAVE_ORIGEN: ReadonlyArray<{ o: OrigenEntrada; texto: string }> = [
    { o: 'inventario', texto: 'Dimensión del canal (inventario)' },
    { o: 'parametro_libre', texto: 'Lo que fija el PacOT' },
    { o: 'diagnostico', texto: 'Dato de DIAG-01' },
    { o: 'constante', texto: 'Conversión de unidades' },
];

export const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${ANCHO_COMPROBACION}px;background:#FAF6EA;color:#1B2733;font-family:'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;font-size:16px;line-height:1.4;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.pag{width:${ANCHO_COMPROBACION}px;padding:36px 40px 28px;display:flex;flex-direction:column;gap:18px;background:#FAF6EA}
.cab{display:flex;align-items:center;gap:20px;padding-bottom:16px;border-bottom:3px solid #C9A227}
.cab img{width:84px;height:84px;object-fit:contain;flex:none}
.cab-t{min-width:0;flex:1 1 0}
.kick{font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6B2D2D}
h1{font-size:28px;line-height:1.2;font-weight:800;color:#1B2733;margin-top:4px}
.sub{font-size:16px;color:#4A5663;margin-top:4px}
.card{background:#FFFFFF;border:1px solid #E3DAC0;border-radius:14px;padding:18px 20px;min-width:0}
h2{font-size:16px;font-weight:800;color:#6B2D2D;margin-bottom:10px}
.cifras{display:flex;gap:14px;align-items:stretch}
.cifra{flex:1 1 0;min-width:0;background:#FFFFFF;border:1px solid #E3DAC0;border-radius:14px;padding:14px 18px}
.cifra .e{font-size:14px;color:#4A5663}
.cifra .v{font-size:30px;font-weight:800;color:#1B2733;line-height:1.15;margin-top:2px}
.cifra .v small{font-size:15px;font-weight:600;color:#4A5663}
.cifra.dif.hay{border-color:#D9920B;background:#FFF8E6}
.insignia{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;font-size:15px;font-weight:700;border:2px solid;max-width:100%}
.insignia i{font-style:normal;font-weight:900;font-size:17px}
.fila-estado{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
.cuenta{display:flex;flex-wrap:wrap;align-items:flex-start;gap:10px 8px}
.op{align-self:center;font-size:26px;font-weight:700;color:#4A5663;padding:0 2px}
.dato{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 12px 7px;border-bottom:4px solid #1B2733;border-radius:6px 6px 0 0;min-width:0;max-width:240px}
.dato b{font-size:22px;font-weight:800;line-height:1.15}
.dato b small{font-size:14px;font-weight:600;color:#4A5663}
.dato span{font-size:13px;color:#4A5663;text-align:center;line-height:1.2}
.dato.inventario{border-bottom-color:#1C5E95}.dato.inventario b{color:#1C5E95}
.dato.parametro_libre{border:2px dashed #6D3FC0;border-bottom-width:4px;background:#EFE8FB;border-radius:10px}.dato.parametro_libre b{color:#6D3FC0}
.dato.diagnostico{border-bottom:4px solid #8A94A0}.dato.diagnostico b{color:#1B2733}
.dato.constante{border-bottom:4px dotted #6B7785}.dato.constante b{color:#6B7785}
.res{display:flex;flex-direction:column;gap:4px;padding:8px 16px;border-radius:10px;background:#F1ECDB;border:2px solid #1B2733;min-width:0}
.res b{font-size:26px;font-weight:800;line-height:1.15}
.res b small{font-size:14px;font-weight:600;color:#4A5663}
.res span{font-size:13px;color:#4A5663}
.clave{display:flex;flex-wrap:wrap;gap:6px 20px;margin-top:14px;font-size:14px;color:#4A5663}
.clave div{display:flex;align-items:center;gap:8px}
.clave i{display:inline-block;width:22px;height:0;border-top:4px solid #1B2733}
.clave i.inventario{border-top-color:#1C5E95}
.clave i.parametro_libre{height:12px;border:2px dashed #6D3FC0;background:#EFE8FB;border-radius:3px}
.clave i.diagnostico{border-top-color:#8A94A0}
.clave i.constante{border-top:4px dotted #6B7785}
.grid{display:flex;gap:18px;align-items:flex-start}
.col-dib{flex:1.25 1 0;min-width:0}
.col-dat{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:14px}
.dib svg{display:block;width:100%;height:auto;border:1px solid #E3DAC0;border-radius:10px;background:#F7F2E2}
.ley{list-style:none;margin-top:10px;display:flex;flex-direction:column;gap:6px;font-size:14px;color:#1B2733}
.ley li{display:flex;gap:10px;align-items:flex-start}
.ley li span{min-width:0;flex:1 1 0}
.ley i{flex:none;width:20px;height:12px;margin-top:3px;border-radius:3px;display:inline-block}
.ley .nota{color:#4A5663;font-size:13px}
.m-hierba{background:repeating-linear-gradient(45deg,#7cb342 0 3px,#33691e 3px 5px)}
.m-talud,.m-plantilla{background:#aab8c8;height:5px!important;margin-top:7px!important}
.m-hombro{width:0!important;height:14px!important;border-left:2px dashed #B3261E;border-radius:0!important;margin-left:9px}
.m-azolve{background:#8d6e3f}
.m-plantas{background:#43a047;height:6px!important;margin-top:6px!important;border-radius:3px}
.m-descopete{background:#ef9a3c;height:6px!important;margin-top:6px!important}
.m-losa{background:repeating-linear-gradient(90deg,#ef9a3c 0 6px,transparent 6px 9px);height:5px!important;margin-top:7px!important}
.m-calzada{background:#b08d57}
.m-carpeta{background:repeating-linear-gradient(45deg,#9aa5b1 0 3px,#5f6b78 3px 5px);height:6px!important;margin-top:6px!important}
.m-ilustrativo{background:transparent;border:2px dashed #8b7d63;height:8px!important;margin-top:4px!important}
.sin-dib{font-size:14px;color:#4A5663;padding:14px;border:1px dashed #8A94A0;border-radius:10px}
.pac{border:2px dashed #6D3FC0;background:#EFE8FB;border-radius:12px;padding:14px 16px}
.pac h2{color:#4A2A8A;margin-bottom:6px}
.pac .nom{font-size:14px;color:#4A5663}
.pac .val{font-size:30px;font-weight:800;color:#6D3FC0;line-height:1.15}
.pac .val small{font-size:15px;font-weight:600;color:#4A5663}
.pac p{font-size:14px;color:#1B2733;margin-top:8px}
.pac .aviso{border-left:4px solid #D9920B;background:#FCEBC4;color:#7A4A00;padding:8px 10px;border-radius:0 8px 8px 0}
.dg{border-left:4px solid #1B2733;padding:2px 0 2px 12px}
.dg.inventario{border-left-color:#1C5E95}.dg.diagnostico{border-left-color:#8A94A0}.dg.constante{border-left:4px dotted #6B7785}
.dg h3{font-size:14px;font-weight:800;margin-bottom:4px}
.dg.inventario h3{color:#1C5E95}.dg.diagnostico h3{color:#1B2733}.dg.constante h3{color:#4A5663}
.dg ul{list-style:none}
.dg li{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:4px 0;border-top:1px solid #EEE7D2;font-size:14px}
.dg li:first-child{border-top:0}
.dg li>span{min-width:0;flex:1 1 0;display:flex;flex-direction:column}
.dg li b{flex:none;max-width:45%;font-weight:700;text-align:right}
.dg li b small{font-size:12px;font-weight:600;color:#4A5663}
.dg code{font-family:Consolas,ui-monospace,'Courier New',monospace;font-size:12px;color:#4A5663}
.ctl{list-style:none;display:flex;flex-direction:column;gap:10px}
.ctl li{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border-radius:10px;border:1px solid #E3DAC0;background:#FCFAF3}
.ctl .est{flex:none;width:30px;height:30px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px}
.ctl .cu{min-width:0;flex:1 1 0}
.ctl .t{font-weight:700;font-size:15px}
.ctl .d{font-size:14px;color:#4A5663;margin-top:2px}
.ctl .b{font-size:12px;font-weight:700;color:#4A5663;letter-spacing:.03em;text-transform:uppercase;margin-bottom:2px}
.honesta{border-left:5px solid #C9A227;background:#FFFFFF;border-radius:0 12px 12px 0;padding:12px 16px;font-size:14px;color:#1B2733;border-top:1px solid #E3DAC0;border-right:1px solid #E3DAC0;border-bottom:1px solid #E3DAC0}
.honesta b{color:#6B2D2D}
.honesta p+p{margin-top:6px}
.pie{display:flex;justify-content:space-between;gap:16px;border-top:3px solid #C9A227;padding-top:12px;font-size:13px;color:#4A5663}
.pie>div{min-width:0}
.pie>div:last-child{text-align:right}
.pie b{color:#6B2D2D}
.barra{display:flex;height:22px;border-radius:11px;overflow:hidden;border:1px solid #C9BFA0;background:#E6E9EC}
.barra div{height:100%}
.n-grande{font-size:40px;font-weight:800;line-height:1.1}
.n-grande small{font-size:20px;font-weight:600;color:#4A5663}
.cinta{display:flex;gap:2px;height:46px;align-items:stretch}
.cinta div{flex-basis:0;min-width:3px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:#3B2400}
.cinta .a{min-width:15px;background:#D9920B}
.cinta .c{background:#1B8A5A}
.cinta .n{background:#8A94A0}
.cinta-pk{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#4A5663;margin-top:6px}
.perfil-card .pf-resumen{font-size:15px;color:#1B2733;margin-bottom:6px}
.pf-eje{margin-top:14px}.pf-eje:first-of-type{margin-top:6px}
.pf-cab{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 12px;margin-bottom:4px}.pf-cab b{font-size:15px}.pf-cab span{font-size:13px;color:#4A5663}
.pf-nota{font-size:13px;color:#4A5663;margin-top:4px}
.ins-contorno{display:inline-block;margin:0 0 6px;padding:3px 12px;border:1.5px solid #6D3FC0;border-radius:999px;background:#EFE9FA;color:#3B1F78;font-size:13px;font-weight:600}
.ins-contorno.cuerda{border-style:dashed;border-color:#6B7785;background:#F3F4F6;color:#3F4852}
.alerta-pk{font-size:13px;color:#7A4A00;border-left:3px solid #D9920B;padding-left:8px;margin:4px 0}
.mapa-fila{display:flex;gap:18px;align-items:flex-start;margin-top:16px}
.mapa-izq{flex:1 1 0;min-width:0}.mapa-der{flex:0 0 340px;min-width:0;display:flex;flex-direction:column;gap:10px}
.fam{list-style:none;display:flex;flex-direction:column;gap:6px;font-size:14px}
.fam li{display:flex;align-items:center;gap:10px}.fam .sim{flex:none;display:inline-flex;width:20px;height:20px}.fam .fn{flex:1 1 0;min-width:0}.fam b{font-weight:800}
.datos-tramo{display:flex;flex-direction:column;gap:2px;font-size:14px}.datos-tramo b{font-weight:800}
.gr{padding:8px 0;border-top:1px solid #EEE7D2;font-size:15px}
.gr:first-of-type{border-top:0}
.gr b{font-weight:800}
.gr .f{font-size:20px;font-weight:800;color:#6D3FC0;background:#EFE8FB;border:2px dashed #6D3FC0;border-radius:8px;padding:2px 10px;display:inline-block;max-width:100%;margin-top:4px}
.gr .s{font-size:13px;color:#4A5663;margin-top:2px}
.atp{list-style:none;display:flex;flex-direction:column;gap:10px}
.atp li{display:flex;gap:14px;align-items:flex-start;padding:10px 14px;border-radius:10px;background:#FFF8E6;border:1px solid #E7C879}
.atp .g{flex:none;width:30px;height:30px;border-radius:50%;background:#D9920B;color:#3B2400;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:17px}
.atp .cu{min-width:0;flex:1 1 0}
.atp .o{font-weight:700;font-size:15px}
.atp .p{font-size:14px;color:#4A5663}
.atp .l{font-size:14px;margin-top:3px}
.atp .l .imp{font-weight:800;color:#6D3FC0}
.mas{font-size:14px;font-weight:700;color:#7A4A00;margin-top:10px}
.vacio{font-size:15px;color:#4A5663}
`;

function insignia(estado: EstadoComp): string {
    const e = ESTADO[estado];
    return `<span class="insignia" style="color:${e.tinta};background:${e.fondo};border-color:${e.borde}"><i aria-hidden="true">${e.glifo}</i>${esc(e.etiqueta)}</span>`;
}

export function cabecera(ctx: ContextoComprobacion, kicker: string, titulo: string, sub: string): string {
    const logo = ctx.logo ? `<img src="${esc(ctx.logo)}" alt="SRL Unidad Conchos">` : '';
    return `<div class="cab">${logo}<div class="cab-t"><div class="kick">${esc(kicker)}</div><h1>${esc(titulo)}</h1><div class="sub">${esc(sub)}</div></div></div>`;
}

export function pie(ctx: ContextoComprobacion, queValores: string): string {
    return `<div class="pie"><div><b>SICA 005 · SRL Unidad Conchos</b><br>${esc(queValores)}</div><div>Generado el ${esc(fechaLarga(ctx.fecha))}</div></div>`;
}

export function documento(cuerpo: string): string {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Comprobación por tramo</title><style>${CSS}</style></head><body><div class="pag">${cuerpo}</div></body></html>`;
}

export function notaHonestidad(atipicos: boolean, inferencia = false): string {
    return `<div class="honesta"><p><b>Cómo leer esta imagen.</b> ${esc(NOTA_HONESTIDAD)}</p>${atipicos ? `<p>${esc(NOTA_CONFIRMAR)}</p>` : ''}${inferencia ? `<p>${esc(NOTA_150_INFERENCIA)} Pendiente de confirmar con la SRL.</p>` : ''}</div>`;
}

export function token(t: TokenEc): string {
    if (t.origen === 'operador') return `<span class="op">${esc(t.simbolo ?? '')}</span>`;
    return `<div class="dato ${t.origen}"><b>${esc(cifra(t.valor))}${t.unidad ? ` <small>${esc(t.unidad)}</small>` : ''}</b><span>${esc(txt(t.etiqueta))}</span></div>`;
}

function claveOrigen(c: Comprobacion): string {
    const presentes = CLAVE_ORIGEN.filter((k) => c.ecuacion.some((t) => t.origen === k.o));
    if (presentes.length === 0) return '';
    return `<div class="clave">${presentes.map((k) => `<div><i class="${k.o}"></i>${esc(k.o === 'inventario' && esCamino(c) ? 'Dimensión del camino (inventario)' : k.texto)}</div>`).join('')}</div>`;
}

function ecuacion(c: Comprobacion): string {
    if (c.ecuacion.length === 0) return '';
    return `<div class="card"><h2>La cuenta, dato por dato</h2><div class="cuenta">${c.ecuacion.map(token).join('')}<span class="op">=</span><div class="res"><b>${esc(cifra(c.recalculado))}${c.unidad ? ` <small>${esc(c.unidad)}</small>` : ''}</b><span>según el criterio del libro</span></div></div>${claveOrigen(c)}</div>`;
}

function marcaLeyenda(i: ItemLeyenda): string {
    return `<li><i class="m-${i.muestra}"></i><span>${esc(i.texto)}</span></li>`;
}

function dibujo(c: Comprobacion): string {
    if (!c.diagrama) return `<div class="sin-dib">Para este concepto no hay dibujo de sección: la cantidad depende solo de la longitud o del ancho de la obra.</div>`;
    if (c.diagrama.familia === 'camino') {
        const svgC = seccionCaminoSvg(c.diagrama, PALETA_INFOGRAFIA, { idPatron: 'inf-trama', estilo: 'display:block;width:100%;height:auto' });
        if (svgC === null) return `<div class="sin-dib">Falta el ancho de la carpeta en el inventario (IO3): S/D, no se puede dibujar.</div>`;
        const leyC = leyendaSeccion(c.diagrama).map(marcaLeyenda).join('');
        return `<div class="dib">${svgC}<ul class="ley">${leyC}<li class="nota"><span>${esc(NOTA_CAMINO_ILUSTRATIVO)}</span></li></ul></div>`;
    }
    const svg = seccionCanalSvg(c.diagrama, PALETA_INFOGRAFIA, { idPatron: 'inf-hierba', estilo: 'display:block;width:100%;height:auto' });
    if (svg === null) return `<div class="sin-dib">Faltan datos de la sección en el inventario (plantilla, talud, tirante o libre bordo): S/D, no se puede dibujar.</div>`;
    const ley = leyendaSeccion(c.diagrama).map(marcaLeyenda).join('');
    return `<div class="dib">${svg}<ul class="ley">${ley}<li class="nota"><span>Escala vertical exagerada ×${EXAGERACION_VERTICAL}; el terreno fuera del hombro es ilustrativo.</span></li></ul></div>`;
}

function bloquePacot(c: Comprobacion): string {
    const p = c.parametroLibre;
    if (!p) return `<div class="pac"><h2>Lo que fija el PacOT</h2><p>Este concepto no tiene un parámetro que fije el PacOT en esta cuenta.</p></div>`;
    const implicito = p.implicito;
    const difiere = c.estadoCriterio === 'atipico' && implicito !== null && implicito !== p.valor;
    const grupo = c.grupo === 'todos' ? 'todos los tramos' : c.grupo;
    let aviso = '';
    if (difiere) aviso = `<p class="aviso">El libro implica ${esc(p.nombre.toLowerCase())} de <b>${esc(cifra(implicito))} ${esc(p.unidad)}</b> donde el resto usa <b>${esc(cifra(p.valor))} ${esc(p.unidad)}</b>.</p>`;
    else if (c.estadoCriterio === 'atipico' && implicito === null) aviso = `<p class="aviso">En este tramo el valor implícito de ${esc(p.nombre.toLowerCase())} es S/D: no se puede calcular con los datos del libro.</p>`;
    return `<div class="pac"><h2>Lo que fija el PacOT</h2><div class="nom">${esc(p.nombre)}</div><div class="val">${esc(cifra(p.valor))} <small>${esc(p.unidad)}</small></div><p>Criterio del libro (${esc(grupo)}): <b>${esc(txt(c.criterio))}</b></p>${aviso}</div>`;
}

function bloqueDatos(c: Comprobacion, origen: OrigenEntrada): string {
    const items: EntradaComp[] = c.entradas.filter((e) => e.origen === origen);
    if (items.length === 0) return '';
    const filas = items.map((e) => `<li><span>${esc(e.etiqueta)}${e.ref !== null ? `<code>${esc(e.ref)}</code>` : ''}</span><b>${esc(cifra(e.valor))} <small>${esc(e.unidad)}</small></b></li>`).join('');
    return `<div class="dg ${origen}"><h3>${esc(tituloOrigen(c, origen))}</h3><ul>${filas}</ul></div>`;
}

function controles(c: Comprobacion): string {
    if (c.controles.length === 0) return '';
    const li = c.controles.map((k) => {
        const e = k.estado === 'atipico' ? ESTADO.atipico : k.estado === 'cuadra' ? ESTADO.cuadra : ESTADO.no_evaluable;
        const glifo = k.estado === 'informativo' ? 'i' : e.glifo;
        return `<li><div class="est" style="color:${e.tinta};background:${e.fondo};border-color:${e.borde}">${esc(glifo)}</div><div class="cu"><div class="b">${esc(TEXTO_BASE[k.base])}</div><div class="t">${esc(k.titulo)}</div><div class="d">${esc(k.detalle)}</div></div></li>`;
    }).join('');
    return `<div class="card"><h2>Controles adicionales</h2><ul class="ctl">${li}</ul></div>`;
}

const CLAVE_ESTADOS = '<div class="clave"><div><i style="border-top-color:#1B8A5A"></i>Sigue el criterio</div><div><i style="border-top-color:#D9920B"></i>! Atípico (con trama)</div><div><i style="border-top-color:#8A94A0"></i>No evaluable (borde discontinuo)</div></div>';

/** Perfil del canal de la infografía del concepto: los tramos por estado y sus obras por familia, más el mini-mapa del canal. */
function perfilConcepto(m: ModeloCanal): string {
    const sinLugar = m.ejes.reduce((n, e) => n + e.fueraDeTramos.length + e.sinPK.length, 0);
    const resumen = `${m.nTramos} ${m.nTramos === 1 ? 'tramo' : 'tramos'}`
        + (m.v4 && m.cifrasConfiables && m.nEstructuras + m.nEdificios > 0 ? ` · ${m.nEstructuras} estructuras${m.nEdificios > 0 ? ` y ${m.nEdificios} edificios` : ''} del inventario` : '')
        + (m.v4 && !m.cifrasConfiables ? ' · estructuras y edificios: cifra no verificada (S/D)' : '')
        + (m.nEstimadas > 0 ? ` · ${m.nEstimadas} con posición estimada` : '')
        + (sinLugar > 0 ? ` · ${sinLugar} sin lugar en el perfil` : '');
    const aviso = m.avisos.length > 0 ? `<p class="pf-nota">${esc(m.avisos.join(' '))}</p>` : '';
    const mapa = miniMapaCanalSvg(m, { ancho: 340, alto: 330 });
    const fam = m.cifrasConfiables ? leyendaFamiliasHtml(m) : '';
    const lado = mapa === '' && fam === '' ? '' : `<div class="mapa-fila">${mapa === '' ? '' : `<div class="mapa-der">${mapa}</div>`}<div class="mapa-izq">${fam === '' ? '' : `<h2>Familias de estructuras</h2>${fam}`}<p class="pf-nota">${esc(TEXTO_UBICACION_DECLARADA)}</p></div></div>`;
    return `<div class="card perfil-card" data-n-tramos="${m.nTramos}" data-n-estructuras="${m.nEstructuras}" data-n-edificios="${m.nEdificios}" data-n-sin-lugar="${sinLugar}"><h2>Recorrido del canal</h2><div class="pf-resumen">${esc(resumen)}</div>${aviso}${perfilesHtml(m, { ancho: 960, prefijo: 'pc' })}${CLAVE_ESTADOS}${lado}</div>`;
}

/** Dónde está el tramo de la infografía A: mapa del tramo con sus obras y el canal completo como referencia. */
function ubicacionTramo(c: Comprobacion, m: ModeloCanal | null | undefined): string {
    // Los caminos no tienen perfil de estructuras ni ubicación en el libro: no se inventan.
    if (c.red === 'caminos' || !m || !m.v4) return '';
    const eje = m.ejes.find((e) => e.tramos.some((t) => t.fila === c.fila));
    const t = eje?.tramos.find((x) => x.fila === c.fila);
    if (!eje || !t || eje.ramal === null) return '';
    const obras = obrasEnTramo(eje, t);
    const nEst = obras.filter((o) => o.estado === 'estimada').length, nSin = obras.filter((o) => o.estado === 'sin_ubicar').length;
    const cuentaObras = m.cifrasConfiables
        ? `${obras.length} ${obras.length === 1 ? 'obra' : 'obras'} del inventario en el tramo${nEst > 0 ? `, ${nEst} con posición estimada` : ''}${nSin > 0 ? `, ${nSin} sin ubicar` : ''}`
        : 'Obras del inventario: cifra no verificada (S/D)';
    const datos = `<div class="datos-tramo"><span><b>${esc(etiquetaPk(t.pkInicial))} → ${esc(etiquetaPk(t.pkFinal))}</b></span><span>${esc(t.longitudKm.toFixed(2))} km · ${esc(eje.titulo)}</span><span>${esc(cuentaObras)}</span></div>`;
    const r = miniMapaTramoSvg(m, eje, t, { ancho: 560, alto: 360 });
    const fam = leyendaFamiliasHtml(m, conteoPorClave(obras));
    const loc = miniMapaCanalSvg(m, { ancho: 340, alto: 250, fila: t.fila });
    const izq = r === null
        ? `<p class="vacio">Este tramo no tiene coordenadas utilizables en el inventario (S/D): no se puede dibujar su mapa.</p>`
        : `<div class="ins-contorno ${r.contorno === 'real' ? 'real' : 'cuerda'}">${esc(r.insignia.texto)}</div>${r.avisos.map((a) => `<p class="alerta-pk">${esc(a)}</p>`).join('')}${r.svg}`;
    const notaEst = nEst > 0 ? ` Símbolo punteado = ${TEXTO_POSICION_ESTIMADA}.` : '';
    return `<div class="card perfil-card" data-n-obras-tramo="${obras.length}"><h2>Dónde está el tramo</h2><div class="mapa-fila" style="margin-top:0"><div class="mapa-izq">${izq}</div><div class="mapa-der">${loc}${datos}${m.cifrasConfiables ? fam : ''}</div></div><p class="pf-nota">${esc(TEXTO_UBICACION_DECLARADA + notaEst)}</p></div>`;
}

/** Infografía A: cómo se calculó un tramo. */
export function htmlInfografiaTramo(c: Comprobacion, ctx: ContextoComprobacion): string {
    const hayDif = c.diferencia !== null && Number.isFinite(Number(c.diferencia)) && Number(c.diferencia) !== 0;
    const porControl = c.estado === 'atipico' && c.estadoCriterio === 'cuadra';
    const aviso = c.modelo === null
        ? `<div class="honesta"><p>${c.motivo ? esc(c.motivo) : `Ningún criterio explica a la mayoría de los tramos de este grupo (${esc(txt(c.grupo))}); no se comprueba el tramo ni se marcan atípicos.`}</p></div>`
        : c.recalculado === null ? `<div class="honesta"><p>Faltan datos en el inventario o en DIAG-01 para recalcular este tramo: la cifra según el criterio es S/D.</p></div>` : '';
    const cifras = `<div class="cifras">
<div class="cifra"><div class="e">Cifra en DIAG-01</div><div class="v">${esc(cifra(c.enLibro))} <small>${esc(c.unidad)}</small></div></div>
<div class="cifra"><div class="e">Según el criterio del libro</div><div class="v">${esc(cifra(c.recalculado))} <small>${esc(c.unidad)}</small></div></div>
<div class="cifra dif${hayDif ? ' hay' : ''}"><div class="e">Diferencia</div><div class="v">${esc(cifra(c.diferencia))} <small>${esc(c.unidad)}</small></div></div></div>
<div class="fila-estado">${insignia(c.estado)}${porControl ? '<span class="sub">Sigue el criterio, pero un control adicional lo marca.</span>' : ''}</div>`;
    const datos = (['inventario', 'diagnostico', 'constante'] as const).map((o) => bloqueDatos(c, o)).join('');
    const cuerpoGrid = c.recalculado === null ? '' : `<div class="card"><div class="grid"><div class="col-dib">${dibujo(c)}</div><div class="col-dat">${bloquePacot(c)}${datos}</div></div></div>`;
    const cuerpo = [
        cabecera(ctx, 'SICA Conservación · DIAG-01', `${txt(c.obra)}: ${txt(c.pkInicial)} → ${txt(c.pkFinal)}`, `${nombreConcepto(c.concepto, { red: c.red }).canonico} · fila ${c.fila} de DIAG-01 · inventario ${txt(c.inventario)}`),
        cifras,
        aviso,
        ubicacionTramo(c, ctx.canal),
        c.recalculado === null ? '' : ecuacion(c),
        cuerpoGrid,
        controles(c),
        notaHonestidad(c.estado === 'atipico', c.inferencia === true),
        pie(ctx, 'Los valores son los guardados en el libro (DIAG-01 y fichas de inventario del PacOT).'),
    ].join('');
    return documento(cuerpo);
}

function atipicoLi(a: AtipicoResumen): string {
    let lectura: string;
    if (a.parametro && !a.porControl) {
        const impl = a.parametro.implicito === null ? 'S/D' : `${cifra(a.parametro.implicito)} ${a.parametro.unidad}`;
        lectura = `${esc(a.parametro.nombre)}: valor implícito <span class="imp">${esc(impl)}</span> frente a <b>${esc(cifra(a.parametro.criterio))} ${esc(a.parametro.unidad)}</b> del criterio`;
    } else if (a.porControl) {
        lectura = 'Sigue el criterio del libro, pero un control adicional lo marca';
    } else {
        lectura = 'Valor implícito del parámetro: S/D';
    }
    return `<li><div class="g">!</div><div class="cu"><div class="o">${esc(txt(a.obra))}</div><div class="p">${esc(txt(a.pkInicial))} → ${esc(txt(a.pkFinal))} · fila ${a.fila}</div><div class="l">Cifra del libro: <b>${esc(a.enLibro)} ${esc(a.unidad)}</b> · ${lectura}</div></div></li>`;
}

/** Infografía B: resumen de un concepto en todo el canal. */
export function htmlInfografiaConcepto(d: DatosConcepto, ctx: ContextoComprobacion): string {
    const pctSigue = d.total > 0 ? Math.max(0, Math.min(100, (d.siguen / d.total) * 100)) : 0;
    const sigue = d.total > 0
        ? `<div class="n-grande">${esc(d.siguen)} <small>de ${esc(d.total)} tramos siguen el criterio del libro</small></div><div class="barra" style="margin-top:10px"><div style="width:${pctSigue.toFixed(1)}%;background:#1B8A5A"></div></div>`
        : `<div class="n-grande"><small>S/D: no hay tramos con datos para comprobar</small></div>`;
    const notaSinDatos = d.nSinDatos > 0 ? `<p class="sub" style="margin-top:8px">${esc(d.nSinDatos)} tramos sin ficha de inventario o sin cifra no se pueden comprobar y no aparecen.</p>` : '';
    const chipAtip = d.nAtipicos > 0
        ? `<span class="insignia" style="color:${ESTADO.atipico.tinta};background:${ESTADO.atipico.fondo};border-color:${ESTADO.atipico.borde}"><i aria-hidden="true">!</i>${esc(d.nAtipicos)} ${d.nAtipicos === 1 ? 'tramo atípico' : 'tramos atípicos'}</span>`
        : `<span class="sub">Ningún tramo marcado como atípico.</span>`;
    const tarjetaSigue = `<div class="card"><h2>Cuántos tramos siguen el criterio</h2>${sigue}<div class="fila-estado">${chipAtip}</div>${notaSinDatos}</div>`;

    const celdas = d.cinta.map((x) => {
        const cl = x.estado === 'atipico' ? 'a' : x.estado === 'cuadra' ? 'c' : 'n';
        return `<div class="${cl}" style="flex-grow:${x.longitud.toFixed(3)}">${x.estado === 'atipico' ? '!' : ''}</div>`;
    }).join('');
    const cinta = d.canal && d.canal.ejes.length > 0 && (d.redTipo === 'distribucion' || d.redTipo === 'tuberia') ? perfilConcepto(d.canal) : d.cinta.length === 0 ? '' : `<div class="card"><h2>${d.redTipo === 'caminos' ? 'Recorrido del camino' : d.redTipo === 'drenaje' ? 'Recorrido del dren' : 'Recorrido del canal'}</h2><div class="cinta">${celdas}</div><div class="cinta-pk"><span>${d.nObras > 1 ? '' : esc(txt(d.pkIni))}</span><span>El ancho de cada tramo es proporcional a su longitud${d.nObras > 1 ? `; ${esc(d.nObras)} obras, cada una con su propio cadenamiento` : ''}</span><span>${d.nObras > 1 ? '' : esc(txt(d.pkFin))}</span></div><div class="clave"><div><i style="border-top-color:#1B8A5A"></i>Sigue el criterio</div><div><i style="border-top-color:#D9920B"></i>! Atípico</div><div><i style="border-top-color:#8A94A0"></i>No evaluable</div></div></div>`;

    const grupos = d.grupos.length === 0
        ? '<p class="vacio">S/D: no se infirió ningún criterio.</p>'
        : d.grupos.map((g) => `<div class="gr"><b>${esc(g.clave)}</b>${g.sinCriterio ? `<div class="s">${esc(g.motivo ?? 'Ningún criterio explica a la mayoría de los tramos de este grupo.')}</div>` : `<div><span class="f">${esc(txt(g.formula))}</span></div><div class="s">${esc(g.siguen)} de ${esc(g.n)} tramos de este grupo lo siguen</div>`}</div>`).join('');
    const param = `<div class="card"><h2>Parámetro del criterio que fija el PacOT</h2>${grupos}</div>`;

    const atip = d.atipicos.length === 0 ? '' : `<div class="card"><h2>Tramos atípicos: candidatos a revisión</h2><ul class="atp">${d.atipicos.map(atipicoLi).join('')}</ul>${d.masAtipicos > 0 ? `<div class="mas">+${d.masAtipicos} más en la app</div>` : ''}</div>`;

    const cuerpo = [
        cabecera(ctx, 'SICA Conservación · DIAG-01', nombreConcepto(d.concepto, { red: d.redTipo }).canonico, `${txt(d.red)} · PacOT ${txt(d.ambito)}`),
        tarjetaSigue,
        cinta,
        param,
        atip,
        notaHonestidad(d.nAtipicos > 0, d.grupos.some((g) => g.inferencia)),
        pie(ctx, 'Los valores son los guardados en el libro (DIAG-01 y fichas de inventario del PacOT).'),
    ].join('');
    return documento(cuerpo);
}
