/**
 * PANEL DE DETALLE POR ESTACIÓN — SICA-005
 *
 * Se abre al seleccionar una tarjeta de la red y muestra SOLO datos de esa
 * estación: balance hídrico, acumulados, serie temporal, viento y calidad.
 *
 * Criterio de presentación heredado del panel SKILL del Monitor: donde no hay
 * dato confiable se escribe «S/D» o el motivo del bloqueo — nunca un 0, que se
 * leería como una medición de valor cero.
 */

import { useMemo, useState, useEffect } from 'react';
import {
    X, Droplets, Wind, Thermometer, Activity, Zap, CloudRain,
    AlertTriangle, Loader, CalendarDays, MapPin, Gauge, Share2,
} from 'lucide-react';
import {
    ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { EstacionConLectura } from '../hooks/useClimaEstaciones';
import {
    useEstacionDetalle, VENTANAS, diasDelRango, type RangoAnalisis,
} from '../hooks/useEstacionDetalle';
import type { BalanceHidrico } from '../utils/estacionDetalle';
import { formateaEdad, PROCEDENCIA_LABEL } from '../utils/cielo';
import { exportEstacionInforme } from '../utils/exportEstacionInforme';
import './EstacionDetalle.css';

const rolLabel = (rol: string) =>
    rol === 'presa' ? 'Presa' : rol === 'modulo' ? 'Módulo' : 'Canal';

/** Formatea un número o devuelve «S/D»: un guion vacío se confunde con cero. */
const f = (v: number | null | undefined, dec = 1, suf = '') =>
    v == null ? 'S/D' : `${v.toFixed(dec)}${suf}`;

const fechaCorta = (iso: string) => {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
};

// ── Bloque 1: balance hídrico ──────────────────────────────────────────────

const BalanceCard = ({ b, titulo }: { b: BalanceHidrico; titulo: string }) => {
    const deficit = b.deficitMm;
    // Positivo = la atmósfera pidió más agua de la que llovió: hay que reponer.
    const color = deficit == null ? '#64748b' : deficit > 0 ? '#f59e0b' : '#22c55e';

    return (
        <div className="bal-card">
            <div className="bal-titulo">
                {titulo}
                {/* La ventana real manda: 30 días pedidos con 3 días de dato son 3. */}
                {b.ventanaParcial && b.diasReales > 0 && (
                    <em className="bal-parcial" title={`Se solicitaron ${b.diasSolicitados} días; solo hay ${b.diasReales} con dato`}>
                        {b.diasReales} d reales
                    </em>
                )}
            </div>

            {b.bloqueo ? (
                <div className="bal-bloqueo">
                    <AlertTriangle size={14} />
                    <span>{b.bloqueo}</span>
                </div>
            ) : (
                <>
                    <div className="bal-cifra" style={{ color }}>
                        {deficit != null ? `${deficit > 0 ? '+' : ''}${deficit.toFixed(1)}` : 'S/D'}
                        <small>mm</small>
                    </div>
                    <div className="bal-leyenda">
                        {deficit == null ? 'sin balance'
                            : deficit > 0 ? 'déficit — reponer con riego'
                            : 'excedente — la lluvia cubrió la demanda'}
                    </div>
                    <div className="bal-desglose">
                        <span><Activity size={11} /> ETₒ {f(b.etoAcumMm)} mm</span>
                        <span><CloudRain size={11} /> Lluvia {f(b.lluviaAcumMm)} mm</span>
                    </div>
                </>
            )}

            {b.etoDiaMediaMm != null && (
                <div className="bal-media">
                    Demanda media <b>{b.etoDiaMediaMm.toFixed(2)} mm/día</b>
                    <em>{b.diasReales} día(s) cerrado(s)</em>
                </div>
            )}
        </div>
    );
};

// ── Panel principal ────────────────────────────────────────────────────────

interface Props {
    estacion: EstacionConLectura;
    onCerrar: () => void;
}

/** Fecha local (America/Chihuahua) en formato YYYY-MM-DD, para los inputs date. */
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });
const haceDiasISO = (dias: number) =>
    new Date(Date.now() - dias * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });

const EstacionDetalle = ({ estacion, onCerrar }: Props) => {
    const [rango, setRango] = useState<RangoAnalisis>({ tipo: 'ventana', dias: 30 });
    // Borrador del rango manual: solo se aplica (dispara la consulta) al confirmar,
    // para no relanzar la carga con cada tecla mientras el usuario edita la fecha.
    const [manualDesde, setManualDesde] = useState(haceDiasISO(30));
    const [manualHasta, setManualHasta] = useState(hoyISO());
    const [mostrarManual, setMostrarManual] = useState(false);
    const { detalle, loading, error } = useEstacionDetalle(estacion, rango);
    const [generandoInforme, setGenerandoInforme] = useState(false);

    const diasVentana = diasDelRango(rango);
    const errorRangoManual = manualDesde > manualHasta ? 'La fecha "desde" debe ser anterior a "hasta".' : null;

    const aplicarManual = () => {
        if (errorRangoManual) return;
        setRango({ tipo: 'manual', rango: { desde: manualDesde, hasta: manualHasta } });
    };

    const generarInforme = async () => {
        if (!detalle) return;
        setGenerandoInforme(true);
        try {
            await exportEstacionInforme(estacion, detalle, rango);
        } catch (e) {
            console.error('[EstacionDetalle] no se pudo generar el informe:', e);
            alert(e instanceof Error ? e.message : 'No se pudo generar el informe de la estación.');
        } finally {
            setGenerandoInforme(false);
        }
    };

    // Comportamiento de diálogo modal: se declara aria-modal, así que Escape debe
    // cerrar y el fondo no debe desplazarse bajo el overlay.
    useEffect(() => {
        const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
        document.addEventListener('keydown', alPulsar);
        const overflowPrevio = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', alPulsar);
            document.body.style.overflow = overflowPrevio;
        };
    }, [onCerrar]);

    const l = estacion.lectura;
    const q = estacion.calidad;

    // Serie para la gráfica: un punto por día cerrado + el día en curso.
    const serie = useMemo(() => (detalle?.dias ?? []).map(d => ({
        fecha: fechaCorta(d.fecha),
        ETo: d.etoMm != null ? +d.etoMm.toFixed(2) : null,
        Lluvia: d.lluviaMm != null ? +d.lluviaMm.toFixed(1) : null,
        TMax: d.tempMaxC != null ? +d.tempMaxC.toFixed(1) : null,
        TMin: d.tempMinC != null ? +d.tempMinC.toFixed(1) : null,
        parcial: !d.completo,
    })), [detalle]);

    const rosaTop = useMemo(() => {
        const r = (detalle?.rosa ?? []).filter(x => x.pct > 0);
        return [...r].sort((a, b) => b.pct - a.pct).slice(0, 3);
    }, [detalle]);

    return (
        <div className="est-det-overlay" onClick={onCerrar} role="presentation">
            <div
                className="est-det-panel"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Detalle de la estación ${estacion.nombre}`}
            >
                {/* Cabecera */}
                <header className="est-det-head">
                    <div className="est-det-ident">
                        <h3><MapPin size={16} /> {estacion.nombre}</h3>
                        <div className="est-det-meta">
                            <em className="est-det-rol">{rolLabel(estacion.rol)}</em>
                            {estacion.ciudad && <span>{estacion.ciudad}</span>}
                            <span>{Number(estacion.elevacion_msnm) || '—'} msnm</span>
                            <span style={{ color: q.color }}>● {q.etiqueta} · {formateaEdad(q.edadMin)}</span>
                        </div>
                    </div>
                    <button className="est-det-cerrar" onClick={onCerrar} aria-label="Cerrar detalle">
                        <X size={18} />
                    </button>
                </header>

                {/* Selector de ventana */}
                <div className="est-det-ventana">
                    <CalendarDays size={13} />
                    <span>Ventana de análisis:</span>
                    {VENTANAS.map(v => (
                        <button
                            key={v}
                            className={rango.tipo === 'ventana' && rango.dias === v ? 'activa' : ''}
                            onClick={() => { setMostrarManual(false); setRango({ tipo: 'ventana', dias: v }); }}
                        >{v} días</button>
                    ))}
                    <button
                        className={rango.tipo === 'manual' || mostrarManual ? 'activa' : ''}
                        onClick={() => setMostrarManual(m => !m)}
                    >Personalizado</button>
                    {detalle && (
                        <em className="est-det-cobertura">
                            {detalle.diasConDato} día(s) con dato · {detalle.totalLecturas} lecturas
                        </em>
                    )}
                    {detalle && (
                        <button
                            className="est-det-informe"
                            onClick={generarInforme}
                            disabled={generandoInforme}
                            title="Generar informe de esta estación para compartir"
                        >
                            {generandoInforme
                                ? <Loader size={13} className="girando" />
                                : <Share2 size={13} />}
                            {generandoInforme ? 'Generando…' : 'Informe'}
                        </button>
                    )}
                </div>

                {mostrarManual && (
                    <div className="est-det-manual">
                        <label>
                            Desde
                            <input type="date" value={manualDesde} max={manualHasta}
                                   onChange={e => setManualDesde(e.target.value)} />
                        </label>
                        <label>
                            Hasta
                            <input type="date" value={manualHasta} min={manualDesde} max={hoyISO()}
                                   onChange={e => setManualHasta(e.target.value)} />
                        </label>
                        <button
                            className="est-det-manual-aplicar"
                            onClick={aplicarManual}
                            disabled={!!errorRangoManual}
                        >Aplicar</button>
                        {errorRangoManual && <span className="est-det-manual-error">{errorRangoManual}</span>}
                        {rango.tipo === 'manual' && !errorRangoManual && (
                            <em className="est-det-manual-activo">
                                Mostrando {fechaCorta(rango.rango.desde)} – {fechaCorta(rango.rango.hasta)}
                            </em>
                        )}
                    </div>
                )}

                {loading && (
                    <div className="est-det-cargando"><Loader size={16} className="girando" /> Cargando histórico…</div>
                )}
                {error && (
                    <div className="est-det-error"><AlertTriangle size={14} /> {error}</div>
                )}

                {detalle && !loading && (
                    <div className="est-det-cuerpo">

                        {/* ── ETo de referencia: el arreglo del "0.00" ──────────
                            La cifra que manda es el CIERRE del último día completo.
                            El acumulado de hoy va al lado, rotulado como parcial. */}
                        <section className="est-det-sec">
                            <h4><Activity size={14} /> Demanda evaporativa (ETₒ)</h4>
                            <div className="eto-ref">
                                <div className="eto-principal">
                                    <span className="eto-num">{f(detalle.referencia.cierreMm, 2)}</span>
                                    <small>mm</small>
                                    <div className="eto-etq">
                                        Cierre del {detalle.referencia.cierreFecha
                                            ? fechaCorta(detalle.referencia.cierreFecha) : 'último día'}
                                        <em>cifra de referencia para dimensionar el riego</em>
                                    </div>
                                </div>
                                <div className="eto-secundario">
                                    <span>{f(detalle.referencia.hoyParcialMm, 2)} <small>mm</small></span>
                                    <div className="eto-etq">
                                        Acumulado de hoy al corte
                                        {/* Sin esta nota, un 0.00 de madrugada se lee como "no hay demanda". */}
                                        {detalle.referencia.hoyEsMadrugada && (
                                            <em className="eto-aviso">
                                                parcial de madrugada: el día apenas inicia, no indica ausencia de demanda
                                            </em>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* ── Balance hídrico ────────────────────────────────── */}
                        <section className="est-det-sec">
                            <h4><Droplets size={14} /> Balance hídrico (ETₒ − lluvia)</h4>
                            <div className="bal-grid">
                                <BalanceCard b={detalle.balance7} titulo="Últimos 7 días" />
                                <BalanceCard b={detalle.balanceVentana}
                                    titulo={rango.tipo === 'manual'
                                        ? `${fechaCorta(rango.rango.desde)} – ${fechaCorta(rango.rango.hasta)}`
                                        : `Últimos ${diasVentana} días`} />
                            </div>
                            {detalle.pluviometro === 'ausente' && (
                                <p className="est-det-nota aviso">
                                    <AlertTriangle size={12} /> Esta estación no registra lluvia en ninguna
                                    escala (día, 24 h, mes y año en cero). Se trata como sensor ausente, no como
                                    ausencia de precipitación: para el balance de esta zona, usar el dato de una
                                    estación vecina con pluviómetro.
                                </p>
                            )}
                        </section>

                        {/* ── Acumulados y extremos ─────────────────────────── */}
                        <section className="est-det-sec">
                            <h4><Gauge size={14} /> Acumulados y extremos</h4>
                            <div className="acum-grid">
                                <div className="acum-item">
                                    <span className="acum-val">{f(detalle.lluviaMesMm)}</span>
                                    <span className="acum-lbl">mm lluvia · mes</span>
                                </div>
                                <div className="acum-item">
                                    <span className="acum-val">{f(detalle.lluviaAnioMm)}</span>
                                    <span className="acum-lbl">mm lluvia · año</span>
                                </div>
                                <div className="acum-item">
                                    <span className="acum-val">{f(detalle.etMesMm)}</span>
                                    <span className="acum-lbl">mm ETₒ · mes</span>
                                </div>
                                <div className="acum-item">
                                    <span className="acum-val">
                                        {detalle.rachaSecaDias != null ? detalle.rachaSecaDias : 'S/D'}
                                    </span>
                                    <span className="acum-lbl">días sin lluvia</span>
                                </div>
                                <div className="acum-item">
                                    <span className="acum-val">{f(l?.temp_max_c)}</span>
                                    <span className="acum-lbl">°C máx. hoy</span>
                                </div>
                                <div className="acum-item">
                                    <span className="acum-val">{f(l?.temp_min_c)}</span>
                                    <span className="acum-lbl">°C mín. hoy</span>
                                </div>
                                <div className="acum-item">
                                    <span className="acum-val">{f(l?.gdd, 0)}</span>
                                    <span className="acum-lbl">GDD (base 10 °C)</span>
                                </div>
                                <div className="acum-item">
                                    <span className="acum-val">{f(l?.uv_index, 1)}</span>
                                    <span className="acum-lbl">índice UV</span>
                                </div>
                            </div>
                            {/* El contador anual arranca al instalar la estación, no en el
                                año hidrológico: decirlo evita compararlo con una normal. */}
                            <p className="est-det-nota">
                                Los acumulados de mes y año provienen del contador propio de la estación
                                y se cuentan desde su instalación, no desde el inicio del año hidrológico.
                            </p>
                        </section>

                        {/* ── Serie temporal ─────────────────────────────────── */}
                        <section className="est-det-sec">
                            <h4><Thermometer size={14} /> Evolución diaria</h4>
                            {serie.length >= 2 ? (
                                <div className="est-det-chart">
                                    <ResponsiveContainer width="100%" height={240}>
                                        <ComposedChart data={serie} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                                            <XAxis dataKey="fecha" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                            <YAxis yAxisId="mm" tick={{ fontSize: 10, fill: '#94a3b8' }}
                                                   label={{ value: 'mm', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 10 }} />
                                            <YAxis yAxisId="t" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }}
                                                   label={{ value: '°C', angle: 90, position: 'insideRight', fill: '#94a3b8', fontSize: 10 }} />
                                            <Tooltip
                                                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, fontSize: 12 }}
                                                labelStyle={{ color: '#e2e8f0' }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                            <Bar yAxisId="mm" dataKey="Lluvia" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                                            <Line yAxisId="mm" type="monotone" dataKey="ETo" name="ETₒ" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                                            <Line yAxisId="t" type="monotone" dataKey="TMax" name="T máx" stroke="#ef4444" strokeWidth={1.5} dot={false} connectNulls />
                                            <Line yAxisId="t" type="monotone" dataKey="TMin" name="T mín" stroke="#60a5fa" strokeWidth={1.5} dot={false} connectNulls />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                    {serie.some(s => s.parcial) && (
                                        <p className="est-det-nota">
                                            El último punto corresponde al día en curso y es un acumulado parcial.
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="est-det-nota aviso">
                                    <AlertTriangle size={12} /> Se necesitan al menos 2 días cerrados para trazar la
                                    evolución; hay {detalle.diasConDato}. La serie se completará conforme la estación reporte.
                                </p>
                            )}
                        </section>

                        {/* ── Viento y riesgo térmico ────────────────────────── */}
                        <section className="est-det-sec">
                            <h4><Wind size={14} /> Viento y condición nocturna</h4>
                            <div className="viento-grid">
                                <div className="viento-actual">
                                    <div className="v-fila">
                                        <span>Actual</span>
                                        <b>{f(l?.viento_ms)} m/s</b>
                                    </div>
                                    <div className="v-fila">
                                        <span>Ráfaga</span>
                                        <b>{f(l?.viento_rafaga_ms)} m/s</b>
                                    </div>
                                    <div className="v-fila">
                                        <span>Dirección</span>
                                        <b>{l?.viento_dir_deg != null ? `${Math.round(l.viento_dir_deg)}°` : 'S/D'}</b>
                                    </div>
                                    {/* Umbral operativo de aspersión/aplicación foliar. */}
                                    {l?.viento_ms != null && l.viento_ms > 4 && (
                                        <div className="v-alerta">
                                            <AlertTriangle size={12} /> Sobre 4 m/s: deriva en aspersión
                                        </div>
                                    )}
                                </div>
                                <div className="viento-rosa">
                                    <span className="v-titulo">Procedencia dominante</span>
                                    {rosaTop.length ? rosaTop.map(r => (
                                        <div className="v-sector" key={r.sector}>
                                            <span className="v-sec-lbl">{r.sector}</span>
                                            <div className="v-barra">
                                                <div className="v-barra-fill" style={{ width: `${r.pct.toFixed(0)}%` }} />
                                            </div>
                                            <span className="v-sec-pct">{r.pct.toFixed(0)}%</span>
                                            <span className="v-sec-vel">{f(r.velMediaMs)} m/s</span>
                                        </div>
                                    )) : <em className="est-det-nota">Sin registros de dirección en la ventana.</em>}
                                </div>
                                <div className="riesgo-term" style={{ borderColor: detalle.riesgo.color }}>
                                    <span className="v-titulo">Riesgo térmico</span>
                                    <b style={{ color: detalle.riesgo.color }}>{detalle.riesgo.etiqueta}</b>
                                    <div className="riesgo-det">
                                        <span>T mín · {f(detalle.riesgo.tempMinC)} °C</span>
                                        <span>Spread T−Td · {f(detalle.riesgo.spreadMinC)} °C</span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* ── Cielo y pronóstico vigente ─────────────────────── */}
                        <section className="est-det-sec">
                            <h4><Zap size={14} /> Cielo y pronóstico</h4>
                            <div className="cielo-det">
                                <div className="cielo-det-estado" style={{ borderColor: estacion.cielo.color }}>
                                    <span style={{ color: estacion.cielo.color }}>
                                        {estacion.cielo.icono && <span>{estacion.cielo.icono} </span>}
                                        {estacion.cielo.etiqueta}
                                        {estacion.cielo.coberturaPct != null && <b> · {estacion.cielo.coberturaPct}%</b>}
                                    </span>
                                    <em>{PROCEDENCIA_LABEL[estacion.cielo.procedencia]}</em>
                                </div>
                                <div className="cielo-det-vars">
                                    <span>Radiación · <b>{f(l?.rad_solar_wm2, 0)} W/m²</b></span>
                                    <span>Presión · <b>{f(l?.presion_hpa)} hPa</b></span>
                                    <span>Tendencia bar. · <b>{f(l?.bar_trend_hpa, 2)} hPa</b></span>
                                    <span>Punto de rocío · <b>{f(l?.punto_rocio_c)} °C</b></span>
                                </div>
                            </div>
                            {estacion.pronostico ? (
                                <div className="fc-det">
                                    <span>Prob. lluvia · <b>{estacion.pronostico.precip_prob_pct != null
                                        ? `${estacion.pronostico.precip_prob_pct}%` : 'S/D'}</b></span>
                                    <span>Lámina prevista · <b>{f(estacion.pronostico.precip_mm)} mm</b></span>
                                    <span>ETₒ modelo · <b>{f(estacion.pronostico.eto_fc_mm, 2)} mm</b></span>
                                    <span>Horizonte · <b>{estacion.pronostico.horizonte_h ?? '—'} h</b></span>
                                </div>
                            ) : (
                                <p className="est-det-nota">Sin pronóstico sincronizado para esta estación.</p>
                            )}
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EstacionDetalle;
