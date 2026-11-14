import { useState } from 'react';
import { Campo } from '../../ui/base';
import { useAuth } from '../../../context/AuthContext';
import { anularCapturaMx, guardarCapturaMx } from '../../../hooks/useTratadoCiclo';
import { afAMm3, mm3AAf, type CapturaMx } from '../../../utils/tratadoCiclo';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';

/** Número con coma o punto decimal; null si no es una cifra válida. */
function leeNumero(s: string): number | null {
  const t = s.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Captura oficial mexicana (CONAGUA/CILA) del volumen entregado en un periodo, para conciliarla contra el IBWC.
 * Capa aparte con autor y fecha: una cifra equivocada se anula, no se borra. Solo roles SRL y ACU.
 */
export default function CapturaTratadoMx({ capturas, hoyISO, onCambio }: { capturas: CapturaMx[]; hoyISO: string; onCambio: () => void }) {
  const { profile, user } = useAuth();
  const rol = profile?.rol ?? null;
  const puedeEditar = rol === 'SRL' || rol === 'ACU';
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [vol, setVol] = useState('');
  const [unidad, setUnidad] = useState<'mm3' | 'af'>('mm3');
  const [fuente, setFuente] = useState('');
  const [coment, setComent] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; txt: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [porAnular, setPorAnular] = useState<number | null>(null);
  const [verAnuladas, setVerAnuladas] = useState(false);

  const filas = capturas.filter((c) => verAnuladas || !c.anulada);
  const nAnuladas = capturas.filter((c) => c.anulada).length;

  const enviar = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    const n = leeNumero(vol);
    if (!desde) er.desde = 'Indique el primer día del periodo.';
    if (!hasta) er.hasta = 'Indique el último día del periodo.';
    if (desde && hasta && hasta < desde) er.hasta = 'No puede ser anterior al inicio.';
    if (hasta && hasta > hoyISO) er.hasta = 'No puede ser una fecha futura.';
    if (desde && desde < '2025-10-25') er.desde = 'El ciclo vigente empieza el 25 de octubre de 2025.';
    if (n == null) er.vol = 'Escriba una cifra válida (≥ 0).';
    if (fuente.trim().length < 3) er.fuente = 'Diga de dónde sale: oficio, reporte semanal, acta…';
    setErrores(er);
    if (Object.keys(er).length || n == null) { setEstado({ tipo: 'error', txt: 'Revise los campos marcados.' }); return; }
    setGuardando(true);
    const mm3 = unidad === 'af' ? afAMm3(n) : n;
    const err = await guardarCapturaMx({ desde, hasta, mm3, fuente, comentario: coment });
    setGuardando(false);
    if (err) { setEstado({ tipo: 'error', txt: `No se guardó: ${err}` }); return; }
    setEstado({ tipo: 'ok', txt: 'Cifra oficial guardada. Ya cuenta en la conciliación.' });
    setVol(''); setComent('');
    onCambio();
  };

  const anular = async (id: number) => {
    const err = await anularCapturaMx(id);
    setPorAnular(null);
    setEstado(err ? { tipo: 'error', txt: err } : { tipo: 'ok', txt: 'Captura anulada. Sigue en el historial.' });
    if (!err) onCambio();
  };

  return (
    <section className="an-card tr-captura" id="cu-tratado-captura" aria-label="Captura oficial CONAGUA/CILA">
      <h4 className="an-h">Cifra oficial de México (CONAGUA / CILA)</h4>
      <p className="an-nota">
        Capture el volumen que México reporta como entregado en un periodo; el informe lo compara con la cifra del IBWC. Cada captura queda con autor y fecha;
        una equivocada se anula, no se borra. Solo cuenta en un periodo si cabe completa dentro de él.
      </p>
      {!puedeEditar && <p className="an-aviso" role="status">Su usuario es de solo lectura: capturan los roles SRL y ACU.</p>}
      {puedeEditar && (
        <form className="cu-an-form" onSubmit={enviar} noValidate aria-label="Nueva cifra oficial de México">
          <div className="cu-an-campos">
            <Campo etiqueta="Del" error={errores.desde}>{(a) => <input {...a} type="date" value={desde} min="2025-10-25" max={hoyISO} onChange={(e) => { setDesde(e.target.value); setEstado(null); }} />}</Campo>
            <Campo etiqueta="Al" error={errores.hasta}>{(a) => <input {...a} type="date" value={hasta} min="2025-10-25" max={hoyISO} onChange={(e) => { setHasta(e.target.value); setEstado(null); }} />}</Campo>
            <Campo etiqueta="Volumen entregado" error={errores.vol}>{(a) => <input {...a} type="text" inputMode="decimal" autoComplete="off" value={vol} onChange={(e) => { setVol(e.target.value); setEstado(null); }} />}</Campo>
            <Campo etiqueta="Unidad">{(a) => (
              <select {...a} value={unidad} onChange={(e) => setUnidad(e.target.value as 'mm3' | 'af')}>
                <option value="mm3">Millones de m³ (Mm³)</option><option value="af">Acre-pies (AF)</option>
              </select>
            )}</Campo>
          </div>
          <div className="cu-an-campos cu-an-campos--ancho">
            <Campo etiqueta="De dónde sale la cifra" ayuda="Oficio, reporte semanal, acta de la CILA…" error={errores.fuente}>{(a) => <input {...a} type="text" maxLength={160} value={fuente} onChange={(e) => { setFuente(e.target.value); setEstado(null); }} />}</Campo>
            <Campo etiqueta="Comentario (opcional)">{(a) => <input {...a} type="text" maxLength={300} value={coment} onChange={(e) => setComent(e.target.value)} />}</Campo>
          </div>
          <div className="cu-an-acc"><button type="submit" className="an-btn cu-an-guardar" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cifra oficial'}</button></div>
        </form>
      )}
      {estado && <p className={estado.tipo === 'ok' ? 'an-nota' : 'an-aviso'} role={estado.tipo === 'ok' ? 'status' : 'alert'}>{estado.txt}</p>}

      {filas.length === 0 ? <p className="an-nota">Aún no hay cifras oficiales capturadas (S/D).</p> : (
        <div className="cu-tabla-wrap" role="region" aria-label="Cifras oficiales capturadas (desplazable)" tabIndex={0}>
          <table className="cu-tabla">
            <caption className="ui-sr">Cifras oficiales de México capturadas</caption>
            <thead><tr><th scope="col">Periodo</th><th scope="col" className="cu-num">Mm³</th><th scope="col" className="cu-num">AF</th><th scope="col">Fuente</th><th scope="col">Capturó</th>{puedeEditar && <th scope="col">Acción</th>}</tr></thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{fechaCorta(c.desde)} – {fechaCorta(c.hasta)}{c.anulada && <span className="cu-tag cu-tag--aviso">Anulada</span>}</th>
                  <td className="cu-num">{formatearNumero(c.mm3, 2)}</td>
                  <td className="cu-num">{formatearNumero(mm3AAf(c.mm3), 0)}</td>
                  <td>{c.fuente}{c.comentario && <span className="cu-nota-fila">{c.comentario}</span>}</td>
                  <td>{c.autor ?? 'S/D'}<span className="cu-nota-fila">{fechaCorta(c.creadoEn.slice(0, 10))}</span></td>
                  {puedeEditar && (
                    <td>{c.anulada || !(rol === 'SRL' || user) ? null : porAnular === c.id
                      ? <span className="cu-an-conf"><button type="button" className="an-btn an-btn--chico" onClick={() => anular(c.id)}>Sí, anular</button><button type="button" className="an-btn an-btn--chico" onClick={() => setPorAnular(null)}>No</button></span>
                      : <button type="button" className="an-btn an-btn--chico" onClick={() => setPorAnular(c.id)}>Anular</button>}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nAnuladas > 0 && <label className="cu-an-ver"><input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} /> Ver también las {nAnuladas} anuladas</label>}
    </section>
  );
}
