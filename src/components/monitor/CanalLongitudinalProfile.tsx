import React from 'react';
import type { EscalaData, FGVStep } from './canalHelpers';
import { escalaAlertColor } from './canalHelpers';

// React.memo: el perfil se redibuja solo cuando cambian escalas/coherencia/FGV,
// no con cada tick del reloj del monitor.
export const CanalLongitudinalProfile = React.memo(({ escalas, coherencia, fgvProfile, fgvLoading }: {
  escalas: EscalaData[];
  coherencia: any;
  fgvProfile?: FGVStep[] | null;
  fgvLoading?: boolean;
}) => {
  const W = 800, H = 190;
  const PAD_L = 42, PAD_R = 32, PAD_T = 38, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const KM_MAX = 104;
  const Y_MIN = 1.5;

  const pts = escalas
    .filter(e => e.km >= 0 && e.km <= 104 && (e.nivel_actual ?? 0) > 0.1)
    .sort((a, b) => a.km - b.km);

  // Y_MAX adaptativo: deja margen sobre el bordo más alto y el nivel más alto
  // para que ni la línea de bordo ni la zona crítica queden recortadas.
  const maxBordo = Math.max(0, ...escalas.map(e => e.nivel_max_operativo ?? 0));
  const maxNivel = Math.max(0, ...pts.map(e => e.nivel_actual ?? 0));
  const Y_MAX = Math.max(4.4, Math.ceil((Math.max(maxBordo, maxNivel) + 0.3) * 2) / 2);

  const xS = (km: number) => PAD_L + (Math.max(0, Math.min(km, KM_MAX)) / KM_MAX) * plotW;
  const yS = (y: number) => PAD_T + plotH - ((Math.max(Y_MIN, Math.min(y, Y_MAX)) - Y_MIN) / (Y_MAX - Y_MIN)) * plotH;

  // ── Bordo libre REAL por escala ─────────────────────────────────────────
  // Antes el fondo crítico/alerta era una banda horizontal fija (3.5/3.2m) para
  // TODO el canal. Pero cada escala tiene su propio nivel_max_operativo: 3.0m en
  // K-0 y 3.0m en K-104 NO representan el mismo riesgo de desbordamiento. Aquí
  // construimos la línea de bordo siguiendo el techo real de cada escala, y las
  // zonas de riesgo se dibujan RELATIVAS a ese techo (no a un umbral global).
  const bordoPts = escalas
    .filter(e => e.km >= 0 && e.km <= 104 && (e.nivel_max_operativo ?? 0) > 0.1)
    .sort((a, b) => a.km - b.km)
    .map(e => ({ km: e.km, bordo: e.nivel_max_operativo as number }));
  const hasBordo = bordoPts.length >= 2;
  // Banda de ALERTA = 80–100% del bordo; CRÍTICO = >100% del bordo.
  const ALERTA_FRAC = 0.80;

  // ── Frescura de telemetría ──────────────────────────────────────────────
  // Coherente con el banner "TELEMETRÍA VENCIDA" del panel SKILL. Si la lectura
  // más reciente supera 4 h, el perfil dibuja datos históricos: lo atenuamos y
  // congelamos la animación de flujo para no insinuar operación en vivo.
  const STALE_MIN = 240;
  const ptAgeMin = (e: EscalaData): number | null =>
    e.ultima_telemetria ? (Date.now() - e.ultima_telemetria) / 60000 : null;
  const edadMin = pts.reduce<number | null>((min, e) => {
    const a = ptAgeMin(e);
    if (a === null) return min;
    return min === null || a < min ? a : min;
  }, null);
  const perfilStale = edadMin === null || edadMin > STALE_MIN;
  const edadTxt = edadMin === null ? 'sin lectura'
    : edadMin < 60 ? `${Math.round(edadMin)} min`
    : `${(edadMin / 60).toFixed(1)} h`;
  const bordoLine   = hasBordo ? bordoPts.map(b => `${xS(b.km)},${yS(b.bordo)}`).join(' ') : '';
  const alertaLine  = hasBordo ? bordoPts.map(b => `${xS(b.km)},${yS(b.bordo * ALERTA_FRAC)}`).join(' ') : '';

  const trendArrow = (e: EscalaData): { symbol: string; color: string } => {
    const d = e.delta_12h ?? 0;
    // Cian/verde/gris — NO rojo: la dirección de la tendencia es un hecho
    // neutro, no un juicio de riesgo (rojo está reservado para alerta real).
    if (d > 0.01)  return { symbol: '▲', color: '#3FB2F3' };
    if (d < -0.01) return { symbol: '▼', color: '#22c55e' };
    return { symbol: '—', color: '#8396ad' };
  };

  // ── Spline Catmull-Rom → curva suave (superficie de agua fluida) ─────────
  // Convierte una serie de puntos [x,y] en un path SVG con curvas Bézier que
  // pasan por todos los puntos. Da el aspecto de lámina de agua continua en
  // lugar de segmentos rectos quebrados.
  const smoothPath = (xy: [number, number][]): string => {
    if (xy.length < 2) return '';
    if (xy.length === 2) return `M ${xy[0][0]},${xy[0][1]} L ${xy[1][0]},${xy[1][1]}`;
    const t = 0.5; // tensión
    let d = `M ${xy[0][0]},${xy[0][1]}`;
    for (let i = 0; i < xy.length - 1; i++) {
      const p0 = xy[i === 0 ? 0 : i - 1];
      const p1 = xy[i];
      const p2 = xy[i + 1];
      const p3 = xy[i + 2 < xy.length ? i + 2 : i + 1];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6 * t * 2;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6 * t * 2;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6 * t * 2;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6 * t * 2;
      d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
    }
    return d;
  };

  const base = PAD_T + plotH;
  const waterXY: [number, number][] = pts.map(e => [xS(e.km), yS(e.nivel_actual ?? 0)]);
  const waterLinePath = smoothPath(waterXY);
  const waterAreaPath = pts.length >= 2
    ? `${waterLinePath} L ${xS(pts[pts.length - 1].km)},${base} L ${xS(pts[0].km)},${base} Z`
    : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        {/* Cuerpo de agua — degradado vertical glassy */}
        <linearGradient id="cpWater" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#22d3ee" stopOpacity="0.34" />
          <stop offset="45%"  stopColor="#3FB2F3" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.02" />
        </linearGradient>
        {/* Línea de superficie — degradado horizontal (entrada → salida) */}
        <linearGradient id="cpSurface" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#67e8f9" />
          <stop offset="55%"  stopColor="#3FB2F3" />
          <stop offset="100%" stopColor="#818cf8" />
        </linearGradient>
        {/* Brillo móvil que recorre la superficie (sensación de flujo) */}
        <linearGradient id="cpFlow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%"  stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          <animate attributeName="x1" values="-0.3;1" dur="4.5s" repeatCount="indefinite" />
          <animate attributeName="x2" values="0;1.3" dur="4.5s" repeatCount="indefinite" />
        </linearGradient>
        <linearGradient id="cpCrit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#ef4444" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.03" />
        </linearGradient>
        {/* Vignette del lienzo */}
        <radialGradient id="cpVignette" cx="50%" cy="40%" r="75%">
          <stop offset="60%" stopColor="#070e1c" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
        </radialGradient>
        <filter id="cpGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Glow suave para la línea de superficie */}
        <filter id="cpLineGlow" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="bg" />
          <feMerge><feMergeNode in="bg" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Fondo oscuro */}
      <rect width={W} height={H} fill="#070e1c" />

      {/* ── Zonas de riesgo RELATIVAS al bordo real de cada escala ──────────
           El techo de riesgo sigue el nivel_max_operativo punto a punto, no un
           umbral global. Así el riesgo de desbordamiento es comparable a lo
           largo de todo el canal aunque las escalas tengan distinta altura. */}
      {hasBordo ? (
        <>
          {/* Zona CRÍTICA: por encima de la línea de bordo (riesgo de rebose) */}
          <polygon
            points={`${xS(bordoPts[0].km)},${PAD_T} ${bordoLine} ${xS(bordoPts[bordoPts.length - 1].km)},${PAD_T}`}
            fill="url(#cpCrit)" />
          {/* Zona ALERTA: banda entre 80% del bordo y el bordo */}
          <polygon
            points={`${alertaLine} ${bordoPts.slice().reverse().map(b => `${xS(b.km)},${yS(b.bordo)}`).join(' ')}`}
            fill="rgba(245,158,11,0.08)" />
        </>
      ) : (
        // Fallback al esquema fijo solo si no hay bordo definido en ninguna escala
        <>
          <rect x={PAD_L} y={yS(Y_MAX)} width={plotW} height={yS(3.5) - yS(Y_MAX)} fill="url(#cpCrit)" />
          <rect x={PAD_L} y={yS(3.5)} width={plotW} height={yS(3.2) - yS(3.5)} fill="rgba(245,158,11,0.07)" />
        </>
      )}

      {/* Grid horizontal */}
      {[2.0, 2.5, 3.0, 3.5, 4.0].map(y => (
        <line key={y} x1={PAD_L} y1={yS(y)} x2={PAD_L + plotW} y2={yS(y)}
          stroke="#111e34" strokeWidth={y % 1 === 0 ? 0.9 : 0.5} />
      ))}

      {/* Grid vertical en KM principales */}
      {[0, 23, 34, 57, 80, 104].map(km => (
        <line key={km} x1={xS(km)} y1={PAD_T} x2={xS(km)} y2={base}
          stroke="#111e34" strokeWidth="0.7" strokeDasharray="3,6" />
      ))}

      {/* Línea de BORDO real por escala (techo de seguridad) — curva suave */}
      {hasBordo && (
        <>
          <path d={smoothPath(bordoPts.map(b => [xS(b.km), yS(b.bordo)]))}
            fill="none" stroke="#ef4444" strokeWidth="1.4"
            strokeDasharray="7,5" opacity="0.75" strokeLinejoin="round" />
          <rect x={PAD_L + plotW - 34} y={yS(bordoPts[bordoPts.length - 1].bordo) - 6} width={34} height={10}
            fill="#ef4444" opacity="0.15" rx="2" />
          <text x={PAD_L + plotW - 17} y={yS(bordoPts[bordoPts.length - 1].bordo) + 2}
            fill="#ef4444" fontSize="6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">BORDO</text>
          {/* Línea de alerta = 80% del bordo */}
          <path d={smoothPath(bordoPts.map(b => [xS(b.km), yS(b.bordo * ALERTA_FRAC)]))}
            fill="none" stroke="#f59e0b" strokeWidth="0.9"
            strokeDasharray="4,4" opacity="0.45" strokeLinejoin="round" />
        </>
      )}

      {/* Cuerpo de agua + superficie — atenuados si la telemetría está vencida */}
      <g opacity={perfilStale ? 0.42 : 1}>
        {/* Cuerpo de agua — relleno glassy con curva suave */}
        {pts.length >= 2 && <path d={waterAreaPath} fill="url(#cpWater)" />}

        {/* Superficie — halo suave */}
        {pts.length >= 2 && (
          <path d={waterLinePath} fill="none" stroke="rgba(63, 178, 243,0.16)"
            strokeWidth="7.5" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {/* Superficie — línea principal. En vivo: degradado + glow. Vencida:
            gris punteado para señalar que es un perfil histórico, no actual. */}
        {pts.length >= 2 && (
          perfilStale ? (
            <path d={waterLinePath} fill="none" stroke="#64748b" strokeWidth="2"
              strokeDasharray="5,4" strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <path d={waterLinePath} fill="none" stroke="url(#cpSurface)" strokeWidth="2.4"
              strokeLinejoin="round" strokeLinecap="round" filter="url(#cpLineGlow)" />
          )
        )}
        {/* Brillo móvil + partícula de flujo — SOLO en vivo (congelado si vencido) */}
        {pts.length >= 2 && !perfilStale && (
          <path d={waterLinePath} fill="none" stroke="url(#cpFlow)" strokeWidth="2.6"
            strokeLinejoin="round" strokeLinecap="round" />
        )}
        {pts.length >= 2 && !perfilStale && waterLinePath && (
          <circle r="2.4" fill="#ffffff" opacity="0.85">
            <animateMotion dur="4.5s" repeatCount="indefinite" path={waterLinePath} rotate="auto" />
            <animate attributeName="opacity" values="0;0.9;0" dur="4.5s" repeatCount="indefinite" />
          </circle>
        )}
      </g>

      {/* Ejes */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={base} stroke="#1e2f45" strokeWidth="1" />
      <line x1={PAD_L} y1={base} x2={PAD_L + plotW} y2={base} stroke="#1e2f45" strokeWidth="1" />

      {/* Y-axis labels */}
      {[2.0, 2.5, 3.0, 3.5, 4.0].map(y => (
        <text key={y} x={PAD_L - 5} y={yS(y) + 2.5}
          fill="#3d546e" fontSize="7.5" textAnchor="end" fontFamily="monospace">{y.toFixed(1)}</text>
      ))}
      <text x={PAD_L - 28} y={PAD_T + plotH / 2}
        fill="#2d3f55" fontSize="7" textAnchor="middle" fontFamily="monospace"
        transform={`rotate(-90, ${PAD_L - 28}, ${PAD_T + plotH / 2})`}>m</text>

      {/* KM axis labels */}
      {[0, 23, 34, 57, 80, 104].map(km => (
        <g key={km}>
          <line x1={xS(km)} y1={base} x2={xS(km)} y2={base + 4} stroke="#1e2f45" strokeWidth="1" />
          <text x={xS(km)} y={H - 6} fill="#3d546e" fontSize="7.5" textAnchor="middle" fontFamily="monospace">K{km}</text>
        </g>
      ))}

      {/* ── Capa FGV — superficie libre simulada ── */}
      {fgvProfile && fgvProfile.length >= 2 && (() => {
        const fpts = fgvProfile.filter(s => s.km >= 0 && s.km <= KM_MAX);

        // Relleno FGV
        const fBase = base;
        const fWaterPoly = [
          `${xS(fpts[0].km)},${fBase}`,
          ...fpts.map(s => `${xS(s.km)},${yS(s.y)}`),
          `${xS(fpts[fpts.length - 1].km)},${fBase}`,
        ].join(' ');

        // Saltos hidráulicos: transición M2 → M1
        const jumps: number[] = [];
        for (let i = 1; i < fpts.length; i++) {
          if (fpts[i - 1].remanso === 'M2' && fpts[i].remanso === 'M1') {
            jumps.push((fpts[i - 1].km + fpts[i].km) / 2);
          }
        }

        return (
          <g opacity="0.85">
            {/* Relleno translúcido FGV */}
            <polygon points={fWaterPoly} fill="rgba(251,191,36,0.06)" />

            {/* Línea FGV — sombra */}
            <polyline
              points={fpts.map(s => `${xS(s.km)},${yS(s.y)}`).join(' ')}
              fill="none" stroke="rgba(251,191,36,0.12)" strokeWidth="6"
              strokeLinejoin="round"
            />
            {/* Línea FGV — principal (punteada) */}
            <polyline
              points={fpts.map(s => `${xS(s.km)},${yS(s.y)}`).join(' ')}
              fill="none" stroke="#fbbf24" strokeWidth="1.5"
              strokeDasharray="6,4" strokeLinejoin="round"
            />

            {/* Marcadores de alerta FGV (pct_bordo ≥ 75%) */}
            {fpts.filter(s => s.alerta && !s.critico).map((s, i) => (
              <circle key={`fa${i}`} cx={xS(s.km)} cy={yS(s.y)} r={3}
                fill="#f97316" stroke="#070e1c" strokeWidth="1" opacity="0.9" />
            ))}

            {/* Marcadores críticos FGV (pct_bordo ≥ 92%) */}
            {fpts.filter(s => s.critico).map((s, i) => (
              <circle key={`fc${i}`} cx={xS(s.km)} cy={yS(s.y)} r={4}
                fill="#ef4444" stroke="#070e1c" strokeWidth="1.2" />
            ))}

            {/* Saltos hidráulicos */}
            {jumps.map((km, i) => (
              <g key={`hj${i}`} filter="url(#cpGlow)">
                <line x1={xS(km)} y1={PAD_T + 4} x2={xS(km)} y2={base}
                  stroke="#f97316" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.7" />
                <rect x={xS(km) - 14} y={PAD_T + 4} width={28} height={10}
                  fill="#f97316" opacity="0.18" rx="2" />
                <text x={xS(km)} y={PAD_T + 11} fill="#f97316" fontSize="6"
                  textAnchor="middle" fontFamily="monospace" fontWeight="bold">SALTO</text>
              </g>
            ))}
          </g>
        );
      })()}

      {/* Spinner FGV cargando */}
      {fgvLoading && (
        <text x={W / 2} y={PAD_T + plotH / 2} fill="#fbbf24" fontSize="9"
          textAnchor="middle" fontFamily="monospace" opacity="0.7">
          Calculando perfil FGV…
        </text>
      )}

      {/* Puntos con nivel, halo, tendencia */}
      {pts.map((e) => {
        const x = xS(e.km);
        const y = yS(e.nivel_actual ?? 0);
        const baseCol = escalaAlertColor(e, coherencia);
        const age = ptAgeMin(e);
        const ptStale = age === null || age > STALE_MIN;
        // Punto vencido: color desaturado (gris) para no afirmar alerta en vivo.
        const col = ptStale ? '#64748b' : baseCol;
        const isCrit = !ptStale && baseCol === '#ef4444';
        const { symbol, color: tColor } = trendArrow(e);
        const nearTop = y < PAD_T + 20;
        const lY = nearTop ? y + 22 : y - 14;

        return (
          <g key={e.id} filter="url(#cpGlow)">
            {/* Drop line al lecho */}
            <line x1={x} y1={y + 6} x2={x} y2={base} stroke={col} strokeWidth="1" opacity="0.18" />
            {/* Anillo de pulso animado solo en puntos críticos EN VIVO */}
            {isCrit && (
              <circle cx={x} cy={y} r={6} fill="none" stroke={col} strokeWidth="1.4">
                <animate attributeName="r" values="6;13;6" dur="2.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="2.2s" repeatCount="indefinite" />
              </circle>
            )}
            {/* Halo exterior */}
            <circle cx={x} cy={y} r={10} fill={col} opacity={ptStale ? 0.06 : 0.10} />
            {/* Halo medio */}
            <circle cx={x} cy={y} r={6.5} fill={col} opacity={ptStale ? 0.12 : 0.20} />
            {/* Punto principal — relleno si en vivo, hueco si vencido */}
            <circle cx={x} cy={y} r={5}
              fill={ptStale ? '#0a1426' : col}
              stroke={col} strokeWidth={ptStale ? 1.6 : 1.8}
              strokeDasharray={ptStale ? '2,1.5' : undefined}>
              <title>{`${e.nombre} · nivel ${(e.nivel_actual ?? 0).toFixed(2)} m${e.nivel_max_operativo ? ` / bordo ${e.nivel_max_operativo.toFixed(2)} m` : ''} · ${age === null ? 'sin lectura' : age < 60 ? `hace ${Math.round(age)} min` : `hace ${(age / 60).toFixed(1)} h`}`}</title>
            </circle>
            {/* Brillo especular — solo en vivo */}
            {!ptStale && <circle cx={x - 1.5} cy={y - 1.8} r={1.5} fill="rgba(255,255,255,0.55)" />}
            {/* Etiqueta de valor — pastilla de fondo para legibilidad */}
            <g>
              <rect x={x - 13} y={lY - 8} width={26} height={11} rx={3}
                fill="#0a1426" opacity="0.78" />
              <text x={x} y={lY} fill={col} fontSize="9" textAnchor="middle"
                fontFamily="monospace" fontWeight="bold" letterSpacing="-0.3">
                {(e.nivel_actual ?? 0).toFixed(2)}
              </text>
            </g>
            {/* Tendencia */}
            <text x={x + 15} y={lY} fill={tColor} fontSize="8" textAnchor="start" fontFamily="monospace">
              {symbol}
            </text>
          </g>
        );
      })}

      {/* Indicador de dirección de flujo — eje superior */}
      {pts.length >= 2 && (
        <g opacity="0.5">
          <text x={PAD_L} y={PAD_T - 6} fill="#8396ad" fontSize="6.5"
            fontFamily="monospace" fontWeight="bold" letterSpacing="0.5">K-0 entrada</text>
          <text x={PAD_L + plotW} y={PAD_T - 6} fill="#8396ad" fontSize="6.5"
            textAnchor="end" fontFamily="monospace" fontWeight="bold" letterSpacing="0.5">K-104 SALIDA →</text>
        </g>
      )}

      {/* Badge de frescura de telemetría — centrado arriba */}
      {pts.length >= 2 && (() => {
        const cx = PAD_L + plotW / 2;
        const live = !perfilStale;
        const fill = live ? '#22c55e' : '#64748b';
        const label = live ? `EN VIVO · ${edadTxt}` : `PERFIL HISTÓRICO · ${edadTxt}`;
        const bw = label.length * 4.2 + 18;
        return (
          <g>
            <rect x={cx - bw / 2} y={PAD_T - 11} width={bw} height={11} rx={5.5}
              fill={live ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.14)'}
              stroke={live ? 'rgba(34,197,94,0.4)' : 'rgba(100,116,139,0.35)'} strokeWidth="0.6" />
            <circle cx={cx - bw / 2 + 8} cy={PAD_T - 5.5} r={2} fill={fill}>
              {live && <animate attributeName="opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" />}
            </circle>
            <text x={cx + 4} y={PAD_T - 2.5} fill={fill} fontSize="6.5"
              textAnchor="middle" fontFamily="monospace" fontWeight="bold" letterSpacing="0.3">
              {label}
            </text>
          </g>
        );
      })()}

      {/* Vignette del lienzo (profundidad) */}
      <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="url(#cpVignette)" pointerEvents="none" />
    </svg>
  );
});
