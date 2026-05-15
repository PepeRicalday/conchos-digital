/**
 * InformeOperativo.tsx — Informe Operativo Diario PDF (SRL Unidad Conchos)
 *
 * Reemplaza CanalReport al pulsar "Reporte PDF" en Monitor Público.
 * Genera un HTML completo con datos en tiempo real y lo abre como Blob
 * para impresión/descarga PDF (mismo patrón que CanalReport).
 *
 * Secciones:
 *   1. Encabezado institucional (logo SRL + fecha/hora + semáforo)
 *   2. Resumen ejecutivo (párrafo dinámico)
 *   3. KPIs (Q K-0, Demanda zonas, Q K-104, Pérdidas+Eficiencia)
 *   4. Distribución por zona (Z1–Z4, caudal + volumen)
 *   5. Tabla: Niveles y Volúmenes por zona
 *   6. Tabla: Gasto por módulo (base + adicional)
 *   7. Tabla: Puntos de control (nivel, bordo libre, Q, estado, TS)
 *   8. Balance hidráulico (Q0, Q104, pérdidas, eficiencia, λ)
 *   9. Nota técnica + Conclusión operativa + Footer
 */
import React from 'react';
import { Printer, X } from 'lucide-react';
import './CanalReport.css';

// ── Tipos mínimos necesarios ─────────────────────────────────────────────────
interface CoherenciaCanal {
    qPresa: number;
    qK0Medido: number;
    qFinal: number;
    eficiencia: number | null;
    perdidaRio: number | null;
    perdidaCanal: number | null;
    nCoherentes: number;
    totalPuntos: number;
}

interface IECBreakdown {
    iec: number;
    semaforo: string;
    p_eficiencia: number;
    p_coherencia: number;
    p_fugas: number;
    p_criticos: number;
    inputs: {
        eficiencia_pct: number | null;
        coherencia_pct: number | null;
        fuga_pct: number | null;
        criticos_pct: number | null;
    };
}

interface EscalaRow {
    id: string;
    nombre: string;
    km: number;
    nivel_actual?: number | null;
    nivel_max_operativo?: number | null;
    gasto_actual?: number | null;
    apertura_actual?: number | null;
    puertas_abiertas?: number;
    ultima_telemetria?: number | null;
}

export interface InformeOperativoProps {
    escalas: EscalaRow[];
    coherencia: CoherenciaCanal;
    iec: IECBreakdown;
    entregasHoy: any[];
    balanceModulos: any[];
    volZonas: any[];
    presasData: any[];
    onClose: () => void;
}

// ── Zonas del canal ──────────────────────────────────────────────────────────
const ZONAS_DEF = [
    { codigo: 'Z1', nombre: 'Zona 1', km_ini: 23, km_fin: 29 },
    { codigo: 'Z2', nombre: 'Zona 2', km_ini: 34, km_fin: 44 },
    { codigo: 'Z3', nombre: 'Zona 3', km_ini: 54, km_fin: 68 },
    { codigo: 'Z4', nombre: 'Zona 4', km_ini: 79, km_fin: 94 },
];

const N = (v: number | null | undefined, dec = 3) =>
    v != null && isFinite(v) ? v.toFixed(dec) : '—';

const semColor = (s: string) =>
    s === 'VERDE' ? '#16a34a' : s === 'AMARILLO' ? '#d97706' : '#dc2626';

const semLabel = (s: string) =>
    s === 'VERDE' ? 'OPERACIÓN NORMAL' : s === 'AMARILLO' ? 'ATENCIÓN REQUERIDA' : 'ALERTA CRÍTICA';

function fmtTs(ts?: number | null): string {
    if (!ts) return '—';
    const m = Math.floor((Date.now() - ts) / 60_000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
}

// ── Componente ───────────────────────────────────────────────────────────────
const InformeOperativo: React.FC<InformeOperativoProps> = ({
    escalas, coherencia, iec, entregasHoy, balanceModulos, volZonas, onClose,
}) => {

    // ── Valores derivados ────────────────────────────────────────────────────
    const q0   = escalas.find(e => e.km === 0)?.gasto_actual   ?? 0;
    const q104 = escalas.find(e => e.km === 104)?.gasto_actual ?? 0;

    const zonaData = ZONAS_DEF.map(z => {
        const escIn  = escalas.find(e => Math.abs(e.km - z.km_ini) < 0.5);
        const escOut = escalas.find(e => Math.abs(e.km - z.km_fin) < 0.5);
        const qIn    = escIn?.gasto_actual  ?? 0;
        const qOut   = escOut?.gasto_actual ?? 0;
        const qReal  = (qIn > 0 || qOut > 0) ? Math.max(0, qIn - qOut) : null;
        const vz     = volZonas.find((v: any) => v.codigo === z.codigo);
        return {
            ...z,
            q_real:     qReal,
            nivel_medio: vz?.nivel_medio_m != null ? +Number(vz.nivel_medio_m).toFixed(3) : null,
            vol_mm3:     vz?.vol_actual_mm3 != null ? +Number(vz.vol_actual_mm3).toFixed(4) : null,
            pct_llenado: vz?.pct_llenado    != null ? +Number(vz.pct_llenado).toFixed(1)   : null,
        };
    });

    const qZonas   = zonaData.reduce((s, z) => s + (z.q_real ?? 0), 0);
    const perdidas = q0 - q104 - qZonas;
    const eficiencia = q0 > 0 ? ((q0 - Math.max(0, perdidas)) / q0 * 100) : 0;
    const lambda   = q0 > 0 ? perdidas / 104 : 0;

    // Módulos
    const seenSK = new Set<string>();
    const pairs: { mid: string; zid: string | null }[] = [];
    for (const e of entregasHoy) {
        const k = `${e.modulo_id}_${e.zona_id ?? ''}`;
        if (!seenSK.has(k)) { seenSK.add(k); pairs.push({ mid: e.modulo_id, zid: e.zona_id ?? null }); }
    }
    const moduloRows = pairs.map(({ mid, zid }) => {
        const metaPrimary = balanceModulos.find((b: any) => b.modulo_id === mid && b.es_primaria);
        const metaZone    = balanceModulos.find((b: any) => b.modulo_id === mid && (zid ? b.zona_id === zid : b.es_primaria)) ?? metaPrimary;
        const base = entregasHoy.find((e: any) => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'base');
        const adic = entregasHoy.find((e: any) => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'adicional');
        return {
            nombre:    metaPrimary?.modulo_nombre ?? mid,
            codigo:    metaPrimary?.codigo_corto  ?? mid,
            zona:      metaZone?.zona_codigo       ?? '—',
            base_lps:  base ? +Number(base.gasto_lps).toFixed(2) : 0,
            adic_lps:  adic ? +Number(adic.gasto_lps).toFixed(2) : 0,
            total_lps: (base ? +Number(base.gasto_lps) : 0) + (adic ? +Number(adic.gasto_lps) : 0),
            base_m3s:  base ? +Number(base.gasto_m3s).toFixed(4) : 0,
            adic_m3s:  adic ? +Number(adic.gasto_m3s).toFixed(4) : 0,
            total_m3s: (base ? +Number(base.gasto_m3s) : 0) + (adic ? +Number(adic.gasto_m3s) : 0),
        };
    }).sort((a, b) => a.codigo.localeCompare(b.codigo));

    // Checkpoints
    const checkpoints = escalas
        .filter(e => e.km >= 0 && e.km <= 104)
        .sort((a, b) => a.km - b.km)
        .map(e => {
            const hA   = e.nivel_actual ?? 0;
            const hMax = e.nivel_max_operativo ?? null;
            const bl   = hMax != null ? +(hMax - hA).toFixed(3) : null;
            const q    = e.gasto_actual ?? 0;
            const estado = bl != null && bl < 0 ? 'CRÍTICO' : bl != null && bl < 0.10 ? 'PRECAUCIÓN' : q > 0 ? 'OPERATIVO' : 'SIN DATOS';
            return { nombre: e.nombre, km: e.km, hA, hMax, bl, q, ts: fmtTs(e.ultima_telemetria), estado };
        });

    const semC  = semColor(iec.semaforo);
    const semL  = semLabel(iec.semaforo);

    // ── Generación del PDF (Blob) ────────────────────────────────────────────
    const handlePrint = () => {
        const now      = new Date();
        const dateStr  = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chihuahua' });
        const timeStr  = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' });
        const logoUrl  = window.location.origin + '/logos/logo-srl.png';

        // ── Filas tablas ──────────────────────────────────────────────────────
        const zonaTableRows = zonaData.map(z =>
            '<tr>'
            + '<td><strong>' + z.codigo + '</strong> — ' + z.nombre + '</td>'
            + '<td class="num">' + z.km_ini + ' – ' + z.km_fin + '</td>'
            + '<td class="num">' + N(z.nivel_medio, 3) + '</td>'
            + '<td class="num">' + N(z.vol_mm3, 4) + '</td>'
            + '<td class="num">' + (z.pct_llenado != null ? z.pct_llenado.toFixed(1) + '%' : '—') + '</td>'
            + '<td class="num">' + N(z.q_real, 3) + '</td>'
            + '</tr>'
        ).join('');

        const totalVolMm3 = zonaData.reduce((s, z) => s + (z.vol_mm3 ?? 0), 0);

        const moduloTableRows = moduloRows.length > 0
            ? moduloRows.map(m =>
                '<tr>'
                + '<td>' + m.codigo + '</td>'
                + '<td>' + m.zona + '</td>'
                + '<td class="num">' + (m.base_lps > 0 ? m.base_lps.toFixed(2) : '—') + '</td>'
                + '<td class="num">' + (m.adic_lps > 0 ? m.adic_lps.toFixed(2) : '—') + '</td>'
                + '<td class="num bold">' + m.total_lps.toFixed(2) + '</td>'
                + '<td class="num">' + (m.base_m3s > 0 ? m.base_m3s.toFixed(4) : '—') + '</td>'
                + '<td class="num">' + (m.adic_m3s > 0 ? m.adic_m3s.toFixed(4) : '—') + '</td>'
                + '<td class="num bold">' + m.total_m3s.toFixed(4) + '</td>'
                + '</tr>'
            ).join('')
            + '<tr class="totals-row">'
            + '<td colspan="2">TOTAL</td>'
            + '<td class="num">' + moduloRows.reduce((s, m) => s + m.base_lps, 0).toFixed(2) + '</td>'
            + '<td class="num">' + moduloRows.reduce((s, m) => s + m.adic_lps, 0).toFixed(2) + '</td>'
            + '<td class="num bold">' + moduloRows.reduce((s, m) => s + m.total_lps, 0).toFixed(2) + '</td>'
            + '<td class="num">' + moduloRows.reduce((s, m) => s + m.base_m3s, 0).toFixed(4) + '</td>'
            + '<td class="num">' + moduloRows.reduce((s, m) => s + m.adic_m3s, 0).toFixed(4) + '</td>'
            + '<td class="num bold">' + moduloRows.reduce((s, m) => s + m.total_m3s, 0).toFixed(4) + '</td>'
            + '</tr>'
            : '<tr><td colspan="8" class="empty">Sin entregas registradas hoy</td></tr>';

        const cpTableRows = checkpoints.map(c => {
            const rowClass = c.estado === 'CRÍTICO' ? 'row-crit' : c.estado === 'PRECAUCIÓN' ? 'row-warn' : '';
            const blColor  = c.bl != null && c.bl < 0 ? '#dc2626' : c.bl != null && c.bl < 0.10 ? '#d97706' : 'inherit';
            const estColor = c.estado === 'CRÍTICO' ? '#dc2626' : c.estado === 'PRECAUCIÓN' ? '#d97706' : c.estado === 'OPERATIVO' ? '#16a34a' : '#94a3b8';
            return '<tr class="' + rowClass + '">'
                + '<td>' + c.nombre + '</td>'
                + '<td class="num">' + c.km.toFixed(0) + '</td>'
                + '<td class="num">' + c.hA.toFixed(3) + '</td>'
                + '<td class="num">' + (c.hMax != null ? c.hMax.toFixed(2) : '—') + '</td>'
                + '<td class="num" style="color:' + blColor + '">' + (c.bl != null ? c.bl.toFixed(3) : '—') + '</td>'
                + '<td class="num">' + (c.q > 0 ? c.q.toFixed(3) : '—') + '</td>'
                + '<td class="estado" style="color:' + estColor + '">' + c.estado + '</td>'
                + '<td class="num">' + c.ts + '</td>'
                + '</tr>';
        }).join('');

        // ── Zonas cards ───────────────────────────────────────────────────────
        const zonaCardsHtml = zonaData.map(z =>
            '<div class="zona-card">'
            + '<div class="zona-label">' + z.codigo + ' — ' + z.nombre + '</div>'
            + '<div class="zona-tramo">KM ' + z.km_ini + ' – ' + z.km_fin + '</div>'
            + '<div class="zona-q">' + (z.q_real != null ? z.q_real.toFixed(3) : '—') + ' <span class="zona-q-unit">m³/s</span></div>'
            + '<div class="zona-vol">'
            + (z.vol_mm3 != null ? 'Vol: ' + z.vol_mm3.toFixed(4) + ' Mm³' : '')
            + (z.pct_llenado != null ? ' · ' + z.pct_llenado.toFixed(1) + '%' : '')
            + '</div>'
            + '</div>'
        ).join('');

        // ── Conclusión operativa ──────────────────────────────────────────────
        const conclusionText = iec.semaforo === 'VERDE'
            ? 'Sistema en condiciones normales de operación. Eficiencia de conducción del ' + eficiencia.toFixed(1) + '%. Sin alertas críticas de nivel.'
            : iec.semaforo === 'AMARILLO'
            ? 'Operación con atención requerida. Se identifican condiciones que requieren revisión. Eficiencia: ' + eficiencia.toFixed(1) + '%.'
            : 'Estado de alerta activa. Se requiere intervención operativa inmediata. Eficiencia: ' + eficiencia.toFixed(1) + '%.';

        // ── Resumen ejecutivo ─────────────────────────────────────────────────
        const ejecutivoText = 'Al corte de las <strong>' + timeStr + ' CST</strong>, el Canal Principal Conchos opera con un gasto de entrada de '
            + '<strong>' + q0.toFixed(3) + ' m³/s</strong> en K-0+000 y una descarga en K-104 de <strong>' + q104.toFixed(3) + ' m³/s</strong>. '
            + 'La demanda por distribución en zonas de riego asciende a <strong>' + qZonas.toFixed(3) + ' m³/s</strong>. '
            + (perdidas > 0
                ? 'Las pérdidas en conducción se estiman en <strong>' + perdidas.toFixed(3) + ' m³/s</strong>, '
                  + 'correspondiente a una eficiencia de conducción del <strong>' + eficiencia.toFixed(1) + '%</strong>. '
                : 'El sistema opera con balance positivo. Eficiencia de conducción: <strong>' + eficiencia.toFixed(1) + '%</strong>. ')
            + 'Estado operativo general: <strong>' + semL + '</strong>.';

        // ── CSS del PDF ───────────────────────────────────────────────────────
        const css = '@page{size:letter portrait;margin:12mm 14mm}'
            + '*{box-sizing:border-box;margin:0;padding:0}'
            + 'body{font-family:"Helvetica Neue",Arial,sans-serif;font-size:9pt;color:#1a1a1a;background:#fff}'
            // Header
            + '.header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #6B2D2D;padding-bottom:8px;margin-bottom:10px}'
            + '.hdr-logo{width:44px;height:44px;object-fit:contain}'
            + '.hdr-center{text-align:center;flex:1;padding:0 12px}'
            + '.hdr-org{font-size:7.5pt;color:#6B2D2D;font-weight:700;letter-spacing:2px;text-transform:uppercase}'
            + '.hdr-title{font-size:13pt;font-weight:700;color:#1a1a1a;margin:2px 0}'
            + '.hdr-sub{font-size:8pt;color:#555}'
            + '.hdr-right{text-align:right;font-size:8pt;color:#444}'
            + '.hdr-date{font-weight:600}'
            + '.hdr-time{font-size:10pt;font-weight:700;color:#6B2D2D}'
            + '.sem-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:7pt;font-weight:700;letter-spacing:1px;color:#fff;background:' + semC + ';margin-top:3px}'
            // Secciones
            + '.section{margin-bottom:10px}'
            + '.sec-title{font-size:7.5pt;font-weight:700;color:#6B2D2D;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1.5px solid #e5e0e0;padding-bottom:2px;margin-bottom:6px}'
            // Resumen ejecutivo
            + '.exec-box{background:#faf8f8;border-left:3px solid #6B2D2D;padding:7px 10px;border-radius:0 5px 5px 0;font-size:8.5pt;line-height:1.6}'
            // KPIs
            + '.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}'
            + '.kpi{border:1px solid #e5e0e0;border-radius:6px;padding:7px 8px;text-align:center;background:#fafafa}'
            + '.kpi-lbl{font-size:7pt;color:#666;text-transform:uppercase;letter-spacing:0.6px}'
            + '.kpi-val{font-size:15pt;font-weight:700;color:#6B2D2D;line-height:1.2}'
            + '.kpi-unit{font-size:7pt;color:#888}'
            + '.kpi-sub{font-size:7pt;color:#555;margin-top:1px}'
            // Zonas cards
            + '.zonas-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px}'
            + '.zona-card{border:1px solid #e5e0e0;border-radius:6px;padding:6px 8px;background:#f9f6f6}'
            + '.zona-label{font-size:8pt;font-weight:700;color:#6B2D2D}'
            + '.zona-tramo{font-size:7pt;color:#888}'
            + '.zona-q{font-size:12pt;font-weight:700;color:#1a1a1a}'
            + '.zona-q-unit{font-size:8pt;font-weight:400}'
            + '.zona-vol{font-size:7pt;color:#555}'
            // Tablas
            + 'table{width:100%;border-collapse:collapse;font-size:8pt}'
            + 'th{background:#6B2D2D;color:#fff;padding:4px 6px;text-align:left;font-size:7.5pt;font-weight:600}'
            + 'td{padding:3px 6px;border-bottom:1px solid #f0eded}'
            + 'tr:nth-child(even) td{background:#faf8f8}'
            + '.num{text-align:right;font-family:monospace}'
            + '.bold{font-weight:700}'
            + '.estado{font-weight:600;font-size:7.5pt}'
            + '.totals-row td{background:#f0eded!important;font-weight:700}'
            + '.row-crit td{background:#fff1f2!important;color:#991b1b}'
            + '.row-warn td{background:#fffbeb!important;color:#92400e}'
            + '.empty{text-align:center;color:#888;padding:8px}'
            // Balance grid
            + '.balance-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}'
            + '.bal-item{border:1px solid #e5e0e0;border-radius:4px;padding:6px 10px}'
            + '.bal-lbl{font-size:7pt;color:#666}'
            + '.bal-val{font-size:12pt;font-weight:700;color:#1a1a1a}'
            + '.bal-unit{font-size:8pt;font-weight:400}'
            // Nota técnica
            + '.nota{background:#fffbf0;border:1px solid #f0d080;border-radius:4px;padding:6px 10px;font-size:7.5pt;line-height:1.5;margin-bottom:6px}'
            // Conclusión
            + '.conclusion{background:#f0f9f0;border:1px solid #86efac;border-radius:4px;padding:6px 10px;font-size:8pt;font-weight:600;color:#15803d}'
            // Footer
            + '.footer{border-top:2px solid #6B2D2D;margin-top:10px;padding-top:5px;display:flex;justify-content:space-between;font-size:7pt;color:#888}'
            + '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}';

        // ── Documento HTML ────────────────────────────────────────────────────
        const html = '<!DOCTYPE html><html lang="es"><head>'
            + '<meta charset="UTF-8">'
            + '<title>Informe Operativo ' + new Date().toLocaleDateString('en-CA') + '</title>'
            + '<style>' + css + '</style>'
            + '<script>window.onload=function(){window.print()}<\/script>'
            + '</head><body>'

            // ── HEADER ──
            + '<div class="header">'
            + '<img src="' + logoUrl + '" alt="SRL" class="hdr-logo" onerror="this.style.display=\'none\'">'
            + '<div class="hdr-center">'
            + '<div class="hdr-org">S R L &nbsp; Unidad Conchos &nbsp;/&nbsp; Delicias</div>'
            + '<div class="hdr-title">INFORME OPERATIVO DIARIO</div>'
            + '<div class="hdr-sub">Canal Principal Conchos — Distrito de Riego 005 Delicias</div>'
            + '</div>'
            + '<div class="hdr-right">'
            + '<div class="hdr-date">' + dateStr + '</div>'
            + '<div class="hdr-time">' + timeStr + ' CST</div>'
            + '<span class="sem-badge">' + semL + '</span>'
            + '</div>'
            + '</div>'

            // ── RESUMEN EJECUTIVO ──
            + '<div class="section"><div class="sec-title">Resumen Ejecutivo</div>'
            + '<div class="exec-box">' + ejecutivoText + '</div>'
            + '</div>'

            // ── KPIs ──
            + '<div class="kpis">'
            + '<div class="kpi"><div class="kpi-lbl">Q Entrada K-0+000</div><div class="kpi-val">' + q0.toFixed(3) + '</div><div class="kpi-unit">m³/s</div><div class="kpi-sub">Presa La Boquilla</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Demanda Zonas</div><div class="kpi-val">' + qZonas.toFixed(3) + '</div><div class="kpi-unit">m³/s</div><div class="kpi-sub">' + zonaData.filter(z => z.q_real && z.q_real > 0).length + ' zona(s) activa(s)</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Q Salida K-104</div><div class="kpi-val">' + q104.toFixed(3) + '</div><div class="kpi-unit">m³/s</div><div class="kpi-sub">Entrega Madero</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Pérdidas / Eficiencia</div><div class="kpi-val" style="color:' + (perdidas > 2 ? '#d97706' : '#16a34a') + '">' + (perdidas > 0 ? perdidas.toFixed(3) : '0.000') + '</div><div class="kpi-unit">m³/s</div><div class="kpi-sub">Efic. ' + eficiencia.toFixed(1) + '%</div></div>'
            + '</div>'

            // ── DISTRIBUCIÓN ZONAS ──
            + '<div class="section"><div class="sec-title">Distribución por Zona de Riego</div>'
            + '<div class="zonas-grid">' + zonaCardsHtml + '</div>'
            + '</div>'

            // ── TABLA ZONAS ──
            + '<div class="section"><div class="sec-title">Niveles y Volúmenes por Zona</div>'
            + '<table><thead><tr>'
            + '<th>Zona</th><th>Tramo KM</th><th class="num">Nivel Medio (m)</th><th class="num">Vol. Actual (Mm³)</th><th class="num">% Llenado</th><th class="num">Q Distribución (m³/s)</th>'
            + '</tr></thead><tbody>'
            + zonaTableRows
            + '<tr class="totals-row"><td colspan="3">TOTAL</td><td class="num">' + totalVolMm3.toFixed(4) + '</td><td class="num">—</td><td class="num">' + qZonas.toFixed(3) + '</td></tr>'
            + '</tbody></table></div>'

            // ── TABLA MÓDULOS ──
            + '<div class="section"><div class="sec-title">Gasto por Módulo de Riego</div>'
            + '<table><thead><tr>'
            + '<th>Módulo</th><th>Zona</th><th class="num">Q Base (l/s)</th><th class="num">Q Adic. (l/s)</th><th class="num">Q Total (l/s)</th><th class="num">Q Base (m³/s)</th><th class="num">Q Adic. (m³/s)</th><th class="num">Q Total (m³/s)</th>'
            + '</tr></thead><tbody>' + moduloTableRows + '</tbody></table></div>'

            // ── TABLA PUNTOS DE CONTROL ──
            + '<div class="section"><div class="sec-title">Puntos de Control — Estado Hidráulico</div>'
            + '<table><thead><tr>'
            + '<th>Punto</th><th class="num">KM</th><th class="num">Nivel (m)</th><th class="num">Máx. Op. (m)</th><th class="num">Bordo Libre (m)</th><th class="num">Q (m³/s)</th><th>Estado</th><th class="num">TS</th>'
            + '</tr></thead><tbody>' + cpTableRows + '</tbody></table></div>'

            // ── BALANCE HIDRÁULICO ──
            + '<div class="section"><div class="sec-title">Balance Hidráulico</div>'
            + '<div class="balance-grid">'
            + '<div class="bal-item"><div class="bal-lbl">Q Entrada (K-0+000)</div><div class="bal-val">' + q0.toFixed(3) + ' <span class="bal-unit">m³/s</span></div></div>'
            + '<div class="bal-item"><div class="bal-lbl">Q Distribución Zonas</div><div class="bal-val">' + qZonas.toFixed(3) + ' <span class="bal-unit">m³/s</span></div></div>'
            + '<div class="bal-item"><div class="bal-lbl">Q Salida (K-104)</div><div class="bal-val">' + q104.toFixed(3) + ' <span class="bal-unit">m³/s</span></div></div>'
            + '<div class="bal-item"><div class="bal-lbl">Pérdidas en Conducción</div><div class="bal-val" style="color:' + (perdidas > 2 ? '#d97706' : '#16a34a') + '">' + perdidas.toFixed(3) + ' <span class="bal-unit">m³/s</span></div></div>'
            + '<div class="bal-item"><div class="bal-lbl">Eficiencia Global</div><div class="bal-val" style="color:' + (eficiencia >= 90 ? '#16a34a' : eficiencia >= 80 ? '#d97706' : '#dc2626') + '">' + eficiencia.toFixed(1) + '<span class="bal-unit">%</span></div></div>'
            + '<div class="bal-item"><div class="bal-lbl">&#955; (pérdidas/km)</div><div class="bal-val">' + lambda.toFixed(4) + ' <span class="bal-unit">m³/s·km⁻¹</span></div></div>'
            + '</div></div>'

            // ── NOTA TÉCNICA ──
            + '<div class="nota"><strong>Nota Técnica:</strong> Cálculos de gasto mediante fórmula de compuerta radial (Cd=0.62, Cv=1.84) con factores de corrección M1 calibrados por aforo de campo (última calibración K-0+000: 14/05/2026, Q=31.377 m³/s). K-23 opera como sifón: Q propagado desde K-0+000 menos entregas acumuladas (&Delta;=0.650 m³/s). K-68 incluye sobrepaso estructural cuando H&gt;3.56 m: Q<sub>sob</sub>=2.1×10.80×(H−3.56)^1.5. Balance sujeto a disponibilidad de telemetría activa.</div>'

            // ── CONCLUSIÓN ──
            + '<div class="conclusion">Conclusión operativa: ' + conclusionText + '</div>'

            // ── FOOTER ──
            + '<div class="footer">'
            + '<span>Sistema de Información del Canal Conchos (SICA) — DR-005 Delicias · Generado automáticamente · Datos en tiempo real</span>'
            + '<span>IEC: ' + iec.iec.toFixed(1) + '/100 · ' + semL + ' · ' + dateStr + ' ' + timeStr + ' CST</span>'
            + '</div>'

            + '</body></html>';

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    // ── Preview en pantalla ──────────────────────────────────────────────────
    return (
        <div className="rpt-overlay" onClick={onClose}>
            <div className="rpt-dialog" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
                {/* Toolbar */}
                <div className="rpt-toolbar">
                    <span className="rpt-toolbar-title">INFORME OPERATIVO DIARIO — CANAL CONCHOS</span>
                    <div className="rpt-toolbar-actions">
                        <button type="button" className="rpt-btn-print" onClick={handlePrint}>
                            <Printer size={14} /> Generar PDF
                        </button>
                        <button type="button" className="rpt-btn-close" onClick={onClose} title="Cerrar" aria-label="Cerrar">
                            <X size={14} />
                        </button>
                    </div>
                </div>

                {/* Preview del contenido */}
                <div className="rpt-body">
                    {/* Encabezado preview */}
                    <div className="rpt-header">
                        <div className="rpt-header-brand">
                            <img src="/logos/logo-srl.png" alt="SRL" className="rpt-logo" />
                            <div>
                                <div className="rpt-title">INFORME OPERATIVO DIARIO</div>
                                <div className="rpt-subtitle">CANAL PRINCIPAL CONCHOS — DISTRITO 005</div>
                            </div>
                        </div>
                        <div className="rpt-header-meta">
                            <div className="rpt-meta-date">
                                {new Date().toLocaleString('es-MX', {
                                    timeZone: 'America/Chihuahua',
                                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit',
                                })}
                            </div>
                            <div className="rpt-meta-mode" style={{ color: semC }}>{semL}</div>
                        </div>
                    </div>

                    {/* KPIs preview */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">INDICADORES CLAVE</h2>
                        <div className="rpt-balance-kpis">
                            <div className="rpt-bkpi">
                                <span>Q Entrada K-0+000</span>
                                <b>{N(q0, 3)} m³/s</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Demanda Zonas</span>
                                <b>{N(qZonas, 3)} m³/s</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Q Salida K-104</span>
                                <b>{N(q104, 3)} m³/s</b>
                            </div>
                            <div className="rpt-bkpi">
                                <span>Eficiencia</span>
                                <b style={{ color: eficiencia >= 90 ? '#16a34a' : eficiencia >= 80 ? '#d97706' : '#dc2626' }}>
                                    {eficiencia.toFixed(1)}%
                                </b>
                            </div>
                        </div>
                    </section>

                    {/* Zonas preview */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">DISTRIBUCIÓN POR ZONA</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                            {zonaData.map(z => (
                                <div key={z.codigo} style={{ border: '1px solid #e5e0e0', borderRadius: 6, padding: '6px 8px', background: '#f9f6f6' }}>
                                    <div style={{ fontWeight: 700, color: '#6B2D2D', fontSize: '0.75rem' }}>{z.codigo}</div>
                                    <div style={{ fontSize: '0.65rem', color: '#888' }}>KM {z.km_ini}–{z.km_fin}</div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>{z.q_real != null ? z.q_real.toFixed(3) : '—'}</div>
                                    <div style={{ fontSize: '0.6rem', color: '#888' }}>m³/s</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* IEC preview */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">ÍNDICE DE ESTADO (IEC)</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ fontWeight: 900, fontSize: '2.5rem', color: semC, lineHeight: 1 }}>{iec.iec}</div>
                            <div>
                                <div style={{ fontWeight: 700, color: semC }}>{iec.semaforo}</div>
                                <div style={{ fontSize: '0.7rem', color: '#666' }}>de 100 puntos · {coherencia.nCoherentes}/{coherencia.totalPuntos} coherentes</div>
                            </div>
                        </div>
                    </section>

                    <p style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>
                        El PDF incluye: resumen ejecutivo, zonas, módulos, puntos de control, balance hidráulico y nota técnica.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default InformeOperativo;
