import { memo } from 'react';
import { CalendarRange } from 'lucide-react';
import type { Interanual } from '../../utils/informeVasoInteranual';
import './vasoNiveles.css';

interface Props { datos: Interanual | null; cargando: boolean }

const n = (v: number | null, d = 1) => (v == null ? 'S/D' : v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }));
const cambio = (v: number | null) => (v == null ? 'S/D' : `${v > 0.05 ? '▲' : v < -0.05 ? '▼' : '■'} ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} Mm³`);

/** Mismo día en años anteriores (serie normalizada 2021 en adelante): ubica el año en curso frente al histórico. */
function InteranualVaso({ datos, cargando }: Props) {
    const fecha = datos ? `${String(datos.dia).padStart(2, '0')}/${String(datos.mes).padStart(2, '0')}` : '';
    return (
        <section className="vaso-sc vaso-card" aria-labelledby="vaso-inter-t">
            <span className="vaso-kicker" id="vaso-inter-t"><CalendarRange size={13} aria-hidden="true" /> Comparativo interanual{fecha ? ` · mismo día (${fecha})` : ''}</span>
            {cargando ? <div className="vaso-vacio" role="status" style={{ marginTop: 10 }}>Cargando histórico…</div>
                : !datos || datos.filas.length === 0 ? <div className="vaso-vacio" style={{ marginTop: 10 }}>Sin histórico comparable para esta fecha (S/D).</div>
                    : (<>
                        <p className="vaso-inter-pos">{datos.posicion
                            ? <>Con <b>{n(datos.volumenHoy)} Mm³</b> hoy ocupa el lugar <b>{datos.posicion.posicion} de {datos.posicion.de}</b> (1 = el más bajo) entre los años con dato.</>
                            : 'Sin volumen vigente para ubicar el año en curso.'}</p>
                        <div className="vaso-inter-wrap">
                            <table className="vaso-inter">
                                <thead><tr><th>Año</th><th>Fecha usada</th><th>Volumen</th><th>Nivel</th><th>Hoy vs. ese año</th></tr></thead>
                                <tbody>{datos.filas.map((f) => (
                                    <tr key={f.anio}><td>{f.anio}</td><td>{f.fecha}{f.desfaseDias ? ` (${f.desfaseDias > 0 ? '+' : '−'}${Math.abs(f.desfaseDias)} d)` : ''}</td>
                                        <td>{n(f.volumen)} Mm³</td><td>{n(f.elevacion, 2)} msnm</td><td>{cambio(f.difVolumen)}</td></tr>
                                ))}</tbody>
                            </table>
                        </div>
                        <span className="vaso-kicker" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 8 }}>Serie normalizada con la curva vigente: comparable entre años aunque la curva cambió.</span>
                    </>)}
        </section>
    );
}

export default memo(InteranualVaso);
