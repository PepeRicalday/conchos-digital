import React from 'react';
import { PLANTILLA, TALUD_Z, FREEBOARD } from '../../utils/modelingTypes';
import { statusColor } from '../../utils/modelacion/hidraulicaCanal';

// ── SECCIÓN TRANSVERSAL SVG — usa geometría real del tramo ──────────────
export const CanalSection: React.FC<{
  yBase:     number;
  ySim:      number;
  plantilla?: number;
  talud?:    number;
  freeboard?: number;
}> = ({ yBase, ySim, plantilla = PLANTILLA, talud = TALUD_Z, freeboard = FREEBOARD }) => {
  const W = 240, H = 130;
  const CX = W / 2, BY = H - 18;
  const VPM = (H - 32) / freeboard;
  const HPM = (W - 96) / (plantilla + 2 * talud * freeboard);

  const bxL  = CX - (plantilla / 2) * HPM;
  const bxR  = CX + (plantilla / 2) * HPM;
  const fbY  = BY - freeboard * VPM;
  const fbxL = bxL - talud * freeboard * HPM;
  const fbxR = bxR + talud * freeboard * HPM;

  // Zona alerta (75%) y crítico (92%)
  const alertY = BY - (freeboard * 0.75) * VPM;
  const critY  = BY - (freeboard * 0.92) * VPM;

  const sY   = Math.max(0.05, Math.min(ySim,  freeboard));
  const bY   = Math.max(0.05, Math.min(yBase, freeboard));
  const swY  = BY - sY * VPM;
  const swxL = CX - (plantilla / 2 + talud * sY) * HPM;
  const swxR = CX + (plantilla / 2 + talud * sY) * HPM;
  const bwY  = BY - bY * VPM;
  const bwxL = CX - (plantilla / 2 + talud * bY) * HPM;
  const bwxR = CX + (plantilla / 2 + talud * bY) * HPM;

  const pct = sY / freeboard;
  const sc  = statusColor(pct > 0.92 ? 'CRITICO' : pct > 0.75 ? 'ALERTA' : 'ESTABLE');
  const borda = (freeboard - sY).toFixed(2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: H }}>
      <defs>
        <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sc} stopOpacity="0.35" />
          <stop offset="100%" stopColor={sc} stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#050e1a" rx="6" />
      {/* Zona crítica (92%) */}
      <rect x={fbxL} y={critY} width={fbxR - fbxL} height={alertY - critY}
        fill="rgba(239,68,68,0.06)" />
      {/* Zona alerta (75%-92%) */}
      <rect x={fbxL} y={alertY} width={fbxR - fbxL} height={BY - alertY - freeboard * 0.75 * VPM * 0.01}
        fill="rgba(245,158,11,0.04)" />
      {/* Taludes */}
      <polygon points={`${fbxL},${fbY} ${bxL},${BY} ${bxR},${BY} ${fbxR},${fbY}`}
        fill="rgba(30,41,59,0.5)" stroke="#334155" strokeWidth="1.5" />
      {/* Plantilla (fondo) */}
      <rect x={bxL} y={BY} width={bxR - bxL} height={5} fill="#1e293b" />
      {/* Agua simulada */}
      <polygon points={`${swxL},${swY} ${swxR},${swY} ${bxR},${BY} ${bxL},${BY}`}
        fill="url(#waterGrad)" />
      {/* Superficie simulada */}
      <line x1={swxL} y1={swY} x2={swxR} y2={swY} stroke={sc} strokeWidth="2.5"
        style={{ filter: `drop-shadow(0 0 3px ${sc}66)` }} />
      {/* Nivel base (punteado) */}
      {Math.abs(sY - bY) > 0.02 && (
        <line x1={bwxL} y1={bwY} x2={bwxR} y2={bwY} stroke="#3FB2F3"
          strokeWidth="1.5" strokeDasharray="5,3" opacity="0.55" />
      )}
      {/* Línea alerta (75%) */}
      <line x1={fbxL + 4} y1={alertY} x2={fbxR - 4} y2={alertY}
        stroke="#d97706" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.5" />
      {/* Bordo libre */}
      <line x1={fbxL} y1={fbY} x2={fbxR} y2={fbY}
        stroke="#ef4444" strokeWidth="1" strokeDasharray="6,4" opacity="0.5" />
      {/* Cota del agua */}
      <text x={swxR + 4} y={swY + 4} fill={sc} fontSize="11" fontFamily="monospace" fontWeight="bold">
        {ySim.toFixed(2)}m
      </text>
      {Math.abs(sY - bY) > 0.02 && (
        <text x={bwxR + 4} y={bwY + 4} fill="#3FB2F3" fontSize="11" fontFamily="monospace">
          {yBase.toFixed(2)}m
        </text>
      )}
      {/* Bordo libre (cota máxima del canal) */}
      <text x={W - 6} y={fbY - 4} fill="#f87171" fontSize="11" fontFamily="monospace" textAnchor="end">
        H={freeboard.toFixed(1)}m
      </text>
      <text x={W - 6} y={fbY + 13} fill={sc} fontSize="11" fontFamily="monospace" fontWeight="bold" textAnchor="end">
        ▲ {borda}m libre
      </text>
      {/* Info tramo */}
      <text x={CX} y={H - 4} fill="#8FA7C8" fontSize="11" fontFamily="monospace" textAnchor="middle">
        b={plantilla}m · z={talud}:1
      </text>
      {/* Barra % bordo libre */}
      <rect x={bxL} y={BY + 3} width={bxR - bxL} height={3} fill="#0d1f38" rx="1" />
      <rect x={bxL} y={BY + 3} width={(bxR - bxL) * Math.min(1, pct)} height={3}
        fill={sc} rx="1" />
    </svg>
  );
};
