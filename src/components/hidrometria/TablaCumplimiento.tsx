import { memo, useEffect, useRef } from 'react';
import { ETIQUETA_CUMPLIMIENTO, type EstadoCumplimiento, type FilaSemana } from '../../utils/hidrometria';
import { fmt, fmtPct } from '../../utils/formato';
import { DataTable, Insignia, type Columna } from '../ui/base';
import type { EstadoTipo } from '../../types/estado';

const TIPO: Record<EstadoCumplimiento, EstadoTipo> = {
    cumple: 'ok', bajo: 'crit', sobre: 'warn', sin_dato: 'sd', sin_solicitud: 'sd', futura: 'info',
};

export interface FilaConCiclo extends FilaSemana { avanceCicloPct: number | null }

/** Cumplimiento por módulo (más desviado primero). El estado va siempre en texto, no solo en color. */
export const TablaCumplimiento = memo(function TablaCumplimiento({ filas, resaltarId }: { filas: FilaConCiclo[]; resaltarId?: string | null }) {
    const filaRef = useRef<HTMLTableRowElement>(null);
    // Llegada desde el Dashboard (?modulo=): se lleva la fila a la vista.
    useEffect(() => { if (resaltarId) filaRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [resaltarId, filas.length]);
    return (
        <section className="sc-card" aria-labelledby="hid-tabla-t">
            <span className="sc-kicker">Cumplimiento por módulo</span>
            <h3 id="hid-tabla-t">Programado contra entregado</h3>
            <DataTable
                clave={(f) => f.moduloId} filas={filas}
                caption="Volumen semanal programado y entregado por módulo, en Mm³. S/D = sin solicitud o sin captura."
                filaProps={(f) => f.moduloId === resaltarId
                    ? { ref: filaRef, 'aria-current': 'true', style: { background: 'color-mix(in srgb, var(--st-info) 14%, transparent)', boxShadow: 'inset 3px 0 0 var(--st-info)' } }
                    : undefined}
                columnas={[
                    { id: 'mod', titulo: 'Módulo', encabezadoFila: true, render: (f) => f.nombre },
                    { id: 'prog', titulo: 'Programado', numerica: true, render: (f) => fmt(f.programadoMm3, 3) },
                    { id: 'ent', titulo: 'Entregado', numerica: true, render: (f) => fmt(f.entregadoMm3, 3) },
                    { id: 'cumpl', titulo: 'Cumpl.', numerica: true, render: (f) => fmtPct(f.cumplimientoPct) },
                    { id: 'ciclo', titulo: 'Ciclo', numerica: true, ayuda: () => 'Volumen entregado del ciclo contra el autorizado', render: (f) => fmtPct(f.avanceCicloPct) },
                    { id: 'estado', titulo: 'Estado', numerica: true, render: (f) => <Insignia tipo={TIPO[f.estado]} sinIcono>{ETIQUETA_CUMPLIMIENTO[f.estado]}</Insignia> },
                ] satisfies Columna<FilaConCiclo>[]}
            />
            <p className="sc-fresco">Cumpl. = entregado ÷ programado prorrateado a los días transcurridos de la semana. Ciclo = volumen entregado del ciclo ÷ autorizado.</p>
        </section>
    );
});
