import { useMemo } from 'react';
import { History } from 'lucide-react';
import { usePresasHistorico } from '../hooks/usePresasHistorico';
import { formatearNumero, mismaFecha, MESES_LARGO } from '../utils/historicoPresas';

/**
 * "Esta misma fecha en años anteriores": contexto histórico de la presa seleccionada.
 * Usa la serie NORMALIZADA (comparable entre años aunque la curva haya cambiado). Si un año no tiene lectura
 * ese día se toma la más cercana (±3 días) y se indica el desfase; si tampoco hay, el año no aparece (S/D).
 */

interface Props {
    presaId: string;
    /** Fecha mostrada en la sala (YYYY-MM-DD). */
    fechaISO: string;
    /** Almacenamiento actual en Mm³ (null = S/D). */
    almacenamientoHoyMm3: number | null;
}

export default function PresaHistoricoContexto({ presaId, fechaISO, almacenamientoHoyMm3 }: Props) {
    const { indice, anios, loading } = usePresasHistorico();
    const anioActual = Number(fechaISO.slice(0, 4));
    const mes = Number(fechaISO.slice(5, 7));
    const dia = Number(fechaISO.slice(8, 10));

    const filas = useMemo(() => {
        const previos = anios.filter(a => a < anioActual);
        const vol = mismaFecha(indice[presaId], mes, dia, previos, 'volumen', 'normalizada');
        const pct = mismaFecha(indice[presaId], mes, dia, previos, 'llenado', 'normalizada');
        return vol.map(v => ({ ...v, pct: pct.find(p => p.anio === v.anio)?.valor ?? null })).sort((a, b) => b.anio - a.anio).slice(0, 5);
    }, [indice, anios, presaId, mes, dia, anioActual]);

    if (loading || filas.length === 0) return null;

    const etiquetaFecha = `${dia} de ${MESES_LARGO[mes - 1].toLowerCase()}`;

    return (
        <section className="pr-hist pr-reveal" style={{ ['--i' as string]: 5 }} aria-label={`El ${etiquetaFecha} en años anteriores`}>
            <header className="pr-hist-head">
                <History size={14} aria-hidden="true" />
                <h3>El {etiquetaFecha} en años anteriores</h3>
                <span>serie normalizada · mismo día o el más cercano (±3 días)</span>
            </header>
            <ul className="pr-hist-lista">
                {filas.map(f => {
                    const dif = almacenamientoHoyMm3 != null ? almacenamientoHoyMm3 - f.valor : null;
                    return (
                        <li key={f.anio}>
                            <span className="pr-hist-anio">{f.anio}</span>
                            <span className="pr-hist-vol">{formatearNumero(f.valor, 1)}<small>Mm³</small></span>
                            <span className="pr-hist-pct">{f.pct == null ? 'S/D' : `${formatearNumero(f.pct, 1)} %`}</span>
                            <span className={`pr-hist-dif ${dif == null ? '' : dif > 0 ? 'is-up' : dif < 0 ? 'is-down' : ''}`}>
                                {dif == null ? 'S/D' : `hoy ${dif > 0 ? '+' : dif < 0 ? '−' : ''}${formatearNumero(Math.abs(dif), 1)} Mm³`}
                            </span>
                            {f.desfaseDias !== 0 && <span className="pr-hist-nota">dato del {Number(f.fecha.slice(8))} {MESES_LARGO[Number(f.fecha.slice(5, 7)) - 1].slice(0, 3).toLowerCase()}</span>}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
