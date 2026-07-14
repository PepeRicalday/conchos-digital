import React, { useMemo, useState, useEffect, useCallback } from 'react';
import type {
  SerieEscala, SerieTramo, SerieCompuerta, SerieGasto, SeriePunto,
} from '../utils/tendencias';
import { statsSerie } from '../utils/tendencias';

// Paleta categórica validada (dataviz): blue, aqua, yellow, green, violet, red, magenta, orange
const PAL = ['#3987e5', '#199e70', '#c98500', '#2fb35a', '#9085e9', '#e66767', '#d55181', '#d95926',
             '#38bdf8', '#22c55e', '#eab308', '#f472b6', '#a78bfa', '#fb7185'];

const n2 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(2);
const n3 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(3);

// Escalas de referencia (nivel sin control de Q): sin compuerta propia. Debe
// coincidir con ESC_SIN_CONTROL de PublicMonitor.tsx. Se clasifica por nombre.
const ESC_SIN_CONTROL = new Set(['K-64', 'K-94+200']);
const esControlDeQ = (s: SerieEscala) => !ESC_SIN_CONTROL.has(s.nombre);
const LS_VISIBLES = 'tnd:puntos-visibles';

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
  // Líneas de referencia horizontales (p.ej. nivel máximo operativo por escala).
  // color por defecto rojo; se dibujan discontinuas y expanden el eje Y.
  bands?: { y: number; label: string; color?: string }[];
  zeroLine?: boolean;
}> = ({ series, t0, t1, yLabel, height = 150, yMinHint, yMaxHint, band, bands, zeroLine }) => {
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
  if (bands?.length) yMax = Math.max(yMax, ...bands.map(b => b.y));
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
      {bands?.map((b, bi) => (
        <g key={`band${bi}`}>
          <line x1={PL} y1={yS(b.y)} x2={PL + pw} y2={yS(b.y)} stroke={b.color ?? '#ef4444'} strokeWidth="1" strokeDasharray="5,4" opacity="0.55" />
          <text x={PL + 2} y={yS(b.y) - 3} fill={b.color ?? '#ef4444'} fontSize="7" fontFamily="monospace" opacity="0.85">{b.label}</text>
        </g>
      ))}
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

// ── Sección transversal trapezoidal por tramo (estado de llenado) ───────────
// Dibuja la sección real del canal (plantilla b, taludes z) con la lámina de
// agua al tirante actual. El COLOR de IDENTIDAD es único por tramo (paleta); el
// ESTADO (respecto al tirante de diseño) se comunica con borde + ícono, no con
// el relleno, para que "mismo tramo = mismo color" en sección y apilado.
//
// Umbrales respecto al tirante de DISEÑO (que es el nivel normal de operación,
// no un límite de peligro): operar al 100% del diseño es óptimo. El riesgo real
// es SUPERARLO (invade bordo libre) o quedar muy por debajo (desabasto).
const estadoLlenado = (pct: number | null): { color: string; label: string; icon: string } => {
  if (pct == null) return { color: '#64748b', label: 's/diseño', icon: '' };
  if (pct > 105) return { color: '#ef4444', label: 'alto', icon: '⚠' };   // invade bordo libre
  if (pct >= 85) return { color: '#22c55e', label: 'óptimo', icon: '' };  // cerca del diseño
  if (pct >= 60) return { color: '#38bdf8', label: 'normal', icon: '' };  // operativo, sin llenar
  return { color: '#f59e0b', label: 'bajo', icon: '▽' };                  // posible desabasto
};

// Escala común de la tira: metros máximos (ancho de espejo a diseño y tirante)
// entre todos los tramos, para dibujar cada sección PROPORCIONAL a sus medidas
// reales y poder comparar dimensiones entre tramos de un vistazo.
interface EscalaSeccion { anchoMaxM: number; tiranteMaxM: number; }

// Espejo de agua (ancho superior) a un tirante h: T = b + 2·z·h.
const espejoM = (b: number, z: number, h: number) => b + 2 * z * Math.max(0, h);

const SeccionCanal: React.FC<{
  tramo: SerieTramo; escala: EscalaSeccion; colorTramo: string;
  seleccionado: boolean; atenuado: boolean; onSelect: () => void;
}> = ({ tramo, escala, colorTramo, seleccionado, atenuado, onSelect }) => {
  const { estado, etiqueta } = tramo;
  const { tiranteActual, pctDiseno, plantilla: b, talud: z, tiranteDiseno, esTrapezoidal } = estado;
  const { color: colEstado, label, icon } = estadoLlenado(pctDiseno);

  // ── Lienzo con margen; el mapeo metros→px es COMÚN a toda la tira ──
  const W = 100, H = 96, PBtxt = 26, PTtop = 8;
  const drawW = W - 8, drawH = H - PBtxt - PTtop;      // zona útil
  const cx = W / 2, yBot = PTtop + drawH;
  // px por metro (horizontal y vertical), compartidos vía la escala máxima global
  const pxPerM_X = drawW / Math.max(1e-6, escala.anchoMaxM);
  const pxPerM_Y = drawH / Math.max(1e-6, escala.tiranteMaxM);

  // Referencia de altura del canal dibujado = tirante de diseño (o actual).
  const hCanal = Math.max(tiranteDiseno ?? tiranteActual ?? 1, 0.1);
  // Anchos reales (m) → medios anchos en px
  const halfBot = (b * pxPerM_X) / 2;                             // plantilla (fondo)
  const halfTopCanal = (espejoM(b, z, hCanal) * pxPerM_X) / 2;    // espejo a la altura del canal
  const yTopCanal = yBot - hCanal * pxPerM_Y;                     // borde superior del canal (a escala)
  const xBotL = cx - halfBot, xBotR = cx + halfBot;
  const xTopL = cx - halfTopCanal, xTopR = cx + halfTopCanal;

  // Lámina de agua al tirante actual (a la MISMA escala vertical)
  const hAgua = tiranteActual != null ? Math.min(tiranteActual, escala.tiranteMaxM) : 0;
  const yW = yBot - hAgua * pxPerM_Y;
  const halfAgua = (espejoM(b, z, hAgua) * pxPerM_X) / 2;
  const xWL = cx - halfAgua, xWR = cx + halfAgua;

  const espejoDiseno = esTrapezoidal ? espejoM(b, z, hCanal) : b;
  const tip = `${etiqueta}\n`
    + `tirante ${tiranteActual != null ? tiranteActual.toFixed(2) + ' m' : 's/d'}`
    + `${pctDiseno != null ? ` · ${pctDiseno}% diseño (${label})` : ''}\n`
    + (esTrapezoidal
        ? `plantilla b=${b.toFixed(1)} m · talud z=${z.toFixed(2)} · espejo≈${espejoDiseno.toFixed(1)} m`
        : 'rectangular (sin geometría de perfil)');

  const cls = `tnd-sec${seleccionado ? ' sel' : ''}${atenuado ? ' dim' : ''}`;
  return (
    <button type="button" className={cls} title={tip} onClick={onSelect}
      aria-pressed={seleccionado} style={{ '--tramo-col': colorTramo } as React.CSSProperties}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {/* sección de concreto a escala real; el borde lleva el COLOR DE IDENTIDAD del tramo */}
        <polygon points={`${xTopL.toFixed(1)},${yTopCanal.toFixed(1)} ${xBotL.toFixed(1)},${yBot} ${xBotR.toFixed(1)},${yBot} ${xTopR.toFixed(1)},${yTopCanal.toFixed(1)}`}
          fill="#101a26" stroke={colorTramo} strokeWidth={seleccionado ? 2 : 1.2} />
        {/* agua — coloreada con la IDENTIDAD del tramo (mismo color que su banda del apilado) */}
        {hAgua > 0 && (
          <polygon points={`${xWL.toFixed(1)},${yW.toFixed(1)} ${xBotL.toFixed(1)},${yBot} ${xBotR.toFixed(1)},${yBot} ${xWR.toFixed(1)},${yW.toFixed(1)}`}
            fill={colorTramo} opacity={seleccionado ? 0.9 : 0.68} />
        )}
        {/* espejo de agua */}
        {hAgua > 0 && <line x1={xWL.toFixed(1)} y1={yW.toFixed(1)} x2={xWR.toFixed(1)} y2={yW.toFixed(1)} stroke="#e2e8f0" strokeWidth="0.8" strokeDasharray="3,2" opacity="0.75" />}
        {/* línea de tirante de diseño = borde superior; ROJO si el estado es alto (invade bordo) */}
        {tiranteDiseno != null && <line x1={xTopL.toFixed(1)} y1={yTopCanal.toFixed(1)} x2={xTopR.toFixed(1)} y2={yTopCanal.toFixed(1)} stroke={pctDiseno != null && pctDiseno > 105 ? '#ef4444' : '#d9a53a'} strokeWidth="1" strokeDasharray="2,2" opacity="0.8" />}
        {/* etiquetas */}
        <text x={cx} y={H - 14} fill="#cbd5e1" fontSize="8" fontFamily="monospace" textAnchor="middle">{etiqueta.slice(0, 13)}</text>
        <text x={cx} y={H - 4} fill={colEstado} fontSize="7.5" fontFamily="monospace" textAnchor="middle">
          {pctDiseno != null ? `${Math.round(pctDiseno)}% ${label}${icon ? ' ' + icon : ''}` : (tiranteActual != null ? `${tiranteActual.toFixed(2)} m` : 's/d')}
        </text>
      </svg>
    </button>
  );
};

// ── Área apilada para volumen por tramo — hover identifica la banda ─────────
// selKey: tramo seleccionado desde la tira de secciones → su banda se resalta y
// el resto se atenúa. onSelBand: clic en una banda alterna la selección.
const StackedArea: React.FC<{
  series: SerieTramo[]; t0: number; t1: number; height?: number;
  selKey?: string | null; onSelBand?: (key: string) => void;
}> = ({ series, t0, t1, height = 160, selKey = null, onSelBand }) => {
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
        // Selección (desde la tira de secciones) manda sobre el hover:
        // la banda seleccionada se resalta y el resto se atenúa; sin selección,
        // el hover resalta como antes.
        const sel = selKey != null && se.key === selKey;
        const dimBySel = selKey != null && !sel;
        const dimByHover = selKey == null && hover?.band != null && hover.band !== si;
        const dim = dimBySel || dimByHover;
        const activo = sel || (selKey == null && hover?.band === si);
        return <polygon key={si} points={poly} fill={PAL[si % PAL.length]}
          opacity={dim ? 0.2 : (activo ? 0.85 : 0.62)}
          stroke={PAL[si % PAL.length]} strokeWidth={activo ? 1.6 : 0.5}
          style={{ cursor: onSelBand ? 'pointer' : undefined }}
          onClick={onSelBand ? (e) => { e.stopPropagation(); onSelBand(se.key); } : undefined} />;
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

// ── Modal de detalle de tramo ───────────────────────────────────────────────
// Ficha técnica completa al hacer clic en una sección: identificación,
// geometría del canal (plantilla, talud, espejo, área), volumen (actual/mín/máx/Δ),
// estado hidráulico (tirante vs diseño, margen a bordo) y mini-tendencia.
const ModalTramo: React.FC<{ tramo: SerieTramo; color: string; t0: number; t1: number; onClose: () => void }>
= ({ tramo, color, t0, t1, onClose }) => {
  const { estado, etiqueta, km_up, km_down } = tramo;
  const { tiranteActual, pctDiseno, plantilla: b, talud: z, tiranteDiseno, esTrapezoidal,
          longitudKm, nivelUpActual, nivelDownActual } = estado;
  const { color: colEstado, label, icon } = estadoLlenado(pctDiseno);
  const st = statsSerie(tramo.puntos);
  const volActual = [...tramo.puntos].reverse().find(p => p.y != null)?.y ?? null;

  // Cierra con Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Geometría derivada al tirante actual (o de diseño si no hay lectura)
  const hRef = tiranteActual ?? tiranteDiseno ?? 0;
  const espejo = esTrapezoidal ? espejoM(b, z, hRef) : b;
  const area = esTrapezoidal ? (b + z * hRef) * hRef : b * hRef;   // m²
  const margenBordo = tiranteDiseno != null && tiranteActual != null ? +(tiranteDiseno - tiranteActual).toFixed(2) : null;

  const Fila: React.FC<{ k: string; v: React.ReactNode; c?: string }> = ({ k, v, c }) => (
    <div className="tnd-modal-row"><span className="tnd-modal-k">{k}</span><span className="tnd-modal-v" style={c ? { color: c } : undefined}>{v}</span></div>
  );

  return (
    <div className="tnd-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Detalle del tramo ${etiqueta}`}>
      <div className="tnd-modal" onClick={e => e.stopPropagation()} style={{ '--tramo-col': color } as React.CSSProperties}>
        <header className="tnd-modal-head">
          <div>
            <span className="tnd-modal-badge" style={{ background: color }} />
            <b>{etiqueta}</b>
            <span className="tnd-modal-km">K {km_up.toFixed(3)} → {km_down.toFixed(3)}</span>
          </div>
          <button type="button" className="tnd-modal-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="tnd-modal-body">
          {/* Bloque estado — chip grande */}
          <div className="tnd-modal-estado" style={{ borderColor: colEstado, background: `color-mix(in srgb, ${colEstado} 12%, transparent)` }}>
            <div className="tnd-modal-estado-val" style={{ color: colEstado }}>
              {pctDiseno != null ? `${Math.round(pctDiseno)}%` : '—'}
            </div>
            <div className="tnd-modal-estado-lbl">
              <span style={{ color: colEstado, fontWeight: 700 }}>{label}{icon ? ' ' + icon : ''}</span>
              <span>del tirante de diseño</span>
            </div>
          </div>

          <div className="tnd-modal-grid">
            {/* Volumen */}
            <section>
              <h5>Volumen almacenado</h5>
              <Fila k="Actual" v={volActual != null ? <><b>{volActual.toFixed(3)}</b> Mm³</> : '—'} />
              <Fila k="Mínimo (periodo)" v={n3(st.min) + ' Mm³'} />
              <Fila k="Máximo (periodo)" v={n3(st.max) + ' Mm³'} />
              <Fila k="Δ periodo" v={st.delta != null ? `${st.delta > 0 ? '▲' : st.delta < 0 ? '▼' : ''} ${n3(Math.abs(st.delta))} Mm³` : '—'}
                    c={st.delta != null && st.delta > 0 ? '#38bdf8' : '#f59e0b'} />
            </section>

            {/* Geometría del canal */}
            <section>
              <h5>Geometría del canal {esTrapezoidal ? <em className="tnd-modal-tag">trapezoidal</em> : <em className="tnd-modal-tag warn">rectangular</em>}</h5>
              <Fila k="Plantilla (b)" v={<><b>{b.toFixed(2)}</b> m</>} />
              {esTrapezoidal && <Fila k="Talud (z)" v={<><b>{z.toFixed(2)}</b> : 1 (H:V)</>} />}
              <Fila k="Espejo de agua (T)" v={<>{espejo.toFixed(2)} m</>} />
              <Fila k="Área hidráulica (A)" v={<>{area.toFixed(2)} m²</>} />
              <Fila k="Longitud del tramo" v={<><b>{longitudKm.toFixed(3)}</b> km</>} />
            </section>

            {/* Estado hidráulico */}
            <section>
              <h5>Estado hidráulico</h5>
              <Fila k="Tirante actual" v={tiranteActual != null ? <><b>{tiranteActual.toFixed(2)}</b> m</> : '—'} />
              <Fila k="Tirante de diseño" v={tiranteDiseno != null ? `${tiranteDiseno.toFixed(2)} m` : 's/dato'} />
              <Fila k="Nivel aguas arriba" v={nivelUpActual != null ? `${nivelUpActual.toFixed(2)} m` : '—'} />
              <Fila k="Nivel aguas abajo" v={nivelDownActual != null ? `${nivelDownActual.toFixed(2)} m` : '—'} />
              <Fila k="Margen a bordo" v={margenBordo != null ? `${margenBordo.toFixed(2)} m` : '—'}
                    c={margenBordo != null && margenBordo < 0 ? '#ef4444' : undefined} />
            </section>
          </div>

          {/* Mini-tendencia del volumen del tramo */}
          <section className="tnd-modal-chart">
            <h5>Volumen del tramo en el periodo</h5>
            <MultiLine series={[{ nombre: etiqueta, puntos: tramo.puntos, color }]} t0={t0} t1={t1} yLabel="Mm³" height={110} />
          </section>
        </div>
      </div>
    </div>
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

  // ── Filtro por punto de control (Bloque 1) ────────────────────────────────
  // La tabla y la leyenda actúan como filtro activo del gráfico: clic = toggle
  // de visibilidad; el botón "solo" (hover) aísla; la barra ofrece preajustes.
  // vis = Set de escala_id visibles. null = "todas" (estado inicial). Persiste
  // en localStorage por sesión; si el conjunto guardado no intersecta las
  // escalas actuales, se descarta (fallback: todas visibles).
  const idsNiveles = useMemo(() => niveles.map(s => s.escala_id), [niveles]);
  const [visNiveles, setVisNiveles] = useState<Set<string> | null>(() => {
    try {
      const raw = localStorage.getItem(LS_VISIBLES);
      if (!raw) return null;
      const arr = JSON.parse(raw) as string[];
      return Array.isArray(arr) && arr.length ? new Set(arr) : null;
    } catch { return null; }
  });
  // Poda IDs que ya no existen entre las escalas actuales (p.ej. tras cambiar de
  // rango cambia el conjunto de escalas con dato). NO convierte un Set vacío
  // INTENCIONAL ("Ninguna") en "todas": solo actúa si el Set contiene algún id
  // obsoleto. Un vacío elegido por el usuario se respeta.
  useEffect(() => {
    if (visNiveles == null || !idsNiveles.length || visNiveles.size === 0) return;
    const validos = [...visNiveles].filter(id => idsNiveles.includes(id));
    if (validos.length !== visNiveles.size) {
      // Si ninguno de los guardados existe hoy (set totalmente obsoleto, típico al
      // rehidratar de localStorage con otras escalas) → volver a "todas".
      setVisNiveles(validos.length ? new Set(validos) : null);
    }
  }, [idsNiveles, visNiveles]);
  useEffect(() => {
    try {
      if (visNiveles == null) localStorage.removeItem(LS_VISIBLES);
      else localStorage.setItem(LS_VISIBLES, JSON.stringify([...visNiveles]));
    } catch { /* almacenamiento no disponible */ }
  }, [visNiveles]);

  const esVisible = useCallback(
    (id: string) => visNiveles == null || visNiveles.has(id),
    [visNiveles]
  );
  const nVisibles = visNiveles == null ? niveles.length : niveles.filter(s => visNiveles.has(s.escala_id)).length;

  // toggle: enciende/apaga una escala. Nunca deja el gráfico totalmente vacío
  // por accidente — apagar la última visible equivale a "ninguna" explícita.
  const toggleNivel = useCallback((id: string) => {
    setVisNiveles(prev => {
      const base = prev == null ? new Set(idsNiveles) : new Set(prev);
      if (base.has(id)) base.delete(id); else base.add(id);
      return base.size === idsNiveles.length ? null : base;
    });
  }, [idsNiveles]);
  // solo: aísla una escala (o restaura "todas" si ya estaba aislada sola).
  const soloNivel = useCallback((id: string) => {
    setVisNiveles(prev => (prev != null && prev.size === 1 && prev.has(id)) ? null : new Set([id]));
  }, []);
  const verTodas = useCallback(() => setVisNiveles(null), []);
  const verNinguna = useCallback(() => setVisNiveles(new Set()), []);
  const verSoloControl = useCallback(
    () => setVisNiveles(new Set(niveles.filter(esControlDeQ).map(s => s.escala_id))),
    [niveles]
  );

  // Bandas de nivel máximo operativo: solo con ≤3 escalas visibles (con más se
  // saturaría el gráfico). Una banda por escala visible que tenga nivelMax, con
  // su color de serie; se deduplica por valor de nivel para no apilar líneas
  // idénticas (el nivelMax suele ser común, p.ej. 4.0 m).
  const bandasNivelMax = useMemo(() => {
    const vis = niveles
      .map((s, i) => ({ s, color: PAL[i % PAL.length] }))
      .filter(({ s }) => esVisible(s.escala_id));
    if (!vis.length || vis.length > 3) return [];
    const porNivel = new Map<number, { y: number; label: string; color?: string }>();
    for (const { s, color } of vis) {
      if (s.nivelMax == null || !isFinite(s.nivelMax)) continue;
      const y = +s.nivelMax.toFixed(2);
      // si dos escalas comparten nivel máx, una sola banda gris; si es única, su color
      if (porNivel.has(y)) porNivel.set(y, { y, label: `máx op ${y.toFixed(2)} m`, color: '#94a3b8' });
      else porNivel.set(y, { y, label: `K-${s.km} máx ${y.toFixed(2)} m`, color });
    }
    return [...porNivel.values()];
  }, [niveles, esVisible]);

  // Escala común de la tira de secciones: mayor espejo de agua (a la altura del
  // canal) y mayor tirante entre TODOS los tramos. Así cada sección se dibuja a
  // escala real y sus dimensiones son comparables entre tramos (canal cónico:
  // ancho en cabecera > cola). Un +6 % de holgura evita que el mayor toque el borde.
  const escalaSeccion = useMemo<EscalaSeccion>(() => {
    let anchoMax = 1, tiranteMax = 1;
    for (const tr of volTramos) {
      const e = tr.estado;
      const hRef = Math.max(e.tiranteDiseno ?? e.tiranteActual ?? 0, e.tiranteActual ?? 0);
      const ancho = e.esTrapezoidal ? espejoM(e.plantilla, e.talud, hRef) : e.plantilla;
      if (ancho > anchoMax) anchoMax = ancho;
      if (hRef > tiranteMax) tiranteMax = hRef;
    }
    return { anchoMaxM: anchoMax * 1.06, tiranteMaxM: tiranteMax * 1.06 };
  }, [volTramos]);

  // Selección de tramo (Bloque 2): sincroniza la tira de secciones con el
  // apilado. El color de identidad de cada tramo es su índice en la paleta —
  // el MISMO que usa StackedArea para su banda, así "mismo tramo = mismo color".
  const [tramoSel, setTramoSel] = useState<string | null>(null);
  // Modal de detalle: key del tramo cuyo modal está abierto (null = cerrado).
  const [modalKey, setModalKey] = useState<string | null>(null);
  const toggleTramo = useCallback((key: string) => {
    setTramoSel(prev => prev === key ? null : key);
  }, []);
  // Clic en sección: aísla la banda Y abre el modal de detalle del tramo.
  const abrirTramo = useCallback((key: string) => {
    setTramoSel(key);
    setModalKey(key);
  }, []);
  // color de identidad por key (idéntico al índice de banda del apilado)
  const colorTramo = useCallback(
    (key: string) => PAL[volTramos.findIndex(t => t.key === key) % PAL.length],
    [volTramos]
  );

  const preset = (dias: number) => {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - dias * 864e5);
    onRango(desde.toISOString().slice(0, 10), hasta.toISOString().slice(0, 10));
  };

  return (
    <div className="tnd-root">
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
          {/* La tabla y la leyenda son el FILTRO ACTIVO del gráfico: clic en una
              fila/chip alterna su visibilidad; el botón "solo" aísla; la barra
              superior ofrece preajustes. El color de cada serie se ancla a su
              escala_id (índice en `niveles`), no a la lista filtrada, para que no
              "salte" al ocultar/mostrar escalas. */}
          <div className="tnd-block">
            <div className="tnd-h">
              <span className="tnd-n" style={{ background: '#3987e5' }}>1</span> Tendencia de niveles por escala
              <span className="tnd-filtro-info">{nVisibles === niveles.length ? `${niveles.length} puntos` : `${nVisibles} de ${niveles.length}`}</span>
            </div>
            <div className="tnd-filtro-bar">
              <span className="tnd-filtro-lbl">Punto de control:</span>
              <button type="button" className={visNiveles == null ? 'on' : ''} onClick={verTodas}>Todas</button>
              <button type="button" onClick={verSoloControl}>Solo control de Q</button>
              <button type="button" onClick={verNinguna}>Ninguna</button>
            </div>
            <MultiLine
              series={niveles.map((s, i) => ({ nombre: `K-${s.km}`, puntos: s.puntos, color: PAL[i % PAL.length] }))
                             .filter((_, i) => esVisible(niveles[i].escala_id))}
              t0={t0} t1={t1} yLabel="Nivel (m)" height={168}
              bands={bandasNivelMax}
            />
            {bandasNivelMax.length > 0 && (
              <div className="tnd-band-hint">— — nivel máximo operativo (a bordo) de las escalas enfocadas</div>
            )}
            <div className="tnd-legend tnd-legend-int" role="group" aria-label="Filtro de escalas visibles">
              {niveles.map((s, i) => {
                const on = esVisible(s.escala_id);
                return (
                  <button type="button" key={s.escala_id} className={`tnd-chip${on ? '' : ' off'}`}
                    onClick={() => toggleNivel(s.escala_id)}
                    onDoubleClick={() => soloNivel(s.escala_id)}
                    aria-pressed={on}
                    title={on ? `Ocultar K-${s.km} (doble clic: solo)` : `Mostrar K-${s.km}`}>
                    <i style={{ background: PAL[i % PAL.length] }} />K-{s.km}
                  </button>
                );
              })}
            </div>
            <div className="dsk-table-wrap">
              <table className="dsk-table tnd-table-int">
                <thead><tr><th>Escala</th><th>Mín</th><th>Máx</th><th>Prom</th><th>Δ periodo</th><th>Lect.</th><th aria-label="Aislar" /></tr></thead>
                <tbody>
                  {niveles.map((s, i) => { const st = statsSerie(s.puntos); const on = esVisible(s.escala_id); return (
                    <tr key={s.escala_id} className={`tnd-row${on ? '' : ' off'}`}
                        onClick={() => toggleNivel(s.escala_id)}
                        title={on ? `Ocultar K-${s.km}` : `Mostrar K-${s.km}`}>
                      <td style={{ fontWeight: 700 }}>
                        <span className="tnd-swatch" style={{ background: PAL[i % PAL.length], opacity: on ? 1 : 0.3 }} />K-{s.km}
                      </td>
                      <td>{n2(st.min)}</td><td>{n2(st.max)}</td><td>{n2(st.avg)}</td>
                      <td style={{ color: st.delta! > 0 ? '#ef4444' : st.delta! < 0 ? '#22c55e' : '#64748b' }}>{st.delta == null ? '—' : (st.delta > 0 ? '▲' : st.delta < 0 ? '▼' : '—') + ' ' + n2(Math.abs(st.delta))}</td>
                      <td>{st.n}</td>
                      <td className="tnd-solo-cell">
                        <button type="button" className="tnd-solo-btn"
                          onClick={e => { e.stopPropagation(); soloNivel(s.escala_id); }}
                          title={`Ver solo K-${s.km}`}>solo</button>
                      </td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            {nVisibles === 0 && <div className="tnd-empty">Ningún punto de control seleccionado — activa alguno en la tabla o pulsa «Todas».</div>}
          </div>

          {/* ── Bloque 2: volumen por tramo ── */}
          {/* El volumen se reconstruye con la SECCIÓN TRAPEZOIDAL real del canal
              (plantilla b, talud z de perfil_hidraulico_canal) cuando hay geometría;
              si falta, cae al prisma rectangular calibrado (sin regresión). La tira
              de secciones muestra el estado de llenado actual de cada tramo. */}
          <div className="tnd-block">
            <div className="tnd-h">
              <span className="tnd-n" style={{ background: '#199e70' }}>2</span> Volumen por tramo
              <small className="tnd-calc">{volTramos.some(t => t.estado.esTrapezoidal) ? 'sección trapezoidal' : 'reconstruido de niveles'}</small>
            </div>

            {/* Tira de secciones transversales — estado de llenado por tramo */}
            {volTramos.length > 0 && (
              <>
                <div className="tnd-secline">Estado del canal — sección transversal por tramo (tirante · % de diseño)</div>
                <div className="tnd-secstrip">
                  {volTramos.map(tr => (
                    <SeccionCanal key={tr.key} tramo={tr} escala={escalaSeccion}
                      colorTramo={colorTramo(tr.key)}
                      seleccionado={tramoSel === tr.key}
                      atenuado={tramoSel != null && tramoSel !== tr.key}
                      onSelect={() => abrirTramo(tr.key)} />
                  ))}
                </div>
                <div className="tnd-secline tnd-secline-hint">
                  Toca un tramo para aislarlo en el apilado · el color de cada sección = su banda
                  {tramoSel != null && <button type="button" className="tnd-sec-clear" onClick={() => setTramoSel(null)}>ver todos</button>}
                </div>
                <div className="tnd-legend">
                  <span><i style={{ background: '#22c55e' }} />óptimo 85–105%</span>
                  <span><i style={{ background: '#38bdf8' }} />normal 60–85%</span>
                  <span><i style={{ background: '#f59e0b' }} />bajo &lt;60%</span>
                  <span><i style={{ background: '#ef4444' }} />alto &gt;105% (a bordo)</span>
                </div>
              </>
            )}

            <StackedArea series={volTramos} t0={t0} t1={t1} height={170}
              selKey={tramoSel} onSelBand={toggleTramo} />
            <MultiLine series={[{ nombre: 'Total canal', puntos: volTotal, color: '#38bdf8' }]} t0={t0} t1={t1} yLabel="Volumen total en canal (Mm³)" height={110} />
            <div className="dsk-table-wrap">
              <table className="dsk-table">
                <thead><tr><th>Tramo</th><th>Vol mín</th><th>Vol máx</th><th>Δ Mm³</th><th>Tirante act.</th><th>% diseño</th></tr></thead>
                <tbody>
                  {volTramos.map(tr => { const st = statsSerie(tr.puntos); const { color, label } = estadoLlenado(tr.estado.pctDiseno); return (
                    <tr key={tr.key}><td style={{ fontSize: '0.62rem' }}>{tr.etiqueta}</td><td>{n3(st.min)}</td><td>{n3(st.max)}</td>
                      <td style={{ color: st.delta! > 0 ? '#38bdf8' : '#f59e0b' }}>{n3(st.delta)}</td>
                      <td>{tr.estado.tiranteActual != null ? tr.estado.tiranteActual.toFixed(2) : '—'}</td>
                      <td style={{ color, fontWeight: 700 }}>{tr.estado.pctDiseno != null ? `${Math.round(tr.estado.pctDiseno)}% ${label}` : '—'}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            {!volTramos.some(t => t.estado.esTrapezoidal) && volTramos.length > 0 && (
              <div className="tnd-note">Geometría trapezoidal no disponible para estos tramos en <code>perfil_hidraulico_canal</code> — el volumen usa el prisma rectangular calibrado. El % de diseño aparece solo donde hay <code>tirante_diseno_m</code>.</div>
            )}
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

      {/* Modal de detalle del tramo seleccionado */}
      {modalKey != null && (() => {
        const tr = volTramos.find(t => t.key === modalKey);
        return tr ? <ModalTramo tramo={tr} color={colorTramo(tr.key)} t0={t0} t1={t1} onClose={() => setModalKey(null)} /> : null;
      })()}
    </div>
  );
};

// React.memo: el panel vive dentro del PublicMonitor, que re-renderiza con el
// reloj interno (60 s) y cada refresh de datos del mapa. Sus props solo cambian
// cuando cambia el rango/granularidad o llegan series nuevas — con memo, los
// ticks del monitor no re-renderizan las gráficas.
export default React.memo(TendenciasPanel);
