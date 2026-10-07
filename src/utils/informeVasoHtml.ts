// INFORME DEL VASO — documento HTML (capa pura): (datos, logos) → string. Sin script propio; imprimible Carta/A4.
import { cabeceraInforme, cssInforme, documentoHtml, esc, fechaHoraLegible, folioInforme, pieInforme } from './informeBase';
import { UMBRAL_BAJO_PCT, UMBRAL_CRITICO_PCT } from './presaNiveles';
import type { InformeVaso, SeccionVaso } from './informeVasoDatos';
import { UMBRAL_DESVIO_PCT } from './informeVasoDatos';
import { interanualSvg } from './informeVasoInteranual';
import { comparativoSvg, contextoSvg, galeriaSvg, tendenciaSvg } from './informeVasoSvg';

export interface LogosVaso { srl: string; sica: string }

const SD = 'S/D';
const n = (v: number | null | undefined, d = 1) => (v != null && isFinite(v) ? v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }) : SD);
const fecha = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' }) : SD);
const mesLargo = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' });
/** Cambio con flecha y signo en tinta neutra (el sentido no depende del color). */
const cambio = (v: number | null, u: string, d = 1) => (v == null ? SD : `${v > 0.05 ? '▲' : v < -0.05 ? '▼' : '■'} ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)} ${u}`);

const EXTRA_CSS = `
.run{display:flex;justify-content:space-between;gap:10px;font-size:7.5pt;color:var(--ink2);border-bottom:2px solid var(--inst);padding-bottom:5px;margin-bottom:10px}
.cuerpo{display:flex;flex-direction:column;gap:10px;min-width:0}
.nota-pie{font-size:7.5pt;color:var(--ink2)}
.estado{display:grid;grid-template-columns:1.1fr 2fr;gap:10px;align-items:stretch}
.pct{border:1px solid var(--linea);border-top:4px solid var(--inst);border-radius:4px;padding:8px 10px}
.pct .v{font:700 30pt/1 Georgia,serif}.pct .v small{font-size:13pt;color:var(--ink2)}
.barra{position:relative;height:12px;background:#ece9e2;border-radius:6px;margin:8px 0 3px;overflow:hidden}
.barra i{display:block;height:100%;background:var(--inst)}
.barra b{position:absolute;top:0;bottom:0;width:2px;background:#1f2328}
.barra-pie{display:flex;justify-content:space-between;font-size:7.5pt;color:var(--ink2)}
.kpis.tres{grid-template-columns:repeat(3,1fr);margin:0}
.kpis.cuatro{grid-template-columns:repeat(4,1fr)}
.kpi .v{font-size:17pt}
.galeria{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.mini{margin:0;border:1px solid var(--linea);border-radius:4px;overflow:hidden;break-inside:avoid}
.mini svg{display:block;width:100%;height:auto}
.mini figcaption{display:flex;justify-content:space-between;gap:4px;padding:3px 6px;font-size:7.5pt}
.fig svg{display:block;width:100%;height:auto;border:1px solid var(--linea);border-radius:4px}
.leyenda{display:flex;gap:16px;flex-wrap:wrap;font-size:7.5pt;color:var(--ink2);margin-top:4px}
.leyenda i{display:inline-block;width:14px;height:8px;margin-right:5px;vertical-align:middle}
.l-dash{border-top:2px dashed #57606a}.l-fill{background:var(--inst);opacity:.7}
.ctx{position:relative;border:1px solid var(--linea);border-radius:4px;overflow:hidden}
.ctx img{display:block;width:100%;height:auto}
.ctx svg{position:absolute;inset:0;width:100%;height:100%}
ul.hallazgos{margin:0;padding-left:16px}ul.hallazgos li{margin-bottom:3px}
.chip.est{border-color:var(--inst);color:var(--inst)}
.cal{border-left:5px solid var(--aviso)}
@media screen and (max-width:720px){.estado{grid-template-columns:1fr}.galeria{grid-template-columns:repeat(2,1fr)}.kpis.cuatro,.kpis.tres{grid-template-columns:1fr 1fr}}
@media print{.estado{grid-template-columns:1.1fr 2fr}.galeria{grid-template-columns:repeat(4,1fr)}}
`;

const ETIQUETA_PROC: Record<string, string> = { CAMPO: 'Lectura de campo', CILA: 'CILA/USIBWC', ESTIMADA: 'Elevación estimada' };

export function construirHtmlVaso(d: InformeVaso, logos: LogosVaso): string {
    const sec = new Set<SeccionVaso>(d.config.secciones);
    const folio = folioInforme(d.folioPrefijo, d.ahora);
    const periodo = d.primero && d.ultimo ? `${fecha(d.primero.fecha_escena)} – ${fecha(d.ultimo.fecha_escena)}` : SD;
    const est = d.estado;
    const hojas: string[] = [];
    let nSec = 0;
    const nombreMayus = esc(d.nombrePresa.toUpperCase());

    const sinTendencia = d.escenas.length < 2;
    const avisoUna = `<div class="aviso"><b>Sin serie suficiente:</b> con una sola escena en el periodo no se puede mostrar este análisis.</div>`;

    // ── Hoja 1: resumen y estado actual ──
    const resumen = () => {
        const pct = est.pct != null ? Math.min(100, Math.max(0, est.pct)) : null;
        const avisos = d.avisos.length
            ? d.avisos.map((a) => `<div class="aviso">${esc(a.texto)}</div>`).join('')
            : '<p class="fuente">Sin observaciones de calidad: la serie del periodo no presenta huecos, nubosidad alta ni desviaciones relevantes.</p>';
        return `<h2><span class="n">${++nSec}</span>Estado actual y resumen ejecutivo</h2>
<div class="estado">
  <div class="pct"><div class="et fuente">Llenado ${est.fechaLectura ? `· lectura ${esc(fecha(est.fechaLectura))}` : ''}</div>
    <div class="v">${est.pct != null ? est.pct.toFixed(1) : SD}${est.pct != null ? '<small> %</small>' : ''}</div>
    <div class="barra" role="img" aria-label="Llenado ${est.pct != null ? est.pct.toFixed(1) + ' por ciento' : 'sin dato'}">${pct != null ? `<i style="width:${pct}%"></i>` : ''}<b style="left:${UMBRAL_CRITICO_PCT}%"></b><b style="left:${UMBRAL_BAJO_PCT}%"></b></div>
    <div class="barra-pie"><span>0</span><span>${UMBRAL_CRITICO_PCT} crítico</span><span>${UMBRAL_BAJO_PCT} bajo</span><span>100 %</span></div>
    <p style="margin-top:6px"><span class="chip est">${esc(est.estadoEmbalse.etiqueta)}</span></p></div>
  <div class="kpis tres">
    <div class="kpi"><div class="et">Volumen</div><div class="v">${n(est.volumen)}</div><div class="s">Mm³ ${est.capacidad != null ? `de ${n(est.capacidad)} al NAMO` : ''}</div></div>
    <div class="kpi"><div class="et">Nivel</div><div class="v">${n(est.nivel, 2)}</div><div class="s">msnm · ${esc(est.procedencia ? ETIQUETA_PROC[est.procedencia] ?? est.procedencia : 'sin lectura')}</div></div>
    <div class="kpi"><div class="et">${est.deficit != null && est.deficit < 0 ? 'Sobre el NAMO' : 'Déficit bajo el NAMO'}</div><div class="v">${est.deficit != null ? n(Math.abs(est.deficit), 2) : SD}</div><div class="s">m ${est.namo != null ? `· NAMO ${n(est.namo, 2)}` : ''}</div></div>
  </div></div>
<h3>Superficie del espejo de agua (Sentinel-2 · NDWI) — ${esc(periodo)}</h3>
<div class="kpis cuatro">
  <div class="kpi"><div class="et">Más reciente</div><div class="v">${n(d.ultimo?.area_km2)}</div><div class="s">km² · ${esc(fecha(d.ultimo?.fecha_escena))}</div></div>
  <div class="kpi"><div class="et">Cambio en el periodo</div><div class="v" style="font-size:13pt">${esc(cambio(d.deltaArea, 'km²'))}</div><div class="s">${sinTendencia ? 'requiere ≥ 2 escenas' : 'primera → última'}</div></div>
  <div class="kpi"><div class="et">Máxima / mínima</div><div class="v" style="font-size:13pt">${n(d.areaMax)} / ${n(d.areaMin)}</div><div class="s">km² en el periodo</div></div>
  <div class="kpi"><div class="et">Perímetro</div><div class="v">${n(d.ultimo?.perimetro_km, 0)}</div><div class="s">km · ${esc(cambio(d.deltaPerimetro, 'km', 0))}</div></div>
</div>
<h3>Hallazgos</h3><ul class="hallazgos">${d.hallazgos.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
<div class="cal"><h3>Calidad del dato</h3>${avisos}</div>`;
    };

    // ── Hoja 2: polígonos ──
    const mapa = () => `<h2><span class="n">${++nSec}</span>Evolución del polígono del vaso</h2>
<figure class="fig" style="margin:0">${galeriaSvg(d.escenas)}<figcaption class="fuente">Una imagen por escena, mismo encuadre para comparar el tamaño relativo.</figcaption></figure>
<h3>Primera escena vs. más reciente del periodo</h3>
${d.primero && d.ultimo && d.primero !== d.ultimo ? `<figure class="fig" style="margin:0">${comparativoSvg(d.primero, d.ultimo)}</figure>` : avisoUna}`;

    // ── Hoja 3: relieve y contexto ──
    const relieve = () => {
        const img = d.imagenRelieve ? `<figure class="fig" style="margin:0"><div class="ctx"><img src="${esc(d.imagenRelieve)}" alt="Relieve tridimensional del vaso"></div>
<figcaption class="fuente">Terreno real (Copernicus DEM GLO-30) con sombreado analítico e imagen Sentinel-2. La exageración vertical es solo visual y no altera ninguna elevación.</figcaption></figure>` : '';
        let ctx = '';
        if (d.textura && d.ultimo) {
            const g = contextoSvg(d.ultimo, d.textura.bbox);
            ctx = `<figure class="fig" style="margin:0"><div class="ctx"><img src="${esc(d.textura.urlPublica)}" alt="Imagen satelital del vaso">
<svg viewBox="0 0 ${g.w} ${g.h}" aria-hidden="true"><path d="${g.path}" fill="rgba(34,211,238,.14)" stroke="#0e9bb5" stroke-width="2" fill-rule="evenodd"/></svg></div>
<figcaption class="fuente">Contorno NDWI del ${esc(fecha(d.ultimo.fecha_escena))} sobre imagen del ${esc(fecha(d.textura.fechaEscena))}.</figcaption></figure>`;
        }
        return `<h2><span class="n">${++nSec}</span>Relieve y contexto satelital</h2>${img ? `<h3>Relieve 3D</h3>${img}` : ''}${ctx ? `<h3>Contexto satelital</h3>${ctx}` : ''}
${!img && !ctx ? '<div class="aviso"><b>No disponible:</b> esta presa no tiene modelo de relieve ni imagen de contexto cargados.</div>' : ''}`;
    };

    // ── Hoja 4: tendencia y detalle ──
    const tendencia = () => `<h2><span class="n">${++nSec}</span>Tendencia de área y perímetro</h2><figure class="fig" style="margin:0">${tendenciaSvg(d.escenas)}</figure>`;
    const tabla = () => {
        const filas = d.escenas.map((e, i) => {
            const prev = i > 0 ? d.escenas[i - 1] : null;
            return `<tr><td><b>${esc(mesLargo(e.fecha_escena))}</b></td><td class="n">${n(e.area_km2)}</td><td class="n">${n(e.perimetro_km, 0)}</td>
<td class="n">${prev ? esc(cambio(e.area_km2 - prev.area_km2, 'km²')) : SD}</td><td class="n">${e.num_islas}</td><td class="n">${e.nubosidad_pct != null ? n(e.nubosidad_pct) + ' %' : SD}</td>
<td class="n">${e.pct_del_maximo_ciclo != null ? n(e.pct_del_maximo_ciclo, 0) + ' %' : SD}</td></tr>`;
        }).join('');
        return `<h3>Detalle por escena</h3><div class="tabla-wrap"><table><thead><tr><th>Mes</th><th class="n">Área (km²)</th><th class="n">Perímetro (km)</th><th class="n">Δ vs. escena anterior</th><th class="n">Islas</th><th class="n">Nubes</th><th class="n">% del máximo</th></tr></thead><tbody>${filas || `<tr><td colspan="7" class="sd">Sin escenas</td></tr>`}</tbody></table></div>
<p class="fuente">Área neta (bancos expuestos excluidos) vía NDWI de Sentinel-2. Un mes ausente significa que no hubo escena confiable; nunca se registra como cero.</p>`;
    };

    // ── Comparativo interanual: mismo día en años anteriores (serie normalizada) ──
    const interanual = () => {
        const it = d.interanual;
        if (!it || it.filas.length === 0) return `<h2><span class="n">${++nSec}</span>Comparativo interanual</h2><div class="aviso">No hay histórico comparable para la fecha de la lectura vigente.</div>`;
        const fechaTxt = `${String(it.dia).padStart(2, '0')}/${String(it.mes).padStart(2, '0')}`;
        const filas = it.filas.map((f) => `<tr><td><b>${f.anio}</b></td><td>${esc(fecha(f.fecha))}${f.desfaseDias ? ` (${f.desfaseDias > 0 ? '+' : '−'}${Math.abs(f.desfaseDias)} d)` : ''}</td><td class="n">${n(f.volumen)}</td><td class="n">${n(f.elevacion, 2)}</td><td class="n">${f.pct != null ? n(f.pct) + ' %' : SD}</td><td class="n">${esc(cambio(f.difVolumen, 'Mm³'))}</td></tr>`).join('');
        const pos = it.posicion ? `Con ${n(it.volumenHoy)} Mm³, el ${fechaTxt} de ${it.anioRef} ocupa el lugar ${it.posicion.posicion} de ${it.posicion.de} (1 = el más bajo) entre los años con dato en esa fecha.` : 'Sin volumen vigente: no se puede ubicar el año en curso frente al histórico.';
        return `<h2><span class="n">${++nSec}</span>Comparativo interanual · mismo día (${fechaTxt})</h2><p>${esc(pos)}</p>
<figure class="fig" style="margin:0">${interanualSvg(it)}</figure>
<div class="tabla-wrap"><table><thead><tr><th>Año</th><th>Fecha usada</th><th class="n">Volumen (Mm³)</th><th class="n">Nivel (msnm)</th><th class="n">Llenado</th><th class="n">Hoy vs. ese año</th></tr></thead><tbody>${filas}</tbody></table></div>
<p class="fuente">Serie normalizada: volumen y % recalculados desde la escala con la curva vigente, para comparar años aunque la curva cambió (Boquilla sept-2021, Madero jul-2021). Si el día exacto no existe se usa el dato más cercano (±3 días) y se indica el desfase. Fuente: reportes mensuales SRL 2021-2025 y lecturas operativas.</p>`;
    };

    // ── Hoja 5: validación y metodología ──
    const validacion = () => {
        const v = d.validacion.filter((x) => !x.sinReferencia && x.pctCoincidencia != null);
        if (!v.length) return `<h2><span class="n">${++nSec}</span>Validación cruzada</h2><div class="aviso"><b>Sin referencia:</b> ninguna escena del periodo tiene una lectura de campo a 20 días o menos.</div>`;
        const filas = v.map((x) => {
            const desvio = Math.abs(x.pctCoincidencia! - 100);
            const marca = desvio <= 5 ? '✓ coincide' : desvio <= UMBRAL_DESVIO_PCT ? '△ revisar' : '✕ desvío alto';
            return `<tr><td><b>${esc(fecha(x.fecha_escena))}</b></td><td class="n">${n(x.areaSatelite)}</td><td class="n">${n(x.areaEsperadaKm2)}</td><td class="n">${n(x.pctCoincidencia, 0)} %</td><td>${marca}</td>
<td>${esc(fecha(x.fechaLectura))} (${x.diasDiferencia ?? 0} d)</td></tr>`;
        }).join('');
        return `<h2><span class="n">${++nSec}</span>Validación cruzada: satélite vs. curva oficial</h2><div class="tabla-wrap"><table><thead><tr><th>Escena</th><th class="n">Área satélite (km²)</th><th class="n">Área esperada (km²)</th><th class="n">Coincidencia</th><th>Resultado</th><th>Lectura de campo usada</th></tr></thead><tbody>${filas}</tbody></table></div>
<p class="fuente">Área esperada = interpolación de la curva elevación–área–capacidad en la escala de la lectura de campo más cercana (máx. 20 días). 100 % = coincidencia perfecta; se marca "revisar" arriba de 5 % y "desvío alto" arriba de ${UMBRAL_DESVIO_PCT} %.</p>`;
    };
    const metodologia = () => `<h3>Metodología y limitaciones</h3>
<p><b>Fuente.</b> Escenas Sentinel-2 L2A (Copernicus). El espejo de agua se detecta con NDWI a 20 m por píxel y se vectoriza (marching squares); el área excluye los bancos de tierra expuestos.</p>
<p><b>Limitaciones.</b> Las nubes y sombras pueden subestimar el contorno; la resolución de 20 m limita el perímetro en orillas muy irregulares; una escena representa un día, no el mes completo.</p>
<p><b>Cómo leer el estado.</b> El llenado, volumen y nivel provienen de la lectura oficial vigente (no del satélite). La superficie satelital es una verificación independiente: cuando difiere más de ${UMBRAL_DESVIO_PCT} % de la curva oficial, se debe confiar primero en la lectura de campo.</p>
<p class="fuente">Documento generado automáticamente por SICA-005. No sustituye los informes oficiales de CONAGUA/CILA.</p>`;

    // ── Armado: cada hoja lleva corrida, cuerpo y pie con "Pág. X de Y" ──
    const bloques: string[] = [];
    if (sec.has('resumen')) bloques.push(resumen());
    if (sec.has('mapa')) bloques.push(mapa());
    if (sec.has('relieve')) bloques.push(relieve());
    if (sec.has('tendencia') || sec.has('tabla')) bloques.push(`${sec.has('tendencia') ? (sinTendencia ? `<h2><span class="n">${++nSec}</span>Tendencia</h2>${avisoUna}` : tendencia()) : ''}${sec.has('tabla') ? tabla() : ''}`);
    if (sec.has('interanual')) bloques.push(interanual());
    if (sec.has('validacion') || sec.has('metodologia')) bloques.push(`${sec.has('validacion') ? validacion() : ''}${sec.has('metodologia') ? metodologia() : ''}`);
    const total = bloques.length;
    const pie = (i: number) => pieInforme(`Folio ${folio} · SICA-005 v${d.version}`, i + 1, total);
    bloques.forEach((b, i) => {
        const cab = i === 0
            ? cabeceraInforme({ logoSrl: logos.srl, logoSica: logos.sica, titulo: `Manejo de vaso · Presa ${d.nombrePresa}`, meta: [
                { k: 'Folio', v: folio }, { k: 'Emisión', v: fechaHoraLegible(d.ahora) }, { k: 'Emitió', v: d.emisor }, { k: 'Periodo', v: periodo }] })
            : `<div class="run"><span><b>S R L Unidad Conchos</b> · Manejo de vaso · ${esc(d.nombrePresa)}</span><span>${esc(folio)}</span></div>`;
        hojas.push(`<section class="pagina">${cab}<div class="cuerpo">${b}</div>${pie(i)}</section>`);
    });

    return documentoHtml({
        titulo: `Informe de manejo de vaso — Presa ${d.nombrePresa} — SRL Unidad Conchos`,
        css: cssInforme({ formato: d.config.hoja }) + EXTRA_CSS,
        cuerpo: hojas.join('\n') || `<section class="pagina"><div class="cuerpo"><h2>${nombreMayus}</h2><p class="sd">No se eligió ninguna sección.</p></div></section>`,
    });
}
