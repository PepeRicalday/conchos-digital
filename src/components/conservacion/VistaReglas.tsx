import { useMemo, useState } from 'react';
import type { ArchivoInforme } from '../../conservacion/informe/esquemaInforme';
import { etiquetaEstadoRegla, filasReglas, resumenReglas, type EstadoReglaVista } from '../../conservacion/informe/vistas';
import { InsigniaEstadoRegla } from './Insignias';
import { DataTable } from '../ui/base';

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
                <span><b>{r.implementadas} de {r.total}</b> reglas están implementadas. Una regla «No evaluable · aún no implementada» no se evaluó: no equivale a que el programa cumpla.</span>
            </p>
            <div className="cons-filtros">
                <div className="sc-campo">
                    <label htmlFor="cons-g-estado">Estado</label>
                    <select id="cons-g-estado" value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoReglaVista)}>
                        <option value="">Todos ({filas.length})</option>
                        {estados.map((e) => <option key={e} value={e}>{etiquetaEstadoRegla(e)} ({filas.filter((f) => f.estado === e).length})</option>)}
                    </select>
                </div>
            </div>
            <DataTable
                apilar captionOculto className="cons-tabla" caption="Estado de cada regla del comprobador"
                clave={(f) => f.id} filas={visibles}
                columnas={[
                    { id: 'id', titulo: 'Regla', className: 'cons-id', render: (f) => f.id },
                    { id: 'clase', titulo: 'Clase', render: (f) => f.clase },
                    {
                        id: 'desc', titulo: 'Descripción',
                        render: (f) => (
                            <>
                                {f.regla}
                                {f.pendientes.length > 0 && (
                                    <details style={{ marginTop: 6 }}>
                                        <summary>{f.pendientes.length} pendiente(s) declarado(s)</summary>
                                        <ul className="cons-pend" style={{ marginTop: 6 }}>{f.pendientes.map((p, i) => <li key={i}>{p}</li>)}</ul>
                                    </details>
                                )}
                                {f.motivo && <div style={{ marginTop: 4, color: 'var(--text-3)' }}>{f.motivo}</div>}
                            </>
                        ),
                    },
                    { id: 'estado', titulo: 'Estado', render: (f) => <InsigniaEstadoRegla estado={f.estado} /> },
                    { id: 'cob', titulo: 'Cobertura', className: 'cons-n', render: (f) => f.cobertura ? <>{f.cobertura.revisados} / {f.cobertura.identificados}<br /><small>{f.cobertura.unidad}</small></> : 'S/D' },
                    {
                        id: 'hall', titulo: 'Hallazgos', className: 'cons-n',
                        render: (f) => f.nHallazgos > 0
                            ? <button type="button" className="sc-btn" style={{ minHeight: 44 }} onClick={() => abrirHallazgos(f.id)} aria-label={`Ver ${f.nHallazgos} hallazgos de ${f.id}`}>{f.nHallazgos}</button>
                            : f.cobertura ? '0' : 'S/D',
                    },
                ]}
            />
        </section>
    );
}
