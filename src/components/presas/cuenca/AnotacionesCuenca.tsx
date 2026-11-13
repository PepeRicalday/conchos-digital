import { useMemo, useState } from 'react';
import { Campo, DataTable, Selector, type Columna } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import { etiquetaMes, type CuerpoAgua } from '../../../utils/cuerposAgua';
import {
  cuerposSinTelemetria, ETIQUETA_TIPO, GLIFO_TIPO, ordenarAnotaciones, puedeAnular, validarAnotacion,
  type Anotacion, type BorradorAnotacion, type ErroresAnotacion, type TipoAnotacion,
} from '../../../utils/anotacionesCuenca';
import type { useAnotacionesCuenca } from '../../../hooks/useAnotacionesCuenca';
import { useAuth } from '../../../context/AuthContext';
import Segmentado from './Segmentado';

const TIPOS: { v: TipoAnotacion; t: string }[] = [{ v: 'captura', t: 'Captura manual' }, { v: 'revision', t: 'Cierre revisado' }, { v: 'sospechosa', t: 'Lectura sospechosa' }];
const AYUDA_TIPO: Record<TipoAnotacion, string> = {
  captura: 'Almacenamiento o elevación de un vaso sin telemetría, tomado de un reporte o de campo. Se muestra junto al vaso con su fecha y su origen.',
  revision: 'Deja constancia de que el cierre de un mes se cotejó, y contra qué.',
  sospechosa: 'Marca una lectura que no cuadra, con el motivo. No la borra ni la saca de los cálculos.',
};

/**
 * Anotaciones de la cuenca: la única parte editable del apartado. Quien tiene rol SRL o ACU captura a mano el almacenamiento de los
 * vasos sin telemetría, deja constancia de un cierre revisado o marca una lectura sospechosa. Todo queda con autor y fecha, y una
 * anotación equivocada se anula (no se borra). No cambia cierres ni balances.
 */
export default function AnotacionesCuenca({ cuerpos, anot, hoyISO }: { cuerpos: CuerpoAgua[]; anot: ReturnType<typeof useAnotacionesCuenca>; hoyISO: string }) {
  const { profile, user } = useAuth();
  const rol = profile?.rol ?? null;
  const puedeEditar = (rol === 'SRL' || rol === 'ACU') && anot.disponible;
  const sinTel = useMemo(() => cuerposSinTelemetria(cuerpos), [cuerpos]);
  const vacio = (tipo: TipoAnotacion): BorradorAnotacion => ({
    tipo, cuerpoId: tipo === 'captura' ? (sinTel[0]?.id ?? '') : (cuerpos[0]?.id ?? ''),
    fecha: tipo === 'revision' ? hoyISO.slice(0, 7) : hoyISO, alm: '', elev: '', origen: '', comentario: '',
  });
  const [b, setB] = useState<BorradorAnotacion>(() => vacio('captura'));
  const [errores, setErrores] = useState<ErroresAnotacion>({});
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; txt: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [porAnular, setPorAnular] = useState<number | null>(null);
  const [verAnuladas, setVerAnuladas] = useState(false);
  const pon = (x: Partial<BorradorAnotacion>) => { setB((v) => ({ ...v, ...x })); setEstado(null); };

  const nombre = useMemo(() => new Map(cuerpos.map((c) => [c.id, c.etiqueta])), [cuerpos]);
  const opciones = b.tipo === 'captura' ? sinTel : cuerpos;
  const filas = useMemo(() => ordenarAnotaciones(anot.filas ?? []).filter((a) => verAnuladas || !a.anulada), [anot.filas, verAnuladas]);
  const nAnuladas = (anot.filas ?? []).filter((a) => a.anulada).length;

  const enviar = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const r = validarAnotacion(b, cuerpos, hoyISO);
    setErrores(r.errores);
    if (!r.fila) { setEstado({ tipo: 'error', txt: 'Revise los campos marcados.' }); return; }
    setGuardando(true);
    try {
      await anot.guardar(r.fila, profile?.nombre ?? user?.email ?? null);
      setEstado({ tipo: 'ok', txt: `${ETIQUETA_TIPO[b.tipo]} guardada para ${nombre.get(b.cuerpoId) ?? b.cuerpoId}.` });
      setB((v) => ({ ...vacio(v.tipo), cuerpoId: v.cuerpoId }));
    } catch (err) { setEstado({ tipo: 'error', txt: `No se guardó: ${(err as Error).message}` }); }
    finally { setGuardando(false); }
  };

  const anular = async (id: number) => {
    try { await anot.anular(id); setEstado({ tipo: 'ok', txt: 'Anotación anulada. Sigue en el historial.' }); }
    catch (err) { setEstado({ tipo: 'error', txt: (err as Error).message }); }
    finally { setPorAnular(null); }
  };

  const columnas: Columna<Anotacion>[] = [
    { id: 'f', titulo: 'Fecha', className: 'cu-fecha', render: (a) => (a.tipo === 'revision' ? etiquetaMes(a.fecha, true) : fechaCorta(a.fecha)) },
    { id: 'c', titulo: 'Cuerpo de agua', encabezadoFila: true, render: (a) => <span className="cu-nombre">{nombre.get(a.cuerpoId) ?? a.cuerpoId}</span> },
    { id: 't', titulo: 'Tipo', render: (a) => <span className={`cu-an-tipo cu-an-tipo--${a.tipo}`}><span aria-hidden="true">{GLIFO_TIPO[a.tipo]}</span> {ETIQUETA_TIPO[a.tipo]}{a.anulada && <span className="cu-tag cu-tag--aviso">Anulada</span>}</span> },
    {
      id: 'v', titulo: 'Cifra', className: 'cu-num',
      render: (a) => a.tipo !== 'captura' ? '—' : <>{a.almMm3 == null ? 'S/D' : `${formatearNumero(a.almMm3, 2)} Mm³`}{a.elevMsnm != null && <span className="cu-nota-fila">{formatearNumero(a.elevMsnm, 2)} msnm</span>}</>,
    },
    { id: 'n', titulo: 'Origen o comentario', render: (a) => <span className="cu-an-txt">{[a.origen, a.comentario].filter(Boolean).join(' · ') || '—'}</span> },
    { id: 'a', titulo: 'Anotó', render: (a) => <>{a.autor ?? 'S/D'}<span className="cu-nota-fila">{fechaCorta(a.creadoEn.slice(0, 10))}</span></> },
    ...(puedeEditar ? [{
      id: 'x', titulo: 'Acción',
      render: (a: Anotacion) => !puedeAnular(a, rol, user?.id) ? null : porAnular === a.id
        ? <span className="cu-an-conf"><button type="button" className="an-btn an-btn--chico" onClick={() => anular(a.id)}>Sí, anular</button><button type="button" className="an-btn an-btn--chico" onClick={() => setPorAnular(null)}>No</button></span>
        : <button type="button" className="an-btn an-btn--chico" onClick={() => setPorAnular(a.id)}>Anular</button>,
    } satisfies Columna<Anotacion>] : []),
  ];

  return (
    <section className="an-card" id="cu-anotaciones" aria-label="Anotaciones y captura manual">
      <h4 className="an-h">Anotaciones y captura manual</h4>
      <p className="an-nota">
        Es la única parte editable de la Cuenca. Cada anotación queda con autor y fecha; una equivocada se anula, no se borra.
        La captura manual se muestra junto al vaso, pero todavía no entra a los cierres mensuales ni al balance.
      </p>

      {!anot.disponible && <p className="an-aviso" role="status"><b>Edición no disponible todavía:</b> falta crear la tabla de anotaciones en la base de datos.</p>}
      {anot.error && <p className="an-aviso" role="alert">No se pudieron cargar las anotaciones: {anot.error} <button type="button" className="an-btn an-btn--chico" onClick={anot.recargar}>Reintentar</button></p>}
      {anot.disponible && !puedeEditar && <p className="an-aviso" role="status">Su usuario es de solo lectura: anotan los roles SRL y ACU.</p>}

      {puedeEditar && (
        <form className="cu-an-form" onSubmit={enviar} noValidate aria-label="Nueva anotación">
          <Segmentado<TipoAnotacion> etiqueta="Qué va a anotar" valor={b.tipo} opciones={TIPOS} onChange={(t) => { setB(vacio(t)); setErrores({}); setEstado(null); }} />
          <p className="an-nota">{AYUDA_TIPO[b.tipo]}</p>
          {b.tipo === 'captura' && sinTel.length === 0
            ? <p className="an-aviso" role="status">Todos los cuerpos de agua tienen telemetría: no hay vasos que requieran captura manual.</p>
            : (
              <>
                <div className="cu-an-campos">
                  <Campo etiqueta="Cuerpo de agua" error={errores.cuerpoId}>
                    {(a) => <Selector {...a} value={b.cuerpoId} onChange={(e) => pon({ cuerpoId: e.target.value })}>{opciones.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}</Selector>}
                  </Campo>
                  <Campo etiqueta={b.tipo === 'revision' ? 'Mes del cierre' : 'Fecha de la lectura'} error={errores.fecha}>
                    {(a) => <input {...a} type={b.tipo === 'revision' ? 'month' : 'date'} value={b.fecha} max={b.tipo === 'revision' ? hoyISO.slice(0, 7) : hoyISO} min={b.tipo === 'revision' ? '2021-01' : '2021-01-01'} onChange={(e) => pon({ fecha: e.target.value })} />}
                  </Campo>
                  {b.tipo === 'captura' && (
                    <>
                      <Campo etiqueta="Almacenamiento (Mm³)" ayuda="Deje vacío si no lo tiene" error={errores.alm}>
                        {(a) => <input {...a} type="text" inputMode="decimal" autoComplete="off" value={b.alm} onChange={(e) => pon({ alm: e.target.value })} />}
                      </Campo>
                      <Campo etiqueta="Elevación (msnm)" ayuda="Opcional" error={errores.elev}>
                        {(a) => <input {...a} type="text" inputMode="decimal" autoComplete="off" value={b.elev} onChange={(e) => pon({ elev: e.target.value })} />}
                      </Campo>
                    </>
                  )}
                </div>
                <div className="cu-an-campos cu-an-campos--ancho">
                  {b.tipo === 'captura' && (
                    <Campo etiqueta="De dónde salió la cifra" ayuda="Quién la reportó o qué documento" error={errores.origen}>
                      {(a) => <input {...a} type="text" maxLength={160} value={b.origen} onChange={(e) => pon({ origen: e.target.value })} />}
                    </Campo>
                  )}
                  <Campo etiqueta={b.tipo === 'captura' ? 'Comentario (opcional)' : 'Comentario'} error={errores.comentario}>
                    {(a) => <input {...a} type="text" maxLength={300} value={b.comentario} onChange={(e) => pon({ comentario: e.target.value })} />}
                  </Campo>
                </div>
                <div className="cu-an-acc">
                  <button type="submit" className="an-btn cu-an-guardar" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar anotación'}</button>
                </div>
              </>
            )}
        </form>
      )}
      {estado && <p className={estado.tipo === 'ok' ? 'an-nota cu-an-ok' : 'an-aviso'} role={estado.tipo === 'ok' ? 'status' : 'alert'}>{estado.txt}</p>}

      {anot.cargando && <div className="an-skeleton" role="status" aria-busy="true" aria-label="Cargando anotaciones" />}
      {anot.disponible && anot.filas && (filas.length === 0
        ? <div className="an-vacio" role="status"><strong>Sin anotaciones todavía</strong><span>{puedeEditar ? 'Use el formulario de arriba para registrar la primera.' : 'Nadie ha registrado anotaciones.'}</span></div>
        : <DataTable propia className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Anotaciones de la cuenca (desplazable)" captionOculto caption="Anotaciones de la cuenca" clave={(a) => String(a.id)} filas={filas} columnas={columnas} filaProps={(a) => (a.anulada ? { className: 'cu-an-anulada' } : {})} />)}
      {nAnuladas > 0 && <button type="button" className="an-btn an-btn--chico cu-an-ver" aria-pressed={verAnuladas} onClick={() => setVerAnuladas((v) => !v)}>{verAnuladas ? 'Ocultar anuladas' : `Ver anuladas (${nAnuladas})`}</button>}
    </section>
  );
}
