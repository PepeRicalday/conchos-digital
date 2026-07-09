import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type {
  SerieEscala, SerieTramo, SerieCompuerta, SerieGasto, SeriePunto,
} from '../utils/tendencias';
import { statsSerie } from '../utils/tendencias';

// Paleta categórica validada (dataviz): blue, aqua, yellow, green, violet, red, magenta, orange
const PAL = ['#3987e5', '#199e70', '#c98500', '#2fb35a', '#9085e9', '#e66767', '#d55181', '#d95926',
             '#38bdf8', '#22c55e', '#eab308', '#f472b6', '#a78bfa', '#fb7185'];

const n2 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(2);
const n3 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(3);

// ── Mini-gráfica de líneas genérica (multi-serie) con crosshair + tooltip ───
const fmtFecha = (t: number) => new Date(t).toLocaleString('es-MX', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua',
});
const MultiLine: React.FC<{
  series: { nombre: string; puntos: SeriePunto[]; color: string; dashed?: boolean }[];
  t0: number; t1: number;
  yLabel?: string; height?: number;
  yMinHint?: number; yMaxHint?: number;
  band?: { y: number; label: string } | null;
  zeroLine?: boolean;
}> = ({ series, t0, t1, yLabel, height = 150, yMinHint, yMaxHint, band, zeroLine }) => {
  const W = 720, PL = 40, PR = 14, PT = 14, PB = 24;
  const ph = height - PT - PB, pw = W - PL - PR;
  // hoverT: timestamp de la muestra más cercana al puntero (null = sin hover)
  const [hoverT, setHoverT] = useState<number | null>(null);
  // Unión ordenada de timestamps con dato (para "snap" del crosshair)
  const allTs = useMemo(() => {
    const s = new Set<number>();
    for (const se of series) for (const p of se.puntos) if (p.y != null) s.add(p.t);
    return [...s].sort((a, b) => a - b);
  }, [series]);
  const allY = series.flatMap(s => s.puntos.map(p => p.y).filter((v): v is number => v != null));
  if (!allY.length) return <div className="tnd-empty">Sin datos en el rango.</div>;
  let yMin = Math.min(...allY, ...(yMinHint != null ? [yMinHint] : []));
  let yMax = Math.max(...allY, ...(yMaxHint != null ? [yMaxHint] : []));
  if (band) yMax = Math.max(yMax, band.y);
  if (zeroLine) yMin = Math.min(yMin, 0);
  const pad = (yMax - yMin) * 0.08 || 0.5;
  yMin -= pad; yMax += pad;
  const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  const yS = (y: number) => PT + ph - ((y - yMin) / Math.max(1e-6, yMax - yMin)) * ph;
  const ticks = 4;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!allTs.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xVB = (e.clientX - rect.left) / rect.width * W;              // px → unidades viewBox
    const t = t0 + Math.max(0, Math.min(1, (xVB - PL) / pw)) * (t1 - t0);
    let best = allTs[0];
    for (const ts of allTs) if (Math.abs(ts - t) < Math.abs(best - t)) best = ts;
    setHoverT(best);
  };

  // Valores de cada serie en hoverT (tolerancia: mitad del paso mediano de muestreo)
  const tol = allTs.length > 1 ? Math.max(30 * 60_000, (allTs[allTs.length - 1] - allTs[0]) / allTs.length / 2) : 12 * 3600_000;
  const hoverVals = hoverT == null ? [] : series.map(s => {
    let bp: SeriePunto | null = null;
    for (const p of s.puntos) {
      if (p.y == null) continue;
      if (bp == null || Math.abs(p.t - hoverT) < Math.abs(bp.t - hoverT)) bp = p;
    }
    return bp && Math.abs(bp.t - hoverT) <= tol ? { nombre: s.nombre, color: s.color, y: bp.y as number, t: bp.t } : null;
  }).filter((v): v is { nombre: string; color: string; y: number; t: number } => v != null);

  // Tooltip: caja a la derecha del crosshair, volteada si no cabe
  const tipW = 128, tipH = 14 + hoverVals.length * 11;
  const hx = hoverT != null ? xS(hoverT) : 0;
  const tipX = hx + tipW + 10 > W - PR ? hx - tipW - 8 : hx + 8;
  const tipY = PT + 4;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block', touchAction: 'none' }}
      onPointerMove={onMove} onPointerLeave={() => setHoverT(null)}>
      <rect width={W} height={height} fill="#0a1220" rx="5" />
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const y = yMin + (i / ticks) * (yMax - yMin);
        return (
          <g key={i}>
            <line x1={PL} y1={yS(y)} x2={PL + pw} y2={yS(y)} stroke="#16233a" strokeWidth="0.7" />
            <text x={PL - 4} y={yS(y) + 3} fill="#5c7391" fontSize="8" textAnchor="end" fontFamily="monospace">{y.toFixed(1)}</text>
          </g>
        );
      })}
      {zeroLine && yMin < 0 && yMax > 0 && (
        <line x1={PL} y1={yS(0)} x2={PL + pw} y2={yS(0)} stroke="#475569" strokeWidth="1" strokeDasharray="3,3" />
      )}
      {band && (
        <>
          <line x1={PL} y1={yS(band.y)} x2={PL + pw} y2={yS(band.y)} stroke="#ef4444" strokeWidth="1" strokeDasharray="5,4" opacity="0.6" />
          <text x={PL + pw - 2} y={yS(band.y) - 3} fill="#ef4444" fontSize="7.5" textAnchor="end" fontFamily="monospace" opacity="0.8">{band.label}</text>
        </>
      )}
      {series.map((s, si) => {
        const pts = s.puntos.filter(p => p.y != null);
        if (pts.length < 1) return null;
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xS(p.t).toFixed(1)},${yS(p.y as number).toFixed(1)}`).join(' ');
        return (
          <g key={si}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="1.6" strokeDasharray={s.dashed ? '4,3' : undefined} strokeLinejoin="round" opacity="0.95" />
            {pts.map((p, i) => <circle key={i} cx={xS(p.t).toFixed(1)} cy={yS(p.y as number).toFixed(1)} r="1.8" fill={s.color} />)}
          </g>
        );
      })}
      {yLabel && <text x={PL} y={PT - 3} fill="#64748b" fontSize="8" fontFamily="monospace">{yLabel}</text>}

      {/* ── Capa de hover: crosshair + puntos resaltados + tooltip ── */}
      {hoverT != null && hoverVals.length > 0 && (
        <g pointerEvents="none">
          <line x1={hx} y1={PT} x2={hx} y2={PT + ph} stroke="#7dd3fc" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.7" />
          {hoverVals.map((v, i) => (
            <circle key={i} cx={xS(v.t)} cy={yS(v.y)} r="3.4" fill={v.color} stroke="#0a1220" strokeWidth="1.4" />
          ))}
          <g>
            <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="5" fill="#0f1c30" stroke="rgba(125,211,252,0.35)" strokeWidth="0.8" opacity="0.97" />
            <text x={tipX + 7} y={tipY + 11} fill="#7dd3fc" fontSize="7.5" fontFamily="monospace" fontWeight="bold">{fmtFecha(hoverT)}</text>
            {hoverVals.map((v, i) => (
              <g key={i}>
                <circle cx={tipX + 10} cy={tipY + 20 + i * 11} r="2.4" fill={v.color} />
                <text x={tipX + 16} y={tipY + 23 + i * 11} fill="#cbd5e1" fontSize="7.5" fontFamily="monospace">
                  {v.nombre.slice(0, 14)} <tspan fontWeight="bold" fill="#f1f5f9">{v.y.toFixed(2)}</tspan>
                </text>
              </g>
            ))}
          </g>
        </g>
      )}
    </svg>
  );
};

// ── Área apilada para volumen por tramo — hover identifica la banda ─────────
const StackedArea: React.FC<{ series: SerieTramo[]; t0: number; t1: number; height?: number }> = ({ series, t0, t1, height = 160 }) => {
  const W = 720, PL = 42, PR = 14, PT = 14, PB = 24;
  const ph = height - PT - PB, pw = W - PL - PR;
  const [hover, setHover] = useState<{ i: number; band: number | null } | null>(null);
  // fechas comunes (usa las del primer tramo con datos)
  const base = series.find(s => s.puntos.length)?.puntos ?? [];
  if (!base.length) return <div className="tnd-empty">Sin datos en el rango.</div>;
  const idxs = base.map((_, i) => i);
  const totals = idxs.map(i => series.reduce((s, se) => s + (se.puntos[i]?.y ?? 0), 0));
  const yMax = Math.max(...totals, 0.1) * 1.05;
  const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  const yS = (y: number) => PT + ph - (y / yMax) * ph;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xVB = (e.clientX - rect.left) / rect.width * W;
    const yVB = (e.clientY - rect.top) / rect.height * height;
    // índice de fecha más cercano
    let bi = 0;
    for (let i = 0; i < base.length; i++) if (Math.abs(xS(base[i].t) - xVB) < Math.abs(xS(base[bi].t) - xVB)) bi = i;
    // banda (tramo) bajo el cursor: valor y en unidades de volumen
    const yVal = Math.max(0, (PT + ph - yVB) / ph) * yMax;
    let accV = 0, band: number | null = null;
    for (let si = 0; si < series.length; si++) {
      const v = series[si].puntos[bi]?.y ?? 0;
      if (yVal >= accV && yVal < accV + v) { band = si; break; }
      accV += v;
    }
    setHover({ i: bi, band });
  };

  // acumular de abajo hacia arriba
  const acc = idxs.map(() => 0);
  const hovI = hover?.i ?? null;
  const tipW = 168, tipH = hover?.band != null ? 38 : 26;
  const hx = hovI != null ? xS(base[hovI].t) : 0;
  const tipX = hovI != null && hx + tipW + 10 > W - PR ? hx - tipW - 8 : hx + 8;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block', touchAction: 'none' }}
      onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <rect width={W} height={height} fill="#0a1220" rx="5" />
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <g key={i}>
          <line x1={PL} y1={yS(yMax * f)} x2={PL + pw} y2={yS(yMax * f)} stroke="#16233a" strokeWidth="0.7" />
          <text x={PL - 4} y={yS(yMax * f) + 3} fill="#5c7391" fontSize="8" textAnchor="end" fontFamily="monospace">{(yMax * f).toFixed(1)}</text>
        </g>
      ))}
      {series.map((se, si) => {
        const top = idxs.map(i => acc[i] + (se.puntos[i]?.y ?? 0));
        const poly = [
          ...idxs.map(i => `${xS(se.puntos[i]?.t ?? base[i].t).toFixed(1)},${yS(top[i]).toFixed(1)}`),
          ...idxs.slice().reverse().map(i => `${xS(se.puntos[i]?.t ?? base[i].t).toFixed(1)},${yS(acc[i]).toFixed(1)}`),
        ].join(' ');
        idxs.forEach(i => { acc[i] = top[i]; });
        // banda hovered se resalta; el resto se atenúa levemente
        const dim = hover?.band != null && hover.band !== si;
        return <polygon key={si} points={poly} fill={PAL[si % PAL.length]} opacity={dim ? 0.28 : 0.62} stroke={PAL[si % PAL.length]} strokeWidth={hover?.band === si ? 1.2 : 0.5} />;
      })}
      <text x={PL} y={PT - 3} fill="#64748b" fontSize="8" fontFamily="monospace">Volumen por tramo (Mm³) — apilado</text>

      {hovI != null && (
        <g pointerEvents="none">
          <line x1={hx} y1={PT} x2={hx} y2={PT + ph} stroke="#7dd3fc" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.7" />
          <rect x={tipX} y={PT + 4} width={tipW} height={tipH} rx="5" fill="#0f1c30" stroke="rgba(125,211,252,0.35)" strokeWidth="0.8" opacity="0.97" />
          <text x={tipX + 7} y={PT + 15} fill="#7dd3fc" fontSize="7.5" fontFamily="monospace" fontWeight="bold">
            {new Date(base[hovI].t).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
            <tspan fill="#cbd5e1" fontWeight="normal">  · Total </tspan>
            <tspan fill="#f1f5f9" fontWeight="bold">{totals[hovI].toFixed(3)} Mm³</tspan>
          </text>
          {hover?.band != null && (
            <text x={tipX + 7} y={PT + 27} fill="#cbd5e1" fontSize="7.5" fontFamily="monospace">
              <tspan fill={PAL[hover.band % PAL.length]}>■</tspan> {series[hover.band].etiqueta.slice(0, 16)}: <tspan fontWeight="bold" fill="#f1f5f9">{(series[hover.band].puntos[hovI]?.y ?? 0).toFixed(3)}</tspan>
            </text>
          )}
        </g>
      )}
    </svg>
  );
};

interface Props {
  loading: boolean;
  rangoDesde: string; rangoHasta: string;
  granularidad: 'diaria' | 'lectura';
  onRango: (desde: string, hasta: string) => void;
  onGranularidad: (g: 'diaria' | 'lectura') => void;
  niveles: SerieEscala[];
  volTramos: SerieTramo[];
  volTotal: SeriePunto[];
  compuertas: SerieCompuerta[];
  gasto: SerieGasto;
}

const TendenciasPanel: React.FC<Props> = ({
  loading, rangoDesde, rangoHasta, granularidad, onRango, onGranularidad,
  niveles, volTramos, volTotal, compuertas, gasto,
}) => {
  const [t0, t1] = useMemo(() => {
    const a = new Date(`${rangoDesde}T00:00:00-06:00`).getTime();
    const b = new Date(`${rangoHasta}T23:59:59-06:00`).getTime();
    return [a, b];
  }, [rangoDesde, rangoHasta]);

  const preset = (dias: number) => {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - dias * 864e5);
    onRango(desde.toISOString().slice(0, 10), hasta.toISOString().slice(0, 10));
  };

  // ── Riel de scroll a la izquierda ────────────────────────────────────────
  // Controla el .dsk-scroll-body padre (el contenedor scrolleable real). Da al
  // usuario una zona táctil inequívoca para desplazar el panel, sin competir
  // con el scroll horizontal de las tablas.
  const rootRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ top: 0, height: 100, visible: false });
  const scrollerRef = useRef<HTMLElement | null>(null);

  const syncThumb = useCallback(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const ratio = sc.clientHeight / sc.scrollHeight;
    if (ratio >= 1) { setThumb(t => ({ ...t, visible: false })); return; }
    const trackH = sc.clientHeight - 8;                      // alto del riel (top/bottom 4px)
    const h = Math.max(30, ratio * trackH);
    const top = (sc.scrollTop / (sc.scrollHeight - sc.clientHeight)) * (trackH - h);
    setThumb({ top, height: h, visible: true });
  }, []);

  useEffect(() => {
    // El scroller es el ancestro .dsk-scroll-body del panel
    const sc = rootRef.current?.closest('.dsk-scroll-body') as HTMLElement | null;
    scrollerRef.current = sc;
    if (!sc) return;
    syncThumb();
    sc.addEventListener('scroll', syncThumb, { passive: true });
    const ro = new ResizeObserver(syncThumb);
    ro.observe(sc);
    return () => { sc.removeEventListener('scroll', syncThumb); ro.disconnect(); };
  }, [syncThumb, niveles, volTramos, compuertas, gasto, loading]);

  // Arrastre del riel: mapea la posición del puntero a scrollTop del panel.
  const dragRef = useRef(false);
  const railToScroll = (clientY: number, railEl: HTMLElement) => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const rect = railEl.getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    sc.scrollTop = rel * (sc.scrollHeight - sc.clientHeight);
  };
  const onRailDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    railToScroll(e.clientY, e.currentTarget);
  };
  const onRailMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) railToScroll(e.clientY, e.currentTarget);
  };
  const onRailUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  return (
    <div className="tnd-root" ref={rootRef}>
      {/* Riel de scroll táctil — controla el panel completo */}
      {thumb.visible && (
        <div className="tnd-rail" onPointerDown={onRailDown} onPointerMove={onRailMove}
             onPointerUp={onRailUp} onPointerCancel={onRailUp}
             role="scrollbar" aria-label="Desplazar panel de tendencias" aria-orientation="vertical">
          <div className="tnd-rail-track">
            <span className="tnd-rail-hint">scroll</span>
            <div className="tnd-rail-thumb" style={{ top: thumb.top, height: thumb.height }} />
          </div>
        </div>
      )}
      {/* Controles */}
      <div className="tnd-controls">
        <div className="tnd-dates">
          <label>Desde <input type="date" value={rangoDesde} max={rangoHasta} onChange={e => onRango(e.target.value, rangoHasta)} /></label>
          <label>Hasta <input type="date" value={rangoHasta} min={rangoDesde} onChange={e => onRango(rangoDesde, e.target.value)} /></label>
        </div>
        <div className="tnd-presets">
          <button type="button" onClick={() => preset(7)}>7 d</button>
          <button type="button" onClick={() => preset(30)}>30 d</button>
          <button type="button" onClick={() => preset(90)}>90 d</button>
        </div>
        <div className="tnd-gran">
          <button type="button" className={granularidad === 'diaria' ? 'on' : ''} onClick={() => onGranularidad('diaria')}>Diaria</button>
          <button type="button" className={granularidad === 'lectura' ? 'on' : ''} onClick={() => onGranularidad('lectura')}>Por lectura</button>
        </div>
      </div>

      {loading && <div className="tnd-loading">Cargando periodo…</div>}

      {!loading && (
        <>
          {/* ── Bloque 1: niveles por escala ── */}
          <div className="tnd-block">
            <div className="tnd-h"><span className="tnd-n" style={{ background: '#3987e5' }}>1</span> Tendencia de niveles por escala</div>
            <MultiLine
              series={niveles.map((s, i) => ({ nombre: s.nombre, puntos: s.puntos, color: PAL[i % PAL.length] }))}
              t0={t0} t1={t1} yLabel="Nivel (m)" height={168}
            />
            <div className="tnd-legend">
              {niveles.map((s, i) => <span key={s.escala_id}><i style={{ background: PAL[i % PAL.length] }} />K-{s.km}</span>)}
            </div>
            <div className="dsk-table-wrap">
              <table className="dsk-table">
                <thead><tr><th>Escala</th><th>Mín</th><th>Máx</th><th>Prom</th><th>Δ periodo</th><th>Lect.</th></tr></thead>
                <tbody>
                  {niveles.map(s => { const st = statsSerie(s.puntos); return (
                    <tr key={s.escala_id}>
                      <td style={{ fontWeight: 700 }}>K-{s.km}</td>
                      <td>{n2(st.min)}</td><td>{n2(st.max)}</td><td>{n2(st.avg)}</td>
                      <td style={{ color: st.delta! > 0 ? '#ef4444' : st.delta! < 0 ? '#22c55e' : '#64748b' }}>{st.delta == null ? '—' : (st.delta > 0 ? '▲' : st.delta < 0 ? '▼' : '—') + ' ' + n2(Math.abs(st.delta))}</td>
                      <td>{st.n}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bloque 2: volumen por tramo ── */}
          <div className="tnd-block">
            <div className="tnd-h"><span className="tnd-n" style={{ background: '#199e70' }}>2</span> Volumen por tramo <small className="tnd-calc">reconstruido de niveles</small></div>
            <StackedArea series={volTramos} t0={t0} t1={t1} height={170} />
            <MultiLine series={[{ nombre: 'Total canal', puntos: volTotal, color: '#38bdf8' }]} t0={t0} t1={t1} yLabel="Volumen total en canal (Mm³)" height={110} />
            <div className="dsk-table-wrap">
              <table className="dsk-table">
                <thead><tr><th>Tramo</th><th>Vol mín</th><th>Vol máx</th><th>Δ Mm³</th></tr></thead>
                <tbody>
                  {volTramos.map(tr => { const st = statsSerie(tr.puntos); return (
                    <tr key={tr.key}><td style={{ fontSize: '0.62rem' }}>{tr.etiqueta}</td><td>{n3(st.min)}</td><td>{n3(st.max)}</td>
                      <td style={{ color: st.delta! > 0 ? '#38bdf8' : '#f59e0b' }}>{n3(st.delta)}</td></tr>
                  ); })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bloque 3: arriba/abajo por compuerta ── */}
          <div className="tnd-block">
            <div className="tnd-h"><span className="tnd-n" style={{ background: '#c98500' }}>3</span> Niveles arriba / abajo por compuerta</div>
            <div className="dsk-table-wrap">
              <table className="dsk-table">
                <thead><tr><th>Compuerta</th><th>H↑ prom</th><th>H↓ prom</th><th>Dif. prom</th><th>Apert. últ (m)</th><th>Abiertas</th></tr></thead>
                <tbody>
                  {compuertas.map(c => { const su = statsSerie(c.arriba), sd = statsSerie(c.abajo), sdif = statsSerie(c.diferencial); return (
                    <tr key={c.escala_id}>
                      <td style={{ fontWeight: 700 }}>K-{c.km}</td>
                      <td>{n2(su.avg)}</td><td>{n2(sd.avg)}</td>
                      <td style={{ color: '#c98500', fontWeight: 700 }}>{n2(sdif.avg)}</td>
                      <td>{n2(c.aperturaUlt)}</td><td>{c.puertasAbiertas ?? '—'}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            {/* diferencial de la primera compuerta con datos como muestra visual */}
            {compuertas[0] && (
              <MultiLine
                series={[
                  { nombre: 'H↑', puntos: compuertas[0].arriba, color: '#3987e5' },
                  { nombre: 'H↓', puntos: compuertas[0].abajo, color: '#c98500', dashed: true },
                ]}
                t0={t0} t1={t1} yLabel={`Niveles arriba/abajo — K-${compuertas[0].km} (m)`} height={120}
              />
            )}
          </div>

          {/* ── Bloque 4: gasto K-0 → entregas → K-104 ── */}
          <div className="tnd-block">
            <div className="tnd-h"><span className="tnd-n" style={{ background: '#9085e9' }}>4</span> Gasto: K-0+000 → entregas a módulos → K-104</div>
            <MultiLine
              series={[
                { nombre: 'Q entrada K-0', puntos: gasto.entrada, color: '#3987e5' },
                { nombre: 'Σ entregas módulos', puntos: gasto.entregas, color: '#9085e9' },
                { nombre: 'Q salida K-104', puntos: gasto.salida, color: '#199e70' },
                { nombre: 'Pérdidas', puntos: gasto.perdidas, color: '#e66767', dashed: true },
              ]}
              t0={t0} t1={t1} yLabel="Gasto (m³/s)" height={168} zeroLine
            />
            <div className="tnd-legend">
              <span><i style={{ background: '#3987e5' }} />Q entrada (K-0)</span>
              <span><i style={{ background: '#9085e9' }} />Σ entregas módulos</span>
              <span><i style={{ background: '#199e70' }} />Q salida (K-104)</span>
              <span><i style={{ background: '#e66767' }} />Pérdidas</span>
            </div>
            <div className="dsk-table-wrap">
              <table className="dsk-table">
                <thead><tr><th>Serie</th><th>Mín</th><th>Máx</th><th>Prom</th><th>Δ</th></tr></thead>
                <tbody>
                  {([['Q entrada K-0', gasto.entrada], ['Σ entregas', gasto.entregas], ['Q salida K-104', gasto.salida], ['Pérdidas', gasto.perdidas]] as [string, SeriePunto[]][]).map(([nom, ser]) => {
                    const st = statsSerie(ser); return (
                      <tr key={nom}><td style={{ fontSize: '0.62rem' }}>{nom}</td><td>{n2(st.min)}</td><td>{n2(st.max)}</td><td style={{ fontWeight: 700 }}>{n2(st.avg)}</td><td>{n2(st.delta)}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {gasto.entregas.every(p => p.y == null) && (
              <div className="tnd-note tnd-warn">⚠ Sin registros de entregas en el rango seleccionado — la serie de entregas y las pérdidas quedan vacías. Los datos de <code>entregas_modulo</code> pueden no cubrir fechas recientes; prueba un rango anterior (p.ej. mayo–junio).</div>
            )}
            <div className="tnd-note">Extracción por zona = Σ entregas reales a módulos (no diferencial entre escalas). Pérdidas = Q₀ − Σentregas − Q₁₀₄, solo cuando los tres tienen dato el mismo día.</div>
          </div>
        </>
      )}
    </div>
  );
};

// React.memo: el panel vive dentro del PublicMonitor, que re-renderiza con el
// reloj interno (60 s) y cada refresh de datos del mapa. Sus props solo cambian
// cuando cambia el rango/granularidad o llegan series nuevas — con memo, los
// ticks del monitor no re-renderizan las gráficas.
export default React.memo(TendenciasPanel);
