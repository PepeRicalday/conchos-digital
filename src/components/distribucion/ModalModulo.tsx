import '../dashboard/DashboardTema.css';
import { Modal, DataTable, Insignia, type Columna } from '../ui/base';
import { getLogoPath } from '../../utils/uiHelpers';
import { volumenCiclo, caudalModulo } from '../../utils/distribucion';
import { fmt, fmtMiles } from '../../utils/formato';
import type { ModuleData } from '../../store/useHydraStore';

const TIPOS: { tipo: 'toma' | 'lateral' | 'carcamo'; nombre: string }[] = [
    { tipo: 'toma', nombre: 'Tomas' }, { tipo: 'lateral', nombre: 'Laterales' }, { tipo: 'carcamo', nombre: 'Cárcamos' },
];

/** Detalle de un módulo: cifras del ciclo y del día, entrega por tipo y las tomas con actividad. Diálogo accesible. */
export function ModalModulo({ modulo, onCerrar }: { modulo: ModuleData; onCerrar: () => void }) {
    const v = volumenCiclo(modulo);
    const q = caudalModulo(modulo);
    const activos = modulo.delivery_points.filter((p) => p.is_open || p.current_q_lps > 0 || p.daily_vol > 0);
    return (
        <Modal
            abierto onCerrar={onCerrar} tamano="lg" kicker={modulo.short_code || modulo.id.slice(0, 6)} titulo={modulo.acu_name || modulo.name}
            icono={<img src={getLogoPath(modulo.name, modulo.short_code || '', modulo.logo_url)} alt="" width={52} height={52} className="dc-logo" />}
        >
                <div className="sc-grid-3" style={{ margin: '14px 0' }}>
                    <div className="sc-cifra"><span>Volumen del día</span><b>{fmt(modulo.daily_vol, 4)}<small>Mm³</small></b></div>
                    <div className="sc-cifra"><span>Caudal</span><b>{fmtMiles(q.lps, 0)}<small>L/s</small></b></div>
                    <div className="sc-cifra"><span>Ciclo consumido</span><b>{v.pct != null ? `${v.pct.toFixed(1)}` : 'S/D'}<small>{v.pct != null ? '%' : ''}</small></b></div>
                </div>
                <p className="sc-fresco">
                    {fmtMiles(v.consumidoMm3, 2)} Mm³ consumidos · {v.disponibleMm3 != null ? `${fmtMiles(v.disponibleMm3, 2)} Mm³ disponibles de ${fmtMiles(v.autorizadoMm3, 2)} Mm³ autorizados` : 'sin volumen autorizado cargado'}
                </p>

                <div style={{ marginTop: 12 }}>
                    <DataTable
                        clave={(t) => t.tipo} filas={TIPOS} caption="Entrega acumulada por tipo de punto"
                        columnas={[
                            { id: 'tipo', titulo: 'Tipo', encabezadoFila: true, render: (t) => t.nombre },
                            { id: 'n', titulo: 'Puntos', numerica: true, render: (t) => String(modulo.delivery_points.filter((p) => p.type === t.tipo).length) },
                            {
                                id: 'acum', titulo: 'Acumulado (Mm³)', numerica: true,
                                render: (t) => { const ps = modulo.delivery_points.filter((p) => p.type === t.tipo); return ps.length ? fmt(ps.reduce((a, p) => a + (p.accumulated || 0), 0), 4) : 'S/D'; },
                            },
                        ] satisfies Columna<(typeof TIPOS)[number]>[]}
                    />
                </div>

                <div style={{ marginTop: 14 }}>
                    <DataTable
                        clave={(p) => p.id} filas={activos} vacio="Sin tomas con actividad registrada." caption="Infraestructura de entrega con actividad"
                        columnas={[
                            { id: 'punto', titulo: 'Punto', encabezadoFila: true, render: (p) => <>{p.name}<br /><span className="sc-fresco">{p.type} · km {p.km}</span></> },
                            { id: 'q', titulo: 'Gasto (L/s)', numerica: true, render: (p) => fmtMiles(p.current_q_lps, 0) },
                            { id: 'vol', titulo: 'Vol. día (Mm³)', numerica: true, render: (p) => fmt(p.daily_vol, 4) },
                            { id: 'acum', titulo: 'Acum. (Mm³)', numerica: true, render: (p) => fmt(p.accumulated, 4) },
                            { id: 'est', titulo: 'Estado', numerica: true, render: (p) => <Insignia tipo={p.is_open ? 'ok' : 'sd'} sinIcono>{p.is_open ? 'Abierta' : 'Cerrada'}</Insignia> },
                        ] satisfies Columna<(typeof activos)[number]>[]}
                    />
                </div>
        </Modal>
    );
}
