import { useMemo } from 'react';
import { formatearNumero } from '../../../utils/historicoPresas';
import { longitudEscala, proyeccionPara, rutaDeAnillos, type CuerpoAgua } from '../../../utils/cuerposAgua';
import type { DatosCuerposAgua, EscenaSatelital, HuellaVaso } from '../../../hooks/useCuerposAgua';

const W = 250, H = 170;
const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Chihuahua' });
const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));

/** Mini-serie del área del espejo por escena. Con una sola escena no hay serie: no se dibuja. */
function SerieArea({ escenas }: { escenas: EscenaSatelital[] }) {
  const pts = escenas.filter((e) => e.areaKm2 != null);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((e) => e.areaKm2 as number)), min = Math.min(...pts.map((e) => e.areaKm2 as number));
  const w = 120, h = 30, rango = Math.max(max - min, 1e-6);
  const d = pts.map((e, i) => `${(i / (pts.length - 1)) * (w - 4) + 2},${h - 3 - (((e.areaKm2 as number) - min) / rango) * (h - 6)}`).join(' ');
  return (
    <svg className="cu-vs-serie" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Área del espejo en ${pts.length} escenas: de ${f1(pts[0].areaKm2)} a ${f1(pts[pts.length - 1].areaKm2)} km²`}>
      <polyline points={d} fill="none" className="cu-vs-linea" />
    </svg>
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

/**
 * Vasos por satélite. Cada tarjeta dibuja la HUELLA máxima del vaso (polígono KMZ del inventario de presas: nivel de diseño, no el
 * espejo de hoy) y, si ya hay medición, el ESPEJO de agua de la última escena Sentinel-2 (NDWI a 10 m), cada uno a su escala.
 * Sin medición no se inventa un área: se dice «aún sin medición satelital». El volumen satelital es S/D mientras el cuerpo no tenga
 * curva elevación–área–capacidad.
 */
export default function VasosSatelitalCuenca({ datos, aviso }: { datos: DatosCuerposAgua; aviso: string | null }) {
  const medidos = datos.cuerpos.filter((c) => (datos.escenas.get(c.idSerie)?.length ?? 0) > 0).length;
  return (
    <section className="an-card" id="cu-vasos" aria-label="Vasos por satélite">
      <h4 className="an-h">Vasos por satélite</h4>
      <p className="an-nota">
        Huella máxima de cada vaso (línea punteada, polígono KMZ del inventario de presas) y espejo de agua observado por Sentinel-2 (relleno). La huella es el nivel de diseño, no el nivel de hoy.
        {' '}{medidos} de {datos.cuerpos.length} vasos tienen medición satelital; el resto está pendiente de la primera corrida. Cada plano está a su propia escala.
      </p>
      {aviso && <p className="an-aviso" role="status">{aviso}</p>}
      <div className="cu-vs-grid">
        {datos.cuerpos.map((c) => {
          const huella = datos.huellas.get(c.id);
          const serie = datos.escenas.get(c.idSerie) ?? [];
          const ult = serie.length ? serie[serie.length - 1] : undefined;
          const ant = serie.length > 1 ? serie[serie.length - 2] : undefined;
          const pctHuella = ult?.areaKm2 != null && huella && huella.areaKm2 > 0 ? (ult.areaKm2 / huella.areaKm2) * 100 : null;
          const delta = ult?.areaKm2 != null && ant?.areaKm2 != null ? ult.areaKm2 - ant.areaKm2 : null;
          return (
            <article key={c.id} className="cu-vs-card" aria-label={c.etiqueta}>
              <h5 className="cu-vs-nombre">{c.etiqueta}{c.rol !== 'almacenamiento' && <span className="cu-tag">{c.rol === 'reguladora' ? 'Reguladora' : 'Derivadora'}</span>}</h5>
              <Plano cuerpo={c} huella={huella} escena={ult} />
              <dl className="cu-vs-datos">
                <div><dt>Huella máxima (KMZ)</dt><dd>{huella ? `${f1(huella.areaKm2)} km²` : 'S/D'}{huella && huella.numIslas > 0 && <small> · {huella.numIslas} isla{huella.numIslas === 1 ? '' : 's'}</small>}</dd></div>
                <div>
                  <dt>Espejo observado</dt>
                  <dd>
                    {ult?.areaKm2 != null
                      ? <>{f1(ult.areaKm2)}{ult.incertidumbreKm2 != null && <small> ± {f1(ult.incertidumbreKm2, 2)}</small>} km²<small> · {fechaCorta(ult.fecha)}</small></>
                      : <span className="cu-vs-sd">Aún sin medición satelital</span>}
                  </dd>
                </div>
                {pctHuella != null && <div><dt>De la huella máxima</dt><dd>{f1(pctHuella, 0)} %</dd></div>}
                {delta != null && <div><dt>Cambio vs. escena anterior</dt><dd>{delta > 0 ? '+' : delta < 0 ? '−' : ''}{f1(Math.abs(delta))} km²</dd></div>}
                {ult?.nubesVasoPct != null && <div><dt>Nubes sobre el vaso</dt><dd>{f1(ult.nubesVasoPct, 1)} %</dd></div>}
                <div><dt>Volumen satelital</dt><dd><span className="cu-vs-sd">S/D</span><small> · sin curva elevación–área–capacidad</small></dd></div>
              </dl>
              <SerieArea escenas={serie} />
              {serie.length > 1 && <p className="cu-vs-pie">{serie.length} escenas observadas</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
