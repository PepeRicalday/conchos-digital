import { useMemo, useState, type KeyboardEvent } from 'react';
import { formatearNumero } from '../../../utils/historicoPresas';
import { aniosConDato, compararAnios, compararVasos, MAX_SERIES, tramosContinuos, type ModeloComparador } from '../../../utils/comparadorCuenca';
import type { DatosCuerposAgua } from '../../../hooks/useCuerposAgua';
import { useDevice } from '../../../hooks/useDevice';
import Segmentado from './Segmentado';

type Modo = 'vasos' | 'anios';
const W = 720, H = 280;
// Un trazo distinto por posición además del color: la identidad nunca depende solo del tono.
const TRAZOS = ['', '7 4', '2 3', '10 3 2 3', '', '7 4', '2 3', '10 3 2 3'];
const f1 = (v: number | null) => (v == null ? 'S/D' : `${formatearNumero(v, 1)} %`);

/** Gráfica de líneas en % del NAMO: eje único, huecos sin interpolar, hover y teclado, y la misma serie en tabla. */
function Grafica({ m }: { m: ModeloComparador }) {
  const [col, setCol] = useState<number | null>(null);
  const { esPhone } = useDevice();
  const n = m.xs.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (Math.max(0, Math.min(m.max, v)) / m.max) * H;
  const marcas = m.max <= 100 ? [0, 20, 40, 60, 80, 100] : Array.from({ length: m.max / 20 + 1 }, (_, k) => k * 20).filter((v) => v <= m.max);
  const paso = Math.max(1, Math.ceil(n / (esPhone ? 4 : 8))); // pocas marcas en teléfono: que no se encimen
  const alMover = (e: { currentTarget: SVGSVGElement; clientX: number }) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || n === 0) return;
    setCol(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
  };
  const teclas = (e: KeyboardEvent) => {
    if (n === 0) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); setCol((c) => Math.min(n - 1, (c ?? -1) + 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setCol((c) => Math.max(0, (c ?? n) - 1)); }
    else if (e.key === 'Escape') setCol(null);
  };
  const resumen = m.series.map((s) => `${s.nombre}: ${s.conDato} meses con dato`).join('; ');
  const pctX = col == null ? 0 : n <= 1 ? 50 : (col / (n - 1)) * 100;

  return (
    <div className="cu-cmp-graf">
      <div className="cu-cmp-area">
        <div className="cu-cmp-y" aria-hidden="true">{marcas.map((v) => <span key={v} style={{ bottom: `${(v / m.max) * 100}%` }}>{v} %</span>)}</div>
        <div className="cu-cmp-lienzo">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="cu-cmp-svg" role="img" tabIndex={0}
            aria-label={`Comparación del % del NAMO. ${resumen}. Use las flechas para recorrer los meses.`}
            onPointerMove={alMover} onPointerLeave={() => setCol(null)} onKeyDown={teclas} onBlur={() => setCol(null)}>
            {marcas.map((v) => <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} className={v === 20 || v === 40 ? 'cu-cmp-guia cu-cmp-guia--umbral' : 'cu-cmp-guia'} />)}
            {m.series.map((s) => tramosContinuos(s.puntos).map((t, k) => (
              <polyline key={`${s.id}-${k}`} points={t.map((p) => `${x(m.xs.findIndex((q) => q.x === p.x))},${y(p.v as number)}`).join(' ')}
                className={`cu-cmp-linea cu-cmp-s${s.slot}`} strokeDasharray={TRAZOS[s.slot]} fill="none" vectorEffect="non-scaling-stroke" />
            )))}
            {col != null && <line x1={x(col)} x2={x(col)} y1="0" y2={H} className="cu-cmp-cruz" />}
          </svg>
          {/* Los puntos van en HTML (el SVG se estira y deformaría los círculos): se marcan los puntos aislados y la columna activa. */}
          {m.series.flatMap((s) => s.puntos.map((p, i) => {
            const aislado = p.v != null && (i === 0 || s.puntos[i - 1].v == null) && (i === n - 1 || s.puntos[i + 1].v == null);
            if (p.v == null || (!aislado && i !== col)) return null;
            return <span key={`${s.id}-${i}`} className={`cu-cmp-punto cu-cmp-bg${s.slot}`} style={{ left: `${n <= 1 ? 50 : (i / (n - 1)) * 100}%`, bottom: `${(Math.min(m.max, p.v) / m.max) * 100}%` }} aria-hidden="true" />;
          }))}
          {col != null && (
            <div className="cu-cmp-tip" role="status" style={{ left: `${pctX}%` }} data-lado={pctX > 60 ? 'izq' : 'der'}>
              <b>{m.xs[col].etiqueta}</b>
              {m.series.map((s) => <span key={s.id}><i className={`cu-cmp-sw cu-cmp-bg${s.slot}`} aria-hidden="true" />{s.nombre}: <b>{f1(s.puntos[col].v)}</b></span>)}
            </div>
          )}
        </div>
        <div className="cu-cmp-x" aria-hidden="true">{m.xs.map((p, i) => (i % paso === 0 || i === n - 1) ? <span key={p.x} style={{ left: `${n <= 1 ? 50 : (i / (n - 1)) * 100}%` }}>{p.etiqueta}</span> : null)}</div>
      </div>
      <details className="cu-cmp-tabla">
        <summary className="cu-notas-sum">Ver como tabla</summary>
        <div className="cu-tabla-wrap" role="region" tabIndex={0} aria-label="Tabla del comparador (desplazable)">
          <table className="cu-tabla">
            <caption className="cu-sr">% del NAMO por mes</caption>
            <thead><tr><th scope="col">{m.modo === 'anios' ? 'Mes' : 'Cierre'}</th>{m.series.map((s) => <th key={s.id} scope="col" className="cu-num">{s.nombre}</th>)}</tr></thead>
            <tbody>{m.xs.map((p, i) => <tr key={p.x}><th scope="row">{p.etiqueta}</th>{m.series.map((s) => <td key={s.id} className="cu-num">{f1(s.puntos[i].v)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/**
 * Comparador: vasos entre sí (hasta 4, línea de tiempo desde 2021) o el mismo vaso año contra año (mismo mes calendario).
 * Todo en % del NAMO para que presas de tamaño muy distinto se lean en la misma escala. Un cierre sin cifra es un hueco, no un 0.
 */
export default function ComparadorCuenca({ datos }: { datos: DatosCuerposAgua }) {
  const conPct = useMemo(() => datos.cuerpos.filter((c) => datos.cierres.some((x) => x.cuerpoId === c.id && x.pctNamo != null)), [datos]);
  const [modo, setModo] = useState<Modo>('vasos');
  const [vasos, setVasos] = useState<string[]>(() => conPct.slice(0, 2).map((c) => c.id));
  const [vasoAnios, setVasoAnios] = useState<string>(() => conPct[0]?.id ?? '');
  const [aniosSel, setAniosSel] = useState<number[] | null>(null);

  const cuerpoAnios = conPct.find((c) => c.id === vasoAnios) ?? conPct[0] ?? null;
  const disponibles = useMemo(() => (cuerpoAnios ? aniosConDato(datos.cierres, cuerpoAnios.id) : []), [datos.cierres, cuerpoAnios]);
  const anios = (aniosSel ?? disponibles.slice(0, 3)).filter((a) => disponibles.includes(a));
  const modelo = useMemo<ModeloComparador | null>(() => {
    if (modo === 'vasos') return compararVasos(datos.cuerpos, datos.cierres, vasos);
    return cuerpoAnios ? compararAnios(cuerpoAnios, datos.cierres, anios) : null;
  }, [modo, datos, vasos, cuerpoAnios, anios]);

  const alterna = <T,>(lista: T[], v: T): T[] => (lista.includes(v) ? lista.filter((x) => x !== v) : lista.length >= MAX_SERIES ? lista : [...lista, v]);
  const lleno = (modo === 'vasos' ? vasos.length : anios.length) >= MAX_SERIES;

  if (!conPct.length) return null;
  return (
    <section className="an-card" id="cu-comparador" aria-label="Comparador de vasos y años">
      <h4 className="an-h">Comparador</h4>
      <p className="an-nota">
        {modo === 'vasos' ? 'Hasta 4 vasos en la misma escala: % del NAMO al cierre de cada mes, desde 2021.' : 'Un vaso, año contra año: el mismo mes calendario de hasta 4 años.'}
        {' '}Un mes sin cierre queda como hueco, no como cero. Las rayas de 20 % y 40 % son los umbrales de estado de SICA.
      </p>
      <div className="cu-controles" role="group" aria-label="Opciones del comparador">
        <Segmentado<Modo> etiqueta="Comparar" valor={modo} onChange={setModo} opciones={[{ v: 'vasos', t: 'Vasos' }, { v: 'anios', t: 'Años de un vaso' }]} />
      </div>
      <div className="cu-cmp-chips" role="group" aria-label={modo === 'vasos' ? 'Vasos a comparar' : 'Vaso y años a comparar'}>
        {modo === 'anios' && (
          <label className="cu-cmp-sel"><span className="cu-ctl-etq">Vaso</span>
            <select className="ui-select" value={cuerpoAnios?.id ?? ''} onChange={(e) => { setVasoAnios(e.target.value); setAniosSel(null); }}>
              {conPct.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
            </select>
          </label>
        )}
        {(modo === 'vasos' ? conPct.map((c) => ({ k: c.id, t: c.etiqueta, on: vasos.includes(c.id), slot: datos.cuerpos.findIndex((x) => x.id === c.id) % 8, al: () => setVasos((l) => alterna(l, c.id)) }))
          : disponibles.map((a) => ({ k: String(a), t: String(a), on: anios.includes(a), slot: Math.max(0, anios.indexOf(a)), al: () => setAniosSel(alterna(anios, a)) }))).map((c) => {
          const bloqueado = !c.on && lleno;
          return (
            <button key={c.k} type="button" className="cu-capa-chip cu-cmp-chip" aria-pressed={c.on} disabled={bloqueado} onClick={c.al}
              title={bloqueado ? `Máximo ${MAX_SERIES}: quite uno para agregar otro` : undefined}>
              <i className={`cu-cmp-sw ${c.on ? `cu-cmp-bg${c.slot}` : 'cu-cmp-sw--off'}`} aria-hidden="true" />{c.t}
            </button>
          );
        })}
      </div>
      {!modelo || modelo.series.length === 0 ? <div className="an-vacio" role="status"><strong>Elija al menos un {modo === 'vasos' ? 'vaso' : 'año'}</strong><span>El comparador dibuja hasta {MAX_SERIES}.</span></div>
        : modelo.xs.length === 0 ? <div className="an-vacio" role="status"><strong>Sin cierres con % del NAMO (S/D)</strong><span>Los vasos elegidos no tienen cifra de cierre.</span></div>
        : <Grafica m={modelo} key={modo} />}
      {modelo && modelo.series.length > 0 && (
        <ul className="cu-cmp-leyenda" aria-label="Leyenda">
          {modelo.series.map((s) => (
            <li key={s.id}><svg width="30" height="10" aria-hidden="true"><line x1="0" x2="30" y1="5" y2="5" className={`cu-cmp-linea cu-cmp-s${s.slot}`} strokeDasharray={TRAZOS[s.slot]} /></svg>
              {s.nombre} <span className="cu-nota-fila">{s.conDato} {s.conDato === 1 ? 'mes' : 'meses'} con dato</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}
