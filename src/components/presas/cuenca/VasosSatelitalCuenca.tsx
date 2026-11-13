import { useMemo, useState } from 'react';
import { Kpi } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { longitudEscala, proyeccionPara, rutaDeAnillos, type CuerpoAgua } from '../../../utils/cuerposAgua';
import {
  ESCENA_ATRASADA_DIAS, PERIODOS_VASO, REVISITA_SENTINEL_DIAS, diasDesde, escenasEnPeriodo, lecturasVasos, resumenVasos, type PeriodoVaso,
} from '../../../utils/cuencaAnalisis';
import type { DatosCuerposAgua, EscenaSatelital, HuellaVaso } from '../../../hooks/useCuerposAgua';
import type { VasoHoy } from './EsquemaRedCuenca';
import LecturaCuenca from './LecturaCuenca';

const W = 250, H = 170;
const TZ = 'America/Chihuahua';
const fechaCorta = (iso: string, anio = true) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', ...(anio ? { year: 'numeric' } : {}), timeZone: TZ });
const diaLocal = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const con = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), d)}`;
const haceTxt = (d: number) => (d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`);

/** Serie del área del espejo en el periodo: puntos por escena, con la primera y la última fecha y el mínimo y el máximo rotulados. */
function SerieArea({ escenas, nombre }: { escenas: EscenaSatelital[]; nombre: string }) {
  const pts = escenas.filter((e) => e.areaKm2 != null);
  if (pts.length < 2) return <p className="cu-vs-pie">{pts.length === 1 ? 'Una sola escena en el periodo: todavía no hay tendencia.' : 'Sin escenas en el periodo elegido.'}</p>;
  const vals = pts.map((e) => e.areaKm2 as number), max = Math.max(...vals), min = Math.min(...vals);
  const w = 250, h = 62, pl = 4, pr = 4, pt = 8, pb = 6, rango = Math.max(max - min, 1e-6);
  const t0 = Date.parse(pts[0].fecha), t1 = Date.parse(pts[pts.length - 1].fecha), dt = Math.max(t1 - t0, 1);
  const xy = pts.map((e) => [pl + ((Date.parse(e.fecha) - t0) / dt) * (w - pl - pr), pt + (1 - ((e.areaKm2 as number) - min) / rango) * (h - pt - pb)] as const);
  return (
    <figure className="cu-vs-fig">
      <svg className="cu-vs-serie" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Espejo de ${nombre} en ${pts.length} escenas, del ${fechaCorta(pts[0].fecha)} al ${fechaCorta(pts[pts.length - 1].fecha)}: de ${f1(vals[0])} a ${f1(vals[vals.length - 1])} km²; mínimo ${f1(min)}, máximo ${f1(max)}`}>
        <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" className="cu-vs-linea" />
        {xy.map((p, i) => <circle key={pts[i].fecha} cx={p[0]} cy={p[1]} r={i === xy.length - 1 ? 3.6 : 2.4} className={`cu-vs-pto${pts[i].separacionDebil ? ' cu-vs-pto--debil' : ''}${i === xy.length - 1 ? ' cu-vs-pto--ult' : ''}`} />)}
      </svg>
      <figcaption className="cu-vs-ejes"><span>{fechaCorta(pts[0].fecha, false)}</span><span>mín {f1(min)} · máx {f1(max)} km²</span><span>{fechaCorta(pts[pts.length - 1].fecha, false)}</span></figcaption>
    </figure>
  );
}

function Plano({ cuerpo, huella, escena }: { cuerpo: CuerpoAgua; huella: HuellaVaso | undefined; escena: EscenaSatelital | undefined }) {
  const p = useMemo(() => proyeccionPara(huella?.anillos.length ? huella.anillos : (escena?.contorno ?? []), W, H, 10), [huella, escena]);
  if (!p) {
    return <div className="cu-vs-plano cu-vs-plano--sd" role="img" aria-label={`${cuerpo.etiqueta}: sin polígono del vaso`}><span>Sin polígono (KML pendiente)</span></div>;
  }
  const esc = longitudEscala(p.mPorPx, 56);
  return (
    <svg className="cu-vs-plano" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${cuerpo.etiqueta}: huella máxima del vaso${escena?.contorno.length ? ' y espejo de agua observado por satélite' : ', sin espejo observado todavía'}`}>
      {huella && <path d={rutaDeAnillos(huella.anillos, p)} fillRule="evenodd" className="cu-vs-huella" />}
      {escena?.contorno.length ? <path d={rutaDeAnillos(escena.contorno, p)} fillRule="evenodd" className="cu-vs-espejo" /> : null}
      <g transform={`translate(10 ${H - 12})`}>
        <line x1="0" x2={esc.px} y1="0" y2="0" className="cu-vs-escala" />
        <line x1="0" x2="0" y1="-3" y2="3" className="cu-vs-escala" /><line x1={esc.px} x2={esc.px} y1="-3" y2="3" className="cu-vs-escala" />
        <text x={esc.px + 5} y="4" className="cu-vs-txt">{esc.etiqueta}</text>
      </g>
      <text x={W - 12} y="16" textAnchor="end" className="cu-vs-txt">N ↑</text>
    </svg>
  );
}

type Orden = 'red' | 'reciente' | 'area';

/**
 * Vasos por satélite. Cada tarjeta dibuja la HUELLA máxima del vaso (polígono KMZ: nivel de diseño) y el ESPEJO de la última escena
 * Sentinel-2 sin nubes (NDWI a 10 m), dice qué tan vieja es esa escena y muestra su evolución en el periodo elegido. Junto al dato
 * satelital va la lectura de almacenamiento del día (telemetría), porque el satélite no pasa a diario. Sin medición no se inventa un
 * área. El volumen satelital no se muestra en esta vista (solo Boquilla y Madero tienen curva elevación–área–capacidad).
 */
export default function VasosSatelitalCuenca({ datos, aviso, hoyISO, hoy }: { datos: DatosCuerposAgua; aviso: string | null; hoyISO: string; hoy?: Map<string, VasoHoy> }) {
  const [periodo, setPeriodo] = useState<PeriodoVaso>(12);
  const [orden, setOrden] = useState<Orden>('red');

  const items = useMemo(() => datos.cuerpos.map((c) => {
    const serie = datos.escenas.get(c.idSerie) ?? [];
    const conArea = serie.filter((e) => e.areaKm2 != null);
    return { cuerpo: c, etiqueta: c.etiqueta, huella: datos.huellas.get(c.id), huellaKm2: datos.huellas.get(c.id)?.areaKm2 ?? null, serie, ultima: serie[serie.length - 1] as EscenaSatelital | undefined, anterior: conArea.length > 1 ? conArea[conArea.length - 2] : undefined };
  }), [datos]);
  const resumen = useMemo(() => resumenVasos(items, hoyISO), [items, hoyISO]);
  const lecturas = useMemo(() => lecturasVasos(items, hoyISO), [items, hoyISO]);
  const visibles = useMemo(() => {
    const l = [...items];
    if (orden === 'reciente') l.sort((a, b) => (b.ultima?.fecha ?? '').localeCompare(a.ultima?.fecha ?? ''));
    if (orden === 'area') l.sort((a, b) => (b.ultima?.areaKm2 ?? -1) - (a.ultima?.areaKm2 ?? -1));
    return l;
  }, [items, orden]);

  const edadReciente = resumen.masReciente ? diasDesde(diaLocal(resumen.masReciente), hoyISO) : null;
  // Próxima pasada: misma órbita de la escena más nueva, cada 5 días. Es una estimación (depende del satélite y de las nubes).
  const faltan = edadReciente == null ? null : (REVISITA_SENTINEL_DIAS - (edadReciente % REVISITA_SENTINEL_DIAS)) % REVISITA_SENTINEL_DIAS;

  return (
    <section className="an-card" id="cu-vasos" aria-label="Vasos por satélite">
      <div className="cu-red-cab">
        <div>
          <h4 className="an-h">Vasos por satélite</h4>
          <p className="an-nota">
            Huella máxima de cada vaso (línea punteada: nivel de diseño, no el de hoy) y espejo de agua de la última pasada de Sentinel-2 sin nubes (relleno). Cada plano está a su propia escala.
          </p>
        </div>
      </div>
      {aviso && <p className="an-aviso" role="status">{aviso}</p>}

      <div className="cu-kpis cu-kpis--4" role="list">
        <Kpi densidad="compacta" etiqueta="Espejo de agua observado" valor={f1(resumen.areaKm2)} unidad={resumen.areaKm2 != null ? ' km²' : undefined}
          contexto={resumen.medidos ? `${resumen.medidos} de ${resumen.vasos} vasos · escenas del ${fechaCorta(resumen.masAntigua as string, false)} al ${fechaCorta(resumen.masReciente as string, false)}` : 'Sin escenas procesadas'} />
        <Kpi densidad="compacta" etiqueta="De la huella máxima" valor={resumen.pctHuella == null ? 'S/D' : f1(resumen.pctHuella, 0)} unidad={resumen.pctHuella != null ? ' %' : undefined}
          contexto={resumen.huellaKm2 != null ? `de ${f1(resumen.huellaKm2)} km² de huella de diseño en los vasos medidos` : 'Sin huella de referencia'} />
        <Kpi densidad="compacta" etiqueta="Escena más reciente" valor={resumen.masReciente ? fechaCorta(resumen.masReciente, false) : 'S/D'}
          estado={edadReciente == null ? null : { tipo: edadReciente > ESCENA_ATRASADA_DIAS ? 'warn' : 'ok', texto: haceTxt(edadReciente) }}
          contexto={faltan == null ? 'Sin escenas' : `Sentinel-2 pasa cada ${REVISITA_SENTINEL_DIAS} días · próxima pasada estimada: ${faltan === 0 ? 'hoy' : `en ${faltan} día${faltan === 1 ? '' : 's'}`} · solo sirve sin nubes`} />
        <Kpi densidad="compacta" etiqueta="Vasos por atender" valor={String(resumen.vasos - resumen.medidos + resumen.atrasados + resumen.debiles)}
          estado={resumen.vasos - resumen.medidos + resumen.atrasados + resumen.debiles > 0 ? { tipo: 'warn', texto: 'Revisar' } : { tipo: 'ok', texto: 'Al día' }}
          contexto={`${resumen.vasos - resumen.medidos} sin medición · ${resumen.atrasados} con escena de más de ${ESCENA_ATRASADA_DIAS} días · ${resumen.debiles} poco confiables`} />
      </div>

      <LecturaCuenca lecturas={lecturas} />

      <div className="cu-controles" role="group" aria-label="Periodo y orden de los vasos">
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id="cu-vs-per">Periodo de la evolución</span>
          <div className="an-seg" role="group" aria-labelledby="cu-vs-per">
            {PERIODOS_VASO.map((p) => <button key={String(p.v)} type="button" className="an-seg-btn" aria-pressed={p.v === periodo} onClick={() => setPeriodo(p.v)}>{p.t}</button>)}
          </div>
        </div>
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id="cu-vs-ord">Orden</span>
          <div className="an-seg" role="group" aria-labelledby="cu-vs-ord">
            {([['red', 'Aguas arriba → abajo'], ['reciente', 'Más reciente'], ['area', 'Mayor espejo']] as [Orden, string][]).map(([v, t]) => <button key={v} type="button" className="an-seg-btn" aria-pressed={v === orden} onClick={() => setOrden(v)}>{t}</button>)}
          </div>
        </div>
      </div>

      <div className="cu-vs-grid">
        {visibles.map(({ cuerpo: c, huella, serie, ultima: ult, anterior: ant }) => {
          const enPeriodo = escenasEnPeriodo(serie, periodo, hoyISO);
          const pctHuella = ult?.areaKm2 != null && huella && huella.areaKm2 > 0 ? (ult.areaKm2 / huella.areaKm2) * 100 : null;
          const delta = ult?.areaKm2 != null && ant?.areaKm2 != null ? ult.areaKm2 - ant.areaKm2 : null;
          const edad = ult ? diasDesde(diaLocal(ult.fecha), hoyISO) : null;
          const h = hoy?.get(c.id);
          return (
            <article key={c.id} className="cu-vs-card" aria-label={c.etiqueta}>
              <header className="cu-vs-cab">
                <h5 className="cu-vs-nombre">{c.etiqueta}{c.rol !== 'almacenamiento' && <span className="cu-tag">{c.rol === 'reguladora' ? 'Reguladora' : 'Derivadora'}</span>}</h5>
                <span className={`cu-vs-edad cu-vs-edad--${edad == null ? 'sd' : edad > ESCENA_ATRASADA_DIAS ? 'warn' : 'ok'}`}>
                  <span aria-hidden="true">{edad == null ? '◇' : edad > ESCENA_ATRASADA_DIAS ? '▲' : '●'}</span> {edad == null ? 'Sin medición' : `Escena de ${haceTxt(edad)}`}
                </span>
              </header>
              <Plano cuerpo={c} huella={huella} escena={ult} />
              <div className="cu-vs-cifra">
                {ult?.areaKm2 != null
                  ? <><span className="cu-vs-num">{f1(ult.areaKm2, ult.areaKm2 < 10 ? 2 : 1)}<small> km²{ult.incertidumbreKm2 != null && ` ± ${f1(ult.incertidumbreKm2, 2)}`}</small></span><span className="cu-vs-sub">espejo del {fechaCorta(ult.fecha)}{pctHuella != null && ` · ${f1(pctHuella, 0)} % de la huella`}</span></>
                  : <><span className="cu-vs-num cu-vs-sd">S/D</span><span className="cu-vs-sub">Ninguna pasada sin nubes procesada todavía</span></>}
              </div>
              <dl className="cu-vs-datos">
                <div><dt>Huella máxima (KMZ)</dt><dd>{huella ? `${f1(huella.areaKm2)} km²` : 'S/D'}{huella && huella.numIslas > 0 && <small> · {huella.numIslas} isla{huella.numIslas === 1 ? '' : 's'}</small>}</dd></div>
                {delta != null && ant && <div><dt>Cambio vs. {fechaCorta(ant.fecha, false)}</dt><dd>{con(delta, Math.abs(delta) < 10 ? 2 : 1)} km²{ant.areaKm2 ? <small> · {con((delta / (ant.areaKm2 as number)) * 100, 0)} %</small> : null}</dd></div>}
                {ult?.nubesVasoPct != null && ult.nubesVasoPct > 0.5 && <div><dt>Nubes sobre el vaso</dt><dd>{f1(ult.nubesVasoPct, 1)} %</dd></div>}
                <div>
                  <dt>Almacenamiento del día (telemetría)</dt>
                  <dd>{h?.almMm3 != null ? <>{f1(h.almMm3)} Mm³{h.pct != null && <small> · {f1(h.pct)} %</small>}{h.fecha && <small> · {new Date(`${h.fecha}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</small>}</> : <span className="cu-vs-sd">S/D</span>}</dd>
                </div>
              </dl>
              {ult?.separacionDebil && <p className="cu-vs-aviso">◐ Agua y tierra poco separables en esta escena: el área es orientativa.</p>}
              <SerieArea escenas={enPeriodo} nombre={c.etiqueta} />
              <p className="cu-vs-pie">{enPeriodo.length} escena{enPeriodo.length === 1 ? '' : 's'} en el periodo · {serie.length} en total</p>
            </article>
          );
        })}
      </div>
      <p className="an-nota cu-bal-pie">
        <b>Por qué no hay dato satelital de hoy:</b> Sentinel-2 pasa sobre cada vaso cada {REVISITA_SENTINEL_DIAS} días y la medición necesita una pasada con 3 % de nubes o menos sobre el vaso; con cielo nublado el dato se queda en la última pasada limpia.
        El dato de hoy es el almacenamiento de telemetría que acompaña a cada tarjeta. El volumen por satélite no se muestra aquí: solo La Boquilla y F. I. Madero tienen curva elevación–área–capacidad; en los demás vasos es S/D hasta contar con una. El punto hueco de la serie marca una escena poco confiable.
      </p>
    </section>
  );
}
