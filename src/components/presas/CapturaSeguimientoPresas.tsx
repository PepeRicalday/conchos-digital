import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardPaste } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Boton } from '../ui/base';
import { hoyLocalISO } from '../../utils/hoyLocal';
import './CapturaSeguimientoPresas.css';
import {
  analizarSeguimiento, filaLecturaPresas, filaSeguimiento, MARCA_SEGUIMIENTO, type LecturaSeguimiento,
} from '../../utils/seguimientoPresas';

// Las tablas seguimiento_presas aún no están en los tipos generados de Supabase.
interface RespuestaLibre<T> extends PromiseLike<{ data: T | null; error: { message: string } | null }> {
  select: (c: string) => RespuestaLibre<T>;
  in: (c: string, v: string[]) => RespuestaLibre<T>;
  upsert: (v: unknown, o: { onConflict: string }) => RespuestaLibre<T>;
}
const sb = () => supabase as unknown as { from: (t: string) => RespuestaLibre<Record<string, unknown>[]> };

const f = (v: number | null, d: number) => (v == null ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const GLIFO = { ok: '●', aviso: '▲', error: '■' } as const;

interface Previo { seguimiento: Set<string>; cila: Set<string>; campo: Set<string>; capacidad: Map<string, number> }

/**
 * Captura de «Seguimiento de presas» por texto plano: se pega el texto, el sistema detecta cada presa, la valida y la muestra
 * para CONFIRMAR antes de guardar. Nada se escribe sin la confirmación. Las presas del distrito se vuelcan también a
 * lecturas_presas SIN la marca de CILA (la captura prevalece; CILA solo completa lo que falte).
 */
export default function CapturaSeguimientoPresas({ onGuardado, onCerrar }: { onGuardado: () => void; onCerrar: () => void }) {
  const { profile } = useAuth();
  const [texto, setTexto] = useState('');
  const [previo, setPrevio] = useState<Previo | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);

  const hoy = hoyLocalISO();
  const res = useMemo(() => analizarSeguimiento(texto, hoy), [texto, hoy]);
  const validas = res.lecturas.filter((l) => l.valida && l.catalogo);
  const claveFechas = useMemo(() => [...new Set(validas.map((l) => l.fecha as string))].sort().join(','), [validas]);

  // Qué ya existe para esas fechas: distingue «nueva» de «reemplaza» y avisa si pisa una lectura de campo distinta de CILA.
  useEffect(() => {
    if (!claveFechas) { setPrevio(null); return; }
    let vivo = true;
    const fechas = claveFechas.split(',');
    (async () => {
      try {
        const [seg, lec, pre] = await Promise.all([
          sb().from('seguimiento_presas').select('clave, fecha').in('fecha', fechas),
          sb().from('lecturas_presas').select('presa_id, fecha, notas').in('fecha', fechas).in('presa_id', ['PRE-001', 'PRE-002']),
          sb().from('presas').select('id, capacidad_max'),
        ]);
        if (!vivo) return;
        const p: Previo = { seguimiento: new Set(), cila: new Set(), campo: new Set(), capacidad: new Map() };
        for (const r of seg.data ?? []) p.seguimiento.add(`${r.clave}|${r.fecha}`);
        for (const r of lec.data ?? []) {
          const k = `${r.presa_id}|${r.fecha}`, n = String(r.notas ?? '');
          if (n.includes('CILA-IBWC')) p.cila.add(k); else if (!n.includes(MARCA_SEGUIMIENTO)) p.campo.add(k);
        }
        for (const r of pre.data ?? []) p.capacidad.set(String(r.id), Number(r.capacidad_max));
        setPrevio(p);
      } catch { if (vivo) setPrevio(null); }
    })();
    return () => { vivo = false; };
  }, [claveFechas]);

  const estado = (l: LecturaSeguimiento): { txt: string; tono: 'ok' | 'aviso' | 'error' } => {
    if (!l.valida || !l.catalogo) return { txt: 'No se guardará', tono: 'error' };
    const k = `${l.clave}|${l.fecha}`, pk = l.catalogo.presaId ? `${l.catalogo.presaId}|${l.fecha}` : null;
    if (pk && previo?.campo.has(pk)) return { txt: 'Reemplaza lectura de campo', tono: 'aviso' };
    if (previo?.seguimiento.has(k)) return { txt: 'Actualiza captura previa', tono: 'aviso' };
    if (pk && previo?.cila.has(pk)) return { txt: 'Nueva · prevalece sobre CILA', tono: 'ok' };
    return { txt: 'Nueva', tono: 'ok' };
  };

  const confirmar = async () => {
    setError(null); setGuardando(true);
    try {
      const quien = profile?.nombre?.trim() || 'Gerencia SRL Conchos';
      const filas = validas.map((l) => filaSeguimiento(l, quien)).filter((x): x is NonNullable<typeof x> => x != null);
      const { error: e1 } = await sb().from('seguimiento_presas').upsert(filas, { onConflict: 'clave,fecha' });
      if (e1) throw new Error(e1.message);
      // Distrito: lecturas_presas (única tabla que leen el informe, la sala y el monitor). Sin la marca de CILA → prevalece.
      const distrito = validas.map((l) => {
        const cap = l.catalogo?.presaId ? previo?.capacidad.get(l.catalogo.presaId) ?? l.catalogo.namoRefMm3 ?? 0 : 0;
        return filaLecturaPresas(l, cap, quien);
      }).filter((x): x is NonNullable<typeof x> => x != null);
      if (distrito.length) {
        const { error: e2 } = await sb().from('lecturas_presas').upsert(distrito, { onConflict: 'presa_id,fecha' });
        if (e2) throw new Error(`Se guardó el seguimiento, pero falló lecturas_presas: ${e2.message}`);
      }
      setHecho(`${filas.length} presas guardadas${distrito.length ? `; ${distrito.length} del distrito ya alimentan el informe` : ''}.`);
      onGuardado();
    } catch (e) { setError((e as Error).message); } finally { setGuardando(false); }
  };

  if (hecho) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-sm font-bold" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {hecho}</div>
        <div className="flex justify-end"><Boton variante="primario" onClick={onCerrar}>Cerrar</Boton></div>
      </div>
    );
  }

  const errores = res.lecturas.filter((l) => !l.valida).length;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="seg-texto" className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><ClipboardPaste size={12} aria-hidden="true" /> Texto del seguimiento de presas</label>
        <textarea id="seg-texto" rows={res.lecturas.length ? 5 : 9} value={texto} onChange={(e) => { setTexto(e.target.value); setError(null); }}
          className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none"
          placeholder={'Seguimiento de presas:\nDl Chihuahua 11 de noviembre 2026.\n\n-La presa Boquilla, Chih. a las 07:00 h del 11/11/2026 , se encuentra al 29.07% con una elevación de 1299.02 msnm, …'} />
        <p className="text-[12px] text-slate-400">Pegue el texto completo: el sistema separa cada presa, valida las cifras y le muestra el resultado para confirmar. No se guarda nada hasta pulsar «Confirmar».</p>
      </div>

      {res.avisosGenerales.map((a, i) => <p key={i} className={`text-xs font-bold px-3 py-2 rounded-lg border ${a.severidad === 'error' ? 'text-red-300 border-red-800/40 bg-red-950/30' : 'text-amber-300 border-amber-800/40 bg-amber-950/30'}`}>{GLIFO[a.severidad]} {a.texto}</p>)}

      {res.lecturas.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] text-slate-300 font-bold" role="status">
            {res.lecturas.length} presas detectadas · {validas.length} listas para guardar{errores ? ` · ${errores} con error (no se guardan)` : ''}
            {res.faltantes.length > 0 && <span className="text-amber-300"> · faltan: {res.faltantes.map((p) => p.nombre).join(', ')}</span>}
          </div>
          <div className="overflow-x-auto rounded-xl border border-white/10" role="region" aria-label="Presas detectadas (desplazable)" tabIndex={0}>
            <table className="seg-tabla">
              <caption className="sr-only">Presas detectadas en el texto</caption>
              <thead>
                <tr><th scope="col">Presa</th><th scope="col" className="seg-num">Fecha · hora</th><th scope="col" className="seg-num">Alm. Mm³</th><th scope="col" className="seg-num">%</th><th scope="col" className="seg-num">Elev. msnm</th><th scope="col" className="seg-num">Ingreso m³/s</th><th scope="col" className="seg-num">Extr. m³/s</th><th scope="col">Resultado</th></tr>
              </thead>
              <tbody>
                {res.lecturas.map((l, i) => {
                  const e = estado(l);
                  return (
                    <tr key={`${l.clave}-${i}`}>
                      <th scope="row">{l.catalogo?.nombre ?? (l.nombreReportado || '—')}{l.catalogo?.presaId && <span className="seg-tag">Distrito</span>}
                        {l.avisos.map((a, j) => <span key={j} className={`seg-aviso seg-aviso--${a.severidad}`}>{GLIFO[a.severidad]} {a.texto}</span>)}
                      </th>
                      <td className="seg-num">{l.fecha ? new Date(`${l.fecha}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : 'S/D'} {l.hora ?? ''}</td>
                      <td className="seg-num">{f(l.almacenamientoMm3, 2)}</td>
                      <td className="seg-num">{f(l.pct, 2)}</td>
                      <td className="seg-num">{f(l.elevacionMsnm, 2)}</td>
                      <td className="seg-num">{f(l.ingresoM3s, 3)}</td>
                      <td className="seg-num">{f(l.extraccionM3s, 2)}</td>
                      <td className={`seg-res seg-res--${e.tono}`}><span aria-hidden="true">{GLIFO[e.tono]}</span> {e.txt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-slate-400">
            Prioridad de fuentes: esta captura manda sobre CILA/AQUARIUS. En las presas del distrito se escribe en la lectura del día (CILA ya no la sobrescribe) y CILA solo completa lo que no venga aquí.
            Las demás presas de la cuenca quedan en el seguimiento y sustituyen al dato de AQUARIUS en la vista de Cuenca mientras sea el más reciente.
          </p>
        </div>
      )}

      {error && <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/40 text-red-400 text-xs font-bold" role="alert"><AlertTriangle size={13} aria-hidden="true" /> {error}</div>}

      <div className="flex justify-end gap-2">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" cargando={guardando} disabled={!validas.length || guardando} onClick={confirmar}>
          {guardando ? 'Guardando…' : `Confirmar y guardar ${validas.length || ''} presa${validas.length === 1 ? '' : 's'}`}
        </Boton>
      </div>
    </div>
  );
}
