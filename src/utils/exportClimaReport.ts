// Genera y descarga un INFORME DE CLIMA (HTML autónomo) a partir de las
// estaciones WeatherLink y sus lecturas: datos actuales, estimaciones (ETₒ, GDD),
// alertas de riego y un croquis de ubicación. Marca SRL Unidad Conchos.
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';

// Paleta institucional SRL (marrón oficial).
const SRL_MARRON = '#6B2D2D';

const fmt = (v: number | null | undefined, d = 1, u = '') =>
    v == null ? '—' : `${v.toFixed(d)}${u ? ' ' + u : ''}`;

// Croquis SVG simple: proyecta lat/lon de las estaciones a un lienzo, para dar
// contexto de ubicación sin depender de mapas externos (informe offline).
function croquisSVG(ests: EstacionConLectura[]): string {
    const pts = ests.filter(e => e.latitud && e.longitud);
    if (!pts.length) return '';
    const lats = pts.map(e => e.latitud), lons = pts.map(e => e.longitud);
    const minLa = Math.min(...lats), maxLa = Math.max(...lats);
    const minLo = Math.min(...lons), maxLo = Math.max(...lons);
    const W = 520, H = 320, P = 40;
    const sx = (lo: number) => P + ((lo - minLo) / Math.max(1e-6, maxLo - minLo)) * (W - 2 * P);
    const sy = (la: number) => H - P - ((la - minLa) / Math.max(1e-6, maxLa - minLa)) * (H - 2 * P);
    const marks = pts.map(e => {
        const x = sx(e.longitud), y = sy(e.latitud);
        const col = e.enLinea ? '#38bdf8' : '#94a3b8';
        return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="7" fill="${col}" stroke="#fff" stroke-width="2"/>
                <text x="${x.toFixed(0)}" y="${(y - 12).toFixed(0)}" font-size="10" text-anchor="middle" fill="#334155" font-family="monospace">${e.nombre}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;background:#f1f5f9;border-radius:8px">
        <text x="10" y="18" font-size="9" fill="#94a3b8" font-family="monospace">Croquis de ubicación (lat/lon relativa)</text>
        ${marks}
    </svg>`;
}

function buildHTML(ests: EstacionConLectura[]): string {
    const hoy = new Date().toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });
    const enLinea = ests.filter(e => e.enLinea);
    const etos = enLinea.map(e => e.lectura?.eto_mm).filter((v): v is number => v != null);
    const etoProm = etos.length ? etos.reduce((a, b) => a + b, 0) / etos.length : null;
    const gdds = ests.map(e => e.lectura?.gdd).filter((v): v is number => v != null);
    const gddProm = gdds.length ? gdds.reduce((a, b) => a + b, 0) / gdds.length : null;
    const lluviaTotal = ests.reduce((a, e) => a + (e.lectura?.lluvia_dia_mm ?? 0), 0);

    // Alertas de riego derivadas de las estaciones en línea
    const alertas: string[] = [];
    for (const e of enLinea) {
        const l = e.lectura!;
        if ((l.viento_ms ?? 0) > 5) alertas.push(`${e.nombre}: viento ${fmt(l.viento_ms, 1, 'm/s')} — precaución en riego por aspersión`);
        if ((l.lluvia_dia_mm ?? 0) > 10) alertas.push(`${e.nombre}: lluvia ${fmt(l.lluvia_dia_mm, 1, 'mm')} — considerar cierre preventivo de tomas`);
        if ((l.temp_min_c ?? 99) < 5) alertas.push(`${e.nombre}: temp. mín ${fmt(l.temp_min_c, 1, '°C')} — vigilar heladas`);
    }

    const filas = ests.map(e => {
        const l = e.lectura;
        return `<tr class="${e.enLinea ? '' : 'off'}">
            <td><b>${e.nombre}</b><br><small>${e.ciudad ?? ''} · #${e.station_id}</small></td>
            <td>${e.enLinea ? '<span class="on">● en línea</span>' : `<span class="offs">○ ${e.edadHoras != null ? Math.round(e.edadHoras) + ' h' : 's/d'}</span>`}</td>
            <td>${fmt(l?.temp_c, 1, '°C')}</td>
            <td>${l?.hum_rel_pct != null ? Math.round(l.hum_rel_pct) + ' %' : '—'}</td>
            <td>${fmt(l?.viento_ms, 1, 'm/s')}</td>
            <td>${fmt(l?.lluvia_dia_mm, 1, 'mm')}</td>
            <td><b>${fmt(l?.eto_mm ?? l?.et_dia_mm, 2, 'mm')}</b></td>
            <td>${l?.gdd != null ? l.gdd.toFixed(0) : '—'}</td>
        </tr>`;
    }).join('');

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe de Clima — SRL Unidad Conchos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; color: #1e293b; background: #fff; }
  .wrap { max-width: 900px; margin: 0 auto; }
  header { border-bottom: 3px solid ${SRL_MARRON}; padding-bottom: 14px; margin-bottom: 20px; }
  header h1 { color: ${SRL_MARRON}; margin: 0 0 2px; font-size: 1.5rem; letter-spacing: 0.5px; }
  header .sub { color: #64748b; font-size: 0.8rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  header .meta { color: #94a3b8; font-size: 0.75rem; margin-top: 6px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 18px 0; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center; }
  .kpi .v { font-size: 1.4rem; font-weight: 700; color: ${SRL_MARRON}; }
  .kpi .l { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 12px 0; }
  th { background: ${SRL_MARRON}; color: #fff; padding: 8px 6px; text-align: left; font-size: 0.7rem; text-transform: uppercase; }
  td { padding: 8px 6px; border-bottom: 1px solid #eef2f7; }
  tr.off td { opacity: 0.55; }
  .on { color: #16a34a; font-weight: 700; font-size: 0.72rem; }
  .offs { color: #94a3b8; font-size: 0.72rem; }
  small { color: #94a3b8; }
  h2 { color: ${SRL_MARRON}; font-size: 1rem; border-left: 4px solid ${SRL_MARRON}; padding-left: 8px; margin-top: 26px; }
  .alertas li { color: #b45309; font-size: 0.82rem; margin: 3px 0; }
  .alertas .none { color: #16a34a; }
  .foot { margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 0.7rem; color: #94a3b8; }
  .modelo { background: #f8fafc; border-radius: 8px; padding: 12px 14px; font-size: 0.8rem; }
  @media print { body { padding: 0; } }
</style></head><body><div class="wrap">
  <header>
    <div class="sub">S R L Unidad Conchos · Delicias</div>
    <h1>Informe de Clima Agroclimático</h1>
    <div class="meta">SICA-005 · Estaciones WeatherLink (Davis) · Generado: ${hoy}</div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="v">${enLinea.length}/${ests.length}</div><div class="l">Estaciones en línea</div></div>
    <div class="kpi"><div class="v">${etoProm != null ? etoProm.toFixed(2) : '—'}</div><div class="l">ETₒ media (mm/día)</div></div>
    <div class="kpi"><div class="v">${gddProm != null ? gddProm.toFixed(0) : '—'}</div><div class="l">GDD medio</div></div>
    <div class="kpi"><div class="v">${lluviaTotal.toFixed(1)}</div><div class="l">Lluvia total (mm)</div></div>
  </div>

  <h2>Estaciones y lecturas actuales</h2>
  <table>
    <thead><tr><th>Estación</th><th>Estado</th><th>Temp</th><th>HR</th><th>Viento</th><th>Lluvia día</th><th>ETₒ</th><th>GDD</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>

  <h2>Ubicación</h2>
  ${croquisSVG(ests)}

  <h2>Estimaciones y modelos</h2>
  <div class="modelo">
    <p><b>Evapotranspiración de referencia (ETₒ)</b> — FAO-56 Penman-Monteith desde temperatura, humedad, viento y radiación de cada estación. Media del distrito: <b>${etoProm != null ? etoProm.toFixed(2) : '—'} mm/día</b>.</p>
    <p><b>Lámina de riego (ETc)</b> = ETₒ × Kc. Ej. nogal en brotación (Kc 0.85): <b>${etoProm != null ? (etoProm * 0.85).toFixed(2) : '—'} mm/día</b>.</p>
    <p><b>Grados-día (GDD)</b> base 10 °C (nogal/alfalfa): media <b>${gddProm != null ? gddProm.toFixed(0) : '—'} °C-día</b>.</p>
  </div>

  <h2>Alertas de riego</h2>
  <ul class="alertas">
    ${alertas.length ? alertas.map(a => `<li>${a}</li>`).join('') : '<li class="none">Sin alertas: condiciones dentro de parámetros operativos.</li>'}
  </ul>

  <div class="foot">
    Datos de estaciones Davis/WeatherLink de la cuenta operada por SRL Unidad Conchos.
    Conversión a métrico y ETₒ calculada por SICA-005. Este informe refleja la última lectura sincronizada de cada estación.
  </div>
</div></body></html>`;
}

/** Genera el informe y lo descarga como archivo HTML. */
export function exportClimaReport(ests: EstacionConLectura[]): void {
    const html = buildHTML(ests);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `informe-clima-conchos-${date}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
