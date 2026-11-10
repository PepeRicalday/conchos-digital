import { memo } from 'react';
import { CalendarRange } from 'lucide-react';
import type { Interanual } from '../../utils/informeVasoInteranual';
import './vasoNiveles.css';
import { DataTable } from '../ui/base';

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
                        <DataTable
                            clave={(f) => String(f.anio)} filas={datos.filas}
                            columnas={[
                                { id: 'anio', titulo: 'Año', encabezadoFila: true, render: (f) => f.anio },
                                { id: 'fecha', titulo: 'Fecha usada', render: (f) => `${f.fecha}${f.desfaseDias ? ` (${f.desfaseDias > 0 ? '+' : '−'}${Math.abs(f.desfaseDias)} d)` : ''}` },
                                { id: 'vol', titulo: 'Volumen', numerica: true, render: (f) => `${n(f.volumen)} Mm³` },
                                { id: 'niv', titulo: 'Nivel', numerica: true, render: (f) => `${n(f.elevacion, 2)} msnm` },
                                { id: 'dif', titulo: 'Hoy vs. ese año', numerica: true, render: (f) => cambio(f.difVolumen) },
                            ]}
                        />
                        <span className="vaso-kicker" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 8 }}>Serie normalizada con la curva vigente: comparable entre años aunque la curva cambió.</span>
                    </>)}
        </section>
    );
}

export default memo(InteranualVaso);
