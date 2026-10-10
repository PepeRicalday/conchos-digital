import { useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import type { TipoRed } from '../../../conservacion/derivacion/tipos';
import { PARAMETROS_VERIF } from '../../../conservacion/verificacion/parametros';
import type { BaseJuicio, EstadoVerif, NivelVerif, ResultadoVerif } from '../../../conservacion/verificacion/tipos';
import { verificarLibroCacheado } from '../../../conservacion/verificacion/verificar';
import { AYUDA_BASE, TEXTO_BASE, TEXTO_ESTADO_VERIF, etiquetaAmbito, nombrePacot, fmt } from './fmt';
import { idLegible, nombreConcepto, nombreRed, razonAtipicoDeId, TEXTO_SIN_DATO } from '../../../conservacion/vocabulario';
import { ChipBase, ChipRazon, InsigniaResultado } from './formato';
import { EstadoVacio, SinPacot } from './EstadoVacio';
import { useNavegacion } from './navegacion';
import { BotonAbrirTramo } from './BotonAbrirTramo';
import { destinoDeResultado, type DestinoTramo } from '../../../conservacion/verificacion/revision';

export interface FiltroVerif { red: TipoRed | ''; concepto: string }
interface Props { pacots: readonly PacotRegistrado[]; ambito: string; setAmbito: (a: string) => void; filtroInicial: FiltroVerif; abrirTramo: (d: DestinoTramo) => void }

const ESTADOS: readonly EstadoVerif[] = ['no_cuadra', 'atipico', 'informativo', 'no_evaluable', 'cuadra'];
const BASES: readonly BaseJuicio[] = ['integridad', 'criterio_libro', 'norma', 'referencia_tecnica'];
const NIVELES: ReadonlyArray<{ id: NivelVerif; texto: string }> = [{ id: 1, texto: '1 · Integridad' }, { id: 2, texto: '2 · Criterio del libro' }, { id: 3, texto: '3 · Razonabilidad física' }];
const PAGINA = 80;

/** Cifras numéricas con separador de miles; lo demás ("5 %", "6+085 → 10+085") tal cual. */
const valor = (v: string | null): string => (v !== null && /^-?\d+(\.\d+)?$/.test(v) ? fmt(v, 4) : (v ?? TEXTO_SIN_DATO));

/** Copia el id interno para citarlo (solo texto; sin red ni almacenamiento). */
function copiar(texto: string): void { void navigator.clipboard?.writeText(texto).catch(() => undefined); }

function Resultado({ r, destino, abrirTramo }: { r: ResultadoVerif; destino: DestinoTramo | null; abrirTramo: (d: DestinoTramo) => void }) {
    const id = idLegible(r.id, { red: r.red });
    return (
        <li className={`cons-h cons-h-${r.estado === 'no_cuadra' ? 'alta' : r.estado === 'atipico' ? 'media' : 'informativa'}`}>
            <details>
                <summary>
                    <span className="cons-h-fila">
                        <InsigniaResultado estado={r.estado} />
                        <ChipBase base={r.base} />
                        {r.estado === 'atipico' && <ChipRazon razon={razonAtipicoDeId(r.id)} />}
                        {r.tramoFila !== null && <span className="cons-h-id">DIAG-01 fila {r.tramoFila}</span>}
                        <span className="cons-h-id" title={`Id interno: ${r.id}`}>{id.regla}</span>
                    </span>
                    <p className="cons-h-tit">{r.titulo}</p>
                    {r.tramoFila !== null && (
                        <span className="cr-en-summary"><BotonAbrirTramo enSummary destino={destino} abrir={abrirTramo} etiqueta={`Abrir el tramo de la fila ${r.tramoFila} en la comprobación por tramo`} /></span>
                    )}
                </summary>
                <div className="cons-h-cuerpo">
                    <p style={{ margin: 0 }}>{r.detalle}</p>
                    <p className="cons-id-legible"><small>Qué se revisó: {id.titulo}</small>
                        <button type="button" className="cons-copiar" onClick={() => copiar(id.idCopiable)} title="Copiar el id interno para citarlo">Copiar id <code>{id.idCopiable}</code></button></p>
                    {(r.esperado !== null || r.observado !== null) && (
                        <div className="cons-cmp">
                            <div><small>Esperado</small><b>{valor(r.esperado)}</b></div>
                            <div><small>En el libro</small><b>{valor(r.observado)}</b></div>
                            <div><small>Diferencia</small><b>{valor(r.diferencia)}</b></div>
                        </div>
                    )}
                    {r.recalculo.length > 0 && (
                        <div className="sc-tabla-wrap table-scroll">
                            <table className="sc-tabla cons-tabla">
                                <caption style={{ position: 'absolute', left: -9999 }}>Recálculo paso a paso</caption>
                                <thead><tr><th scope="col">Paso</th><th scope="col">Operación con los valores del libro</th><th scope="col" className="cons-n">Resultado</th></tr></thead>
                                <tbody>
                                    {r.recalculo.map((p) => (
                                        <tr key={p.etiqueta}><td>{p.etiqueta}</td><td className="cons-id" style={{ whiteSpace: 'normal' }}>{p.expresion}</td><td className="cons-n">{valor(p.valor)}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {r.refs.length > 0 && <ul className="cons-refs" aria-label="Celdas de origen">{[...new Set(r.refs)].map((c) => <li key={c} className="cons-ins">{c}</li>)}</ul>}
                </div>
            </details>
        </li>
    );
}

/**
 * Comprueba el diagnóstico (DIAG-01) en lugar de darlo por bueno. Tres niveles, cada resultado con su base:
 * integridad (cuentas y enlaces del libro), criterio del libro (inferido; atípico = candidato a revisión) y razonabilidad
 * física (norma o referencia técnica). Nunca da por bueno un diagnóstico.
 */
export function DerivacionVerificacion({ pacots, ambito, setAmbito, filtroInicial, abrirTramo }: Props) {
    const pacot = pacots.find((p) => etiquetaAmbito(p) === ambito) ?? pacots[0];
    const v = useMemo(() => (pacot ? verificarLibroCacheado(pacot.libro) : null), [pacot]);
    const [estados, setEstados] = useState<ReadonlySet<EstadoVerif>>(new Set<EstadoVerif>(['no_cuadra', 'atipico']));
    const [nivel, setNivel] = useState<NivelVerif | 0>(0);
    const [base, setBase] = useState<BaseJuicio | ''>('');
    const [red, setRed] = useState<TipoRed | ''>(filtroInicial.red);
    const [concepto, setConcepto] = useState(filtroInicial.concepto);
    const [q, setQ] = useState('');
    const [limite, setLimite] = useState(PAGINA);
    const { actualizar } = useNavegacion();

    if (!pacot || !v) return <SinPacot />;
    const tieneFichas = pacot.libro.fichas.canales.length + pacot.libro.fichas.drenes.length + pacot.libro.fichas.caminos.length > 0;

    const redes = [...new Set(v.resultados.map((r) => r.red).filter((r): r is TipoRed => r !== null))];
    // Filtro por nombre canónico: «Descopete bordos» (SRL) y «Terracerías» (M5) son el mismo concepto en canales.
    const canonDe = (r: ResultadoVerif): string | null => (r.concepto === null ? null : nombreConcepto(r.concepto, { red: r.red }).canonico);
    const rotulos = new Map<string, Set<string>>();
    for (const r of v.resultados) { const c = canonDe(r); if (c !== null && r.concepto !== null) rotulos.set(c, (rotulos.get(c) ?? new Set()).add(r.concepto)); }
    const conceptos = [...rotulos.keys()];
    const conceptoSel = concepto !== '' && !rotulos.has(concepto)
        ? (v.resultados.map((r) => (r.concepto === concepto ? canonDe(r) : null)).find((c) => c !== null) ?? concepto)
        : concepto;
    const texto = q.trim().toLowerCase();
    const filtrados = v.resultados.filter((r) =>
        estados.has(r.estado) && (nivel === 0 || r.nivel === nivel) && (base === '' || r.base === base) && (red === '' || r.red === red)
        && (conceptoSel === '' || canonDe(r) === conceptoSel) && (texto === '' || `${r.titulo} ${r.detalle} ${r.id}`.toLowerCase().includes(texto)));
    const alternar = (e: EstadoVerif) => { const s = new Set(estados); if (s.has(e)) s.delete(e); else s.add(e); setEstados(s); setLimite(PAGINA); };

    return (
        <section className="sc-card" aria-labelledby="cons-ver-t" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div><span className="sc-kicker">Diagnóstico · DIAG-01</span><h3 id="cons-ver-t" style={{ marginBottom: 0 }}>Verificación del diagnóstico</h3></div>
            <p className="sc-aviso cons-honesto" role="note">
                <ShieldAlert size={16} aria-hidden="true" />
                <span><b>Qué es y qué no es.</b> La norma no da una fórmula para la cantidad de cada tramo: la fija el organismo. Por eso aquí no se da el diagnóstico por bueno. Se comprueban sus cuentas, se
                    recupera el criterio que el propio libro aplica y se marcan los tramos que no lo siguen, y se revisa que las cifras sean físicamente posibles. Un <b>atípico</b> es un candidato a revisión, no un error confirmado.
                    Los valores son los guardados en el libro.</span>
            </p>
            {!tieneFichas && (
                <EstadoVacio tipo="error" titulo="Este PacOT se registró con una versión anterior" accion={actualizar ? { texto: 'Actualizar desde la carpeta', onClick: actualizar } : null}>
                    No trae las fichas de inventario, así que no se puede comprobar. {actualizar ? 'Léalo de nuevo desde la carpeta.' : 'Abra de nuevo el archivo de derivación generado con la versión actual.'}
                </EstadoVacio>
            )}

            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="cons-ver-amb">PacOT</label>
                    <select id="cons-ver-amb" value={etiquetaAmbito(pacot)} onChange={(e) => { setAmbito(e.target.value); setLimite(PAGINA); }}>
                        {pacots.map((p) => <option key={p.clave} value={etiquetaAmbito(p)} title={`Rótulo en el libro: ${p.ficha.moduloTexto}`}>{nombrePacot(p)}</option>)}
                    </select>
                </div>
            </div>

            <ul className="cons-der-tiles" aria-label="Resumen por estado">
                {ESTADOS.map((e) => (
                    <li key={e} className={`cons-der-tile cons-der-tile-${e}`}><b>{v.resumen.porEstado[e]}</b><span>{TEXTO_ESTADO_VERIF[e]}</span></li>
                ))}
            </ul>

            <div>
                <span className="sc-kicker">Nivel 2 · criterio que aplica el libro</span>
                <div className="sc-tabla-wrap table-scroll">
                    <table className="sc-tabla cons-tabla">
                        <caption style={{ position: 'absolute', left: -9999 }}>Criterio inferido por red y concepto</caption>
                        <thead><tr><th scope="col">Red · concepto</th><th scope="col">Criterio inferido</th><th scope="col" className="cons-n">Tramos que lo siguen</th><th scope="col" className="cons-n">Atípicos</th></tr></thead>
                        <tbody>
                            {v.criterios.map((c) => {
                                // Solo cuentan los grupos con criterio: un grupo «no evaluable» no se marca atípico (se explica con su motivo).
                                const atipicos = c.grupos.reduce((n, g) => n + (g.modelo === null ? 0 : g.n - g.siguen), 0);
                                return (
                                    <tr key={`${c.red}|${c.concepto}`}>
                                        <td><small>{nombreRed(c.red)}</small><span title={`Rótulo en el libro: ${c.concepto}`}>{nombreConcepto(c.concepto, { red: c.red }).canonico}</span></td>
                                        <td>
                                            <ul className="cons-pend">
                                                {c.grupos.map((g) => <li key={g.clave}>{c.agrupacion === 'ninguna' ? '' : `${g.clave}: `}{g.modelo === null && g.motivo !== undefined
                                                    ? <span>no evaluable: {g.motivo}</span>
                                                    : <><code className="cons-id" style={{ whiteSpace: 'normal' }}>{g.formula}</code> <small>({g.siguen}/{g.n})</small>{g.inferencia ? <small> · constante inferida</small> : null}</>}</li>)}
                                            </ul>
                                        </td>
                                        <td className="cons-n">{c.siguen}/{c.total}</td>
                                        <td className="cons-n">
                                            {atipicos > 0
                                                ? <button type="button" className="cons-der-enlace" onClick={() => { setRed(c.red); setConcepto(nombreConcepto(c.concepto, { red: c.red }).canonico); setEstados(new Set<EstadoVerif>(['atipico'])); setNivel(2); setLimite(PAGINA); }}>{atipicos}</button>
                                                : '0'}
                                        </td>
                                    </tr>
                                );
                            })}
                            {v.criterios.length === 0 && <tr><td colSpan={4}>No se pudo inferir ningún criterio (faltan fichas de inventario o tramos).</td></tr>}
                        </tbody>
                    </table>
                </div>
                <p className="cons-cuenta">Un criterio se considera recuperable si lo sigue al menos el {Math.round(PARAMETROS_VERIF.coberturaMinima * 100)} % de los tramos de un grupo (mínimo {PARAMETROS_VERIF.minTramosGrupo} tramos); tolerancia {PARAMETROS_VERIF.tolCriterioRel * 100} % por el redondeo de captura.</p>
            </div>

            <div>
                <span className="sc-kicker">Resultados</span>
                <div className="cons-filtros">
                    <div className="cons-sev-grupo" role="group" aria-label="Estado">
                        {ESTADOS.map((e) => (
                            <button key={e} type="button" className="cons-sev-btn" aria-pressed={estados.has(e)} onClick={() => alternar(e)}>{TEXTO_ESTADO_VERIF[e]} <small>{v.resumen.porEstado[e]}</small></button>
                        ))}
                    </div>
                    <div className="sc-campo">
                        <label htmlFor="cons-ver-niv">Nivel</label>
                        <select id="cons-ver-niv" value={nivel} onChange={(e) => { setNivel(Number(e.target.value) as NivelVerif | 0); setLimite(PAGINA); }}>
                            <option value={0}>Todos</option>
                            {NIVELES.map((n) => <option key={n.id} value={n.id}>{n.texto}</option>)}
                        </select>
                    </div>
                    <div className="sc-campo">
                        <label htmlFor="cons-ver-base">Base del juicio</label>
                        <select id="cons-ver-base" value={base} onChange={(e) => { setBase(e.target.value as BaseJuicio | ''); setLimite(PAGINA); }}>
                            <option value="">Todas</option>
                            {BASES.map((b) => <option key={b} value={b}>{TEXTO_BASE[b]}</option>)}
                        </select>
                    </div>
                    <div className="sc-campo">
                        <label htmlFor="cons-ver-red">Red</label>
                        <select id="cons-ver-red" value={red} onChange={(e) => { setRed(e.target.value as TipoRed | ''); setLimite(PAGINA); }}>
                            <option value="">Todas</option>
                            {redes.map((r) => <option key={r} value={r}>{nombreRed(r)}</option>)}
                        </select>
                    </div>
                    <div className="sc-campo">
                        <label htmlFor="cons-ver-con">Concepto</label>
                        <select id="cons-ver-con" value={conceptoSel} onChange={(e) => { setConcepto(e.target.value); setLimite(PAGINA); }}>
                            <option value="">Todos</option>
                            {conceptos.map((c) => <option key={c} value={c} title={`Rótulo en el libro: ${[...(rotulos.get(c) ?? [])].join(' / ')}`}>{c}</option>)}
                        </select>
                    </div>
                    <div className="sc-campo">
                        <label htmlFor="cons-ver-q">Buscar</label>
                        <input id="cons-ver-q" type="search" value={q} placeholder="inventario, concepto…" onChange={(e) => { setQ(e.target.value); setLimite(PAGINA); }} />
                    </div>
                    <span className="cons-cuenta" role="status">{filtrados.length} de {v.resultados.length}</span>
                </div>
                <ul className="cons-der-bases" aria-label="Qué significa cada base del juicio">
                    {BASES.map((b) => <li key={b}><ChipBase base={b} /> <small>{AYUDA_BASE[b]}</small></li>)}
                </ul>
                {filtrados.length === 0
                    ? <EstadoVacio titulo="Ningún resultado con estos filtros" accion={{ texto: 'Mostrar atípicos y no cuadra', onClick: () => { setEstados(new Set<EstadoVerif>(['no_cuadra', 'atipico'])); setNivel(0); setBase(''); setRed(''); setConcepto(''); setQ(''); setLimite(PAGINA); } }}>Se quitan los filtros de nivel, base, red, concepto y búsqueda.</EstadoVacio>
                    : <ul className="cons-lista">{filtrados.slice(0, limite).map((r) => <Resultado key={r.id} r={r} abrirTramo={abrirTramo} destino={destinoDeResultado(pacot.libro, etiquetaAmbito(pacot), r)} />)}</ul>}
                {filtrados.length > limite && <button type="button" className="sc-btn cons-mas" onClick={() => setLimite(limite + PAGINA)}>Mostrar {Math.min(PAGINA, filtrados.length - limite)} más</button>}
            </div>
        </section>
    );
}
