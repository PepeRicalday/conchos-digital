import { useMemo } from 'react';
import { AlertTriangle, Layers, ListChecks, ShieldAlert } from 'lucide-react';
import { TileCifra } from '../ui/TileCifra';
import type { ArchivoInforme } from '../../conservacion/informe/esquemaInforme';
import { contarPor, filasReglas, hallazgosPlanos, resumenReglas, TEXTO_ORIGEN, totalPendientes } from '../../conservacion/informe/vistas';

const fmt = (n: number) => n.toLocaleString('es-MX');

function Barras({ datos, total }: { datos: Array<[string, number]>; total: number }) {
    return (
        <ul className="cons-barras">
            {datos.map(([k, n]) => (
                <li key={k}>
                    <span>{k}</span><b>{fmt(n)}</b>
                    <span className="cons-barra" aria-hidden="true"><i style={{ width: `${total > 0 ? Math.max(2, (n / total) * 100) : 0}%` }} /></span>
                </li>
            ))}
        </ul>
    );
}

interface Props { archivo: ArchivoInforme; irAHallazgos: (regla: string) => void }

export function VistaResumen({ archivo, irAHallazgos }: Props) {
    const { informe } = archivo;
    const hallazgos = useMemo(() => hallazgosPlanos(archivo), [archivo]);
    const filas = useMemo(() => filasReglas(archivo), [archivo]);
    const reglas = useMemo(() => resumenReglas(filas), [filas]);
    const porClase = useMemo(() => contarPor(hallazgos, (h) => h.clase), [hallazgos]);
    const porOrigen = useMemo(() => contarPor(hallazgos, (h) => TEXTO_ORIGEN[h.origen] ?? h.origen), [hallazgos]);
    const topReglas = useMemo(() => filas.filter((f) => f.nHallazgos > 0).sort((a, b) => b.nHallazgos - a.nHallazgos).slice(0, 8), [filas]);
    const pendientes = totalPendientes(archivo);
    const r = informe.resumen;
    const sinDatos = filas.filter((f) => f.estado === 'sin_datos' || f.estado === 'no_evaluable' || f.estado === 'no_ejecutada');
    const pctReglas = reglas.total > 0 ? Math.round((reglas.implementadas / reglas.total) * 100) : 0;

    return (
        <div className="cons-pagina" style={{ gap: 18 }}>
            <div className="cons-pulso" aria-label="Hallazgos por severidad">
                <TileCifra etiqueta="Hallazgos" icono={<ShieldAlert size={16} aria-hidden="true" />} valor={fmt(r.hallazgos)}
                    estado={r.alta > 0 ? { texto: 'Requiere atención', tipo: 'crit' } : r.media > 0 ? { texto: 'Revisar', tipo: 'warn' } : { texto: 'Sin hallazgos en lo evaluado', tipo: 'info' }}
                    lineas={[<>en {fmt(reglas.conHallazgos)} reglas con hallazgos</>]} acento="var(--sc-sky)" />
                <TileCifra etiqueta="Severidad alta" valor={fmt(r.alta)} estado={{ texto: r.alta > 0 ? 'Alta' : 'Ninguna', tipo: r.alta > 0 ? 'crit' : 'ok' }}
                    lineas={['Inconsistencias que afectan cantidades, importes o la cadena de cálculo']} acento="var(--sc-crit)" />
                <TileCifra etiqueta="Severidad media" valor={fmt(r.media)} estado={{ texto: r.media > 0 ? 'Media' : 'Ninguna', tipo: r.media > 0 ? 'warn' : 'ok' }}
                    lineas={['Discrepancias a aclarar o sustentar']} acento="var(--sc-warn)" />
                <TileCifra etiqueta="Informativas" valor={fmt(r.informativa)} estado={{ texto: 'Informativa', tipo: 'info' }}
                    lineas={['Notas de la norma y errores de captura menores']} acento="var(--sc-s1)" />
            </div>

            <div className="sc-pulso-3" aria-label="Cobertura del comprobador">
                <TileCifra etiqueta="Reglas implementadas" icono={<ListChecks size={16} aria-hidden="true" />} valor={`${reglas.implementadas} de ${reglas.total}`}
                    estado={{ texto: `${pctReglas} % de la matriz`, tipo: 'warn' }}
                    lineas={[<>{reglas.noImplementadas} reglas aún no se ejecutan: <b>sin hallazgos no equivale a correcto</b></>]} acento="var(--sc-warn)" />
                <TileCifra etiqueta="Reglas sin hallazgos" icono={<Layers size={16} aria-hidden="true" />} valor={fmt(reglas.sinHallazgos)}
                    lineas={[<>{fmt(reglas.sinDatos)} sin datos suficientes en este libro</>]} acento="var(--sc-ok)" />
                <TileCifra etiqueta="Pendientes declarados" icono={<AlertTriangle size={16} aria-hidden="true" />} valor={fmt(pendientes)}
                    lineas={['Cosas que el motor no pudo comprobar con este archivo']} acento="var(--sc-violet)" />
            </div>

            <div className="sc-grid-2">
                <section className="sc-card" aria-labelledby="cons-r-clase">
                    <span className="sc-kicker">Dónde están</span>
                    <h3 id="cons-r-clase">Hallazgos por clase y origen</h3>
                    <Barras datos={porClase} total={r.hallazgos} />
                    <span className="cons-etiqueta" style={{ display: 'block', margin: '16px 0 8px' }}>Quién origina el hallazgo</span>
                    <Barras datos={porOrigen} total={r.hallazgos} />
                </section>
                <section className="sc-card" aria-labelledby="cons-r-top">
                    <span className="sc-kicker">Para empezar</span>
                    <h3 id="cons-r-top">Reglas con más hallazgos</h3>
                    <div className="sc-tabla-wrap">
                        <table className="sc-tabla cons-tabla">
                            <caption style={{ position: 'absolute', left: -9999 }}>Reglas con más hallazgos</caption>
                            <thead><tr><th scope="col">Regla</th><th scope="col" className="cons-n">Hallazgos</th></tr></thead>
                            <tbody>
                                {topReglas.map((f) => (
                                    <tr key={f.id}>
                                        <td>
                                            <button type="button" className="sc-btn" style={{ minHeight: 44, textAlign: 'left' }} onClick={() => irAHallazgos(f.id)}>
                                                <span className="cons-id">{f.id}</span> {f.regla.length > 52 ? `${f.regla.slice(0, 52)}…` : f.regla}
                                            </button>
                                        </td>
                                        <td className="cons-n">{fmt(f.nHallazgos)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>

            <section className="sc-card" aria-labelledby="cons-r-limites">
                <span className="sc-kicker">Límites de este informe</span>
                <h3 id="cons-r-limites">Lo que no se pudo comprobar</h3>
                <ul className="cons-pend">
                    <li>Los valores son los <b>guardados en el archivo</b> (caché), no un recálculo nativo; una aritmética que coincide no acredita la condición física de la obra.</li>
                    <li><b>{reglas.noImplementadas}</b> de {reglas.total} reglas de la matriz todavía no están implementadas (véase la pestaña Reglas).</li>
                    {sinDatos.length > 0 && <li>Sin datos suficientes en este libro: <span className="cons-id">{sinDatos.map((f) => f.id).join(', ')}</span> (por ejemplo, no trae análisis de precios ni seguimiento).</li>}
                    <li>Conchos es el único PacOT probado: no se ha demostrado que las reglas generalicen a otras estructuras de libro.</li>
                </ul>
            </section>
        </div>
    );
}
