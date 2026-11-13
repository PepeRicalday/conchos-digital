import { useMemo, useState } from 'react';
import { DataTable, type Columna } from '../../ui/base';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import BotonCsv from './BotonCsv';
import { csvTabla } from '../../../utils/cuerposAgua';
import { ordenarPresas, type OrdenCuenca } from '../../../utils/cuencaViz';
import { GLIFO_ESTADO } from '../../../utils/presaNiveles';
import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';
import FilaTanques from './FilaTanques';
import DetallePresaCuenca from './DetallePresaCuenca';
import PequenosMultiplos from './PequenosMultiplos';
import SemaforoBadge from './SemaforoBadge';
import Segmentado from './Segmentado';

const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const fmtFlujo = (v: number | null) => (v == null ? 'S/D' : formatearNumero(v, v !== 0 && Math.abs(v) < 1 ? 3 : 2));

export type VistaPresas = 'tanques' | 'tabla';
type Alcance = 'todas' | 'distrito';

function columnasPresas(cila: Map<string, number | null | undefined>): Columna<PresaCuencaModelo>[] {
    return [
        {
            id: 'presa', titulo: 'Presa', encabezadoFila: true,
            render: (m) => {
                const f = m.fila;
                const difCila = f.presaId ? cila.get(f.presaId) : undefined;
                return (
                    <div className="cu-presa">
                        <span className="cu-nombre">{f.etiqueta}</span>
                        {f.delDistrito && <span className="cu-tag">Distrito</span>}
                        {f.sinActualizar && <span className="cu-tag cu-tag--aviso">Sin actualizar</span>}
                        {f.sinActualizar && (
                            <span className="cu-nota-fila">
                                Sin actualizar{f.igualDesde ? ` desde el ${fechaCorta(f.igualDesde)}` : ''}{f.diasIgual ? ` (${f.diasIgual} días)` : ''}: CONAGUA repite el último dato obtenido{f.almacenamientoMm3 != null ? ` (${formatearNumero(f.almacenamientoMm3, 3)} Mm³)` : ''} aunque reporta aportación y extracción.
                            </span>
                        )}
                        {f.delDistrito && difCila != null && (
                            <span className="cu-nota-fila">Diferencia contra CILA: {difCila > 0 ? '+' : difCila < 0 ? '−' : ''}{formatearNumero(Math.abs(difCila), 2)} %</span>
                        )}
                    </div>
                );
            },
        },
        { id: 'alm', titulo: 'Almacenamiento (Mm³)', className: 'cu-num', render: (m) => fmt(m.fila.almacenamientoValido, 1) },
        { id: 'pct', titulo: '% NAMO', className: 'cu-num', render: (m) => m.fila.pct == null ? 'S/D' : `${formatearNumero(m.fila.pct, 1)} %` },
        {
            id: 'estado', titulo: 'Estado',
            render: (m) => (
                <span className={`cu-estado cu-estado--${m.fila.estado.clave}`}>
                    <span aria-hidden="true">{GLIFO_ESTADO[m.fila.estado.clave]}</span> {m.fila.estado.etiqueta}
                </span>
            ),
        },
        { id: 'util', titulo: '% útil', className: 'cu-num', render: (m) => m.util ? `${formatearNumero(m.util.pctUtil, 1)} %` : 'S/D' },
        { id: 'pos', titulo: 'Posición', className: 'cu-num', render: (m) => <>{m.posicion?.percentil != null ? `p${m.posicion.percentil}` : 'S/D'}{m.posicion && <span className="cu-nota-fila">n = {m.posicion.nAnios} años</span>}</> },
        { id: 'sem', titulo: 'Semáforo', render: (m) => <SemaforoBadge s={m.semaforo} /> },
        { id: 'apo', titulo: 'Aportación', className: 'cu-num', render: (m) => fmtFlujo(m.fila.aportacionM3s) },
        { id: 'ext', titulo: 'Extracción', className: 'cu-num', render: (m) => fmtFlujo(m.fila.extraccionTotalM3s) },
        { id: 'ver', titulo: 'Vertido', className: 'cu-num', render: (m) => fmtFlujo(m.fila.vertidoM3s) },
        {
            id: 'fecha', titulo: 'Dato del', className: 'cu-fecha', claseFila: (m) => m.frescura === 'atrasada' ? 'cu-fecha--vieja' : undefined,
            render: (m) => <>{m.fila.fecha ? fechaCorta(m.fila.fecha) : 'S/D'}{m.frescura === 'atrasada' && <span className="cu-nota-fila">Atrasada {m.atrasoDias} d</span>}</>,
        },
    ];
}

/** Las presas con telemetría diaria: tanques a escala con ficha y serie, o tabla con todas las cifras (y su CSV). */
export default function PresasCuenca({ modelos, cila, vista, onVista, sel, onSel }: {
    modelos: PresaCuencaModelo[]; cila: Map<string, number | null | undefined>;
    vista: VistaPresas; onVista: (v: VistaPresas) => void; sel: number | null; onSel: (id: number) => void;
}) {
    const [orden, setOrden] = useState<OrdenCuenca>('cuenca');
    const [alcance, setAlcance] = useState<Alcance>('todas');
    const [meses, setMeses] = useState<3 | 12>(12);
    const visibles = useMemo(() => {
        const base = alcance === 'distrito' ? modelos.filter((m) => m.fila.delDistrito) : modelos;
        return ordenarPresas(base.map((m) => ({ ...m, ubicacionId: m.fila.ubicacionId, pct: m.fila.pct, namoMm3: m.fila.namoMm3, atrasoDias: m.atrasoDias })), orden);
    }, [modelos, alcance, orden]);
    const actual = visibles.find((m) => m.fila.ubicacionId === sel) ?? visibles[0] ?? null;
    const seleccionId = actual?.fila.ubicacionId ?? null;

    const csv = () => {
        const cab = ['presa', 'fecha', 'almacenamiento_mm3', 'pct_namo', 'namo_mm3', 'estado', 'pct_util', 'percentil', 'anios_historia', 'aportacion_m3s', 'extraccion_m3s', 'vertido_m3s', 'sin_actualizar'];
        const filas = visibles.map((m) => [m.fila.etiqueta, m.fila.fecha, m.fila.almacenamientoValido, m.fila.pct, m.fila.namoMm3, m.fila.estado.etiqueta, m.util?.pctUtil ?? null,
            m.posicion?.percentil ?? null, m.posicion?.nAnios ?? null, m.fila.aportacionM3s, m.fila.extraccionTotalM3s, m.fila.vertidoM3s, m.fila.sinActualizar ? 'si' : 'no']);
        return csvTabla(cab, filas);
    };

    return (
        <>
            <div className="cu-controles" role="group" aria-label="Vista y filtros de la cuenca">
                <Segmentado<VistaPresas> etiqueta="Vista" valor={vista} onChange={onVista}
                    opciones={[{ v: 'tanques', t: 'Tanques' }, { v: 'tabla', t: 'Tabla' }]} />
                <Segmentado<OrdenCuenca> etiqueta="Orden" valor={orden} onChange={setOrden}
                    opciones={[{ v: 'cuenca', t: 'Cuenca' }, { v: 'llenado', t: '% llenado' }, { v: 'volumen', t: 'Tamaño' }, { v: 'frescura', t: 'Frescura' }]} />
                <Segmentado<Alcance> etiqueta="Presas" valor={alcance} onChange={setAlcance}
                    opciones={[{ v: 'todas', t: 'Todas' }, { v: 'distrito', t: 'Solo distrito' }]} />
                {vista === 'tanques' && (
                    <Segmentado<3 | 12> etiqueta="Serie" valor={meses} onChange={setMeses} opciones={[{ v: 3, t: '3 meses' }, { v: 12, t: '12 meses' }]} />
                )}
            </div>

            {vista === 'tanques' ? (
                <div className="cu-cq" id="cu-presas">
                  <div className="cu-presas-grid">
                    <section className="an-card" aria-label="Tanques de las presas de la cuenca">
                        <h4 className="an-h">Presas de la cuenca</h4>
                        <p className="an-nota">Toque una presa para ver su detalle. El tamaño de cada tanque es su capacidad real; el estado usa los umbrales de referencia de SICA (20 % y 40 % del NAMO de CONAGUA).</p>
                        <FilaTanques modelos={visibles} seleccionada={seleccionId} onSelect={onSel} />
                    </section>
                    {actual && <DetallePresaCuenca m={actual} difCila={actual.fila.presaId ? cila.get(actual.fila.presaId) : undefined} />}
                    <div className="cu-presas-multiplos"><PequenosMultiplos modelos={visibles} meses={meses} seleccionada={seleccionId} onSelect={onSel} /></div>
                  </div>
                </div>
            ) : (
                <section className="an-card" id="cu-presas" aria-label="Estado de las presas de la cuenca">
                    <div className="cu-red-cab">
                        <div>
                            <h4 className="an-h">Presas de la cuenca</h4>
                            <p className="an-nota">Porcentaje sobre el NAMO que publica CONAGUA; los umbrales de estado son referencia interna de SICA. El % útil descuenta el volumen muerto y la posición compara con el mismo día de 2017 a {new Date().getFullYear() - 1}. Caudales del día en m³/s.</p>
                        </div>
                        <BotonCsv nombre="presas-cuenca-conchos.csv" generar={csv} />
                    </div>
                    <DataTable
                        propia
                        className="cu-tabla" claseContenedor="cu-tabla-wrap" regionAria="Tabla de presas (desplazable)" captionOculto caption="Presas de la cuenca del Conchos"
                        clave={(m) => String(m.fila.ubicacionId)} filas={visibles}
                        columnas={columnasPresas(cila)}
                    />
                </section>
            )}
        </>
    );
}
