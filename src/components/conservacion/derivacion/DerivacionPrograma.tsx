import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, GitBranch } from 'lucide-react';
import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import { sumar } from '../../../conservacion/derivacion/vistas';
import { filtrarPrograma, paginar, vistaPrograma, type RenglonVista } from '../../../conservacion/derivacion/programaVista';
import { AVISO_HONESTIDAD_COHERENCIA, nombreRed } from '../../../conservacion/vocabulario';
import type { DestinoTramo } from '../../../conservacion/verificacion/revision';
import { destinoDeConcepto } from '../../../conservacion/verificacion/revision';
import { etiquetaAmbito, fmt, nombrePacot } from './fmt';
import { Origen } from './formato';
import { BotonAbrirTramo } from './BotonAbrirTramo';
import { EstadoVacio, SinPacot } from './EstadoVacio';
import './programa.css';

const TAM_PAGINA = 25;

interface Props {
    pacots: readonly PacotRegistrado[];
    ambito: string;
    setAmbito: (a: string) => void;
    abrirTramo: (d: DestinoTramo) => void;
    verCadena: (ambito: string, bloque: string, concepto: string) => void;
}

/** Importe en pesos o «S/D»: nunca «$S/D». */
const pesos = (v: string | null): string => (v === null ? 'S/D' : `$${fmt(v)}`);

/** «HA» → «ha», «M3» → «m³»: la unidad se lee como en el resto de la plataforma. */
const unidadLegible = (u: string | null): string => (u === null ? '' : u.trim().replace(/m3/i, 'm³').replace(/m2/i, 'm²').toLowerCase());
const cantidadTexto = (v: string | null, u: string | null, dec = 4): string => (v === null ? 'S/D' : `${fmt(v, dec)} ${unidadLegible(u)}`.trim());

interface Parcial { valor: string | null; con: number; de: number }
/** Suma solo los renglones con dato y dice cuántos son: una suma con huecos no se presenta como total. */
function sumaParcial(filas: readonly RenglonVista[], dato: (f: RenglonVista) => string | null): Parcial {
    const conDato = filas.map(dato).filter((v): v is string => v !== null);
    return { valor: conDato.length === 0 ? null : sumar(conDato), con: conDato.length, de: filas.length };
}
const notaParcial = (p: Parcial): string | null => (p.valor !== null && p.con < p.de ? `${p.con} de ${p.de} con dato` : null);

/** Cantidad de un conjunto de renglones: solo si todos están en la misma unidad (sumar ha con m³ no tiene sentido). */
function cantidadDe(filas: readonly RenglonVista[]): { texto: string; nota: string | null } {
    const unidades = new Set(filas.map((f) => unidadLegible(f.r.unidad)));
    if (unidades.size !== 1) return { texto: 'unidades mixtas', nota: null };
    const p = sumaParcial(filas, (f) => f.r.cantidad.valor);
    return { texto: cantidadTexto(p.valor, filas[0]?.r.unidad ?? null, 2), nota: notaParcial(p) };
}

/**
 * Programa de obra (SEG-3): los renglones del libro en una lista que se filtra por concepto y obra, se busca por texto, se pagina,
 * y desde cada renglón lleva a la cadena de cálculo del concepto y al tramo de DIAG-01 que describe.
 */
export function DerivacionPrograma({ pacots, ambito, setAmbito, abrirTramo, verCadena }: Props) {
    const pacot = pacots.find((p) => etiquetaAmbito(p) === ambito) ?? pacots[0];
    const todas = useMemo(() => (pacot ? vistaPrograma(pacot.libro) : []), [pacot]);
    const [concepto, setConcepto] = useState('');
    const [obra, setObra] = useState('');
    const [texto, setTexto] = useState('');
    const [pagina, setPagina] = useState(1);

    const conceptos = useMemo(() => [...new Set(todas.map((f) => f.concepto))], [todas]);
    const obras = useMemo(() => [...new Set(todas.map((f) => f.r.obra))], [todas]);
    const resumen = useMemo(() => conceptos.map((c) => {
        const filas = todas.filter((f) => f.concepto === c);
        return { concepto: c, n: filas.length, cantidad: cantidadDe(filas), importe: sumaParcial(filas, (f) => f.r.importe.valor), rotulo: filas[0]?.rotuloLibro ?? c };
    }), [conceptos, todas]);

    // Primer tramo que conviene abrir de cada concepto (un atípico si lo hay): se calcula una vez por concepto, no por renglón.
    const primerTramo = useMemo(() => {
        const m = new Map<string, DestinoTramo | null>();
        if (!pacot) return m;
        for (const f of todas) {
            const k = `${f.r.red}|${f.indiceConcepto}`;
            if (f.indiceConcepto !== null && !m.has(k)) m.set(k, destinoDeConcepto(pacot.libro, etiquetaAmbito(pacot), f.r.red, f.indiceConcepto));
        }
        return m;
    }, [pacot, todas]);

    if (!pacot) return <SinPacot />;
    const conceptoValido = conceptos.includes(concepto) ? concepto : '';
    const obraValida = obras.includes(obra) ? obra : '';
    const filtradas = filtrarPrograma(todas, { concepto: conceptoValido, obra: obraValida, texto });
    const pag = paginar(filtradas, pagina, TAM_PAGINA);
    const amb = etiquetaAmbito(pacot);
    const hayFiltro = conceptoValido !== '' || obraValida !== '' || texto.trim() !== '';
    const quitar = () => { setConcepto(''); setObra(''); setTexto(''); setPagina(1); };

    return (
        <section className="sc-card cons-pg" aria-labelledby="cons-pg-t" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div><h3 id="cons-pg-t" style={{ marginBottom: 0 }}>Programa de obra por concepto</h3><p className="cons-pg-sub">Renglones de SEG-3, con el concepto, la obra y el tramo al que corresponde cada uno.</p></div>
            <p className="sc-aviso cons-honesto" role="note"><span>{AVISO_HONESTIDAD_COHERENCIA}</span></p>

            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="cons-pg-amb">PacOT</label>
                    <select id="cons-pg-amb" value={amb} onChange={(e) => { setAmbito(e.target.value); quitar(); }}>
                        {pacots.map((p) => <option key={p.clave} value={etiquetaAmbito(p)} title={`Rótulo en el libro: ${p.ficha.moduloTexto}`}>{nombrePacot(p)}</option>)}
                    </select>
                </div>
                <div className="sc-campo">
                    <label htmlFor="cons-pg-con">Concepto</label>
                    <select id="cons-pg-con" value={conceptoValido} onChange={(e) => { setConcepto(e.target.value); setPagina(1); }}>
                        <option value="">Todos</option>
                        {conceptos.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                {obras.length > 1 && (
                    <div className="sc-campo">
                        <label htmlFor="cons-pg-obra">Obra</label>
                        <select id="cons-pg-obra" value={obraValida} onChange={(e) => { setObra(e.target.value); setPagina(1); }}>
                            <option value="">Todas</option>
                            {obras.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </div>
                )}
                <div className="sc-campo cons-pg-buscar">
                    <label htmlFor="cons-pg-q">Buscar</label>
                    <input id="cons-pg-q" type="search" value={texto} placeholder="obra, kilómetro o clave" onChange={(e) => { setTexto(e.target.value); setPagina(1); }} />
                </div>
            </div>

            {todas.length === 0 ? (
                <EstadoVacio titulo="Este PacOT no trae renglones de programa con clave de catálogo">
                    El programa se lee de la hoja SEG-3. Si el libro debería traerlos, vuelva a leerlo desde la carpeta de PacOT.
                </EstadoVacio>
            ) : (
                <>
                    <div className="sc-tabla-wrap table-scroll">
                        <table className="sc-tabla cons-tabla cons-pg-resumen">
                            <caption className="cons-solo-lector">Resumen del programa por concepto</caption>
                            <thead><tr><th scope="col">Concepto</th><th scope="col" className="cons-n">Renglones</th><th scope="col" className="cons-n">Cantidad</th><th scope="col" className="cons-n">Importe</th></tr></thead>
                            <tbody>
                                {resumen.map((s) => (
                                    <tr key={s.concepto} data-activo={conceptoValido === s.concepto ? '' : undefined}>
                                        <td><button type="button" className="cons-der-enlace" aria-pressed={conceptoValido === s.concepto} title={`Rótulo en el libro: ${s.rotulo}`} onClick={() => { setConcepto(conceptoValido === s.concepto ? '' : s.concepto); setPagina(1); }}>{s.concepto}</button></td>
                                        <td className="cons-n" data-label="Renglones">{s.n}</td>
                                        <td className="cons-n" data-label="Cantidad">{s.cantidad.texto}{s.cantidad.nota && <small>{s.cantidad.nota}</small>}</td>
                                        <td className="cons-n" data-label="Importe"><b>{pesos(s.importe.valor)}</b>{notaParcial(s.importe) && <small>{notaParcial(s.importe)}</small>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="cons-pg-cuenta" role="status">
                        <span><b>{filtradas.length}</b> de {todas.length} renglones</span>
                        {filtradas.length > 0 && (() => { const p = sumaParcial(filtradas, (f) => f.r.importe.valor); return <span>Importe {pesos(p.valor)}{notaParcial(p) ? ` (${notaParcial(p)})` : ''}</span>; })()}
                        {hayFiltro && <button type="button" className="cons-der-enlace" onClick={quitar}>Quitar filtros</button>}
                    </div>

                    {filtradas.length === 0 ? (
                        <EstadoVacio titulo="Ningún renglón coincide con estos filtros" accion={{ texto: 'Quitar filtros', onClick: quitar }}>
                            Pruebe con otro concepto o con parte del kilómetro, por ejemplo «K-12».
                        </EstadoVacio>
                    ) : (
                        <div className="sc-tabla-wrap table-scroll">
                            <table className="sc-tabla cons-tabla cons-apila cons-pg-tabla">
                                <caption className="cons-solo-lector">Renglones del programa de obra, página {pag.pagina} de {pag.paginas}</caption>
                                <thead><tr><th scope="col">Obra y localización</th><th scope="col">Concepto</th><th scope="col" className="cons-n">Cantidad</th><th scope="col" className="cons-n">P.U.</th><th scope="col" className="cons-n">Importe</th><th scope="col">Cómo se calculó</th><th scope="col">Ir a</th></tr></thead>
                                <tbody>
                                    {pag.items.map((f) => {
                                        const r = f.r;
                                        const destino: DestinoTramo | null = f.tramoFila !== null && f.indiceConcepto !== null && pacot.libro.tramos.length > 0
                                            ? { ambito: amb, red: r.red, indiceConcepto: f.indiceConcepto, fila: f.tramoFila }
                                            : (f.indiceConcepto !== null ? (primerTramo.get(`${r.red}|${f.indiceConcepto}`) ?? null) : null);
                                        const exacto = f.tramoFila !== null && destino !== null && destino.fila === f.tramoFila;
                                        return (
                                            <tr key={r.fila} className="pg-fila">
                                                <td data-label="Obra y localización"><span className="cons-pg-obra">{r.obra}</span><small className="cons-pg-loc">{r.localizacion} · {fmt(r.km.valor, 3)} km</small><small className="cons-pg-clave">{r.clave} · fila {r.fila}</small></td>
                                                <td data-label="Concepto"><span title={`Rótulo en el libro: ${f.rotuloLibro}`}>{f.concepto}</span><small>{nombreRed(r.red)}</small></td>
                                                <td className="cons-n" data-label="Cantidad">{cantidadTexto(r.cantidad.valor, r.unidad)}</td>
                                                <td className="cons-n" data-label="P.U." title={r.pu.formula ? `=${r.pu.formula}` : undefined}>{pesos(r.pu.valor)}</td>
                                                <td className="cons-n" data-label="Importe"><b>{pesos(r.importe.valor)}</b></td>
                                                <td data-label="Cómo se calculó"><Origen cifra={r.cantidad} /></td>
                                                <td className="cons-pg-ir" data-label="Ir a">
                                                    <BotonAbrirTramo texto={exacto ? 'Ver tramo' : 'Ver concepto'} destino={destino} abrir={abrirTramo}
                                                        etiqueta={exacto ? `Abrir el tramo ${r.localizacion} de ${r.obra} en la comprobación` : `Abrir el primer tramo de ${f.concepto} en la comprobación`} />
                                                    {f.necesidad !== null && (
                                                        <button type="button" className="sc-btn" onClick={() => verCadena(amb, f.necesidad!.bloque, f.necesidad!.concepto)} aria-label={`Ver la cadena de cálculo de ${f.concepto}`}>
                                                            <GitBranch size={16} aria-hidden="true" /> Cadena
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {pag.paginas > 1 && (
                        <nav className="cons-pg-pags" aria-label="Páginas del programa">
                            <button type="button" className="sc-btn" onClick={() => setPagina(pag.pagina - 1)} disabled={pag.pagina <= 1}><ChevronLeft size={16} aria-hidden="true" /> Anterior</button>
                            <span className="cons-cuenta">Renglones {pag.desde}-{pag.hasta} · página {pag.pagina} de {pag.paginas}</span>
                            <button type="button" className="sc-btn" onClick={() => setPagina(pag.pagina + 1)} disabled={pag.pagina >= pag.paginas}>Siguiente <ChevronRight size={16} aria-hidden="true" /></button>
                        </nav>
                    )}
                </>
            )}
        </section>
    );
}
