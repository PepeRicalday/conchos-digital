import { memo } from 'react';
import { Radio, TriangleAlert, CircleX } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { textoEdad } from '../../utils/hidroEstaciones';

export interface EstacionFila { id: string; nombre: string; clave: 'en_linea' | 'retraso' | 'sin_transmision' | 'sd'; edadMin: number | null; serieGasto: (number | null)[] }

const corto = (n: string) => { const base = n.split(' - ')[0]; return base.length > 14 ? base.split(' ').slice(0, 2).join(' ') : base; };

/** Una columna por estación: antena (forma distinta por estado), nombre, edad propia y gasto de 24 h. */
export const FilaEstaciones = memo(function FilaEstaciones({ estaciones }: { estaciones: EstacionFila[] }) {
    return (
        <ul className="kp-est" aria-label="Estaciones GOES">
            {estaciones.map((e) => {
                const I = e.clave === 'en_linea' ? Radio : e.clave === 'retraso' ? TriangleAlert : CircleX;
                const tipo = e.clave === 'en_linea' ? 'ok' : e.clave === 'retraso' ? 'warn' : 'crit';
                const texto = e.clave === 'en_linea' ? 'En línea' : e.clave === 'retraso' ? 'Retraso' : e.edadMin == null ? 'Sin datos' : textoEdad(e.edadMin);
                return (
                    <li key={e.id} className={`kp-est-i kp-t-${tipo}`}>
                        <I size={16} aria-hidden="true" />
                        <b>{corto(e.nombre)}</b>
                        <span>{texto}</span>
                        <div className="kp-est-spark"><Sparkline valores={e.serieGasto} etiqueta={`Gasto de ${e.nombre}, últimas 24 horas`} unidad="m³/s" decimales={2} alto={22} color="var(--sc-s3)" /></div>
                    </li>
                );
            })}
        </ul>
    );
});
