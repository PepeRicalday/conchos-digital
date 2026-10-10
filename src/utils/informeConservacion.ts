/**
 * Informe imprimible de SICA Conservación (HTML Carta). Puro: recibe el archivo de informe y los logos ya como data URI,
 * devuelve un documento autónomo. Todo texto que viene del PacOT o del informe pasa por esc().
 */
import type { ArchivoInforme } from '../conservacion/informe/esquemaInforme';
import {
    contarPor, filasReglas, hallazgosPlanos, resumenReglas, etiquetaEstadoRegla, TEXTO_ORIGEN, TEXTO_SEVERIDAD, totalPendientes, type FilaRegla, type HallazgoVista,
} from '../conservacion/informe/vistas';
import { cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, folioInforme, pieInforme } from './informeBase';

export interface OpcionesInformeConservacion {
    /** Logo de la SRL con fondo transparente (marrón), como data URI. */
    readonly logoSrl: string;
    readonly logoSica?: string;
}

const FILAS_HALLAZGOS = 30;
const FILAS_REGLAS = 38;
const FILAS_PENDIENTES = 20;

const CSS_EXTRA = `
.sev{display:inline-block;padding:0 6px;border-radius:3px;font-size:7.5pt;font-weight:700;border:1px solid var(--linea);white-space:nowrap}
.sev-alta{background:#fdecec;border-color:#e0a4a4;color:#8a1f1f}
.sev-media{background:#fff3d9;border-color:#e3c98a;color:#7a4b00}
.sev-informativa{background:#e8f1fb;border-color:#a9c4e4;color:#0b4f8a}
td.id,td .id{font-family:Consolas,ui-monospace,monospace;font-size:7.5pt;overflow-wrap:anywhere}
td{vertical-align:top;overflow-wrap:anywhere}
.cobertura{display:flex;gap:10px;align-items:baseline;margin:6px 0}
.sec-nota{font-size:8pt;color:var(--ink2);margin:4px 0 8px}
`;

function paginar<T>(items: readonly T[], tam: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += tam) out.push(items.slice(i, i + tam));
    return out.length > 0 ? out : [[]];
}

const sev = (s: HallazgoVista['severidad']) => `<span class="sev sev-${s}">${esc(TEXTO_SEVERIDAD[s])}</span>`;

function tablaHallazgos(hs: readonly HallazgoVista[]): string {
    return `<div class="tabla-wrap"><table>
<thead><tr><th>Regla</th><th>Severidad</th><th>Hallazgo</th><th>Celdas</th><th class="n">Esperado</th><th class="n">Observado</th></tr></thead>
<tbody>${hs.map((h) => `<tr>
<td class="id">${esc(h.reglaId)}</td><td>${sev(h.severidad)}</td>
<td><b>${esc(h.titulo)}</b><div class="fuente">${esc(TEXTO_ORIGEN[h.origen] ?? h.origen)}</div></td>
<td class="id">${esc(h.referencias.slice(0, 3).join(', '))}${h.referencias.length > 3 ? esc(` +${h.referencias.length - 3}`) : ''}</td>
<td class="n">${esc(h.esperado ?? '—')}</td><td class="n">${esc(h.observado ?? '—')}</td></tr>`).join('')}</tbody></table></div>`;
}

function tablaReglas(fs: readonly FilaRegla[]): string {
    return `<div class="tabla-wrap"><table>
<thead><tr><th>Regla</th><th>Clase</th><th>Descripción</th><th>Estado</th><th class="n">Cobertura</th><th class="n">Hallazgos</th></tr></thead>
<tbody>${fs.map((f) => `<tr><td class="id">${esc(f.id)}</td><td>${esc(f.clase)}</td><td>${esc(f.regla)}</td>
<td>${esc(etiquetaEstadoRegla(f.estado))}</td>
<td class="n">${f.cobertura ? esc(`${f.cobertura.revisados} / ${f.cobertura.identificados}`) : '<span class="sd">S/D</span>'}</td>
<td class="n">${f.cobertura ? f.nHallazgos : '<span class="sd">S/D</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}

export function generarHtmlInformeConservacion(a: ArchivoInforme, o: OpcionesInformeConservacion): string {
    const hs = hallazgosPlanos(a);
    const fr = filasReglas(a);
    const rr = resumenReglas(fr);
    const r = a.informe.resumen;
    const fecha = new Date(a.generadoEn);
    const folio = folioInforme('SCONS', Number.isNaN(fecha.getTime()) ? new Date(0) : fecha);
    const nom = a.origen.moduloNombre ?? 'Módulo sin nombre';
    const cab = cabeceraInforme({
        logoSrl: o.logoSrl, ...(o.logoSica ? { logoSica: o.logoSica } : {}), titulo: 'Comprobación del programa de conservación',
        meta: [
            { k: 'Módulo', v: `${nom}${a.origen.moduloId ? ` (${a.origen.moduloId})` : ''}` },
            { k: 'Ciclo', v: a.origen.ciclo ?? 's/d' },
            { k: 'Folio', v: folio },
            { k: 'Emitido', v: Number.isNaN(fecha.getTime()) ? a.generadoEn : fechaHoraLegible(fecha) },
        ],
    });

    const paginas: string[] = [];

    // 1 · Resumen
    const porClase = contarPor(hs, (h) => h.clase);
    const porOrigen = contarPor(hs, (h) => TEXTO_ORIGEN[h.origen] ?? h.origen);
    paginas.push(`<h1>Informe de comprobación del programa de conservación</h1>
<p class="fuente">Archivo analizado: ${esc(a.origen.archivoNombre)}${a.origen.archivoSha256 ? ` · SHA-256 ${esc(a.origen.archivoSha256.slice(0, 16))}…` : ''} · Motor ${esc(a.informe.versionMotor)} · Valores ${a.informe.baseValores === 'cache' ? 'guardados en el archivo (caché)' : esc(a.informe.baseValores)}</p>
<div class="aviso"><b>Alcance y límites.</b> Se evaluaron ${rr.implementadas} de ${rr.total} reglas de la matriz norma → regla → prueba; ${rr.noImplementadas} aún no están implementadas. Que no aparezcan hallazgos no es aprobación del programa. La aritmética que coincide no acredita la condición física de las obras. El Manual de Conservación 2026 prevalece sobre los Anexos.</div>
<div class="kpis">
<div class="kpi"><div class="et">Hallazgos</div><div class="v">${r.hallazgos}</div><div class="s">en ${rr.conHallazgos} reglas</div></div>
<div class="kpi"><div class="et">Severidad alta</div><div class="v">${r.alta}</div><div class="s">cantidades, importes o cadena de cálculo</div></div>
<div class="kpi"><div class="et">Severidad media</div><div class="v">${r.media}</div><div class="s">a aclarar o sustentar</div></div>
<div class="kpi"><div class="et">Informativas</div><div class="v">${r.informativa}</div><div class="s">notas de la norma y capturas menores</div></div>
</div>
<div class="cols">
<div><h3>Hallazgos por clase</h3><div class="tabla-wrap"><table><thead><tr><th>Clase</th><th class="n">Hallazgos</th></tr></thead><tbody>${porClase.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n">${n}</td></tr>`).join('')}</tbody></table></div></div>
<div><h3>Quién origina el hallazgo</h3><div class="tabla-wrap"><table><thead><tr><th>Origen</th><th class="n">Hallazgos</th></tr></thead><tbody>${porOrigen.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n">${n}</td></tr>`).join('')}</tbody></table></div>
<p class="sec-nota">${totalPendientes(a)} pendientes declarados: cosas que el motor no pudo comprobar con este archivo.</p></div>
</div>`);

    // 2 · Hallazgos
    const bloquesH = paginar(hs, FILAS_HALLAZGOS);
    bloquesH.forEach((b, i) => paginas.push(`<h2><span class="n">${i + 2}</span>Hallazgos${bloquesH.length > 1 ? ` (${i + 1} de ${bloquesH.length})` : ''}</h2>
${b.length === 0 ? '<p class="sd">Sin hallazgos en las reglas evaluadas.</p>' : tablaHallazgos(b)}`));

    // 3 · Reglas
    const bloquesR = paginar(fr, FILAS_REGLAS);
    bloquesR.forEach((b, i) => paginas.push(`<h2>Estado de las ${rr.total} reglas${bloquesR.length > 1 ? ` (${i + 1} de ${bloquesR.length})` : ''}</h2>
${i === 0 ? `<p class="sec-nota">Una regla "no implementada" no se evaluó. "Sin datos" significa que este libro no trae la información que la regla necesita (por ejemplo, análisis de precios o seguimiento).</p>` : ''}
${tablaReglas(b)}`));

    // 4 · Parámetros y pendientes
    const pend = fr.flatMap((f) => f.pendientes.map((p) => ({ regla: f.id, texto: p })));
    const bloquesP = paginar(pend, FILAS_PENDIENTES);
    paginas.push(`<h2>Parámetros declarados</h2>
<p class="sec-nota">Los valores alternos de los Anexos son una nota informativa, no un error del PacOT.</p>
<div class="tabla-wrap"><table><thead><tr><th>ID</th><th>Parámetro</th><th>Valor usado</th><th>Fuente</th><th>Alternos</th></tr></thead><tbody>${a.informe.declaracionParametros.map((p) => `<tr>
<td class="id">${esc(p.id)}</td><td>${esc(p.nombre)}</td><td class="id">${esc(p.valor)}</td><td>${esc(`${p.fuente.documento} ${p.fuente.seccion}`)}</td><td>${p.alternos.length ? esc(p.alternos.join('; ')) : '—'}</td></tr>`).join('')}</tbody></table></div>`);
    bloquesP.forEach((b, i) => paginas.push(`<h2>Pendientes declarados${bloquesP.length > 1 ? ` (${i + 1} de ${bloquesP.length})` : ''}</h2>
${b.length === 0 ? '<p class="sd">Ninguno.</p>' : `<div class="tabla-wrap"><table><thead><tr><th>Regla</th><th>Lo que no se pudo comprobar</th></tr></thead><tbody>${b.map((p) => `<tr><td class="id">${esc(p.regla)}</td><td>${esc(p.texto)}</td></tr>`).join('')}</tbody></table></div>`}`));

    const total = paginas.length;
    const cuerpo = paginas.map((p, i) => `<section class="pagina">${cab}<main>${p}</main>${pieInforme(`SICA Conservación · ${folio}`, i + 1, total)}</section>`).join('\n');
    return documentoHtml({ titulo: `Informe SICA Conservación ${folio}`, css: cssInforme() + CSS_EXTRA, cuerpo });
}
