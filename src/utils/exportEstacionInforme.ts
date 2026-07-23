// ═══════════════════════════════════════════════════════════════════════════
// INFORME INDIVIDUAL POR ESTACIÓN — SICA-005 · Centro de Inteligencia Agroclimática
// ---------------------------------------------------------------------------
// Versión compartible del panel de detalle (EstacionDetalle.tsx): mismas
// secciones (demanda evaporativa, balance hídrico, acumulados y extremos,
// evolución diaria, viento y cielo/pronóstico), para UNA estación y la ventana
// de días que el operador tenía seleccionada al pedir el informe.
//
// Reglas heredadas y respetadas aquí (ver estacionDetalle.ts, cielo.ts):
//   · Un valor sin dato se rotula «S/D» — nunca un 0 que se lea como medición.
//   · El balance 7/30 días declara si la ventana real es menor a la pedida.
//   · Sin pluviómetro no se publica déficit hídrico.
// ═══════════════════════════════════════════════════════════════════════════
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';
import type { DetalleEstacion, DiaEstacion, BalanceHidrico } from './estacionDetalle';
import type { RangoAnalisis } from '../hooks/useEstacionDetalle';
import { formateaEdad, PROCEDENCIA_LABEL } from './cielo';
import { assetToDataURI } from './exportClimaReport';
import { guardaOComparte } from './descargaArchivo';

const fechaCorta2 = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const tituloVentana = (r: RangoAnalisis) => r.tipo === 'manual'
    ? `${fechaCorta2(r.rango.desde)} – ${fechaCorta2(r.rango.hasta)}`
    : `Últimos ${r.dias} días`;

const SRL_MARRON = '#6B2D2D';
const AZUL = '#1e5b8f';
const rolLabel = (rol: string) => (rol === 'presa' ? 'Presa' : rol === 'modulo' ? 'Módulo' : 'Canal');
const f = (v: number | null | undefined, dec = 1, suf = '') => (v == null ? 'S/D' : `${v.toFixed(dec)}${suf}`);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fechaCorta = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

function bloqueBalance(b: BalanceHidrico, titulo: string): string {
    const deficit = b.deficitMm;
    const color = deficit == null ? '#64748b' : deficit > 0 ? '#f59e0b' : '#22c55e';
    const parcial = b.ventanaParcial && b.diasReales > 0
        ? ` <em style="font-weight:600;color:#f59e0b">(${b.diasReales} d reales)</em>` : '';

    if (b.bloqueo) {
        return `<div class="bal-card">
            <div class="bal-tit">${titulo}${parcial}</div>
            <div class="bal-bloqueo">⚠ ${esc(b.bloqueo)}</div>
        </div>`;
    }
    return `<div class="bal-card">
        <div class="bal-tit">${titulo}${parcial}</div>
        <div class="bal-cifra" style="color:${color}">
            ${deficit != null ? `${deficit > 0 ? '+' : ''}${deficit.toFixed(1)}` : 'S/D'} <small>mm</small>
        </div>
        <div class="bal-leyenda">${deficit == null ? 'sin balance'
            : deficit > 0 ? 'déficit — reponer con riego' : 'excedente — la lluvia cubrió la demanda'}</div>
        <div class="bal-desglose">ETₒ ${f(b.etoAcumMm)} mm · Lluvia ${f(b.lluviaAcumMm)} mm</div>
        ${b.etoDiaMediaMm != null ? `<div class="bal-media">Demanda media <b>${b.etoDiaMediaMm.toFixed(2)} mm/día</b>
            <em>${b.diasReales} día(s) cerrado(s)</em></div>` : ''}
    </div>`;
}

/** Gráfica SVG de la evolución diaria: lluvia en barras + ETₒ/T máx/T mín en líneas. */
function graficaEvolucion(dias: DiaEstacion[]): string {
    const serie = dias.map(d => ({
        fecha: fechaCorta(d.fecha), eto: d.etoMm, lluvia: d.lluviaMm, tMax: d.tempMaxC, tMin: d.tempMinC,
    }));
    if (serie.length < 2) return '';

    const W = 760, H = 260, ML = 42, MR = 42, MT = 16, MB = 30;
    const iw = W - ML - MR, ih = H - MT - MB;
    const x = (i: number) => ML + (i / (serie.length - 1)) * iw;

    const mmVals = [...serie.map(s => s.eto), ...serie.map(s => s.lluvia)].filter((v): v is number => v != null);
    const mmMax = Math.max(10, ...mmVals) * 1.15;
    const yMm = (v: number) => MT + ih - (v / mmMax) * ih;

    const tVals = [...serie.map(s => s.tMax), ...serie.map(s => s.tMin)].filter((v): v is number => v != null);
    const tMin = tVals.length ? Math.min(...tVals) - 2 : 0, tMax = tVals.length ? Math.max(...tVals) + 2 : 40;
    const yT = (v: number) => MT + ih - ((v - tMin) / Math.max(1, tMax - tMin)) * ih;

    const bw = Math.min(22, iw / serie.length * 0.5);
    const barras = serie.map((s, i) => s.lluvia != null && s.lluvia > 0
        ? `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${yMm(s.lluvia).toFixed(1)}" width="${bw.toFixed(1)}"
                height="${(MT + ih - yMm(s.lluvia)).toFixed(1)}" fill="#38bdf8" rx="2"/>` : '').join('');

    const lineaDe = (campo: 'eto' | 'tMax' | 'tMin', color: string, esc2: (v: number) => number) => {
        const pts = serie.map((s, i) => ({ i, v: s[campo] })).filter(o => o.v != null);
        if (pts.length < 2) return '';
        const d = pts.map((o, k) => `${k ? 'L' : 'M'}${x(o.i).toFixed(1)},${esc2(o.v!).toFixed(1)}`).join(' ');
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    };

    const ejeX = serie.map((s, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9"
        fill="#94a3b8" font-family="system-ui">${esc(s.fecha)}</text>`).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolución diaria de ETₒ, lluvia y temperatura">
        <line x1="${ML}" y1="${MT + ih}" x2="${W - MR}" y2="${MT + ih}" stroke="#334155" stroke-width="1"/>
        ${barras}
        ${lineaDe('eto', '#f59e0b', yMm)}
        ${lineaDe('tMax', '#ef4444', yT)}
        ${lineaDe('tMin', '#60a5fa', yT)}
        ${ejeX}
        <text x="${ML - 6}" y="${MT + 8}" text-anchor="end" font-size="8" fill="#94a3b8" font-family="system-ui">mm</text>
        <text x="${W - MR + 6}" y="${MT + 8}" text-anchor="start" font-size="8" fill="#94a3b8" font-family="system-ui">°C</text>
    </svg>
    <div class="leyenda-graf">
        <span><i style="background:#38bdf8"></i> Lluvia</span>
        <span><i style="background:#f59e0b"></i> ETₒ</span>
        <span><i style="background:#ef4444"></i> T máx</span>
        <span><i style="background:#60a5fa"></i> T mín</span>
    </div>`;
}

async function construyeHTML(
    estacion: EstacionConLectura, detalle: DetalleEstacion, rango: RangoAnalisis,
): Promise<string> {
    const [logoSRL, logoSICA] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'),
        assetToDataURI('/logos/SICA005.png'),
    ]);
    const logoImg = (src: string, alt: string) => src
        ? `<img src="${src}" alt="${alt}" style="height:46px;width:auto;object-fit:contain">`
        : `<div style="height:46px;display:flex;align-items:center;color:#94a3b8;font-size:0.7rem">${esc(alt)}</div>`;

    const l = estacion.lectura;
    const q = estacion.calidad;
    const hoy = new Date().toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });

    const rosaTop = [...detalle.rosa].filter(r => r.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 3);
    const rosaHTML = rosaTop.length
        ? rosaTop.map(r => `<div class="v-sector">
            <span class="v-sec-lbl">${r.sector}</span>
            <div class="v-barra"><div class="v-barra-fill" style="width:${r.pct.toFixed(0)}%"></div></div>
            <span class="v-sec-pct">${r.pct.toFixed(0)}%</span>
            <span class="v-sec-vel">${f(r.velMediaMs)} m/s</span>
        </div>`).join('')
        : '<em class="nota">Sin registros de dirección en la ventana.</em>';

    const graf = graficaEvolucion(detalle.dias);

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de estación — ${esc(estacion.nombre)} — SRL Unidad Conchos</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: #0b1220; color: #e2e8f0;
         font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 820px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 16px; padding-bottom: 16px;
           border-bottom: 2px solid ${SRL_MARRON}; margin-bottom: 20px; }
  header .titulo { flex: 1; text-align: center; }
  header .sub { color: #86efac; font-weight: 700; font-size: 0.8rem; letter-spacing: 0.03em; }
  header h1 { margin: 2px 0; font-size: 1.3rem; color: #f1f5f9; }
  header .meta { color: #94a3b8; font-size: 0.78rem; }
  .est-cab { display: flex; justify-content: space-between; align-items: flex-start;
             background: #111a2e; border: 1px solid #1e293b; border-radius: 10px;
             padding: 14px 18px; margin-bottom: 18px; }
  .est-cab h2 { margin: 0 0 4px; font-size: 1.15rem; color: #f1f5f9; }
  .est-cab .meta-fila { display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.8rem; color: #94a3b8; }
  .est-cab .rol { background: #1e3a5f; color: #7dd3fc; padding: 2px 8px; border-radius: 100px;
                  font-size: 0.7rem; font-weight: 700; text-transform: uppercase; }
  section { margin-bottom: 22px; }
  h3 { display: flex; align-items: center; gap: 6px; font-size: 0.95rem; color: #f1f5f9;
       border-bottom: 1px solid #1e293b; padding-bottom: 6px; margin-bottom: 12px; }
  .nota { display: block; color: #94a3b8; font-size: 0.76rem; margin-top: 8px; }
  .nota.aviso { color: #fbbf24; }
  /* ETo de referencia */
  .eto-ref { display: flex; gap: 20px; flex-wrap: wrap; }
  .eto-principal { background: #1a1408; border: 1px solid #f59e0b55; border-radius: 10px; padding: 14px 18px; flex: 1; min-width: 220px; }
  .eto-num { font-size: 2rem; font-weight: 800; color: #f59e0b; }
  .eto-principal small, .eto-secundario small { font-size: 0.9rem; color: #94a3b8; }
  .eto-etq { color: #94a3b8; font-size: 0.78rem; margin-top: 4px; }
  .eto-etq em { display: block; font-style: normal; color: #64748b; font-size: 0.72rem; }
  .eto-secundario { background: #111a2e; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 18px; flex: 1; min-width: 220px; }
  .eto-secundario span { font-size: 1.5rem; font-weight: 700; color: #f1f5f9; }
  /* Balance */
  .bal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .bal-card { background: #111a2e; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 16px; }
  .bal-tit { font-size: 0.78rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.02em; margin-bottom: 8px; }
  .bal-cifra { font-size: 1.7rem; font-weight: 800; }
  .bal-cifra small { font-size: 0.9rem; color: #94a3b8; font-weight: 400; }
  .bal-leyenda { font-size: 0.78rem; color: #94a3b8; margin: 4px 0 8px; }
  .bal-desglose { font-size: 0.78rem; color: #cbd5e1; padding-top: 6px; border-top: 1px dashed #1e293b; }
  .bal-media { font-size: 0.78rem; color: #7dd3fc; margin-top: 8px; }
  .bal-media em { display: block; font-style: normal; color: #64748b; font-size: 0.72rem; }
  .bal-bloqueo { color: #fbbf24; font-size: 0.82rem; }
  /* Acumulados */
  .acum-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .acum-item { background: #111a2e; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; text-align: center; }
  .acum-val { display: block; font-size: 1.25rem; font-weight: 700; color: #f1f5f9; }
  .acum-lbl { display: block; font-size: 0.68rem; color: #94a3b8; margin-top: 2px; }
  /* Gráfica */
  .fig { background: #111a2e; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; }
  .leyenda-graf { display: flex; gap: 14px; justify-content: center; margin-top: 8px; font-size: 0.75rem; color: #cbd5e1; }
  .leyenda-graf span { display: flex; align-items: center; gap: 4px; }
  .leyenda-graf i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  /* Viento y cielo */
  .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .panel { background: #111a2e; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 16px; }
  .v-fila { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 3px 0; }
  .v-alerta { color: #fbbf24; font-size: 0.78rem; margin-top: 8px; }
  .v-sector { display: grid; grid-template-columns: 28px 1fr 36px 56px; align-items: center; gap: 8px; font-size: 0.78rem; padding: 3px 0; }
  .v-barra { background: #1e293b; border-radius: 100px; height: 6px; overflow: hidden; }
  .v-barra-fill { background: ${AZUL}; height: 100%; }
  .cielo-linea { font-size: 0.85rem; margin-bottom: 8px; }
  .cielo-vars { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.78rem; color: #cbd5e1; }
  footer { display: flex; justify-content: space-between; align-items: center; margin-top: 24px;
           padding-top: 14px; border-top: 1px solid #1e293b; font-size: 0.72rem; color: #64748b; }
  @media (max-width: 640px) {
    .bal-grid, .duo { grid-template-columns: 1fr; }
    .acum-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media print {
    body { background: #fff; color: #0f172a; padding: 0; }
    .est-cab, .panel, .fig, .bal-card, .acum-item, .eto-principal, .eto-secundario { break-inside: avoid; }
  }
</style></head><body><div class="wrap">
  <header>
    ${logoImg(logoSICA, 'SICA-005')}
    <div class="titulo">
      <div class="sub">S R L Unidad Conchos · Delicias, Chihuahua</div>
      <h1>Informe de Estación</h1>
      <div class="meta">Distrito de Riego 005 · Red WeatherLink (Davis) · Corte: ${hoy}</div>
    </div>
    ${logoImg(logoSRL, 'SRL Unidad Conchos')}
  </header>

  <div class="est-cab">
    <div>
      <h2>📍 ${esc(estacion.nombre)}</h2>
      <div class="meta-fila">
        <span class="rol">${rolLabel(estacion.rol)}</span>
        ${estacion.ciudad ? `<span>${esc(estacion.ciudad)}</span>` : ''}
        <span>${Number(estacion.elevacion_msnm) || '—'} msnm</span>
        <span style="color:${q.color}">● ${esc(q.etiqueta)} · ${esc(formateaEdad(q.edadMin))}</span>
      </div>
    </div>
    <div class="meta" style="text-align:right">
      Ventana de análisis: <b>${tituloVentana(rango)}</b><br>
      ${detalle.diasConDato} día(s) con dato · ${detalle.totalLecturas} lecturas
    </div>
  </div>

  <section>
    <h3>💧 Demanda evaporativa (ETₒ)</h3>
    <div class="eto-ref">
      <div class="eto-principal">
        <span class="eto-num">${f(detalle.referencia.cierreMm, 2)}</span><small> mm</small>
        <div class="eto-etq">Cierre del ${detalle.referencia.cierreFecha ? fechaCorta(detalle.referencia.cierreFecha) : 'último día'}
          <em>cifra de referencia para dimensionar el riego</em></div>
      </div>
      <div class="eto-secundario">
        <span>${f(detalle.referencia.hoyParcialMm, 2)}</span><small> mm</small>
        <div class="eto-etq">Acumulado de hoy al corte
          ${detalle.referencia.hoyEsMadrugada ? '<em>parcial de madrugada: el día apenas inicia, no indica ausencia de demanda</em>' : ''}
        </div>
      </div>
    </div>
  </section>

  <section>
    <h3>🌧️ Balance hídrico (ETₒ − lluvia)</h3>
    <div class="bal-grid">
      ${bloqueBalance(detalle.balance7, 'Últimos 7 días')}
      ${bloqueBalance(detalle.balanceVentana, tituloVentana(rango))}
    </div>
    ${detalle.pluviometro === 'ausente' ? `<p class="nota aviso">⚠ Esta estación no registra lluvia en ninguna
      escala (día, 24 h, mes y año en cero). Se trata como sensor ausente, no como ausencia de precipitación:
      para el balance de esta zona, usar el dato de una estación vecina con pluviómetro.</p>` : ''}
  </section>

  <section>
    <h3>📊 Acumulados y extremos</h3>
    <div class="acum-grid">
      <div class="acum-item"><span class="acum-val">${f(detalle.lluviaMesMm)}</span><span class="acum-lbl">mm lluvia · mes</span></div>
      <div class="acum-item"><span class="acum-val">${f(detalle.lluviaAnioMm)}</span><span class="acum-lbl">mm lluvia · año</span></div>
      <div class="acum-item"><span class="acum-val">${f(detalle.etMesMm)}</span><span class="acum-lbl">mm ETₒ · mes</span></div>
      <div class="acum-item"><span class="acum-val">${detalle.rachaSecaDias != null ? detalle.rachaSecaDias : 'S/D'}</span><span class="acum-lbl">días sin lluvia</span></div>
      <div class="acum-item"><span class="acum-val">${f(l?.temp_max_c)}</span><span class="acum-lbl">°C máx. hoy</span></div>
      <div class="acum-item"><span class="acum-val">${f(l?.temp_min_c)}</span><span class="acum-lbl">°C mín. hoy</span></div>
      <div class="acum-item"><span class="acum-val">${f(l?.gdd, 0)}</span><span class="acum-lbl">GDD (base 10 °C)</span></div>
      <div class="acum-item"><span class="acum-val">${f(l?.uv_index, 1)}</span><span class="acum-lbl">índice UV</span></div>
    </div>
    <p class="nota">Los acumulados de mes y año provienen del contador propio de la estación y se cuentan
      desde su instalación, no desde el inicio del año hidrológico.</p>
  </section>

  ${graf ? `<section>
    <h3>🌡️ Evolución diaria</h3>
    <div class="fig">${graf}</div>
    ${detalle.dias.some(d => !d.completo) ? '<p class="nota">El último punto corresponde al día en curso y es un acumulado parcial.</p>' : ''}
  </section>` : `<section><h3>🌡️ Evolución diaria</h3>
    <p class="nota aviso">⚠ Se necesitan al menos 2 días cerrados para trazar la evolución; hay ${detalle.diasConDato}.</p>
  </section>`}

  <section>
    <h3>💨 Viento y condición nocturna</h3>
    <div class="duo">
      <div class="panel">
        <div class="v-fila"><span>Actual</span><b>${f(l?.viento_ms)} m/s</b></div>
        <div class="v-fila"><span>Ráfaga</span><b>${f(l?.viento_rafaga_ms)} m/s</b></div>
        <div class="v-fila"><span>Dirección</span><b>${l?.viento_dir_deg != null ? `${Math.round(l.viento_dir_deg)}°` : 'S/D'}</b></div>
        ${l?.viento_ms != null && l.viento_ms > 4 ? '<div class="v-alerta">⚠ Sobre 4 m/s: deriva en aspersión</div>' : ''}
        <div class="v-fila" style="border-top:1px dashed #1e293b;margin-top:6px;padding-top:8px">
          <span>Riesgo térmico</span><b style="color:${detalle.riesgo.color}">${esc(detalle.riesgo.etiqueta)}</b>
        </div>
        <div class="v-fila"><span>T mín · Spread T−Td</span><b>${f(detalle.riesgo.tempMinC)} °C · ${f(detalle.riesgo.spreadMinC)} °C</b></div>
      </div>
      <div class="panel">
        <div style="font-size:0.78rem;color:#94a3b8;margin-bottom:8px">Procedencia dominante</div>
        ${rosaHTML}
      </div>
    </div>
  </section>

  <section>
    <h3>☁️ Cielo y pronóstico</h3>
    <div class="panel">
      <div class="cielo-linea" style="color:${estacion.cielo.color}">
        ${estacion.cielo.icono ? `${estacion.cielo.icono} ` : ''}${esc(estacion.cielo.etiqueta)}
        ${estacion.cielo.coberturaPct != null ? ` · <b>${estacion.cielo.coberturaPct}%</b>` : ''}
        <span style="color:#64748b;font-size:0.75rem"> — ${esc(PROCEDENCIA_LABEL[estacion.cielo.procedencia])}</span>
      </div>
      <div class="cielo-vars">
        <span>Radiación · <b>${f(l?.rad_solar_wm2, 0)} W/m²</b></span>
        <span>Presión · <b>${f(l?.presion_hpa)} hPa</b></span>
        <span>Tendencia bar. · <b>${f(l?.bar_trend_hpa, 2)} hPa</b></span>
        <span>Punto de rocío · <b>${f(l?.punto_rocio_c)} °C</b></span>
      </div>
      ${estacion.pronostico ? `<div class="cielo-vars" style="margin-top:10px;padding-top:10px;border-top:1px dashed #1e293b">
        <span>Prob. lluvia (pronóstico) · <b>${estacion.pronostico.precip_prob_pct != null ? `${estacion.pronostico.precip_prob_pct}%` : 'S/D'}</b></span>
        <span>Lámina prevista · <b>${f(estacion.pronostico.precip_mm)} mm</b></span>
        <span>ETₒ modelo · <b>${f(estacion.pronostico.eto_fc_mm, 2)} mm</b></span>
        <span>Horizonte · <b>${estacion.pronostico.horizonte_h ?? '—'} h</b></span>
      </div>` : '<p class="nota">Sin pronóstico sincronizado para esta estación.</p>'}
    </div>
  </section>

  <footer>
    <span>SRL Unidad Conchos · Distrito de Riego 005</span>
    <span>Informe de estación · station_id ${estacion.station_id}</span>
  </footer>
</div></body></html>`;
}

/** Genera el informe HTML de una estación y lo entrega (descarga o Compartir en iOS). */
export async function exportEstacionInforme(
    estacion: EstacionConLectura, detalle: DetalleEstacion, rango: RangoAnalisis,
): Promise<void> {
    const html = await construyeHTML(estacion, detalle, rango);
    const slug = estacion.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    await guardaOComparte(blob, `informe-${slug}-${date}.html`, 'text/html');
}
