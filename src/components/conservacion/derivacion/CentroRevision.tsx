import { useMemo, useState } from 'react';
import { Loader2, SearchCheck } from 'lucide-react';
import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import type { TipoRed } from '../../../conservacion/derivacion/tipos';
import {
    conciliacionesSinTramo, contarRazones, filtrarAtipicos, opcionesDeFiltro, type AtipicoPieza, type AtipicoTramo, type DestinoPieza, type DestinoTramo, type RazonPieza, type RazonTramo,
} from '../../../conservacion/verificacion/revision';
import { AVISO_HONESTIDAD_COHERENCIA, formatoPK, nombreRed, TEXTO_RAZON_ATIPICO, type RazonAtipico } from '../../../conservacion/vocabulario';
import { etiquetaAmbito, fmt, nombrePacot } from './fmt';
import { ChipRazon } from './formato';
import { BotonAbrirTramo } from './BotonAbrirTramo';
import './centro-revision.css';

const PAGINA = 40;
const ORDEN_RAZONES: readonly RazonAtipico[] = ['criterio', 'control_adicional', 'conciliacion', 'regla'];

interface Props {
    pacots: readonly PacotRegistrado[];
    /** null mientras se calculan. */
    atipicos: readonly AtipicoTramo[] | null;
    /** Conceptos de obras puntuales (modelo por-pieza) que difieren; solo los que de verdad difieren. */
    atipicosPieza?: readonly AtipicoPieza[] | null;
    abrirTramo: (d: DestinoTramo) => void;
    abrirPieza?: (d: DestinoPieza) => void;
    verVerificacion: (red: TipoRed | '', concepto: string) => void;
}

const porcentaje = (r: number | null): string | null => (r === null ? null : `${(r * 100).toLocaleString('es-MX', { maximumFractionDigits: r < 0.1 ? 1 : 0 })} %`);

/** Las dos cifras de una razón, dichas con palabras: «En el libro 1,558.4 · Según el criterio 2,124.8 m³ · 27 % de diferencia». */
function Cifras({ r }: { r: RazonTramo }) {
    if (r.enLibro === null && r.referencia === null) return <span className="cr-cifras">{TEXTO_RAZON_ATIPICO[r.razon].larga}</span>;
    const p = porcentaje(r.relativa);
    return (
        <span className="cr-cifras">
            <span>{r.etiquetas[0]} <b>{fmt(r.enLibro, 2)}</b>{r.unidad ? ` ${r.unidad}` : ''}</span>
            <span>{r.etiquetas[1]} <b>{fmt(r.referencia, 2)}</b>{r.unidad ? ` ${r.unidad}` : ''}</span>
            {p !== null && <span className="cr-dif">difiere {p}</span>}
        </span>
    );
}

function CifrasPieza({ r }: { r: RazonPieza }) {
    const p = porcentaje(r.relativa);
    return (
        <span className="cr-cifras">
            <span>{r.etiquetas[0]} <b>{fmt(r.enLibro, 2)}</b>{r.unidad ? ` ${r.unidad}` : ''}</span>
            <span>{r.etiquetas[1]} <b>{fmt(r.referencia, 2)}</b>{r.unidad ? ` ${r.unidad}` : ''}</span>
            {p !== null && <span className="cr-dif">difiere {p}</span>}
        </span>
    );
}

function FilaPieza({ t, nombrePac, abrir }: { t: AtipicoPieza; nombrePac: string; abrir?: (d: DestinoPieza) => void }) {
    return (
        <li className="cr-fila cr-pieza" data-razones={t.razones.length}>
            <div className="cr-tramo">
                <b className="cr-pk" title={`Rótulo en el libro: ${t.rotuloConcepto}`}>{t.nombre}</b>
                <span className="cr-obra">Obras puntuales</span>
                <span className="cr-donde">{nombrePac} · fila {t.fila} de 3DN</span>
            </div>
            <ul className="cr-razones" aria-label={`Razones por las que ${t.nombre} es atípico`}>
                {t.razones.map((r) => (
                    <li key={r.id}>
                        <span className="cr-razon-cab"><ChipRazon razon={r.razon} /><span className="cr-concepto">{r.titulo}</span></span>
                        <CifrasPieza r={r} />
                    </li>
                ))}
            </ul>
            <div className="cr-accion">
                {abrir && <button type="button" className="sc-btn cr-abrir" aria-label={`Abrir ${t.nombre} de ${nombrePac}`} onClick={() => abrir(t.destino)}>Abrir</button>}
            </div>
        </li>
    );
}

function Fila({ t, nombrePac, abrirTramo }: { t: AtipicoTramo; nombrePac: string; abrirTramo: (d: DestinoTramo) => void }) {
    const tramo = `${formatoPK(t.pkInicial)} → ${formatoPK(t.pkFinal)}`;
    return (
        <li className="cr-fila" data-razones={t.razones.length}>
            <div className="cr-tramo">
                <b className="cr-pk">{tramo}</b>
                <span className="cr-obra">{t.obra}</span>
                <span className="cr-donde">{nombrePac} · {nombreRed(t.red)} · fila {t.fila}</span>
            </div>
            <ul className="cr-razones" aria-label={`Razones por las que ${tramo} es atípico`}>
                {t.razones.map((r) => (
                    <li key={r.id}>
                        <span className="cr-razon-cab">
                            <ChipRazon razon={r.razon} />
                            <span className="cr-concepto" title={r.rotuloConcepto ? `Rótulo en el libro: ${r.rotuloConcepto}` : undefined}>{r.concepto ?? r.titulo}</span>
                        </span>
                        <Cifras r={r} />
                    </li>
                ))}
            </ul>
            <div className="cr-accion">
                <BotonAbrirTramo destino={t.destino} abrir={abrirTramo} etiqueta={`Abrir tramo ${tramo} de ${nombrePac}`} />
            </div>
        </li>
    );
}

/**
 * Centro de revisión: todos los tramos atípicos del ciclo (SRL y módulos) en una sola lista, agrupados por tramo. Un tramo que
 * es atípico por dos razones aparece una vez con ambas. «Atípico» es candidato a revisión, no error confirmado.
 */
export function CentroRevision({ pacots, atipicos, atipicosPieza = null, abrirTramo, abrirPieza, verVerificacion }: Props) {
    const [f, setF] = useState<{ ambito: string; red: TipoRed | ''; concepto: string; razon: RazonAtipico | '' }>({ ambito: '', red: '', concepto: '', razon: '' });
    const [limite, setLimite] = useState(PAGINA);
    const nombrePorAmbito = useMemo(() => new Map(pacots.map((p) => [etiquetaAmbito(p), nombrePacot(p)])), [pacots]);
    const opciones = useMemo(() => opcionesDeFiltro(atipicos ?? []), [atipicos]);
    const visibles = useMemo(() => filtrarAtipicos(atipicos ?? [], f), [atipicos, f]);
    const sinTramo = useMemo(() => pacots.reduce((n, p) => n + conciliacionesSinTramo(p.libro), 0), [pacots]);
    const piezasVisibles = useMemo(() => (atipicosPieza ?? []).filter((t) => (f.ambito === '' || t.ambito === f.ambito) && f.red === '' && (f.concepto === '' || t.nombre === f.concepto) && (f.razon === '' || t.razones.some((r) => r.razon === f.razon))), [atipicosPieza, f]);
    const hayFiltro = f.ambito !== '' || f.red !== '' || f.concepto !== '' || f.razon !== '';
    const cambia = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setLimite(PAGINA); };

    return (
        <section className="sc-card cr" aria-labelledby="cr-t">
            <div className="cr-cab">
                <div>
                    <span className="sc-kicker">Revisión del ciclo</span>
                    <h3 id="cr-t" style={{ marginBottom: 0 }}>Tramos atípicos</h3>
                </div>
                {atipicos !== null && (
                    <p className="cr-total" role="status" aria-live="polite">
                        <b>{visibles.length}</b> {visibles.length === 1 ? 'tramo' : 'tramos'}
                        <span> · {contarRazones(visibles)} {contarRazones(visibles) === 1 ? 'razón' : 'razones'}{hayFiltro ? ` (de ${atipicos.length} tramos)` : ''}</span>
                    </p>
                )}
            </div>
            <p className="sc-aviso cr-honesto" role="note"><span>{AVISO_HONESTIDAD_COHERENCIA}<span className="cr-orden"> Un tramo con dos razones va primero; después, la mayor diferencia relativa.</span></span></p>

            {atipicos === null && <p className="sc-aviso" role="status"><Loader2 size={16} className="cons-der-gira" aria-hidden="true" /><span>Calculando los atípicos de los PacOT cargados…</span></p>}

            {atipicos !== null && atipicos.length === 0 && (
                <div className="cr-vacio" role="status">
                    <SearchCheck size={28} aria-hidden="true" />
                    <p><b>Ningún tramo atípico en los PacOT cargados.</b> No es una aprobación: solo se compararon el criterio de cada libro y los controles que el comprobador tiene implementados.</p>
                    <button type="button" className="sc-btn" onClick={() => verVerificacion('', '')}>Ver la verificación completa</button>
                </div>
            )}

            {atipicos !== null && atipicos.length > 0 && (
                <>
                    <div className="cons-filtros cr-filtros">
                        <div className="sc-campo">
                            <label htmlFor="cr-amb">PacOT</label>
                            <select id="cr-amb" value={f.ambito} onChange={(e) => cambia({ ambito: e.target.value })}>
                                <option value="">Todos</option>
                                {opciones.ambitos.map((a) => <option key={a} value={a}>{nombrePorAmbito.get(a) ?? a}</option>)}
                            </select>
                        </div>
                        <div className="sc-campo">
                            <label htmlFor="cr-red">Red</label>
                            <select id="cr-red" value={f.red} onChange={(e) => cambia({ red: e.target.value as TipoRed | '' })}>
                                <option value="">Todas</option>
                                {opciones.redes.map((r) => <option key={r} value={r}>{nombreRed(r)}</option>)}
                            </select>
                        </div>
                        <div className="sc-campo">
                            <label htmlFor="cr-con">Concepto</label>
                            <select id="cr-con" value={f.concepto} onChange={(e) => cambia({ concepto: e.target.value })}>
                                <option value="">Todos</option>
                                {opciones.conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div className="sc-campo">
                            <label htmlFor="cr-raz">Razón</label>
                            <select id="cr-raz" value={f.razon} onChange={(e) => cambia({ razon: e.target.value as RazonAtipico | '' })}>
                                <option value="">Todas</option>
                                {ORDEN_RAZONES.filter((r) => opciones.razones.includes(r)).map((r) => <option key={r} value={r} title={TEXTO_RAZON_ATIPICO[r].larga}>{TEXTO_RAZON_ATIPICO[r].corta}</option>)}
                            </select>
                        </div>
                        {hayFiltro && <button type="button" className="sc-btn" onClick={() => cambia({ ambito: '', red: '', concepto: '', razon: '' })}>Quitar filtros</button>}
                    </div>

                    {visibles.length === 0
                        ? <p className="sc-vacio" role="status">Ningún tramo coincide con estos filtros. <button type="button" className="cons-der-enlace" onClick={() => cambia({ ambito: '', red: '', concepto: '', razon: '' })}>Quitar filtros</button></p>
                        : (
                            <>
                                <div className="cr-cols" aria-hidden="true"><span>Tramo</span><span>Por qué es atípico</span><span /></div>
                                <ul className="cr-lista">
                                    {visibles.slice(0, limite).map((t) => <Fila key={t.clave} t={t} nombrePac={nombrePorAmbito.get(t.ambito) ?? t.ambito} abrirTramo={abrirTramo} />)}
                                </ul>
                                {visibles.length > limite && (
                                    <button type="button" className="sc-btn cons-mas" onClick={() => setLimite(limite + PAGINA)}>Mostrar {Math.min(PAGINA, visibles.length - limite)} más</button>
                                )}
                            </>
                        )}
                </>
            )}

            {piezasVisibles.length > 0 && (
                <section className="cr-obras" aria-labelledby="cr-obras-t">
                    <h4 id="cr-obras-t">Obras puntuales atípicas <small>{piezasVisibles.length}</small></h4>
                    <p className="cr-nota">Estructuras y edificios (hoja 3DN) cuya cantidad difiere del inventario o cuya aritmética no cuadra. Si coincide, no aparece aquí.</p>
                    <ul className="cr-lista">
                        {piezasVisibles.map((t) => <FilaPieza key={t.clave} t={t} nombrePac={nombrePorAmbito.get(t.ambito) ?? t.ambito} {...(abrirPieza ? { abrir: abrirPieza } : {})} />)}
                    </ul>
                </section>
            )}

            {sinTramo > 0 && (
                <p className="cr-nota">
                    Además hay {sinTramo} diferencias de conteo de estructuras (IO4 contra IO1) que son de todo el PacOT y no de un tramo.{' '}
                    <button type="button" className="cons-der-enlace" onClick={() => verVerificacion('', '')}>Verlas en Verificación</button>
                </p>
            )}
        </section>
    );
}
