import { useMemo, useState } from 'react';
import { DataTable, type Columna } from '../../ui/base';
import { guardaOComparte } from '../../../utils/descargaArchivo';
import { formatearNumero } from '../../../utils/historicoPresas';
import {
  aniosDisponibles, celdaCierre, coberturaDeCuerpo, csvCierres, DESCRIPCION_CALIDAD, ETIQUETA_CALIDAD, etiquetaMes, GLIFO_CALIDAD, indexarCierres,
  mesesDe, METRICAS, NOMBRE_FUENTE, SIGLA_FUENTE, ultimoCierreConDato, type CierreMensual, type CuerpoAgua, type FuenteAlm, type Metrica,
} from '../../../utils/cuerposAgua';
import type { DatosCuerposAgua } from '../../../hooks/useCuerposAgua';

const fmt = (v: number | null, d = 3) => (v == null ? 'S/D' : formatearNumero(v, d));
const fechaLarga = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : 'S/D');

interface FilaResumen { cuerpo: CuerpoAgua; cierres: CierreMensual[] }

/** Cuadre de un cierre: el valor de cada fuente que tuvo dato ese mes, con la elegida marcada. */
function DetalleCierre({ cuerpo, c }: { cuerpo: CuerpoAgua; c: CierreMensual | undefined }) {
  if (!c) return null;
  const fuentes: { clave: 'srl' | 'sina' | 'aqwp'; fuente: FuenteAlm }[] = [{ clave: 'srl', fuente: 'SRL' }, { clave: 'sina', fuente: 'SINA' }, { clave: 'aqwp', fuente: 'AQWP' }];
  const tiene = fuentes.filter((f) => c.detalle[f.clave]);
  return (
    <div className="cu-cm-det" role="region" aria-label={`Cuadre de fuentes de ${cuerpo.etiqueta}, ${etiquetaMes(c.mes, true)}`}>
      <h5 className="cu-cm-det-t">{cuerpo.etiqueta} · cierre de {etiquetaMes(c.mes, true)}</h5>
      <p className={`cu-cm-cal cu-cm-cal--${c.calidad}`}><span aria-hidden="true">{GLIFO_CALIDAD[c.calidad]}</span> <b>{ETIQUETA_CALIDAD[c.calidad]}.</b> {DESCRIPCION_CALIDAD[c.calidad]}</p>
      {c.almMm3 != null ? (
        <p className="cu-cm-res">
          Valor elegido: <b>{fmt(c.almMm3)} Mm³</b>{c.pctNamo != null && <> · {formatearNumero(c.pctNamo, 1)} % del NAMO declarado ({fmt(c.namoRefMm3, 3)} Mm³)</>}
          {c.elevMsnm != null && <> · {formatearNumero(c.elevMsnm, 2)} msnm</>} · dato del {fechaLarga(c.fechaDato)}
        </p>
      ) : <p className="cu-cm-res">Sin dato de almacenamiento en ninguna fuente cerca del fin de mes (S/D).</p>}
      {tiene.length > 0 && (
        <DataTable
          propia className="cu-tabla cu-cm-fuentes" claseContenedor="cu-tabla-wrap" captionOculto caption="Valor de cada fuente"
          clave={(f) => f.clave} filas={tiene}
          columnas={[
            { id: 'f', titulo: 'Fuente', encabezadoFila: true, render: (f) => <>{NOMBRE_FUENTE[f.fuente]}{f.fuente === c.fuenteAlm && <span className="cu-tag">Elegida</span>}{f.clave === 'srl' && c.detalle.srl?.origen && <span className="cu-nota-fila">origen: {c.detalle.srl.origen.toLowerCase()}</span>}</> },
            { id: 'd', titulo: 'Dato del', render: (f) => fechaLarga(c.detalle[f.clave]?.fecha ?? null) },
            { id: 'a', titulo: 'Almacenamiento (Mm³)', numerica: true, render: (f) => fmt(c.detalle[f.clave]?.almacenamiento ?? null) },
            { id: 'e', titulo: 'Elevación (msnm)', numerica: true, render: (f) => fmt(c.detalle[f.clave]?.elevacion ?? null, 2) },
            {
              id: 'x', titulo: 'Diferencia', numerica: true, render: (f) => {
                const v = c.detalle[f.clave]?.almacenamiento, ref = c.almMm3;
                if (v == null || ref == null || f.fuente === c.fuenteAlm) return '—';
                const d = v - ref;
                return `${d > 0 ? '+' : d < 0 ? '−' : ''}${formatearNumero(Math.abs(d), 3)}`;
              },
            },
          ] as Columna<{ clave: 'srl' | 'sina' | 'aqwp'; fuente: FuenteAlm }>[]}
        />
      )}
      {c.areaSatKm2 != null && <p className="cu-cm-res">Espejo satelital de ese mes: {formatearNumero(c.areaSatKm2, 1)} km².</p>}
    </div>
  );
}

/**
 * Cierre de mes de los cuerpos de agua de la cuenca, 2021 → hoy. Cada celda trae el valor elegido, la sigla de la fuente y el estado
 * de calidad (glifo + texto: el color nunca va solo). Un mes sin dato es S/D con trama, nunca 0. Al tocar una celda se ve el cuadre
 * de todas las fuentes. La precedencia está congelada en la base (cuerpos_agua_cierre_mensual): aquí solo se presenta.
 */
export default function CierresMensualesCuenca({ datos }: { datos: DatosCuerposAgua }) {
  const { cuerpos, cierres } = datos;
  const anios = useMemo(() => aniosDisponibles(cierres), [cierres]);
  const [anio, setAnio] = useState<number | 'todo'>(() => anios[0] ?? new Date().getFullYear());
  const [metrica, setMetrica] = useState<Metrica>('mm3');
  const [sel, setSel] = useState<{ cuerpoId: string; mes: string } | null>(null);
  const [errorCsv, setErrorCsv] = useState<string | null>(null);

  const idx = useMemo(() => indexarCierres(cierres), [cierres]);
  const meses = useMemo(() => mesesDe(cierres, anio === 'todo' ? null : anio), [cierres, anio]);
  const resumen: FilaResumen[] = useMemo(() => cuerpos.map((cuerpo) => ({ cuerpo, cierres: cierres.filter((c) => c.cuerpoId === cuerpo.id) })), [cuerpos, cierres]);
  const cuerpoSel = sel ? cuerpos.find((c) => c.id === sel.cuerpoId) : undefined;

  if (!cuerpos.length || !cierres.length) {
    return (
      <section className="an-card" id="cu-cierres" aria-label="Cierres mensuales de los cuerpos de agua">
        <h4 className="an-h">Cierres mensuales · 2021 → hoy</h4>
        <div className="an-vacio" role="status"><strong>Sin cierres mensuales por ahora (S/D)</strong><span>Todavía no hay cierres calculados en la base.</span></div>
      </section>
    );
  }

  const descargar = async () => {
    try {
      setErrorCsv(null);
      await guardaOComparte(new Blob([csvCierres(cuerpos, cierres)], { type: 'text/csv;charset=utf-8' }), 'cierres-mensuales-cuenca-conchos.csv', 'text/csv');
    } catch (e) { setErrorCsv(`No se pudo generar el archivo: ${(e as Error).message}`); }
  };

  const columnasResumen: Columna<FilaResumen>[] = [
    { id: 'c', titulo: 'Cuerpo de agua', encabezadoFila: true, render: (r) => <><span className="cu-nombre">{r.cuerpo.etiqueta}</span>{r.cuerpo.rol !== 'almacenamiento' && <span className="cu-tag">{r.cuerpo.rol === 'reguladora' ? 'Reguladora' : 'Derivadora'}</span>}</> },
    { id: 'n', titulo: 'Meses con dato', numerica: true, render: (r) => { const k = coberturaDeCuerpo(r.cierres); return `${k.conDato} de ${k.total}`; } },
    { id: 'sd', titulo: 'S/D', numerica: true, render: (r) => coberturaDeCuerpo(r.cierres).sd },
    { id: 'dif', titulo: 'Fuentes difieren', numerica: true, render: (r) => coberturaDeCuerpo(r.cierres).difiere },
    { id: 'rep', titulo: 'Igual al mes anterior', numerica: true, render: (r) => coberturaDeCuerpo(r.cierres).repetido },
    { id: 'src', titulo: 'Fuente elegida', render: (r) => { const k = coberturaDeCuerpo(r.cierres); return (['SRL', 'SINA', 'AQWP'] as FuenteAlm[]).filter((f) => k.porFuente[f] > 0).map((f) => `${SIGLA_FUENTE[f]} ${k.porFuente[f]}`).join(' · ') || 'S/D'; } },
    {
      id: 'ult', titulo: 'Último cierre con dato', render: (r) => {
        const u = ultimoCierreConDato(r.cierres);
        const ultimo = r.cierres.length ? r.cierres[r.cierres.length - 1] : null;
        return <>{u ? etiquetaMes(u.mes, true) : 'S/D'}{u && ultimo && u.mes !== ultimo.mes && <span className="cu-nota-fila">sin dato desde {etiquetaMes(u.mes, true)}</span>}</>;
      },
    },
  ];

  return (
    <section className="an-card" id="cu-cierres" aria-label="Cierres mensuales de los cuerpos de agua">
      <div className="cu-red-cab">
        <div>
          <h4 className="an-h">Cierres mensuales · 2021 → hoy</h4>
          <p className="an-nota">
            Almacenamiento al fin de cada mes en los {cuerpos.length} cuerpos de agua de la cuenca, de aguas arriba a aguas abajo. Cada celda dice de qué fuente sale
            (R reporte SRL/CILA · S SINA CONAGUA · A AQUARIUS) y su estado. Toque una celda para ver el cuadre de las fuentes. Un mes sin dato es S/D, nunca 0.
          </p>
        </div>
        <button type="button" className="an-btn" onClick={descargar}>Descargar CSV</button>
      </div>
      {errorCsv && <p className="an-aviso" role="alert">{errorCsv}</p>}

      <div className="cu-controles" role="group" aria-label="Año y magnitud de los cierres">
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id="cu-cm-anio">Año</span>
          <div className="an-seg cu-seg-envuelve" role="group" aria-labelledby="cu-cm-anio">
            {[...anios].reverse().map((a) => <button key={a} type="button" className="an-seg-btn" aria-pressed={anio === a} onClick={() => setAnio(a)}>{a}</button>)}
            <button type="button" className="an-seg-btn" aria-pressed={anio === 'todo'} onClick={() => setAnio('todo')}>Todo</button>
          </div>
        </div>
        <div className="cu-ctl">
          <span className="cu-ctl-etq" id="cu-cm-met">Magnitud</span>
          <div className="an-seg" role="group" aria-labelledby="cu-cm-met">
            {METRICAS.map((m) => <button key={m.v} type="button" className="an-seg-btn" aria-pressed={metrica === m.v} onClick={() => setMetrica(m.v)}>{m.t}</button>)}
          </div>
        </div>
      </div>

      <div className="cu-cm-wrap" role="region" aria-label="Matriz de cierres mensuales (desplazable)" tabIndex={0}>
        <table className="cu-cm">
          <caption className="cu-sr">Cierre mensual por cuerpo de agua ({METRICAS.find((m) => m.v === metrica)?.t})</caption>
          <thead>
            <tr>
              <th scope="col" className="cu-cm-esq">Cuerpo</th>
              {meses.map((m, i) => <th key={m} scope="col" className="cu-cm-mes">{etiquetaMes(m, anio === 'todo' && (i === 0 || m.endsWith('-01-01')))}</th>)}
            </tr>
          </thead>
          <tbody>
            {cuerpos.map((cu) => (
              <tr key={cu.id}>
                <th scope="row" className="cu-cm-esq">{cu.etiqueta}</th>
                {meses.map((m) => {
                  const c = idx.get(`${cu.id}|${m}`);
                  const cel = celdaCierre(c, metrica);
                  const cal = c?.calidad ?? 'SD';
                  const activa = sel?.cuerpoId === cu.id && sel.mes === m;
                  const fuente = metrica === 'elev' ? c?.fuenteElev : c?.fuenteAlm;
                  return (
                    <td key={m} className="cu-cm-td">
                      <button
                        type="button" className={`cu-cm-celda cu-cm--${cel.sd ? 'SD' : cal}`} aria-pressed={activa}
                        aria-label={`${cu.etiqueta}, ${etiquetaMes(m, true)}: ${cel.sd ? 'sin dato' : cel.texto}${fuente ? `, fuente ${NOMBRE_FUENTE[fuente]}` : ''}, ${ETIQUETA_CALIDAD[cel.sd ? 'SD' : cal]}`}
                        onClick={() => setSel(activa ? null : { cuerpoId: cu.id, mes: m })}
                      >
                        <span className="cu-cm-val">{cel.texto}</span>
                        {!cel.sd && <span className="cu-cm-meta" aria-hidden="true">{fuente ? SIGLA_FUENTE[fuente] : ''}{cal !== 'OK' ? GLIFO_CALIDAD[cal] : ''}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="cu-cm-leyenda" aria-label="Leyenda de la matriz">
        {(['OK', 'DESFASADO', 'REPETIDO', 'DIFIERE', 'SD'] as const).map((k) => (
          <li key={k}><span className={`cu-cm-chip cu-cm--${k}`}><span aria-hidden="true">{GLIFO_CALIDAD[k]}</span></span> <b>{ETIQUETA_CALIDAD[k]}</b> — {DESCRIPCION_CALIDAD[k]}</li>
        ))}
      </ul>

      {sel && cuerpoSel && <DetalleCierre cuerpo={cuerpoSel} c={idx.get(`${sel.cuerpoId}|${sel.mes}`)} />}

      <h5 className="an-h an-h--pie cu-cm-sub">Cobertura por cuerpo de agua</h5>
      <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Cobertura de los cierres (desplazable)" captionOculto caption="Cobertura de los cierres mensuales por cuerpo de agua" clave={(r) => r.cuerpo.id} filas={resumen} columnas={columnasResumen} />
    </section>
  );
}
