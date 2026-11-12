import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDevice } from '../../../hooks/useDevice';
import { useCanalPerfil } from '../../../hooks/useDashboardPulso';
import { gastoMedio, textoGasto, type EstacionRed } from '../../../hooks/useHidrometriaCuenca';
import type { DatosCuerposAgua } from '../../../hooks/useCuerposAgua';
import { cargarCapas } from '../../../utils/capasCuenca';
import { agregadoCuenca, aportacionTotal, type EstadoUbicacion } from '../../../utils/aqwpCuenca';
import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';
import type { PoligonoGeo } from '../../../utils/geoCuenca';
import { etiquetaMes, ultimoCierreConDato, type CuerpoAgua } from '../../../utils/cuerposAgua';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { formatearNumero } from '../../../utils/historicoPresas';
import { ID_OJINAGA_IBWC, ID_OJINAGA_SUTRON, VENTANAS, fechaHoraLocal, textoEdad, type VentanaHidro } from '../../../utils/hidroEstaciones';
import { VENTANAS_OBS, arealDe, cuandoVentana, diasDeVentana, etiquetaVentana, puntosLluviaDe, type ModeloRedJcas, type VentanaObs } from '../../../utils/jcasModelo';
import { estadoEmbalse } from '../../../utils/presaNiveles';
import {
  CAPAS_SISTEMA, arcoEnRecorrido, disponerSistema, grosorDeGasto, idEstacion, lluviaEnDistrito, lluviaPorRegion, poligonosDeGeojson,
  recorridoDelAgua, regionDePunto, regionesDeSubcuencas, textoGastoTramo, todasLasCapasSistema,
  type ArcoSis, type CapaSistema, type LluviaRegion, type NodoSis, type RegionLluvia,
} from '../../../utils/sistemaCuenca';
import { GLIFO_ESTADO } from './TanquePresa';

const CLAVE_CAPAS = 'sica.cuenca.sistema.capas';
const GLIFO_ENLACE = { en_linea: '●', retraso: '◐', sin_transmision: '■', sd: '◇' } as const;
const f = formatearNumero;
const q2 = textoGastoTramo;
const diaCorto = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
const mesesEntre = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const fechaHoraMs = (ms: number | null) => (ms == null ? null : fechaHoraLocal(ms));

function capasIniciales(): CapaSistema[] {
  try {
    const t = window.localStorage.getItem(CLAVE_CAPAS);
    if (t == null) return todasLasCapasSistema();
    const validas = new Set<string>(todasLasCapasSistema());
    const a = JSON.parse(t);
    return Array.isArray(a) ? (a.filter((x) => typeof x === 'string' && validas.has(x)) as CapaSistema[]) : todasLasCapasSistema();
  } catch { return todasLasCapasSistema(); }
}

/** Un dato de la ventana de detalle: rótulo, valor y de dónde sale. */
function Hecho({ t, children, nota }: { t: string; children: ReactNode; nota?: string }) {
  return <div className="cu-sis-hecho"><dt>{t}</dt><dd>{children}{nota && <span className="cu-sis-hecho-nota">{nota}</span>}</dd></div>;
}
/** Barra de proporción (0-100 %) con marcas de referencia; decorativa: la cifra siempre va escrita al lado. */
function Barra({ pct, clase, marcas = [] }: { pct: number | null; clase: string; marcas?: number[] }) {
  return (
    <div className="cu-sis-barra" aria-hidden="true">
      {pct != null && <span className={`cu-sis-barra-v ${clase}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />}
      {marcas.map((m) => <span key={m} className="cu-sis-barra-m" style={{ left: `${m}%` }} />)}
    </div>
  );
}

/** Lectura de un vaso para el esquema: la del día (telemetría) si existe; si no, el último cierre mensual con su mes. */
interface LecturaVaso { alm: number | null; pct: number | null; cuando: string; sd: boolean; vencido: boolean }

interface Props {
  cuerpos: DatosCuerposAgua;
  modelos: PresaCuencaModelo[];
  estaciones: EstacionRed[];
  ventHidro: VentanaHidro;
  onVentHidro: (v: VentanaHidro) => void;
  /** Red de lluvia (JCAS + propias); null mientras carga o si falló: la capa de lluvia queda S/D. */
  lluvia: ModeloRedJcas | null;
  lluviaEstado: 'cargando' | 'error' | 'lista';
  ventanaObs: VentanaObs;
  onVentanaObs: (v: VentanaObs) => void;
  ojinaga: EstadoUbicacion | null;
  /** Gasto medio de 30 días del aforo oficial de Ojinaga; null = S/D. */
  salidaMedia30: number | null;
  onIr: (pestana: 'presas' | 'vasos' | 'clima', ubicacionId?: number) => void;
}

/**
 * «El agua en la cuenca»: sinóptico interactivo del recorrido del agua, de la lluvia que registran las estaciones climatológicas a
 * la salida en Ojinaga, pasando por los ríos, las estaciones hidrométricas, los vasos y el Distrito de Riego 005.
 * Cada elemento es un botón que abre su ventana de detalle y resalta su recorrido (lo que le llega y lo que alimenta). Las capas
 * se encienden o apagan. Todo es dato ya publicado en otras partes de SICA: aquí solo se ordena; lo que no se mide dice S/D.
 */
export default function SistemaCuenca({ cuerpos, modelos, estaciones, ventHidro, onVentHidro, lluvia, lluviaEstado, ventanaObs, onVentanaObs, ojinaga, salidaMedia30, onIr }: Props) {
  const uid = useId().replace(/:/g, '');
  const { esPhone } = useDevice();
  const canal = useCanalPerfil(false);
  const [capas, setCapas] = useState<CapaSistema[]>(capasIniciales);
  const [sel, setSel] = useState<string | null>(null);
  const [regiones, setRegiones] = useState<RegionLluvia[]>([]);
  const [distrito, setDistrito] = useState<PoligonoGeo[]>([]);
  const ventanaRef = useRef<HTMLDivElement | null>(null);
  const origenRef = useRef<SVGGElement | null>(null);
  const marcoRef = useRef<HTMLDivElement | null>(null);
  // El esquema es más ancho que el marco en pantallas medianas: se avisa para que se vea hasta el Río Bravo.
  const [desborda, setDesborda] = useState(false);
  useEffect(() => {
    const el = marcoRef.current;
    if (!el) return;
    const mide = () => setDesborda(el.scrollWidth - el.clientWidth > 8);
    mide();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(mide);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let vivo = true;
    cargarCapas(['subcuencas']).then((d) => { if (vivo) setRegiones(regionesDeSubcuencas(d.subcuencas)); });
    // Poligonal del distrito (sus módulos): las estaciones de dentro son lluvia del distrito, no de la región que lo rodea.
    fetch('/geo/modulos.geojson').then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo) setDistrito(poligonosDeGeojson(j)); }).catch(() => { /* sin poligonal: la lluvia del distrito queda S/D */ });
    return () => { vivo = false; };
  }, []);

  const con = useCallback((c: CapaSistema) => capas.includes(c), [capas]);
  const alternar = (c: CapaSistema) => {
    const n = capas.includes(c) ? capas.filter((x) => x !== c) : [...capas, c];
    setCapas(n);
    try { window.localStorage.setItem(CLAVE_CAPAS, JSON.stringify(n)); } catch { /* sin almacenamiento: no se recuerda */ }
  };

  const regionDeCuerpo = useMemo(() => new Map(cuerpos.cuerpos.map((c) => [c.id, regionDePunto(regiones, c.lon, c.lat)])), [cuerpos.cuerpos, regiones]);
  const sitios = useMemo(() => estaciones.map((e) => ({ id: e.est.id, rol: e.sitio.rol, presaId: e.sitio.presaId })), [estaciones]);
  const dis = useMemo(() => disponerSistema(cuerpos.cuerpos, regiones, regionDeCuerpo, sitios), [cuerpos.cuerpos, regiones, regionDeCuerpo, sitios]);

  const puntosLluvia = useMemo(() => (lluvia ? puntosLluviaDe(lluvia.puntos, lluvia.propias, ventanaObs) : []), [lluvia, ventanaObs]);
  const lluviaReg = useMemo(() => {
    const m = new Map<string, LluviaRegion>();
    if (!lluvia || !regiones.length) return m;
    for (const r of lluviaPorRegion(regiones, puntosLluvia, diasDeVentana(ventanaObs, lluvia.fin), distrito)) m.set(r.region.clave, r);
    return m;
  }, [lluvia, regiones, ventanaObs, puntosLluvia, distrito]);
  const lluviaDist = useMemo(() => (distrito.length && lluvia ? lluviaEnDistrito(distrito, puntosLluvia) : null), [distrito, lluvia, puntosLluvia]);

  const modeloDe = useMemo(() => new Map(modelos.map((m) => [m.fila.ubicacionId, m])), [modelos]);
  const estDe = useMemo(() => new Map(estaciones.map((e) => [e.est.id, e])), [estaciones]);
  const ultimo = useMemo(() => new Map(cuerpos.cuerpos.map((c) => [c.id, ultimoCierreConDato(cuerpos.cierres.filter((x) => x.cuerpoId === c.id))])), [cuerpos]);
  const mesActual = useMemo(() => [...ultimo.values()].reduce((m, u) => (u && u.mes > m ? u.mes : m), ''), [ultimo]);

  const modeloCuerpo = (c: CuerpoAgua) => (c.aqwpUbicacionId == null ? undefined : modeloDe.get(c.aqwpUbicacionId));
  const lecturaVaso = (c: CuerpoAgua): LecturaVaso => {
    const fila = modeloCuerpo(c)?.fila, u = ultimo.get(c.id) ?? null;
    const delDia = fila != null && fila.almacenamientoValido != null && fila.fecha != null && (u == null || fila.fecha > u.fechaCierre);
    if (delDia) return { alm: fila.almacenamientoValido, pct: fila.pct, cuando: `dato del ${diaCorto(fila.fecha as string)}`, sd: false, vencido: false };
    // Un cierre de hace más de 2 meses respecto al más reciente de la cuenca ya no describe el estado actual: se rotula «último dato».
    const vencido = u != null && mesesEntre(u.mes, mesActual) > 2;
    return {
      alm: u?.almMm3 ?? null, pct: u?.pctNamo ?? null, vencido, sd: u == null || vencido,
      cuando: u == null ? (c.rol === 'reguladora' ? 'reguladora · sin dato' : 'sin cierre con dato') : `${vencido ? 'último dato' : 'cierre'} ${etiquetaMes(u.mes, true)}`,
    };
  };

  // Canal Principal Conchos: gasto vigente en los extremos (medición de campo ≤ 240 min); si no, el último aforo con su fecha.
  const cm = canal.modelo;
  const k0 = cm.k0, k104 = cm.k104;

  const ibwc = estDe.get(ID_OJINAGA_IBWC), sutron = estDe.get(ID_OJINAGA_SUTRON);

  /** Gasto (m³/s) de cada tramo. null = sin medición (S/D); nunca se rellena con 0. */
  const gastoArco = (a: ArcoSis): number | null => {
    if (a.tipo === 'rio') { const c = cuerpos.cuerpos.find((x) => x.id === a.de); return c ? modeloCuerpo(c)?.fila.extraccionTotalM3s ?? null : null; }
    if (a.tipo === 'aforo') { const e = estaciones.find((x) => idEstacion(x.est.id) === a.de); return e ? gastoMedio(e.stat) : null; }
    if (a.tipo === 'canal') return dis?.toma != null && a.de === dis.toma.cuerpoId ? k0.gasto : null;
    return null;
  };

  const filas = modelos.map((m) => m.fila);
  const agregado = agregadoCuenca(filas), aport = aportacionTotal(filas);
  const extr = (() => { const v = filas.map((x) => x.extraccionTotalM3s).filter((x): x is number => x != null); return { total: v.length ? v.reduce((a, b) => a + b, 0) : null, conDato: v.length }; })();
  const arealCuenca = lluvia ? arealDe(lluvia, ventanaObs) : null;
  const qSalida = ojinaga?.gastoM3s ?? null;

  const qMax = dis ? Math.max(1, qSalida ?? 0, ...dis.arcos.map((a) => gastoArco(a) ?? 0)) : 1;
  const mmMax = Math.max(1, ...[...lluviaReg.values()].map((r) => r.areal.mm ?? 0));
  const rec = useMemo(() => (dis && sel ? recorridoDelAgua(dis.enlaces, sel) : null), [dis, sel]);

  const cerrar = useCallback(() => { setSel(null); origenRef.current?.focus?.(); }, []);
  useEffect(() => {
    if (!sel) return;
    const el = ventanaRef.current;
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
  }, [sel, esPhone]);

  if (!dis) return null;
  const visible = (n: NodoSis) => (n.tipo === 'lluvia' ? con('lluvia') : n.tipo === 'estacion' ? con('hidro') : n.tipo === 'distrito' ? con('distrito') : n.tipo === 'presa' ? con('presas') : true);
  const nodoPor = new Map(dis.nodos.map((n) => [n.id, n]));
  const arcoVisible = (a: ArcoSis) => (a.tipo === 'lluvia' ? con('lluvia') && visible(nodoPor.get(a.a) as NodoSis) : a.tipo === 'canal' ? con('distrito') : a.tipo === 'aforo' ? con('hidro') : true);
  const seleccionado = sel ? nodoPor.get(sel) ?? null : null;
  const selVisible = seleccionado && visible(seleccionado) ? seleccionado : null;
  const atenuado = (id: string) => (rec != null && selVisible != null && !rec.has(id) ? ' cu-sis-atenuado' : '');

  const activar = (id: string, g: SVGGElement | null) => { origenRef.current = g; setSel((s) => (s === id ? null : id)); };
  const propsNodo = (n: NodoSis, etiqueta: string, apagado = false) => ({
    role: 'button', tabIndex: 0, 'aria-label': `${etiqueta}. Abrir detalle`, 'aria-pressed': sel === n.id,
    className: `cu-sis-nodo cu-sis-nodo--${n.tipo}${sel === n.id ? ' cu-sis-nodo--sel' : ''}${apagado ? ' cu-sis-nodo--apagado' : ''}${atenuado(n.id)}`,
    transform: `translate(${n.x} ${n.y})`,
    onClick: (e: { currentTarget: SVGGElement; stopPropagation: () => void }) => { e.stopPropagation(); activar(n.id, e.currentTarget); },
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activar(n.id, e.currentTarget); }
      else if (e.key === 'Escape' && sel) { e.preventDefault(); cerrar(); }
    },
  });

  // ── Nodos ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const dibujaPresa = (n: NodoSis) => {
    const c = n.cuerpo as CuerpoAgua, l = lecturaVaso(c), fila = modeloCuerpo(c)?.fila;
    const est = estadoEmbalse(l.sd ? null : l.pct);
    const lleno = l.sd || l.pct == null ? 0 : Math.max(0, Math.min(100, l.pct)) / 100;
    const flujo = con('gastos') && fila ? `entra ${q2(fila.aportacionM3s)} · sale ${q2(fila.extraccionTotalM3s)}` : l.cuando;
    const voz = `${c.etiqueta}: ${l.alm == null ? 'sin dato' : `${f(l.alm, 1)} millones de metros cúbicos, ${l.pct == null ? 'porcentaje sin dato' : `${f(l.pct, 1)} por ciento del NAMO`}`}, ${l.cuando}`;
    return (
      <g key={n.id} {...propsNodo(n, voz, l.sd)}>
        {!l.sd && <rect width={n.w} height={n.h} rx="10" className={`cu-sis-pulso cu-sis-pulso--${est.clave}`} aria-hidden="true" />}
        <rect width={n.w} height={n.h} rx="10" className={`cu-sis-caja cu-sis-caja--${l.sd ? 'sd' : est.clave}`} />
        <rect x="5" y="7" width="4" height={n.h - 14} rx="2" className="cu-sis-nivel-pista" />
        {lleno > 0 && <rect x="5" y={7 + (n.h - 14) * (1 - lleno)} width="4" height={(n.h - 14) * lleno} rx="2" className={`cu-sis-nivel cu-sis-nivel--${est.clave}`} />}
        <text x="16" y="19" className="cu-sis-t1">{c.etiqueta}</text>
        <text x="16" y="37" className="cu-sis-t2">
          {l.alm == null ? 'S/D' : <><tspan aria-hidden="true">{GLIFO_ESTADO[est.clave]} </tspan>{l.pct == null ? 'S/D' : `${f(l.pct, 1)} %`}{` · ${f(l.alm, l.alm >= 100 ? 0 : 1)} Mm³`}</>}
        </text>
        <text x="16" y="52" className="cu-sis-t3">{flujo}</text>
      </g>
    );
  };

  const dibujaLluvia = (n: NodoSis) => {
    const r = lluviaReg.get(n.region as string), reg = regiones.find((x) => x.clave === n.region) as RegionLluvia;
    const mm = r?.areal.mm ?? null;
    const tinte = mm == null ? 0 : 0.08 + 0.3 * Math.min(1, mm / mmMax);
    const pie = lluviaEstado === 'cargando' ? 'cargando…' : lluviaEstado === 'error' ? 'red de lluvia sin cargar' : `${r?.dentro.length ?? 0} est. dentro · ${etiquetaVentana(ventanaObs)}`;
    return (
      <g key={n.id} {...propsNodo(n, `Lluvia en ${reg.nombre}: ${mm == null ? 'sin dato' : `${fmtLluvia(mm)} milímetros`}, ${cuandoVentana(ventanaObs)}`, mm == null)}>
        <rect width={n.w} height={n.h} rx="14" className={`cu-sis-caja cu-sis-caja--lluvia${mm == null ? ' cu-sis-caja--sd' : ''}`} style={{ fillOpacity: tinte }} />
        <path d={`M${n.w - 26},27 l-4,9 M${n.w - 18},27 l-4,9 M${n.w - 10},27 l-4,9`} className="cu-sis-gotas" aria-hidden="true" />
        <text x="11" y="19" className="cu-sis-t1">{reg.nombre}</text>
        <text x="11" y="38" className="cu-sis-t2 cu-sis-t2--g">{mm == null ? 'S/D' : `${fmtLluvia(mm)} mm`}</text>
        <text x="11" y="52" className="cu-sis-t3">{pie}</text>
      </g>
    );
  };

  const dibujaEstacion = (n: NodoSis) => {
    const e = estDe.get(n.estacionId as string);
    if (!e) return null;
    const q = textoGasto(e.stat, 1), enLinea = e.enlace.clave === 'en_linea' || e.enlace.clave === 'retraso';
    return (
      <g key={n.id} {...propsNodo(n, `Estación hidrométrica ${e.sitio.corto}, ${e.sitio.tramo}: ${q === 'S/D' ? 'sin dato' : `${q} metros cúbicos por segundo`}, ${e.enlace.etiqueta}`, !enLinea || q === 'S/D')}>
        {enLinea && q !== 'S/D' && <rect width={n.w} height={n.h} rx={n.h / 2} className="cu-sis-pulso cu-sis-pulso--est" aria-hidden="true" />}
        <rect width={n.w} height={n.h} rx={n.h / 2} className={`cu-sis-caja cu-sis-caja--est${enLinea ? '' : ' cu-sis-caja--est-off'}`} />
        <text x={n.w / 2} y="15" textAnchor="middle" className="cu-sis-e1"><tspan aria-hidden="true">{GLIFO_ENLACE[e.enlace.clave]} </tspan>{e.sitio.corto}</text>
        <text x={n.w / 2} y="29" textAnchor="middle" className="cu-sis-e2">{q === 'S/D' ? 'S/D' : `${q} m³/s`}</text>
      </g>
    );
  };

  const dibujaDistrito = (n: NodoSis) => {
    const medio = n.h / 2 - (con('lluvia') ? 8 : 0);
    const txtK0 = k0.gasto != null ? `${q2(k0.gasto)} m³/s` : 'S/D';
    return (
      <g key={n.id} {...propsNodo(n, `Distrito de Riego 005: entrada en K-0 ${k0.gasto == null ? 'sin medición vigente' : `${q2(k0.gasto)} metros cúbicos por segundo`}`)}>
        <rect width={n.w} height={n.h} rx="12" className="cu-sis-caja cu-sis-caja--distrito" />
        <text x={n.w / 2} y={medio - 9} textAnchor="middle" className="cu-sis-t1">Distrito 005</text>
        <text x={n.w / 2} y={medio + 7} textAnchor="middle" className="cu-sis-e2">K-0 {txtK0}</text>
        <text x={n.w / 2} y={medio + 21} textAnchor="middle" className="cu-sis-e2">K-104 {k104.gasto != null ? `${q2(k104.gasto)} m³/s` : 'S/D'}</text>
        {con('lluvia') && <text x={n.w / 2} y={medio + 38} textAnchor="middle" className="cu-sis-t3 cu-sis-t3--lluvia">lluvia {lluviaDist?.mm == null ? 'S/D' : `${fmtLluvia(lluviaDist.mm)} mm`} · {lluviaDist?.dentro.length ?? 0} est.</text>}
      </g>
    );
  };

  const dibujaConfluencia = (n: NodoSis) => {
    const k = n.confluencia!;
    return (
      <g key={n.id} {...propsNodo(n, `Confluencia del ${k.afluente} con el río Conchos, ${k.cerca}`)}>
        <circle cx={n.w / 2} cy={n.h / 2} r="16" className="cu-sis-conf-zona" />
        <circle cx={n.w / 2} cy={n.h / 2} r="7" className="cu-sis-caja cu-sis-caja--conf" />
      </g>
    );
  };

  const dibujaSalida = (n: NodoSis) => (
    <g key={n.id} {...propsNodo(n, `Salida de la cuenca en Ojinaga: ${qSalida == null ? 'sin dato' : `${q2(qSalida)} metros cúbicos por segundo`}`, qSalida == null)}>
      {qSalida != null && <rect width={n.w} height={n.h} rx="10" className="cu-sis-pulso cu-sis-pulso--est" aria-hidden="true" />}
      <rect width={n.w} height={n.h} rx="10" className="cu-sis-caja cu-sis-caja--salida" />
      <text x="11" y="19" className="cu-sis-t1">Ojinaga · salida</text>
      <text x="11" y="38" className="cu-sis-t2 cu-sis-t2--g">{qSalida == null ? 'S/D' : `${q2(qSalida)} m³/s`}</text>
      <text x="11" y="52" className="cu-sis-t3">aforo USIBWC{ojinaga?.fecha ? ` · ${diaCorto(ojinaga.fecha)}` : ''}</text>
    </g>
  );

  const dibujaBravo = (n: NodoSis) => (
    <g key={n.id} {...propsNodo(n, 'Río Bravo, frente a Ojinaga: el Conchos le entrega su agua')}>
      <rect width={n.w} height={n.h} rx="10" className="cu-sis-caja cu-sis-caja--bravo" />
      <text x="11" y="19" className="cu-sis-t1">Río Bravo (Grande)</text>
      <text x="11" y="38" className="cu-sis-t2">recibe al Conchos</text>
      <text x="11" y="52" className="cu-sis-t3">Ojinaga · Presidio</text>
    </g>
  );

  // ── Ventana de detalle ────────────────────────────────────────────────────────────────────────────────────────────
  const nombreNodo = (id: string): string => {
    const n = nodoPor.get(id);
    if (!n) return id;
    if (n.tipo === 'presa') return (n.cuerpo as CuerpoAgua).etiqueta;
    if (n.tipo === 'lluvia') return `lluvia de ${regiones.find((r) => r.clave === n.region)?.nombre ?? ''}`;
    if (n.tipo === 'estacion') return `estación ${estDe.get(n.estacionId as string)?.sitio.corto ?? ''}`;
    if (n.tipo === 'confluencia') return `confluencia del ${n.confluencia?.afluente ?? ''}`;
    return n.tipo === 'distrito' ? 'Distrito de Riego 005' : n.tipo === 'bravo' ? 'el Río Bravo' : 'la salida en Ojinaga';
  };
  const vecinos = (id: string) => ({
    llega: dis.enlaces.filter(([, a]) => a === id).map(([de]) => de).filter((x) => { const n = nodoPor.get(x); return n != null && visible(n); }),
    va: dis.enlaces.filter(([de]) => de === id).map(([, a]) => a).filter((x) => { const n = nodoPor.get(x); return n != null && visible(n); }),
  });
  const recorridoDe = (id: string) => {
    const v = vecinos(id);
    if (!v.llega.length && !v.va.length) return null;
    return (
      <div className="cu-sis-rec">
        {v.llega.length > 0 && <p><b>Le llega de:</b> {v.llega.map((x, i) => <span key={x}>{i > 0 && ', '}<button type="button" className="cu-sis-enlace" onClick={() => setSel(x)}>{nombreNodo(x)}</button></span>)}</p>}
        {v.va.length > 0 && <p><b>Sigue hacia:</b> {v.va.map((x, i) => <span key={x}>{i > 0 && ', '}<button type="button" className="cu-sis-enlace" onClick={() => setSel(x)}>{nombreNodo(x)}</button></span>)}</p>}
      </div>
    );
  };

  const contenidoVentana = (n: NodoSis): { titulo: string; sub: string; cuerpo: ReactNode } => {
    if (n.tipo === 'presa') {
      const c = n.cuerpo as CuerpoAgua, m = modeloCuerpo(c), fila = m?.fila, l = lecturaVaso(c);
      const est = estadoEmbalse(l.sd ? null : l.pct);
      const esc = cuerpos.escenas.get(c.idSerie)?.filter((e) => e.areaKm2 != null).pop();
      const entrada = estaciones.find((e) => e.sitio.rol === 'entrada' && e.sitio.presaId != null && e.sitio.presaId === c.presaId);
      return {
        titulo: c.etiqueta, sub: `${c.corriente ?? 'Corriente S/D'} · ${c.rol === 'almacenamiento' ? 'presa de almacenamiento' : c.rol}${c.distritoRiego ? ` · DR ${c.distritoRiego}` : ''}`,
        cuerpo: (
          <>
            <p className="cu-sis-cifra"><span className="cu-sis-cifra-n">{l.pct == null ? 'S/D' : f(l.pct, 1)}</span><span className="cu-sis-cifra-u">{l.pct == null ? '' : '% del NAMO'}</span>
              <span className={`cu-estado cu-estado--${l.sd ? 'sd' : est.clave}`}><span aria-hidden="true">{GLIFO_ESTADO[l.sd ? 'sd' : est.clave]}</span> {l.sd ? 'S/D' : est.etiqueta}</span></p>
            <Barra pct={l.sd ? null : l.pct} clase={`cu-sis-barra-v--${est.clave}`} marcas={[20, 40]} />
            <dl className="cu-sis-dl">
              <Hecho t="Almacenamiento" nota={l.cuando}>{l.alm == null ? 'S/D' : `${f(l.alm, 1)} Mm³`}{c.namoRefMm3 != null && ` de ${f(c.namoRefMm3, 1)}`}</Hecho>
              <Hecho t="Le entra" nota={fila ? 'aportación que publica CONAGUA' : 'sin telemetría'}>{q2(fila?.aportacionM3s)}{fila?.aportacionM3s != null && ' m³/s'}</Hecho>
              <Hecho t="Le sale" nota={fila?.vertidoM3s != null && fila.vertidoM3s > 0 ? `incluye vertido de ${q2(fila.vertidoM3s)} m³/s` : 'extracción total'}>{q2(fila?.extraccionTotalM3s)}{fila?.extraccionTotalM3s != null && ' m³/s'}</Hecho>
              {entrada && <Hecho t={`Río en ${entrada.sitio.corto}`} nota={`estación hidrométrica · media ${VENTANAS[ventHidro].etiqueta}`}>{textoGasto(entrada.stat, 1)}{entrada.stat && ' m³/s'}</Hecho>}
              {m && <Hecho t="Cambio en 30 días">{m.cambio30Puntos == null ? 'S/D' : `${m.cambio30Puntos > 0 ? '+' : m.cambio30Puntos < 0 ? '−' : ''}${f(Math.abs(m.cambio30Puntos), 1)} puntos`}</Hecho>}
              {m && <Hecho t="Posición histórica" nota={m.posicion ? `mismo día del año, n = ${m.posicion.nAnios} años` : undefined}>{m.posicion?.percentil != null ? `percentil ${m.posicion.percentil}` : 'S/D'}</Hecho>}
              <Hecho t="Espejo por satélite" nota={esc ? `Sentinel-2 · ${diaCorto(esc.fecha)}` : undefined}>{esc?.areaKm2 != null ? `${f(esc.areaKm2, 2)} km²` : 'S/D'}</Hecho>
            </dl>
            {fila?.sinActualizar && <p className="cu-sis-aviso">▲ Lectura sin actualizar{fila.igualDesde ? ` desde el ${diaCorto(fila.igualDesde)}` : ''}: la fuente repite el último dato.</p>}
            {l.vencido && <p className="cu-sis-aviso">▲ Sin lectura vigente: se muestra el último cierre con dato.</p>}
            {c.nota && <p className="cu-sis-nota">{c.nota}</p>}
            {recorridoDe(n.id)}
            <div className="cu-sis-acc">
              {fila && <button type="button" className="an-btn" onClick={() => onIr('presas', fila.ubicacionId)}>Ver ficha de la presa</button>}
              <button type="button" className="an-btn" onClick={() => onIr('vasos')}>Ver vaso por satélite</button>
            </div>
          </>
        ),
      };
    }
    if (n.tipo === 'lluvia') {
      const r = lluviaReg.get(n.region as string), reg = regiones.find((x) => x.clave === n.region) as RegionLluvia;
      const top = (r?.dentro ?? []).slice(0, 5), tope = Math.max(1, ...top.map((p) => p.mm as number));
      return {
        titulo: `Lluvia · ${reg.nombre}`, sub: `${reg.nSubcuencas} subcuencas · ${f(reg.areaKm2, 0)} km² · escurre al ${reg.rio}`,
        cuerpo: (
          <>
            <p className="cu-sis-cifra"><span className="cu-sis-cifra-n">{r?.areal.mm == null ? 'S/D' : fmtLluvia(r.areal.mm)}</span><span className="cu-sis-cifra-u">{r?.areal.mm == null ? '' : 'mm'} · {cuandoVentana(ventanaObs)}</span></p>
            {r?.areal.mm == null && <p className="cu-sis-aviso">◇ {lluviaEstado === 'cargando' ? 'Cargando la red de estaciones…' : lluviaEstado === 'error' ? 'No se pudo cargar la red de estaciones.' : `Sin promedio: ${r?.areal.motivoSD ?? 'sin estaciones con dato'}.`}</p>}
            <dl className="cu-sis-dl">
              <Hecho t="Estaciones dentro" nota="con dato útil en la ventana">{r ? String(r.dentro.length) : 'S/D'}</Hecho>
              <Hecho t="Rango en la región">{r?.areal.min != null && r.areal.max != null ? `${fmtLluvia(r.areal.min)} – ${fmtLluvia(r.areal.max)} mm` : 'S/D'}</Hecho>
              <Hecho t="Área con estación cerca" nota="a 90 km o menos">{r && r.areal.coberturaPct > 0 ? `${f(r.areal.coberturaPct, 0)} %` : 'S/D'}</Hecho>
            </dl>
            {top.length > 0 && (
              <>
                <h6 className="cu-sis-h6">Estaciones con más lluvia</h6>
                <ul className="cu-sis-rank">
                  {top.map((p) => <li key={p.id}><span className="cu-sis-rank-n">{p.nombre}</span><Barra pct={((p.mm as number) / tope) * 100} clase="cu-sis-barra-v--lluvia" /><span className="cu-sis-rank-v">{fmtLluvia(p.mm)} mm</span></li>)}
                </ul>
              </>
            )}
            <p className="cu-sis-nota">Promedio areal con las estaciones JCAS y propias (dato provisional). Las estaciones dentro de la poligonal del distrito se listan en el distrito. La lluvia no es escurrimiento: cuánta llega al río depende del suelo y no se estima aquí.</p>
            {recorridoDe(n.id)}
            <div className="cu-sis-acc"><button type="button" className="an-btn" onClick={() => onIr('clima')}>Ver clima y lluvia</button></div>
          </>
        ),
      };
    }
    if (n.tipo === 'estacion') {
      const e = estDe.get(n.estacionId as string) as EstacionRed, s = e.stat;
      const presa = e.sitio.rol === 'entrada' ? modelos.find((m) => m.fila.presaId != null && m.fila.presaId === e.sitio.presaId)?.fila : undefined;
      const p = s?.pendienteGastoDia ?? null;
      return {
        titulo: e.sitio.corto, sub: e.sitio.tramo,
        cuerpo: (
          <>
            <p className="cu-sis-cifra"><span className="cu-sis-cifra-n">{textoGasto(s, 1)}</span><span className="cu-sis-cifra-u">{s ? 'm³/s' : ''} · media {VENTANAS[ventHidro].etiqueta}</span>
              <span className={`cu-hid-enlace cu-hid-enlace--${e.enlace.clave}`}><span aria-hidden="true">{GLIFO_ENLACE[e.enlace.clave]}</span> {e.enlace.etiqueta}</span></p>
            <dl className="cu-sis-dl">
              <Hecho t="Mínimo y máximo">{s?.gasto ? `${f(s.gasto.min, 1)} – ${f(s.gasto.max, 1)} m³/s` : 'S/D'}</Hecho>
              <Hecho t="Volumen que pasó" nota={s?.volumen ? `${f(s.volumen.pctIntegrado, 0)} % del periodo medido` : undefined}>{s?.volumen ? `${f(s.volumen.mm3, 2)} Mm³` : 'S/D'}</Hecho>
              <Hecho t="Nivel medio">{s?.nivel ? `${f(s.nivel.media, 2)} m` : 'S/D'}</Hecho>
              <Hecho t="Tendencia del gasto">{p == null ? 'S/D' : Math.abs(p) < 0.5 ? '▬ estable' : `${p > 0 ? '▲ +' : '▼ −'}${f(Math.abs(p), 1)} m³/s por día`}</Hecho>
              <Hecho t="Lecturas recibidas">{s?.cobertura ? `${f(s.cobertura.pct, 0)} %` : 'S/D'}</Hecho>
              <Hecho t="Último dato">{e.est.ult_dato_en ? `${fechaHoraLocal(e.est.ult_dato_en)} · ${textoEdad(e.enlace.edadMin)}` : 'S/D'}</Hecho>
              {presa && <Hecho t="CONAGUA publica" nota={`aportación a ${presa.etiqueta}${presa.fecha ? ` · ${diaCorto(presa.fecha)}` : ''}`}>{q2(presa.aportacionM3s)}{presa.aportacionM3s != null && ' m³/s'}</Hecho>}
            </dl>
            {presa && <p className="cu-sis-nota">La estación mide el río; CONAGUA deduce la aportación de la operación del vaso. Son medidas distintas y ambas provisionales.</p>}
            {e.sitio.reserva && <p className="cu-sis-aviso">▲ {e.sitio.reserva}</p>}
            {recorridoDe(n.id)}
          </>
        ),
      };
    }
    if (n.tipo === 'confluencia') {
      const k = n.confluencia!;
      const llegan = dis.arcos.filter((a) => a.a === n.id && (a.tipo === 'rio' || a.tipo === 'aforo' || a.tipo === 'tramo'));
      return {
        titulo: `Confluencia · ${k.afluente}`, sub: `El ${k.afluente} se une al río Conchos · ${k.cerca}`,
        cuerpo: (
          <>
            <p className="cu-sis-cifra"><span className="cu-sis-cifra-n">S/D</span><span className="cu-sis-cifra-u">gasto en la confluencia: sin aforo</span></p>
            <dl className="cu-sis-dl">
              {llegan.map((a) => { const q = gastoArco(a); return <Hecho key={a.id} t={`Llega de ${nombreNodo(a.de)}`} nota={a.tipo === 'tramo' ? 'tramo sin aforo' : a.tipo === 'aforo' ? 'estación hidrométrica' : 'extracción que publica CONAGUA'}>{q == null ? 'S/D' : `${q2(q)} m³/s`}</Hecho>; })}
              <Hecho t="Ubicación" nota="plano digital de ríos de SICA (HydroRIVERS)">{f(k.lat, 3)}°, {f(k.lon, 3)}°</Hecho>
              <Hecho t="Respecto al distrito">{k.antesDelDistrito ? 'aguas arriba' : 'dentro o al final'}</Hecho>
            </dl>
            <p className="cu-sis-nota">Lo que sale de un vaso no es lo que llega aquí: entre ambos puntos hay pérdidas, tomas y aportes que no se miden. Por eso el tramo de aguas abajo se dibuja sin gasto (S/D).</p>
            {recorridoDe(n.id)}
          </>
        ),
      };
    }
    if (n.tipo === 'distrito') {
      const topD = (lluviaDist?.dentro ?? []).slice(0, 6), topeD = Math.max(1, ...topD.map((p) => p.mm as number));
      const boq = modelos.find((m) => m.fila.presaId === 'PRE-001')?.fila, mad = modelos.find((m) => m.fila.presaId === 'PRE-002')?.fila;
      const c = cm.conduccion;
      const ultimoAforo = (x: typeof k0) => (x.ultimoAforoM3s != null ? `último aforo ${q2(x.ultimoAforoM3s)} m³/s${x.ultimoAforoMs ? ` · ${fechaHoraMs(x.ultimoAforoMs)}` : ''}` : 'sin aforo en 30 días');
      return {
        titulo: 'Distrito de Riego 005 · Delicias', sub: 'Canal Principal Conchos, 104 km · SRL Unidad Conchos',
        cuerpo: (
          <>
            <p className="cu-sis-cifra"><span className="cu-sis-cifra-n">{k0.gasto == null ? 'S/D' : q2(k0.gasto)}</span><span className="cu-sis-cifra-u">{k0.gasto == null ? '' : 'm³/s '}entran en K-0</span></p>
            {!canal.cargado && <p className="cu-sis-nota" role="status">Leyendo las escalas del canal…</p>}
            {canal.error && <p className="cu-sis-aviso">▲ No se pudieron leer las escalas: {canal.error}</p>}
            <dl className="cu-sis-dl">
              <Hecho t="Entrada · K-0+000" nota={k0.gasto == null ? ultimoAforo(k0) : `medición de campo · ${fechaHoraMs(k0.medicionMs) ?? ''}`}>{k0.gasto == null ? 'S/D' : `${q2(k0.gasto)} m³/s`}</Hecho>
              <Hecho t="Cola · K-104" nota={k104.gasto == null ? ultimoAforo(k104) : `medición de campo · ${fechaHoraMs(k104.medicionMs) ?? ''}`}>{k104.gasto == null ? 'S/D' : `${q2(k104.gasto)} m³/s`}</Hecho>
              <Hecho t="Eficiencia de conducción" nota={c.incoherente ? 'sale más de lo que entra: revisar aforos' : c.perdidaM3s != null ? `${q2(c.perdidaM3s)} m³/s entre K-0 y K-104` : 'requiere los dos extremos vigentes'}>{c.eficienciaPct == null ? 'S/D' : `${f(c.eficienciaPct, 1)} %`}</Hecho>
              <Hecho t="Escalas con medición vigente">{canal.cargado ? `${cm.conMedicionControl} de ${cm.totalControl}` : 'S/D'}</Hecho>
              <Hecho t="Extracción de La Boquilla" nota={boq?.fecha ? `CONAGUA · ${diaCorto(boq.fecha)}` : 'CONAGUA'}>{q2(boq?.extraccionTotalM3s)}{boq?.extraccionTotalM3s != null && ' m³/s'}</Hecho>
              <Hecho t="Extracción de F. I. Madero" nota={mad?.fecha ? `CONAGUA · ${diaCorto(mad.fecha)}` : 'CONAGUA'}>{q2(mad?.extraccionTotalM3s)}{mad?.extraccionTotalM3s != null && ' m³/s'}</Hecho>
            </dl>
            <h6 className="cu-sis-h6">Lluvia dentro del distrito · {etiquetaVentana(ventanaObs)}</h6>
            {topD.length > 0 ? (
              <>
                <ul className="cu-sis-rank">
                  {topD.map((p) => <li key={p.id}><span className="cu-sis-rank-n">{p.nombre}</span><Barra pct={((p.mm as number) / topeD) * 100} clase="cu-sis-barra-v--lluvia" /><span className="cu-sis-rank-v">{fmtLluvia(p.mm)} mm</span></li>)}
                </ul>
                <p className="cu-sis-nota">Promedio simple de {topD.length === lluviaDist?.dentro.length ? 'estas' : `las ${lluviaDist?.dentro.length}`} estaciones dentro de la poligonal: {fmtLluvia(lluviaDist?.mm)} mm. No es un promedio areal.</p>
              </>
            ) : <p className="cu-sis-aviso">◇ {lluviaEstado === 'cargando' ? 'Cargando la red de estaciones…' : distrito.length ? 'Sin estaciones con dato dentro de la poligonal en esta ventana (S/D).' : 'No se pudo cargar la poligonal del distrito (S/D).'}</p>}
            <p className="cu-sis-nota">El gasto del canal solo cuenta con medición de campo de las últimas 4 horas. La derivación desde F. I. Madero y los retornos del distrito al río no tienen aforo en SICA: se indican S/D, no cero.</p>
            {recorridoDe(n.id)}
          </>
        ),
      };
    }
    if (n.tipo === 'bravo') {
      return {
        titulo: 'Río Bravo (Grande)', sub: 'Frente a Ojinaga (Chih.) y Presidio (Tex.) · límite internacional',
        cuerpo: (
          <>
            <p className="cu-sis-cifra"><span className="cu-sis-cifra-n">{qSalida == null ? 'S/D' : q2(qSalida)}</span><span className="cu-sis-cifra-u">{qSalida == null ? '' : 'm³/s aportados por el Conchos'}</span></p>
            <dl className="cu-sis-dl">
              <Hecho t="Aporte del Conchos" nota={ojinaga?.fecha ? `aforo USIBWC · ${diaCorto(ojinaga.fecha)}` : 'aforo USIBWC'}>{qSalida == null ? 'S/D' : `${q2(qSalida)} m³/s`}</Hecho>
              <Hecho t="Media 30 días">{salidaMedia30 == null ? 'S/D' : `${q2(salidaMedia30)} m³/s`}</Hecho>
              <Hecho t="Aforo del Bravo">S/D</Hecho>
            </dl>
            <p className="cu-sis-nota">Aquí termina el sistema: el Conchos desemboca en el Bravo, que sigue hacia el sureste. SICA no tiene estación sobre el Bravo, así que su gasto propio es S/D, no cero. Ubicación tomada de la estación de Ojinaga (29.57° N, 104.40° O); la unión exacta falta confirmar con la CILA.</p>
            {recorridoDe(n.id)}
          </>
        ),
      };
    }
    const sIbwc = ibwc?.stat ?? null, sSut = sutron?.stat ?? null;
    const cierre = cuerpos.cuerpos.find((c) => !c.aguasAbajoId), filaCierre = cierre ? modeloCuerpo(cierre)?.fila : undefined;
    return {
      titulo: 'Ojinaga · salida de la cuenca', sub: 'Río Conchos antes del río Bravo · aforo USIBWC 08373000',
      cuerpo: (
        <>
          <p className="cu-sis-cifra"><span className="cu-sis-cifra-n">{qSalida == null ? 'S/D' : q2(qSalida)}</span><span className="cu-sis-cifra-u">{qSalida == null ? '' : 'm³/s'}{ojinaga?.fecha ? ` · ${diaCorto(ojinaga.fecha)}` : ''}</span></p>
          <dl className="cu-sis-dl">
            <Hecho t={`Media ${VENTANAS[ventHidro].etiqueta}`} nota="telemetría USIBWC">{textoGasto(sIbwc, 2)}{sIbwc && ' m³/s'}</Hecho>
            <Hecho t="Media 30 días" nota="gasto diario oficial">{salidaMedia30 == null ? 'S/D' : `${q2(salidaMedia30)} m³/s`}</Hecho>
            <Hecho t="Volumen que salió" nota={`en ${VENTANAS[ventHidro].etiqueta}`}>{sIbwc?.volumen ? `${f(sIbwc.volumen.mm3, 2)} Mm³` : 'S/D'}</Hecho>
            {cierre && <Hecho t={`Sale de ${cierre.etiqueta}`} nota="extracción que publica CONAGUA">{q2(filaCierre?.extraccionTotalM3s)}{filaCierre?.extraccionTotalM3s != null && ' m³/s'}</Hecho>}
            {ibwc && <Hecho t="Enlace USIBWC">{GLIFO_ENLACE[ibwc.enlace.clave]} {ibwc.enlace.etiqueta}{ibwc.est.ult_dato_en ? ` · ${textoEdad(ibwc.enlace.edadMin)}` : ''}</Hecho>}
            {sutron && <Hecho t="Sensor Sutron" nota="mismo sitio · no se usa para la salida">{textoGasto(sSut, 1)}{sSut && ' m³/s'}</Hecho>}
          </dl>
          {sutron?.sitio.reserva && <p className="cu-sis-aviso">▲ {sutron.sitio.reserva}</p>}
          {recorridoDe(n.id)}
        </>
      ),
    };
  };

  const ventana = selVisible ? contenidoVentana(selVisible) : null;
  const estiloVentana = (() => {
    if (!selVisible || esPhone) return undefined;
    const n = selVisible, aLaDerecha = n.x + n.w / 2 < dis.ancho / 2;
    const lado = aLaDerecha ? { left: `calc(${((n.x + n.w) / dis.ancho) * 100}% + 12px)` } : { right: `calc(${((dis.ancho - n.x) / dis.ancho) * 100}% + 12px)` };
    return { ...lado, top: `clamp(8px, calc(${((n.y + n.h / 2) / dis.alto) * 100}% - 210px), calc(100% - 428px))` };
  })();

  const pasos: { t: string; v: string; u: string; n: string }[] = [
    { t: 'Llueve', v: arealCuenca?.mm == null ? 'S/D' : fmtLluvia(arealCuenca.mm), u: 'mm', n: arealCuenca?.mm == null ? (lluviaEstado === 'cargando' ? 'cargando estaciones' : 'sin promedio areal') : `promedio de la cuenca · ${etiquetaVentana(ventanaObs)}` },
    { t: 'Llega a los vasos', v: q2(aport.total), u: 'm³/s', n: `aportaciones · ${aport.conDato} de ${filas.length} presas` },
    { t: 'Se almacena', v: agregado.totalMm3 == null ? 'S/D' : f(agregado.totalMm3, 0), u: 'Mm³', n: agregado.porcentaje == null ? 'sin lectura vigente' : `${f(agregado.porcentaje, 1)} % del NAMO` },
    { t: 'Sale de los vasos', v: q2(extr.total), u: 'm³/s', n: `extracciones · ${extr.conDato} de ${filas.length} presas` },
    { t: 'Entra al distrito', v: q2(k0.gasto), u: 'm³/s', n: k0.gasto == null ? (k0.ultimoAforoM3s != null ? `K-0 sin medición vigente · último ${q2(k0.ultimoAforoM3s)}` : 'K-0 sin medición vigente') : 'Canal Conchos en K-0' },
    { t: 'Sale de la cuenca', v: q2(qSalida), u: 'm³/s', n: `Ojinaga, aforo USIBWC${ojinaga?.fecha ? ` · ${diaCorto(ojinaga.fecha)}` : ''}` },
  ];

  const resumen = `Recorrido del agua en la cuenca del Conchos: ${dis.arcos.filter((a) => a.tipo !== 'lluvia').map((a) => `${nombreNodo(a.de)} sigue hacia ${nombreNodo(a.a)}`).join('; ')}.`;

  return (
    <section className="an-card cu-sis" id="cu-red" aria-label="El agua en la cuenca, de la lluvia a la salida">
      <div className="cu-red-cab">
        <div>
          <h4 className="an-h">El agua en la cuenca, de la lluvia a la salida</h4>
          <p className="an-nota">Toque cualquier elemento para abrir su ventana de detalle y resaltar su recorrido: lo que le llega y lo que alimenta.</p>
        </div>
        <div className="cu-sis-ctls">
          <label className="cu-ctl">
            <span className="cu-ctl-etq">Lluvia</span>
            <select className="cu-sis-select" value={String(ventanaObs)} onChange={(e) => { const o = VENTANAS_OBS.find((x) => String(x.v) === e.target.value); if (o) onVentanaObs(o.v); }}>
              {VENTANAS_OBS.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.t}</option>)}
            </select>
          </label>
          <div className="cu-ctl">
            <span className="cu-ctl-etq" id={`${uid}-vh`}>Gasto de estaciones</span>
            <div className="an-seg" role="group" aria-labelledby={`${uid}-vh`}>
              {(Object.keys(VENTANAS) as VentanaHidro[]).map((v) => <button key={v} type="button" className="an-seg-btn" aria-pressed={v === ventHidro} onClick={() => onVentHidro(v)}>{VENTANAS[v].etiqueta}</button>)}
            </div>
          </div>
        </div>
      </div>

      <ol className="cu-sis-pasos" aria-label="Etapas del recorrido del agua">
        {pasos.map((p, i) => (
          <li key={p.t} className={`cu-sis-paso${p.v === 'S/D' ? ' cu-sis-paso--sd' : ''}`}>
            <span className="cu-sis-paso-t"><span className="cu-sis-paso-i" aria-hidden="true">{i + 1}</span>{p.t}</span>
            <span className="cu-sis-paso-v">{p.v}{p.v !== 'S/D' && <small> {p.u}</small>}</span>
            <span className="cu-sis-paso-n">{p.n}</span>
          </li>
        ))}
      </ol>

      <div className="cu-capas-chips cu-sis-capas" role="group" aria-label="Capas del esquema">
        <span className="cu-ctl-etq">Capas</span>
        {CAPAS_SISTEMA.map((c) => {
          const on = con(c.id);
          return <button key={c.id} type="button" className="cu-capa-chip" aria-pressed={on} title={c.ayuda} onClick={() => alternar(c.id)}><span aria-hidden="true">{on ? '✓' : '+'}</span> {c.titulo}</button>;
        })}
      </div>
      {desborda && <p className="an-nota cu-sis-pista">{esPhone ? 'Deslice' : 'Desplace'} el esquema hacia los lados para recorrer la cuenca hasta el Río Bravo →</p>}
      {con('lluvia') && !regiones.length && <p className="an-nota" role="status">La capa de lluvia necesita el plano de subcuencas, que no se pudo cargar: se omite.</p>}

      <div ref={marcoRef} className="cu-sis-wrap" role="region" aria-label="Esquema del recorrido del agua (desplazable)" tabIndex={0}>
        <div className="cu-sis-lienzo" style={{ minWidth: Math.round(dis.ancho * 0.96), maxWidth: Math.round(dis.ancho * 1.25) }}>
          <svg className={`cu-sis-svg${con('gastos') ? ' cu-sis-svg--flujo' : ''}`} viewBox={`0 0 ${dis.ancho} ${dis.alto}`} role="group" aria-label={resumen} onClick={() => sel && setSel(null)}>
            <defs>
              <marker id={`${uid}-f`} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0,1L9,5L0,9z" className="cu-sis-flecha" /></marker>
              <marker id={`${uid}-c`} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0,1L9,5L0,9z" className="cu-sis-flecha cu-sis-flecha--canal" /></marker>
            </defs>

            {dis.etapas.filter((e) => (e.titulo === 'Lluvia' ? con('lluvia') : true)).map((e) => (
              <text key={e.titulo} x={e.x + e.w / 2} y="16" textAnchor="middle" className="cu-sis-etapa">{e.titulo}</text>
            ))}

            {/* El distrito va detrás de los ríos: es la zona que cruzan. */}
            {dis.nodos.filter((n) => n.tipo === 'distrito' && visible(n)).map(dibujaDistrito)}

            {dis.arcos.filter(arcoVisible).map((a) => {
              const q = gastoArco(a), w = con('gastos') ? grosorDeGasto(q, qMax) : 1.8;
              const fuera = rec != null && selVisible != null && !arcoEnRecorrido(a, rec);
              const sd = a.tipo !== 'lluvia' && q == null;
              const flecha = a.tipo === 'lluvia' || nodoPor.get(a.a)?.tipo === 'confluencia' && a.tipo !== 'rio' ? undefined : `url(#${uid}-${a.tipo === 'canal' ? 'c' : 'f'})`;
              return (
                <g key={a.id} className={`cu-sis-arco cu-sis-arco--${a.tipo}${sd ? ' cu-sis-arco--sd' : ''}${fuera ? ' cu-sis-atenuado' : ''}`}>
                  <title>{a.tipo === 'lluvia' ? `La ${nombreNodo(a.de)} escurre hacia ${nombreNodo(a.a)} (escurrimiento no cuantificado)` : `${nombreNodo(a.de)} → ${nombreNodo(a.a)}: ${q == null ? 'sin medición (S/D)' : `${q2(q)} m³/s`}`}</title>
                  <path d={a.d} className="cu-sis-trazo" style={a.tipo === 'lluvia' ? undefined : { strokeWidth: w }} markerEnd={flecha} />
                  {con('gastos') && q != null && q > 0 && a.tipo !== 'lluvia' && <path d={a.d} className="cu-sis-flujo" style={{ strokeWidth: Math.max(1.2, w * 0.45), animationDuration: `${(2.8 - 2 * Math.min(1, q / qMax)).toFixed(2)}s` }} />}
                </g>
              );
            })}

            {dis.rotulosRio.map((r) => <text key={`${r.texto}-${r.y}`} x={r.x} y={r.y - 7} className="cu-sis-rio">{r.texto}</text>)}
            {dis.toma && con('distrito') && (
              <g aria-hidden="true">
                <path d={`M${dis.toma.x},${dis.toma.y - 6} l6,6 l-6,6 l-6,-6 z`} className="cu-sis-toma" />
                <text x={dis.toma.x} y={dis.toma.y - 11} textAnchor="middle" className="cu-sis-rio cu-sis-rio--toma">K-0</text>
              </g>
            )}
            {con('gastos') && dis.arcos.filter((a) => a.rotulo && a.tipo === 'rio').map((a) => {
              const q = gastoArco(a);
              return q == null ? null : <text key={`q-${a.id}`} x={a.rotulo!.x} y={a.rotulo!.y + 16} className="cu-sis-q">{q2(q)} m³/s</text>;
            })}

            {dis.nodos.filter((n) => n.tipo !== 'distrito' && visible(n)).map((n) => (n.tipo === 'presa' ? dibujaPresa(n) : n.tipo === 'lluvia' ? dibujaLluvia(n) : n.tipo === 'estacion' ? dibujaEstacion(n) : n.tipo === 'confluencia' ? dibujaConfluencia(n) : n.tipo === 'bravo' ? dibujaBravo(n) : dibujaSalida(n)))}
          </svg>

          {ventana && !esPhone && (
            <div ref={ventanaRef} className="cu-sis-ventana" style={estiloVentana} role="dialog" aria-label={ventana.titulo} tabIndex={-1}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } }}>
              <header className="cu-sis-ventana-cab">
                <div><h5 className="cu-sis-ventana-t">{ventana.titulo}</h5><p className="cu-sis-ventana-s">{ventana.sub}</p></div>
                <button type="button" className="cu-sis-cerrar" aria-label="Cerrar la ventana de detalle" onClick={cerrar}>✕</button>
              </header>
              {ventana.cuerpo}
            </div>
          )}
        </div>
      </div>

      <ul className="cu-sis-leyenda" aria-label="Cómo se lee el esquema">
        <li><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" className="cu-sis-ley cu-sis-ley--rio" /></svg> Río: el grosor crece con el gasto</li>
        <li><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" className="cu-sis-ley cu-sis-ley--sd" /></svg> Tramo sin medición (S/D)</li>
        <li><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" className="cu-sis-ley cu-sis-ley--lluvia" /></svg> Lluvia que escurre (no cuantificado)</li>
        <li><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" className="cu-sis-ley cu-sis-ley--canal" /></svg> Derivación al distrito</li>
        <li><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" className="cu-sis-caja cu-sis-caja--conf" /></svg> Confluencia con el Conchos</li>
        <li>Confluencias ubicadas con el plano digital de ríos; por confirmar con CONAGUA.</li>
      </ul>

      {ventana && esPhone && (
        <div ref={ventanaRef} className="cu-sis-ventana cu-sis-ventana--fija" role="region" aria-label={ventana.titulo} tabIndex={-1}>
          <header className="cu-sis-ventana-cab">
            <div><h5 className="cu-sis-ventana-t">{ventana.titulo}</h5><p className="cu-sis-ventana-s">{ventana.sub}</p></div>
            <button type="button" className="cu-sis-cerrar" aria-label="Cerrar la ventana de detalle" onClick={cerrar}>✕</button>
          </header>
          {ventana.cuerpo}
        </div>
      )}
    </section>
  );
}
