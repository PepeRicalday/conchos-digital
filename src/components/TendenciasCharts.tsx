/**
 * Gráficos de la pestaña TENDENCIAS (Monitor Público).
 *
 * Criterios (guía dataviz):
 *  - Ejes con ticks "redondos" (1/2/2.5/5·10ⁿ) y dominio que nunca baja de 0 en niveles/volumen.
 *  - SVG dibujado al ANCHO REAL del contenedor (ResizeObserver): los textos miden píxeles reales
 *    (10–11 px) en lugar de escalarse con un viewBox fijo de 720 que los dejaba en ~4–5 px.
 *  - 14 escalas no se distinguen con 14 colores: rampa SECUENCIAL por km (un matiz, claro → oscuro)
 *    + foco/contexto (la serie bajo el puntero se resalta, el resto se atenúa) + vista por escala
 *    (small multiples) con eje común.
 *  - Las líneas se cortan en los huecos (no sugieren continuidad donde no hubo dato).
 *  - Tooltip ordenado por valor, con alto adaptable y contenido dentro del gráfico.
 *  - Anotación de eventos (cierre de presa / inicio de vaciado) como línea vertical.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SerieEscala, SerieTramo, SeriePunto } from '../utils/tendencias';

// Paleta categórica validada (blue, aqua, yellow, green, violet, red, magenta, orange…) — identidad de TRAMO.
export const PAL = ['#3987e5', '#199e70', '#c98500', '#2fb35a', '#9085e9', '#e66767', '#d55181', '#d95926',
                    '#38bdf8', '#22c55e', '#eab308', '#f472b6', '#a78bfa', '#fb7185'];

const C = { bg: '#0a1220', grid: '#16233a', eje: '#94a3b8', txt: '#cbd5e1', tip: '#0f1c30', acento: '#fbbf24', cross: '#7dd3fc' };
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Táctil: pan-y deja que el gesto vertical desplace el panel; el arrastre horizontal mueve el crosshair.
const CHART_TOUCH_STYLE = {
  display: 'block', touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
} as React.CSSProperties;

export interface EventoMarca { t: number; label: string }

// ── Utilidades ──────────────────────────────────────────────────────────────

/** Ticks "bonitos" que cubren [min, max]. */
export function niceTicks(min: number, max: number, n = 4): { ticks: number[]; lo: number; hi: number; step: number } {
  if (!isFinite(min) || !isFinite(max)) return { ticks: [0, 1], lo: 0, hi: 1, step: 1 };
  if (max - min < 1e-9) max = min + 1;
  const raw = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return { ticks, lo, hi, step };
}
export function fmtTick(v: number, step: number): string {
  const dec = step >= 1 ? (Number.isInteger(step) ? 0 : 1) : Math.min(3, Math.max(1, Math.ceil(-Math.log10(step) - 1e-9)) + (Number.isInteger(step * 10) ? 0 : 1));
  return v.toFixed(dec);
}

/** Ancho real (px) del contenedor, para dibujar el SVG a escala 1:1. */
export function useAnchoReal(inicial = 720): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(inicial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const a = Math.round(el.getBoundingClientRect().width);
      if (a > 0) setW(prev => (Math.abs(prev - a) > 1 ? a : prev));
    };
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Rampa SECUENCIAL (un solo matiz azul, claro → oscuro) por posición a lo largo del canal. */
const hexRgb = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const RAMP_A = hexRgb('#a5d8ff'), RAMP_B = hexRgb('#2c6fd6');
export const colorKm = (i: number, n: number): string => {
  const f = n <= 1 ? 0.5 : i / (n - 1);
  const c = RAMP_A.map((a, k) => Math.round(a + (RAMP_B[k] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

/** Parte una serie en tramos continuos: un hueco mayor a 2.6× el paso mediano corta la línea. */
export function segmentos<T extends { t: number }>(pts: T[]): T[][] {
  if (pts.length < 2) return pts.length ? [pts] : [];
  const pasos = pts.slice(1).map((p, i) => p.t - pts[i].t).sort((a, b) => a - b);
  const lim = Math.max((pasos[Math.floor(pasos.length / 2)] || 1) * 2.6, 1);
  const out: T[][] = [];
  let cur: T[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t > lim) { out.push(cur); cur = [pts[i]]; } else cur.push(pts[i]);
  }
  out.push(cur);
  return out;
}

const fmtFecha = (t: number) => new Date(t).toLocaleString('es-MX', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua',
});
const fmtEjeX = (t: number, esUnDia: boolean) => esUnDia
  ? new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chihuahua' })
  : new Date(t).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' });

/** Eje X con hasta 6 marcas (menos si el ancho es chico) y línea de eventos. */
const EjeX: React.FC<{ W: number; PL: number; pw: number; t0: number; t1: number; y: number; esUnDia: boolean }> = ({ W, PL, pw, t0, t1, y, esUnDia }) => {
  const n = W < 420 ? 3 : 5;
  return (
    <>
      {Array.from({ length: n + 1 }, (_, i) => {
        const t = t0 + (i / n) * (t1 - t0);
        const x = PL + (i / n) * pw;
        return (
          <text key={i} x={x} y={y} fill={C.eje} fontSize="10.5" fontFamily={MONO}
            textAnchor={i === 0 ? 'start' : i === n ? 'end' : 'middle'}>{fmtEjeX(t, esUnDia)}</text>
        );
      })}
    </>
  );
};

const Eventos: React.FC<{ eventos?: EventoMarca[]; t0: number; t1: number; xS: (t: number) => number; PT: number; ph: number; W: number }> = ({ eventos, t0, t1, xS, PT, ph, W }) => (
  <>
    {(eventos ?? []).filter(e => e.t >= t0 && e.t <= t1).map((e, i) => {
      const x = xS(e.t);
      const ancho = e.label.length * 6.4 + 10;
      const bx = x + 4 + ancho > W - 6 ? x - 4 - ancho : x + 4;
      return (
        <g key={i} pointerEvents="none">
          <line x1={x} y1={PT} x2={x} y2={PT + ph} stroke={C.eje} strokeWidth="1" strokeDasharray="4,3" opacity="0.8" />
          <rect x={bx} y={PT + 2} width={ancho} height={16} rx="3" fill={C.tip} opacity="0.92" />
          <text x={bx + 5} y={PT + 13.5} fill={C.txt} fontSize="10.5" fontFamily={MONO}>{e.label}</text>
        </g>
      );
    })}
  </>
);

// ── Multi-línea con foco/contexto, hover ordenado y huecos reales ───────────
export const MultiLine: React.FC<{
  series: { nombre: string; puntos: SeriePunto[]; color: string; dashed?: boolean }[];
  t0: number; t1: number;
  yLabel?: string; height?: number;
  yMinHint?: number; yMaxHint?: number;
  band?: { y: number; label: string } | null;
  bands?: { y: number; label: string; color?: string }[];
  zeroLine?: boolean;
  eventos?: EventoMarca[];
  /** Niveles/volumen: el eje arranca en 0 (un nivel negativo no existe). */
  nonNegative?: boolean;
  /** Foco/contexto: al apuntar una serie, las demás se atenúan. */
  dimOthers?: boolean;
  decimales?: number;
}> = ({ series, t0, t1, yLabel, height = 190, yMinHint, yMaxHint, band, bands, zeroLine, eventos, nonNegative, dimOthers, decimales = 2 }) => {
  const [ref, wMed] = useAnchoReal();
  const W = Math.max(300, wMed), PL = 44, PR = 16, PT = 22, PB = 28;
  const ph = height - PT - PB, pw = W - PL - PR;
  const [hover, setHover] = useState<{ t: number; y: number } | null>(null);

  const allTs = useMemo(() => {
    const s = new Set<number>();
    for (const se of series) for (const p of se.puntos) if (p.y != null) s.add(p.t);
    return [...s].sort((a, b) => a - b);
  }, [series]);
  const allY = series.flatMap(s => s.puntos.map(p => p.y).filter((v): v is number => v != null));
  if (!allY.length) return <div className="tnd-empty">Sin datos en el rango.</div>;

  let dMin = Math.min(...allY, ...(yMinHint != null ? [yMinHint] : []));
  let dMax = Math.max(...allY, ...(yMaxHint != null ? [yMaxHint] : []));
  if (band) dMax = Math.max(dMax, band.y);
  if (bands?.length) dMax = Math.max(dMax, ...bands.map(b => b.y));
  if (zeroLine) dMin = Math.min(dMin, 0);
  if (nonNegative) dMin = Math.min(0, dMin);
  const { ticks, lo, hi, step } = niceTicks(dMin, dMax * 1.02, 4);
  const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  const yS = (y: number) => PT + ph - ((y - lo) / Math.max(1e-6, hi - lo)) * ph;
  const esUnDia = (t1 - t0) <= 26 * 3600_000;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!allTs.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = (e.clientX - rect.left) * (W / rect.width);
    const t = t0 + Math.max(0, Math.min(1, (xPx - PL) / pw)) * (t1 - t0);
    let best = allTs[0];
    for (const ts of allTs) if (Math.abs(ts - t) < Math.abs(best - t)) best = ts;
    setHover({ t: best, y: (e.clientY - rect.top) * (height / rect.height) });
  };

  const tol = allTs.length > 1 ? Math.max(30 * 60_000, (allTs[allTs.length - 1] - allTs[0]) / allTs.length / 2) : 12 * 3600_000;
  const hoverVals = hover == null ? [] : series.map((s, si) => {
    let bp: SeriePunto | null = null;
    for (const p of s.puntos) {
      if (p.y == null) continue;
      if (bp == null || Math.abs(p.t - hover.t) < Math.abs(bp.t - hover.t)) bp = p;
    }
    return bp && Math.abs(bp.t - hover.t) <= tol ? { si, nombre: s.nombre, color: s.color, y: bp.y as number, t: bp.t } : null;
  }).filter((v): v is { si: number; nombre: string; color: string; y: number; t: number } => v != null);

  // Foco = serie cuyo valor queda más cerca del puntero en vertical
  const focoSi = dimOthers && hover && hoverVals.length > 1
    ? hoverVals.reduce((a, b) => (Math.abs(yS(a.y) - hover.y) <= Math.abs(yS(b.y) - hover.y) ? a : b)).si
    : null;

  // Tooltip: las 8 series más cercanas al puntero, ordenadas por valor (igual que se ven las líneas)
  const MAX_FILAS = 8;
  const cercanas = hover == null ? [] : [...hoverVals].sort((a, b) => Math.abs(yS(a.y) - hover.y) - Math.abs(yS(b.y) - hover.y)).slice(0, MAX_FILAS)
    .sort((a, b) => b.y - a.y);
  const extra = hoverVals.length - cercanas.length;
  const filas = cercanas.length + (extra > 0 ? 1 : 0);
  const maxChars = Math.max(10, ...cercanas.map(v => v.nombre.length + v.y.toFixed(decimales).length + 1));
  const tipW = Math.min(W - 12, Math.max(150, maxChars * 6.9 + 34)), tipH = 24 + filas * 16;
  const hx = hover != null ? xS(hover.t) : 0;
  const tipX = hx + tipW + 12 > W - PR ? Math.max(4, hx - tipW - 10) : hx + 10;
  const tipY = Math.max(2, Math.min(PT + 2, height - tipH - 2));

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} style={{ ...CHART_TOUCH_STYLE, maxWidth: '100%' }}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
        <rect width={W} height={height} fill={C.bg} rx="5" />
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PL} y1={yS(v)} x2={PL + pw} y2={yS(v)} stroke={C.grid} strokeWidth="0.8" />
            <text x={PL - 6} y={yS(v) + 3.5} fill={C.eje} fontSize="10.5" textAnchor="end" fontFamily={MONO}>{fmtTick(v, step)}</text>
          </g>
        ))}
        {zeroLine && lo < 0 && hi > 0 && (
          <line x1={PL} y1={yS(0)} x2={PL + pw} y2={yS(0)} stroke="#475569" strokeWidth="1" strokeDasharray="3,3" />
        )}
        {band && (
          <>
            <line x1={PL} y1={yS(band.y)} x2={PL + pw} y2={yS(band.y)} stroke="#ef4444" strokeWidth="1" strokeDasharray="5,4" opacity="0.7" />
            <text x={PL + pw - 3} y={yS(band.y) - 4} fill="#f87171" fontSize="10" textAnchor="end" fontFamily={MONO}>{band.label}</text>
          </>
        )}
        {bands?.map((b, bi) => (
          <g key={`band${bi}`}>
            <line x1={PL} y1={yS(b.y)} x2={PL + pw} y2={yS(b.y)} stroke={b.color ?? '#ef4444'} strokeWidth="1" strokeDasharray="5,4" opacity="0.7" />
            <text x={PL + pw - 3} y={yS(b.y) - 4} fill={b.color ?? '#f87171'} fontSize="10" textAnchor="end" fontFamily={MONO}>{b.label}</text>
          </g>
        ))}
        <Eventos eventos={eventos} t0={t0} t1={t1} xS={xS} PT={PT} ph={ph} W={W} />

        {/* Series: primero el contexto, el foco al final para que quede encima */}
        {[...series.keys()].sort((a, b) => (a === focoSi ? 1 : 0) - (b === focoSi ? 1 : 0)).map(si => {
          const s = series[si];
          const pts = s.puntos.filter((p): p is SeriePunto & { y: number } => p.y != null);
          if (!pts.length) return null;
          const esFoco = focoSi === si;
          const atenuada = focoSi != null && !esFoco;
          const color = esFoco ? C.acento : s.color;
          const grosor = esFoco ? 2.6 : (atenuada ? 1.2 : 1.7);
          const op = atenuada ? 0.22 : 0.95;
          const muestraPuntos = pts.length <= 40;
          return (
            <g key={si} opacity={op}>
              {segmentos(pts).map((seg, k) => seg.length > 1 && (
                <path key={k} d={seg.map((p, i) => `${i ? 'L' : 'M'}${xS(p.t).toFixed(1)},${yS(p.y).toFixed(1)}`).join(' ')}
                  fill="none" stroke={color} strokeWidth={grosor} strokeDasharray={s.dashed ? '5,3' : undefined} strokeLinejoin="round" />
              ))}
              {(muestraPuntos ? pts : [pts[pts.length - 1]]).map((p, i) => (
                <circle key={i} cx={xS(p.t).toFixed(1)} cy={yS(p.y).toFixed(1)} r={esFoco ? 3.4 : 2.4} fill={color} />
              ))}
            </g>
          );
        })}
        {yLabel && <text x={PL} y={PT - 8} fill={C.eje} fontSize="10.5" fontFamily={MONO}>{yLabel}</text>}
        <EjeX W={W} PL={PL} pw={pw} t0={t0} t1={t1} y={height - 8} esUnDia={esUnDia} />

        {hover != null && hoverVals.length > 0 && (
          <g pointerEvents="none">
            <line x1={hx} y1={PT} x2={hx} y2={PT + ph} stroke={C.cross} strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
            {hoverVals.map((v, i) => (
              <circle key={i} cx={xS(v.t)} cy={yS(v.y)} r={v.si === focoSi ? 4.2 : 3.4} fill={v.si === focoSi ? C.acento : v.color} stroke={C.bg} strokeWidth="1.4" />
            ))}
            <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="5" fill={C.tip} stroke="rgba(125,211,252,0.4)" strokeWidth="0.9" opacity="0.98" />
            <text x={tipX + 8} y={tipY + 15} fill={C.cross} fontSize="11" fontFamily={MONO} fontWeight="bold">{fmtFecha(hover.t)}</text>
            {cercanas.map((v, i) => (
              <g key={v.si}>
                <circle cx={tipX + 12} cy={tipY + 28 + i * 16} r="3.2" fill={v.color} />
                <text x={tipX + 20} y={tipY + 32 + i * 16} fill={v.si === focoSi ? C.acento : C.txt} fontSize="11" fontFamily={MONO}>
                  {v.nombre} <tspan fontWeight="bold" fill="#f1f5f9">{v.y.toFixed(decimales)}</tspan>
                </text>
              </g>
            ))}
            {extra > 0 && <text x={tipX + 8} y={tipY + 32 + cercanas.length * 16} fill={C.eje} fontSize="10.5" fontFamily={MONO}>+{extra} más</text>}
          </g>
        )}
      </svg>
    </div>
  );
};

// ── Vista por escala (small multiples) con eje Y común ──────────────────────
export const MiniNivel: React.FC<{
  serie: SerieEscala; t0: number; t1: number; yTop: number; esRef: boolean; onSel: () => void;
}> = ({ serie, t0, t1, yTop, esRef, onSel }) => {
  const W = 168, H = 74, PL = 3, PR = 5, PT = 5, PB = 5;
  const pw = W - PL - PR, ph = H - PT - PB;
  const pts = serie.puntos.filter((p): p is SeriePunto & { y: number } => p.y != null);
  const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  const yS = (y: number) => PT + ph - (Math.max(0, Math.min(yTop, y)) / yTop) * ph;
  const ult = pts.length ? pts[pts.length - 1] : null;
  const primero = pts.length ? pts[0] : null;
  const delta = ult && primero ? ult.y - primero.y : null;
  const sobre = ult != null && serie.nivelMax != null && ult.y > serie.nivelMax;
  const color = sobre ? '#ef4444' : '#5aa9ff';
  return (
    <button type="button" className="tnd-mini" onClick={onSel}
      title={`${serie.nombre}${esRef ? ' (escala de referencia)' : ''} — clic para compararla en detalle`}>
      <div className="tnd-mini-h">
        <span>{serie.nombre}{esRef && <small> ref.</small>}</span>
        <span className="tnd-mini-v" style={{ color: sobre ? '#f87171' : '#7dd3fc' }}>{ult ? `${ult.y.toFixed(2)} m` : 'S/D'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`${serie.nombre}: ${ult ? ult.y.toFixed(2) + ' m' : 'sin dato'}`}>
        <rect width={W} height={H} fill="none" />
        {serie.nivelMax != null && serie.nivelMax <= yTop && (
          <line x1={PL} x2={W - PR} y1={yS(serie.nivelMax)} y2={yS(serie.nivelMax)} stroke="#ef4444" strokeWidth="0.9" strokeDasharray="4,3" opacity="0.65" />
        )}
        <line x1={PL} x2={W - PR} y1={yS(0)} y2={yS(0)} stroke={C.grid} strokeWidth="1" />
        {segmentos(pts).map((seg, k) => seg.length > 1 && (
          <g key={k}>
            <path d={`M${xS(seg[0].t).toFixed(1)},${yS(0).toFixed(1)} ` + seg.map(p => `L${xS(p.t).toFixed(1)},${yS(p.y).toFixed(1)}`).join(' ') + ` L${xS(seg[seg.length - 1].t).toFixed(1)},${yS(0).toFixed(1)} Z`}
              fill={color} opacity="0.16" />
            <path d={seg.map((p, i) => `${i ? 'L' : 'M'}${xS(p.t).toFixed(1)},${yS(p.y).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
          </g>
        ))}
        {pts.length <= 12 && pts.map((p, i) => <circle key={i} cx={xS(p.t)} cy={yS(p.y)} r="1.9" fill={color} />)}
        {ult && <circle cx={xS(ult.t)} cy={yS(ult.y)} r="3" fill={color} stroke={C.bg} strokeWidth="1.2" />}
      </svg>
      <div className="tnd-mini-f">
        <span>{delta == null ? '—' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} ${Math.abs(delta).toFixed(2)} m`}</span>
        <span>{pts.length} lect.</span>
      </div>
    </button>
  );
};

// ── Área apilada del volumen por tramo (+ línea de total) ───────────────────
export const StackedArea: React.FC<{
  series: SerieTramo[]; t0: number; t1: number; height?: number;
  selKey?: string | null; onSelBand?: (key: string) => void;
  eventos?: EventoMarca[];
}> = ({ series, t0, t1, height = 210, selKey = null, onSelBand, eventos }) => {
  const [ref, wMed] = useAnchoReal();
  const W = Math.max(300, wMed), PL = 46, PR = 16, PT = 22, PB = 28;
  const ph = height - PT - PB, pw = W - PL - PR;
  const [hover, setHover] = useState<{ i: number; band: number | null } | null>(null);
  const base = series.find(s => s.puntos.length)?.puntos ?? [];
  if (!base.length) return <div className="tnd-empty">Sin datos en el rango.</div>;
  const idxs = base.map((_, i) => i);
  const totals = idxs.map(i => series.reduce((s, se) => s + (se.puntos[i]?.y ?? 0), 0));
  const estimado = idxs.map(i => series.some(se => se.puntos[i]?.est));
  const { ticks, hi, step } = niceTicks(0, Math.max(...totals, 0.1) * 1.03, 4);
  const xS = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  const yS = (y: number) => PT + ph - (y / hi) * ph;
  const esUnDia = (t1 - t0) <= 26 * 3600_000;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPx = (e.clientX - rect.left) * (W / rect.width);
    const yPx = (e.clientY - rect.top) * (height / rect.height);
    let bi = 0;
    for (let i = 0; i < base.length; i++) if (Math.abs(xS(base[i].t) - xPx) < Math.abs(xS(base[bi].t) - xPx)) bi = i;
    const yVal = Math.max(0, (PT + ph - yPx) / ph) * hi;
    let accV = 0, band: number | null = null;
    for (let si = 0; si < series.length; si++) {
      const v = series[si].puntos[bi]?.y ?? 0;
      if (yVal >= accV && yVal < accV + v) { band = si; break; }
      accV += v;
    }
    setHover({ i: bi, band });
  };

  const acc = idxs.map(() => 0);
  const hovI = hover?.i ?? null;
  const tipW = Math.min(W - 12, 250), tipH = hover?.band != null ? 58 : 40;
  const hx = hovI != null ? xS(base[hovI].t) : 0;
  const tipX = hovI != null && hx + tipW + 12 > W - PR ? Math.max(4, hx - tipW - 10) : hx + 10;
  // Total: línea sobre el tope del apilado (reemplaza la gráfica de total separada)
  const topLinea = idxs.map(i => `${i ? 'L' : 'M'}${xS(base[i].t).toFixed(1)},${yS(totals[i]).toFixed(1)}`).join(' ');
  const ult = idxs.length - 1;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} style={{ ...CHART_TOUCH_STYLE, maxWidth: '100%' }}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
        <rect width={W} height={height} fill={C.bg} rx="5" />
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={PL} y1={yS(v)} x2={PL + pw} y2={yS(v)} stroke={C.grid} strokeWidth="0.8" />
            <text x={PL - 6} y={yS(v) + 3.5} fill={C.eje} fontSize="10.5" textAnchor="end" fontFamily={MONO}>{fmtTick(v, step)}</text>
          </g>
        ))}
        {series.map((se, si) => {
          const top = idxs.map(i => acc[i] + (se.puntos[i]?.y ?? 0));
          const poly = [
            ...idxs.map(i => `${xS(se.puntos[i]?.t ?? base[i].t).toFixed(1)},${yS(top[i]).toFixed(1)}`),
            ...idxs.slice().reverse().map(i => `${xS(se.puntos[i]?.t ?? base[i].t).toFixed(1)},${yS(acc[i]).toFixed(1)}`),
          ].join(' ');
          idxs.forEach(i => { acc[i] = top[i]; });
          const sel = selKey != null && se.key === selKey;
          const dim = (selKey != null && !sel) || (selKey == null && hover?.band != null && hover.band !== si);
          const activo = sel || (selKey == null && hover?.band === si);
          return <polygon key={si} points={poly} fill={PAL[si % PAL.length]}
            opacity={dim ? 0.2 : (activo ? 0.88 : 0.62)}
            stroke={C.bg} strokeWidth={activo ? 1.6 : 0.8}
            style={{ cursor: onSelBand ? 'pointer' : undefined }}
            onClick={onSelBand ? (e) => { e.stopPropagation(); onSelBand(se.key); } : undefined} />;
        })}
        <path d={topLinea} fill="none" stroke="#e2e8f0" strokeWidth="1.6" strokeLinejoin="round" pointerEvents="none" />
        <circle cx={xS(base[ult].t)} cy={yS(totals[ult])} r="3.4" fill="#e2e8f0" stroke={C.bg} strokeWidth="1.2" pointerEvents="none" />
        <text x={Math.min(xS(base[ult].t) + 6, W - PR - 2)} y={Math.max(PT + 10, yS(totals[ult]) - 8)}
          textAnchor={xS(base[ult].t) + 6 > W - PR - 70 ? 'end' : 'start'} fill="#e2e8f0" fontSize="11" fontFamily={MONO} fontWeight="bold" pointerEvents="none">
          Total {totals[ult].toFixed(2)} Mm³
        </text>
        <text x={PL} y={PT - 8} fill={C.eje} fontSize="10.5" fontFamily={MONO}>Volumen por tramo (Mm³) — apilado · línea = total del canal</text>
        <Eventos eventos={eventos} t0={t0} t1={t1} xS={xS} PT={PT} ph={ph} W={W} />
        <EjeX W={W} PL={PL} pw={pw} t0={t0} t1={t1} y={height - 8} esUnDia={esUnDia} />

        {idxs.filter(i => estimado[i]).map(i => {
          const x = xS(base[i].t), y = yS(totals[i]);
          return <path key={`est${i}`} d={`M ${x.toFixed(1)} ${(y - 6).toFixed(1)} l 3.5 3.5 l -3.5 3.5 l -3.5 -3.5 z`}
            fill="none" stroke="#f59e0b" strokeWidth="1.1" opacity="0.95">
            <title>Total parcial o estimado: uno o más tramos sin aforo ese día</title>
          </path>;
        })}

        {hovI != null && (
          <g pointerEvents="none">
            <line x1={hx} y1={PT} x2={hx} y2={PT + ph} stroke={C.cross} strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
            <rect x={tipX} y={PT + 2} width={tipW} height={tipH} rx="5" fill={C.tip} stroke="rgba(125,211,252,0.4)" strokeWidth="0.9" opacity="0.98" />
            <text x={tipX + 8} y={PT + 18} fill={C.cross} fontSize="11" fontFamily={MONO} fontWeight="bold">{fmtFecha(base[hovI].t)}</text>
            <text x={tipX + 8} y={PT + 34} fill={C.txt} fontSize="11" fontFamily={MONO}>
              Total <tspan fontWeight="bold" fill="#f1f5f9">{totals[hovI].toFixed(3)} Mm³</tspan>
              {estimado[hovI] && <tspan fill="#f59e0b"> ◆parcial/est.</tspan>}
            </text>
            {hover?.band != null && (
              <text x={tipX + 8} y={PT + 51} fill={C.txt} fontSize="11" fontFamily={MONO}>
                <tspan fill={PAL[hover.band % PAL.length]}>■</tspan> {series[hover.band].etiqueta}: <tspan fontWeight="bold" fill="#f1f5f9">{(series[hover.band].puntos[hovI]?.y ?? 0).toFixed(3)}</tspan>
              </text>
            )}
          </g>
        )}
      </svg>
    </div>
  );
};
