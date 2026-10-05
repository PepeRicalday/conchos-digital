
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { FileBarChart } from 'lucide-react';
import type {
  SerieEscala, SerieTramo, SerieCompuerta, SerieGasto, SeriePunto,
} from '../utils/tendencias';
import { statsSerie } from '../utils/tendencias';
import InformeTendencias from './InformeTendencias';
import { PAL, MultiLine, StackedArea, MiniNivel, colorKm, niceTicks, type EventoMarca } from './TendenciasCharts';
import { getTodayString, addDays } from '../utils/dateHelpers';

const n2 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(2);
const n3 = (v: number | null | undefined) => v == null || !isFinite(v) ? '—' : v.toFixed(3);

// Escalas de referencia (nivel sin control de Q): sin compuerta propia. Debe
// coincidir con ESC_SIN_CONTROL de PublicMonitor.tsx. Se clasifica por nombre.
const ESC_SIN_CONTROL = new Set(['K-64', 'K-94+200']);
const esControlDeQ = (s: SerieEscala) => !ESC_SIN_CONTROL.has(s.nombre);
const LS_VISIBLES = 'tnd:puntos-visibles';

// ── Skeleton de bloque (carga granular) ─────────────────────────────────────
// Cada uno de los 4 bloques del panel pinta su propio placeholder con el mismo
// número/color de cabecera que tendrá cuando llegue el dato — así, si a futuro
// la carga se fragmenta (p.ej. por bloque en vez de un solo fetch), la UI ya
// tiene el slot listo en vez de un mensaje único cubriendo todo el panel.
const TndBlockSkeleton: React.FC<{ titulo: string; color: string; height: number }> = ({ titulo, color, height }) => (
  <div className="tnd-block tnd-skel">
    <div className="tnd-h">
      <span className="tnd-n tnd-skel-n" style={{ background: color }} />
      {titulo}
    </div>
    <div className="tnd-skel-chart" style={{ height }} />
  </div>
);

// ── Sección transversal trapezoidal por tramo (estado de llenado) ───────────
// Dibuja la sección real del canal (plantilla b, taludes z) con la lámina de
// agua al tirante actual. El COLOR de IDENTIDAD es único por tramo (paleta); el
// ESTADO (respecto al tirante de diseño) se comunica con borde + ícono, no con
// el relleno, para que "mismo tramo = mismo color" en sección y apilado.
//
// Umbrales respecto al tirante de DISEÑO (que es el nivel normal de operación,
// no un límite de peligro): operar al 100% del diseño es óptimo. El riesgo real
// es SUPERARLO (invade bordo libre) o quedar muy por debajo (desabasto).
// Con el canal en VACIADO un tirante bajo es lo esperado, no un desabasto: se rotula 'vaciado' en tono neutro.
const VaciadoCtx = React.createContext(false);
const estadoLlenado = (pct: number | null, vaciado = false): { color: string; label: string; icon: string } => {
  if (pct == null) return { color: '#64748b', label: 's/diseño', icon: '' };
  if (vaciado && pct < 60) return { color: '#94a3b8', label: 'vaciado', icon: '' };
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
  const { tiranteActual, pctDiseno, plantilla: b, talud: z, tiranteDiseno,
          bordoLibre, alturaCanal, anchoCorona, nSecciones, esTrapezoidal } = estado;
  const vac = React.useContext(VaciadoCtx);
  const { color: colEstado, label, icon } = estadoLlenado(pctDiseno, vac);
  const compuesto = nSecciones > 1;   // el tramo cruza varias secciones-tipo reales

  // ── Lienzo con margen; el mapeo metros→px es COMÚN a toda la tira ──
  const W = 100, H = 116, PBtxt = 46, PTtop = 10;
  const drawW = W - 8, drawH = H - PBtxt - PTtop;      // zona útil
  const cx = W / 2, yBot = PTtop + drawH;
  // px por metro (horizontal y vertical), compartidos vía la escala máxima global
  const pxPerM_X = drawW / Math.max(1e-6, escala.anchoMaxM);
  const pxPerM_Y = drawH / Math.max(1e-6, escala.tiranteMaxM);

  // Altura FÍSICA del canal dibujado = altura real del revestimiento (tirante de
  // diseño + bordo libre). Si no hay bordo libre, se cae al tirante de diseño
  // (o al actual). Así la sección muestra el canal completo y el agua adentro,
  // dejando ver el margen a bordo real, no solo el llenado respecto al diseño.
  const hCanal = Math.max(alturaCanal ?? tiranteDiseno ?? tiranteActual ?? 1, 0.1);
  // Anchos reales (m) → medios anchos en px
  const halfBot = (b * pxPerM_X) / 2;                             // plantilla (fondo)
  const halfTopCanal = (espejoM(b, z, hCanal) * pxPerM_X) / 2;    // espejo al borde del canal
  const yTopCanal = yBot - hCanal * pxPerM_Y;                     // coronamiento del canal (a escala)
  const xBotL = cx - halfBot, xBotR = cx + halfBot;
  const xTopL = cx - halfTopCanal, xTopR = cx + halfTopCanal;

  // Línea de tirante de DISEÑO (nivel normal de operación), dentro del canal.
  const hDiseno = tiranteDiseno != null ? Math.min(tiranteDiseno, hCanal) : null;
  const yDiseno = hDiseno != null ? yBot - hDiseno * pxPerM_Y : null;
  const halfDiseno = hDiseno != null ? (espejoM(b, z, hDiseno) * pxPerM_X) / 2 : 0;

  // Lámina de agua al tirante actual (a la MISMA escala vertical)
  const hAgua = tiranteActual != null ? Math.min(tiranteActual, escala.tiranteMaxM) : 0;
  const yW = yBot - hAgua * pxPerM_Y;
  const halfAgua = (espejoM(b, z, hAgua) * pxPerM_X) / 2;
  const xWL = cx - halfAgua, xWR = cx + halfAgua;

  const coronaTxt = anchoCorona != null ? anchoCorona.toFixed(1) : (esTrapezoidal ? espejoM(b, z, hCanal).toFixed(1) : b.toFixed(1));
  const tip = `${etiqueta}\n`
    + `tirante ${tiranteActual != null ? tiranteActual.toFixed(2) + ' m' : 's/d'}`
    + `${pctDiseno != null ? ` · ${pctDiseno}% diseño (${label})` : ''}\n`
    + (esTrapezoidal
        ? `plantilla b=${b.toFixed(1)} m · talud z=${z.toFixed(2)} · corona ${coronaTxt} m\n`
          + `altura canal ${alturaCanal != null ? alturaCanal.toFixed(2) + ' m' : 's/d'}`
          + `${tiranteDiseno != null ? ` (diseño ${tiranteDiseno.toFixed(2)} m` : ''}`
          + `${bordoLibre != null ? ` + bordo ${bordoLibre.toFixed(2)} m)` : (tiranteDiseno != null ? ')' : '')}`
          + `${compuesto ? `\n⚠ tramo compuesto: cruza ${nSecciones} secciones-tipo · se muestra la dominante` : ''}`
        : 'rectangular (sin geometría de perfil)');

  const cls = `tnd-sec${seleccionado ? ' sel' : ''}${atenuado ? ' dim' : ''}`;
  return (
    <button type="button" className={cls} title={tip} onClick={onSelect}
      aria-pressed={seleccionado} style={{ '--tramo-col': colorTramo } as React.CSSProperties}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {/* sección de concreto a la ALTURA REAL del canal (coronamiento); el borde
            lleva el COLOR DE IDENTIDAD del tramo. La cavidad muestra el canal vacío. */}
        <polygon points={`${xTopL.toFixed(1)},${yTopCanal.toFixed(1)} ${xBotL.toFixed(1)},${yBot} ${xBotR.toFixed(1)},${yBot} ${xTopR.toFixed(1)},${yTopCanal.toFixed(1)}`}
          fill="#101a26" stroke={colorTramo} strokeWidth={seleccionado ? 2 : 1.2} />
        {/* zona de BORDO LIBRE (entre tirante de diseño y coronamiento): franja
            hachurada que hace visible el margen físico del canal sobre la operación. */}
        {yDiseno != null && bordoLibre != null && bordoLibre > 0 && (
          <polygon points={`${(cx - halfDiseno).toFixed(1)},${yDiseno.toFixed(1)} ${xTopL.toFixed(1)},${yTopCanal.toFixed(1)} ${xTopR.toFixed(1)},${yTopCanal.toFixed(1)} ${(cx + halfDiseno).toFixed(1)},${yDiseno.toFixed(1)}`}
            fill="#334155" opacity="0.22" />
        )}
        {/* agua — coloreada con la IDENTIDAD del tramo (mismo color que su banda del apilado) */}
        {hAgua > 0 && (
          <polygon points={`${xWL.toFixed(1)},${yW.toFixed(1)} ${xBotL.toFixed(1)},${yBot} ${xBotR.toFixed(1)},${yBot} ${xWR.toFixed(1)},${yW.toFixed(1)}`}
            fill={colorTramo} opacity={seleccionado ? 0.9 : 0.68} />
        )}
        {/* espejo de agua */}
        {hAgua > 0 && <line x1={xWL.toFixed(1)} y1={yW.toFixed(1)} x2={xWR.toFixed(1)} y2={yW.toFixed(1)} stroke="#e2e8f0" strokeWidth="0.8" strokeDasharray="3,2" opacity="0.75" />}
        {/* línea de tirante de DISEÑO dentro del canal (nivel normal de operación);
            ROJO si el agua lo supera (invade bordo libre), ámbar si opera por debajo. */}
        {yDiseno != null && <line x1={(cx - halfDiseno).toFixed(1)} y1={yDiseno.toFixed(1)} x2={(cx + halfDiseno).toFixed(1)} y2={yDiseno.toFixed(1)} stroke={pctDiseno != null && pctDiseno > 100 ? '#ef4444' : '#d9a53a'} strokeWidth="1" strokeDasharray="2,2" opacity="0.85" />}
        {/* coronamiento del canal = límite físico de bordo; línea sólida tenue */}
        <line x1={xTopL.toFixed(1)} y1={yTopCanal.toFixed(1)} x2={xTopR.toFixed(1)} y2={yTopCanal.toFixed(1)} stroke={colorTramo} strokeWidth="0.6" opacity="0.55" />
        {/* marcador de sección COMPUESTA: el tramo cruza varias secciones-tipo
            reales; se dibuja la dominante. Aviso «≠N» arriba a la derecha. */}
        {compuesto && (
          <>
            <title>{`Tramo compuesto: cruza ${nSecciones} secciones-tipo del canal · se muestra la dominante`}</title>
            <text x={W - 3} y={PTtop + 2} fill="#f59e0b" fontSize="9" fontFamily="monospace" textAnchor="end" fontWeight="bold">≠{nSecciones}</text>
          </>
        )}
        {/* etiquetas */}
        {/* Nombre del tramo en dos líneas (origen / →destino) para poder usar texto de ≥10 px */}
        <text x={cx} y={H - 30} fill="#cbd5e1" fontSize="10.5" fontFamily="monospace" textAnchor="middle">{etiqueta.split('→')[0]}</text>
        <text x={cx} y={H - 17} fill="#cbd5e1" fontSize="10.5" fontFamily="monospace" textAnchor="middle">→{etiqueta.split('→')[1] ?? ''}</text>
        <text x={cx} y={H - 4} fill={colEstado} fontSize="10" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
          {pctDiseno != null ? `${Math.round(pctDiseno)}% ${label}${icon ? ' ' + icon : ''}` : (tiranteActual != null ? `${tiranteActual.toFixed(2)} m` : 's/d')}
        </text>
      </svg>
    </button>
  );
};

// ── Modal de detalle de tramo ───────────────────────────────────────────────
// Ficha técnica completa al hacer clic en una sección: identificación,
// geometría del canal (plantilla, talud, espejo, área), volumen (actual/mín/máx/Δ),
// estado hidráulico (tirante vs diseño, margen a bordo) y mini-tendencia.
const ModalTramo: React.FC<{ tramo: SerieTramo; color: string; t0: number; t1: number; onClose: () => void }>
= ({ tramo, color, t0, t1, onClose }) => {
  const { estado, etiqueta, km_up, km_down } = tramo;
  const { tiranteActual, pctDiseno, plantilla: b, talud: z, tiranteDiseno,
          bordoLibre, alturaCanal, pctBordo, anchoCorona, nSecciones, esTrapezoidal,
          longitudKm, nivelUpActual, nivelDownActual } = estado;
  const vac = React.useContext(VaciadoCtx);
  const { color: colEstado, label, icon } = estadoLlenado(pctDiseno, vac);
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
  // Margen al tirante de diseño (holgura de operación normal) y margen al
  // coronamiento real del canal (seguridad física ante desbordamiento).
  const margenDiseno = tiranteDiseno != null && tiranteActual != null ? +(tiranteDiseno - tiranteActual).toFixed(2) : null;
  const margenBordo = alturaCanal != null && tiranteActual != null ? +(alturaCanal - tiranteActual).toFixed(2) : null;

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
              <Fila k="Altura del canal" v={alturaCanal != null ? <><b>{alturaCanal.toFixed(2)}</b> m</> : 's/dato'} />
              <Fila k="Bordo libre (diseño)" v={bordoLibre != null ? `${bordoLibre.toFixed(2)} m` : 's/dato'} />
              <Fila k="Ancho de corona (C)" v={anchoCorona != null ? `${anchoCorona.toFixed(2)} m` : 's/dato'} />
              <Fila k="Longitud del tramo" v={<><b>{longitudKm.toFixed(3)}</b> km</>} />
              {nSecciones > 1 && <Fila k="Secciones-tipo que cruza" v={<span style={{ color: '#f59e0b' }}>≠ {nSecciones} · se muestra la dominante</span>} />}
            </section>

            {/* Estado hidráulico */}
            <section>
              <h5>Estado hidráulico</h5>
              <Fila k="Tirante actual" v={tiranteActual != null ? <><b>{tiranteActual.toFixed(2)}</b> m</> : '—'} />
              <Fila k="Tirante de diseño" v={tiranteDiseno != null ? `${tiranteDiseno.toFixed(2)} m` : 's/dato'} />
              <Fila k="% de la altura del canal" v={pctBordo != null ? `${pctBordo.toFixed(0)} %` : '—'}
                    c={pctBordo != null ? (pctBordo > 92 ? '#ef4444' : pctBordo > 75 ? '#f59e0b' : '#22c55e') : undefined} />
              <Fila k="Tirante frontera aguas arriba" v={nivelUpActual != null ? <>{nivelUpActual.toFixed(2)} m <em className="tnd-modal-tag">abajo de {tramo.etiqueta.split('→')[0]}</em></> : '—'} />
              <Fila k="Tirante frontera aguas abajo" v={nivelDownActual != null ? <>{nivelDownActual.toFixed(2)} m <em className="tnd-modal-tag">arriba de {tramo.etiqueta.split('→')[1]}</em></> : '—'} />
              <Fila k="Margen al diseño" v={margenDiseno != null ? `${margenDiseno.toFixed(2)} m` : '—'}
                    c={margenDiseno != null && margenDiseno < 0 ? '#f59e0b' : undefined} />
              <Fila k="Margen a coronamiento" v={margenBordo != null ? `${margenBordo.toFixed(2)} m` : '—'}
                    c={margenBordo != null && margenBordo < 0.15 ? '#ef4444' : undefined} />
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
  error?: string | null;
  onReintentar?: () => void;
  rangoDesde: string; rangoHasta: string;
  granularidad: 'diaria' | 'lectura';
  onRango: (desde: string, hasta: string) => void;
  onGranularidad: (g: 'diaria' | 'lectura') => void;
  niveles: SerieEscala[];
  volTramos: SerieTramo[];
  volTotal: SeriePunto[];
  compuertas: SerieCompuerta[];
  gasto: SerieGasto;
  /** Inicio (YYYY-MM-DD) del VACIADO activo; null/undefined si no hay. */
  vaciadoDesde?: string | null;
}

const TendenciasPanel: React.FC<Props> = ({
  loading, error, onReintentar, rangoDesde, rangoHasta, granularidad, onRango, onGranularidad,
  niveles, volTramos, volTotal, compuertas, gasto, vaciadoDesde,
}) => {
  // El rango incluye días de vaciado → el estado actual del canal es 'vaciado'.
  const enVaciado = !!vaciadoDesde && rangoHasta >= vaciadoDesde;
  const periodoMixto = enVaciado && rangoDesde < (vaciadoDesde as string);
  const vaciadoLbl = vaciadoDesde
    ? new Date(`${vaciadoDesde}T12:00:00-06:00`).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' })
    : '';
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

  // Escalas en orden de recorrido del canal (K-0 → K-104) y su color SECUENCIAL por posición.
  const nivelesOrd = useMemo(() => [...niveles].sort((a, b) => a.km - b.km), [niveles]);
  const colorEsc = useCallback((id: string) => {
    const i = nivelesOrd.findIndex(s => s.escala_id === id);
    return colorKm(i < 0 ? 0 : i, nivelesOrd.length);
  }, [nivelesOrd]);
  // Vista del Bloque 1: una mini-gráfica por escala (default) o comparadas en una sola gráfica.
  const [vistaNiveles, setVistaNiveles] = useState<'escalas' | 'comparar'>(() => {
    try { return localStorage.getItem('tnd:vista') === 'comparar' ? 'comparar' : 'escalas'; } catch { return 'escalas'; }
  });
  useEffect(() => { try { localStorage.setItem('tnd:vista', vistaNiveles); } catch { /* sin almacenamiento */ } }, [vistaNiveles]);
  // Compuerta mostrada en el Bloque 3 (antes siempre la primera, arbitraria): por defecto la primera con control.
  const [compSelId, setCompSelId] = useState<string | null>(null);
  const compGraf = compuertas.find(c => c.escala_id === compSelId) ?? compuertas.find(c => !c.esReferencia) ?? compuertas[0];
  // Anotación en las gráficas de tiempo: cierre de presa / inicio del vaciado.
  const eventosGraf = useMemo<EventoMarca[]>(() => vaciadoDesde
    ? [{ t: new Date(`${vaciadoDesde}T12:00:00-06:00`).getTime(), label: 'Cierre de presa · vaciado' }] : [], [vaciadoDesde]);
  // Eje Y común de la vista por escala: hasta el mayor entre datos y máximo operativo, con ticks redondos.
  const yTopMini = useMemo(() => {
    let m = 1;
    for (const s of niveles) {
      if (!esVisible(s.escala_id)) continue;
      for (const p of s.puntos) if (p.y != null && p.y > m) m = p.y;
      if (s.nivelMax != null && isFinite(s.nivelMax) && s.nivelMax > m) m = s.nivelMax;
    }
    return niceTicks(0, m * 1.04, 4).hi;
  }, [niveles, esVisible]);
  // Resumen ejecutivo: lo que el operador quiere saber antes de leer las gráficas.
  const kpis = useMemo(() => {
    const ult = (pts: SeriePunto[]) => { for (let i = pts.length - 1; i >= 0; i--) if (pts[i].y != null) return pts[i]; return null; };
    const prim = (pts: SeriePunto[]) => pts.find(p => p.y != null) ?? null;
    const vt = ult(volTotal), v0 = prim(volTotal), q = ult(gasto.entrada);
    let sobre = 0, conDato = 0, ultimoT = 0;
    for (const s of niveles) {
      const u = ult(s.puntos);
      if (!u) continue;
      conDato++;
      if (u.t > ultimoT) ultimoT = u.t;
      if (s.nivelMax != null && (u.y as number) > s.nivelMax) sobre++;
    }
    return {
      vol: vt ? (vt.y as number) : null,
      volDelta: vt && v0 ? (vt.y as number) - (v0.y as number) : null,
      volParcial: !!vt?.est,
      q: q ? (q.y as number) : null, qT: q ? q.t : null,
      sobre, conDato, ultimoT,
    };
  }, [niveles, volTotal, gasto.entrada]);

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

  // Líneas de nivel máximo operativo: una por valor ÚNICO entre las escalas visibles (el máximo suele ser común,
  // p.ej. 3.4 m), así siempre hay referencia aunque se vean las 14 escalas.
  const bandasNivelMax = useMemo(() => {
    const vals = new Set<number>();
    for (const s of niveles) if (esVisible(s.escala_id) && s.nivelMax != null && isFinite(s.nivelMax)) vals.add(+s.nivelMax.toFixed(2));
    return [...vals].sort((a, b) => b - a).slice(0, 3).map(y => ({ y, label: `máx. operativo ${y.toFixed(2)} m`, color: '#f87171' }));
  }, [niveles, esVisible]);

  // Escala común de la tira de secciones: mayor espejo de agua (a la altura del
  // canal) y mayor tirante entre TODOS los tramos. Así cada sección se dibuja a
  // escala real y sus dimensiones son comparables entre tramos (canal cónico:
  // ancho en cabecera > cola). Un +6 % de holgura evita que el mayor toque el borde.
  const escalaSeccion = useMemo<EscalaSeccion>(() => {
    let anchoMax = 1, tiranteMax = 1;
    for (const tr of volTramos) {
      const e = tr.estado;
      // La altura de referencia es la altura FÍSICA del canal (coronamiento),
      // para que el bordo libre completo quepa en el lienzo y las secciones sean
      // comparables por su tamaño real. El agua actual puede acercarse pero no supera.
      const hRef = Math.max(e.alturaCanal ?? e.tiranteDiseno ?? e.tiranteActual ?? 0, e.tiranteActual ?? 0);
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
    const hasta = getTodayString();
    const desde = addDays(hasta, -dias);
    onRango(desde, hasta);
  };
  // "Hoy": tendencia intradía — solo lecturas capturadas en la fecha de hoy.
  // Fuerza granularidad "Por lectura": "Diaria" colapsa el día a un único punto
  // (resumen_escalas_diario) y no puede mostrar variación dentro del mismo día.
  const presetHoy = () => {
    const hoy = getTodayString();
    onRango(hoy, hoy);
    if (granularidad !== 'lectura') onGranularidad('lectura');
  };
  const esHoy = rangoDesde === rangoHasta && rangoDesde === getTodayString();

  // Informe de análisis (Bloque 1-4): usa las mismas escalas ya filtradas por
  // "Punto de control" (Todas/Solo control de Q/Ninguna) que se ven en pantalla,
  // así el PDF exportado coincide exactamente con lo que el operador está viendo.
  const [showInforme, setShowInforme] = useState(false);
  const nivelesInforme = useMemo(() => niveles.filter(s => esVisible(s.escala_id)), [niveles, esVisible]);
  const filtroLabel = visNiveles == null ? 'todas las escalas' : nVisibles === 0 ? 'ninguna escala' : `${nVisibles} de ${niveles.length} escalas`;

  return (
    <VaciadoCtx.Provider value={enVaciado}>
    <div className="tnd-root">
      {/* Controles */}
      <div className="tnd-controls">
        <div className="tnd-dates">
          <label>Desde <input type="date" value={rangoDesde} max={rangoHasta} onChange={e => onRango(e.target.value, rangoHasta)} /></label>
          <label>Hasta <input type="date" value={rangoHasta} min={rangoDesde} onChange={e => onRango(rangoDesde, e.target.value)} /></label>
        </div>
        <div className="tnd-presets">
          <button type="button" className={esHoy ? 'on' : ''} onClick={presetHoy}>Hoy</button>
          <button type="button" onClick={() => preset(7)}>7 d</button>
          <button type="button" onClick={() => preset(30)}>30 d</button>
          <button type="button" onClick={() => preset(90)}>90 d</button>
        </div>
        {esHoy && (
          <span className="tnd-live" title="Se actualiza automáticamente con nuevas lecturas del día">
            <i /> EN VIVO — actualiza c/90 s
          </span>
        )}
        <div className="tnd-gran">
          <button type="button" className={granularidad === 'diaria' ? 'on' : ''} onClick={() => onGranularidad('diaria')}>Diaria</button>
          <button type="button" className={granularidad === 'lectura' ? 'on' : ''} onClick={() => onGranularidad('lectura')}>Por lectura</button>
        </div>
        <button type="button" className="tnd-btn-analisis" onClick={() => setShowInforme(true)} disabled={loading}>
          <FileBarChart size={13} /> Análisis
        </button>
      </div>

      {enVaciado && (
        <div className="tnd-note tnd-vaciado" role="status">
          <strong>Canal en VACIADO desde {vaciadoLbl}.</strong> Los niveles bajos y el descenso son lo esperado, no desabasto.
          {periodoMixto && ' El periodo mezcla operación y vaciado: los Δ y promedios no son comparables entre ambas etapas.'}
          {' '}Escalas de referencia sin lectura de campo se muestran como S/D.
        </div>
      )}

      {loading && (
        <>
          <TndBlockSkeleton titulo="Tendencia de niveles por escala" color="#3987e5" height={168} />
          <TndBlockSkeleton titulo="Volumen por tramo" color="#199e70" height={170} />
          <TndBlockSkeleton titulo="Niveles arriba / abajo por compuerta" color="#c98500" height={120} />
          <TndBlockSkeleton titulo="Gasto: K-0+000 → entregas a módulos → K-104" color="#9085e9" height={168} />
        </>
      )}

      {!loading && error && (
        <div className="tnd-error">
          <span>No se pudo cargar el periodo. {error}</span>
          {onReintentar && (
            <button type="button" className="tnd-btn-reintentar" onClick={onReintentar}>Reintentar</button>
          )}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Resumen ejecutivo ── */}
          <div className="tnd-kpis">
            <div className="tnd-kpi">
              <span>Volumen en canal</span>
              <b>{kpis.vol != null ? `${kpis.vol.toFixed(2)} Mm³` : 'S/D'}</b>
              <small>{kpis.volDelta != null ? `${kpis.volDelta > 0 ? '▲' : kpis.volDelta < 0 ? '▼' : '■'} ${Math.abs(kpis.volDelta).toFixed(2)} en el periodo` : 'sin dato'}{kpis.volParcial ? ' · parcial' : ''}</small>
            </div>
            <div className="tnd-kpi">
              <span>Q entrada K-0</span>
              <b>{kpis.q != null ? `${kpis.q.toFixed(2)} m³/s` : 'S/D'}</b>
              <small>{kpis.qT != null ? new Date(kpis.qT).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' }) : 'sin lectura en el rango'}</small>
            </div>
            <div className="tnd-kpi">
              <span>Sobre máx. operativo</span>
              <b style={{ color: kpis.sobre > 0 ? '#f87171' : undefined }}>{kpis.sobre} de {kpis.conDato}</b>
              <small>escalas, con su último dato</small>
            </div>
            <div className="tnd-kpi">
              <span>Último dato</span>
              <b>{kpis.ultimoT ? new Date(kpis.ultimoT).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Chihuahua' }) : 'S/D'}</b>
              <small>{kpis.conDato} escalas con lectura</small>
            </div>
          </div>

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
            <div className="tnd-seg" role="group" aria-label="Vista de niveles">
              <button type="button" className={vistaNiveles === 'escalas' ? 'on' : ''} aria-pressed={vistaNiveles === 'escalas'} onClick={() => setVistaNiveles('escalas')}>Por escala</button>
              <button type="button" className={vistaNiveles === 'comparar' ? 'on' : ''} aria-pressed={vistaNiveles === 'comparar'} onClick={() => setVistaNiveles('comparar')}>Comparar</button>
            </div>
            {vistaNiveles === 'escalas' ? (
              <>
                <div className="tnd-mini-grid">
                  {nivelesOrd.filter(s => esVisible(s.escala_id)).map(s => (
                    <MiniNivel key={s.escala_id} serie={s} t0={t0} t1={t1} yTop={yTopMini}
                      esRef={ESC_SIN_CONTROL.has(s.nombre)}
                      onSel={() => { soloNivel(s.escala_id); setVistaNiveles('comparar'); }} />
                  ))}
                </div>
                <div className="tnd-band-hint">Eje común 0–{yTopMini.toFixed(1)} m · línea roja discontinua = nivel máximo operativo · toca una escala para verla en detalle</div>
              </>
            ) : (
              <>
                <MultiLine
                  series={nivelesOrd.filter(s => esVisible(s.escala_id)).map(s => ({ nombre: s.nombre, puntos: s.puntos, color: colorEsc(s.escala_id) }))}
                  t0={t0} t1={t1} yLabel="Nivel (m)" height={230}
                  bands={bandasNivelMax} eventos={eventosGraf} nonNegative dimOthers
                />
                <div className="tnd-band-hint">Color = posición en el canal (claro: cabecera → oscuro: cola) · apunta una línea para resaltarla · línea discontinua = nivel máximo operativo</div>
              </>
            )}
            <div className="tnd-legend tnd-legend-int" role="group" aria-label="Filtro de escalas visibles">
              {nivelesOrd.map(s => {
                const on = esVisible(s.escala_id);
                return (
                  <button type="button" key={s.escala_id} className={`tnd-chip${on ? '' : ' off'}`}
                    onClick={() => toggleNivel(s.escala_id)}
                    onDoubleClick={() => soloNivel(s.escala_id)}
                    aria-pressed={on}
                    title={on ? `Ocultar ${s.nombre} (doble clic: solo)` : `Mostrar ${s.nombre}`}>
                    <i style={{ background: colorEsc(s.escala_id) }} />{s.nombre}
                  </button>
                );
              })}
            </div>
            <div className="dsk-table-wrap">
              <table className="dsk-table tnd-table-int">
                <thead><tr><th>Escala</th><th>Actual</th><th>Mín</th><th>Máx</th><th>Prom</th><th>Δ periodo</th><th>Lect.</th><th aria-label="Aislar" /></tr></thead>
                <tbody>
                  {nivelesOrd.map(s => { const st = statsSerie(s.puntos); const on = esVisible(s.escala_id); const actual = [...s.puntos].reverse().find(p => p.y != null)?.y ?? null; return (
                    <tr key={s.escala_id} className={`tnd-row${on ? '' : ' off'}`}
                        onClick={() => toggleNivel(s.escala_id)}
                        title={on ? `Ocultar ${s.nombre}` : `Mostrar ${s.nombre}`}>
                      <td style={{ fontWeight: 700 }}>
                        <span className="tnd-swatch" style={{ background: colorEsc(s.escala_id), opacity: on ? 1 : 0.3 }} />{s.nombre}
                      </td>
                      <td style={{ fontWeight: 700, color: s.nivelMax != null && actual != null && actual > s.nivelMax ? '#f87171' : undefined }}>{n2(actual)}</td>
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
                <div className="tnd-secline">Estado del canal — sección transversal REAL por tramo (altura del revestimiento a escala; franja gris = bordo libre; línea ─── = tirante de diseño). Tirante por tramo = nivel aguas abajo de la escala inicial → nivel aguas arriba de la final (modelo de compuertas).</div>
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
                  Toca un tramo para aislarlo en el apilado · el color de cada sección = su banda · <span style={{ color: '#f59e0b' }}>◆</span> día estimado (tramo sin aforo, arrastra último dato)
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

            <StackedArea series={volTramos} t0={t0} t1={t1} height={220}
              selKey={tramoSel} onSelBand={toggleTramo} eventos={eventosGraf} />
            <div className="dsk-table-wrap">
              <table className="dsk-table">
                <thead><tr><th>Tramo</th><th>Vol mín</th><th>Vol máx</th><th>Δ Mm³</th><th>Tirante act.</th><th>% diseño</th></tr></thead>
                <tbody>
                  {volTramos.map(tr => { const st = statsSerie(tr.puntos); const { color, label } = estadoLlenado(tr.estado.pctDiseno, enVaciado); return (
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
                      <td style={{ fontWeight: 700 }}>{c.nombre}{c.esReferencia && <span style={{ fontSize: '0.55rem', fontWeight: 600, color: '#94a3b8' }} title="Escala de referencia: sin compuertas de control"> (ref.)</span>}</td>
                      <td>{n2(su.avg)}</td>
                      <td>{c.esReferencia ? <span style={{ color: '#94a3b8' }}>s/control</span> : n2(sd.avg)}</td>
                      <td style={{ color: c.esReferencia ? '#94a3b8' : '#c98500', fontWeight: 700 }}>{c.esReferencia ? '—' : n2(sdif.avg)}</td>
                      <td>{c.esReferencia ? '—' : n2(c.aperturaUlt)}</td><td>{c.esReferencia ? '—' : (c.puertasAbiertas ?? '—')}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            {compGraf && (
              <>
                <div className="tnd-filtro-bar">
                  <span className="tnd-filtro-lbl">Compuerta:</span>
                  <select className="tnd-select" value={compGraf.escala_id} onChange={e => setCompSelId(e.target.value)} aria-label="Compuerta a graficar">
                    {compuertas.filter(c => !c.esReferencia).map(c => <option key={c.escala_id} value={c.escala_id}>{c.nombre}</option>)}
                  </select>
                </div>
                <MultiLine
                  series={[
                    { nombre: 'H↑ aguas arriba', puntos: compGraf.arriba, color: '#5aa9ff' },
                    { nombre: 'H↓ aguas abajo', puntos: compGraf.abajo, color: '#fbbf24', dashed: true },
                  ]}
                  t0={t0} t1={t1} yLabel={`Niveles arriba/abajo — ${compGraf.nombre} (m)`} height={170}
                  nonNegative eventos={eventosGraf}
                />
              </>
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
              t0={t0} t1={t1} yLabel="Gasto (m³/s)" height={200} zeroLine eventos={eventosGraf}
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
            {enVaciado && (
              <div className="tnd-note">Desde {vaciadoLbl} (vaciado) las pérdidas quedan sin dato: las entregas salen del volumen almacenado y no de la entrada, así que Q₀ − Σentregas − Q₁₀₄ no es una pérdida (balance no conciliable).</div>
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

      {/* Informe de Análisis de Tendencias — PDF institucional */}
      {showInforme && (
        <InformeTendencias
          rangoDesde={rangoDesde} rangoHasta={rangoHasta} granularidad={granularidad}
          niveles={nivelesInforme} niveleslabel={filtroLabel}
          volTramos={volTramos} volTotal={volTotal}
          compuertas={compuertas} gasto={gasto} vaciadoDesde={vaciadoDesde}
          onClose={() => setShowInforme(false)}
        />
      )}
    </div>
    </VaciadoCtx.Provider>
  );
};

// React.memo: el panel vive dentro del PublicMonitor, que re-renderiza con el
// reloj interno (60 s) y cada refresh de datos del mapa. Sus props solo cambian
// cuando cambia el rango/granularidad o llegan series nuevas — con memo, los
// ticks del monitor no re-renderizan las gráficas.
export default React.memo(TendenciasPanel);
