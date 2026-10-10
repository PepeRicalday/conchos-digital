/**
 * infografiaPieza — infografías de «Obras puntuales» (modelo por-pieza) con la MISMA plantilla que las de tramo y concepto:
 * fondo claro, ancho 1080, CSS en línea, sin JS ni fuentes web. Se alimentan de `ComprobacionPieza` y `vistaDeGrupo`, los mismos que la
 * pantalla, así que cuentan lo mismo. S/D nunca cero; jamás NaN/undefined/null; nunca «correcto».
 */
import type { ComprobacionPieza, CuentaPieza, GrupoPieza, GrupoSel, PiezaListada } from '../conservacion/verificacion/porPieza';
import { vistaDeGrupo } from '../conservacion/verificacion/porPieza';
import type { EstadoComp, TokenEc } from '../conservacion/verificacion/comprobacion';
import { formatoPK } from '../conservacion/vocabulario';
import { TEXTO_BASE, fmt } from '../components/conservacion/derivacion/fmt';
import { simboloClave } from '../components/conservacion/derivacion/simbolos';
import { CSS, ESTADO, cabecera, cifra, esc, pie, token, txt } from './infografiaComprobacionHtml';
import { slug, type ContextoComprobacion } from './infografiaComprobacion';

export const TOPE_PIEZAS_GRUPO = 22;

export const nombreArchivoPieza = (c: ComprobacionPieza, fecha: string): string => `comprobacion-obras-${slug(c.nombre)}-${fecha}.png`;
export const nombreArchivoGrupoPieza = (c: ComprobacionPieza, rotulo: string, fecha: string): string => `comprobacion-obras-${slug(c.nombre)}-grupo-${slug(rotulo)}-${fecha}.png`;

const CSS_PIEZA = `
.pz-fam{list-style:none;display:flex;flex-direction:column;gap:8px}
.pz-fam li{display:grid;grid-template-columns:30px 230px 1fr 90px;gap:12px;align-items:center;font-size:15px}
.pz-fam .sim{display:inline-flex;width:26px;height:26px}
.pz-fam .nm{font-weight:700}
.pz-fam .nm small{display:block;font-weight:400;font-size:13px;color:#4A5663}
.pz-fam .bar{height:14px;border-radius:7px;background:#E6E9EC;overflow:hidden;border:1px solid #C9BFA0}
.pz-fam .bar div{height:100%;background:#1C5E95}
.pz-fam .ct{text-align:right;font-weight:800}
.pz-fam .ct small{font-weight:400;font-size:13px;color:#4A5663}
.pz-tipos{margin-top:12px;font-size:14px;color:#1B2733;border-top:1px solid #EEE7D2;padding-top:8px}
.pz-tipos b{font-weight:800}
.pz-edif{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pz-edif>div{border:1px solid #E3DAC0;border-radius:12px;padding:12px 14px;background:#FCFAF3;display:flex;flex-direction:column;gap:3px;min-width:0}
.pz-edif .t{font-size:16px;font-weight:800;display:flex;gap:10px;align-items:center}
.pz-edif .c{font-size:13px;color:#4A5663}
.pz-edif .d{font-size:14px}
.pz-tab{width:100%;border-collapse:collapse;font-size:14px}
.pz-tab th{text-align:left;font-size:13px;color:#4A5663;border-bottom:2px solid #C9A227;padding:4px 8px}
.pz-tab td{padding:5px 8px;border-top:1px solid #EEE7D2;vertical-align:middle}
.pz-tab td.sm{width:34px}
.pz-tab code{font-family:Consolas,ui-monospace,'Courier New',monospace;font-size:13px}
.pz-tab .est{font-size:12px;color:#7A4A00}
.pz-nota{font-size:14px;color:#4A5663;margin-top:8px}
.pz-lib{margin-top:8px;font-size:14px;color:#4A5663;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.pz-cuenta+.pz-cuenta{margin-top:16px;border-top:1px solid #EEE7D2;padding-top:12px}
.pz-cuenta h3{font-size:15px;font-weight:800;margin-bottom:8px}
`;

const documentoPieza = (cuerpo: string): string => `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Obras puntuales</title><style>${CSS}${CSS_PIEZA}</style></head><body><div class="pag">${cuerpo}</div></body></html>`;

const ETIQUETA_ESTADO: Readonly<Record<EstadoComp, string>> = { cuadra: 'Coherente con el inventario', atipico: 'Atípico: candidato a revisión', no_evaluable: 'No evaluable' };

function insigniaPieza(estado: EstadoComp, etiqueta = ETIQUETA_ESTADO[estado]): string {
    const e = ESTADO[estado];
    return `<span class="insignia" style="color:${e.tinta};background:${e.fondo};border-color:${e.borde}"><i aria-hidden="true">${e.glifo}</i>${esc(etiqueta)}</span>`;
}

function claveOrigenPieza(esEdif: boolean): string {
    const items = [
        { o: 'inventario', t: `Inventario (${esEdif ? 'IO7' : 'IO4'})` }, { o: 'diagnostico', t: 'Dato de 3DN' }, { o: 'parametro_libre', t: 'Lo que fija el PacOT' },
    ];
    return `<div class="clave">${items.map((k) => `<div><i class="${k.o}"></i>${esc(k.t)}</div>`).join('')}</div>`;
}

function cuentaHtml(cu: CuentaPieza, unidad: string): string {
    const e = ESTADO[cu.estado === 'cuadra' ? 'cuadra' : cu.estado === 'atipico' ? 'atipico' : 'no_evaluable'];
    const res = cu.id === 'importe' ? '$' : unidad;
    return `<div class="pz-cuenta"><h3>${esc(cu.titulo)}</h3><div class="cuenta">${cu.tokens.map((t: TokenEc) => token(t)).join('')}<span class="op">=</span><div class="res"><b>${esc(cifra(cu.resultado))} <small>${esc(res)}</small></b><span>${cu.id === 'cantidad' ? 'según el inventario' : 'recalculado'}</span></div></div>`
        + `<div class="pz-lib"><span class="insignia" style="color:${e.tinta};background:${e.fondo};border-color:${e.borde}"><i aria-hidden="true">${e.glifo}</i>${cu.estado === 'cuadra' ? 'Coincide' : cu.estado === 'atipico' ? 'Difiere' : 'Sin cifra'}</span><span>El libro trae <b>${esc(cifra(cu.enLibro))} ${esc(res)}</b>${cu.refLibro ? ` · ${esc(cu.refLibro)}` : ''}</span></div></div>`;
}

function desagregacion(c: ComprobacionPieza): string {
    if (c.grupos.length === 0) return '';
    const total = c.totalPiezas ?? 0;
    const filas = c.grupos.map((g: GrupoPieza) => {
        const pct = total > 0 ? (g.n / total) * 100 : 0;
        const amb = g.ambiguas > 0 ? ` · ${g.ambiguas} de tipo ambiguo` : '';
        const nombres = g.porTipo.map((t) => `${t.nombre} ${t.n}`).join(' · ');
        return `<li><span class="sim">${simboloClave(g.clave, { tamano: 26 })}</span><span class="nm">${esc(g.rotulo)}<small>${esc(nombres)}${esc(amb)}</small></span><div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div><span class="ct">${g.n} <small>${pct.toLocaleString('es-MX', { maximumFractionDigits: 1 })} %</small></span></li>`;
    }).join('');
    const titulo = c.gruposSeleccionables ? 'Desagregación por familia del catálogo' : 'Base de la proporción: estructuras del inventario';
    const nota = c.gruposSeleccionables
        ? 'Lo ambiguo conserva su subtipo crudo y lo sin clasificar cuenta en el total sin repartirse: nada se reclasifica en silencio.'
        : 'Solo el número de estructuras que sirve de base. IO4 no dice cuáles tienen compuerta: las compuertas no se reparten entre las familias.';
    return `<div class="card"><h2>${esc(titulo)}</h2><ul class="pz-fam">${filas}</ul><p class="pz-nota">${esc(nota)}</p></div>`;
}

function edificiosHtml(c: ComprobacionPieza): string {
    const piezas = c.grupos.flatMap((g) => g.piezas);
    if (c.kind !== 'edificios' || piezas.length === 0) return '';
    const fichas = piezas.map((p) => `<div><div class="t"><span class="sim">${simboloClave('edificacion', { tamano: 26 })}</span>${esc(p.nombre)}</div><div class="c">${esc(txt(p.inventario))} · ${esc(txt(p.caracteristicas))}</div>`
        + `<div class="d">Uso: ${esc(txt(p.uso))}</div><div class="d">Ubicación: ${esc(txt(p.pkTexto))}${p.pk ? ` (${esc(formatoPK(p.pk))})` : ' (sin cadenamiento)'}</div>`
        + `<div class="d">Coordenadas: ${esc(txt(p.latTexto))} · ${esc(txt(p.lonTexto))}</div><div class="d">Área del predio (IO7): ${p.areaPredioM2 === null ? 'S/D' : `${esc(fmt(String(p.areaPredioM2), 0))} m²`}</div></div>`).join('');
    return `<div class="card"><h2>Ficha de cada edificio</h2><div class="pz-edif">${fichas}</div><p class="pz-nota">La ubicación es la declarada por el PacOT; no acredita la posición física.</p></div>`;
}

function controlesHtml(c: ComprobacionPieza): string {
    if (c.controles.length === 0) return '';
    const li = c.controles.map((k) => {
        const e = k.estado === 'atipico' ? ESTADO.atipico : k.estado === 'cuadra' ? ESTADO.cuadra : ESTADO.no_evaluable;
        const glifo = k.estado === 'informativo' ? 'i' : e.glifo;
        return `<li><div class="est" style="color:${e.tinta};background:${e.fondo};border-color:${e.borde}">${esc(glifo)}</div><div class="cu"><div class="b">${esc(TEXTO_BASE[k.base])}</div><div class="t">${esc(k.titulo)}</div><div class="d">${esc(k.detalle)}</div></div></li>`;
    }).join('');
    return `<div class="card"><h2>Controles</h2><ul class="ctl">${li}</ul></div>`;
}

function honestidad(c: ComprobacionPieza, extra = ''): string {
    const comp = c.kind === 'compuertas' ? '<p>Las compuertas son una proporción declarada por el libro, no reconstruible por estructura: IO4 no dice cuáles estructuras tienen compuerta y no se reparten.</p>' : '';
    return `<div class="honesta"><p><b>Cómo leer esta imagen.</b> Esto no es una verificación normativa. «Coherente» solo significa que la cantidad del libro coincide con el inventario de su propio PacOT; «atípico» es un candidato a revisión, no un error confirmado. La ubicación es la declarada por el PacOT; no acredita la posición física. DIAG-02 no se lee todavía.</p>${comp}${extra}</div>`;
}

/** Infografía del concepto de obras puntuales: cifra del libro contra la reconstruida, las cuentas, la desagregación y la honestidad. */
export function htmlInfografiaPiezaConcepto(c: ComprobacionPieza, ctx: ContextoComprobacion): string {
    const hayDif = c.diferencia !== null && Number(c.diferencia) !== 0;
    const esEdif = c.kind === 'edificios';
    const fuente = c.reconstruida === null ? 'Reconstruida desde el inventario' : `Reconstruida desde ${esEdif ? 'IO7' : 'IO4'}`;
    const cifras = `<div class="cifras">
<div class="cifra"><div class="e">Cifra en 3DN</div><div class="v">${esc(cifra(c.trabajo))} <small>${esc(c.unidad)}</small></div></div>
<div class="cifra"><div class="e">${esc(fuente)}</div><div class="v">${esc(cifra(c.reconstruida))} <small>${esc(c.unidad)}</small></div></div>
<div class="cifra dif${hayDif ? ' hay' : ''}"><div class="e">Diferencia</div><div class="v">${esc(cifra(c.diferencia))} <small>${esc(c.unidad)}</small></div></div></div>
<div class="fila-estado">${insigniaPieza(c.estado)}${c.estado === 'atipico' && c.estadoCantidad === 'cuadra' ? '<span class="sub">La cantidad coincide con el inventario, pero una cuenta aritmética del libro no cuadra.</span>' : ''}</div>`;
    const motivo = c.motivo && c.estadoCantidad === 'no_evaluable' ? `<div class="honesta"><p>${esc(c.motivo)}</p></div>` : '';
    const cuentas = c.cuentas.length === 0 ? '' : `<div class="card"><h2>Las cuentas, dato por dato</h2>${c.cuentas.map((cu) => cuentaHtml(cu, c.unidad)).join('')}${claveOrigenPieza(esEdif)}</div>`;
    const cuerpo = [
        cabecera(ctx, 'SICA Conservación · 3DN · Obras puntuales', c.nombre, `${txt(ctx.red)} · PacOT ${txt(ctx.ambito)} · fila ${c.fila} de 3DN`),
        cifras, motivo, cuentas, desagregacion(c), edificiosHtml(c), controlesHtml(c), honestidad(c),
        pie(ctx, 'Los valores son los guardados en el libro (3DN y fichas de inventario IO4/IO7 del PacOT).'),
    ].join('');
    return documentoPieza(cuerpo);
}

function filaPieza(p: PiezaListada, edif: boolean): string {
    const ub = p.ubicacion === 'valida' ? 'declarada' : p.ubicacion === 'estimada' ? '<span class="est">posición estimada</span>' : '<span class="est">sin ubicar</span>';
    const nombre = edif ? `${esc(p.nombre)}<br><small>${esc(txt(p.inventario))}</small>` : `${esc(p.tipo)}${p.ambiguo ? ' <small>(ambiguo)</small>' : ''}<br><small>${esc(p.nombre)}</small>`;
    return `<tr><td class="sm">${simboloClave(p.clave, { tamano: 22, punteado: p.ubicacion === 'estimada' })}</td><td>${nombre}</td><td>${esc(txt(edif ? p.uso : p.material))}</td><td><code>${esc(formatoPK(p.pk))}</code></td><td>${ub}</td></tr>`;
}

/** Infografía de un grupo (familia, tipo o todo el concepto) de obras puntuales, con su lista y su parte proporcional rotulada como reparto. */
export function htmlInfografiaPiezaGrupo(c: ComprobacionPieza, sel: GrupoSel, ctx: ContextoComprobacion): string {
    const v = vistaDeGrupo(c, sel);
    const edif = c.kind === 'edificios';
    const pct = v.fraccion === null ? null : v.fraccion * 100;
    const grande = `<div class="card"><div class="n-grande">${esc(v.n)} <small>de ${esc(c.totalPiezas ?? 'S/D')} ${esc(c.unidad)}${pct === null ? '' : ` · ${esc(pct.toLocaleString('es-MX', { maximumFractionDigits: 1 }))} %`} del inventario</small></div>`
        + (pct === null ? '' : `<div class="barra" style="margin-top:10px"><div style="width:${pct.toFixed(1)}%;background:#1C5E95"></div></div>`)
        + (v.id !== 'todo' && v.necesidadProporcional !== null && v.importeProporcional !== null
            ? `<p class="pz-nota">Parte proporcional de la necesidad anual: <b>${esc(fmt(v.necesidadProporcional, 3))} ${esc(c.unidad)}</b> · del importe: <b>$ ${esc(fmt(v.importeProporcional, 2))}</b>. Es un reparto proporcional de la cifra del libro, no una cifra del libro.</p>` : '')
        + `<div class="fila-estado">${insigniaPieza(c.estado)}<span class="sub">Estado del concepto completo: ${esc(c.estado === 'cuadra' ? 'la cantidad coincide con el inventario' : c.estado === 'atipico' ? 'candidato a revisión' : 'no evaluable')}.</span></div></div>`;
    const piezas = v.piezas.slice(0, TOPE_PIEZAS_GRUPO);
    const mas = v.piezas.length - piezas.length;
    const tabla = edif || piezas.length === 0 ? '' : `<div class="card"><h2>${edif ? 'Edificios de IO7' : 'Estructuras de IO4'}</h2><table class="pz-tab"><thead><tr><th></th><th>${edif ? 'Edificio' : 'Tipo y nombre en IO4'}</th><th>${edif ? 'Uso' : 'Material'}</th><th>Cadenamiento</th><th>Ubicación</th></tr></thead><tbody>${piezas.map((p) => filaPieza(p, edif)).join('')}</tbody></table>${mas > 0 ? `<div class="mas">+${mas} más en la app</div>` : ''}</div>`;
    const cuerpo = [
        cabecera(ctx, 'SICA Conservación · 3DN · Obras puntuales', `${c.nombre}: ${v.rotulo}`, `${txt(ctx.red)} · PacOT ${txt(ctx.ambito)} · fila ${c.fila} de 3DN`),
        grande, tabla, edif ? edificiosHtml({ ...c, grupos: c.grupos.map((g) => ({ ...g, piezas: v.piezas })) }) : '', honestidad(c),
        pie(ctx, 'Los valores son los guardados en el libro (3DN y fichas de inventario IO4/IO7 del PacOT).'),
    ].join('');
    return documentoPieza(cuerpo);
}
