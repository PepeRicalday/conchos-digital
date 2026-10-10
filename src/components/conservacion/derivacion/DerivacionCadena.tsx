import { Fragment, useMemo, useState } from 'react';
import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import type { TipoRed } from '../../../conservacion/derivacion/tipos';
import { AVISO_HONESTIDAD_COHERENCIA, nombreConcepto, nombreRed, redDeRotulo } from '../../../conservacion/vocabulario';
import { verificarLibroCacheado } from '../../../conservacion/verificacion/verificar';
import { cadenaDeConcepto } from '../../../conservacion/derivacion/vistas';
import { destinoDeConcepto, type DestinoTramo } from '../../../conservacion/verificacion/revision';
import { SinPacot } from './EstadoVacio';
import { BotonAbrirTramo } from './BotonAbrirTramo';
import { InsigniaVerificacion, Origen } from './formato';
import { canonizarTexto, etiquetaAmbito, fmt, nombrePacot } from './fmt';

interface Props {
    pacots: readonly PacotRegistrado[];
    ambito: string;
    setAmbito: (a: string) => void;
    bloque: string;
    concepto: string;
    setConcepto: (bloque: string, concepto: string) => void;
    /** Abre la pestaña Verificación filtrada por red y concepto. */
    verVerificacion: (red: TipoRed | '', concepto: string) => void;
    /** Abre la comprobación por tramo ya posicionada. */
    abrirTramo: (d: DestinoTramo) => void;
}


/** Cómo se llegó a un concepto: cada paso con su celda y su fórmula, y la comprobación aritmética de cada operación. */
export function DerivacionCadena({ pacots, ambito, setAmbito, bloque, concepto, setConcepto, verVerificacion, abrirTramo }: Props) {
    const pacot = pacots.find((p) => etiquetaAmbito(p) === ambito) ?? pacots[0];
    const necesidades = useMemo(() => pacot?.libro.necesidades ?? [], [pacot]);
    const clave = `${bloque}|${concepto}`;
    const actual = necesidades.find((n) => `${n.bloque}|${n.concepto}` === clave) ?? necesidades.find((n) => n.cantidadTrabajo.valor !== null) ?? necesidades[0];
    const [verTodo, setVerTodo] = useState(false);

    const cadena = useMemo(() => (pacot && actual ? cadenaDeConcepto(pacot.libro, actual) : null), [pacot, actual]);
    const ver = useMemo(() => (pacot ? verificarLibroCacheado(pacot.libro) : null), [pacot]);
    const nombreDiag = cadena?.diagnostico?.concepto ?? null;
    const criterios = ver && nombreDiag ? ver.criterios.filter((c) => c.concepto === nombreDiag || c.concepto.endsWith(`(col. ${nombreDiag})`)) : [];
    const visibles = verTodo ? necesidades : necesidades.filter((n) => n.cantidadTrabajo.valor !== null || n.importe.valor !== null);

    if (!pacot) return <SinPacot />;
    const bloqueUI = (b: string): string => { const r = redDeRotulo(b); return r ? nombreRed(r) : b; };
    const canon = actual ? nombreConcepto(actual.concepto, { bloque: actual.bloque }) : null;
    return (
        <section className="sc-card" aria-labelledby="cons-cad-t" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><span className="sc-kicker">Derivación</span><h3 id="cons-cad-t" style={{ marginBottom: 0 }}>Cómo se calcula el concepto</h3></div>
            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="cons-cad-amb">PacOT</label>
                    <select id="cons-cad-amb" value={etiquetaAmbito(pacot)} onChange={(e) => setAmbito(e.target.value)}>
                        {pacots.map((p) => <option key={p.clave} value={etiquetaAmbito(p)} title={`Rótulo en el libro: ${p.ficha.moduloTexto}`}>{nombrePacot(p)}</option>)}
                    </select>
                </div>
                <div className="sc-campo" style={{ flex: '1 1 320px' }}>
                    <label htmlFor="cons-cad-con">Concepto</label>
                    <select id="cons-cad-con" title={actual ? `Rótulo en el libro: ${actual.concepto}` : undefined} value={actual ? `${actual.bloque}|${actual.concepto}` : ''} onChange={(e) => { const [b, ...c] = e.target.value.split('|'); setConcepto(b ?? '', c.join('|')); }}>
                        {visibles.map((n) => <option key={`${n.bloque}|${n.concepto}`} value={`${n.bloque}|${n.concepto}`} title={`Rótulo en el libro: ${n.concepto}`}>{bloqueUI(n.bloque)} · {nombreConcepto(n.concepto, { bloque: n.bloque }).canonico}</option>)}
                    </select>
                </div>
                <label className="cons-der-check"><input type="checkbox" checked={verTodo} onChange={(e) => setVerTodo(e.target.checked)} /> Incluir conceptos sin datos</label>
            </div>

            <p className="sc-aviso cons-honesto" role="note"><span>{AVISO_HONESTIDAD_COHERENCIA} Una comprobación «Coherente» dice que la cuenta del libro cierra con sus propios valores; no acredita la condición física de las obras.</span></p>
            {cadena && actual && canon ? (
                <>
                    <p className="cons-cuenta" title={`Rótulo en el libro: ${canon.rotuloLibro}`}><b>{canon.canonico}</b>{canon.canonico !== canon.rotuloLibro ? <> · rótulo en el libro: «{canon.rotuloLibro}»</> : null}</p>
                    <ol className="cons-der-cadena" aria-label={`Pasos del cálculo de ${canon.canonico}`}>
                        {cadena.pasos.map((p, i) => (
                            <Fragment key={p.etiqueta}>
                                <li className="cons-der-paso">
                                    <span className="cons-der-paso-n">{i + 1}</span>
                                    <div>
                                        <b>{p.etiqueta}</b>
                                        {p.operacion && <small>{p.operacion}</small>}
                                        <Origen cifra={p.cifra} />
                                    </div>
                                    <strong className="cons-n">{fmt(p.cifra.valor, 4)}</strong>
                                </li>
                            </Fragment>
                        ))}
                    </ol>
                    <div>
                        <span className="sc-kicker">Comprobación aritmética (en código, con los valores del libro)</span>
                        <ul className="cons-der-verif">
                            {cadena.verificaciones.map((v) => (
                                <li key={v.descripcion} title={v.descripcion}>
                                    <InsigniaVerificacion estado={v.estado} />
                                    <span>{canonizarTexto(v.descripcion, [actual.concepto, ...(nombreDiag ? [nombreDiag] : [])], { bloque: actual.bloque })}</span>
                                    <small>{v.estado === 'no_evaluable' ? 'falta un dato en el libro' : `esperado ${fmt(v.esperado, 4)} · libro ${fmt(v.observado, 4)}`}</small>
                                </li>
                            ))}
                        </ul>
                        {cadena.ligadoPor === 'nombre' && <p className="cons-cuenta">La cantidad de trabajo no enlaza por fórmula a DIAG-01 (se capturó el valor): se ligó por el nombre del concepto.</p>}
                        {cadena.ligadoPor === null && <p className="cons-cuenta">No se encontró la columna de DIAG-01 de este concepto: no se pudo comprobar contra el diagnóstico.</p>}
                    </div>
                    {nombreDiag !== null && (
                        <div>
                            <span className="sc-kicker">Verificación independiente de DIAG-01 · <span title={`Rótulo en el libro: ${nombreDiag}`}>«{nombreConcepto(nombreDiag, { bloque: actual.bloque }).canonico}»</span></span>
                            {criterios.length === 0
                                ? <p className="cons-cuenta">Sin criterio inferido para esta columna (faltan fichas de inventario o tramos).</p>
                                : (
                                    <ul className="cons-der-verif">
                                        {criterios.map((c) => {
                                            const atipicos = c.total - c.siguen;
                                            return (
                                                <li key={`${c.red}|${c.concepto}`}>
                                                    <span className="cons-der-base" title="Lo que el libro hace en la mayoría de sus tramos; no es una exigencia de la norma.">Criterio del libro</span>
                                                    <span title={`Rótulo en el libro: ${c.concepto}`}>{nombreRed(c.red)}: {c.grupos.map((g) => g.formula).join(' · ')}</span>
                                                    <small>{c.siguen}/{c.total} tramos lo siguen</small>
                                                    {atipicos > 0 && <button type="button" className="cons-der-enlace" onClick={() => verVerificacion(c.red, c.concepto)}>Ver {atipicos} atípicos</button>}
                                                    <BotonAbrirTramo texto={atipicos > 0 ? 'Abrir un tramo atípico' : 'Ver cálculo por tramo'} destino={destinoDeConcepto(pacot.libro, etiquetaAmbito(pacot), c.red, c.indiceConcepto)} abrir={abrirTramo}
                                                        etiqueta={`${atipicos > 0 ? 'Abrir un tramo atípico' : 'Ver el cálculo por tramo'} de ${nombreConcepto(c.concepto, { red: c.red }).canonico}`} />
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                        </div>
                    )}
                    <p className="cons-cuenta">Valores guardados en el archivo (caché del libro), no recalculados por Excel. Que la aritmética cuadre no acredita la condición física de las obras.</p>
                </>
            ) : <p>Este PacOT no trae conceptos de necesidad media.</p>}
        </section>
    );
}
