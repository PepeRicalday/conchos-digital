import { useMemo, useState } from 'react';
import type { ArchivoInforme } from '../../conservacion/informe/esquemaInforme';
import { filasReglas, resumenReglas, TEXTO_ESTADO_REGLA, type EstadoReglaVista } from '../../conservacion/informe/vistas';
import { InsigniaEstadoRegla } from './Insignias';

export function VistaReglas({ archivo, abrirHallazgos }: { archivo: ArchivoInforme; abrirHallazgos: (regla: string) => void }) {
    const filas = useMemo(() => filasReglas(archivo), [archivo]);
    const r = useMemo(() => resumenReglas(filas), [filas]);
    const [estado, setEstado] = useState<'' | EstadoReglaVista>('');
    const visibles = estado ? filas.filter((f) => f.estado === estado) : filas;
    const estados = [...new Set(filas.map((f) => f.estado))];

    return (
        <section className="sc-card" aria-labelledby="cons-rg-t" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><span className="sc-kicker">Matriz norma → regla → prueba</span><h3 id="cons-rg-t" style={{ marginBottom: 0 }}>Las {r.total} reglas</h3></div>
            <p className="sc-aviso cons-honesto" role="note">
                <span><b>{r.implementadas} de {r.total}</b> reglas están implementadas. Una regla "no implementada" no se evaluó: no equivale a que el programa cumpla.</span>
            </p>
            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="cons-g-estado">Estado</label>
                    <select id="cons-g-estado" value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoReglaVista)}>
                        <option value="">Todos ({filas.length})</option>
                        {estados.map((e) => <option key={e} value={e}>{TEXTO_ESTADO_REGLA[e]} ({filas.filter((f) => f.estado === e).length})</option>)}
                    </select>
                </div>
            </div>
            <div className="sc-tabla-wrap table-scroll">
                <table className="sc-tabla cons-tabla cons-apila">
                    <caption style={{ position: 'absolute', left: -9999 }}>Estado de cada regla del comprobador</caption>
                    <thead>
                        <tr><th scope="col">Regla</th><th scope="col">Clase</th><th scope="col">Descripción</th><th scope="col">Estado</th><th scope="col" className="cons-n">Cobertura</th><th scope="col" className="cons-n">Hallazgos</th></tr>
                    </thead>
                    <tbody>
                        {visibles.map((f) => (
                            <tr key={f.id}>
                                <td className="cons-id" data-label="Regla">{f.id}</td>
                                <td data-label="Clase">{f.clase}</td>
                                <td data-label="Descripción">
                                    {f.regla}
                                    {f.pendientes.length > 0 && (
                                        <details style={{ marginTop: 6 }}>
                                            <summary>{f.pendientes.length} pendiente(s) declarado(s)</summary>
                                            <ul className="cons-pend" style={{ marginTop: 6 }}>{f.pendientes.map((p, i) => <li key={i}>{p}</li>)}</ul>
                                        </details>
                                    )}
                                    {f.motivo && <div style={{ marginTop: 4, color: 'var(--sc-t3)' }}>{f.motivo}</div>}
                                </td>
                                <td data-label="Estado"><InsigniaEstadoRegla estado={f.estado} /></td>
                                <td className="cons-n" data-label="Cobertura">
                                    {f.cobertura ? <>{f.cobertura.revisados} / {f.cobertura.identificados}<br /><small>{f.cobertura.unidad}</small></> : 'S/D'}
                                </td>
                                <td className="cons-n" data-label="Hallazgos">
                                    {f.nHallazgos > 0
                                        ? <button type="button" className="sc-btn" style={{ minHeight: 44 }} onClick={() => abrirHallazgos(f.id)} aria-label={`Ver ${f.nHallazgos} hallazgos de ${f.id}`}>{f.nHallazgos}</button>
                                        : f.cobertura ? '0' : 'S/D'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
