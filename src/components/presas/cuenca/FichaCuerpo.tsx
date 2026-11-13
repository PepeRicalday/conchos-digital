import { useMemo, useState, type ReactNode } from 'react';
import { Campo, Selector } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import { DESCRIPCION_CALIDAD, ETIQUETA_CALIDAD, GLIFO_CALIDAD, etiquetaMes } from '../../../utils/cuerposAgua';
import { fichaCuerpo, type DatosFicha, type HoyFicha } from '../../../utils/fichaCuerpo';
import type { Anotacion } from '../../../utils/anotacionesCuenca';

const n = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const ROL: Record<string, string> = { almacenamiento: 'Presa de almacenamiento', reguladora: 'Presa reguladora', derivadora: 'Presa derivadora' };

function Dato({ t, children, nota }: { t: string; children: ReactNode; nota?: ReactNode }) {
  return <div className="cu-sis-hecho"><dt>{t}</dt><dd>{children}{nota && <span className="cu-sis-hecho-nota">{nota}</span>}</dd></div>;
}

/**
 * Ficha única por cuerpo de agua: identidad, lectura del día, último cierre y sus fuentes, espejo satelital, último balance completo
 * y captura manual. Cada dato lleva su fecha y su origen; lo que no existe dice S/D y no se rellena con el de otro mes.
 */
export default function FichaCuerpo({ datos, hoy, anotaciones }: { datos: DatosFicha; hoy: Map<string, HoyFicha>; anotaciones: Anotacion[] }) {
  const [id, setId] = useState<string>(() => datos.cuerpos[0]?.id ?? '');
  const f = useMemo(() => fichaCuerpo(datos, id, hoy.get(id), anotaciones), [datos, id, hoy, anotaciones]);
  if (!datos.cuerpos.length) return null;

  return (
    <section className="an-card" id="cu-ficha" aria-label="Ficha por cuerpo de agua">
      <h4 className="an-h">Ficha por cuerpo de agua</h4>
      <p className="an-nota">Todo lo que se sabe de un cuerpo en un solo lugar, con la fecha y la fuente de cada dato.</p>
      <div className="cu-ficha-sel">
        <Campo etiqueta="Cuerpo de agua">
          {(a) => <Selector {...a} value={id} onChange={(e) => setId(e.target.value)}>{datos.cuerpos.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}</Selector>}
        </Campo>
      </div>
      {f && (
        <div className="cu-ficha-grid">
          <div className="cu-ficha-col">
            <h5 className="an-h an-h--pie cu-cm-sub">Identidad</h5>
            <dl className="cu-sis-hechos">
              <Dato t="Tipo">{ROL[f.cuerpo.rol] ?? f.cuerpo.rol}{f.cuerpo.distritoRiego ? ` · Distrito de Riego ${f.cuerpo.distritoRiego}` : ''}</Dato>
              <Dato t="Corriente">{f.cuerpo.corriente ?? 'S/D'}{f.cuerpo.estado ? ` · ${f.cuerpo.estado}` : ''}</Dato>
              <Dato t="NAMO de referencia" nota={f.cuerpo.namoRefFuente ?? undefined}>{f.cuerpo.namoRefMm3 == null ? 'S/D' : `${n(f.cuerpo.namoRefMm3, 1)} Mm³`}</Dato>
              <Dato t="Descarga a">{f.aguasAbajo ?? 'La salida de la cuenca'}</Dato>
              <Dato t="Registro">{f.cobertura.conDato} de {f.cobertura.total} cierres mensuales con cifra</Dato>
            </dl>
          </div>
          <div className="cu-ficha-col">
            <h5 className="an-h an-h--pie cu-cm-sub">Nivel</h5>
            <dl className="cu-sis-hechos">
              <Dato t="Lectura del día" nota={f.hoy ? undefined : 'No tiene telemetría diaria'}>
                {f.hoy == null ? 'Sin telemetría' : f.hoy.almMm3 == null ? 'S/D' : `${n(f.hoy.almMm3, 1)} Mm³ · ${f.hoy.pct == null ? 'S/D' : `${n(f.hoy.pct, 1)} %`}`}
                {f.hoy?.fecha ? ` · ${fechaCorta(f.hoy.fecha)}` : ''}
              </Dato>
              <Dato t="Último cierre" nota={f.ultimoCierre ? `${GLIFO_CALIDAD[f.ultimoCierre.calidad]} ${ETIQUETA_CALIDAD[f.ultimoCierre.calidad]}. ${DESCRIPCION_CALIDAD[f.ultimoCierre.calidad]}` : undefined}>
                {f.ultimoCierre
                  ? <>{etiquetaMes(f.ultimoCierre.mes, true)} · {n(f.ultimoCierre.almMm3, 1)} Mm³ · {f.ultimoCierre.pct == null ? 'S/D' : `${n(f.ultimoCierre.pct, 1)} %`}{f.ultimoCierre.vencido && <b className="cu-tag cu-tag--aviso">Vencido</b>}</>
                  : 'Sin cierre con cifra (S/D)'}
              </Dato>
              {f.ultimoCierre && f.ultimoCierre.fuentes.length > 1 && (
                <Dato t="Fuentes de ese cierre">{f.ultimoCierre.fuentes.map((x) => `${x.fuente}: ${n(x.almMm3, 2)} Mm³`).join(' · ')}</Dato>
              )}
              {f.captura && (
                <Dato t="Captura manual" nota={`Origen: ${f.captura.origen ?? 'S/D'}${f.captura.autor ? ` · anotó ${f.captura.autor}` : ''}. Aún no entra a los cierres.`}>
                  {f.captura.almMm3 != null ? `${n(f.captura.almMm3, 2)} Mm³` : f.captura.elevMsnm != null ? `${n(f.captura.elevMsnm, 2)} msnm` : 'S/D'} · {fechaCorta(f.captura.fecha)}
                </Dato>
              )}
            </dl>
          </div>
          <div className="cu-ficha-col">
            <h5 className="an-h an-h--pie cu-cm-sub">Satélite y balance</h5>
            <dl className="cu-sis-hechos">
              <Dato t="Espejo (Sentinel-2)" nota={f.satelite?.escena.separacionDebil ? 'Separación débil agua/tierra: la cifra es poco confiable.' : f.satelite ? `${f.satelite.escenas} escenas en la serie` : undefined}>
                {f.satelite ? <>{n(f.satelite.escena.areaKm2, 2)} km²{f.satelite.escena.incertidumbreKm2 != null ? ` ± ${n(f.satelite.escena.incertidumbreKm2, 2)}` : ''} · {fechaCorta(f.satelite.escena.fecha.slice(0, 10))}</> : 'Sin escena (S/D)'}
              </Dato>
              <Dato t="Contra la huella máxima" nota={f.satelite?.huellaKm2 != null ? `Huella de diseño: ${n(f.satelite.huellaKm2, 2)} km²` : undefined}>
                {f.satelite?.llenadoPct == null ? 'S/D' : `${n(f.satelite.llenadoPct, 1)} %`}
              </Dato>
              <Dato t="Último balance completo" nota={f.balance ? 'Mes con cobertura de flujos suficiente' : undefined}>
                {f.balance
                  ? <>{etiquetaMes(f.balance.mes, true)} · entra {n(f.balance.entradas)} · sale {n(f.balance.salida)} Mm³{f.balance.evap != null ? ` · evap. ${n(f.balance.evap)} Mm³` : ''}{f.balance.residuo != null ? ` · residuo ${n(f.balance.residuo)} Mm³` : ''}</>
                  : 'Sin mes completo (S/D)'}
              </Dato>
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}
