// ═══════════════════════════════════════════════════════════════════════════
// Informe de Pronóstico — HTML autónomo — SICA-005
// ---------------------------------------------------------------------------
// Sin JS, CSS en línea, imágenes como data URI: abre sin conexión, imprime a PDF
// (@media print) y se puede rasterizar. Estructura de lo ejecutivo a lo técnico:
//   1 veredicto · 2 decisiones por módulo · 3 ventanas de riesgo · 4 gráficas
//   5 contexto SICA · 6 alertas con procedencia · 7 confiabilidad · metodología.
// ═══════════════════════════════════════════════════════════════════════════
import { VIZ } from './climaCharts';
import { assetToDataURI } from './assetToDataURI';
import { guardaOComparte } from './descargaArchivo';
import { getTodayString } from './dateHelpers';
import {
    fmtDiaHora, fmtVentana, type DatosPronostico, type NivelRiesgo, type Riesgo,
} from './informePronosticoDatos';
import { COLOR_NIVEL, FONDO_NIVEL, ROTULO_NIVEL, graficaHoraria, lineaTiempoSvg, mapaDecisionSvg } from './informePronosticoSvg';

const SRL_MARRON = '#6B2D2D';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const m3 = (v: number | null) => (v == null ? 'S/D' : `${Math.round(v).toLocaleString('es-MX')} m³`);
const fix = (v: number | null, d = 1, u = '') => (v == null ? 'S/D' : `${v.toFixed(d)}${u ? ' ' + u : ''}`);

const insignia = (n: NivelRiesgo) =>
    `<span class="pill" style="color:${COLOR_NIVEL[n]};background:${FONDO_NIVEL[n]};border-color:${COLOR_NIVEL[n]}">${ROTULO_NIVEL[n]}</span>`;

function fmtEdad(min: number | null): string {
    if (min == null) return 'S/D';
    if (min < 90) return `${min} min`;
    return `${(min / 60).toFixed(1)} h`;
}

function umbralTexto(r: Riesgo): string {
    const op = r.comparador === 'mayor' ? '≥' : '≤';
    return `aviso ${op} ${r.aviso} · crítico ${op} ${r.critico} ${r.unidad}`;
}

export async function construyeInformePronosticoHTML(d: DatosPronostico): Promise<string> {
    const [logoSrl, logoSica] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'), assetToDataURI('/logos/SICA005.png'),
    ]);
    const tecnico = d.modoTecnico;
    const rV = d.riesgos.find(r => r.clave === 'viento');
    const rL = d.riesgos.find(r => r.clave === 'lluvia');
    const rH = d.riesgos.find(r => r.clave === 'helada');
    const rC = d.riesgos.find(r => r.clave === 'calor');

    // ── Gráficas ────────────────────────────────────────────────────────────
    const umbralesViento = rV ? [
        { valor: rV.aviso, etiqueta: `aviso ${rV.aviso}`, color: VIZ.estado.aviso },
        { valor: rV.critico, etiqueta: `crítico ${rV.critico}`, color: VIZ.estado.critico },
    ] : [];
    const umbralesTemp = [
        ...(rH ? [{ valor: rH.aviso, etiqueta: `helada ${rH.aviso}°`, color: VIZ.estado.aviso }] : []),
        ...(rC ? [{ valor: rC.aviso, etiqueta: `calor ${rC.aviso}°`, color: VIZ.estado.aviso }] : []),
    ];
    const gTemp = graficaHoraria({ titulo: 'Temperatura', unidad: '°C', bandas: d.bandas.temp, forma: 'linea', umbrales: umbralesTemp });
    const gLluvia = graficaHoraria({ titulo: 'Lluvia', unidad: 'mm/h', bandas: d.bandas.lluvia, forma: 'barras', decimales: 1 });
    const gViento = graficaHoraria({ titulo: 'Viento sostenido', unidad: 'm/s', bandas: d.bandas.viento, forma: 'linea', umbrales: umbralesViento, pisoEnCero: true });
    const gNub = tecnico ? graficaHoraria({ titulo: 'Nubosidad total', unidad: '%', bandas: d.bandas.nubosidad, forma: 'linea', pisoEnCero: true, decimales: 0 }) : '';
    const fig = (titulo: string, nota: string, svg: string) => svg
        ? `<figure class="fig"><figcaption><b>${esc(titulo)}</b><span>${nota}</span></figcaption>${svg}</figure>` : '';

    // ── Decisiones por módulo ───────────────────────────────────────────────
    const filasModulos = d.modulos.map(m => {
        const origen = m.propia
            ? `<span class="tag tag-propia">estación propia</span>`
            : `<span class="tag tag-est">estimado${m.distanciaKm != null ? ` · ${m.distanciaKm} km` : ''}</span>`;
        const acciones = m.decision.acciones.length
            ? `<ul>${m.decision.acciones.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : `<span class="muted">${esc(m.decision.resumen)}</span>`;
        return `<tr>
            <td><b>M${m.numero}</b></td>
            <td>${esc(m.estacion)}<br>${origen}</td>
            <td class="num">${fix(m.tMinC, 1)} / ${fix(m.tMaxC, 1)} °C</td>
            <td class="num">${fix(m.vientoMaxMs, 1, 'm/s')}</td>
            <td class="num">${fix(m.lluviaMax24hMm, 1, 'mm')}${m.probMaxPct != null ? `<br><small>prob. máx. ${m.probMaxPct} %</small>` : ''}</td>
            <td>${insignia(m.decision.nivel)}<div class="acciones">${acciones}</div></td>
        </tr>`;
    }).join('');

    // ── Riesgos ─────────────────────────────────────────────────────────────
    const filasRiesgos = d.riesgos.map(r => {
        const v = r.ventanas.slice(0, tecnico ? 4 : 2).map(w => `${esc(w.estacion)}: ${esc(fmtVentana(w.desdeMs, w.hastaMs))}`).join('<br>');
        return `<tr>
            <td><b>${esc(r.etiqueta)}</b>${tecnico ? `<br><small>${esc(r.definicion)}</small>` : ''}</td>
            <td class="num"><b>${r.valor != null ? `${r.valor.toFixed(1)} ${esc(r.unidad)}` : 'S/D'}</b>${r.estacion ? `<br><small>${esc(r.estacion)}</small>` : ''}</td>
            <td>${insignia(r.nivel)}</td>
            <td><small>${esc(umbralTexto(r))}</small></td>
            <td><small>${v || (r.cuandoMs ? esc(fmtDiaHora(r.cuandoMs)) : '—')}</small></td>
        </tr>`;
    }).join('');

    // ── Contexto SICA ───────────────────────────────────────────────────────
    const filasDemanda = d.modulos.map(m => `<tr>
        <td><b>M${m.numero}</b></td>
        <td class="num">${m.superficieHa != null ? m.superficieHa.toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' ha' : 'S/D'}</td>
        <td class="num">${m3(m.demandaM3)}</td>
        <td class="num">${m3(m.demandaConLluviaM3)}</td>
        <td class="num"><b>${m3(m.ahorroLluviaM3)}</b></td>
        <td class="num">${m3(m.entregadoHoyM3)}</td>
    </tr>`).join('');
    const ctx = d.contexto;
    const presa = ctx.presa
        ? `<li><b>${esc(ctx.presa.nombre)}</b>: ${ctx.presa.porcentaje != null ? `${ctx.presa.porcentaje.toFixed(1)} % de llenado` : 'llenado S/D'}${ctx.presa.almacenamientoMm3 != null ? ` (${ctx.presa.almacenamientoMm3.toFixed(1)} Mm³)` : ''}, extracción ${ctx.presa.extraccionM3s != null ? `${ctx.presa.extraccionM3s.toFixed(1)} m³/s` : 'S/D'}${ctx.presa.fecha ? ` · lectura ${esc(ctx.presa.fecha)}` : ''}.</li>` : '';
    const canal = ctx.canal
        ? `<li><b>Canal Principal</b>: K-0+000 ${ctx.canal.k0M3s != null ? `${ctx.canal.k0M3s.toFixed(1)} m³/s${ctx.canal.k0Fresca ? '' : ' (dato no fresco)'}` : 'S/D'} · K-104 ${ctx.canal.k104M3s != null ? `${ctx.canal.k104M3s.toFixed(1)} m³/s${ctx.canal.k104Fresca ? '' : ' (dato no fresco)'}` : 'S/D'}. Con lluvia prevista en los módulos, revisar el ajuste de entradas para no entregar de más.</li>` : '';

    // ── Alertas ─────────────────────────────────────────────────────────────
    const alertas = d.alertas.length
        ? d.alertas.map(a => `<div class="alerta"><b>${esc(a.titulo)}</b><p>${esc(a.mensaje)}</p>
            <small>Detectada: ${esc(fmtDiaHora(new Date(a.detectadaEn).getTime()))} (inicio del episodio; la alerta sigue vigente mientras se cumpla la condición)</small>
            ${a.aclaracion ? `<p class="aclara">${esc(a.aclaracion)}</p>` : ''}</div>`).join('')
        : '<p class="muted">Sin alertas agroclimáticas abiertas.</p>';

    // ── Confiabilidad ───────────────────────────────────────────────────────
    const filasEst = d.estaciones.map(s => `<tr>
        <td><b>${esc(s.nombre)}</b></td>
        <td>${esc(s.calidad)}${s.sospechosa ? ' · <b style="color:' + VIZ.estado.critico + '">sospechosa</b>' : ''}</td>
        <td class="num">${fmtEdad(s.edadLecturaMin)}</td>
        <td class="num">${fix(s.observado.tempC, 1, '°C')} · ${fix(s.observado.vientoMs, 1, 'm/s')} · ${fix(s.observado.lluviaDiaMm, 1, 'mm')}</td>
        <td class="num">${s.puntosPronostico} h</td>
        <td class="num">${fmtEdad(s.edadCorridaMin)}${s.corridaVieja ? ' ⚠' : ''}</td>
    </tr>`).join('');
    const avisos = d.avisosCalidad.length
        ? `<div class="avisos">${d.avisosCalidad.map(a => `<p>⚠ ${esc(a)}</p>`).join('')}</div>` : '';

    // ── Acierto del modelo ──────────────────────────────────────────────────
    const ver = d.verificacion;
    let bloqueVerif = '';
    if (ver) {
        const filasV = ver.variables.map(v => `<tr>
            <td><b>${v.variable === 'temperatura' ? 'Temperatura' : 'Viento'}</b></td><td>${esc(v.rango)}</td>
            <td class="num">${v.n.toLocaleString('es-MX')}</td>
            <td class="num"><b>±${v.mae.toFixed(1)} ${v.unidad}</b></td>
            <td class="num">${v.sesgo >= 0 ? '+' : ''}${v.sesgo.toFixed(1)} ${v.unidad} <small>(${v.sesgo > 0.3 ? 'el modelo sobrestima' : v.sesgo < -0.3 ? 'el modelo subestima' : 'sin sesgo claro'})</small></td>
        </tr>`).join('');
        const ll = ver.lluvia;
        const lluviaTxt = ll
            ? `<li><b>Lluvia (lámina diaria, ${ll.dias} estación-día)</b>: el modelo sumó ${ll.totalPronosticadoMm} mm y las estaciones registraron ${ll.totalObservadoMm} mm. `
                + `${ll.diasConLluviaObservada ? `Detectó (≥ 2.5 mm) ${ll.detectados} de ${ll.diasConLluviaObservada} días con lluvia observada ≥ 5 mm. ` : 'No hubo días con lluvia observada ≥ 5 mm en la ventana. '}`
                + `${ll.peor ? `Mayor falla: ${esc(ll.peor.estacion)}, ${esc(ll.peor.dia)} — pronosticó ${ll.peor.pronosticadoMm} mm y cayeron ${ll.peor.observadoMm} mm. ` : ''}`
                + `<em>La lluvia convectiva se acierta mal en lugar y cantidad: use el pronóstico para saber <b>si</b> puede llover, no cuánto en un punto.</em></li>`
            : '<li>Lluvia: sin días completos para comparar.</li>';
        bloqueVerif = `<h2>7 · Qué tanto acierta el modelo</h2>
<p class="sub2">Pronóstico contra la lectura de la estación más cercana en el tiempo (±60 min), últimos 14 días. El horizonte medido hasta hoy es el del último pronóstico antes de la hora (0–6 h): ${ver.corridasConservadas > 0 ? `ya se conservan ${ver.corridasConservadas} corrida(s) guardada(s) para medir también 7–24 h y 25–48 h conforme se acumulen (2 por día).` : 'las corridas de 7–24 h y 25–48 h empezarán a medirse cuando se acumulen corridas guardadas.'}</p>
${ver.variables.length ? `<table><thead><tr><th>Variable</th><th>Horizonte</th><th class="num">Comparaciones</th><th class="num">Error medio</th><th class="num">Sesgo</th></tr></thead><tbody>${filasV}</tbody></table>` : '<p class="muted">Aún no hay comparaciones suficientes de temperatura y viento.</p>'}
<ul style="font-size:12.5px;margin-top:10px">${lluviaTxt}${ver.estacionesExcluidas.length ? `<li>No se incluyen en este cálculo: ${esc(ver.estacionesExcluidas.join(', '))} (sensor sospechoso).</li>` : ''}</ul>`;
    }

    const fecha = new Date(d.generadoMs);
    const generado = fmtDiaHora(d.generadoMs);

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de Pronóstico — SRL Unidad Conchos — ${esc(getTodayString())}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f5f9; color: ${VIZ.inkPrimary}; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .hoja { max-width: 980px; margin: 0 auto; background: #fff; padding: 26px 30px 34px; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid ${SRL_MARRON}; padding-bottom: 14px; margin-bottom: 18px; }
  header img { height: 56px; width: auto; }
  header .titulo { flex: 1; text-align: center; }
  header .sub { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: ${SRL_MARRON}; font-weight: 700; }
  header h1 { margin: 2px 0; font-size: 22px; color: ${VIZ.inkPrimary}; }
  header .meta { font-size: 11.5px; color: ${VIZ.inkSecondary}; }
  h2 { font-size: 15px; margin: 26px 0 8px; color: ${SRL_MARRON}; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid ${VIZ.grid}; padding-bottom: 4px; }
  .sub2 { font-size: 12px; color: ${VIZ.inkMuted}; margin: -2px 0 10px; max-width: 80ch; }
  .veredicto { border-radius: 12px; padding: 16px 18px; border: 2px solid; margin-bottom: 12px; }
  .veredicto .eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .veredicto .titular { font-size: 19px; font-weight: 800; margin: 4px 0 8px; }
  .veredicto ul { margin: 0; padding-left: 20px; font-size: 13px; }
  .pill { display: inline-block; font-size: 10.5px; font-weight: 800; padding: 2px 9px; border-radius: 999px; border: 1px solid; letter-spacing: .04em; white-space: nowrap; }
  .avisos { border: 1px solid ${VIZ.estado.aviso}; background: #fffaf0; border-radius: 10px; padding: 8px 12px; font-size: 12.5px; margin-bottom: 12px; }
  .avisos p { margin: 3px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: ${VIZ.inkSecondary}; border-bottom: 2px solid ${VIZ.axis}; padding: 6px 8px; }
  td { border-bottom: 1px solid ${VIZ.grid}; padding: 7px 8px; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  small, .muted { color: ${VIZ.inkMuted}; font-size: 11.5px; }
  .tag { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; }
  .tag-propia { background: #dcfce7; color: #166534; }
  .tag-est { background: #fef3c7; color: #92400e; }
  .acciones ul { margin: 4px 0 0; padding-left: 16px; }
  .acciones li { margin: 2px 0; }
  .grid-mapa { display: grid; grid-template-columns: 250px 1fr; gap: 16px; align-items: start; }
  .fig { margin: 12px 0; border: 1px solid ${VIZ.grid}; border-radius: 12px; padding: 12px 14px; background: #fff; break-inside: avoid; }
  .fig figcaption b { display: block; font-size: 13.5px; }
  .fig figcaption span { display: block; font-size: 11.5px; color: ${VIZ.inkMuted}; margin-bottom: 4px; }
  .leyenda { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11.5px; color: ${VIZ.inkSecondary}; margin: 6px 0 0; }
  .leyenda i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; margin-right: 5px; }
  .alerta { border-left: 4px solid ${VIZ.estado.critico}; background: #fff7f7; border-radius: 6px; padding: 8px 12px; margin: 8px 0; }
  .alerta p { margin: 4px 0; font-size: 12.5px; }
  .alerta .aclara { background: #f8fafc; border-radius: 6px; padding: 6px 8px; color: ${VIZ.inkSecondary}; font-size: 12px; }
  details { border: 1px solid ${VIZ.grid}; border-radius: 10px; padding: 8px 12px; margin-top: 14px; }
  summary { cursor: pointer; font-weight: 700; color: ${SRL_MARRON}; }
  details p, details li { font-size: 12.5px; color: ${VIZ.inkSecondary}; }
  footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid ${VIZ.grid}; font-size: 11px; color: ${VIZ.inkMuted}; display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  @media (max-width: 720px) { .hoja { padding: 16px; } .grid-mapa { grid-template-columns: 1fr; } header { flex-wrap: wrap; } th, td { padding: 6px 4px; } }
  @media print {
    body { background: #fff; }
    .hoja { max-width: none; padding: 0; }
    @page { size: A4; margin: 12mm; }
    h2, .fig, .alerta, tr { break-inside: avoid; }
    details { display: block; }
    details > * { display: block; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head>
<body><div class="hoja">
<header>
  ${logoSica ? `<img src="${logoSica}" alt="SICA 005">` : ''}
  <div class="titulo">
    <div class="sub">S R L Unidad Conchos · Delicias, Chihuahua</div>
    <h1>Informe de Pronóstico — próximas ${d.horizonteH} h</h1>
    <div class="meta">Emitido ${esc(generado)} (hora de Chihuahua) · ${tecnico ? 'Nivel técnico' : 'Nivel operativo'} · modelo ${esc(d.modelo.proveedor)} ${esc(d.modelo.modelo)}${d.modelo.edadCorridaMin != null ? ` · corrida hace ${esc(fmtEdad(d.modelo.edadCorridaMin))}` : ''}</div>
  </div>
  ${logoSrl ? `<img src="${logoSrl}" alt="SRL Conchos">` : ''}
</header>

<div class="veredicto" style="border-color:${COLOR_NIVEL[d.nivel]};background:${FONDO_NIVEL[d.nivel]}">
  <div class="eyebrow" style="color:${COLOR_NIVEL[d.nivel]}">${ROTULO_NIVEL[d.nivel]} · ${esc(fmtDiaHora(d.desdeMs))} → ${esc(fmtDiaHora(d.hastaMs))}</div>
  <p class="titular">${esc(d.titular)}</p>
  ${d.puntosClave.length ? `<ul>${d.puntosClave.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
</div>
${avisos}

<h2>1 · Qué hacer en cada módulo</h2>
<p class="sub2">Decisión operativa por módulo según los umbrales vigentes de SICA (tabla clima_umbrales). Los módulos sin estación propia (2, 4 y 12) usan la estación más cercana y se rotulan como estimados.</p>
<div class="grid-mapa">
  <div>${mapaDecisionSvg(d.modulos)}</div>
  <div><table>
    <thead><tr><th>Mód.</th><th>Estación</th><th class="num">T mín / máx</th><th class="num">Viento máx.</th><th class="num">Lluvia 24 h</th><th>Decisión</th></tr></thead>
    <tbody>${filasModulos}</tbody>
  </table></div>
</div>

<h2>2 · Ventanas de riesgo</h2>
<p class="sub2">Cada celda es una hora. Franja gris = noche (20:00–07:00). Celdas con trama = sin pronóstico. Una fila vacía significa que no se alcanza ningún umbral de aviso. El valor de cada fila es el peor entre las estaciones de la red.</p>
<div class="fig">${lineaTiempoSvg(d.lineaTiempo, d.ejeHoras)}
  <div class="leyenda">
    <span><i style="background:${COLOR_NIVEL.aviso}"></i>▲ Aviso</span>
    <span><i style="background:${COLOR_NIVEL.critico}"></i>■ Crítico</span>
    <span><i style="background:${VIZ.nube[1]}"></i>Lluvia moderada (≥ 2.5 mm/h)</span>
    <span><i style="background:${VIZ.nube[3]}"></i>Lluvia fuerte (≥ 7.6 mm/h)</span>
    <span><i style="background:#cfe0f7"></i>Lluvia ligera</span>
  </div>
</div>
<table>
  <thead><tr><th>Riesgo</th><th class="num">Valor previsto</th><th>Nivel</th><th>Umbral (clima_umbrales)</th><th>Cuándo y dónde</th></tr></thead>
  <tbody>${filasRiesgos}</tbody>
</table>

<h2>3 · Gráficas del horizonte</h2>
<p class="sub2">Línea = media de las estaciones; banda = rango entre la estación más baja y la más alta. Todo es pronóstico del modelo; la línea "ahora" separa la hora de emisión.</p>
${fig('Temperatura', 'Media de la red (línea) y rango entre estaciones (banda). Líneas punteadas: umbrales de helada y calor.', gTemp)}
${fig('Lluvia', 'Barra oscura = media de la red; barra clara = estación más lluviosa de cada hora. mm por hora.', gLluvia)}
${fig('Viento sostenido', 'Velocidad media a 10 m (no incluye ráfagas). Líneas punteadas: aviso y crítico para aspersión.', gViento)}
${tecnico ? fig('Nubosidad total', 'Variable independiente de la lluvia: una hora nublada no implica lluvia ni al revés.', gNub) : ''}

<h2>4 · Contexto operativo de SICA</h2>
<p class="sub2">Demanda de las próximas 24 h con ETₒ del modelo × Kc de referencia (${(0.85).toFixed(2)}) ÷ eficiencia de aplicación (0.70); la lluvia efectiva (80 % de la lámina, solo si ≥ 5 mm) se descuenta de la demanda neta.</p>
<table>
  <thead><tr><th>Mód.</th><th class="num">Superficie</th><th class="num">Demanda 24 h</th><th class="num">Con la lluvia prevista</th><th class="num">Ahorro por lluvia</th><th class="num">Entregado hoy</th></tr></thead>
  <tbody>${filasDemanda}</tbody>
</table>
${(presa || canal) ? `<ul style="margin-top:10px;font-size:13px">${presa}${canal}</ul>` : ''}

<h2>5 · Alertas vigentes</h2>
${alertas}

<h2>6 · Confiabilidad de este informe</h2>
<p class="sub2">Lo observado (columna "Ahora") es de la estación; lo pronosticado es del modelo. S/D = sin dato confiable; nunca se sustituye por 0.</p>
<table>
  <thead><tr><th>Estación</th><th>Calidad</th><th class="num">Edad lectura</th><th class="num">Ahora (T · viento · lluvia día)</th><th class="num">Pronóstico</th><th class="num">Edad corrida</th></tr></thead>
  <tbody>${filasEst}</tbody>
</table>
${d.estacionesExcluidas.length ? `<div class="avisos" style="margin-top:10px">${d.estacionesExcluidas.map(x => `<p><b>${esc(x.nombre)}</b>: ${esc(x.motivo)}</p>`).join('')}</div>` : ''}

${bloqueVerif}

<details${tecnico ? ' open' : ''}><summary>Metodología, fuentes y límites</summary>
  <ul>
    <li><b>Pronóstico</b>: Open-Meteo (${esc(d.modelo.modelo)} = mejor modelo disponible para el punto, no un modelo único), una consulta por estación con su altitud, sincronizada cada hora. Resolución horaria, hasta 48 h.</li>
    <li><b>Observado</b>: estaciones WeatherLink; llegan aproximadamente cada 2 h, no en tiempo real.</li>
    <li><b>Umbrales</b>: tabla clima_umbrales de SICA (viento aviso ${rV?.aviso ?? '—'} / crítico ${rV?.critico ?? '—'} m/s; helada ≤ ${rH?.aviso ?? '—'} / ${rH?.critico ?? '—'} °C; calor ≥ ${rC?.aviso ?? '—'} / ${rC?.critico ?? '—'} °C; lluvia 24 h ≥ ${rL?.aviso ?? '—'} / ${rL?.critico ?? '—'} mm).</li>
    <li><b>Viento</b>: sostenido horario del modelo; las ráfagas pueden ser sensiblemente mayores y no se evalúan contra el umbral.</li>
    <li><b>Lluvia</b>: lámina horaria del modelo; el nivel de riesgo usa el mayor acumulado de cualquier ventana móvil de 24 h. La probabilidad de precipitación es del modelo, no una certeza.</li>
    <li><b>Módulos sin estación</b> (2, 4, 12): se usa la estación más cercana en línea recta al centro del módulo — es una estimación, no una medición.</li>
    <li><b>Límites</b>: el modelo tiene error creciente con el horizonte y puede errar la hora y el lugar de convección local; no sustituye la lectura de campo ni la vigilancia del canal.</li>
    <li>Cualquier valor fuera de rango físico (−25…48 °C, 0…50 m/s) o de una estación marcada sospechosa se presenta como S/D.</li>
  </ul>
</details>

<footer>
  <span>SICA 005 · Sistema Integral de Control y Alertas · SRL Unidad Conchos</span>
  <span>Generado ${esc(fecha.toLocaleString('es-MX', { timeZone: 'America/Chihuahua' }))}</span>
</footer>
</div></body></html>`;
}

export async function descargarInformePronostico(d: DatosPronostico): Promise<void> {
    const html = await construyeInformePronosticoHTML(d);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    await guardaOComparte(blob, `informe-pronostico-conchos-${getTodayString()}.html`, 'text/html');
}

/** Abre el informe en una pestaña nueva y lanza el diálogo de impresión (el usuario elige "Guardar como PDF"). */
export async function imprimirInformePronostico(d: DatosPronostico): Promise<void> {
    const html = await construyeInformePronosticoHTML(d);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const ventana = window.open(url, '_blank');
    if (!ventana) {
        URL.revokeObjectURL(url);
        throw new Error('El navegador bloqueó la ventana de impresión. Habilita ventanas emergentes para este sitio.');
    }
    const imprime = () => { ventana.print(); setTimeout(() => URL.revokeObjectURL(url), 30000); };
    if (ventana.document.readyState === 'complete') imprime();
    else ventana.addEventListener('load', imprime, { once: true });
}
