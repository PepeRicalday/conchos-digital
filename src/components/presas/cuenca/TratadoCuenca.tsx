import { useMemo, useState } from 'react';
import { DataTable, Kpi, type Columna } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { csvTabla } from '../../../utils/cuerposAgua';
import {
  afAMm3, avanceCiclo, brechaOficialVsPublicado, concilia, fechaLargaTratado, fmtAf, lecturaAvance, rangoAnioCiclo,
  resuelvePeriodo, serieAcumuladaPublicada, volumenMensual, volumenPeriodo, anioDelCiclo,
  type FuenteConciliacion, type PeriodoSel, type VolumenAfluente,
} from '../../../utils/tratadoCiclo';
import { PALETA_PANTALLA, svgAvance, svgBarraAvance, svgMensual } from '../../../utils/tratadoGraficas';
import type { useTratadoCiclo } from '../../../hooks/useTratadoCiclo';
import BotonCsv from './BotonCsv';
import BotonInformeTratado from '../../BotonInformeTratado';
import CapturaTratadoMx from './CapturaTratadoMx';
import SelectorPeriodoTratado from './SelectorPeriodoTratado';
import './tratado.css';

const f1 = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const af0 = (v: number | null) => (v == null ? 'S/D' : fmtAf(v));
const sgn = (v: number | null, d = 0) => (v == null ? 'S/D' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), d)}`);

/**
 * Avance del Tratado de Aguas de 1944 en el ciclo 2025-2030 (25-oct-2025 → 24-oct-2030): el acumulado oficial del IBWC contra el
 * compromiso de 350,000 AF anuales (1,750,000 AF por ciclo), el volumen de los seis afluentes mexicanos y la conciliación de lo que
 * miden EUA (IBWC) y México (SICA y CONAGUA/CILA). La sincronización con el IBWC es automática, tres veces al día.
 */
export default function TratadoCuenca({ tratado, hoyISO }: { tratado: ReturnType<typeof useTratadoCiclo>; hoyISO: string }) {
  const { datos, error, recargar } = tratado;
  const [sel, setSel] = useState<PeriodoSel>({ tipo: 'ciclo' });

  const ciclo = datos?.ciclo;
  const av = useMemo(() => (datos ? avanceCiclo(datos.ciclo, datos.cortes) : null), [datos, hoyISO]);
  const per = useMemo(() => (ciclo ? resuelvePeriodo(ciclo, sel, hoyISO) : null), [ciclo, sel, hoyISO]);
  const vol = useMemo(() => (datos && per ? volumenPeriodo(datos.entregas, datos.afluentes, per.desde, per.hasta) : null), [datos, per]);
  const conc = useMemo(() => (datos && vol ? concilia(vol, datos.sutron, datos.capturas, datos.entregas) : null), [datos, vol]);
  const mensual = useMemo(() => (datos && per ? volumenMensual(datos.entregas, per.desde, per.hasta) : []), [datos, per]);
  const brecha = useMemo(() => (datos && av ? brechaOficialVsPublicado(datos.entregas, datos.ciclo, av.corte) : null), [datos, av]);

  if (error && !datos) {
    return <div className="an-vacio" role="alert"><strong>No se pudo cargar el avance del Tratado</strong><span>{error} <button type="button" className="an-btn an-btn--chico" onClick={recargar}>Reintentar</button></span></div>;
  }
  if (!datos || !ciclo || !av || !per || !vol || !conc) return <div className="an-skeleton" role="status" aria-busy="true" aria-label="Cargando avance del Tratado" />;

  const dominio = sel.tipo === 'ciclo' ? { desde: ciclo.inicio, hasta: ciclo.fin }
    : sel.tipo === 'anio' ? rangoAnioCiclo(ciclo, sel.anio) : { desde: per.desde, hasta: per.hasta };
  const publicada = serieAcumuladaPublicada(datos.entregas, ciclo.inicio, hoyISO);
  const svgA = svgAvance({ ciclo, dominioDesde: dominio.desde, dominioHasta: dominio.hasta, publicada, cortes: datos.cortes, paleta: PALETA_PANTALLA, mostrarDeuda: sel.tipo === 'ciclo', hoy: hoyISO });
  const svgM = svgMensual({ filas: mensual, afluentes: datos.afluentes, paleta: PALETA_PANTALLA });
  const anio = av.corte ? anioDelCiclo(ciclo, av.corte.fecha) : null;
  const sicaFuera = !conc.sicaConfiable && conc.razonSicaIbwc != null;

  const columnasAfl: Columna<VolumenAfluente>[] = [
    { id: 'a', titulo: 'Afluente', encabezadoFila: true, render: (a) => { const k = datos.afluentes.findIndex((x) => x.clave === a.clave); return <><span className="tr-sw" style={{ background: PALETA_PANTALLA.afluentes[k % 6] }} aria-hidden="true" /><span className="cu-nombre">{a.nombre}</span><span className="cu-nota-fila">{a.estacion}</span></>; } },
    { id: 'mm3', titulo: 'Mm³', numerica: true, render: (a) => f1(a.mm3, 2) },
    { id: 'af', titulo: 'Acre-pies', numerica: true, render: (a) => af0(a.af) },
    { id: 'pct', titulo: '% del total', numerica: true, render: (a) => (a.af != null && vol.totalAf > 0 ? `${((a.af / vol.totalAf) * 100).toFixed(1)} %` : 'S/D') },
    { id: 'cob', titulo: 'Días con dato', numerica: true, render: (a) => `${a.dias} de ${a.diasPeriodo}` },
  ];
  const columnasCon: Columna<FuenteConciliacion>[] = [
    { id: 'f', titulo: 'Fuente', encabezadoFila: true, render: (f) => <><span className="cu-nombre">{f.nombre}</span><span className="cu-nota-fila">{f.nota}</span></> },
    { id: 'mm3', titulo: 'Mm³', numerica: true, render: (f) => f1(f.mm3, 2) },
    { id: 'af', titulo: 'Acre-pies', numerica: true, render: (f) => af0(f.af) },
    { id: 'cob', titulo: 'Cobertura', numerica: true, render: (f) => (f.cobertura == null ? '—' : `${f.cobertura.toFixed(0)} %`) },
  ];

  const csv = () => csvTabla(['periodo', 'afluente', 'estacion', 'mm3', 'acre_pies', 'dias_con_dato', 'dias_periodo'],
    vol.afluentes.map((a) => [per.etiqueta, a.nombre, a.estacion, a.mm3, a.af, a.dias, a.diasPeriodo]));

  const estadoKpi = av.estado === 'sd' ? null : av.estado === 'adelante' ? { tipo: 'ok' as const, texto: 'Por delante de la meta' } : av.estado === 'en_meta' ? { tipo: 'ok' as const, texto: 'En la meta lineal' } : { tipo: 'warn' as const, texto: 'Por debajo de la meta' };

  return (
    <div className="tr-root" id="cu-tratado">
      <div className="cu-red-cab">
        <p className="an-nota tr-lectura">{lecturaAvance(av)}</p>
        <BotonInformeTratado datos={datos} hoyISO={hoyISO} />
      </div>

      <div className="cu-kpis cu-kpis--4" role="list">
        <Kpi densidad="compacta" etiqueta="Entregado en el ciclo (IBWC)" valor={af0(av.acumuladoAf)} unidad={av.acumuladoAf != null ? ' AF' : undefined}
          contexto={av.acumuladoMm3 != null ? `${f1(av.acumuladoMm3, 1)} Mm³ · ${av.pctCompromiso?.toFixed(1)} % de ${fmtAf(ciclo.compromisoAf)} AF · corte ${av.corte ? fechaLargaTratado(av.corte.fecha) : ''}` : 'Sin corte oficial'} />
        <Kpi densidad="compacta" etiqueta="Contra la meta lineal" valor={sgn(av.difLinealAf)} unidad={av.difLinealAf != null ? ' AF' : undefined} estado={estadoKpi}
          contexto={av.metaLinealAf != null ? `meta al corte: ${fmtAf(av.metaLinealAf)} AF · año ${anio ?? '—'} de 5` : 'S/D'} />
        <Kpi densidad="compacta" etiqueta="Falta para el compromiso" valor={af0(av.faltanteAf)} unidad={av.faltanteAf != null ? ' AF' : undefined}
          contexto={av.ritmoRequeridoAfDia != null ? `${fmtAf(av.ritmoRequeridoAfDia * 7)} AF por semana (${f1(av.ritmoRequeridoM3s, 2)} m³/s medios) durante ${fmtAf(av.diasRestantes ?? 0)} días` : 'S/D'} />
        <Kpi densidad="compacta" etiqueta="Deuda del ciclo anterior" valor={af0(av.deudaRemanenteAf)} unidad={av.deudaRemanenteAf != null ? ' AF' : undefined}
          contexto={ciclo.deudaPreviaAf != null ? `cerró con ${fmtAf(ciclo.deudaPreviaAf)} AF de déficit (${f1(afAMm3(ciclo.deudaPreviaAf), 1)} Mm³)` : 'S/D'} />
      </div>
      <div className="tr-barra" aria-hidden={av.pctCompromiso == null}>
        <span className="tr-barra-et">Avance del compromiso</span>
        <span className="tr-barra-svg" dangerouslySetInnerHTML={{ __html: svgBarraAvance(av.pctCompromiso, av.metaLinealAf != null ? (av.metaLinealAf / ciclo.compromisoAf) * 100 : null, PALETA_PANTALLA, 520) }} />
        <span className="tr-barra-val">{av.pctCompromiso != null ? `${av.pctCompromiso.toFixed(1)} %` : 'S/D'} <small>marca roja = meta lineal</small></span>
      </div>
      {av.deltaAf != null && av.deltaDias != null && av.cortePrevio && (
        <p className="an-nota tr-delta">
          <b>Último cambio:</b> {sgn(av.deltaAf)} AF en {av.deltaDias} días (corte del {fechaLargaTratado(av.cortePrevio.fecha)} al {fechaLargaTratado(av.corte!.fecha)})
          {av.deltaAfSemana != null && <> · {sgn(av.deltaAfSemana)} AF por semana</>}
        </p>
      )}

      <SelectorPeriodoTratado ciclo={ciclo} valor={sel} onChange={setSel} hoyISO={hoyISO} />
      <p className="an-nota">Periodo: <b>{per.etiqueta}</b>{per.hasta < per.desde && ' · sin días transcurridos todavía'}</p>

      <section className="an-card tr-graf" aria-label="Avance acumulado del ciclo">
        <h5 className="an-h an-h--pie cu-cm-sub">Avance acumulado contra la meta</h5>
        <div dangerouslySetInnerHTML={{ __html: svgA }} />
        <ul className="tr-leyenda" aria-label="Leyenda de la gráfica">
          <li><span className="tr-ley tr-ley--oficial" aria-hidden="true" /> Acumulado oficial IBWC (corte semanal)</li>
          <li><span className="tr-ley tr-ley--pub" aria-hidden="true" /> Suma de las series publicadas (con huecos)</li>
          <li><span className="tr-ley tr-ley--meta" aria-hidden="true" /> Meta lineal (350,000 AF por año)</li>
          {sel.tipo === 'ciclo' && <li><span className="tr-ley tr-ley--deuda" aria-hidden="true" /> Meta lineal con la deuda 2020-2025</li>}
        </ul>
        {brecha && (
          <p className="an-nota">
            <b>Por qué hay dos curvas:</b> al {fechaLargaTratado(av.corte!.fecha)} el IBWC reporta {fmtAf(brecha.oficialAf)} AF, pero las series públicas de los seis afluentes suman {fmtAf(brecha.publicadoAf)} AF
            ({brecha.pct.toFixed(0)} % menos): tienen días sin dato (S/D) y el corte oficial incluye «otras fuentes aceptadas». La cifra oficial es la del compromiso; la otra sirve para ver qué afluente y qué mes aportan.
          </p>
        )}
      </section>

      <section className="an-card tr-graf" aria-label="Volumen mensual por afluente">
        <div className="cu-red-cab">
          <h5 className="an-h an-h--pie cu-cm-sub">Volumen mensual por afluente · {per.etiqueta}</h5>
          <BotonCsv nombre={`tratado-1944-afluentes-${per.clave}.csv`} generar={csv} />
        </div>
        <div dangerouslySetInnerHTML={{ __html: svgM }} />
        <ul className="tr-leyenda" aria-label="Afluentes">
          {datos.afluentes.map((a, k) => <li key={a.clave}><span className="tr-sw" style={{ background: PALETA_PANTALLA.afluentes[k % 6] }} aria-hidden="true" /> {a.nombre}</li>)}
        </ul>
        <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Volumen por afluente en el periodo (desplazable)" captionOculto caption={`Volumen por afluente, ${per.etiqueta}`} clave={(a) => a.clave} filas={vol.afluentes} columnas={columnasAfl} />
        <p className="an-nota">
          <b>Total del periodo (series publicadas):</b> {af0(vol.totalAf > 0 ? vol.totalAf : null)} AF · {f1(vol.totalAf > 0 ? vol.totalMm3 : null, 1)} Mm³
          {vol.cotaInferior && vol.totalAf > 0 && ' — cota inferior: hay días sin dato'}.
        </p>
      </section>

      <section className="an-card" aria-label="Conciliación de fuentes">
        <h5 className="an-h an-h--pie cu-cm-sub">Conciliación: EUA contra México · {per.etiqueta}</h5>
        <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Conciliación de fuentes (desplazable)" captionOculto caption="Conciliación EUA contra México" clave={(f) => f.clave} filas={conc.fuentes} columnas={columnasCon} />
        <ul className="tr-concl">
          <li>Conchos medido por SICA frente al IBWC: <b>{conc.razonSicaIbwc != null ? `${conc.razonSicaIbwc.toFixed(1)}×` : 'S/D'}</b>{conc.difSicaIbwcMm3 != null && <> ({sgn(conc.difSicaIbwcMm3, 1)} Mm³)</>}{conc.diasComunesSica > 0 ? `, comparado solo en los ${conc.diasComunesSica} días con dato de ambos` : ' (sin días con dato de ambos)'}.</li>
          <li>Cifra oficial CONAGUA frente a la suma del IBWC: <b>{conc.difConaguaIbwcMm3 != null ? `${sgn(conc.difConaguaIbwcMm3, 1)} Mm³ (${sgn(conc.difConaguaIbwcPct, 1)} %)` : 'S/D — falta capturarla'}</b>.</li>
        </ul>
        {sicaFuera && <p className="an-aviso" role="status"><b>El Sutron de Ojinaga no es confiable para gasto:</b> mide {conc.razonSicaIbwc?.toFixed(1)} veces lo que el aforo oficial en los mismos días. No se corrige ni se oculta; se muestra como brecha hasta calibrar su curva de gasto.</p>}
      </section>

      <CapturaTratadoMx capturas={datos.capturas} hoyISO={hoyISO} onCambio={recargar} />

      <p className="an-nota cu-bal-pie">
        <b>Fuente y actualización:</b> USIBWC Water Data (series públicas, datos provisionales) y el corte semanal «Current_Cycle.pdf». Se sincroniza solo, tres veces al día
        {datos.ultimaSync ? <> · última corrida {datos.ultimaSync.ok ? 'correcta' : 'con error'}: {new Date(datos.ultimaSync.en).toLocaleString('es-MX', { timeZone: 'America/Chihuahua' })}</> : ''}.
        {datos.fallos.length > 0 && <> No se pudo leer: {datos.fallos.join('; ')}.</>}
      </p>
    </div>
  );
}
