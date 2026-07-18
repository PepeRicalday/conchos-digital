// Genera y descarga un INFORME TÉCNICO DE CLIMA (HTML autónomo) desde las
// estaciones WeatherLink: lecturas actuales, mapa georreferenciado con el trazo
// del Canal Conchos de fondo, análisis técnico interpretativo (demanda hídrica,
// balance, riesgo agronómico) y logos institucionales embebidos.
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';

const SRL_MARRON = '#6B2D2D';
const AZUL = '#1e5b8f';

const fmt = (v: number | null | undefined, d = 1, u = '') =>
    v == null ? '—' : `${v.toFixed(d)}${u ? ' ' + u : ''}`;

// Trazo simplificado del Canal Principal Conchos (K0→K104) para el mapa de fondo.
// [lon, lat] cada ~1 km; de public/geo/canal_conchos.geojson (submuestreado).
const CANAL: [number, number][] = [[-105.2099,27.668],[-105.2089,27.6712],[-105.2046,27.6749],[-105.2018,27.6848],[-105.2004,27.6902],[-105.1987,27.7],[-105.1985,27.7045],[-105.1971,27.7133],[-105.1951,27.7221],[-105.1936,27.7308],[-105.1904,27.7402],[-105.1877,27.7439],[-105.1842,27.7495],[-105.1847,27.7556],[-105.1848,27.7636],[-105.1868,27.7714],[-105.1854,27.7821],[-105.1848,27.7978],[-105.1888,27.8029],[-105.1876,27.8124],[-105.1885,27.8203],[-105.1955,27.8335],[-105.1981,27.8435],[-105.2004,27.8499],[-105.2017,27.854],[-105.2085,27.8578],[-105.2069,27.8668],[-105.2071,27.8725],[-105.2055,27.8832],[-105.2096,27.8869],[-105.207,27.8942],[-105.2218,27.904],[-105.2265,27.914],[-105.2296,27.9256],[-105.2412,27.9307],[-105.2363,27.9416],[-105.239,27.9502],[-105.249,27.954],[-105.2651,27.9516],[-105.2853,27.9699],[-105.2905,27.9779],[-105.2992,27.9899],[-105.3033,27.99],[-105.3138,27.9894],[-105.3131,27.9956],[-105.3163,28.0087],[-105.3249,28.0128],[-105.3239,28.0184],[-105.3281,28.0252],[-105.34,28.0299],[-105.339,28.0369],[-105.3399,28.0436],[-105.345,28.0448],[-105.3558,28.0548],[-105.3593,28.0595],[-105.3617,28.0681],[-105.3686,28.0653],[-105.3736,28.0698],[-105.3813,28.0678],[-105.3854,28.074],[-105.3934,28.0808],[-105.3939,28.0918],[-105.3989,28.0957],[-105.3967,28.1001],[-105.4004,28.1047],[-105.3995,28.1126],[-105.3952,28.1266],[-105.3999,28.1331],[-105.4098,28.1316],[-105.4232,28.13],[-105.4311,28.1306],[-105.4382,28.1291],[-105.4449,28.1312],[-105.4524,28.1303],[-105.4603,28.1276],[-105.4676,28.1243],[-105.4697,28.1164],[-105.4795,28.1066],[-105.4806,28.1001],[-105.4802,28.0952],[-105.4826,28.083],[-105.4874,28.0767],[-105.4985,28.0744],[-105.5056,28.0758],[-105.515,28.0861],[-105.5224,28.0911],[-105.5317,28.0959],[-105.5354,28.0952],[-105.5389,28.0994],[-105.5443,28.107],[-105.5503,28.1118],[-105.5558,28.1127],[-105.5608,28.117],[-105.5746,28.1251],[-105.5791,28.1289],[-105.5849,28.1327],[-105.5936,28.1374],[-105.5992,28.1423],[-105.6042,28.1455],[-105.609,28.1495],[-105.6124,28.1544],[-105.6148,28.157],[-105.6177,28.1581]];

// Presas del distrito (contexto del mapa).
const PRESAS: { nombre: string; lat: number; lon: number }[] = [
    { nombre: 'P. Boquilla', lat: 27.5517, lon: -105.4375 },
    { nombre: 'P. Fco. I. Madero', lat: 28.3364, lon: -105.5278 },
];

// Carga un asset público y lo devuelve como data URI base64 (para el HTML offline).
async function assetToDataURI(path: string): Promise<string> {
    try {
        const res = await fetch(path);
        if (!res.ok) return '';
        const blob = await res.blob();
        return await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : '');
            r.readAsDataURL(blob);
        });
    } catch { return ''; }
}

// ── Mapa georreferenciado con el Canal Conchos de fondo (proyección lat/lon
//    con corrección de aspecto por latitud), presas y estaciones ─────────────
// Si se pasan `preds`, el mapa se vuelve de PRONÓSTICO: cada estación lleva el
// ícono/color de su predicción a 24 h (capa de estado sobre el plano).
function mapaSVG(ests: EstacionConLectura[], preds?: Pred24[]): string {
    const pts = ests.filter(e => e.latitud && e.longitud);
    if (!pts.length) return '';
    const predDe = (nombre: string) => preds?.find(p => p.estacion === nombre);
    // Extensión que abarca canal + presas + estaciones, con MARGEN geográfico
    // (5 % del rango) para que ningún punto ni etiqueta quede pegado al borde.
    const allLat = [...CANAL.map(p => p[1]), ...PRESAS.map(p => p.lat), ...pts.map(e => e.latitud)];
    const allLon = [...CANAL.map(p => p[0]), ...PRESAS.map(p => p.lon), ...pts.map(e => e.longitud)];
    let minLa = Math.min(...allLat), maxLa = Math.max(...allLat);
    let minLo = Math.min(...allLon), maxLo = Math.max(...allLon);
    const mLa = (maxLa - minLa) * 0.08, mLo = (maxLo - minLo) * 0.08;
    minLa -= mLa; maxLa += mLa; minLo -= mLo; maxLo += mLo;
    // Corrección de aspecto: 1° lon = cos(lat)·(1° lat) → mapa con proporción real.
    const latMed = (minLa + maxLa) / 2;
    const kx = Math.cos((latMed * Math.PI) / 180);
    const spanLo = (maxLo - minLo) * kx, spanLa = maxLa - minLa;
    const P = 34, W = 640;
    // Altura por proporción real, pero acotada para que el mapa no sea excesivamente largo.
    const H = Math.min(760, Math.round((W - 2 * P) * (spanLa / Math.max(1e-6, spanLo)) + 2 * P));
    const sx = (lo: number) => P + ((lo - minLo) * kx / Math.max(1e-6, spanLo)) * (W - 2 * P);
    const sy = (la: number) => H - P - ((la - minLa) / Math.max(1e-6, spanLa)) * (H - 2 * P);

    const canalPath = CANAL.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
    const presasSVG = PRESAS.map(pr => {
        const x = sx(pr.lon), y = sy(pr.lat);
        return `<path d="M${(x-5).toFixed(0)},${y.toFixed(0)} L${x.toFixed(0)},${(y-8).toFixed(0)} L${(x+5).toFixed(0)},${y.toFixed(0)} Z" fill="#0e7490" stroke="#fff" stroke-width="1"/>
                <text x="${x.toFixed(0)}" y="${(y+13).toFixed(0)}" font-size="8.5" text-anchor="middle" fill="#155e75" font-family="system-ui">${pr.nombre}</text>`;
    }).join('');
    const estSVG = pts.map(e => {
        const x = sx(e.longitud), y = sy(e.latitud);
        const pr = predDe(e.nombre);
        const col = pr ? pr.color : (e.enLinea ? '#0284c7' : '#94a3b8');
        // En modo pronóstico: ícono de estado + temp máx esperada bajo el marcador.
        const icono = pr
            ? `<text x="${x.toFixed(1)}" y="${(y+4).toFixed(1)}" font-size="12" text-anchor="middle">${pr.icono}</text>
               <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="12" fill="none" stroke="${col}" stroke-width="2"/>
               ${pr.tMaxEsp != null ? `<text x="${x.toFixed(1)}" y="${(y+24).toFixed(1)}" font-size="8.5" font-weight="700" text-anchor="middle" fill="${col}" font-family="system-ui">máx ${pr.tMaxEsp}°</text>` : ''}`
            : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5" fill="${col}" stroke="#fff" stroke-width="2"/>
               <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="none" stroke="${col}" stroke-width="1" opacity="0.4"/>`;
        return `${icono}
                <text x="${x.toFixed(1)}" y="${(y-15).toFixed(1)}" font-size="9.5" font-weight="600" text-anchor="middle" fill="#0c4a6e" font-family="system-ui">${e.nombre}</text>`;
    }).join('');

    // Retícula de grados (líneas tenues de referencia = "plano")
    const grid: string[] = [];
    for (let la = Math.ceil(minLa * 10) / 10; la <= maxLa; la += 0.1) {
        const y = sy(la);
        grid.push(`<line x1="${P}" y1="${y.toFixed(0)}" x2="${W-P}" y2="${y.toFixed(0)}" stroke="#dbe4ec" stroke-width="0.6"/><text x="${P-3}" y="${(y+3).toFixed(0)}" font-size="7" text-anchor="end" fill="#94a3b8">${la.toFixed(1)}°</text>`);
    }
    for (let lo = Math.ceil(minLo * 10) / 10; lo <= maxLo; lo += 0.1) {
        const x = sx(lo);
        grid.push(`<line x1="${x.toFixed(0)}" y1="${P}" x2="${x.toFixed(0)}" y2="${H-P}" stroke="#dbe4ec" stroke-width="0.6"/><text x="${x.toFixed(0)}" y="${(H-P+10).toFixed(0)}" font-size="7" text-anchor="middle" fill="#94a3b8">${lo.toFixed(1)}°</text>`);
    }

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#f4f8fb;border:1px solid #dbe4ec;border-radius:10px">
        <rect x="${P}" y="${P}" width="${W-2*P}" height="${H-2*P}" fill="#eef5fa"/>
        ${grid.join('')}
        <path d="${canalPath}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>
        <path d="${canalPath}" fill="none" stroke="#93c5fd" stroke-width="0.8" stroke-dasharray="1,4"/>
        ${presasSVG}${estSVG}
        <text x="${P+4}" y="${P+13}" font-size="9" fill="#64748b" font-family="system-ui">${preds ? 'Pronóstico 24 h por estación — Canal Conchos (☀️ estable · ⛅ variable · 🌧️ lluvia · 💨 ventoso)' : 'Canal Principal Conchos (K0→K104) · presas y estaciones climáticas'}</text>
        <g transform="translate(${W-92},${H-30})">
          <line x1="0" y1="0" x2="${(0.1*kx/spanLo*(W-2*P)).toFixed(0)}" y2="0" stroke="#334155" stroke-width="1.5"/>
          <text x="0" y="-4" font-size="7.5" fill="#475569" font-family="system-ui">~10 km</text>
        </g>
    </svg>`;
}

// ── Análisis técnico interpretativo desde los datos reales ──────────────────
interface Analisis { demanda: string; balance: string; termico: string; viento: string; recomendaciones: string[]; }

function analisisTecnico(ests: EstacionConLectura[], etoProm: number | null, gddProm: number | null, lluviaTotal: number): Analisis {
    const enLinea = ests.filter(e => e.enLinea && e.lectura);
    const temps = enLinea.map(e => e.lectura!.temp_c).filter((v): v is number => v != null);
    const hums = enLinea.map(e => e.lectura!.hum_rel_pct).filter((v): v is number => v != null);
    const vientos = enLinea.map(e => e.lectura!.viento_ms).filter((v): v is number => v != null);
    const tMax = temps.length ? Math.max(...temps) : null;
    const hrMin = hums.length ? Math.min(...hums) : null;
    const vMax = vientos.length ? Math.max(...vientos) : null;

    // Lámina neta y bruta (eficiencia de aplicación 0.70 típica en riego rodado)
    const ETO = etoProm ?? 0;
    const laminaNeta = ETO * 0.85;          // ETc nogal en brotación (Kc 0.85)
    const laminaBruta = laminaNeta / 0.70;  // corrige por eficiencia de riego

    const clasifETo = ETO < 3 ? 'baja' : ETO < 5 ? 'moderada' : ETO < 7 ? 'alta' : 'muy alta';

    const demanda = `La evapotranspiración de referencia media del distrito es <b>${ETO.toFixed(2)} mm/día</b> (demanda atmosférica <b>${clasifETo}</b>). ` +
        `Para nogal en brotación (Kc 0.85) la demanda del cultivo (ETc) es <b>${laminaNeta.toFixed(2)} mm/día</b>; ` +
        `considerando una eficiencia de aplicación del 70 % en riego rodado, la <b>lámina bruta requerida ≈ ${laminaBruta.toFixed(2)} mm/día</b> ` +
        `(equivalente a <b>${(laminaBruta * 10).toFixed(0)} m³/ha·día</b>).`;

    const balance = lluviaTotal > 0
        ? `Se registró precipitación (<b>${lluviaTotal.toFixed(1)} mm</b> acumulados en las estaciones), que aporta al balance hídrico y reduce la lámina neta a reponer en las parcelas bajo lluvia.`
        : `Sin precipitación registrada: la reposición hídrica depende íntegramente del riego. El déficit diario a cubrir equivale a la ETc del cultivo.`;

    const termico = tMax != null
        ? `Temperatura máxima observada <b>${tMax.toFixed(1)} °C</b>${hrMin != null ? ` con humedad relativa mínima ${hrMin.toFixed(0)} %` : ''}. ` +
          (tMax > 38 ? 'Condición de <b>estrés térmico severo</b>: adelantar riegos a primeras horas y evitar riego al mediodía.'
            : tMax > 34 ? 'Estrés térmico <b>moderado</b>: monitorear cultivos sensibles.'
            : 'Rango térmico dentro de parámetros normales para la operación.') +
          (gddProm != null ? ` Acumulación térmica de <b>${gddProm.toFixed(0)} °C-día</b> (base 10 °C) para seguimiento fenológico.` : '')
        : 'Sin lectura térmica disponible.';

    const viento = vMax != null
        ? `Viento máximo <b>${vMax.toFixed(1)} m/s</b>. ` +
          (vMax > 5 ? '<b>Precaución</b>: por encima del umbral recomendado para riego por aspersión (deriva y pérdida por evaporación).'
            : 'Dentro del rango operativo para todos los métodos de riego.')
        : 'Sin lectura de viento disponible.';

    const recomendaciones: string[] = [];
    if (ETO >= 5) recomendaciones.push(`Programar riego para reponer ~${laminaBruta.toFixed(1)} mm/día; priorizar turnos nocturnos o de madrugada para minimizar pérdidas por evaporación.`);
    else recomendaciones.push(`Demanda ${clasifETo}: intervalos de riego pueden ampliarse; ajustar según humedad del suelo y etapa del cultivo.`);
    if (vMax != null && vMax > 5) recomendaciones.push('Suspender o posponer riego por aspersión hasta que el viento baje de 5 m/s.');
    if (lluviaTotal > 10) recomendaciones.push('Evaluar cierre preventivo de tomas por precipitación significativa.');
    if (tMax != null && tMax > 38) recomendaciones.push('Vigilar estrés hídrico en frutales; considerar riego de auxilio.');
    recomendaciones.push('Contrastar la ETₒ de la red con la programación de entregas del distrito (balance oferta–demanda por módulo).');

    return { demanda, balance, termico, viento, recomendaciones };
}

// ── Predicción por TENDENCIA (nowcasting) a 24 h, por estación ──────────────
// No es un pronóstico numérico (WRF/GFS): extrapola desde la señal REAL de la
// estación. La tendencia barométrica es el predictor clásico de tiempo:
//   sube  → estable / mejora     · baja  → probable deterioro / lluvia
// La temp máx/mín esperada usa la amplitud diurna típica del desierto chihuahuense
// (~14 °C) sobre la temperatura actual; la ETo esperada persiste el valor del día.
type Cielo = 'estable' | 'variable' | 'lluvia' | 'ventoso';
interface Pred24 {
    estacion: string; lat: number; lon: number; enLinea: boolean;
    cielo: Cielo; icono: string; color: string; etiqueta: string;
    tMaxEsp: number | null; tMinEsp: number | null; etoEsp: number | null;
    pLluvia: number; nota: string;
}

function predice24h(e: EstacionConLectura): Pred24 {
    const l = e.lectura;
    const base: Omit<Pred24, 'cielo' | 'icono' | 'color' | 'etiqueta' | 'tMaxEsp' | 'tMinEsp' | 'etoEsp' | 'pLluvia' | 'nota'> =
        { estacion: e.nombre, lat: e.latitud, lon: e.longitud, enLinea: e.enLinea };
    if (!l) return { ...base, cielo: 'variable', icono: '○', color: '#94a3b8', etiqueta: 'sin datos', tMaxEsp: null, tMinEsp: null, etoEsp: null, pLluvia: 0, nota: 'Sin lectura reciente.' };

    const trend = l.bar_trend_hpa;           // hPa/3h
    const viento = l.viento_ms ?? 0;
    const hum = l.hum_rel_pct ?? 0;
    const AMPL = 14;                          // amplitud diurna típica (°C)
    const tActual = l.temp_c;
    const tMaxEsp = tActual != null ? +(tActual + AMPL * 0.55).toFixed(0) : null;
    const tMinEsp = tActual != null ? +(tActual - AMPL * 0.45).toFixed(0) : null;
    const etoEsp = l.eto_mm ?? l.et_dia_mm ?? null;

    // Probabilidad de lluvia (heurística meteorológica): la TENDENCIA barométrica
    // es el factor dominante. Presión subiendo → tiempo estable (suprime lluvia);
    // bajando → deterioro. La humedad solo suma cuando la presión NO está al alza
    // (una HR alta de madrugada es rocío normal, no señal de lluvia si la presión sube).
    let pLluvia = 0;
    const subiendo = trend != null && trend > 0.3;
    if (trend != null) {
        if (trend <= -2) pLluvia += 55;
        else if (trend <= -1) pLluvia += 40;
        else if (trend <= -0.3) pLluvia += 20;
        else if (trend >= 1) pLluvia -= 15;          // ascenso marcado = muy estable
    }
    if (!subiendo) {                                  // humedad solo si no hay ascenso
        if (hum >= 85) pLluvia += 20; else if (hum >= 75) pLluvia += 8;
    }
    if ((l.lluvia_24h_mm ?? 0) > 0.5) pLluvia += 15;  // ya llovió = sistema activo
    pLluvia = Math.max(0, Math.min(90, pLluvia));

    let cielo: Cielo, icono: string, color: string, etiqueta: string, nota: string;
    if (viento > 6) {
        cielo = 'ventoso'; icono = '💨'; color = '#f59e0b'; etiqueta = 'Ventoso';
        nota = `Viento sostenido ${viento.toFixed(1)} m/s; posible deriva en aspersión las próximas horas.`;
    } else if (pLluvia >= 45) {
        cielo = 'lluvia'; icono = '🌧️'; color = '#2563eb'; etiqueta = 'Probable lluvia';
        nota = `Presión ${trend != null ? (trend < 0 ? 'en descenso' : 'estable') : 's/tendencia'} y humedad ${hum.toFixed(0)} %: aumenta la probabilidad de precipitación.`;
    } else if (pLluvia >= 30 || (trend != null && trend < -0.3)) {
        cielo = 'variable'; icono = '⛅'; color = '#0ea5e9'; etiqueta = 'Variable';
        nota = `Presión ${trend != null && trend < 0 ? 'en descenso' : 'sin cambio marcado'}; condiciones cambiantes, vigilar evolución.`;
    } else {
        cielo = 'estable'; icono = '☀️'; color = '#eab308'; etiqueta = 'Estable / despejado';
        nota = `Presión ${trend != null && trend > 0 ? 'en ascenso' : 'estable'}: tiempo seco y demanda hídrica sostenida.`;
    }
    return { ...base, cielo, icono, color, etiqueta, tMaxEsp, tMinEsp, etoEsp, pLluvia, nota };
}

async function buildHTML(ests: EstacionConLectura[]): Promise<string> {
    const [logoSRL, logoSICA] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'),
        assetToDataURI('/logos/SICA005.png'),
    ]);

    const hoy = new Date().toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });
    const enLinea = ests.filter(e => e.enLinea);
    const etos = enLinea.map(e => e.lectura?.eto_mm).filter((v): v is number => v != null);
    const etoProm = etos.length ? etos.reduce((a, b) => a + b, 0) / etos.length : null;
    const gdds = ests.map(e => e.lectura?.gdd).filter((v): v is number => v != null);
    const gddProm = gdds.length ? gdds.reduce((a, b) => a + b, 0) / gdds.length : null;
    const lluviaTotal = ests.reduce((a, e) => a + (e.lectura?.lluvia_dia_mm ?? 0), 0);
    const an = analisisTecnico(ests, etoProm, gddProm, lluviaTotal);
    // Predicción por tendencia (nowcasting) a 24 h por estación en línea
    const preds = ests.filter(e => e.enLinea && e.lectura).map(predice24h);

    // Filas de la tabla de predicción 24 h
    const filasPred = preds.map(p => `<tr>
        <td><b>${p.estacion}</b></td>
        <td style="color:${p.color};font-weight:600">${p.icono} ${p.etiqueta}</td>
        <td>${p.tMinEsp != null ? p.tMinEsp + '°' : '—'} / <b>${p.tMaxEsp != null ? p.tMaxEsp + '°' : '—'}</b></td>
        <td>${p.pLluvia}%</td>
        <td>${p.etoEsp != null ? p.etoEsp.toFixed(1) + ' mm' : '—'}</td>
        <td style="font-size:0.74rem;color:#475569">${p.nota}</td>
    </tr>`).join('');

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

    const logoImg = (src: string, alt: string) => src
        ? `<img src="${src}" alt="${alt}" style="height:52px;width:auto;object-fit:contain">`
        : `<div style="height:52px;display:flex;align-items:center;color:#94a3b8;font-size:0.7rem">${alt}</div>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe Técnico de Clima — SRL Unidad Conchos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 26px; color: #1e293b; background: #fff; line-height: 1.5; }
  .wrap { max-width: 920px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 18px; border-bottom: 3px solid ${SRL_MARRON}; padding-bottom: 16px; margin-bottom: 22px; }
  header .titulo { flex: 1; }
  header .sub { color: #64748b; font-size: 0.78rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  header h1 { color: ${SRL_MARRON}; margin: 2px 0; font-size: 1.5rem; letter-spacing: -0.01em; }
  header .meta { color: #94a3b8; font-size: 0.74rem; }
  .logos { display: flex; align-items: center; gap: 14px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
  .kpi { border: 1px solid #e2e8f0; border-top: 3px solid ${AZUL}; border-radius: 10px; padding: 14px 12px; text-align: center; }
  .kpi:nth-child(2){border-top-color:#16a34a} .kpi:nth-child(3){border-top-color:#f59e0b} .kpi:nth-child(4){border-top-color:#3b82f6}
  .kpi .v { font-size: 1.5rem; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; }
  .kpi .l { font-size: 0.64rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin: 10px 0; }
  th { background: ${SRL_MARRON}; color: #fff; padding: 8px 6px; text-align: left; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.3px; }
  td { padding: 8px 6px; border-bottom: 1px solid #eef2f7; }
  tr.off td { opacity: 0.55; }
  .on { color: #16a34a; font-weight: 700; font-size: 0.72rem; }
  .offs { color: #94a3b8; font-size: 0.72rem; }
  small { color: #94a3b8; }
  h2 { color: ${SRL_MARRON}; font-size: 1.02rem; border-left: 4px solid ${SRL_MARRON}; padding-left: 9px; margin: 28px 0 10px; }
  .analisis { background: #f8fafc; border: 1px solid #eef2f7; border-radius: 10px; padding: 4px 16px; }
  .analisis h4 { color: ${AZUL}; font-size: 0.86rem; margin: 14px 0 4px; }
  .analisis p { font-size: 0.82rem; margin: 4px 0 12px; }
  .reco { list-style: none; padding: 0; margin: 6px 0; }
  .reco li { font-size: 0.82rem; padding: 7px 12px; margin: 6px 0; background: #eff6ff; border-left: 3px solid ${AZUL}; border-radius: 4px; }
  .pred-nota { font-size: 0.76rem; color: #64748b; font-style: italic; margin: 4px 0 10px; }
  .pred-tabla { margin-top: 12px; } .pred-tabla th { background: ${AZUL}; }
  .pred-tabla td { vertical-align: top; }
  .foot { margin-top: 32px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 0.7rem; color: #94a3b8; display: flex; justify-content: space-between; gap: 12px; }
  @media print { body { padding: 0; } .kpi, .analisis, table { break-inside: avoid; } }
</style></head><body><div class="wrap">
  <header>
    <div class="logos">${logoImg(logoSICA, 'SICA-005')}</div>
    <div class="titulo">
      <div class="sub">S R L Unidad Conchos · Delicias, Chihuahua</div>
      <h1>Informe Técnico Agroclimático</h1>
      <div class="meta">Distrito de Riego 005 · Red WeatherLink (Davis) · Generado: ${hoy}</div>
    </div>
    <div class="logos">${logoImg(logoSRL, 'SRL Unidad Conchos')}</div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="v">${enLinea.length}/${ests.length}</div><div class="l">Estaciones en línea</div></div>
    <div class="kpi"><div class="v">${etoProm != null ? etoProm.toFixed(2) : '—'}</div><div class="l">ETₒ media (mm/día)</div></div>
    <div class="kpi"><div class="v">${gddProm != null ? gddProm.toFixed(0) : '—'}</div><div class="l">GDD medio (°C-día)</div></div>
    <div class="kpi"><div class="v">${lluviaTotal.toFixed(1)}</div><div class="l">Lluvia total (mm)</div></div>
  </div>

  <h2>1. Estaciones y lecturas actuales</h2>
  <table>
    <thead><tr><th>Estación</th><th>Estado</th><th>Temp</th><th>HR</th><th>Viento</th><th>Lluvia día</th><th>ETₒ</th><th>GDD</th></tr></thead>
    <tbody>${filas}</tbody>
  </table>

  <h2>2. Ubicación geográfica</h2>
  ${mapaSVG(ests)}

  <h2>3. Análisis técnico</h2>
  <div class="analisis">
    <h4>Demanda hídrica y lámina de riego</h4>
    <p>${an.demanda}</p>
    <h4>Balance hídrico</h4>
    <p>${an.balance}</p>
    <h4>Condición térmica</h4>
    <p>${an.termico}</p>
    <h4>Viento y riego</h4>
    <p>${an.viento}</p>
  </div>

  ${preds.length ? `
  <h2>4. Predicción a 24 h (por tendencia)</h2>
  <p class="pred-nota">Nowcasting desde la señal real de cada estación (tendencia barométrica, humedad y viento). No sustituye un pronóstico meteorológico numérico; orienta la operación de las próximas 24 h.</p>
  ${mapaSVG(ests, preds)}
  <table class="pred-tabla">
    <thead><tr><th>Estación</th><th>Estado esperado</th><th>Temp mín/máx</th><th>Prob. lluvia</th><th>ETₒ esp.</th><th>Detalle</th></tr></thead>
    <tbody>${filasPred}</tbody>
  </table>` : ''}

  <h2>${preds.length ? '5' : '4'}. Recomendaciones operativas</h2>
  <ul class="reco">
    ${an.recomendaciones.map(r => `<li>${r}</li>`).join('')}
  </ul>

  <div class="foot">
    <span>Estaciones Davis/WeatherLink · conversión a métrico y ETₒ FAO-56 Penman-Monteith calculada por SICA-005.</span>
    <span>SRL Unidad Conchos · DR-005</span>
  </div>
</div></body></html>`;
}

/** Genera el informe técnico y lo descarga como archivo HTML autónomo. */
export async function exportClimaReport(ests: EstacionConLectura[]): Promise<void> {
    const html = await buildHTML(ests);
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
