import { useMemo, useState } from 'react';
import { concentrar, MAGNITUDES, type EstadoCiclo, type Magnitud } from '../../../conservacion/derivacion/registro';
import { AVISO_HONESTIDAD_COHERENCIA, nombreConcepto, redDeRotulo, nombreRed } from '../../../conservacion/vocabulario';
import { InsigniaConciliacion } from './formato';
import { fmt } from './fmt';

/** «Σ módulos» y «SRL» sin ninguna cifra distinta de cero: coincidir ahí no prueba nada. */
const esCeroOAusente = (v: string | null): boolean => v === null || Number(v) === 0;
const nombreBloque = (b: string): string => { const r = redDeRotulo(b); return r ? nombreRed(r) : b; };

const ROTULO: Record<Magnitud, string> = { importe: 'Importe anual ($)', necesidadAnual: 'Necesidad media anual', cantidadTrabajo: 'Cantidad total de trabajo' };

interface Props {
    estado: EstadoCiclo;
    esperados: readonly number[];
    /** Abre la cadena de cálculo de un concepto en el ámbito indicado. */
    verCadena: (ambito: string, bloque: string, concepto: string) => void;
}

/** Acumulado por asociación: cada concepto por módulo, la suma de los módulos y el libro de la SRL. */
export function DerivacionConcentrado({ estado, esperados, verCadena }: Props) {
    const [magnitud, setMagnitud] = useState<Magnitud>('importe');
    const [bloque, setBloque] = useState('');
    // Las columnas por módulo van aparte: con ellas la tabla no cabe y cortaba la columna Estado.
    const [porMod, setPorMod] = useState(false);
    const filas = useMemo(() => concentrar(estado), [estado]);
    const bloques = useMemo(() => [...new Set(filas.map((f) => f.bloque))], [filas]);
    const librosCargados = estado.modulos.length + (estado.srl ? 1 : 0);
    const visibles = filas.filter((f) => f.magnitud === magnitud && (bloque === '' || f.bloque === bloque));
    const parcial = estado.modulosFaltantes.length > 0;
    const cargados = new Set(estado.modulos.map((p) => p.ficha.numeroModulo));
    const dp = magnitud === 'importe' ? 0 : 2;
    const faltan = estado.modulosFaltantes.map((n) => `M${n}`).join(', ');

    return (
        <section className="sc-card" aria-labelledby="cons-con-t" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><span className="sc-kicker">Acumulado por asociación</span><h3 id="cons-con-t" style={{ marginBottom: 0 }}>Concentrado: módulos y SRL</h3></div>
            <p className="sc-aviso cons-honesto" role="note"><span>{AVISO_HONESTIDAD_COHERENCIA} «Coherente» aquí significa que la suma de los módulos coincide con la SRL dentro de la tolerancia.</span></p>
            {parcial && (
                <p className="sc-aviso" role="note">
                    <span><b>Ciclo en carga.</b> Falta cargar el PacOT de: {faltan}. La suma de módulos es parcial y las diferencias contra la SRL son esperadas hasta que lleguen. Los módulos no cargados no cuentan como cero. «Módulos» se refiere a módulos con PacOT cargado ({estado.modulos.length} de {esperados.length}); los libros registrados son {librosCargados}, contando el de la SRL.</span>
                </p>
            )}
            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="cons-con-mag">Magnitud</label>
                    <select id="cons-con-mag" value={magnitud} onChange={(e) => setMagnitud(e.target.value as Magnitud)}>
                        {MAGNITUDES.map((m) => <option key={m} value={m}>{ROTULO[m]}</option>)}
                    </select>
                </div>
                <div className="sc-campo">
                    <label htmlFor="cons-con-blq">Tipo de obra</label>
                    <select id="cons-con-blq" value={bloque} onChange={(e) => setBloque(e.target.value)}>
                        <option value="">Todos</option>
                        {bloques.map((b) => <option key={b} value={b} title={b}>{nombreBloque(b)}</option>)}
                    </select>
                </div>
                <label className="cons-der-check"><input type="checkbox" checked={porMod} onChange={(e) => setPorMod(e.target.checked)} /> Mostrar cada módulo ({esperados.length})</label>
                <span className="cons-cuenta">{visibles.length} conceptos</span>
            </div>
            <div className="sc-tabla-wrap table-scroll cons-con-wrap">
                <table className="sc-tabla cons-tabla cons-con-tabla">
                    <caption style={{ position: 'absolute', left: -9999 }}>Concentrado por concepto: módulos, suma de módulos y SRL</caption>
                    <thead>
                        <tr>
                            <th scope="col">Tipo de obra · concepto</th>
                            <th scope="col">Estado</th>
                            <th scope="col" className="cons-n">Σ módulos</th>
                            <th scope="col" className="cons-n">SRL</th>
                            <th scope="col" className="cons-n">Diferencia</th>
                            {porMod && esperados.map((n) => <th key={n} scope="col" className="cons-n">M{n}{!cargados.has(n) && <small>pendiente</small>}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {visibles.map((f) => (
                            <tr key={`${f.bloque}|${f.concepto}`}>
                                <td>
                                    <small title={f.bloque}>{nombreBloque(f.bloque)}</small>
                                    <button type="button" className="cons-der-enlace" title={`Rótulo en el libro: ${f.concepto}`} onClick={() => verCadena(estado.srl ? 'SRL' : `M${estado.modulos[0]?.ficha.numeroModulo ?? ''}`, f.bloque, f.concepto)}>{nombreConcepto(f.concepto, { bloque: f.bloque }).canonico}</button>
                                </td>
                                <td className="cons-con-estado"><InsigniaConciliacion estado={f.estado} parcial={parcial} sinDatosAmbos={f.estado === 'coincide' && esCeroOAusente(f.sumaModulos) && esCeroOAusente(f.srl)} /></td>
                                <td className="cons-n">{fmt(f.sumaModulos, dp)}</td>
                                <td className="cons-n">{f.estado === 'no_aplica_srl' ? '—' : fmt(f.srl, dp)}</td>
                                <td className="cons-n">{f.diferencia === null ? '—' : fmt(f.diferencia, dp)}</td>
                                {porMod && esperados.map((n) => {
                                    const v = f.porModulo.find((x) => x.numeroModulo === n);
                                    return <td key={n} className="cons-n" title={v?.ref ?? undefined}>{cargados.has(n) ? fmt(v?.valor, dp) : <span className="cons-der-pend" aria-label="pendiente de cargar">—</span>}</td>;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="cons-cuenta">Tolerancia de conciliación ±0.01 (redondeo de captura del libro).{visibles.some((f) => f.estado === 'no_aplica_srl') ? ' La red de drenaje no se compara contra la SRL: su inventario no tiene drenes.' : ''}</p>
        </section>
    );
}
