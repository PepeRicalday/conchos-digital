import { Download, Copy } from 'lucide-react';
import type { ReactElement, Dispatch, SetStateAction } from 'react';
import { totalesVolumenCiclo, type VolumenCicloModulo } from '../../utils/volumenCiclo';
import type { HydraulicEvent } from '../../hooks/useHydricEvents';
import { LAMBDA_REF, ESC_SIN_CONTROL, fmtAge, type TelemetriaEstado } from './canalHelpers';
import { DataTable } from '../ui/base';

type ModoVisualizacion = 'LLENADO' | 'ESTABILIZACION' | 'CONTINGENCIA' | 'VACIADO' | 'ANOMALIA' | 'SIN_EVENTO';

/** Extraído de PublicMonitor.tsx: pestaña completa; las props son el estado y las funciones que usa. */
export function PestanaSkill({ balanceModulos, balanceTramos, entregasHoy, modelQ0, modelResult, modoVisualizacion, modulosResumen, renderStateTag, setModelQ0, setModelResult, setShowSkillInforme, setSnapshotCopied, showSkillInforme, skillSnapshot, snapshotCopied, volCiclo, volInterescalas, volZonas }: {
    balanceModulos: any[];
    balanceTramos: any[];
    entregasHoy: any[];
    modelQ0: string;
    modelResult: { q104: number; qZonas: number; perdidasLin: number; ef: number; transitH: number; } | null;
    modoVisualizacion: ModoVisualizacion;
    modulosResumen: { modulo_id: string; modulo_nombre: string; codigo_corto: string; zona_codigo: any; autorizado_mm3: number; hoja_mm3: number; remanente_mm3: number; entregado_mm3: number; saldo_mm3: number; pct_entregado: number | null; estado_volumen: "agotado" | "alerta" | "normal"; }[];
    renderStateTag: (liveLabel?: string) => ReactElement;
    setModelQ0: Dispatch<SetStateAction<string>>;
    setModelResult: Dispatch<SetStateAction<{ q104: number; qZonas: number; perdidasLin: number; ef: number; transitH: number; } | null>>;
    setShowSkillInforme: Dispatch<SetStateAction<boolean>>;
    setSnapshotCopied: Dispatch<SetStateAction<boolean>>;
    showSkillInforme: boolean;
    skillSnapshot: { meta: { version: string; generado: string; canal: string; distrito: string; calibracion: string; }; telemetria: { estado: string; total: number; vigentes: number; pct_vigentes: number; frescos: number; atrasados: number; stale: number; sin_flujo: number; edad_min_reciente: number | null; balance_valido: boolean; }; constantes: { Cd: number; Cv: number; g: number; Cd_gl: number; n_gl: number; MIN_H: number; n_man: number; C_ONDA: number; F_ATEN: number; lambda: number; }; M1_FACTORS: Record<string, number>; zonas: { nombre: string; km_ini: number; km_fin: number; escala_in: string; escala_out: string; q_objetivo: number; q_real: number | null; q_fuente: "entregas" | null; q_real_stale: boolean; vol_mm3: number | null; pct_llenado: number | null; nivel_medio_m: number | null; n_tramos: number | null; }[]; Q_ZONAS_REAL: number; Q_ZONAS_TOTAL: number; Q_ZONAS_MEDIDAS: number; balance: { Q0: number | null; Q104: number | null; Q0_hist: number | null; Q0_age_min: number | null; Q104_hist: number | null; Q104_age_min: number | null; Q_extracciones: number; perdidas: number | null; eficiencia: number | null; lambda: number | null; balance_valido: boolean; balance_modo: "vivo" | "parcial" | null; zonas_completas: boolean; }; alertas_nivel: { nombre: string; km: number; hA: number | null; bl: number | null; tipo: string | null; }[]; checkpoints: { nombre: string; km: number; hA: number | null; hB: number | null; q: number | null; m1: number; apertura: number | null; puertas_abiertas: number; nivel_max: number | null; bl: number | null; alerta: string | null; ts_min: number | null; tel_estado: TelemetriaEstado; }[]; vol_interescalas: any[]; vol_zonas: any[]; modulos_balance: { modulo: string; codigo: string; zona: any; dotacion_Mm3: number; entregado_hoja_Mm3: number; remanente_Mm3: number; consumido_Mm3: number; disponible_Mm3: number; pct: number | null; estado: string; }[]; presas: { nombre: any; almacenamiento_mm3: number | null; porcentaje_llenado: number | null; extraccion_m3s: number | null; escala_msnm: number | null; fecha: any; }[]; tomas_activas: { nombre: any; km: any; estado: any; caudal_ls: number; caudal_m3s: number; }[]; entregas_hoy: { modulo: any; codigo: any; zona: any; base_m3: number | null; base_m3s: number | null; base_lps: number | null; base_horario: string | null; adic_m3: number | null; adic_m3s: number | null; adic_lps: number | null; motivo: any; total_m3: number; }[]; evento_activo: { id: string; tipo: HydraulicEvent; fecha_inicio: string; gasto_solicitado: number | null; hora_apertura: string | null; autorizado_por: string | null; notas: string; } | null; timestamp: string; };
    snapshotCopied: boolean;
    volCiclo: VolumenCicloModulo[];
    volInterescalas: any[];
    volZonas: any[];
}) {
    return (
<div className="dock-section dock-skill-panel">
                        <div className="dock-section-header">
                            <span className="card-label">DATOS ACTUALES — SKILL v3.7</span>
                            {renderStateTag()}
                        </div>

                        {/* Banner de estado gerencial — explica el porqué de los S/D */}
                        {skillSnapshot.telemetria.estado !== 'EN_VIVO' && (
                            <div className={`dsk-state-banner dsk-state-banner--${
                                skillSnapshot.telemetria.estado === 'ATRASADO' ? 'warn' :
                                skillSnapshot.telemetria.estado === 'OFFLINE' ? 'off' : 'stale'}`}>
                                <span className="dsk-sb-icon">
                                    {skillSnapshot.telemetria.estado === 'ATRASADO' ? '◐' :
                                     skillSnapshot.telemetria.estado === 'OFFLINE'  ? '⊘' : '○'}
                                </span>
                                <div className="dsk-sb-text">
                                    <strong>
                                        {skillSnapshot.telemetria.estado === 'ATRASADO'
                                            ? 'Telemetría envejeciendo — balance de referencia'
                                            : skillSnapshot.telemetria.estado === 'OFFLINE'
                                            ? 'Sin lecturas activas — panel en espera de campo'
                                            : 'Telemetría vencida (>4 h) — balance no confiable'}
                                    </strong>
                                    <span>
                                        {skillSnapshot.telemetria.frescos} frescos · {skillSnapshot.telemetria.atrasados} atrasados · {skillSnapshot.telemetria.stale} vencidos
                                        {skillSnapshot.telemetria.sin_flujo > 0 && ` · ${skillSnapshot.telemetria.sin_flujo} sin gasto (solo nivel)`}
                                        {' '}de {skillSnapshot.telemetria.total} escalas.
                                        {' '}El balance global K-0/K-104 requiere lecturas &lt;4 h en ambos extremos y las 4 zonas.
                                        {' '}Los valores en gris son el último dato conocido (referencia, no medición en vivo).
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Contenido scrolleable */}
                        <div className="dsk-scroll-body">

                        {/* Balance global — translate="no": evita que el navegador
                            traduzca "S/D" (Sin Dato) a "Dakota del Sur" y otros
                            términos técnicos si el usuario fuerza traducción. */}
                        <div className="dsk-balance-row notranslate" translate="no">
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">K-0 entrada</span>
                                {skillSnapshot.balance.Q0 !== null
                                    ? <span className="dsk-bal-val dsk-val--green">{skillSnapshot.balance.Q0.toFixed(3)}</span>
                                    : skillSnapshot.balance.Q0_hist !== null
                                    ? <span className="dsk-bal-val dsk-val--hist" title={`Sin telemetría fresca (>4h). Último dato conocido hace ${fmtAge(skillSnapshot.balance.Q0_age_min)} — referencia, no medición en vivo.`}>{skillSnapshot.balance.Q0_hist.toFixed(3)}<small className="dsk-bal-age"> ·{fmtAge(skillSnapshot.balance.Q0_age_min)}</small></span>
                                    : <span className="dsk-bal-val dsk-val--red" title="K-0 sin telemetría &gt;4h">S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s</span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">K-104 salida</span>
                                {skillSnapshot.balance.Q104 !== null
                                    ? <span className="dsk-bal-val dsk-val--blue">{skillSnapshot.balance.Q104.toFixed(3)}</span>
                                    : skillSnapshot.balance.Q104_hist !== null
                                    ? <span className="dsk-bal-val dsk-val--hist" title={`Sin telemetría fresca (>4h). Último dato conocido hace ${fmtAge(skillSnapshot.balance.Q104_age_min)} — referencia, no medición en vivo.`}>{skillSnapshot.balance.Q104_hist.toFixed(3)}<small className="dsk-bal-age"> ·{fmtAge(skillSnapshot.balance.Q104_age_min)}</small></span>
                                    : <span className="dsk-bal-val dsk-val--red" title="Sin telemetría &gt;4h">S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s</span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">Eficiencia</span>
                                {skillSnapshot.balance.eficiencia !== null
                                    ? <span className={`dsk-bal-val ${skillSnapshot.balance.eficiencia >= 95 ? 'dsk-val--green' : skillSnapshot.balance.eficiencia >= 90 ? 'dsk-val--amber' : 'dsk-val--red'}`} title={skillSnapshot.balance.balance_modo === 'parcial' ? 'Balance parcial: K-104 con último dato conocido (no en vivo)' : undefined}>{skillSnapshot.balance.eficiencia.toFixed(1)}%{skillSnapshot.balance.balance_modo === 'parcial' && <small className="dsk-bal-age"> ref</small>}</span>
                                    : <span className="dsk-bal-val dsk-val--red" title={`Balance no confiable — ${skillSnapshot.balance.Q0 === null ? 'K-0 sin dato' : skillSnapshot.balance.Q104 === null ? 'K-104 sin dato' : `solo ${skillSnapshot.Q_ZONAS_MEDIDAS}/4 zonas medidas`}`}>S/D</span>
                                }
                                <span className="dsk-bal-unit"></span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">Pérdidas</span>
                                {skillSnapshot.balance.perdidas !== null
                                    ? <span className="dsk-bal-val dsk-val--amber" title={skillSnapshot.balance.balance_modo === 'parcial' ? 'Balance parcial: K-104 con último dato conocido (no en vivo)' : undefined}>{skillSnapshot.balance.perdidas.toFixed(3)}{skillSnapshot.balance.balance_modo === 'parcial' && <small className="dsk-bal-age"> ref</small>}</span>
                                    : <span className="dsk-bal-val dsk-val--red" title={`Balance no confiable — ${skillSnapshot.balance.Q0 === null ? 'K-0 sin dato' : skillSnapshot.balance.Q104 === null ? 'K-104 sin dato' : `solo ${skillSnapshot.Q_ZONAS_MEDIDAS}/4 zonas medidas`}`}>S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s</span>
                            </div>
                            <div className="dsk-bal-item">
                                <span className="dsk-bal-label">λ /km</span>
                                {skillSnapshot.balance.lambda !== null
                                    ? <span className="dsk-bal-val" title={skillSnapshot.balance.balance_modo === 'parcial' ? 'Balance parcial: K-104 con último dato conocido (no en vivo)' : undefined}>{skillSnapshot.balance.lambda.toFixed(5)}{skillSnapshot.balance.balance_modo === 'parcial' && <small className="dsk-bal-age"> ref</small>}</span>
                                    : <span className="dsk-bal-val dsk-val--red" title={`Balance no confiable — ${skillSnapshot.balance.Q0 === null ? 'K-0 sin dato' : skillSnapshot.balance.Q104 === null ? 'K-104 sin dato' : `solo ${skillSnapshot.Q_ZONAS_MEDIDAS}/4 zonas medidas`}`}>S/D</span>
                                }
                                <span className="dsk-bal-unit">m³/s·km⁻¹</span>
                            </div>
                        </div>

                        {/* Alertas de nivel */}
                        {skillSnapshot.alertas_nivel.length > 0 && (
                            <div className="dsk-alerts-strip">
                                {skillSnapshot.alertas_nivel.map(a => (
                                    <span key={a.nombre} className={`dsk-alert-tag ${a.tipo === 'NIVEL_CRITICO' ? 'dsk-alert--red' : 'dsk-alert--amber'}`}>
                                        ⚠ {a.nombre} BL={a.bl}m
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Tabla de checkpoints */}
                        <DataTable
                            propia
                            className="dsk-table" claseContenedor="dsk-table-wrap" captionOculto caption="Escalas del canal: niveles, gasto, calibración y telemetría"
                            clave={(c) => c.nombre} filas={skillSnapshot.checkpoints}
                            filaProps={(c) => ({ className: c.alerta === 'NIVEL_CRITICO' ? 'dsk-tr--critico' : c.alerta === 'PRECAUCION' ? 'dsk-tr--warn' : '' })}
                            columnas={[
                                { id: 'punto', titulo: 'PUNTO', className: 'dsk-td-nombre', render: (c) => c.nombre },
                                { id: 'km', titulo: 'KM', className: 'dsk-td-num', render: (c) => c.km },
                                { id: 'ha', titulo: 'H↑ (m)', className: 'dsk-td-num', render: (c) => c.hA != null ? c.hA.toFixed(3) : 'S/D' },
                                { id: 'hb', titulo: 'H↓ (m)', className: 'dsk-td-num', render: (c) => c.hB !== null && c.hB !== undefined ? c.hB.toFixed(3) : '—' },
                                {
                                    id: 'q', titulo: 'Q (m³/s)', className: 'dsk-td-num',
                                    claseFila: (c) => c.q != null && c.q > 0 ? 'dsk-td--q' : 'dsk-td--zero',
                                    ayuda: (c) => c.q != null ? (c.q === 0 ? 'Gasto medido: 0 (compuertas cerradas)' : undefined) : (c.ts_min === null ? 'Sin telemetría' : 'Nivel reportado, sin medición de gasto'),
                                    render: (c) => c.q != null ? c.q.toFixed(3) : 'S/D',
                                },
                                { id: 'm1', titulo: 'M1', className: 'dsk-td-num dsk-td--m1', render: (c) => c.m1.toFixed(4) },
                                { id: 'ap', titulo: 'AP (m)', className: 'dsk-td-num', render: (c) => c.apertura != null ? c.apertura.toFixed(3) : 'S/D' },
                                { id: 'bl', titulo: 'BL', className: 'dsk-td-num', claseFila: (c) => c.bl !== null && c.bl < 0 ? 'dsk-td--red' : c.bl !== null && c.bl < 0.10 ? 'dsk-td--amber' : undefined, render: (c) => c.bl !== null ? c.bl.toFixed(3) : '—' },
                                {
                                    id: 'tel', titulo: 'TEL', className: 'dsk-td-num',
                                    claseFila: (c) => c.ts_min === null ? 'dsk-tel--offline' : c.ts_min < 60 ? 'dsk-tel--ok' : c.ts_min < 120 ? 'dsk-tel--warn' : 'dsk-tel--critico',
                                    render: (c) => c.ts_min === null ? '—' : c.ts_min < 120 ? `${c.ts_min}m` : `${Math.round(c.ts_min / 60)}h`,
                                },
                            ]}
                        />

                        {/* Volumen por tramo interescala */}
                        {volInterescalas.length > 0 && (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">VOLUMEN EN CANAL — TRAMOS INTERESCALA</div>

                            {/* Aviso de aforo urgente — escalas vencidas que bloquean el balance.
                                Prioriza las más antiguas; con ellas frescas, sus tramos se recalculan. */}
                            {(() => {
                                const vencidas = skillSnapshot.checkpoints
                                    .filter(c => (c.ts_min === null || c.ts_min > 240) && !ESC_SIN_CONTROL.has(c.nombre))
                                    .map(c => ({ nombre: c.nombre, ts: c.ts_min }))
                                    .sort((a, b) => (b.ts ?? 1e9) - (a.ts ?? 1e9));
                                // En VACIADO el canal se está desaguando: pedir aforos es ruido operativo.
                                if (vencidas.length === 0 || modoVisualizacion === 'VACIADO') return null;
                                const fmt = (m: number | null) => m == null ? 'sin lectura' : m < 60 ? `sin reporte hace ${m} min` : `sin reporte hace ${(m / 60).toFixed(1)} h`;
                                // Críticas = sin lectura o >12 h (las que más bloquean)
                                const criticas = vencidas.filter(v => v.ts === null || (v.ts ?? 0) > 720);
                                return (
                                    <div className="dsk-aforo-aviso">
                                        <span className="dsk-aforo-icon">📡</span>
                                        <div className="dsk-aforo-text">
                                            <strong>{vencidas.length} escala{vencidas.length > 1 ? 's' : ''} requiere{vencidas.length > 1 ? 'n' : ''} aforo</strong>
                                            <span className="dsk-aforo-list">
                                                {vencidas.map(v => (
                                                    <span key={v.nombre} className={`dsk-aforo-chip ${v.ts === null || (v.ts ?? 0) > 720 ? 'dsk-aforo-chip--crit' : ''}`}>
                                                        {v.nombre} · {fmt(v.ts)}
                                                    </span>
                                                ))}
                                            </span>
                                            {criticas.length > 0 && (
                                                <span className="dsk-aforo-nota">
                                                    ⚠ {criticas.map(c => c.nombre).join(', ')} sin reportar &gt;12 h — bloquean el balance de sus tramos.
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Strip de alertas de fuga — excluye tramos con escalas STALE (>4h) o escalas de referencia sin control de gasto */}
                            {(() => {
                                const escStale = new Set(
                                    skillSnapshot.checkpoints
                                        .filter(c => c.ts_min === null || c.ts_min > 240)
                                        .map(c => c.nombre)
                                );
                                const tramosConfiables = balanceTramos.filter((b: any) => {
                                    if (ESC_SIN_CONTROL.has(b.escala_entrada) || ESC_SIN_CONTROL.has(b.escala_salida)) return false;
                                    if (escStale.has(b.escala_entrada) || escStale.has(b.escala_salida)) return false;
                                    return b.estado_balance === 'FUGA_ALTA' || b.estado_balance === 'FUGA_MEDIA';
                                });
                                const tramosStaleOSifon = balanceTramos.filter((b: any) =>
                                    (b.estado_balance === 'INCONSISTENCIA' || b.estado_balance === 'FUGA_ALTA') &&
                                    (ESC_SIN_CONTROL.has(b.escala_entrada) || ESC_SIN_CONTROL.has(b.escala_salida) ||
                                     escStale.has(b.escala_entrada) || escStale.has(b.escala_salida))
                                );
                                return (
                                    <>
                                    {tramosConfiables.length > 0 && (
                                        <div className="bt-alert-strip">
                                            {tramosConfiables.map((b: any) => (
                                                <div key={b.km_inicio} className={`bt-alert-item bt-alert--${b.estado_balance === 'FUGA_ALTA' ? 'alta' : 'media'}`}>
                                                    <span className="bt-alert-badge">{b.estado_balance === 'FUGA_ALTA' ? '⚠ FUGA ALTA' : '· FUGA MEDIA'}</span>
                                                    <span className="bt-alert-tramo">{b.escala_entrada} → {b.escala_salida}</span>
                                                    <span className="bt-alert-q">{Number(b.q_fuga_detectada).toFixed(3)} m³/s no contabilizados</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {tramosStaleOSifon.length > 0 && (
                                        <div className="bt-alert-strip">
                                            {tramosStaleOSifon.map((b: any) => (
                                                <div key={'stale-'+b.km_inicio} className="bt-alert-item bt-alert--stale">
                                                    <span className="bt-alert-badge">⊘ SIN DATO</span>
                                                    <span className="bt-alert-tramo">{b.escala_entrada} → {b.escala_salida}</span>
                                                    <span className="bt-alert-q">telemetría fuera de línea — balance no confiable</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    </>
                                );
                            })()}

                            {(() => {
                                const ESC_SIN_CONTROL_TB = new Set(['K-64', 'K-94+200']);
                                // Antigüedad (min) por escala: indica CUÁL falta y desde cuándo, en vez de un "S/D" genérico.
                                const edadMap = new Map<string, number | null>(
                                    skillSnapshot.checkpoints.map(c => [c.nombre, c.ts_min])
                                );
                                const edadTxt = (n: string) => {
                                    const m = edadMap.get(n);
                                    if (m == null) return 'sin lectura';
                                    return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
                                };
                                const esVencida = (n: string) => {
                                    const m = edadMap.get(n);
                                    return m == null || m > 240;
                                };
                                const info = (v: any) => {
                                    const bt = balanceTramos.find(b => Math.abs(Number(b.km_inicio) - Number(v.km_up)) < 0.1);
                                    const esSinControl = ESC_SIN_CONTROL_TB.has(v.esc_up) || ESC_SIN_CONTROL_TB.has(v.esc_down);
                                    // ¿Qué escala(s) frontera están vencidas? Para el detalle del motivo.
                                    const upVenc = esVencida(v.esc_up);
                                    const dnVenc = esVencida(v.esc_down);
                                    const esStale = upVenc || dnVenc;
                                    const sinDato = esSinControl || esStale;
                                    // Motivo legible de por qué el balance no es confiable
                                    const motivo = esSinControl
                                        ? 'Escala de referencia sin control de gasto'
                                        : upVenc && dnVenc
                                        ? `Ambas escalas vencidas (${v.esc_up} ${edadTxt(v.esc_up)}, ${v.esc_down} ${edadTxt(v.esc_down)})`
                                        : upVenc
                                        ? `Entrada ${v.esc_up} sin lectura fresca (${edadTxt(v.esc_up)})`
                                        : dnVenc
                                        ? `Salida ${v.esc_down} sin lectura fresca (${edadTxt(v.esc_down)})`
                                        : '';
                                    const estadoClass = sinDato ? 'bt-estado--stale'
                                        : bt?.estado_balance === 'FUGA_ALTA' ? 'bt-estado--alta'
                                        : bt?.estado_balance === 'FUGA_MEDIA' ? 'bt-estado--media'
                                        : bt?.estado_balance === 'INCONSISTENCIA' ? 'bt-estado--inconsistencia'
                                        : bt ? 'bt-estado--ok' : '';
                                    const rowClass = sinDato ? 'bt-row--stale'
                                        : bt?.estado_balance === 'FUGA_ALTA' ? 'bt-row--alta' : '';
                                    return { bt, esSinControl, esStale, sinDato, motivo, estadoClass, rowClass };
                                };
                                // Niveles y volumen SIEMPRE se muestran: dependen del tirante medido, no del gasto fresco.
                                // Q y fuga: ocultos solo si NO son confiables (gasto viejo daría fugas imposibles de ±37 m³/s);
                                // el ⊘ lleva tooltip con el motivo.
                                const q = (campo: 'q_entrada_m3s' | 'q_salida_m3s' | 'q_fuga_detectada') => (v: any) => { const x = info(v); return x.sinDato ? '⊘' : x.bt ? Number(x.bt[campo]).toFixed(3) : '—'; };
                                const ayudaQ = (v: any) => { const x = info(v); return x.sinDato ? x.motivo : undefined; };
                                return (
                                    <DataTable
                                        propia
                                        className="dsk-table" claseContenedor="dsk-table-wrap" captionOculto caption="Volumen y balance por tramo entre escalas"
                                        clave={(v: any) => String(v.km_up)} filas={volInterescalas as any[]}
                                        filaProps={(v: any) => { const x = info(v); return { className: x.rowClass, title: x.motivo || undefined }; }}
                                        columnas={[
                                            { id: 'tramo', titulo: 'TRAMO', className: 'dsk-td-tramo', render: (v: any) => `${v.esc_up} → ${v.esc_down}` },
                                            { id: 'l', titulo: 'L (km)', className: 'dsk-td-num', render: (v: any) => Number(v.longitud_km).toFixed(3) },
                                            { id: 'hup', titulo: <span title="H↑ escala entrada — nivel aguas arriba de compuerta">H↑ ent (m)</span>, className: 'dsk-td-num dsk-td--ref', ayuda: () => 'H↑ escala entrada (remanso aguas arriba de compuerta)', render: (v: any) => v.nivel_up_m != null ? Number(v.nivel_up_m).toFixed(3) : '—' },
                                            { id: 'hini', titulo: <span title="H↓ escala entrada — nivel real inicio de tramo, aguas abajo de compuerta">H↓ ent (m)</span>, className: 'dsk-td-num', ayuda: () => 'H↓ escala entrada — inicio real del tramo', render: (v: any) => v.nivel_ini_m != null ? Number(v.nivel_ini_m).toFixed(3) : '—' },
                                            { id: 'hfin', titulo: <span title="H↑ escala salida — nivel real fin de tramo, aguas arriba de siguiente compuerta">H↑ sal (m)</span>, className: 'dsk-td-num', ayuda: () => 'H↑ escala salida — fin real del tramo', render: (v: any) => v.nivel_fin_m != null ? Number(v.nivel_fin_m).toFixed(3) : '—' },
                                            { id: 'vol', titulo: 'Vol (m³)', className: 'dsk-td-num dsk-td--q', render: (v: any) => v.vol_m3 != null ? Number(v.vol_m3).toLocaleString('es-MX') : '—' },
                                            { id: 'mm3', titulo: 'Mm³', className: 'dsk-td-num', render: (v: any) => v.vol_mm3 != null ? Number(v.vol_mm3).toFixed(4) : '—' },
                                            { id: 'qe', titulo: 'Q↑ (m³/s)', className: 'dsk-td-num', ayuda: ayudaQ, render: q('q_entrada_m3s') },
                                            { id: 'qs', titulo: 'Q↓ (m³/s)', className: 'dsk-td-num', ayuda: ayudaQ, render: q('q_salida_m3s') },
                                            { id: 'qf', titulo: 'Fuga (m³/s)', className: 'dsk-td-num', ayuda: ayudaQ, render: q('q_fuga_detectada') },
                                            {
                                                id: 'bal', titulo: 'Balance', className: 'dsk-td-num bt-estado',
                                                claseFila: (v: any) => info(v).estadoClass, ayuda: (v: any) => info(v).motivo || undefined,
                                                render: (v: any) => { const x = info(v); return x.sinDato ? (x.esSinControl ? 'REF' : x.esStale ? '⏳ STALE' : 'S/D') : (x.bt?.estado_balance ?? '—'); },
                                            },
                                        ]}
                                    />
                                );
                            })()}
                        </div>
                        )}

                        {/* Almacenamiento por zona Z1–Z4 */}
                        {volZonas.length > 0 && (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">Almacenamiento por zona</div>
                            {/* Alertas de zona — vaciándose (<40%) Y sobrellenado (≥90%).
                                Una zona al 100% (riesgo de desbordamiento) es tan crítica como
                                una al 20%; antes solo se alertaban las zonas bajas. */}
                            {/* En VACIADO las zonas bajas son lo ESPERADO (no "críticas"): solo se alerta sobrellenado. */}
                            {volZonas.some((z: any) => { const p = Number(z.pct_llenado ?? 0); return (p < 40 && modoVisualizacion !== 'VACIADO') || p >= 90; }) && (
                                <div className="bt-alert-strip" style={{marginBottom:'6px'}}>
                                    {volZonas
                                        .filter((z: any) => { const p = Number(z.pct_llenado ?? 0); return (p < 40 && modoVisualizacion !== 'VACIADO') || p >= 90; })
                                        .map((z: any) => {
                                            const pct = Number(z.pct_llenado ?? 0);
                                            const sev = pct >= 100 || pct < 20 ? 'alta' : 'media';
                                            const badge =
                                                pct >= 100 ? '⚠ ZONA LLENA'
                                                : pct >= 90 ? '· ZONA ALTA'
                                                : pct < 20  ? '⚠ ZONA CRÍTICA'
                                                : '· ZONA BAJA';
                                            return (
                                                <div key={z.codigo} className={`bt-alert-item bt-alert--${sev}`}>
                                                    <span className="bt-alert-badge">{badge}</span>
                                                    <span className="bt-alert-tramo">{z.codigo} — {z.zona_nombre}</span>
                                                    <span className="bt-alert-q">{pct.toFixed(1)}% · {Number(z.vol_actual_mm3).toFixed(4)} Mm³</span>
                                                </div>
                                            );
                                        })}
                                </div>
                            )}
                            <div className="dsk-zonas-grid">
                                {volZonas.map((z: any) => {
                                    const pct = Math.min(Number(z.pct_llenado ?? 0), 100);
                                    const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f97316' : pct < 20 ? '#ef4444' : pct < 40 ? '#f97316' : '#22c55e';
                                    return (
                                        <div key={z.codigo} className="dsk-zona-card">
                                            <div className="dsk-zona-header">
                                                <span className="dsk-zona-code">{z.codigo}</span>
                                                <span className="dsk-zona-pct" style={{color}}>{pct.toFixed(1)}%</span>
                                            </div>
                                            <div className="dsk-zona-bar-bg">
                                                <div className="dsk-zona-bar-fill" style={{width:`${pct}%`, backgroundColor: color}} />
                                            </div>
                                            <div className="dsk-zona-stats">
                                                <span>Vol: {Number(z.vol_actual_mm3).toFixed(4)} Mm³</span>
                                                <span>Niv: {Number(z.nivel_medio_m).toFixed(3)}m</span>
                                                <span>Cap: {Number(z.y_capacidad_m).toFixed(2)}m</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="dsk-zona-total">
                                Vol total canal: <strong>{volZonas.reduce((s: number, z: any) => s + Number(z.vol_actual_mm3 ?? 0), 0).toFixed(4)} Mm³</strong>
                            </div>
                        </div>
                        )}

                        {/* Volumen a entregar vs entregado — ciclo (ÚNICA FUENTE: volumen_ciclo_modulo) */}
                        {modulosResumen.length > 0 && (() => {
                            const tot = totalesVolumenCiclo(volCiclo);
                            const ciclo = volCiclo[0];
                            const fmt = (v: number) => v.toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
                            const remDesde = volCiclo.map(v => v.remanenteDesde).filter(Boolean).sort()[0];
                            const remHasta = volCiclo.map(v => v.remanenteHasta).filter(Boolean).sort().slice(-1)[0];
                            return (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">VOLUMEN A ENTREGAR vs ENTREGADO — {ciclo?.cicloNombre?.toUpperCase() ?? 'CICLO'}</div>
                            <DataTable
                                propia
                                className="dsk-table" claseContenedor="dsk-table-wrap" captionOculto caption="Volumen a entregar contra entregado en el ciclo, por módulo"
                                clave={(r) => r.b ? String(r.b.modulo_id) : 'total'}
                                filas={[...modulosResumen.map((b: any) => ({ b })), { b: null }] as { b: any | null }[]}
                                filaProps={({ b }) => b ? { className: b.estado_volumen === 'agotado' ? 'dsk-tr--critico' : b.estado_volumen === 'alerta' ? 'dsk-tr--warn' : '' } : undefined}
                                columnas={[
                                    { id: 'mod', titulo: 'Módulo', className: 'dsk-td-nombre', render: ({ b }) => b ? (b.codigo_corto || b.modulo_nombre) : <strong>TOTAL</strong> },
                                    { id: 'zona', titulo: 'ZONA', className: 'dsk-td-num', render: ({ b }) => b ? (b.zona_codigo || '—') : '—' },
                                    { id: 'aut', titulo: 'A ENTREGAR (Mm³)', className: 'dsk-td-num', render: ({ b }) => b ? fmt(b.autorizado_mm3) : <strong>{fmt(tot.autorizadoMm3)}</strong> },
                                    { id: 'hoja', titulo: 'ENTREGADO (Mm³)', className: 'dsk-td-num', render: ({ b }) => b ? fmt(b.hoja_mm3) : <strong>{fmt(tot.hojaMm3)}</strong> },
                                    { id: 'rem', titulo: 'REMANENTE (Mm³)', className: 'dsk-td-num', render: ({ b }) => b ? (b.remanente_mm3 > 0 ? fmt(b.remanente_mm3) : '—') : <strong>{tot.remanenteMm3 > 0 ? fmt(tot.remanenteMm3) : '—'}</strong> },
                                    { id: 'tot', titulo: 'TOTAL (Mm³)', className: 'dsk-td-num dsk-td--q', render: ({ b }) => b ? fmt(b.entregado_mm3) : <strong>{fmt(tot.entregadoMm3)}</strong> },
                                    {
                                        id: 'pct', titulo: '%', className: 'dsk-td-num', estilo: () => ({ minWidth: 92 }),
                                        render: ({ b }) => {
                                            if (!b) return <strong>{tot.pctEntregado != null ? `${tot.pctEntregado.toFixed(1)}%` : 'S/D'}</strong>;
                                            const estado = b.estado_volumen as string;
                                            const pct = b.pct_entregado ?? 0;
                                            return (
                                                <>
                                                    <div className="dsk-zona-bar-bg" style={{ marginBottom: 2 }}>
                                                        <div className="dsk-zona-bar-fill" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: estado === 'agotado' ? 'var(--st-crit)' : estado === 'alerta' ? 'var(--st-warn)' : 'var(--st-info)' }} />
                                                    </div>
                                                    {b.pct_entregado != null ? `${pct.toFixed(1)}%` : 'S/D'}
                                                </>
                                            );
                                        },
                                    },
                                    { id: 'saldo', titulo: 'SALDO (Mm³)', className: 'dsk-td-num', claseFila: ({ b }) => b && b.saldo_mm3 < 0 ? 'dsk-td--red' : undefined, render: ({ b }) => b ? fmt(b.saldo_mm3) : <strong>{fmt(tot.saldoMm3)}</strong> },
                                    { id: 'estado', titulo: 'Estado', className: 'dsk-td-nombre', render: ({ b }) => b ? (b.estado_volumen === 'agotado' ? '🔴 Agotado' : b.estado_volumen === 'alerta' ? '⚠ Alta' : '✓ Normal') : '—' },
                                ]}
                            />
                            <div className="dsk-zona-total" style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                                Fuente única: hoja institucional mensual ({ciclo?.ultimoMesHoja ? `hasta ${ciclo.ultimoMesHoja}` : 's/d'}{ciclo?.hojaMesParcial ? ', mes parcial ⚠' : ''})
                                {tot.remanenteMm3 > 0 && <> + remanente de vaciado post-cierre ({remDesde} → {remHasta})</>}.
                                El remanente cuenta dentro del ciclo.
                            </div>
                        </div>
                            );
                        })()}

                        {/* Entregas del día por módulo — base y adicional */}
                        {entregasHoy.length > 0 && (
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">
                                ENTREGAS HOY — {new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' }).format(new Date())}
                            </div>
                            <div className="dsk-table-wrap">
                                <table className="dsk-table">
                                    <thead>
                                        <tr>
                                            <th rowSpan={2}>Módulo</th>
                                            <th rowSpan={2}>ZONA</th>
                                            <th colSpan={3} className="dsk-th-base">BASE</th>
                                            <th colSpan={3} className="dsk-th-adic">Adicional</th>
                                            <th rowSpan={2}>TOTAL m³</th>
                                        </tr>
                                        <tr>
                                            <th className="dsk-th-base-sub">m³</th>
                                            <th className="dsk-th-base-sub">L/s</th>
                                            <th className="dsk-th-base-sub">Horario</th>
                                            <th className="dsk-th-adic-sub">m³</th>
                                            <th className="dsk-th-adic-sub">L/s</th>
                                            <th className="dsk-th-adic-sub">Motivo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(() => {
                                            // Group by (modulo_id, zona_id) so multizone modules show one row per zone
                                            const seenKeys = new Set<string>();
                                            const pairs: { mid: string; zid: string | null }[] = [];
                                            for (const e of entregasHoy as any[]) {
                                                const k = `${e.modulo_id}_${e.zona_id ?? ''}`;
                                                if (!seenKeys.has(k)) { seenKeys.add(k); pairs.push({ mid: e.modulo_id, zid: e.zona_id ?? null }); }
                                            }
                                            return pairs.map(({ mid, zid }) => {
                                                const metaPrimary = balanceModulos.find(b => b.modulo_id === mid && b.es_primaria);
                                                const metaZone = balanceModulos.find(b => b.modulo_id === mid && (zid ? b.zona_id === zid : b.es_primaria)) ?? metaPrimary;
                                                const base = entregasHoy.find((e: any) => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'base');
                                                const adic = entregasHoy.find((e: any) => e.modulo_id === mid && (zid ? e.zona_id === zid : true) && e.tipo_entrega === 'adicional');
                                                const total = (base?.volumen_m3 ?? 0) + (adic?.volumen_m3 ?? 0);
                                                return (
                                                    <tr key={`${mid}_${zid ?? ''}`}>
                                                        <td className="dsk-td-nombre">{metaPrimary?.codigo_corto ?? mid}</td>
                                                        <td className="dsk-td-num">{metaZone?.zona_codigo ?? '—'}</td>
                                                        {/* BASE */}
                                                        <td className="dsk-td-num dsk-td--q">{base ? Number(base.volumen_m3).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                                        <td className="dsk-td-num">{base ? Number(base.gasto_lps).toFixed(1) : '—'}</td>
                                                        <td className="dsk-td-horario">{base ? `${base.hora_inicio ?? ''}${base.hora_inicio && base.hora_fin ? '–' : ''}${base.hora_fin ?? ''}` : '—'}</td>
                                                        {/* ADICIONAL */}
                                                        <td className={`dsk-td-num${adic ? ' dsk-td--adic' : ''}`}>{adic ? Number(adic.volumen_m3).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                                        <td className={`dsk-td-num${adic ? ' dsk-td--adic' : ''}`}>{adic ? Number(adic.gasto_lps).toFixed(1) : '—'}</td>
                                                        <td className="dsk-td-motivo">{adic?.motivo_adicional ?? '—'}</td>
                                                        {/* TOTAL */}
                                                        <td className="dsk-td-num dsk-td--q">{total > 0 ? Number(total).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</td>
                                                    </tr>
                                                );
                                            });
                                        })()}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td colSpan={2} className="dsk-td--total-label">Total día</td>
                                            <td className="dsk-td-num dsk-td--q">
                                                {Number(entregasHoy.filter((e: any) => e.tipo_entrega === 'base').reduce((s: number, e: any) => s + Number(e.volumen_m3), 0)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td colSpan={2} />
                                            <td className="dsk-td-num dsk-td--adic">
                                                {Number(entregasHoy.filter((e: any) => e.tipo_entrega === 'adicional').reduce((s: number, e: any) => s + Number(e.volumen_m3), 0)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                            <td colSpan={2} />
                                            <td className="dsk-td-num dsk-td--q">
                                                {Number(entregasHoy.reduce((s: number, e: any) => s + Number(e.volumen_m3), 0)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>
                        )}

                        {/* Calibración M1 — estado actual */}
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">CALIBRACIÓN M1 — ESTADO ACTUAL (SKILL v3.7)</div>
                            {(() => {
                                // Fuente y estado se calculan desde los datos reales en hydraulics.ts
                                const fuente = (n: string) =>
                                    n === 'K-0+000'  ? 'Aforo molinete 01/06/2026' :
                                    n === 'K-23'     ? 'Estimado estructural' :
                                    n === 'K-54'     ? 'Aforo 27/04/2026' :
                                    n === 'K-62'     ? 'Aforo 27/04/2026' :
                                    n === 'K-104'    ? 'Ancla salida' :
                                    n === 'K-64'     ? 'Escala referencia' :
                                    n === 'K-94+200' ? 'Escala referencia' :
                                    'Aforo anterior';
                                // Prioridad: estados nombrados explícitos (curados) ANTES que la heurística M1>1.5. Si no,
                                // una escala marcada VERIFICAR con M1>1.5 se mostraría como PENDIENTE y nunca llegaría a VERIFICAR.
                                const estadoM1 = (c: { nombre: string; m1: number }) =>
                                    c.nombre === 'K-64' || c.nombre === 'K-94+200' ? 'REFERENCIA' :
                                    c.nombre === 'K-0+000'  ? 'RECIENTE' :
                                    c.nombre === 'K-29' || c.nombre === 'K-68' || c.nombre === 'K-87+549' ? 'VERIFICAR' :
                                    c.m1 > 1.5              ? 'PENDIENTE' :
                                    'OK';
                                return (
                                    <DataTable
                                        propia
                                        className="dsk-table" claseContenedor="dsk-table-wrap" captionOculto caption="Calibración M1 por escala"
                                        clave={(c) => c.nombre} filas={skillSnapshot.checkpoints}
                                        filaProps={(c) => { const est = estadoM1(c); return { className: est === 'PENDIENTE' ? 'dsk-tr--warn' : est === 'RECIENTE' ? 'dsk-tr--reciente' : est === 'REFERENCIA' ? 'bt-row--stale' : '' }; }}
                                        columnas={[
                                            { id: 'esc', titulo: 'Escala', className: 'dsk-td-nombre', render: (c) => c.nombre },
                                            { id: 'm1', titulo: 'M1', className: 'dsk-td-num dsk-td--m1', render: (c) => c.m1.toFixed(4) },
                                            { id: 'src', titulo: 'Fuente', className: 'dsk-td-src', render: (c) => fuente(c.nombre) },
                                            {
                                                id: 'est', titulo: 'Estado', className: 'dsk-td-num',
                                                claseFila: (c) => { const est = estadoM1(c); return est === 'RECIENTE' ? 'dsk-val--green' : est === 'PENDIENTE' || est === 'VERIFICAR' ? 'dsk-val--amber' : est === 'REFERENCIA' ? 'bt-estado--stale' : undefined; },
                                                render: (c) => { const est = estadoM1(c); return est === 'RECIENTE' ? '✓ Reciente' : est === 'PENDIENTE' ? '⚠ Pendiente' : est === 'VERIFICAR' ? '? Verificar' : est === 'REFERENCIA' ? '· Referencia' : '✓ OK'; },
                                            },
                                        ]}
                                    />
                                );
                            })()}
                            <div className="dsk-nota">Cd=0.62 fijo · Cd_eff = Cd×M1 · PENDIENTE = sin aforo de campo · Recalibrar si SICA diverge &gt;5% vs aforo</div>
                        </div>

                        {/* Modelación Paralela */}
                        <div className="dsk-section-block">
                            <div className="dsk-sub-header">MODELACIÓN PARALELA — TRÁNSITO CANAL</div>
                            <div className="dsk-model-form">
                                <div className="dsk-model-input-row">
                                    <label className="dsk-model-label">Q entrada K-0 (m³/s)</label>
                                    <input
                                        type="number"
                                        className="dsk-model-input"
                                        value={modelQ0}
                                        onChange={e => setModelQ0(e.target.value)}
                                        placeholder={(skillSnapshot.balance.Q0 ?? 28).toFixed(3)}
                                        step="0.5"
                                        min="0"
                                        max="70"
                                    />
                                    <button
                                        type="button"
                                        className="dsk-btn dsk-btn--calc"
                                        onClick={() => {
                                            const q0 = parseFloat(modelQ0) || skillSnapshot.balance.Q0 || 28;
                                            // λ en vivo si el balance es confiable; si no, λ de referencia
                                            // calibrada (el simulador necesita un valor numérico).
                                            const lambda = skillSnapshot.balance.lambda ?? LAMBDA_REF;
                                            const qZonas = skillSnapshot.Q_ZONAS_REAL;
                                            const perdidasLin = lambda * 104;
                                            const q104 = Math.max(0, q0 - perdidasLin - qZonas);
                                            const ef = q0 > 0 ? (q0 - Math.max(0, perdidasLin)) / q0 * 100 : 0;
                                            const transitH = 13.87 / Math.sqrt(Math.max(q0, 1) / 28);
                                            setModelResult({ q104, qZonas, perdidasLin, ef, transitH });
                                        }}
                                    >
                                        Calcular
                                    </button>
                                </div>
                                {modelResult && (
                                    <div className="dsk-model-results">
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Extracciones Z1–Z4</span>
                                            <span className="dsk-model-res-val dsk-val--amber">{modelResult.qZonas.toFixed(3)} m³/s</span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Pérdidas lineales (λ×104)</span>
                                            <span className="dsk-model-res-val dsk-val--amber">{modelResult.perdidasLin.toFixed(3)} m³/s</span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Q estimado K-104</span>
                                            <span className="dsk-model-res-val dsk-val--blue">{modelResult.q104.toFixed(3)} m³/s</span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Eficiencia conducción</span>
                                            <span className={`dsk-model-res-val ${modelResult.ef >= 95 ? 'dsk-val--green' : modelResult.ef >= 90 ? 'dsk-val--amber' : 'dsk-val--red'}`}>
                                                {modelResult.ef.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="dsk-model-res-item">
                                            <span className="dsk-model-res-label">Tránsito K-0→K-104</span>
                                            <span className="dsk-model-res-val">{modelResult.transitH.toFixed(1)} h ({Math.round(modelResult.transitH * 60)} min)</span>
                                        </div>
                                    </div>
                                )}
                                <div className="dsk-nota">Q₁₀₄ = Q₀ − Q_zonas − λ×104 · Q_zonas={skillSnapshot.Q_ZONAS_REAL.toFixed(3)} m³/s · λ={(skillSnapshot.balance.lambda ?? LAMBDA_REF).toFixed(5)} m³/s·km⁻¹{skillSnapshot.balance.lambda === null ? ' (ref.)' : ''} · Tránsito ∝ 1/√(Q₀/28) calibrado a 8 min/km</div>
                            </div>
                        </div>

                        {/* Informe Skill — colapsable */}
                        <div className="dsk-section-block">
                            <button
                                type="button"
                                className="dsk-sub-header dsk-sub-header--toggle"
                                onClick={() => setShowSkillInforme(v => !v)}
                                aria-expanded={showSkillInforme ? 'true' : 'false'}
                            >
                                INFORME SKILL v3.7 — MÓDULOS Y METODOLOGÍA {showSkillInforme ? '▲' : '▼'}
                            </button>
                            {showSkillInforme && (
                                <div className="dsk-skill-informe">
                                    <div className="dsk-informe-section">
                                        <div className="dsk-informe-title">FÓRMULA BASE — GASTO POR COMPUERTA</div>
                                        <div className="dsk-informe-formula">Q = Cd × M1 × b × Σ(apertura_i) × √(2g·ΔH)</div>
                                        <div className="dsk-informe-params">Cd=0.62 · g=9.81 m/s² · b=ancho por compuerta · M1=factor calibración por escala</div>
                                    </div>
                                    <div className="dsk-informe-section">
                                        <div className="dsk-informe-title">Módulos operativos</div>
                                        <div className="dsk-modulos-grid">
                                            {/* Descripción de tramo por módulo (metadato estático);
                                                la ZONA se toma de balance_volumen_modulo (BD) para que
                                                nunca contradiga la tabla DOTACIÓN de arriba. */}
                                            {([
                                                { cod:'MOD-001', codCorto:'M1',  desc:'K-0 → K-23 · Derivaciones norte' },
                                                { cod:'MOD-002', codCorto:'M2',  desc:'K-23 → K-29 · Zona baja Conchos' },
                                                { cod:'MOD-003', codCorto:'M3',  desc:'K-29 → K-44 · Gravedad centro' },
                                                { cod:'MOD-004', codCorto:'M4',  desc:'K-44 → K-62 · Riego tradicional' },
                                                { cod:'MOD-005', codCorto:'M5',  desc:'K-62 → K-79 · Gravedad sur' },
                                                { cod:'MOD-006', codCorto:'M6',  desc:'K-79 → K-104 · Cola canal' },
                                            ] as { cod: string; codCorto: string; desc: string }[]).map(m => {
                                                const live = modulosResumen.find(r => r.codigo_corto === m.codCorto || r.modulo_id === m.cod);
                                                const zona = live?.zona_codigo || '—';
                                                return (
                                                <div key={m.cod} className="dsk-modulo-tag">
                                                    <span className="dsk-mod-code">{m.cod}</span>
                                                    <span className="dsk-mod-zona">{zona}</span>
                                                    <span className="dsk-mod-desc">{m.desc}</span>
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="dsk-informe-section">
                                        <div className="dsk-informe-title">Instrucciones clave</div>
                                        <ul className="dsk-informe-list">
                                            <li>BL &lt; 0 = CRÍTICO: reducir entradas de inmediato</li>
                                            <li>BL 0–10 cm = PRECAUCIÓN: monitoreo continuo</li>
                                            <li>M1 &gt; 1.5 indica desgaste probable o calibración pendiente</li>
                                            <li>λ objetivo: &lt; 0.0004 m³/s·km⁻¹ (eficiencia de conducción normal)</li>
                                            <li>Aforo de campo requerido cada 30 días por escala</li>
                                            <li>Tránsito K-0 → K-104: ~14 h a Q=28 m³/s</li>
                                            <li>Recalibrar M1 cuando SICA diverge &gt;5% vs aforo</li>
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </div>

                        </div>{/* /dsk-scroll-body */}

                        {/* Timestamp y acciones */}
                        <div className="dsk-footer">
                            <span className="dsk-ts">
                                {(() => {
                                    const d = new Date(skillSnapshot.timestamp);
                                    const tzLabel = d.toLocaleTimeString('es-MX', { timeZoneName: 'short', timeZone: 'America/Chihuahua' }).split(' ').pop() ?? 'CDT';
                                    const hhmm = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Chihuahua' });
                                    return `Snapshot: ${hhmm} ${tzLabel}`;
                                })()}
                            </span>
                            <div className="dsk-actions">
                                <button
                                    type="button"
                                    className={`dsk-btn ${snapshotCopied ? 'dsk-btn--copied' : ''}`}
                                    onClick={() => {
                                        navigator.clipboard.writeText(JSON.stringify(skillSnapshot, null, 2));
                                        setSnapshotCopied(true);
                                        setTimeout(() => setSnapshotCopied(false), 2000);
                                    }}
                                    title="Copiar JSON al portapapeles para usar en Claude"
                                >
                                    <Copy size={11} />
                                    {snapshotCopied ? 'Copiado!' : 'Copiar JSON'}
                                </button>
                                <button
                                    type="button"
                                    className="dsk-btn dsk-btn--download"
                                    onClick={() => {
                                        const now = new Date();
                                        const cdtStr = now.toLocaleString('sv-SE', { timeZone: 'America/Chihuahua' })
                                            .replace(' ', '_').replace(/:/, 'h').replace(':', 'm').replace(/:\d+$/, '');
                                        const tzLabel = now.toLocaleTimeString('es-MX', { timeZoneName: 'short', timeZone: 'America/Chihuahua' }).split(' ').pop()?.toLowerCase() ?? 'cdt';
                                        const eventoTag = skillSnapshot.evento_activo ? `_${skillSnapshot.evento_activo.tipo.toLowerCase()}` : '_operacion';
                                        const blob = new Blob([JSON.stringify(skillSnapshot, null, 2)], { type: 'application/json' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = `snapshot_${cdtStr}_${tzLabel}${eventoTag}.json`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                    }}
                                    title="Descargar snapshot JSON"
                                >
                                    <Download size={11} />
                                    Snapshot
                                </button>
                                <button
                                    type="button"
                                    className="dsk-btn dsk-btn--skill-md"
                                    onClick={() => {
                                        const a = document.createElement('a');
                                        a.href = '/datos/skill_hidraulica_v37.md';
                                        a.download = 'skill_hidraulica_v37.md';
                                        a.click();
                                    }}
                                    title="Descargar skill hidráulica completa v3.7"
                                >
                                    <Download size={11} />
                                    Skill v3.7
                                </button>
                            </div>
                        </div>
                    </div>
    );
}
