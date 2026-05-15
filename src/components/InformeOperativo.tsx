/**
 * InformeOperativo.tsx — Informe Operativo Diario PDF (SRL Unidad Conchos)
 * Formato basado en plantilla operativa del 09/05/2026.
 *
 * Secciones (2 columnas en secciones intermedias):
 *   HEADER · RESUMEN EJECUTIVO · DISTRIBUCIÓN POR ZONAS + NIVELES/VOLÚMENES
 *   GASTO POR MÓDULO + RESUMEN DEMANDA POR ZONA · OBSERVACIONES + BALANCE
 *   PUNTOS DE CONTROL · FOOTER
 */
import React from 'react';
import { Printer, X } from 'lucide-react';
import './CanalReport.css';

interface CoherenciaCanal {
    qPresa: number; qK0Medido: number; qFinal: number;
    eficiencia: number | null; perdidaRio: number | null; perdidaCanal: number | null;
    nCoherentes: number; totalPuntos: number;
}
interface IECBreakdown {
    iec: number; semaforo: string;
    p_eficiencia: number; p_coherencia: number; p_fugas: number; p_criticos: number;
    inputs: { eficiencia_pct: number | null; coherencia_pct: number | null; fuga_pct: number | null; criticos_pct: number | null; };
}
interface EscalaRow {
    id: string; nombre: string; km: number;
    nivel_actual?: number | null; nivel_max_operativo?: number | null;
    gasto_actual?: number | null; apertura_actual?: number | null;
    puertas_abiertas?: number; ultima_telemetria?: number | null;
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

// Zonas operativas (control point km ranges para el diagrama del canal)
const ZONAS_OP = [
    { codigo: 'Z1', tramo: 'K-23 a K-29', color: '#16a34a', bg: '#f0fdf4' },
    { codigo: 'Z2', tramo: 'K-34 a K-44', color: '#2563eb', bg: '#eff6ff' },
    { codigo: 'Z3', tramo: 'K-54 a K-68', color: '#ea580c', bg: '#fff7ed' },
    { codigo: 'Z4', tramo: 'K-79 a K-94', color: '#7c3aed', bg: '#faf5ff' },
];

const semColor = (s: string) => s === 'VERDE' ? '#16a34a' : s === 'AMARILLO' ? '#d97706' : '#dc2626';
const semLabel = (s: string) => s === 'VERDE' ? 'OPERACIÓN NORMAL' : s === 'AMARILLO' ? 'ATENCIÓN REQUERIDA' : 'ALERTA CRÍTICA';
const N3 = (v: number | null | undefined) => v != null && isFinite(v) ? v.toFixed(3) : '—';

const InformeOperativo: React.FC<InformeOperativoProps> = ({
    escalas, coherencia, iec, entregasHoy, balanceModulos, volZonas, onClose,
}) => {
    // ── Gastos entrada/salida ─────────────────────────────────────────────────
    const q0   = escalas.find(e => e.km === 0)?.gasto_actual   ?? 0;
    const q104 = escalas.find(e => e.km === 104)?.gasto_actual ?? 0;

    // ── Demanda por módulo (agrupada por zona) ────────────────────────────────
    const zonaDemandaMap = new Map<string, number>();
    for (const e of entregasHoy) {
        const bm = balanceModulos.find((b: any) =>
            b.modulo_id === e.modulo_id && (e.zona_id ? b.zona_id === e.zona_id : b.es_primaria));
        const zc = bm?.zona_codigo as string | undefined;
        if (zc) zonaDemandaMap.set(zc, (zonaDemandaMap.get(zc) ?? 0) + Number(e.gasto_m3s ?? 0));
    }
    const demandaModulos = Array.from(zonaDemandaMap.values()).reduce((s, v) => s + v, 0)
        || entregasHoy.reduce((s: number, e: any) => s + Number(e.gasto_m3s ?? 0), 0);

    // ── Módulos por pares (base + adicional) ──────────────────────────────────
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
            codigo: metaPrimary?.codigo_corto ?? mid,
            zona:   metaZone?.zona_codigo     ?? '—',
            base_m3s:  base ? +Number(base.gasto_m3s).toFixed(4) : 0,
            adic_m3s:  adic ? +Number(adic.gasto_m3s).toFixed(4) : 0,
            total_m3s: (base ? +Number(base.gasto_m3s) : 0) + (adic ? +Number(adic.gasto_m3s) : 0),
        };
    }).sort((a, b) => a.codigo.localeCompare(b.codigo));

    // ── Volumen por zona hidráulica (vol_zonas) ───────────────────────────────
    const volZonasMap = new Map<string, any>();
    volZonas.forEach((vz: any) => volZonasMap.set(vz.codigo, vz));

    // ── Checkpoints ───────────────────────────────────────────────────────────
    const checkpoints = escalas
        .filter(e => e.km >= 0 && e.km <= 104)
        .sort((a, b) => a.km - b.km)
        .map(e => {
            const hA   = e.nivel_actual ?? 0;
            const hMax = e.nivel_max_operativo ?? null;
            const bl   = hMax != null ? +(hMax - hA).toFixed(3) : null;
            const q    = e.gasto_actual ?? 0;
            const tsMins = e.ultima_telemetria ? Math.floor((Date.now() - e.ultima_telemetria) / 60_000) : null;
            const esRef  = e.nombre?.toUpperCase().includes('K-64') || e.nombre?.toUpperCase().includes('K-94+200');
            const estado = bl != null && bl < 0 ? 'CRÍTICO' : bl != null && bl < 0.10 ? 'PRECAUCIÓN' : q > 0 ? 'Normal' : 'SIN DATOS';
            return { nombre: e.nombre, km: e.km, hA, hMax, bl, q, tsMins, estado, esRef };
        });

    // ── Balance ───────────────────────────────────────────────────────────────
    const perdidas    = q0 - q104 - demandaModulos;
    const variacionAlm = -(perdidas);
    const eficiencia  = q0 > 0 ? ((q0 - Math.max(0, perdidas)) / q0 * 100) : 0;
    const eta2        = q0 > 0 ? ((q104 + demandaModulos) / q0 * 100) : 0;
    const lambda      = perdidas / 104;

    const semC  = semColor(iec.semaforo);

    // ── Generación del PDF ────────────────────────────────────────────────────
    const handlePrint = () => {
        const now     = new Date();
        const dateDMY = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Chihuahua' });
        const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' });
        const logoUrl = window.location.origin + '/logos/logo-srl.png';

        // Observaciones auto-generadas
        const criticos   = checkpoints.filter(c => c.estado === 'CRÍTICO' && !c.esRef);
        const precaucion = checkpoints.filter(c => c.estado === 'PRECAUCIÓN' && !c.esRef);

        const obsHtml = (() => {
            let h = '';
            if (criticos.length > 0) {
                h += '<div class="obs-item obs-crit">'
                    + '<span class="obs-icon">&#9888;</span>'
                    + '<div><strong>ZONA CRÍTICA: </strong>'
                    + criticos.map(c => c.nombre).join(' y ')
                    + ' presentan bordo libre negativo o nivel sobre límite operativo.</div>'
                    + '</div>';
            }
            if (precaucion.length > 0) {
                h += '<div class="obs-item obs-warn">'
                    + '<span class="obs-icon">&#9888;</span>'
                    + '<div><strong>ZONAS EN PRECAUCIÓN: </strong>'
                    + precaucion.map(c => c.nombre).join(', ')
                    + ' con bordo libre menor a 10 cm del límite operativo.</div>'
                    + '</div>';
            }
            const bajas = checkpoints.filter(c => c.hA > 0 && c.hA < 2.5 && !c.esRef);
            if (bajas.length > 0) {
                h += '<div class="obs-item obs-ok">'
                    + '<span class="obs-icon">&#10003;</span>'
                    + '<div><strong>ZONA BAJA (</strong>'
                    + bajas.map(c => c.nombre).join(', ')
                    + '<strong>): </strong>margen hidráulico disponible y sistema estable.</div>'
                    + '</div>';
            }
            if (h === '') h = '<div class="obs-item obs-ok"><span class="obs-icon">&#10003;</span><div>Sistema operando dentro de parámetros normales. Sin alertas activas.</div></div>';
            return h;
        })();

        const nivelAlertaHtml = (() => {
            const crit = criticos.map(c => c.nombre).join(', ') || '—';
            const prec = precaucion.map(c => c.nombre).join(', ') || '—';
            return '<div class="alerta-item"><span class="dot dot-red"></span><strong>CRÍTICO:</strong> ' + crit + '</div>'
                + '<div class="alerta-item"><span class="dot dot-orange"></span><strong>PRECAUCIÓN:</strong> ' + prec + '</div>'
                + '<div class="alerta-item"><span class="dot dot-green"></span><strong>NORMAL:</strong> Resto del canal</div>';
        })();

        // Demanda por zona (según módulos) con % del total
        const totalDemanda = demandaModulos > 0 ? demandaModulos : 1;
        const zonaDemandaRows = ZONAS_OP.map(z => {
            const qz = zonaDemandaMap.get(z.codigo) ?? 0;
            const pct = (qz / totalDemanda * 100);
            return '<tr>'
                + '<td><strong style="color:' + z.color + '">' + z.codigo + '</strong></td>'
                + '<td>' + z.tramo + '</td>'
                + '<td class="num bold">' + qz.toFixed(3) + '</td>'
                + '<td class="num">' + pct.toFixed(1) + ' %</td>'
                + '</tr>';
        }).join('');

        // Tabla módulos
        const moduloTableRows = moduloRows.length > 0
            ? moduloRows.map(m =>
                '<tr>'
                + '<td><strong>' + m.codigo + '</strong></td>'
                + '<td>' + m.zona + '</td>'
                + '<td class="num">' + (m.base_m3s > 0 ? m.base_m3s.toFixed(3) : '0.000') + '</td>'
                + '<td class="num">' + (m.adic_m3s > 0 ? m.adic_m3s.toFixed(3) : '0.000') + '</td>'
                + '<td class="num bold">' + m.total_m3s.toFixed(3) + '</td>'
                + '</tr>'
            ).join('')
            + '<tr class="totals-row"><td colspan="2">TOTAL DEMANDA POR MÓDULOS</td>'
            + '<td class="num">' + moduloRows.reduce((s, m) => s + m.base_m3s, 0).toFixed(3) + '</td>'
            + '<td class="num">' + moduloRows.reduce((s, m) => s + m.adic_m3s, 0).toFixed(3) + '</td>'
            + '<td class="num bold">' + demandaModulos.toFixed(3) + ' m³/s</td>'
            + '</tr>'
            : '<tr><td colspan="5" class="empty">Sin entregas registradas hoy</td></tr>';

        // Tabla volúmenes por zona
        const volRows = ZONAS_OP.map(z => {
            const vz = volZonasMap.get(z.codigo);
            return '<tr>'
                + '<td><strong style="background:' + z.color + ';color:#fff;padding:1px 6px;border-radius:3px">' + z.codigo + '</strong></td>'
                + '<td class="num">' + N3(vz?.nivel_medio_m) + '</td>'
                + '<td class="num">' + N3(vz?.vol_actual_mm3) + '</td>'
                + '<td class="num">' + (vz?.pct_llenado != null ? Number(vz.pct_llenado).toFixed(1) + ' %' : '—') + '</td>'
                + '</tr>';
        }).join('');

        // Tabla checkpoints
        const cpRows = checkpoints.map(c => {
            const rowClass = c.estado === 'CRÍTICO' ? 'row-crit' : c.estado === 'PRECAUCIÓN' ? 'row-warn' : '';
            const blColor  = c.bl != null && c.bl < 0 ? '#dc2626' : c.bl != null && c.bl < 0.10 ? '#d97706' : 'inherit';
            const estColor = c.estado === 'CRÍTICO' ? '#dc2626' : c.estado === 'PRECAUCIÓN' ? '#d97706' : c.estado === 'Normal' ? '#16a34a' : '#94a3b8';
            const tsStr    = c.tsMins != null ? c.tsMins.toString() : '—';
            const ref      = c.esRef ? ' *' : '';
            return '<tr class="' + rowClass + '">'
                + '<td>' + c.nombre + ref + '</td>'
                + '<td class="num">' + c.km.toFixed(3) + '</td>'
                + '<td class="num">' + c.hA.toFixed(2) + '</td>'
                + '<td class="num" style="color:' + blColor + ';font-weight:' + (c.bl != null && c.bl < 0.10 ? '700' : '400') + '">' + (c.bl != null ? c.bl.toFixed(2) : '—') + '</td>'
                + '<td class="num">' + (c.q > 0 ? c.q.toFixed(3) : c.esRef ? '—' : '0.000') + '</td>'
                + '<td style="color:' + estColor + ';font-weight:600">' + c.estado + '</td>'
                + '<td class="num">' + tsStr + '</td>'
                + '</tr>';
        }).join('');

        // Zona cards para el diagrama
        const zonaCardsHtml = ZONAS_OP.map(z => {
            const qz = zonaDemandaMap.get(z.codigo) ?? 0;
            return '<div class="zona-card" style="border:2px solid ' + z.color + ';background:' + z.bg + '">'
                + '<div style="color:' + z.color + ';font-weight:800;font-size:9pt">' + z.codigo + '</div>'
                + '<div style="font-size:7pt;color:#555">' + z.tramo + '</div>'
                + '<div style="font-size:7pt;color:#888;margin-top:3px">GASTO REAL</div>'
                + '<div style="font-size:14pt;font-weight:900;color:' + z.color + '">' + qz.toFixed(3) + '</div>'
                + '<div style="font-size:7pt;color:#666">m³/s</div>'
                + '</div>';
        }).join('');

        // ── CSS ──────────────────────────────────────────────────────────────
        const css = '@page{size:letter portrait;margin:10mm 12mm}'
            + '*{box-sizing:border-box;margin:0;padding:0}'
            + 'body{font-family:"Helvetica Neue",Arial,sans-serif;font-size:8.5pt;color:#1a1a1a;background:#fff}'

            // Header
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
            + '.sem-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:6.5pt;font-weight:700;color:#fff;background:' + semC + ';letter-spacing:0.8px}'

            // Sección títulos
            + '.sec-title{font-size:7pt;font-weight:800;color:#fff;background:#6B2D2D;text-transform:uppercase;letter-spacing:1.2px;padding:3px 8px;margin-bottom:5px}'

            // Resumen ejecutivo
            + '.exec-row{display:flex;gap:10px;margin-bottom:8px}'
            + '.exec-text{flex:0 0 38%;font-size:8pt;line-height:1.6;color:#333}'
            + '.exec-kpis{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:6px}'
            + '.kpi{border:1px solid #e5e0e0;border-radius:6px;padding:7px 10px;text-align:center;background:#fafafa}'
            + '.kpi-lbl{font-size:6.5pt;color:#666;text-transform:uppercase;letter-spacing:0.5px;line-height:1.2}'
            + '.kpi-val{font-size:16pt;font-weight:900;color:#6B2D2D;line-height:1.1;margin:2px 0}'
            + '.kpi-unit{font-size:7pt;color:#888}'
            + '.kpi-sub{font-size:6.5pt;color:#555;margin-top:1px}'

            // Zona diagram
            + '.zona-row{display:flex;gap:6px;margin-bottom:6px}'
            + '.zona-card{flex:1;padding:6px 7px;border-radius:5px;text-align:center}'

            // 2-column layout
            + '.two-col{display:flex;gap:10px;margin-bottom:7px}'
            + '.col-55{flex:0 0 55%}'
            + '.col-45{flex:1}'
            + '.col-50{flex:1}'
            + '.col-60{flex:0 0 59%}'
            + '.col-40{flex:1}'

            // Tablas
            + 'table{width:100%;border-collapse:collapse;font-size:7.5pt}'
            + 'th{background:#6B2D2D;color:#fff;padding:3px 5px;text-align:left;font-size:7pt;font-weight:700}'
            + 'td{padding:2.5px 5px;border-bottom:1px solid #f0eded}'
            + 'tr:nth-child(even) td{background:#faf8f8}'
            + '.num{text-align:right;font-family:monospace}'
            + '.bold{font-weight:700}'
            + '.totals-row td{background:#f0eded!important;font-weight:700}'
            + '.row-crit td{background:#fff1f2!important;color:#991b1b}'
            + '.row-warn td{background:#fffbeb!important;color:#92400e}'
            + '.empty{text-align:center;color:#888;padding:6px}'

            // Observaciones
            + '.obs-item{display:flex;gap:6px;align-items:flex-start;margin-bottom:5px;font-size:7.5pt;line-height:1.4}'
            + '.obs-icon{font-size:10pt;flex-shrink:0;margin-top:-1px}'
            + '.obs-crit .obs-icon{color:#dc2626}'
            + '.obs-warn .obs-icon{color:#d97706}'
            + '.obs-ok  .obs-icon{color:#16a34a}'

            // Nivel de alerta
            + '.alerta-item{display:flex;align-items:center;gap:5px;font-size:7.5pt;margin-bottom:3px}'
            + '.dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}'
            + '.dot-red{background:#dc2626}'
            + '.dot-orange{background:#d97706}'
            + '.dot-green{background:#16a34a}'

            // Balance
            + '.bal-table{width:100%;font-size:7.5pt;border-collapse:collapse}'
            + '.bal-table td{padding:2px 5px;border-bottom:1px solid #f5f0f0}'
            + '.bal-table .bal-key{color:#555}'
            + '.bal-table .bal-val{text-align:right;font-weight:700;font-family:monospace}'
            + '.bal-table .bal-crit{color:#dc2626}'
            + '.bal-table .bal-good{color:#16a34a}'

            // Nota técnica
            + '.nota{background:#fffbf0;border:1px solid #f0d080;border-radius:3px;padding:5px 7px;font-size:6.5pt;line-height:1.5;margin-top:5px}'
            + '.nota li{margin-left:12px;margin-bottom:2px}'

            // Conclusión
            + '.conclusion{background:#f0fdf4;border:1px solid #86efac;border-radius:3px;padding:5px 7px;font-size:7.5pt;font-weight:600;color:#15803d;margin-top:5px}'

            // Footer
            + '.footer{border-top:3px solid #6B2D2D;margin-top:8px;padding-top:5px;text-align:center;font-size:6.5pt;color:#6B2D2D;font-weight:700;letter-spacing:1px;text-transform:uppercase}'

            + '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}';

        // ── HTML ─────────────────────────────────────────────────────────────
        const condicion = iec.semaforo === 'VERDE' ? 'OPERACIÓN ESTABLE SIN MANIOBRAS'
            : iec.semaforo === 'AMARILLO' ? 'ATENCIÓN — REVISIÓN REQUERIDA'
            : 'ALERTA ACTIVA — INTERVENCIÓN OPERATIVA';

        const ejecutivoText = 'Con base en los aforos actualizados, niveles operativos y gasto real por módulo, el Canal Principal Conchos presenta '
            + (iec.semaforo === 'VERDE' ? 'una operación estable, con demanda controlada por módulos y almacenamiento longitudinal dentro de los rangos operativos.'
               : iec.semaforo === 'AMARILLO' ? 'condiciones que requieren atención. Se identifican puntos con bordo libre próximo al límite operativo.'
               : 'condiciones de alerta activa. Se requiere intervención operativa inmediata en puntos críticos.')
            + (criticos.length > 0 ? ' Se mantiene seguimiento continuo en ' + criticos.map(c => c.nombre).join(' y ') + '.' : '');

        const html = '<!DOCTYPE html><html lang="es"><head>'
            + '<meta charset="UTF-8">'
            + '<title>Informe Operativo ' + dateDMY + '</title>'
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
            + '<div class="hdr-rpt">INFORME OPERATIVO ACTUALIZADO</div>'
            + '<div class="hdr-canal">CANAL PRINCIPAL CONCHOS &nbsp;·&nbsp; DISTRITO DE RIEGO 005 DELICIAS</div>'
            + '</div></div>'
            + '<div class="hdr-right">'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Fecha del informe:</span><span class="hdr-meta-val">' + dateDMY + '</span></div>'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Hora de corte:</span><span class="hdr-meta-big">' + timeStr + ' hrs</span></div>'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Condición:</span><span class="sem-badge">' + condicion + '</span></div>'
            + '<div class="hdr-meta-row"><span class="hdr-meta-key">Ubicación:</span><span class="hdr-meta-val">DR-005 DELICIAS, CHIH.</span></div>'
            + '</div></div>'

            // ── RESUMEN EJECUTIVO ──
            + '<div class="sec-title">Resumen Ejecutivo</div>'
            + '<div class="exec-row">'
            + '<div class="exec-text">' + ejecutivoText + '</div>'
            + '<div class="exec-kpis">'
            + '<div class="kpi"><div class="kpi-lbl">Caudal de Entrada<br>(K-0+000)</div><div class="kpi-val">' + q0.toFixed(3) + '</div><div class="kpi-unit">m³/s</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Demanda Real<br>por Módulos</div><div class="kpi-val" style="color:#16a34a">' + demandaModulos.toFixed(3) + '</div><div class="kpi-unit">m³/s</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Caudal en Salida<br>(K-104)</div><div class="kpi-val" style="color:#16a34a">' + q104.toFixed(3) + '</div><div class="kpi-unit">m³/s</div></div>'
            + '<div class="kpi"><div class="kpi-lbl">Variación de<br>Almacenamiento</div><div class="kpi-val" style="color:' + (variacionAlm < -1 ? '#dc2626' : variacionAlm > 1 ? '#d97706' : '#16a34a') + '">' + (variacionAlm >= 0 ? '+' : '') + variacionAlm.toFixed(3) + '</div><div class="kpi-unit">m³/s</div><div class="kpi-sub">Pérdida (-) / Aporte (+)</div></div>'
            + '</div></div>'

            // ── DISTRIBUCIÓN POR ZONAS + VOLÚMENES ──
            + '<div class="two-col">'
            // Col izquierda: diagrama zonas
            + '<div class="col-60">'
            + '<div class="sec-title">Distribución Real por Zonas (Operativo)</div>'
            + '<div class="zona-row">' + zonaCardsHtml + '</div>'
            + '</div>'
            // Col derecha: tabla volúmenes
            + '<div class="col-40">'
            + '<div class="sec-title">Niveles y Volúmenes por Zona</div>'
            + '<table><thead><tr>'
            + '<th>Zona</th><th class="num">Nivel Medio (m)</th><th class="num">Vol. (MMm³)</th><th class="num">% Llenado</th>'
            + '</tr></thead><tbody>' + volRows + '</tbody></table>'
            + '</div></div>'

            // ── MÓDULOS + DEMANDA POR ZONA ──
            + '<div class="two-col">'
            // Col izquierda: tabla módulos
            + '<div class="col-55">'
            + '<div class="sec-title">Gasto Operativo por Módulo</div>'
            + '<table><thead><tr>'
            + '<th>Módulo</th><th>Zona</th><th class="num">Q Normal (m³/s)</th><th class="num">Q Adicional (m³/s)</th><th class="num">Q Total (m³/s)</th>'
            + '</tr></thead><tbody>' + moduloTableRows + '</tbody></table>'
            + '</div>'
            // Col derecha: resumen demanda por zona
            + '<div class="col-45">'
            + '<div class="sec-title">Resumen de Demanda por Zona (según módulos)</div>'
            + '<table><thead><tr>'
            + '<th>Zona</th><th>Tramo</th><th class="num">Gasto Real (m³/s)</th><th class="num">% del Total</th>'
            + '</tr></thead><tbody>' + zonaDemandaRows
            + '<tr class="totals-row"><td colspan="2">TOTAL DEMANDA REAL</td>'
            + '<td class="num bold">' + demandaModulos.toFixed(3) + '</td>'
            + '<td class="num bold">100.0 %</td></tr>'
            + '</tbody></table>'
            + '</div></div>'

            // ── OBSERVACIONES + BALANCE ──
            + '<div class="two-col">'
            // Col izquierda: observaciones + estado + alerta
            + '<div class="col-50">'
            + '<div class="sec-title">Observaciones Operativas</div>'
            + '<div style="margin-bottom:7px">' + obsHtml + '</div>'
            + '<div class="sec-title">Estado General del Sistema</div>'
            + '<div style="font-size:7.5pt;line-height:1.6;margin-bottom:7px;padding:5px 7px;background:#fafafa;border:1px solid #eee;border-radius:3px">'
            + (iec.semaforo === 'VERDE'
                ? 'Sistema operativo estable con almacenamiento longitudinal dentro de rangos.'
                : 'Sistema requiere monitoreo reforzado en puntos identificados.')
            + '<br><ul style="margin-left:14px;margin-top:4px">'
            + ZONAS_OP.map(z => {
                const vz = volZonasMap.get(z.codigo);
                const pct = vz?.pct_llenado ?? null;
                const label = pct != null && pct > 85 ? 'sobrecarga parcial (' + Number(pct).toFixed(1) + '%)' : pct != null && pct < 60 ? 'zona baja estabilizada (' + Number(pct).toFixed(1) + '%)' : 'nivel normal (' + (pct != null ? Number(pct).toFixed(1) + '%' : '—') + ')';
                return '<li>' + z.codigo + ': ' + label + '</li>';
            }).join('')
            + '<li>Variación negativa de almacenamiento: ' + variacionAlm.toFixed(3) + ' m³/s</li>'
            + '</ul></div>'
            + '<div class="sec-title">Nivel de Alerta</div>'
            + '<div style="padding:5px 7px;background:#fafafa;border:1px solid #eee;border-radius:3px">'
            + nivelAlertaHtml + '</div>'
            + '</div>'
            // Col derecha: balance + nota + conclusión
            + '<div class="col-50">'
            + '<div class="sec-title">Balance Hidráulico Actual (Corregido)</div>'
            + '<table class="bal-table">'
            + '<tr><td class="bal-key">Q Entrada (K-0):</td><td class="bal-val">' + q0.toFixed(3) + ' m³/s</td></tr>'
            + '<tr><td class="bal-key">Demanda real por módulos:</td><td class="bal-val">' + demandaModulos.toFixed(3) + ' m³/s</td></tr>'
            + '<tr><td class="bal-key">Q Salida (K-104):</td><td class="bal-val">' + q104.toFixed(3) + ' m³/s</td></tr>'
            + '<tr><td class="bal-key">Pérdida / Almacenamiento:</td><td class="bal-val ' + (variacionAlm < 0 ? 'bal-crit' : 'bal-good') + '">' + (variacionAlm >= 0 ? '+' : '') + variacionAlm.toFixed(3) + ' m³/s</td></tr>'
            + '<tr><td class="bal-key">Eficiencia global (&eta;&#8321;):</td><td class="bal-val ' + (eficiencia >= 90 ? 'bal-good' : 'bal-crit') + '">' + eficiencia.toFixed(2) + ' %</td></tr>'
            + '<tr><td class="bal-key">Eficiencia total (&eta;&#8322;):</td><td class="bal-val">' + eta2.toFixed(2) + ' %</td></tr>'
            + '<tr><td class="bal-key">&lambda; (variación lineal):</td><td class="bal-val">' + lambda.toFixed(5) + ' m³/s/km</td></tr>'
            + '</table>'
            + '<div class="nota"><strong>Nota Técnica:</strong><ul>'
            + '<li>La demanda del sistema se calcula con base en gasto operativo por módulo (dato oficial en operación).</li>'
            + '<li>El balance por diferencia de escalas se utiliza únicamente como validación hidráulica.</li>'
            + '<li>La variación negativa indica ajuste del volumen almacenado en el canal.</li>'
            + '<li>K-64 y K-94+200 son escalas de referencia (sin control de gasto).</li>'
            + '<li>K-68 opera con sobrepaso de estructura. Q calculado como compuertas + vertedor superior.</li>'
            + '</ul></div>'
            + '<div class="conclusion">CONCLUSIÓN OPERATIVA: '
            + (iec.semaforo === 'VERDE'
                ? 'El Canal Principal Conchos opera con estabilidad general. La demanda por módulos se mantiene dentro de los parámetros operativos. Se requiere seguimiento continuo en los puntos identificados.'
                : iec.semaforo === 'AMARILLO'
                ? 'Se requiere atención en los puntos de precaución. Eficiencia: ' + eficiencia.toFixed(1) + '%. Monitoreo reforzado recomendado.'
                : 'Alerta activa. Se requiere intervención operativa inmediata. Eficiencia: ' + eficiencia.toFixed(1) + '%.')
            + '</div>'
            + '</div></div>'

            // ── PUNTOS DE CONTROL ──
            + '<div class="sec-title">Resumen de Puntos de Control (Checkpoints)</div>'
            + '<table><thead><tr>'
            + '<th>Punto</th><th class="num">KM</th><th class="num">Nivel (m)</th><th class="num">Bordo Libre (m)</th><th class="num">Gasto (m³/s)</th><th>Estado</th><th class="num">TS Acumulado (min)</th>'
            + '</tr></thead><tbody>' + cpRows + '</tbody></table>'
            + '<div style="font-size:6.5pt;color:#888;margin-top:3px">* Escalas de referencia (no son puntos de control de gasto) &nbsp;·&nbsp; TS acumulado hasta K-104: ' + (checkpoints.find(c => c.km === 104)?.tsMins ?? '—') + ' min</div>'

            // ── FOOTER ──
            + '<div class="footer">'
            + '&#128167; &nbsp; SRL CONCHOS &nbsp;•&nbsp; TRABAJAMOS CON RESPONSABILIDAD, OPERAMOS CON PRECISIÓN, SERVIMOS CON COMPROMISO'
            + '</div>'

            + '</body></html>';

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
    };

    // ── Preview en pantalla ───────────────────────────────────────────────────
    const semC2 = semColor(iec.semaforo);
    const semL2 = semLabel(iec.semaforo);
    const variacionAlm2 = q0 - q104 - demandaModulos;

    return (
        <div className="rpt-overlay" onClick={onClose}>
            <div className="rpt-dialog" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
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

                <div className="rpt-body">
                    {/* Header preview */}
                    <div className="rpt-header">
                        <div className="rpt-header-brand">
                            <img src="/logos/logo-srl.png" alt="SRL" className="rpt-logo" />
                            <div>
                                <div className="rpt-title">INFORME OPERATIVO ACTUALIZADO</div>
                                <div className="rpt-subtitle">CANAL PRINCIPAL CONCHOS — DISTRITO DE RIEGO 005 DELICIAS</div>
                            </div>
                        </div>
                        <div className="rpt-header-meta">
                            <div className="rpt-meta-date">
                                {new Date().toLocaleString('es-MX', { timeZone: 'America/Chihuahua', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div className="rpt-meta-mode" style={{ color: semC2 }}>{semL2}</div>
                        </div>
                    </div>

                    {/* KPIs preview */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">INDICADORES CLAVE</h2>
                        <div className="rpt-balance-kpis">
                            <div className="rpt-bkpi"><span>Caudal Entrada (K-0+000)</span><b>{N3(q0)} m³/s</b></div>
                            <div className="rpt-bkpi"><span>Demanda Real por Módulos</span><b>{N3(demandaModulos)} m³/s</b></div>
                            <div className="rpt-bkpi"><span>Caudal Salida (K-104)</span><b>{N3(q104)} m³/s</b></div>
                            <div className="rpt-bkpi">
                                <span>Var. Almacenamiento</span>
                                <b style={{ color: variacionAlm2 < -1 ? '#dc2626' : variacionAlm2 > 1 ? '#d97706' : '#16a34a' }}>
                                    {variacionAlm2 >= 0 ? '+' : ''}{variacionAlm2.toFixed(3)} m³/s
                                </b>
                            </div>
                        </div>
                    </section>

                    {/* Zonas preview */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">DISTRIBUCIÓN POR ZONA (SEGÚN MÓDULOS)</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                            {ZONAS_OP.map(z => {
                                const qz = zonaDemandaMap.get(z.codigo) ?? 0;
                                const vz = volZonasMap.get(z.codigo);
                                return (
                                    <div key={z.codigo} style={{ border: '2px solid ' + z.color, borderRadius: 6, padding: '6px 8px', background: z.bg, textAlign: 'center' }}>
                                        <div style={{ fontWeight: 800, color: z.color, fontSize: '0.75rem' }}>{z.codigo}</div>
                                        <div style={{ fontSize: '0.6rem', color: '#888' }}>{z.tramo}</div>
                                        <div style={{ fontWeight: 900, fontSize: '1.1rem', color: z.color }}>{qz.toFixed(3)}</div>
                                        <div style={{ fontSize: '0.6rem', color: '#555' }}>m³/s</div>
                                        {vz && <div style={{ fontSize: '0.55rem', color: '#777', marginTop: 2 }}>{Number(vz.vol_actual_mm3).toFixed(4)} Mm³ · {Number(vz.pct_llenado).toFixed(1)}%</div>}
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* IEC + Balance preview */}
                    <section className="rpt-section">
                        <h2 className="rpt-section-title">ÍNDICE DE ESTADO (IEC) — BALANCE</h2>
                        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ fontWeight: 900, fontSize: '2.5rem', color: semC2, lineHeight: 1 }}>{iec.iec}</div>
                                <div>
                                    <div style={{ fontWeight: 700, color: semC2 }}>{iec.semaforo}</div>
                                    <div style={{ fontSize: '0.65rem', color: '#666' }}>{coherencia.nCoherentes}/{coherencia.totalPuntos} coherentes</div>
                                </div>
                            </div>
                            <div style={{ fontSize: '0.7rem', lineHeight: 1.8, color: '#333' }}>
                                <div>Efic. global (η₁): <strong style={{ color: eficiencia >= 90 ? '#16a34a' : '#d97706' }}>{eficiencia.toFixed(2)}%</strong></div>
                                <div>Efic. total (η₂): <strong>{eta2.toFixed(2)}%</strong></div>
                                <div>λ: <strong>{lambda.toFixed(5)} m³/s/km</strong></div>
                            </div>
                        </div>
                    </section>

                    <p style={{ fontSize: '0.7rem', color: '#888', marginTop: 4 }}>
                        PDF incluye: resumen ejecutivo · zonas + volúmenes · módulos · demanda por zona · observaciones · balance · puntos de control
                    </p>
                </div>
            </div>
        </div>
    );
};

export default InformeOperativo;
