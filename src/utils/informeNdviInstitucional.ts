// ═══════════════════════════════════════════════════════════════════════════
// INFORME INSTITUCIONAL NDVI — SRL Unidad Conchos / SICA-005
// ---------------------------------------------------------------------------
// HTML autocontenido con: plano general de los 6 módulos SRL con su CONTORNO
// REAL (fetch a public/geo/modulos.geojson al generar el informe — mismo
// mapeo GEOJSON_A_MODULO_SRL invertido que PlanoGeneralModulos.tsx/
// NdviModuloDetalle.tsx, no el bbox ni un contorno simplificado hardcodeado)
// coloreado por NDVI del mes más reciente, ficha de datos por módulo (NDVI,
// superficie, Kc, delta) y los 3 índices institucionales (ICV/IHR/IEHP, ver
// indicesSrl.ts), más el promedio SRL de cada índice y su evolución mensual.
//
// El fetch ocurre solo al GENERAR el informe (requiere estar en la app, con
// conexión); una vez el SVG queda dibujado y embebido en el HTML resultante,
// el archivo descargado ya no depende de red para verse — a diferencia del
// contorno, guardaOComparte() sigue entregando un documento 100% autónomo.
// ═══════════════════════════════════════════════════════════════════════════

import { guardaOComparte } from './descargaArchivo';
import { calcICV, calcIHR, calculaIndicesSrl, volumenAcumuladoPorModuloHm3, type IndiceSrl } from './indicesSrl';
import { getTodayString } from './dateHelpers';
import { assetToDataURI } from './exportClimaReport';
import { COLOR_MODULO_SRL, numeroGeojsonDeSRL } from './modulosSRL';

const SRL_MARRON = '#6B2D2D';

interface NdviModuloFila {
    numero_modulo: number;
    nombre_modulo: string;
    mes: string;
    ndvi_medio: number;
    ndvi_min: number | null;
    ndvi_max: number | null;
    ndvi_desv: number | null;
    kc_estimado: number | null;
    delta_ndvi: number | null;
    superficie_ha: number | null;
    fraccion_cobertura_activa: number | null;
    muestras_validas: number | null;
}

const MODULOS_SRL = [1, 2, 3, 4, 5, 12];

/** Contorno REAL de cada módulo SRL, leído de public/geo/modulos.geojson —
 *  mismo mapeo GEOJSON_A_MODULO_SRL invertido que PlanoGeneralModulos.tsx y
 *  NdviModuloDetalle.tsx. Devuelve, por módulo, la lista de anillos [lon,lat]
 *  (un Polygon trae 1 anillo exterior; un MultiPolygon puede traer varios —
 *  el plano dibuja todos, así ningún polígono real del módulo se recorta).
 *  Submuestrea a un máximo de puntos por anillo para no inflar el HTML con
 *  miles de vértices que a la escala del plano (560×480px) no aportan
 *  detalle visible. */
async function cargaContornosReales(maxPuntosPorAnillo = 220): Promise<Record<number, [number, number][][]>> {
    const resultado: Record<number, [number, number][][]> = {};
    try {
        const r = await fetch('/geo/modulos.geojson');
        if (!r.ok) return resultado;
        const fc = await r.json() as GeoJSON.FeatureCollection;
        for (const srl of MODULOS_SRL) {
            const numeroGeojson = numeroGeojsonDeSRL(srl);
            const feature = fc.features.find(f => Number(f.properties?.numero_modulo) === numeroGeojson);
            if (!feature) continue;
            const geom = feature.geometry;
            const anillosExternos: [number, number][][] =
                geom.type === 'Polygon' ? [geom.coordinates[0] as [number, number][]] :
                geom.type === 'MultiPolygon' ? geom.coordinates.map(p => p[0] as [number, number][]) :
                [];
            resultado[srl] = anillosExternos.map(anillo => submuestrea(anillo, maxPuntosPorAnillo));
        }
    } catch {
        // Sin conexión o geojson no disponible: el plano cae a "sin datos" —
        // no se inventa un contorno de respaldo.
    }
    return resultado;
}

function submuestrea(anillo: [number, number][], maxPuntos: number): [number, number][] {
    if (anillo.length <= maxPuntos) return anillo;
    const paso = anillo.length / maxPuntos;
    const salida: [number, number][] = [];
    for (let i = 0; i < maxPuntos; i++) salida.push(anillo[Math.floor(i * paso)]);
    salida.push(anillo[anillo.length - 1]); // cierra el anillo exactamente donde el original cierra
    return salida;
}

/** Rampa rojo→ámbar→verde para el relleno del plano — misma semántica de
 *  semáforo institucional que el resto de índices del proyecto. */
function colorRampa(t: number): string {
    const c = Math.max(0, Math.min(1, t));
    const lerp = (a: number, b: number, f: number) => Math.round(a + (b - a) * f);
    let r: number, g: number, b: number;
    if (c < 0.5) {
        const f = c / 0.5;
        r = lerp(0xd0, 0xd9, f); g = lerp(0x3b, 0x87, f); b = lerp(0x3b, 0x04, f);
    } else {
        const f = (c - 0.5) / 0.5;
        r = lerp(0xd9, 0x0c, f); g = lerp(0x87, 0xa3, f); b = lerp(0x04, 0x0c, f);
    }
    return `rgb(${r},${g},${b})`;
}

function calculaBboxComun(anillos: [number, number][][]) {
    const lons = anillos.flat().map(([lon]) => lon);
    const lats = anillos.flat().map(([, lat]) => lat);
    const minLonRaw = Math.min(...lons), maxLonRaw = Math.max(...lons);
    const minLatRaw = Math.min(...lats), maxLatRaw = Math.max(...lats);
    const margenLon = (maxLonRaw - minLonRaw) * 0.08 || 0.01;
    const margenLat = (maxLatRaw - minLatRaw) * 0.08 || 0.01;
    return {
        minLon: minLonRaw - margenLon, maxLon: maxLonRaw + margenLon,
        minLat: minLatRaw - margenLat, maxLat: maxLatRaw + margenLat,
        cosLat: Math.cos((minLatRaw + maxLatRaw) / 2 * Math.PI / 180),
    };
}

function anilloASvgPath(
    anillo: [number, number][],
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number },
    w: number, h: number,
): string {
    const spanLon = (bbox.maxLon - bbox.minLon) * bbox.cosLat;
    const spanLat = bbox.maxLat - bbox.minLat;
    const escala = Math.min(w / spanLon, h / spanLat);
    const offX = (w - spanLon * escala) / 2;
    const offY = (h - spanLat * escala) / 2;
    const pts = anillo.map(([lon, lat]) => {
        const x = offX + (lon - bbox.minLon) * bbox.cosLat * escala;
        const y = offY + (bbox.maxLat - lat) * escala;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${pts.join('L')}Z`;
}

function centroideAnillo(anillo: [number, number][]): [number, number] {
    const lons = anillo.map(([lon]) => lon), lats = anillo.map(([, lat]) => lat);
    return [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

const N2 = (v: number | null | undefined) => v != null && isFinite(v) ? v.toFixed(2) : 'S/D';
const N0 = (v: number | null | undefined) => v != null && isFinite(v) ? v.toFixed(0) : 'S/D';

/** Área aproximada (shoelace, en grados²) de un anillo — solo para elegir cuál
 *  anillo de un módulo multi-parte es el "principal" al ubicar la etiqueta,
 *  no requiere precisión de unidades reales. */
function areaAproximada(anillo: [number, number][]): number {
    let s = 0;
    for (let i = 0; i < anillo.length - 1; i++) {
        const [x0, y0] = anillo[i], [x1, y1] = anillo[i + 1];
        s += x0 * y1 - x1 * y0;
    }
    return Math.abs(s) / 2;
}

function planoSVG(filaPorModulo: Map<number, NdviModuloFila>, contornos: Record<number, [number, number][][]>, w = 560, h = 480): string {
    const todosLosAnillos = Object.values(contornos).flat();
    if (!todosLosAnillos.length) {
        return '<p style="color:#94a3b8">Sin contorno disponible para el plano (sin conexión al generar el informe).</p>';
    }
    const bbox = calculaBboxComun(todosLosAnillos);
    const spanLon = (bbox.maxLon - bbox.minLon) * bbox.cosLat;
    const spanLat = bbox.maxLat - bbox.minLat;
    const escala = Math.min(w / spanLon, h / spanLat);
    const offX = (w - spanLon * escala) / 2, offY = (h - spanLat * escala) / 2;
    const proyX = (lon: number) => offX + (lon - bbox.minLon) * bbox.cosLat * escala;
    const proyY = (lat: number) => offY + (bbox.maxLat - lat) * escala;

    const poligonos = MODULOS_SRL.filter(m => contornos[m]?.length).map(m => {
        const anillosModulo = contornos[m];
        const fila = filaPorModulo.get(m);
        const ndvi = fila?.ndvi_medio ?? null;
        const fill = ndvi != null ? colorRampa(ndvi) : '#e2e8f0';
        // Un solo <path> con un subpath "MZ" por anillo — soporta MultiPolygon
        // (ej. Módulo 12) sin dibujar polígonos separados sin relleno común.
        const path = anillosModulo.map(anillo => anilloASvgPath(anillo, bbox, w, h)).join(' ');
        const anilloPrincipal = anillosModulo.reduce((a, b) => areaAproximada(b) > areaAproximada(a) ? b : a);
        const [clon, clat] = centroideAnillo(anilloPrincipal);
        const cx = proyX(clon), cy = proyY(clat);
        return { path, fill, cx, cy, nombre: fila?.nombre_modulo ?? `Módulo ${m}`, ndvi };
    });

    const rects = poligonos.map(p => `<path d="${p.path}" fill-rule="evenodd" fill="${p.fill}" fill-opacity="0.78" stroke="#1e293b" stroke-width="1"/>`).join('');
    const labels = poligonos.map(p => `
        <text x="${p.cx.toFixed(1)}" y="${(p.cy - 6).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#1e293b" style="paint-order:stroke" stroke="#fff" stroke-width="3">${p.nombre}</text>
        <text x="${p.cx.toFixed(1)}" y="${(p.cy + 10).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="800" fill="#1e293b" style="paint-order:stroke" stroke="#fff" stroke-width="3">${p.ndvi != null ? p.ndvi.toFixed(2) : 'S/D'}</text>
    `).join('');

    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="auto" style="background:#f8fafc;border-radius:10px">
        ${rects}${labels}
    </svg>`;
}

function calcICVdesdeFila(f: NdviModuloFila): number | null {
    return calcICV({
        numeroModulo: f.numero_modulo, nombreModulo: f.nombre_modulo, ndviMedio: f.ndvi_medio,
        ndviDesv: f.ndvi_desv, fraccionCoberturaActiva: f.fraccion_cobertura_activa,
        superficieHa: f.superficie_ha, volumenAcumuladoHm3: null,
    }).valor;
}
function calcIHRdesdeFila(f: NdviModuloFila): number | null {
    return calcIHR({
        numeroModulo: f.numero_modulo, nombreModulo: f.nombre_modulo, ndviMedio: f.ndvi_medio,
        ndviDesv: f.ndvi_desv, fraccionCoberturaActiva: f.fraccion_cobertura_activa,
        superficieHa: f.superficie_ha, volumenAcumuladoHm3: null,
    }).valor;
}

function promedioSrl(valores: (number | null)[]): number | null {
    const validos = valores.filter((v): v is number => v != null);
    if (!validos.length) return null;
    return validos.reduce((a, b) => a + b, 0) / validos.length;
}

/** Color de texto legible (blanco/negro) sobre un fondo de la rampa rojo→
 *  ámbar→verde — la mitad inferior (rojo/ámbar oscuros) necesita texto
 *  blanco, la mitad superior (ámbar claro/verde) texto oscuro. */
function colorTextoSobreRampa(t: number): string {
    return t < 0.62 ? '#fff' : '#0f172a';
}

/** Tarjeta de promedio SRL con barra de progreso coloreada por la misma
 *  rampa semáforo del resto del informe — mismo lenguaje visual que el
 *  mapa de calor de las tablas de evolución y el plano. */
function tarjetaPromedio(label: string, valor: number | null, rango: [number, number], valorHtml: string): string {
    const [lo, hi] = rango;
    const t = valor != null ? Math.max(0, Math.min(1, (valor - lo) / (hi - lo))) : null;
    return `<div class="promedio-card">
        <div class="label">${label}</div>
        <div class="valor">${valorHtml}</div>
        <div class="barra-track"><div class="barra-fill" style="width:${t != null ? (t * 100).toFixed(0) : 0}%;background:${t != null ? colorRampa(t) : '#cbd5e1'}"></div></div>
    </div>`;
}

/** Tabla de evolución mensual de un índice, estilo mapa de calor (celda
 *  coloreada por la MISMA rampa rojo→ámbar→verde del plano y las tarjetas de
 *  índice — mismo lenguaje visual en todo el informe) — filas=módulo,
 *  columnas=mes. ICV/IHR se recalculan por cada mes histórico con
 *  calculaIndicesSrl (volumenAcumuladoHm3 null: el IEHP no participa de esta
 *  vista mensual, solo se reporta como corte del mes actual, ver filasTabla).
 *  `rango` normaliza el valor a [0,1] antes de mapearlo a color (NDVI usa
 *  [0,1] directo; ICV/IHR usan [0,100]). */
function tablaEvolucion(
    titulo: string,
    meses: string[],
    valorPorModuloYMes: (numeroModulo: number, mes: string) => number | null,
    decimales: number,
    rango: [number, number],
): string {
    const [lo, hi] = rango;
    const celdaHtml = (v: number | null) => {
        if (v == null) return `<td class="celda-vacia">—</td>`;
        const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        const bg = colorRampa(t);
        const color = colorTextoSobreRampa(t);
        return `<td style="background:${bg};color:${color}">${v.toFixed(decimales)}</td>`;
    };
    const filasHtml = MODULOS_SRL.map(m => {
        const celdas = meses.map(mes => celdaHtml(valorPorModuloYMes(m, mes))).join('');
        return `<tr><td class="col-modulo"><strong>Módulo ${m}</strong></td>${celdas}</tr>`;
    }).join('');
    const filaPromedio = `<tr class="fila-promedio"><td class="col-modulo">Promedio SRL</td>${
        meses.map(mes => celdaHtml(promedioSrl(MODULOS_SRL.map(m => valorPorModuloYMes(m, mes))))).join('')
    }</tr>`;
    return `<table class="tabla-evolucion">
        <caption>${titulo}</caption>
        <thead><tr><th class="col-modulo">Módulo</th>${meses.map(m => `<th>${m}</th>`).join('')}</tr></thead>
        <tbody>${filasHtml}${filaPromedio}</tbody>
    </table>`;
}

async function buildHTML(filas: NdviModuloFila[]): Promise<string> {
    const [logoSrl, logoSica, contornosReales] = await Promise.all([
        assetToDataURI('/logos/logo-srl.png'),
        assetToDataURI('/logos/SICA005.png'),
        cargaContornosReales(),
    ]);
    const logoImg = (src: string, alt: string) => src
        ? `<img src="${src}" alt="${alt}" style="height:48px;width:auto;object-fit:contain">`
        : '';

    const meses = Array.from(new Set(filas.map(f => f.mes))).sort();
    const mesActual = meses[meses.length - 1] ?? null;
    const filaPorModulo = new Map<number, NdviModuloFila>();
    for (const f of filas) filaPorModulo.set(f.numero_modulo, f); // ascendente por mes: la última sobrescribe

    const { porModulo: volAcumulado, ultimoMesEsParcial } = mesActual
        ? await volumenAcumuladoPorModuloHm3(mesActual)
        : { porModulo: new Map<number, number>(), ultimoMesEsParcial: false };

    const indicesPorModulo = new Map<number, IndiceSrl[]>();
    for (const m of MODULOS_SRL) {
        const fila = filaPorModulo.get(m);
        indicesPorModulo.set(m, calculaIndicesSrl({
            numeroModulo: m,
            nombreModulo: fila?.nombre_modulo ?? `Módulo ${m}`,
            ndviMedio: fila?.ndvi_medio ?? null,
            ndviDesv: fila?.ndvi_desv ?? null,
            fraccionCoberturaActiva: fila?.fraccion_cobertura_activa ?? null,
            superficieHa: fila?.superficie_ha ?? null,
            volumenAcumuladoHm3: volAcumulado.get(m) ?? null,
        }));
    }

    const promICV = promedioSrl(MODULOS_SRL.map(m => indicesPorModulo.get(m)?.find(i => i.clave === 'ICV')?.valor ?? null));
    const promIHR = promedioSrl(MODULOS_SRL.map(m => indicesPorModulo.get(m)?.find(i => i.clave === 'IHR')?.valor ?? null));
    const promNdvi = promedioSrl(MODULOS_SRL.map(m => filaPorModulo.get(m)?.ndvi_medio ?? null));

    // Serie histórica completa (marzo→mes actual), para las tablas de
    // evolución mensual — a diferencia de indicesPorModulo (arriba), que solo
    // usa la fila más reciente de cada módulo.
    const filaPorModuloYMes = new Map<string, NdviModuloFila>();
    for (const f of filas) filaPorModuloYMes.set(`${f.numero_modulo}|${f.mes}`, f);
    const ndviPorModuloYMes = (m: number, mes: string) => filaPorModuloYMes.get(`${m}|${mes}`)?.ndvi_medio ?? null;
    const icvPorModuloYMes = (m: number, mes: string) => {
        const f = filaPorModuloYMes.get(`${m}|${mes}`);
        if (!f) return null;
        return calcICVdesdeFila(f);
    };
    const ihrPorModuloYMes = (m: number, mes: string) => {
        const f = filaPorModuloYMes.get(`${m}|${mes}`);
        if (!f) return null;
        return calcIHRdesdeFila(f);
    };

    const celdaIndiceHtml = (v: number | null | undefined, rango: [number, number], decimales = 0) => {
        if (v == null) return `<td>S/D</td>`;
        const [lo, hi] = rango;
        const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        return `<td style="background:${colorRampa(t)};color:${colorTextoSobreRampa(t)};font-weight:700;border-radius:6px">${v.toFixed(decimales)}</td>`;
    };
    const filasTabla = MODULOS_SRL.map(m => {
        const fila = filaPorModulo.get(m);
        const ix = indicesPorModulo.get(m) ?? [];
        const icv = ix.find(i => i.clave === 'ICV');
        const ihr = ix.find(i => i.clave === 'IHR');
        const iehp = ix.find(i => i.clave === 'IEHP');
        return `<tr>
            <td style="border-left:4px solid ${COLOR_MODULO_SRL[m] ?? '#94a3b8'}"><strong>${fila?.nombre_modulo ?? `Módulo ${m}`}</strong></td>
            <td style="font-family:ui-monospace,'SF Mono',Consolas,monospace">${N2(fila?.ndvi_medio)}</td>
            <td style="font-family:ui-monospace,'SF Mono',Consolas,monospace;color:${fila?.delta_ndvi != null ? (fila.delta_ndvi >= 0 ? '#16a34a' : '#dc2626') : 'inherit'}">${fila?.delta_ndvi != null ? (fila.delta_ndvi >= 0 ? '+' : '') + fila.delta_ndvi.toFixed(3) : 'S/D'}</td>
            <td>${fila?.superficie_ha != null ? fila.superficie_ha.toLocaleString() : 'S/D'}</td>
            <td>${fila?.kc_estimado != null ? fila.kc_estimado.toFixed(2) : 'S/D'}</td>
            ${celdaIndiceHtml(icv?.valor, [0, 100])}
            ${celdaIndiceHtml(ihr?.valor, [0, 100])}
            <td style="font-family:ui-monospace,'SF Mono',Consolas,monospace">${iehp?.valor != null ? iehp.valor.toFixed(1) : 'S/D'}</td>
        </tr>`;
    }).join('');

    const plano = filaPorModulo.size ? planoSVG(filaPorModulo, contornosReales) : '<p style="color:#94a3b8">Sin datos suficientes para el plano.</p>';

    const tablaNdvi = tablaEvolucion('NDVI', meses, ndviPorModuloYMes, 3, [0, 1]);
    const tablaIcv = tablaEvolucion('ICV (0–100)', meses, icvPorModuloYMes, 0, [0, 100]);
    const tablaIhr = tablaEvolucion('IHR (0–100)', meses, ihrPorModuloYMes, 0, [0, 100]);

    const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });

    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe Institucional NDVI — SRL Unidad Conchos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 26px; color: #1e293b; background: #fff; line-height: 1.5; }
  .wrap { max-width: 980px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 18px; border-bottom: 3px solid ${SRL_MARRON}; padding-bottom: 16px; margin-bottom: 22px; }
  header .titulo { flex: 1; min-width: 0; }
  header .sub { color: #64748b; font-size: 0.78rem; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; }
  header h1 { color: ${SRL_MARRON}; margin: 4px 0; font-size: 1.6rem; letter-spacing: -0.01em; }
  header .meta { color: #94a3b8; font-size: 0.78rem; }
  header .logos { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
  h2.seccion { color: ${SRL_MARRON}; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin: 32px 0 14px; }
  .grid-plano { display: grid; grid-template-columns: 1.1fr 1fr; gap: 24px; align-items: start; }
  @media (max-width: 720px) { .grid-plano { grid-template-columns: 1fr; } }
  .promedio-card { border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; background: #f8fafc; text-align: center; margin-bottom: 12px; overflow: hidden; }
  .promedio-card .label { font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  .promedio-card .valor { font-size: 2.2rem; font-weight: 900; color: ${SRL_MARRON}; margin: 4px 0; font-family: ui-monospace, 'SF Mono', Consolas, monospace; }
  .promedio-card .barra-track { height: 8px; border-radius: 999px; background: #e2e8f0; margin-top: 10px; overflow: hidden; }
  .promedio-card .barra-fill { height: 100%; border-radius: 999px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 10px; }
  th { background: ${SRL_MARRON}; color: #fff; padding: 8px 7px; text-align: left; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.03em; }
  td { padding: 7px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #f8fafc; }
  .grid-evolucion { display: flex; flex-direction: column; gap: 24px; }
  .tabla-evolucion { font-size: 0.76rem; border-spacing: 3px; border-collapse: separate; width: 100%; }
  .tabla-evolucion caption { text-align: left; font-weight: 800; color: ${SRL_MARRON}; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; padding-bottom: 8px; }
  .tabla-evolucion th { background: transparent; color: #64748b; text-align: center; font-size: 0.66rem; padding: 4px; }
  .tabla-evolucion td { text-align: center; border: none; border-radius: 6px; font-weight: 700; font-family: ui-monospace, 'SF Mono', Consolas, monospace; padding: 8px 4px; }
  .tabla-evolucion .col-modulo { text-align: left !important; background: transparent !important; color: #1e293b; font-family: inherit; font-weight: 600; padding-left: 4px; }
  .tabla-evolucion .celda-vacia { background: #f1f5f9; color: #cbd5e1; font-weight: 400; }
  .tabla-evolucion .fila-promedio td:not(.col-modulo) { box-shadow: inset 0 0 0 2px ${SRL_MARRON}; }
  .tabla-evolucion .fila-promedio .col-modulo { font-weight: 800; }
  .nota-metodologica { font-size: 0.76rem; color: #64748b; background: #f8fafc; border-left: 3px solid ${SRL_MARRON}; padding: 10px 14px; margin-top: 18px; border-radius: 0 8px 8px 0; }
  .foot { margin-top: 36px; padding-top: 15px; border-top: 2px solid ${SRL_MARRON}; font-size: 0.72rem; color: #94a3b8; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .foot b { color: ${SRL_MARRON}; }
</style>
</head><body><div class="wrap">
  <header>
    <div class="titulo">
      <div class="sub">Centro de Inteligencia Agroclimática · SICA-005</div>
      <h1>Informe Institucional NDVI — SRL Unidad Conchos</h1>
      <div class="meta">Generado el ${hoy} · Mes de referencia: ${mesActual ?? 'S/D'} · Polígono exacto por módulo, Sentinel-2 (Statistical API)</div>
    </div>
    <div class="logos">
      ${logoImg(logoSrl, 'SRL Unidad Conchos')}
      ${logoImg(logoSica, 'SICA-005')}
    </div>
  </header>

  <h2 class="seccion">Plano General — NDVI, ${mesActual ?? 'S/D'}</h2>
  <div class="grid-plano">
    <div>${plano}</div>
    <div>
      ${tarjetaPromedio('Promedio SRL — NDVI', promNdvi, [0, 1], N2(promNdvi))}
      ${tarjetaPromedio('Promedio SRL — ICV', promICV, [0, 100], `${N0(promICV)}<span style="font-size:1rem">/100</span>`)}
      ${tarjetaPromedio('Promedio SRL — IHR', promIHR, [0, 100], `${N0(promIHR)}<span style="font-size:1rem">/100</span>`)}
    </div>
  </div>

  <h2 class="seccion">Datos por Módulo — ${mesActual ?? 'S/D'}</h2>
  <table>
    <thead><tr>
      <th>Módulo</th><th>NDVI</th><th>Δ vs. mes ant.</th><th>Superficie (ha)</th><th>Kc est.</th>
      <th>ICV</th><th>IHR</th><th>IEHP (ha/hm³)</th>
    </tr></thead>
    <tbody>${filasTabla}</tbody>
  </table>

  <h2 class="seccion">Evolución Mensual por Índice — ${meses[0] ?? 'S/D'} a ${mesActual ?? 'S/D'}</h2>
  <div class="grid-evolucion">
    ${tablaNdvi}
    ${tablaIcv}
    ${tablaIhr}
  </div>

  <div class="nota-metodologica">
    <strong>Metodología:</strong> NDVI calculado sobre el polígono exacto de cada módulo (Sentinel-2 L2A, Statistical API,
    ventana de 30 días, filtro de nubosidad ≤40%). ICV escala el NDVI a 0–100 con piso 0.10 (suelo desnudo) y techo 0.75
    (vigor pleno). IHR es el coeficiente de variación espacial invertido (100×(1−desv/media)). IEHP relaciona hectáreas
    con cobertura vegetal activa (NDVI≥0.30) contra el volumen entregado acumulado del ciclo agrícola (marzo→mes de
    referencia). Volumen: carga institucional provisional (hoja "Acumulado General" SRL, no la captura operativa diaria)
    — tabla volumen_modulo_mensual_provisional.${ultimoMesEsParcial ? ` <strong>El mes de referencia (${mesActual}) es
    PARCIAL</strong> (no cubre el mes calendario completo) — el IEHP de este corte no es directamente comparable con
    meses completos anteriores.` : ''} Los índices IEH (estrés hídrico) e ISH (satisfacción hídrica) requieren ETa
    satelital real y temperatura superficial (LST) — fuentes de datos distintas a Sentinel-2 — y quedan pendientes para
    una fase posterior.
  </div>

  <div class="foot">
    <span>
      <b>Centro de Inteligencia Agroclimática · SICA-005</b><br>
      NDVI: Sentinel-2 L2A (Copernicus/Sentinel Hub) · Volumen entregado: captura operativa SRL.<br>
      Documento generado automáticamente.
    </span>
    <span>
      SRL Unidad Conchos<br>
      <em>Distrito de Riego 005 · Delicias, Chih.</em>
    </span>
  </div>
</div></body></html>`;
}

/** Genera el informe institucional NDVI y lo entrega como archivo HTML autónomo. */
export async function generarInformeInstitucional(filas: NdviModuloFila[]): Promise<void> {
    const html = await buildHTML(filas);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
    const date = getTodayString();
    await guardaOComparte(blob, `informe-ndvi-institucional-conchos-${date}.html`, 'text/html');
}
