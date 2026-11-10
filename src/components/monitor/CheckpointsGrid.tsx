import { useMap, CircleMarker, Popup, Tooltip } from 'react-leaflet';
import React, { useEffect } from 'react';
import type { EscalaData } from './canalHelpers';
import { ESC_SIN_CONTROL, escalaVencida, COLOR_VENCIDO, UMBRAL_CRITICO, UMBRAL_ALERTA, UMBRAL_NORMAL, telemetriaEstado, telemetriaLabel, escalaAlertColor } from './canalHelpers';

// Map Controller to handle dynamic centering with offset for mobile UI
export const MapController = ({ center, zoom, active }: { center: [number, number], zoom: number, active: boolean }) => {
    const map = useMap();
    useEffect(() => {
        if (active && center) {
            // Apply a slight vertical offset for mobile if dock is likely covering the bottom
            const isMobile = window.innerWidth <= 900;
            const finalCenter: [number, number] = isMobile ? [center[0] - 0.05, center[1]] : center;
            map.setView(finalCenter, zoom, { animate: true });
        }
    }, [center, zoom, active, map]);
    return null;
};

// Grid de tarjetas "RED DE PUNTOS DE CONTROL" — compartido entre las
// pestañas RESUMEN y CANAL (antes duplicado línea por línea en ambas).
// React.memo: solo redibuja cuando cambian los datos reales, no en cada
// tick de 60s del reloj del monitor si escalas/coherencia no cambiaron.
export const CheckpointsGrid = React.memo(({ escalas, coherenciaCanal, displayMaxKm, isEstabilizacion, statusColor, currentTime }: {
    escalas: EscalaData[];
    coherenciaCanal: any;
    displayMaxKm: number;
    isEstabilizacion: boolean;
    statusColor: string;
    currentTime: number;
}) => {
    const formatTimeAgo = (timestamp?: number | null) => {
        if (!timestamp) return 'SIN DATOS';
        const diffSeconds = Math.max(0, Math.floor((currentTime - timestamp) / 1000));
        if (diffSeconds < 60) return `HACE ${diffSeconds}s`;
        const diffMins = Math.floor(diffSeconds / 60);
        if (diffMins < 60) return `${diffMins}m`;
        const diffHours = Math.floor(diffMins / 60);
        const remainingMins = diffMins % 60;
        return `${diffHours}h ${remainingMins}m`;
    };

    return (
        <div className="checkpoints-scroll-container">
            {[...escalas]
                .sort((a, b) => a.km - b.km)
                .map((e) => {
                    // Coherencia individual: marcar punto incoherente
                    const puntoCoh = coherenciaCanal?.puntos.find((p: any) => p.id === e.id);
                    const incoherente = puntoCoh && !puntoCoh.coherente;
                    const referencia = ESC_SIN_CONTROL.has(e.nombre);
                    const vencida = escalaVencida(e);
                    const hayNivel = e.nivel_actual != null;
                    const nMax = e.nivel_max_operativo && e.nivel_max_operativo > 0 ? e.nivel_max_operativo : null;
                    const pct = nMax && hayNivel ? (e.nivel_actual as number) / nMax : null;
                    const margenCm = nMax && hayNivel ? Math.round((nMax - (e.nivel_actual as number)) * 100) : null;
                    const nivelCol = vencida || pct === null ? COLOR_VENCIDO
                        : pct >= UMBRAL_CRITICO ? '#ef4444' : pct >= UMBRAL_ALERTA ? '#f59e0b' : pct >= UMBRAL_NORMAL ? '#22c55e' : '#3FB2F3';
                    const tieneGasto = isEstabilizacion && !referencia && e.gasto_actual != null;
                    const cerrada = tieneGasto && (e.gasto_actual as number) === 0 && (e.apertura_actual ?? 0) === 0;
                    const capQ = e.capacidad_max && e.capacidad_max > 0 ? e.capacidad_max : null;
                    const pctQ = tieneGasto && capQ ? Math.min(1, (e.gasto_actual as number) / capQ) : null;
                    const d = e.delta_12h;
                    const dCm = d != null ? Math.round(d * 100) : null;
                    return (
                    <div
                        className={`checkpoint-card-compact ${e.km <= displayMaxKm ? 'active' : ''} ${incoherente ? 'cpc-incoherente' : ''} ${vencida ? 'cpc-vencida' : ''}`}
                        key={e.id}
                        title={vencida ? 'Lectura con más de 4 h: dato de referencia, no estado en vivo' : undefined}
                    >
                        <div className="cpc-km">{e.km.toFixed(1)} <small>KM</small>{referencia && <span className="cpc-ref-tag" title="Escala de referencia: sin compuertas propias">REF</span>}</div>
                        <div className="cpc-body">
                            <span className="cpc-name">{e.nombre}</span>
                            <div className="cpc-data">
                                <span className="cpc-value" style={{ color: hayNivel && !vencida ? undefined : '#8396ad' }}>{hayNivel ? (e.nivel_actual as number).toFixed(2) : 'S/D'}</span>
                                <small className="cpc-unit">m</small>
                                {!vencida && dCm != null && (
                                    <span className={`cpc-trend ${dCm > 0 ? 'is-up' : dCm < 0 ? 'is-down' : ''}`}
                                        title={`Variación del nivel en 12 h: ${dCm > 0 ? '+' : ''}${dCm} cm`}>
                                        {dCm > 0 ? '▲' : dCm < 0 ? '▼' : '—'} {Math.abs(dCm)} cm
                                    </span>
                                )}
                            </div>
                            {nMax && (
                                <div className="cpc-ctx" title={`Máximo operativo ${nMax.toFixed(2)} m`}>
                                    {pct !== null ? <><b style={{ color: nivelCol }}>{Math.round(pct * 100)}%</b> máx. · <span title="Margen al máximo operativo">{margenCm! >= 0 ? `+${margenCm}` : margenCm} cm</span></> : <>máx. {nMax.toFixed(2)} m</>}
                                </div>
                            )}
                            {isEstabilizacion && !referencia && (
                                <div className="cpc-extra">
                                    {tieneGasto ? (
                                        <span className="cpc-gasto">{cerrada ? 'Cerrada · 0.00 m³/s' : `${(e.gasto_actual as number).toFixed(2)} m³/s`}{pctQ !== null && !cerrada ? <small> · {Math.round(pctQ * 100)}% cap.</small> : null}</span>
                                    ) : (
                                        <span className="cpc-gasto cpc-sd">Gasto S/D</span>
                                    )}
                                    {(e.apertura_actual ?? 0) > 0 && (
                                        <span className="cpc-apertura">
                                            ⊿ {(e.apertura_actual ?? 0).toFixed(2)} m
                                            {e.puertas_abiertas != null && e.pzas_radiales != null
                                                ? ` · ${e.puertas_abiertas}/${e.pzas_radiales} comp.`
                                                : ''}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="cpc-status-bar" title={pct !== null ? `Nivel al ${Math.round(pct * 100)}% del máximo operativo` : 'Sin nivel / sin máximo operativo'}>
                            <div
                                className="cpc-progress"
                                style={{
                                    width: isEstabilizacion
                                        ? (pct !== null ? `${Math.min(100, pct * 100)}%` : '0%')
                                        : (e.km <= displayMaxKm ? '100%' : '0%'),
                                    background: incoherente ? '#ef4444' : isEstabilizacion ? nivelCol : statusColor
                                }}
                            />
                        </div>
                        <div className="cpc-time" style={{ color: vencida ? '#fbbf24' : undefined }}>{formatTimeAgo(e.ultima_telemetria)}</div>
                    </div>
                    );
                })}
        </div>
    );
});

// Marcador individual de escala en el mapa — extraído y memoizado para que
// las ~14 escalas no reconstruyan su Popup/Tooltip completo (con todos sus
// cálculos de color/estado) en cada render disparado por el tick de 60s del
// reloj del monitor cuando el dato de esa escala en particular no cambió.
export const EscalaMarker = React.memo(({ esc, displayMaxKm, isEstabilizacion, coherenciaCanal, statusColor }: {
    esc: EscalaData;
    displayMaxKm: number;
    isEstabilizacion: boolean;
    coherenciaCanal: any;
    statusColor: string;
}) => {
    // Valores compartidos entre CircleMarker props, Tooltip y Popup
    const nivel     = esc.nivel_actual ?? 0;
    const hayNivel  = esc.nivel_actual != null;
    const vencida   = escalaVencida(esc);
    const nivelMax  = esc.nivel_max_operativo && esc.nivel_max_operativo > 0 ? esc.nivel_max_operativo : null;
    const nivelPct  = nivelMax && hayNivel ? Math.min(100, (nivel / nivelMax) * 100) : null;
    const barColor  = vencida ? COLOR_VENCIDO : nivelPct === null ? '#3FB2F3' : nivelPct >= UMBRAL_CRITICO * 100 ? '#ef4444' : nivelPct >= UMBRAL_ALERTA * 100 ? '#f59e0b' : '#3FB2F3';
    const gasto     = esc.gasto_actual ?? 0;
    const apertura  = esc.apertura_actual ?? 0;
    const telEstado = telemetriaEstado(esc.ultima_telemetria);
    const telTxt    = telemetriaLabel(telEstado);
    const tsAge     = esc.ultima_telemetria ? (Date.now() - esc.ultima_telemetria) / 60000 : null;
    const delta     = esc.delta_12h ?? 0;
    const trendSym  = delta > 0.01 ? '▲' : delta < -0.01 ? '▼' : '—';

    // Color del marcador en mapa
    const alertColor = esc.km <= displayMaxKm
        ? (isEstabilizacion ? escalaAlertColor(esc, coherenciaCanal) : statusColor)
        : '#1e293b';

    // Offline solo cuando la escala YA reportó alguna vez pero perdió señal.
    // Si ultima_telemetria es null nunca tuvo dato → mostrar con opacidad plena.
    const hasEverReported = esc.ultima_telemetria !== null;
    const isOffline = hasEverReported && telEstado === 'FUERA_DE_LINEA';

    // Clase CSS para animaciones de estado
    const markerClass = [
        isOffline ? 'esc-offline' : '',
        !vencida && nivelPct !== null && nivelPct >= UMBRAL_CRITICO * 100 ? 'esc-critical' : '',
        !vencida && nivelPct !== null && nivelPct >= UMBRAL_ALERTA * 100 && nivelPct < UMBRAL_CRITICO * 100 ? 'esc-warning' : '',
    ].filter(Boolean).join(' ') || undefined;

    // Badge operativo en popup
    let badgeLabel = 'SIN DATOS';
    let badgeColor = '#475569';
    if (esc.estado === 'OPERANDO' && nivel > 0) {
        if (gasto > 0) { badgeLabel = 'OPERANDO'; badgeColor = '#22c55e'; }
        else           { badgeLabel = 'SIN FLUJO'; badgeColor = '#f59e0b'; }
    } else if (esc.estado === 'LLENADO') {
        badgeLabel = 'EN LLENADO'; badgeColor = '#06b6d4';
    } else if (nivel > 0) {
        badgeLabel = 'CON NIVEL'; badgeColor = '#3FB2F3';
    }

    const tiempoLectura = tsAge === null ? 'Sin datos'
        : tsAge < 1    ? 'Hace menos de 1 min'
        : tsAge < 60   ? `Hace ${Math.floor(tsAge)} min`
        : tsAge < 1440 ? `Hace ${Math.floor(tsAge / 60)}h ${Math.floor(tsAge % 60)}min`
        : 'Más de un día';

    return (
        <CircleMarker
            center={[esc.latitud!, esc.longitud!]}
            radius={esc.km <= displayMaxKm ? 6 : 4}
            fillColor={alertColor}
            color={isOffline ? '#475569' : '#fff'}
            weight={1.5}
            fillOpacity={isOffline ? 0.35 : 1}
            className={markerClass}
        >
            <Popup className="custom-popup sica-cp-popup">
                <div className="scp-root">
                    <div className="scp-header">
                        <span className="scp-km">KM {esc.km.toFixed(1)}</span>
                        <span className="scp-badge" style={{ '--badge-color': badgeColor } as React.CSSProperties}>
                            {badgeLabel}
                        </span>
                    </div>
                    <div className="scp-nombre-row">
                        <p className="scp-nombre">{esc.nombre}</p>
                        <span className="scp-signal" data-tel={telEstado} title={telTxt} />
                    </div>
                    <div className="scp-section">
                        <span className="scp-field-label">Nivel de agua</span>
                        <div className="scp-bar-row">
                            <div className="scp-bar-track">
                                <div className="scp-bar-fill" style={{ '--bar-w': nivelPct !== null ? `${nivelPct}%` : '0%', '--bar-color': barColor } as React.CSSProperties} />
                            </div>
                            <span className="scp-bar-val" style={{ '--bar-color': barColor } as React.CSSProperties}>{hayNivel ? `${nivel.toFixed(2)} m` : 'S/D'}</span>
                        </div>
                        {nivelMax && <span className="scp-ref">máx. operativo {nivelMax.toFixed(2)} m{nivelPct !== null ? ` · ${nivelPct.toFixed(0)}%` : ''}{vencida && hayNivel ? ' · dato vencido' : ''}</span>}
                    </div>
                    {(gasto > 0 || apertura > 0) && (
                        <div className="scp-metrics">
                            {gasto > 0 && (
                                <div className="scp-metric">
                                    <span className="scp-metric-label">Flujo medido</span>
                                    <span className="scp-metric-val">{gasto.toFixed(2)}</span>
                                    <span className="scp-metric-unit">m³/s</span>
                                </div>
                            )}
                            {apertura > 0 && (
                                <div className="scp-metric">
                                    <span className="scp-metric-label">Apertura acum.</span>
                                    <span className="scp-metric-val">{apertura.toFixed(2)}</span>
                                    <span className="scp-metric-unit">
                                        m{esc.puertas_abiertas != null && esc.pzas_radiales != null
                                            ? ` · ${esc.puertas_abiertas}/${esc.pzas_radiales} comp.`
                                            : esc.pzas_radiales != null ? ` · ${esc.pzas_radiales} comp.` : ''}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="scp-footer">
                        <span className="scp-footer-time" data-tel={telEstado}>{tiempoLectura}</span>
                        <span className="scp-footer-signal" data-tel={telEstado}>{telTxt}</span>
                    </div>
                </div>
            </Popup>

            {/* Mini-badge permanente cuando hay nivel; tooltip hover cuando no hay datos */}
            <Tooltip
                className={nivel > 0 ? `esc-level-badge${vencida ? ' esc-level-badge--vencida' : ''}` : 'custom-tooltip'}
                direction="top"
                offset={[0, -8]}
                permanent={nivel > 0}
                interactive={false}
                opacity={nivel > 0 ? 1 : 0.9}
            >
                {nivel > 0
                    ? <span className="elb-content">
                        <span className="elb-val">{nivel.toFixed(2)}m</span>
                        {!vencida && <span className="elb-arrow" data-dir={delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'flat'}>{trendSym}</span>}
                      </span>
                    : <span>{esc.nombre}</span>
                }
            </Tooltip>
        </CircleMarker>
    );
});
