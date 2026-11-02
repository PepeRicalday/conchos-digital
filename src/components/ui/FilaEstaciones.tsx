import { memo } from 'react';
import { Radio, TriangleAlert, CircleX } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { textoEdad, textoDuracion, horaLocal, fechaHoraLocal, fmt, type EstadiaEnlace } from '../../utils/hidroEstaciones';

export interface UltimoDatoFila { tipo: 'gasto' | 'nivel' | 'bajo'; valor: number; t: number; edadMin: number }
export interface EstacionFila {
    id: string; nombre: string; clave: 'en_linea' | 'retraso' | 'sin_transmision' | 'sd'; edadMin: number | null; serieGasto: (number | null)[];
    /** Último dato conocido (opcional: el informe general no lo usa). */
    ultimoDato?: UltimoDatoFila | null;
    estadia?: EstadiaEnlace;
}

const corto = (n: string) => { const base = n.split(' - ')[0]; return base.length > 14 ? base.split(' ').slice(0, 2).join(' ') : base; };

/** Texto + unidad del último dato. El 0 nunca se inventa: sin dato = S/D; el gasto censurado se escribe "< umbral". */
export function textoDato(d: UltimoDatoFila | null | undefined): { valor: string; unidad: string } {
    if (!d) return { valor: 'S/D', unidad: '' };
    if (d.tipo === 'bajo') return { valor: `< ${d.valor.toFixed(0)}`, unidad: 'm³/s' };
    if (d.tipo === 'nivel') return { valor: fmt(d.valor, 2), unidad: 'm' };
    return { valor: fmt(d.valor, d.valor >= 100 ? 0 : d.valor >= 10 ? 1 : 2), unidad: 'm³/s' };
}

/** Una columna por estación: antena (forma distinta por estado), nombre, último dato conocido, estadía en el estado y gasto de 24 h. */
export const FilaEstaciones = memo(function FilaEstaciones({ estaciones }: { estaciones: EstacionFila[] }) {
    return (
        <ul className="kp-est" aria-label="Estaciones GOES">
            {estaciones.map((e) => {
                const I = e.clave === 'en_linea' ? Radio : e.clave === 'retraso' ? TriangleAlert : CircleX;
                const tipo = e.clave === 'en_linea' ? 'ok' : e.clave === 'retraso' ? 'warn' : 'crit';
                const viejo = e.clave === 'sin_transmision' || e.clave === 'retraso';
                const d = textoDato(e.ultimoDato);
                // Retraso = tiempo sin dato nuevo (edad del último bueno), NO la duración de la racha de mensajes buenos (daba "2 d").
                const dur = e.clave === 'retraso' ? (e.edadMin ?? e.estadia?.duracionMin ?? null) : (e.estadia?.duracionMin ?? e.edadMin);
                const acot = e.clave !== 'retraso' && e.estadia?.acotada ? '≥ ' : '';
                const estado = e.clave === 'en_linea' ? 'En línea' : e.clave === 'retraso' ? 'Retraso' : e.clave === 'sd' ? 'Sin datos' : 'Sin señal';
                const estadia = e.clave === 'sd' || dur == null ? estado : `${estado} · ${acot}${textoDuracion(dur)}`;
                const sello = e.ultimoDato ? `último ${fechaHoraLocal(e.ultimoDato.t)}` : 'sin dato en 7 d';
                const aria = `${e.nombre}, ${estado.toLowerCase()}${dur != null ? ` desde hace ${acot}${textoDuracion(dur)}` : ''}. ${e.ultimoDato ? `${viejo ? 'Último dato conocido' : 'Dato'} ${d.valor} ${d.unidad}${viejo ? `, de ${fechaHoraLocal(e.ultimoDato.t)}` : ''}` : 'Sin dato'}`;
                return (
                    <li key={e.id} className={`kp-est-i kp-t-${tipo}`} data-vigencia={viejo ? 'viejo' : 'vigente'} aria-label={aria}>
                        <div className="kp-est-cab"><I size={14} aria-hidden="true" /><b>{corto(e.nombre)}</b></div>
                        <div className="kp-est-dato" title={e.ultimoDato ? `${e.ultimoDato.tipo === 'nivel' ? 'Nivel' : 'Gasto'} · ${viejo ? 'último dato conocido, ' : ''}${horaLocal(e.ultimoDato.t)} (${textoEdad(e.ultimoDato.edadMin)})` : undefined}>
                            <strong className="kp-est-num">{d.valor}</strong>{d.unidad && <small>{d.unidad}</small>}
                        </div>
                        <span className="kp-est-estado">{estadia}</span>
                        {viejo && <span className="kp-est-sello">{sello}</span>}
                        <div className="kp-est-spark"><Sparkline valores={e.serieGasto} etiqueta={`Gasto de ${e.nombre}, últimas 24 horas`} unidad="m³/s" decimales={2} alto={22} color="var(--sc-s3)" /></div>
                    </li>
                );
            })}
        </ul>
    );
});
