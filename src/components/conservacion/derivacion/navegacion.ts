import { createContext, useContext } from 'react';

/** Pestañas de Derivación a las que una acción de un estado vacío puede llevar. */
export type DestinoPestana = 'ciclo' | 'revision' | 'comprobacion' | 'programa';

export interface NavegacionDerivacion {
    /** Cambia de pestaña (p. ej. «PacOT del ciclo» para cargar un libro). */
    irA: (destino: DestinoPestana) => void;
    /** Vuelve a leer la carpeta de PacOT; null si no hay servidor local (build publicado). */
    actualizar: (() => void) | null;
}

export const ContextoNavegacion = createContext<NavegacionDerivacion>({ irA: () => undefined, actualizar: null });

export const useNavegacion = (): NavegacionDerivacion => useContext(ContextoNavegacion);
