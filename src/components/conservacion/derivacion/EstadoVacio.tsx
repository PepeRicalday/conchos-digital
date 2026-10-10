import type { ReactNode } from 'react';
import { CircleDashed, OctagonAlert } from 'lucide-react';
import './estado-vacio.css';
import { useNavegacion } from './navegacion';

interface Props {
    /** Qué pasa, en una frase. */
    titulo: string;
    /** Por qué y qué hacer, en plano. */
    children?: ReactNode;
    /** Una sola acción que lleva a la solución. */
    accion?: { texto: string; onClick: () => void } | null;
    /** 'error' = algo falló (role=alert); por defecto, un vacío (role=status). */
    tipo?: 'vacio' | 'error';
}

/** Vacío o error como dirección: dice qué falta y ofrece la acción que lo resuelve (nunca solo «no hay datos»). */
export function EstadoVacio({ titulo, children, accion = null, tipo = 'vacio' }: Props) {
    const Icono = tipo === 'error' ? OctagonAlert : CircleDashed;
    return (
        <div className={`cons-vacio-accion${tipo === 'error' ? ' cons-vacio-accion-error' : ''}`} role={tipo === 'error' ? 'alert' : 'status'}>
            <Icono size={20} aria-hidden="true" />
            <div className="cons-vacio-accion-t">
                <p className="cons-vacio-accion-tit">{titulo}</p>
                {children !== undefined && <p className="cons-vacio-accion-txt">{children}</p>}
            </div>
            {accion && <button type="button" className="sc-btn cons-vacio-accion-btn" onClick={accion.onClick}>{accion.texto}</button>}
        </div>
    );
}

/** Sin ningún PacOT cargado: lleva a «PacOT del ciclo», donde se cargan. */
export function SinPacot() {
    const { irA, actualizar } = useNavegacion();
    return (
        <section className="sc-card">
            <EstadoVacio titulo="Todavía no hay PacOT cargado" accion={{ texto: 'Cargar el PacOT', onClick: actualizar ?? (() => irA('ciclo')) }}>
                Esta sección trabaja sobre el PacOT de la SRL y los de sus módulos. {actualizar ? 'Lea la carpeta de PacOT' : 'Abra el archivo de derivación'} y vuelva aquí.
            </EstadoVacio>
        </section>
    );
}
