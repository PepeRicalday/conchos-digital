/**
 * InformeTendencias.tsx — Informe de Análisis de Tendencias (SRL Unidad Conchos)
 * Mismo mecanismo que InformeOperativo.tsx: genera un HTML autocontenido,
 * lo muestra en iframe (preview) y permite imprimir/PDF en pestaña nueva.
 *
 * Contenido: los 4 bloques de la pestaña TENDENCIAS del Monitor Público,
 * ya filtrados por el rango/granularidad/punto-de-control vigentes ahí —
 * el informe es una "foto" técnica exportable de lo que se está viendo.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import './CanalReport.css';
import type { SerieEscala, SerieTramo, SeriePunto, SerieCompuerta, SerieGasto } from '../utils/tendencias';
import { statsSerie } from '../utils/tendencias';

export interface InformeTendenciasProps {
    rangoDesde: string; rangoHasta: string;
    granularidad: 'diaria' | 'lectura';
    niveles: SerieEscala[];      // ya filtradas por "punto de control" (Todas/Solo Q/Ninguna)
    niveleslabel: string;        // texto del filtro activo, para dejarlo trazable en el informe
    volTramos: SerieTramo[];
    volTotal: SeriePunto[];
    compuertas: SerieCompuerta[];
    gasto: SerieGasto;
    onClose: () => void;
}

const N2 = (v: number | null | undefined) => v != null && isFinite(v) ? v.toFixed(2) : '—';
const N3 = (v: number | null | undefined) => v != null && isFinite(v) ? v.toFixed(3) : '—';

const estadoLlenadoLbl = (pct: number | null): { color: string; label: string } => {
    if (pct == null) return { color: '#888', label: 's/diseño' };
    if (pct > 105) return { color: '#dc2626', label: 'alto (a bordo)' };
    if (pct >= 85) return { color: '#16a34a', label: 'óptimo' };
    if (pct >= 60) return { color: '#2563eb', label: 'normal' };
    return { color: '#d97706', label: 'bajo' };
};

const InformeTendencias: React.FC<InformeTendenciasProps> = ({
    rangoDesde, rangoHasta, granularidad, niveles, niveleslabel,
    volTramos, volTotal, compuertas, gasto, onClose,
}) => {
    const generateHtml = useCallback(() => {
        const now = new Date();
        const dateDMY = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' });
        const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' });
        const logoUrl = window.location.origin + '/logos/logo-srl.png';
        const desdeDMY = new Date(`${rangoDesde}T12:00:00-06:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });
        const hastaDMY = new Date(`${rangoHasta}T12:00:00-06:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });
        const dias = Math.max(1, Math.round((new Date(rangoHasta).getTime() - new Date(rangoDesde).getTime()) / 864e5) + 1);
        const esHoy = rangoDesde === rangoHasta && rangoDesde === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });
        const periodoLbl = esHoy ? 'HOY' : (dias + ' día' + (dias === 1 ? '' : 's'));

        // ── Eje X compartido por las 3 gráficas del informe ─────────────────────
        // En "Hoy" (esHoy) el eje muestra HORA (HH:MM): es el punto pedido — los
        // 4 bloques deben leerse por horario de captura, no solo como "hubo
        // variación". En rangos de varios días se sigue mostrando fecha corta.
        // marcasEjeX: hasta 6 marcas repartidas en el ancho útil del gráfico,
        // ancladas a los timestamps reales de la serie (no a horas "redondas"
        // inventadas) para no sugerir lecturas que no existieron.
        const marcasEjeX = (t0: number, t1: number, xS: (t: number) => number, y: number, n = 6): string => {
            const lblDe = (t: number) => esHoy
                ? new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' })
                : new Date(t).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' });
            if (t1 <= t0) {
                return '<text x="' + xS(t0).toFixed(1) + '" y="' + y + '" font-size="6.3" fill="#888" text-anchor="middle" font-family="monospace">' + lblDe(t0) + '</text>';
            }
            let out = '';
            for (let i = 0; i <= n; i++) {
                const t = t0 + (i / n) * (t1 - t0);
                const anchor = i === 0 ? 'start' : i === n ? 'end' : 'middle';
                out += '<text x="' + xS(t).toFixed(1) + '" y="' + y + '" font-size="6.3" fill="#888" text-anchor="' + anchor + '" font-family="monospace">' + lblDe(t) + '</text>';
            }
            return out;
        };

        // ── Bloque 1: niveles por escala ──────────────────────────────────────
        const nivelesRows = niveles.map((s, i) => {
            const st = statsSerie(s.puntos);
            const tendencia = st.delta == null ? '—' : st.delta > 0.02 ? '▲ subiendo' : st.delta < -0.02 ? '▼ bajando' : '● estable';
            const tColor = st.delta == null ? '#888' : st.delta > 0.02 ? '#dc2626' : st.delta < -0.02 ? '#16a34a' : '#555';
            return '<tr' + (i % 2 ? '' : '') + '>'
                + '<td class="bold">K-' + s.km + '</td>'
                + '<td class="num">' + N2(st.min) + '</td>'
                + '<td class="num">' + N2(st.max) + '</td>'
                + '<td class="num bold">' + N2(st.avg) + '</td>'
                + '<td class="num" style="color:' + tColor + '">' + (st.delta != null ? (st.delta > 0 ? '+' : '') + N2(st.delta) : '—') + '</td>'
                + '<td style="color:' + tColor + ';font-size:6.5pt">' + tendencia + '</td>'
                + '<td class="num">' + st.n + '</td>'
                + '<td class="num">' + (s.nivelMax != null ? N2(s.nivelMax) + ' m' : '—') + '</td>'
                + '</tr>';
        }).join('') || '<tr><td colspan="8" class="empty">Sin lecturas de nivel en el periodo seleccionado</td></tr>';

        // Mini gráfica SVG de niveles (línea por escala, hasta 8 para legibilidad impresa)
        const nivelesChartHtml = (() => {
            const activas = niveles.filter(s => s.puntos.some(p => p.y != null)).slice(0, 8);
            if (!activas.length) return '';
            const PAL = ['#3987e5', '#199e70', '#c98500', '#2fb35a', '#9085e9', '#e66767', '#d55181', '#d95926'];
            const allT = activas.flatMap(s => s.puntos.filter(p => p.y != null).map(p => p.t));
            const allY = activas.flatMap(s => s.puntos.filter(p => p.y != null).map(p => p.y as number));
            if (!allT.length) return '';
            const t0 = Math.min(...allT), t1 = Math.max(...allT);
            let yMin = Math.min(...allY), yMax = Math.max(...allY);
            const pad = (yMax - yMin) * 0.1 || 0.3; yMin -= pad; yMax += pad;
            const W = 680, H = 158, PL = 34, PR = 8, PT = 8, PB = 24;
            const pw = W - PL - PR, ph = H - PT - PB;
            const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
            const yS = (y: number) => PT + ph - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * ph;
            let grid = '';
            for (let i = 0; i <= 4; i++) {
                const y = yMin + (i / 4) * (yMax - yMin);
                grid += '<line x1="' + PL + '" y1="' + yS(y).toFixed(1) + '" x2="' + (PL + pw) + '" y2="' + yS(y).toFixed(1) + '" stroke="#e5e0e0" stroke-width="0.6"/>'
                    + '<text x="' + (PL - 4) + '" y="' + (yS(y) + 3).toFixed(1) + '" font-size="6.5" fill="#888" text-anchor="end" font-family="monospace">' + y.toFixed(1) + '</text>';
            }
            const lines = activas.map((s, i) => {
                const pts = s.puntos.filter(p => p.y != null);
                const d = pts.map((p, j) => (j ? 'L' : 'M') + xS(p.t).toFixed(1) + ',' + yS(p.y as number).toFixed(1)).join(' ');
                return '<path d="' + d + '" fill="none" stroke="' + PAL[i % PAL.length] + '" stroke-width="1.3"/>';
            }).join('');
            const legend = activas.map((s, i) =>
                '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:9px">'
                + '<i style="width:7px;height:7px;background:' + PAL[i % PAL.length] + ';display:inline-block;border-radius:1px"></i>K-' + s.km + '</span>'
            ).join('');
            const ejeX = marcasEjeX(t0, t1, xS, H - 4);
            return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:#fbfaf8;border-radius:4px">'
                + grid + lines + ejeX + '</svg>'
                + '<div style="font-size:6.5pt;color:#555;margin-top:3px">' + legend + '</div>';
        })();

        // ── Bloque 2: volumen por tramo ────────────────────────────────────────
        const volRows = volTramos.map(tr => {
            const st = statsSerie(tr.puntos);
            const { color, label } = estadoLlenadoLbl(tr.estado.pctDiseno);
            return '<tr>'
                + '<td style="font-size:6.8pt">' + tr.etiqueta + '</td>'
                + '<td class="num">' + N3(st.min) + '</td>'
                + '<td class="num">' + N3(st.max) + '</td>'
                + '<td class="num" style="color:' + (st.delta != null && st.delta > 0 ? '#2563eb' : '#d97706') + '">' + N3(st.delta) + '</td>'
                + '<td class="num">' + (tr.estado.tiranteActual != null ? tr.estado.tiranteActual.toFixed(2) : '—') + '</td>'
                + '<td class="num" style="color:' + color + ';font-weight:700">' + (tr.estado.pctDiseno != null ? Math.round(tr.estado.pctDiseno) + '% ' : '—') + '</td>'
                + '<td style="color:' + color + ';font-size:6.5pt">' + label + '</td>'
                + '</tr>';
        }).join('') || '<tr><td colspan="7" class="empty">Sin datos de volumen por tramo en el periodo</td></tr>';

        const volTotalActual = [...volTotal].reverse().find(p => p.y != null)?.y ?? null;
        const stVolTotal = statsSerie(volTotal);
        const usaTrapecio = volTramos.some(t => t.estado.esTrapezoidal);
        const hayVolumen = volTramos.length > 0 && volTramos.some(t => t.puntos.some(p => p.y != null));

        // Mini apilado SVG de volumen por tramo (misma lógica que StackedArea del panel,
        // simplificada para impresión: sin hover, con etiqueta de total al final).
        const volChartHtml = (() => {
            if (!hayVolumen) return '';
            const PAL = ['#3987e5', '#199e70', '#c98500', '#2fb35a', '#9085e9', '#e66767', '#d55181', '#d95926'];
            const base = volTramos.find(s => s.puntos.length)?.puntos ?? [];
            if (!base.length) return '';
            const idxs = base.map((_, i) => i);
            const totals = idxs.map(i => volTramos.reduce((s, se) => s + (se.puntos[i]?.y ?? 0), 0));
            const yMax = Math.max(...totals, 0.1) * 1.08;
            const W = 680, H = 158, PL = 34, PR = 8, PT = 8, PB = 24;
            const pw = W - PL - PR, ph = H - PT - PB;
            const t0 = base[0].t, t1 = base[base.length - 1].t;
            const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
            const yS = (y: number) => PT + ph - (y / yMax) * ph;
            let grid = '';
            for (let i = 0; i <= 4; i++) {
                const y = (i / 4) * yMax;
                grid += '<line x1="' + PL + '" y1="' + yS(y).toFixed(1) + '" x2="' + (PL + pw) + '" y2="' + yS(y).toFixed(1) + '" stroke="#e5e0e0" stroke-width="0.6"/>'
                    + '<text x="' + (PL - 4) + '" y="' + (yS(y) + 3).toFixed(1) + '" font-size="6.5" fill="#888" text-anchor="end" font-family="monospace">' + y.toFixed(1) + '</text>';
            }
            const acc = idxs.map(() => 0);
            let bands = '';
            volTramos.forEach((se, si) => {
                const top = idxs.map(i => acc[i] + (se.puntos[i]?.y ?? 0));
                const poly = [
                    ...idxs.map(i => xS(se.puntos[i]?.t ?? base[i].t).toFixed(1) + ',' + yS(top[i]).toFixed(1)),
                    ...idxs.slice().reverse().map(i => xS(se.puntos[i]?.t ?? base[i].t).toFixed(1) + ',' + yS(acc[i]).toFixed(1)),
                ].join(' ');
                idxs.forEach(i => { acc[i] = top[i]; });
                bands += '<polygon points="' + poly + '" fill="' + PAL[si % PAL.length] + '" opacity="0.68" stroke="' + PAL[si % PAL.length] + '" stroke-width="0.5"/>';
            });
            const legend = volTramos.map((tr, i) =>
                '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:9px">'
                + '<i style="width:7px;height:7px;background:' + PAL[i % PAL.length] + ';display:inline-block;border-radius:1px"></i>' + tr.etiqueta + '</span>'
            ).join('');
            const ejeX = marcasEjeX(t0, t1, xS, H - 4);
            return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:#fbfaf8;border-radius:4px">'
                + grid + bands + ejeX + '</svg>'
                + '<div style="font-size:6.5pt;color:#555;margin-top:3px">' + legend + '</div>';
        })();

        // ── Bloque 3: arriba/abajo por compuerta ────────────────────────────────
        // K-64 y K-94+200 son escalas de SÓLO REFERENCIA (sin compuerta de
        // control propia): su "H↓ 0.00" y diferencial "—" no son datos faltantes,
        // son el comportamiento esperado. Se marca explícito para no leerse como
        // un hueco de captura — mismo criterio que ESC_SIN_CONTROL en TendenciasPanel.
        const ESC_SIN_CONTROL_INF = new Set(['K-64', 'K-94+200', 'K-94.057']);
        const compRows = compuertas.map(c => {
            const su = statsSerie(c.arriba), sd = statsSerie(c.abajo), sdif = statsSerie(c.diferencial);
            const esRef = ESC_SIN_CONTROL_INF.has('K-' + c.km) || ESC_SIN_CONTROL_INF.has(c.nombre);
            return '<tr>'
                + '<td class="bold">K-' + c.km + (esRef ? ' <span style="font-size:6pt;font-weight:600;color:#888">(ref.)</span>' : '') + '</td>'
                + '<td class="num">' + N2(su.avg) + '</td>'
                + '<td class="num">' + (esRef ? '<span style="color:#aaa">s/control</span>' : N2(sd.avg)) + '</td>'
                + '<td class="num bold" style="color:' + (esRef ? '#aaa' : '#c98500') + '">' + (esRef ? '—' : N2(sdif.avg)) + '</td>'
                + '<td class="num">' + (esRef ? '—' : N2(c.aperturaUlt)) + '</td>'
                + '<td class="num">' + (esRef ? '—' : (c.puertasAbiertas ?? '—')) + '</td>'
                + '</tr>';
        }).join('') || '<tr><td colspan="6" class="empty">Sin lecturas de compuerta en el periodo</td></tr>';
        const hayRef = compuertas.some(c => ESC_SIN_CONTROL_INF.has('K-' + c.km) || ESC_SIN_CONTROL_INF.has(c.nombre));

        // ── Bloque 4: gasto K-0 → entregas → K-104 ──────────────────────────────
        const stEnt = statsSerie(gasto.entrada), stSal = statsSerie(gasto.salida),
              stEntr = statsSerie(gasto.entregas), stPer = statsSerie(gasto.perdidas);
        const gastoRows = ([
            ['Q entrada K-0+000', stEnt, '#3987e5'],
            ['Σ entregas a módulos', stEntr, '#9085e9'],
            ['Q salida K-104', stSal, '#199e70'],
            ['Pérdidas de tránsito', stPer, '#e66767'],
        ] as [string, ReturnType<typeof statsSerie>, string][]).map(([nom, st, col]) =>
            '<tr><td style="font-size:7pt"><span style="display:inline-block;width:7px;height:7px;background:' + col + ';border-radius:1px;margin-right:5px"></span>' + nom + '</td>'
            + '<td class="num">' + N2(st.min) + '</td><td class="num">' + N2(st.max) + '</td>'
            + '<td class="num bold">' + N2(st.avg) + '</td><td class="num">' + N2(st.delta) + '</td></tr>'
        ).join('');
        const sinEntregas = gasto.entregas.every(p => p.y == null);

        // Mini gráfica SVG de gasto (4 series)
        const gastoChartHtml = (() => {
            const series = [
                { nombre: 'Q entrada', puntos: gasto.entrada, color: '#3987e5' },
                { nombre: 'Σ entregas', puntos: gasto.entregas, color: '#9085e9' },
                { nombre: 'Q salida', puntos: gasto.salida, color: '#199e70' },
                { nombre: 'Pérdidas', puntos: gasto.perdidas, color: '#e66767' },
            ];
            const allY = series.flatMap(s => s.puntos.map(p => p.y).filter((v): v is number => v != null));
            const allT = series.flatMap(s => s.puntos.filter(p => p.y != null).map(p => p.t));
            if (!allT.length) return '<div style="font-size:7pt;color:#888;padding:8px">Sin datos de gasto para graficar en el periodo.</div>';
            const t0 = Math.min(...allT), t1 = Math.max(...allT);
            let yMin = Math.min(0, ...allY), yMax = Math.max(...allY);
            const pad = (yMax - yMin) * 0.1 || 0.5; yMin -= pad; yMax += pad;
            const W = 680, H = 148, PL = 34, PR = 8, PT = 8, PB = 24;
            const pw = W - PL - PR, ph = H - PT - PB;
            const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
            const yS = (y: number) => PT + ph - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * ph;
            let grid = '';
            for (let i = 0; i <= 4; i++) {
                const y = yMin + (i / 4) * (yMax - yMin);
                grid += '<line x1="' + PL + '" y1="' + yS(y).toFixed(1) + '" x2="' + (PL + pw) + '" y2="' + yS(y).toFixed(1) + '" stroke="#e5e0e0" stroke-width="0.6"/>'
                    + '<text x="' + (PL - 4) + '" y="' + (yS(y) + 3).toFixed(1) + '" font-size="6.5" fill="#888" text-anchor="end" font-family="monospace">' + y.toFixed(1) + '</text>';
            }
            const zero = (yMin < 0 && yMax > 0) ? '<line x1="' + PL + '" y1="' + yS(0).toFixed(1) + '" x2="' + (PL + pw) + '" y2="' + yS(0).toFixed(1) + '" stroke="#999" stroke-width="0.8" stroke-dasharray="3,2"/>' : '';
            const lines = series.map(s => {
                const pts = s.puntos.filter(p => p.y != null);
                if (!pts.length) return '';
                const d = pts.map((p, j) => (j ? 'L' : 'M') + xS(p.t).toFixed(1) + ',' + yS(p.y as number).toFixed(1)).join(' ');
                return '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="1.4"/>';
            }).join('');
            const legend = series.map(s =>
                '<span style="display:inline-flex;align-items:center;gap:3px;margin-right:10px">'
                + '<i style="width:7px;height:7px;background:' + s.color + ';display:inline-block;border-radius:1px"></i>' + s.nombre + '</span>'
            ).join('');
            const ejeX = marcasEjeX(t0, t1, xS, H - 4);
            return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;background:#fbfaf8;border-radius:4px">'
                + grid + zero + lines + ejeX + '</svg>'
                + '<div style="font-size:6.5pt;color:#555;margin-top:3px">' + legend + '</div>';
        })();

        // ── Hallazgos automáticos (lectura rápida para el operador) ─────────────
        const hallazgos: string[] = [];
        if (esHoy) hallazgos.push('<strong>Análisis intradía:</strong> tendencia calculada solo con lecturas capturadas hoy — la comparación Δ es contra la primera lectura del día, no contra ayer.');
        const nivelesSubiendo = niveles.filter(s => { const st = statsSerie(s.puntos); return st.delta != null && st.delta > 0.05; });
        const nivelesBajando = niveles.filter(s => { const st = statsSerie(s.puntos); return st.delta != null && st.delta < -0.05; });
        if (nivelesSubiendo.length) hallazgos.push('<strong>Niveles al alza:</strong> ' + nivelesSubiendo.map(s => 'K-' + s.km).join(', ') + ' — verificar bordo libre disponible.');
        if (nivelesBajando.length) hallazgos.push('<strong>Niveles a la baja:</strong> ' + nivelesBajando.map(s => 'K-' + s.km).join(', ') + ' — revisar continuidad de entrega aguas abajo.');
        const tramosAltos = volTramos.filter(t => t.estado.pctDiseno != null && t.estado.pctDiseno > 105);
        if (tramosAltos.length) hallazgos.push('<strong>Tramos sobre el tirante de diseño:</strong> ' + tramosAltos.map(t => t.etiqueta).join(', ') + ' — invaden bordo libre.');
        const tramosBajos = volTramos.filter(t => t.estado.pctDiseno != null && t.estado.pctDiseno < 60);
        if (tramosBajos.length) hallazgos.push('<strong>Tramos con posible desabasto:</strong> ' + tramosBajos.map(t => t.etiqueta).join(', ') + ' — menos del 60% del tirante de diseño.');
        if (stPer.avg != null && stPer.avg > 0.5) hallazgos.push('<strong>Pérdidas de tránsito promedio:</strong> ' + N2(stPer.avg) + ' m³/s en el periodo — revisar coherencia K-0 → entregas → K-104.');
        if (sinEntregas) hallazgos.push('Sin registros de <code>entregas_modulo</code> en el rango: la serie de entregas y pérdidas del Bloque 4 queda sin dato.');
        if (!hallazgos.length) hallazgos.push('Sin variaciones relevantes detectadas automáticamente en el periodo: niveles, volúmenes y gasto se mantienen dentro de rangos estables.');
        const hallazgosHtml = hallazgos.map(h => '<div class="obs-item"><span class="obs-icon">&#8226;</span><div>' + h + '</div></div>').join('');

        // ── CSS (mismo sistema visual que InformeOperativo.tsx) ─────────────────
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
            + '.filtro-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:6.5pt;font-weight:700;color:#fff;background:#6B2D2D;letter-spacing:0.5px}'
            + '.sec-title{font-size:7pt;font-weight:800;color:#fff;background:#6B2D2D;text-transform:uppercase;letter-spacing:1.2px;padding:3px 8px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center}'
            + '.sec-title small{font-weight:600;letter-spacing:0;text-transform:none;opacity:0.85}'
            + 'table{width:100%;border-collapse:collapse;font-size:7.5pt;margin-bottom:6px}'
            + 'th{background:#6B2D2D;color:#fff;padding:3px 5px;text-align:left;font-size:7pt;font-weight:700}'
            + 'td{padding:2.5px 5px;border-bottom:1px solid #f0eded}'
            + 'tr:nth-child(even) td{background:#faf8f8}'
            + '.num{text-align:right;font-family:monospace}'
            + '.bold{font-weight:700}'
            + '.empty{text-align:center;color:#888;padding:6px}'
            + '.obs-item{display:flex;gap:6px;align-items:flex-start;margin-bottom:4px;font-size:7.5pt;line-height:1.4}'
            + '.obs-icon{font-size:8pt;flex-shrink:0;color:#6B2D2D;margin-top:1px}'
            + '.nota{background:#fffbf0;border:1px solid #f0d080;border-radius:3px;padding:5px 7px;font-size:6.5pt;line-height:1.5;margin-top:5px}'
            + '.nota li{margin-left:12px;margin-bottom:2px}'
            + '.kpi-row{display:flex;gap:8px;margin-bottom:8px}'
            + '.kpi{flex:1;border:1px solid #e5e0e0;border-radius:6px;padding:6px 8px;text-align:center;background:#fafafa}'
            + '.kpi-lbl{font-size:6.3pt;color:#666;text-transform:uppercase;letter-spacing:0.4px;line-height:1.2}'
            + '.kpi-val{font-size:14pt;font-weight:900;color:#6B2D2D;line-height:1.15;margin:2px 0}'
            + '.kpi-unit{font-size:6.5pt;color:#888}'
            + '.footer{border-top:3px solid #6B2D2D;margin-top:8px;padding-top:5px;text-align:center;font-size:6.5pt;color:#6B2D2D;font-weight:700;letter-spacing:1px;text-transform:uppercase}'
            + '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sec-block{page-break-inside:avoid}}';

        const html = '<!DOCTYPE html><html lang="es"><head>'
            + '<meta charset="UTF-8">'
            + '<title>Análisis de Tendencias ' + dateDMY + '</title>'
            + '<style>' + css + '</style>'
            + '<script>window.onload=function(){window.print()}<\/script>'
            + '</head><body>'

            // ── HEADER ──
            + '<div class="hdr">'
            + '<div class="hdr-left">'
            + '<img src="' + logoUrl + '" class="hdr-logo" alt="SRL" onerror="this.style.display=\'none\'">'
            + '<div>'
            + '<div class="hdr-org">SRL UNIDAD CONCHOS</div>'
            + '<div class="hdr-sys">SISTEMA DE RIEGO DELICIAS</div>'
            + '<div class="hdr-rpt">ANÁLISIS DE TENDENCIAS — CANAL PRINCIPAL</div>'
            + '<div class="hdr-canal">CANAL PRINCIPAL CONCHOS &nbsp;·&nbsp; DISTRITO DE RIEGO 005 DELICIAS</div>'
            + '</div></div>'
            + '<div class="hdr-right">'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Generado:</span><span class="hdr-meta-val">' + dateDMY + ', ' + timeStr + ' hrs</span></div>'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Periodo:</span><span class="hdr-meta-big">' + periodoLbl + '</span></div>'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Rango:</span><span class="hdr-meta-val">' + desdeDMY + ' – ' + hastaDMY + '</span></div>'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Granularidad:</span><span class="filtro-badge">' + (granularidad === 'diaria' ? 'DIARIA' : 'POR LECTURA') + '</span></div>'
            + '</div></div>'

            // ── KPIs resumen ──
            + '<div class="kpi-row">'
            + '<div class="kpi"><div class="kpi-lbl">Puntos de Control<br>en Análisis</div><div class="kpi-val">' + niveles.length + '</div><div class="kpi-unit">' + niveleslabel + '</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Volumen Total<br>en Canal (actual)</div><div class="kpi-val">' + N2(volTotalActual) + '</div><div class="kpi-unit">Mm³</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Gasto Entrada<br>Promedio K-0</div><div class="kpi-val">' + N2(stEnt.avg) + '</div><div class="kpi-unit">m³/s</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Gasto Salida<br>Promedio K-104</div><div class="kpi-val">' + N2(stSal.avg) + '</div><div class="kpi-unit">m³/s</div></div>'
            + '</div>'

            // ── Hallazgos del periodo ──
            + '<div class="sec-title">Hallazgos del Periodo</div>'
            + '<div style="margin-bottom:8px">' + hallazgosHtml + '</div>'

            // ── BLOQUE 1: niveles ──
            + '<div class="sec-block">'
            + '<div class="sec-title">Bloque 1 &nbsp;·&nbsp; Tendencia de Niveles por Escala <small>' + niveleslabel + '</small></div>'
            + nivelesChartHtml
            + '<table><thead><tr><th>Escala</th><th class="num">Mín (m)</th><th class="num">Máx (m)</th><th class="num">Prom (m)</th><th class="num">Δ periodo</th><th>Tendencia</th><th class="num">Lecturas</th><th class="num">Nivel máx. op.</th></tr></thead>'
            + '<tbody>' + nivelesRows + '</tbody></table>'
            + '</div>'

            // ── BLOQUE 2: volumen por tramo ──
            + '<div class="sec-block">'
            + '<div class="sec-title">Bloque 2 &nbsp;·&nbsp; Volumen por Tramo <small>' + (usaTrapecio ? 'sección trapezoidal real' : 'reconstruido, prisma rectangular') + '</small></div>'
            + (hayVolumen
                ? '<div class="kpi-row" style="margin-bottom:6px">'
                    + '<div class="kpi"><div class="kpi-lbl">Volumen Total Actual</div><div class="kpi-val">' + N2(volTotalActual) + '</div><div class="kpi-unit">Mm³</div></div>'
                    + '<div class="kpi"><div class="kpi-lbl">Mín. Periodo</div><div class="kpi-val" style="color:#d97706">' + N2(stVolTotal.min) + '</div><div class="kpi-unit">Mm³</div></div>'
                    + '<div class="kpi"><div class="kpi-lbl">Máx. Periodo</div><div class="kpi-val" style="color:#2563eb">' + N2(stVolTotal.max) + '</div><div class="kpi-unit">Mm³</div></div>'
                    + '<div class="kpi"><div class="kpi-lbl">Δ Periodo</div><div class="kpi-val" style="color:' + (stVolTotal.delta != null && stVolTotal.delta >= 0 ? '#16a34a' : '#dc2626') + '">' + (stVolTotal.delta != null && stVolTotal.delta >= 0 ? '+' : '') + N2(stVolTotal.delta) + '</div><div class="kpi-unit">Mm³</div></div>'
                    + '</div>'
                    + volChartHtml
                    + '<table style="margin-top:6px"><thead><tr><th>Tramo</th><th class="num">Vol. mín (Mm³)</th><th class="num">Vol. máx (Mm³)</th><th class="num">Δ Mm³</th><th class="num">Tirante act. (m)</th><th class="num">% diseño</th><th>Estado</th></tr></thead>'
                    + '<tbody>' + volRows + '</tbody></table>'
                    + (!usaTrapecio
                        ? '<div class="nota">Geometría trapezoidal no disponible para estos tramos en <code>perfil_hidraulico_canal</code>: el volumen se calculó con el prisma rectangular calibrado contra el snapshot de <code>vol_interescalas</code>. El % de diseño solo aparece donde hay <code>tirante_diseno_m</code> registrado.</div>'
                        : '')
                : '<div class="nota" style="background:#fef2f2;border-color:#fca5a5">&#9888; <strong>Sin volumen por tramo reconstruible en el periodo.</strong> '
                    + 'Este bloque requiere lectura de <strong>ambas caras</strong> (nivel arriba y nivel abajo) de cada escala frontera el mismo día — '
                    + 'con un rango muy corto (p. ej. «Hoy») o sin captura de <code>nivel_abajo_m</code>, ' + niveles.length
                    + ' escala(s) de nivel no bastan para derivar el tirante de ningún tramo. Prueba un rango de 7 días o más, o verifica que la captura de campo incluya el nivel aguas abajo de cada compuerta.</div>')
            + '</div>'

            // ── BLOQUE 3: compuertas ──
            + '<div class="sec-block">'
            + '<div class="sec-title">Bloque 3 &nbsp;·&nbsp; Niveles Arriba / Abajo por Compuerta</div>'
            + '<table><thead><tr><th>Compuerta</th><th class="num">H↑ prom (m)</th><th class="num">H↓ prom (m)</th><th class="num">Diferencial prom (m)</th><th class="num">Apertura últ. (m)</th><th class="num">Radiales abiertas</th></tr></thead>'
            + '<tbody>' + compRows + '</tbody></table>'
            + (hayRef ? '<div class="nota">Las escalas marcadas <strong>(ref.)</strong> son de solo referencia (K-64, K-94+200): no tienen compuerta de control propia, por lo que H↓, diferencial y apertura no aplican — no es un dato faltante.</div>' : '')
            + '</div>'

            // ── BLOQUE 4: gasto ──
            + '<div class="sec-block">'
            + '<div class="sec-title">Bloque 4 &nbsp;·&nbsp; Gasto: K-0+000 → Entregas a Módulos → K-104</div>'
            + gastoChartHtml
            + '<table style="margin-top:6px"><thead><tr><th>Serie</th><th class="num">Mín (m³/s)</th><th class="num">Máx (m³/s)</th><th class="num">Prom (m³/s)</th><th class="num">Δ periodo</th></tr></thead>'
            + '<tbody>' + gastoRows + '</tbody></table>'
            + (sinEntregas
                ? '<div class="nota">&#9888; Sin registros de <code>entregas_modulo</code> en el rango seleccionado: la serie de entregas y las pérdidas quedan sin dato. Prueba un rango con captura de entregas confirmada.</div>'
                : '<div class="nota">Extracción por zona = Σ entregas reales a módulos (no diferencial entre escalas). Pérdidas = Q₀ − Σentregas − Q₁₀₄, calculado solo cuando los tres valores tienen dato el mismo día.</div>')
            + '</div>'

            // ── FOOTER ──
            + '<div class="footer">'
            + '&#128167; &nbsp; SRL CONCHOS &nbsp;•&nbsp; TRABAJAMOS CON RESPONSABILIDAD, OPERAMOS CON PRECISIÓN, SERVIMOS CON COMPROMISO'
            + '</div>'
            + '<div style="text-align:center;font-size:6pt;color:#aaa;margin-top:3px">Fuentes: lecturas_escalas · resumen_escalas_diario · vol_interescalas · perfil_hidraulico_canal · entregas_modulo — Supabase SICA. Generado desde Monitor Público / Tendencias.</div>'

            + '</body></html>';

        return html;
    }, [rangoDesde, rangoHasta, granularidad, niveles, niveleslabel, volTramos, volTotal, compuertas, gasto]);

    // ── iframe: preview idéntico al PDF ──────────────────────────────────────
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
                    <span className="rpt-toolbar-title">ANÁLISIS DE TENDENCIAS — CANAL CONCHOS</span>
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
                        title="Análisis de Tendencias"
                        style={{ width: '100%', height: '78vh', border: 'none', display: 'block' }}
                    />
                    : <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Generando informe…</div>
                }
            </div>
        </div>
    );
};

export default InformeTendencias;
