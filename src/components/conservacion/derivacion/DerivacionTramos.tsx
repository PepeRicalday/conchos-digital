import { useMemo, useState } from 'react';
import type { PacotRegistrado } from '../../../conservacion/derivacion/registro';
import { agruparTramos, verificarTotalesDiagnostico } from '../../../conservacion/derivacion/vistas';
import type { ResultadoVerif } from '../../../conservacion/verificacion/tipos';
import { verificarLibroCacheado } from '../../../conservacion/verificacion/verificar';
import { AVISO_HONESTIDAD_COHERENCIA, formatoPK, nombreConcepto, nombreRed } from '../../../conservacion/vocabulario';
import { comprobarTramo, type Comprobacion } from '../../../conservacion/verificacion/comprobacion';
import { estadoConRazon, type DestinoTramo } from '../../../conservacion/verificacion/revision';
import { canonizarTexto, etiquetaAmbito, fmt, nombrePacot } from './fmt';
import { ChipRazon, InsigniaEstado, InsigniaResultado, InsigniaVerificacion, Origen } from './formato';
import { SinPacot } from './EstadoVacio';
import { BotonAbrirTramo } from './BotonAbrirTramo';
import { desdeComp } from '../../../conservacion/vocabulario';

interface Props { pacots: readonly PacotRegistrado[]; ambito: string; setAmbito: (a: string) => void }
interface PropsTramos extends Props { abrirTramo: (d: DestinoTramo) => void }

const AVISO = <p className="sc-aviso cons-honesto" role="note"><span>{AVISO_HONESTIDAD_COHERENCIA}</span></p>;

const PRIORIDAD = { no_cuadra: 0, atipico: 1, informativo: 2, no_evaluable: 3, cuadra: 4 } as const;

/** ¿El resultado habla de esta columna de DIAG-01? (en caminos el concepto lleva el nombre real y la columna entre paréntesis). */
const mismaColumna = (r: ResultadoVerif, columna: string): boolean => r.concepto === null || r.concepto === columna || r.concepto.endsWith(`(col. ${columna})`);

/** Peor estado de un tramo en la verificación (integridad, criterio del libro, física) y el detalle en el título. */
function EstadoFila({ rs, comp }: { rs: readonly ResultadoVerif[] | undefined; comp: Comprobacion | null | undefined }) {
    // El estado real del tramo en este concepto (criterio y controles) manda; sin cálculo por tramo se cae a lo que haya en la verificación.
    if (comp) {
        const r = estadoConRazon(comp);
        return (
            <span className="cr-estado-tramo">
                <InsigniaEstado e={desdeComp(comp.estado)} />
                {comp.estado === 'atipico' && (<>
                    {r.criterio === 'atipico' && <ChipRazon razon="criterio" />}
                    {r.controles === 'atipico' && <ChipRazon razon="control_adicional" />}
                </>)}
            </span>
        );
    }
    if (!rs || rs.length === 0) return <span className="cons-cuenta" title="Este tramo no tiene cálculo por tramo ni observaciones en la verificación">S/D</span>;
    const peor = [...rs].sort((a, b) => PRIORIDAD[a.estado] - PRIORIDAD[b.estado])[0]!;
    return (
        <span title={rs.map((r) => `• ${r.titulo}`).join('\n')}>
            <InsigniaResultado estado={peor.estado} />{rs.length > 1 && <small> +{rs.length - 1}</small>}
        </span>
    );
}

function Selector({ pacots, ambito, setAmbito, id }: Props & { id: string }) {
    return (
        <div className="sc-campo">
            <label htmlFor={id}>PacOT</label>
            <select id={id} value={ambito} onChange={(e) => setAmbito(e.target.value)}>
                {pacots.map((p) => <option key={p.clave} value={etiquetaAmbito(p)} title={`Rótulo en el libro: ${p.ficha.moduloTexto}`}>{nombrePacot(p)}</option>)}
            </select>
        </div>
    );
}

/** Tramo por tramo del diagnóstico (DIAG-01): red → canal, camino o dren → tramo, con su cantidad y cómo se calculó. */
export function DerivacionTramos({ pacots, ambito, setAmbito, abrirTramo }: PropsTramos) {
    const pacot = pacots.find((p) => etiquetaAmbito(p) === ambito) ?? pacots[0];
    const [conceptoIdx, setConceptoIdx] = useState(0);
    const redes = useMemo(() => (pacot ? agruparTramos(pacot.libro) : []), [pacot]);
    const verifs = useMemo(() => (pacot ? verificarTotalesDiagnostico(pacot.libro) : []), [pacot]);
    const ver = useMemo(() => (pacot ? verificarLibroCacheado(pacot.libro) : null), [pacot]);
    const columna = pacot?.libro.conceptosDiagnostico[Math.min(conceptoIdx, Math.max((pacot?.libro.conceptosDiagnostico.length ?? 1) - 1, 0))] ?? '';
    const porFila = useMemo(() => {
        const m = new Map<number, ResultadoVerif[]>();
        for (const r of ver?.resultados ?? []) {
            if (r.tramoFila === null || !mismaColumna(r, columna)) continue;
            m.set(r.tramoFila, [...(m.get(r.tramoFila) ?? []), r]);
        }
        return m;
    }, [ver, columna]);
    // La comprobación por tramo del concepto elegido, para decir el estado real de cada tramo y abrirlo.
    const porTramo = useMemo(() => {
        const m = new Map<number, Comprobacion>();
        if (!pacot || !ver) return m;
        for (const crit of ver.criterios.filter((c) => c.indiceConcepto === conceptoIdx)) {
            for (const fila of Object.keys(crit.porTramo).map(Number)) {
                const c = comprobarTramo(pacot.libro, ver.criterios, ver.uniones, fila, conceptoIdx);
                if (c) m.set(fila, c);
            }
        }
        return m;
    }, [pacot, ver, conceptoIdx]);
    if (!pacot) return <SinPacot />;
    const conceptos = pacot.libro.conceptosDiagnostico;
    const idx = Math.min(conceptoIdx, Math.max(conceptos.length - 1, 0));
    // Las columnas de DIAG-01 no traen red: «Terracerías» es el descopete de bordos si el libro solo tiene canales.
    const soloCanales = redes.some((r) => r.red === 'distribucion' || r.red === 'tuberia');
    const nombreCol = (c: string) => nombreConcepto(c, soloCanales ? { red: 'distribucion' } : {});

    return (
        <section className="sc-card" aria-labelledby="cons-tr-t" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><span className="sc-kicker">Diagnóstico · DIAG-01</span><h3 id="cons-tr-t" style={{ marginBottom: 0 }}>Concepto por tramo, canal, camino y dren</h3></div>
            <div className="cons-filtros">
                <Selector pacots={pacots} ambito={etiquetaAmbito(pacot)} setAmbito={setAmbito} id="cons-tr-amb" />
                <div className="sc-campo">
                    <label htmlFor="cons-tr-con">Concepto</label>
                    <select id="cons-tr-con" value={idx} onChange={(e) => setConceptoIdx(Number(e.target.value))}>
                        {conceptos.map((c, i) => <option key={c} value={i} title={`Rótulo en el libro: ${c}`}>{nombreCol(c).canonico}</option>)}
                    </select>
                </div>
                <span className="cons-cuenta">{pacot.libro.tramos.length} tramos</span>
            </div>

            {AVISO}
            <ul className="cons-der-verif">
                {verifs.map((v) => (
                    <li key={v.descripcion} title={v.descripcion}><InsigniaVerificacion estado={v.estado} /><span>{canonizarTexto(v.descripcion, conceptos, { red: 'distribucion' })}</span>
                        <small>{v.estado === 'no_evaluable' ? 'falta un dato' : `Σ ${fmt(v.observado)} · total del libro ${fmt(v.esperado)}`}</small></li>
                ))}
            </ul>

            {redes.length === 0 && <p>Este PacOT no trae tramos en DIAG-01.</p>}
            {redes.map((r) => (
                <div key={r.red} className="cons-der-red">
                    <h4>{nombreRed(r.red)} <small>{r.obras.length} obras</small></h4>
                    {r.obras.map((o) => (
                        <details key={`${o.inventario}|${o.obra}`} className="cons-der-obra">
                            <summary>
                                <span className="cons-id">{o.inventario}</span>
                                <span className="cons-der-obra-n">{o.obra}</span>
                                <span className="cons-n">{fmt(o.kmTotal, 3)} km</span>
                                <span className="cons-n" title={`Rótulo en el libro: ${conceptos[idx] ?? ''}`}><b>{fmt(o.sumaTrabajo[idx]?.suma)}</b> {nombreConcepto(conceptos[idx] ?? '', { red: r.red }).canonico}</span>
                            </summary>
                            <div className="sc-tabla-wrap table-scroll">
                                <table className="sc-tabla cons-tabla">
                                    <caption style={{ position: 'absolute', left: -9999 }}>Tramos de {o.obra}</caption>
                                    <thead><tr><th scope="col">Cadenamiento</th><th scope="col" className="cons-n">Longitud km</th><th scope="col" className="cons-n">Paramétrica</th><th scope="col" className="cons-n">De trabajo</th><th scope="col">Cómo se calculó</th><th scope="col">Verificación</th><th scope="col"><span className="cr-solo-lector">Comprobación por tramo</span></th></tr></thead>
                                    <tbody>
                                        {o.tramos.map((t) => {
                                            const c = t.conceptos[idx];
                                            const comp = porTramo.get(t.fila);
                                            return (
                                                <tr key={t.fila}>
                                                    <td className="cons-id">{formatoPK(t.pkInicial)} → {formatoPK(t.pkFinal)}</td>
                                                    <td className="cons-n">{fmt(t.km.valor, 3)}</td>
                                                    <td className="cons-n">{fmt(c?.parametrica.valor, 3)}</td>
                                                    <td className="cons-n"><b>{fmt(c?.trabajo.valor, 3)}</b></td>
                                                    <td>{c ? <Origen cifra={c.trabajo} /> : '—'}</td>
                                                    <td><EstadoFila rs={porFila.get(t.fila)} comp={comp} /></td>
                                                    <td className="cr-celda-accion">
                                                        {comp
                                                            ? <BotonAbrirTramo texto="Ver cálculo" destino={{ ambito: etiquetaAmbito(pacot), red: t.red, indiceConcepto: idx, fila: t.fila }} abrir={abrirTramo} etiqueta={`Ver el cálculo de ${nombreConcepto(conceptos[idx] ?? '', { red: t.red }).canonico} en ${formatoPK(t.pkInicial)} a ${formatoPK(t.pkFinal)}`} />
                                                            : <span className="cr-sin" title="Sin ficha de inventario o sin cifra para recalcular este tramo">Sin cálculo</span>}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    ))}
                </div>
            ))}
        </section>
    );
}
