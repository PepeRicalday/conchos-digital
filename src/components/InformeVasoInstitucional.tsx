/**
 * InformeVasoInstitucional.tsx — Informe institucional SRL Conchos / SICA 005
 * de Manejo de Vaso: tendencias, polígonos, área y perímetro por mes.
 * Mismo mecanismo que InformeTendencias.tsx — HTML autocontenido en iframe
 * (preview) con botón de impresión/PDF en pestaña nueva.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import './CanalReport.css';

interface GeometriaVasoFila {
    fecha_escena: string;
    area_km2: number;
    perimetro_km: number;
    num_islas: number;
    ratio_elongacion: number | null;
    delta_area_km2: number | null;
    pct_del_maximo_ciclo: number | null;
    contorno_geojson: { type: 'Polygon'; coordinates: [number, number][][] };
}

interface FilaValidacionCruzada {
    fecha_escena: string;
    areaSatelite: number;
    sinReferencia: boolean;
    fechaLectura?: string;
    escalaLectura?: number;
    diasDiferencia?: number;
    areaEsperadaKm2?: number;
    pctCoincidencia?: number | null;
}

export interface InformeVasoInstitucionalProps {
    nombrePresa: string;
    historico: GeometriaVasoFila[];
    validacionCruzada?: FilaValidacionCruzada[];
    onClose: () => void;
}

const N1 = (v: number | null | undefined) => v != null && isFinite(v) ? v.toFixed(1) : '—';
const N0 = (v: number | null | undefined) => v != null && isFinite(v) ? v.toFixed(0) : '—';

function calculaBboxComun(anillosExteriores: [number, number][][]) {
    const lons = anillosExteriores.flat().map(([lon]) => lon);
    const lats = anillosExteriores.flat().map(([, lat]) => lat);
    const minLonRaw = Math.min(...lons), maxLonRaw = Math.max(...lons);
    const minLatRaw = Math.min(...lats), maxLatRaw = Math.max(...lats);
    const margenLon = (maxLonRaw - minLonRaw) * 0.1 || 0.01;
    const margenLat = (maxLatRaw - minLatRaw) * 0.1 || 0.01;
    return {
        minLon: minLonRaw - margenLon, maxLon: maxLonRaw + margenLon,
        minLat: minLatRaw - margenLat, maxLat: maxLatRaw + margenLat,
        cosLat: Math.cos((minLatRaw + maxLatRaw) / 2 * Math.PI / 180),
    };
}

function anilloASvgPath(
    anillo: [number, number][],
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number },
    w: number, h: number
): string {
    const spanLon = (bbox.maxLon - bbox.minLon) * bbox.cosLat;
    const spanLat = bbox.maxLat - bbox.minLat;
    const escala = Math.min(w / spanLon, h / spanLat);
    const offX = (w - spanLon * escala) / 2;
    const offY = (h - spanLat * escala) / 2;
    const pts = anillo.map(([lon, lat]) => {
        const x = offX + (lon - bbox.minLon) * bbox.cosLat * escala;
        const y = offY + (bbox.maxLat - lat) * escala;
        return x.toFixed(1) + ',' + y.toFixed(1);
    });
    return 'M' + pts.join('L') + 'Z';
}

function poligonoASvgPath(
    coordinates: [number, number][][],
    bbox: { minLon: number; maxLon: number; minLat: number; maxLat: number; cosLat: number },
    w: number, h: number, areaMinIslaPx2 = 6
): string {
    return coordinates
        .map((anillo, i) => {
            if (i === 0) return anilloASvgPath(anillo, bbox, w, h);
            const path = anilloASvgPath(anillo, bbox, w, h);
            const xs = anillo.map(([lon]) => lon);
            const spanLonPx = (Math.max(...xs) - Math.min(...xs)) * bbox.cosLat * Math.min(w / ((bbox.maxLon - bbox.minLon) * bbox.cosLat), h / (bbox.maxLat - bbox.minLat));
            return spanLonPx * spanLonPx >= areaMinIslaPx2 ? path : '';
        })
        .filter(Boolean)
        .join(' ');
}

const InformeVasoInstitucional: React.FC<InformeVasoInstitucionalProps> = ({ nombrePresa, historico, validacionCruzada = [], onClose }) => {
    const generateHtml = useCallback(() => {
        const now = new Date();
        const dateDMY = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' });
        const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' });
        const logoUrl = window.location.origin + '/logos/logo-srl.png';

        const serie = [...historico].sort((a, b) => a.fecha_escena.localeCompare(b.fecha_escena));
        const primero = serie[0] ?? null;
        const ultimo = serie.length ? serie[serie.length - 1] : null;
        const deltaArea = primero && ultimo ? ultimo.area_km2 - primero.area_km2 : null;
        const deltaPerimetro = primero && ultimo ? ultimo.perimetro_km - primero.perimetro_km : null;
        const areaMax = serie.reduce((m, f) => Math.max(m, f.area_km2), 0);
        const areaMin = serie.length ? serie.reduce((m, f) => Math.min(m, f.area_km2), Infinity) : null;
        const fechaDMY = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });
        const mesLargoDMY = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' });

        // ── Galería de polígonos: un mini-mapa por mes, todos sobre el MISMO
        // bbox (unión de todos los meses) para que el tamaño relativo del
        // vaso sea comparable de una tarjeta a otra a simple vista. ──
        const galeriaHtml = (() => {
            if (!serie.length) return '<div class="empty">Sin meses registrados para esta presa todavía.</div>';
            const W = 200, H = 130;
            const bbox = calculaBboxComun(serie.map(f => f.contorno_geojson.coordinates[0]));
            return '<div class="galeria">' + serie.map(f => {
                const path = poligonoASvgPath(f.contorno_geojson.coordinates, bbox, W, H);
                return '<div class="galeria-item">'
                    + '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:#fbfaf8;border-radius:4px">'
                    + '<path d="' + path + '" fill="rgba(107,45,45,0.16)" stroke="#6B2D2D" stroke-width="1.4" fill-rule="evenodd"/>'
                    + '</svg>'
                    + '<div class="galeria-fecha">' + fechaDMY(f.fecha_escena) + '</div>'
                    + '<div class="galeria-kpi">' + N1(f.area_km2) + ' km²</div>'
                    + '</div>';
            }).join('') + '</div>';
        })();

        // ── Mini-mapa comparativo apertura vs. más reciente (2 contornos superpuestos) ──
        const comparativoHtml = (() => {
            if (!primero || !ultimo || primero === ultimo) return '';
            const W = 640, H = 320;
            const bbox = calculaBboxComun([primero.contorno_geojson.coordinates[0], ultimo.contorno_geojson.coordinates[0]]);
            const pathPrimero = poligonoASvgPath(primero.contorno_geojson.coordinates, bbox, W, H);
            const pathUltimo = poligonoASvgPath(ultimo.contorno_geojson.coordinates, bbox, W, H);
            return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:#fbfaf8;border-radius:6px">'
                + '<path d="' + pathPrimero + '" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 4" fill-rule="evenodd"/>'
                + '<path d="' + pathUltimo + '" fill="rgba(107,45,45,0.16)" stroke="#6B2D2D" stroke-width="2.5" fill-rule="evenodd"/>'
                + '</svg>'
                + '<div style="display:flex;gap:16px;margin-top:6px;font-size:7pt;color:#555">'
                + '<span><i style="display:inline-block;width:9px;height:9px;border:2px dashed #94a3b8;border-radius:2px;margin-right:4px"></i>Apertura de ciclo (' + fechaDMY(primero.fecha_escena) + ')</span>'
                + '<span><i style="display:inline-block;width:9px;height:9px;background:rgba(107,45,45,0.25);border:2px solid #6B2D2D;border-radius:2px;margin-right:4px"></i>Más reciente (' + fechaDMY(ultimo.fecha_escena) + ')</span>'
                + '</div>';
        })();

        // ── Gráfica de tendencia: área (línea sólida) + perímetro (línea punteada, eje secundario) ──
        const tendenciaChartHtml = (() => {
            if (serie.length < 2) return '<div class="empty">Se requieren al menos 2 meses para graficar la tendencia.</div>';
            const W = 680, H = 190, PL = 40, PR = 40, PT = 10, PB = 26;
            const pw = W - PL - PR, ph = H - PT - PB;
            const n = serie.length;
            const xS = (i: number) => PL + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
            const areas = serie.map(f => f.area_km2);
            const perimetros = serie.map(f => f.perimetro_km);
            let aMin = Math.min(...areas), aMax = Math.max(...areas);
            const aPad = (aMax - aMin) * 0.15 || 0.5; aMin -= aPad; aMax += aPad;
            let pMin = Math.min(...perimetros), pMax = Math.max(...perimetros);
            const pPad = (pMax - pMin) * 0.15 || 0.5; pMin -= pPad; pMax += pPad;
            const yA = (v: number) => PT + ph - ((v - aMin) / Math.max(1e-6, aMax - aMin)) * ph;
            const yP = (v: number) => PT + ph - ((v - pMin) / Math.max(1e-6, pMax - pMin)) * ph;
            let grid = '';
            for (let i = 0; i <= 4; i++) {
                const y = PT + (i / 4) * ph;
                grid += '<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (PL + pw) + '" y2="' + y.toFixed(1) + '" stroke="#e5e0e0" stroke-width="0.6"/>';
            }
            const dArea = areas.map((v, i) => (i ? 'L' : 'M') + xS(i).toFixed(1) + ',' + yA(v).toFixed(1)).join(' ');
            const dPerim = perimetros.map((v, i) => (i ? 'L' : 'M') + xS(i).toFixed(1) + ',' + yP(v).toFixed(1)).join(' ');
            const areaFill = 'M' + xS(0).toFixed(1) + ',' + (PT + ph) + ' ' + areas.map((v, i) => 'L' + xS(i).toFixed(1) + ',' + yA(v).toFixed(1)).join(' ') + ' L' + xS(n - 1).toFixed(1) + ',' + (PT + ph) + ' Z';
            const puntos = areas.map((v, i) => '<circle cx="' + xS(i).toFixed(1) + '" cy="' + yA(v).toFixed(1) + '" r="2.2" fill="#6B2D2D"/>').join('');
            const ejeX = serie.map((f, i) => {
                const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
                return '<text x="' + xS(i).toFixed(1) + '" y="' + (H - 6) + '" font-size="6.3" fill="#888" text-anchor="' + anchor + '" font-family="monospace">'
                    + new Date(f.fecha_escena).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'America/Chihuahua' }) + '</text>';
            }).join('');
            const legend = '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:12px"><i style="width:7px;height:7px;background:#6B2D2D;display:inline-block;border-radius:1px"></i>Área (km²)</span>'
                + '<span style="display:inline-flex;align-items:center;gap:3px"><i style="width:12px;height:2px;background:#b08968;display:inline-block"></i>Perímetro (km)</span>';
            return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:#fbfaf8;border-radius:4px">'
                + grid
                + '<path d="' + areaFill + '" fill="rgba(107,45,45,0.08)"/>'
                + '<path d="' + dArea + '" fill="none" stroke="#6B2D2D" stroke-width="1.8"/>'
                + '<path d="' + dPerim + '" fill="none" stroke="#b08968" stroke-width="1.6" stroke-dasharray="5,3"/>'
                + puntos + ejeX + '</svg>'
                + '<div style="font-size:6.5pt;color:#555;margin-top:3px">' + legend + '</div>';
        })();

        // ── Tabla mensual detallada ──
        const filasTabla = serie.map((f, i) => {
            const prev = i > 0 ? serie[i - 1] : null;
            const deltaMes = prev ? f.area_km2 - prev.area_km2 : null;
            const tColor = deltaMes == null ? '#888' : deltaMes > 0.5 ? '#16a34a' : deltaMes < -0.5 ? '#dc2626' : '#555';
            return '<tr>'
                + '<td class="bold">' + mesLargoDMY(f.fecha_escena) + '</td>'
                + '<td class="num">' + N1(f.area_km2) + '</td>'
                + '<td class="num">' + N0(f.perimetro_km) + '</td>'
                + '<td class="num" style="color:' + tColor + '">' + (deltaMes != null ? (deltaMes >= 0 ? '+' : '') + N1(deltaMes) : '—') + '</td>'
                + '<td class="num">' + f.num_islas + '</td>'
                + '<td class="num">' + (f.ratio_elongacion != null ? f.ratio_elongacion.toFixed(2) : '—') + '</td>'
                + '<td class="num">' + (f.pct_del_maximo_ciclo != null ? N0(f.pct_del_maximo_ciclo) + '%' : '—') + '</td>'
                + '</tr>';
        }).join('') || '<tr><td colspan="7" class="empty">Sin registros mensuales disponibles</td></tr>';

        // ── Hallazgos automáticos ──
        const hallazgos: string[] = [];
        if (serie.length < 2) {
            hallazgos.push('Histórico insuficiente para calcular tendencia: se requieren al menos 2 meses con escena satelital válida.');
        } else {
            if (deltaArea != null) {
                if (deltaArea < -1) hallazgos.push('<strong>Contracción neta del ciclo:</strong> el vaso perdió ' + N1(Math.abs(deltaArea)) + ' km² de superficie entre ' + fechaDMY(primero!.fecha_escena) + ' y ' + fechaDMY(ultimo!.fecha_escena) + '.');
                else if (deltaArea > 1) hallazgos.push('<strong>Expansión neta del ciclo:</strong> el vaso ganó ' + N1(deltaArea) + ' km² de superficie entre ' + fechaDMY(primero!.fecha_escena) + ' y ' + fechaDMY(ultimo!.fecha_escena) + '.');
                else hallazgos.push('<strong>Superficie estable:</strong> variación neta menor a 1 km² entre apertura de ciclo y la imagen más reciente.');
            }
            const mesesFaltantes = serie.length >= 2 ? Math.round((new Date(ultimo!.fecha_escena).getTime() - new Date(primero!.fecha_escena).getTime()) / (30 * 864e5)) + 1 - serie.length : 0;
            if (mesesFaltantes > 0) hallazgos.push('<strong>Cobertura incompleta:</strong> ' + mesesFaltantes + ' mes(es) del periodo no tienen escena Sentinel-2 confiable (nubosidad excesiva o bbox insuficiente) — no se registraron como cero, quedaron como hueco.');
            if (ultimo?.pct_del_maximo_ciclo != null && ultimo.pct_del_maximo_ciclo < 70) hallazgos.push('<strong>Por debajo del máximo del ciclo:</strong> la superficie más reciente equivale solo al ' + N0(ultimo.pct_del_maximo_ciclo) + '% del máximo alcanzado en lo que va del ciclo agrícola.');
        }
        const conReferencia = validacionCruzada.filter(v => !v.sinReferencia && v.pctCoincidencia != null);
        if (conReferencia.length) {
            const desviosGrandes = conReferencia.filter(v => Math.abs((v.pctCoincidencia ?? 100) - 100) > 12);
            if (desviosGrandes.length) hallazgos.push('<strong>Validación cruzada con desviación relevante:</strong> ' + desviosGrandes.length + ' mes(es) donde el área satelital difiere más de 12% del área esperada por la curva batimétrica oficial — revisar azolve, error de escala o desfase de fechas.');
            else hallazgos.push('<strong>Validación cruzada consistente:</strong> el área medida por satélite coincide dentro de un margen razonable con el área esperada por la curva batimétrica oficial en los meses con lectura de campo cercana.');
        }
        if (!hallazgos.length) hallazgos.push('Sin variaciones relevantes detectadas automáticamente en el periodo analizado.');
        const hallazgosHtml = hallazgos.map(h => '<div class="obs-item"><span class="obs-icon">&#8226;</span><div>' + h + '</div></div>').join('');

        // ── Validación cruzada: satélite (NDWI) vs. curva batimétrica oficial ──
        const validacionHtml = (() => {
            if (!conReferencia.length) return '';
            const filas = conReferencia.map(v => {
                const pct = v.pctCoincidencia!;
                const desvio = Math.abs(pct - 100);
                const color = desvio <= 5 ? '#16a34a' : desvio <= 12 ? '#d97706' : '#dc2626';
                return '<tr>'
                    + '<td class="bold">' + fechaDMY(v.fecha_escena) + '</td>'
                    + '<td class="num">' + N1(v.areaSatelite) + '</td>'
                    + '<td class="num">' + N1(v.areaEsperadaKm2) + '</td>'
                    + '<td class="num" style="color:' + color + ';font-weight:800">' + pct.toFixed(0) + '%</td>'
                    + '<td style="font-size:6.8pt;color:#666">' + fechaDMY(v.fechaLectura!) + ' (' + v.diasDiferencia + ' día' + (v.diasDiferencia === 1 ? '' : 's') + ')</td>'
                    + '</tr>';
            }).join('');
            return '<div class="sec-block" style="margin-top:8px">'
                + '<div class="sec-title">Validación Cruzada <small>satélite (NDWI) vs. curva batimétrica oficial</small></div>'
                + '<table><thead><tr><th>Mes</th><th class="num">Área satélite (km²)</th><th class="num">Área esperada (km²)</th><th class="num">Coincidencia</th><th>Lectura de campo usada</th></tr></thead>'
                + '<tbody>' + filas + '</tbody></table>'
                + '<div class="nota">Área esperada = interpolación de la curva Elevación-Área-Capacidad oficial CONAGUA sobre la escala de la lectura de campo más cercana en fecha (máx. 20 días de diferencia). 100% = coincidencia perfecta; desviaciones grandes pueden indicar azolve, error de escala, o simplemente el desfase de días entre ambas mediciones — no se comparan meses sin lectura de campo cercana.</div>'
                + '</div>';
        })();

        // ── CSS (mismo sistema visual que InformeTendencias.tsx, paleta SRL) ──
        const css = '@page{size:letter portrait;margin:10mm 12mm}'
            + '*{box-sizing:border-box;margin:0;padding:0}'
            + 'body{font-family:"Helvetica Neue",Arial,sans-serif;font-size:8.5pt;color:#1a1a1a;background:#fff}'
            + '.hdr{display:flex;justify-content:space-between;align-items:stretch;border-bottom:3px solid #6B2D2D;margin-bottom:8px;padding-bottom:7px;gap:12px}'
            + '.hdr-left{display:flex;align-items:center;gap:10px}'
            + '.hdr-logo{width:52px;height:52px;object-fit:contain}'
            + '.hdr-org{font-size:13pt;font-weight:900;color:#6B2D2D;letter-spacing:1px;line-height:1.1}'
            + '.hdr-sys{font-size:8pt;color:#555;font-weight:600;letter-spacing:0.5px}'
            + '.hdr-rpt{font-size:9pt;font-weight:800;color:#1a1a1a;letter-spacing:0.3px;margin-top:2px}'
            + '.hdr-canal{font-size:7.5pt;color:#444}'
            + '.hdr-right{display:flex;flex-direction:column;justify-content:center;gap:4px;text-align:right;font-size:7.5pt;color:#333;border-left:1px solid #e0d8d8;padding-left:12px}'
            + '.hdr-meta-row{display:flex;align-items:center;gap:5px;justify-content:flex-end}'
            + '.hdr-meta-key{color:#888;font-size:6.5pt;text-transform:uppercase}'
            + '.hdr-meta-val{font-weight:700;color:#6B2D2D}'
            + '.hdr-meta-big{font-size:11pt;font-weight:900;color:#6B2D2D}'
            + '.sec-title{font-size:7pt;font-weight:800;color:#fff;background:#6B2D2D;text-transform:uppercase;letter-spacing:1.2px;padding:3px 8px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center}'
            + '.sec-title small{font-weight:600;letter-spacing:0;text-transform:none;opacity:0.85}'
            + 'table{width:100%;border-collapse:collapse;font-size:7.5pt;margin-bottom:6px}'
            + 'th{background:#6B2D2D;color:#fff;padding:3px 5px;text-align:left;font-size:7pt;font-weight:700}'
            + 'td{padding:2.5px 5px;border-bottom:1px solid #f0eded}'
            + 'tr:nth-child(even) td{background:#faf8f8}'
            + '.num{text-align:right;font-family:monospace}'
            + '.bold{font-weight:700}'
            + '.empty{text-align:center;color:#888;padding:10px;font-size:7.5pt}'
            + '.obs-item{display:flex;gap:6px;align-items:flex-start;margin-bottom:4px;font-size:7.5pt;line-height:1.4}'
            + '.obs-icon{font-size:8pt;flex-shrink:0;color:#6B2D2D;margin-top:1px}'
            + '.nota{background:#fffbf0;border:1px solid #f0d080;border-radius:3px;padding:5px 7px;font-size:6.5pt;line-height:1.5;margin-top:5px}'
            + '.kpi-row{display:flex;gap:8px;margin-bottom:8px}'
            + '.kpi{flex:1;border:1px solid #e5e0e0;border-radius:6px;padding:6px 8px;text-align:center;background:#fafafa}'
            + '.kpi-lbl{font-size:6.3pt;color:#666;text-transform:uppercase;letter-spacing:0.4px;line-height:1.2}'
            + '.kpi-val{font-size:14pt;font-weight:900;color:#6B2D2D;line-height:1.15;margin:2px 0}'
            + '.kpi-unit{font-size:6.5pt;color:#888}'
            + '.galeria{display:flex;flex-wrap:wrap;gap:8px}'
            + '.galeria-item{width:110px;border:1px solid #e5e0e0;border-radius:6px;padding:5px 5px 4px;text-align:center;background:#fafafa}'
            + '.galeria-fecha{font-size:6.3pt;color:#666;text-transform:capitalize;margin-top:3px}'
            + '.galeria-kpi{font-size:7.5pt;font-weight:800;color:#6B2D2D;font-family:monospace}'
            + '.footer{border-top:3px solid #6B2D2D;margin-top:8px;padding-top:5px;text-align:center;font-size:6.5pt;color:#6B2D2D;font-weight:700;letter-spacing:1px;text-transform:uppercase}'
            + '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sec-block{page-break-inside:avoid}}';

        const html = '<!DOCTYPE html><html lang="es"><head>'
            + '<meta charset="UTF-8">'
            + '<title>Informe Manejo de Vaso ' + nombrePresa + ' ' + dateDMY + '</title>'
            + '<style>' + css + '</style>'
            + '<script>window.onload=function(){window.print()}<\/script>'
            + '</head><body>'

            // ── HEADER ──
            + '<div class="hdr">'
            + '<div class="hdr-left">'
            + '<img src="' + logoUrl + '" class="hdr-logo" alt="SRL" onerror="this.style.display=\'none\'">'
            + '<div>'
            + '<div class="hdr-org">SRL UNIDAD CONCHOS</div>'
            + '<div class="hdr-sys">SISTEMA DE RIEGO DELICIAS &nbsp;·&nbsp; SICA 005</div>'
            + '<div class="hdr-rpt">INFORME INSTITUCIONAL DE MANEJO DE VASO — ' + nombrePresa.toUpperCase() + '</div>'
            + '<div class="hdr-canal">MONITOREO SATELITAL SENTINEL-2 &nbsp;·&nbsp; DISTRITO DE RIEGO 005 DELICIAS</div>'
            + '</div></div>'
            + '<div class="hdr-right">'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Generado:</span><span class="hdr-meta-val">' + dateDMY + ', ' + timeStr + ' hrs</span></div>'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Meses analizados:</span><span class="hdr-meta-big">' + serie.length + '</span></div>'
            + (primero && ultimo ? '<div class="hdr-meta-row"><span class="hdr-meta-key">Periodo:</span><span class="hdr-meta-val">' + fechaDMY(primero.fecha_escena) + ' – ' + fechaDMY(ultimo.fecha_escena) + '</span></div>' : '')
            + '</div></div>'

            // ── KPIs resumen ──
            + '<div class="kpi-row">'
            + '<div class="kpi"><div class="kpi-lbl">Superficie<br>Más Reciente</div><div class="kpi-val">' + N1(ultimo?.area_km2) + '</div><div class="kpi-unit">km²</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Variación<br>del Ciclo</div><div class="kpi-val" style="color:' + (deltaArea != null && deltaArea < 0 ? '#dc2626' : '#16a34a') + '">' + (deltaArea != null ? (deltaArea >= 0 ? '+' : '') + N1(deltaArea) : '—') + '</div><div class="kpi-unit">km²</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Perímetro<br>Más Reciente</div><div class="kpi-val">' + N0(ultimo?.perimetro_km) + '</div><div class="kpi-unit">km' + (deltaPerimetro != null ? ' · Δ ' + (deltaPerimetro >= 0 ? '+' : '') + N0(deltaPerimetro) + ' km' : '') + '</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Máximo del<br>Ciclo</div><div class="kpi-val">' + N1(areaMax) + '</div><div class="kpi-unit">km²</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Mínimo del<br>Ciclo</div><div class="kpi-val">' + N1(areaMin) + '</div><div class="kpi-unit">km²</div></div>'
            + '</div>'

            // ── Hallazgos ──
            + '<div class="sec-title">Hallazgos del Periodo</div>'
            + '<div style="margin-bottom:8px">' + hallazgosHtml + '</div>'

            // ── Galería mensual de polígonos ──
            + '<div class="sec-block">'
            + '<div class="sec-title">Evolución Mensual del Polígono de Vaso <small>una imagen por mes, mismo encuadre</small></div>'
            + galeriaHtml
            + '</div>'

            // ── Comparativo apertura vs. reciente ──
            + (comparativoHtml ? '<div class="sec-block" style="margin-top:8px">'
                + '<div class="sec-title">Comparativo: Apertura de Ciclo vs. Más Reciente</div>'
                + comparativoHtml
                + '</div>' : '')

            // ── Tendencia de área y perímetro ──
            + '<div class="sec-block" style="margin-top:8px">'
            + '<div class="sec-title">Tendencia de Área y Perímetro</div>'
            + tendenciaChartHtml
            + '</div>'

            // ── Tabla mensual detallada ──
            + '<div class="sec-block" style="margin-top:8px">'
            + '<div class="sec-title">Detalle Mensual</div>'
            + '<table><thead><tr><th>Mes</th><th class="num">Área (km²)</th><th class="num">Perímetro (km)</th><th class="num">Δ vs. mes anterior</th><th class="num">Bancos expuestos</th><th class="num">Ratio elongación</th><th class="num">% máx. ciclo</th></tr></thead>'
            + '<tbody>' + filasTabla + '</tbody></table>'
            + '<div class="nota">Área neta (bancos de tierra expuestos excluidos) y perímetro real vía NDWI de Sentinel-2 (10–20 m/pixel), vectorizado con marching squares. Un hueco en la serie indica un mes sin escena confiable por nubosidad excesiva — nunca se registra como cero. Ratio de elongación = perímetro real / perímetro del círculo de igual área (mínimo teórico 1.0).</div>'
            + '</div>'

            // ── Validación cruzada ──
            + validacionHtml

            // ── FOOTER ──
            + '<div class="footer">'
            + '&#128167; &nbsp; SRL CONCHOS &nbsp;•&nbsp; TRABAJAMOS CON RESPONSABILIDAD, OPERAMOS CON PRECISIÓN, SERVIMOS CON COMPROMISO'
            + '</div>'
            + '<div style="text-align:center;font-size:6pt;color:#aaa;margin-top:3px">Fuente: vaso_geometria_historico — Supabase SICA 005. Generado desde Conchos Digital / GEO-MONITOR / Manejo de Vaso.</div>'

            + '</body></html>';

        return html;
    }, [nombrePresa, historico, validacionCruzada]);

    const [iframeUrl, setIframeUrl] = useState<string | null>(null);
    useEffect(() => {
        const html = generateHtml();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        setIframeUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [generateHtml]);

    const handlePrint = () => {
        const html = generateHtml();
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    return (
        <div className="rpt-overlay" onClick={onClose}>
            <div className="rpt-dialog" style={{ maxWidth: '92vw', width: 960 }} onClick={e => e.stopPropagation()}>
                <div className="rpt-toolbar">
                    <span className="rpt-toolbar-title">INFORME INSTITUCIONAL — MANEJO DE VASO {nombrePresa.toUpperCase()}</span>
                    <div className="rpt-toolbar-actions">
                        <button type="button" className="rpt-btn-print" onClick={handlePrint}>
                            <Printer size={14} /> Imprimir / PDF
                        </button>
                        <button type="button" className="rpt-btn-close" onClick={onClose} title="Cerrar" aria-label="Cerrar">
                            <X size={14} />
                        </button>
                    </div>
                </div>
                {iframeUrl
                    ? <iframe
                        src={iframeUrl}
                        title="Informe Institucional de Manejo de Vaso"
                        style={{ width: '100%', height: '78vh', border: 'none', display: 'block' }}
                    />
                    : <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Generando informe…</div>
                }
            </div>
        </div>
    );
};

export default InformeVasoInstitucional;
