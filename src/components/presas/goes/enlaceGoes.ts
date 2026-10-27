import { ultimoBueno, type EstacionHidro, type MensajeHidro } from '../../../utils/hidroEstaciones';

export const GLIFO_ENLACE = { en_linea: '●', retraso: '▲', sin_transmision: '■', sd: '◇' } as const;

/** Instante del último dato bueno de la estación: mensaje bueno y, si no hay mensajes, `ult_dato_en`. Fuente única de «en línea / sin transmisión» (ficha, enlace y meteorología). */
export function instanteEnlace(estacion: EstacionHidro, mensajes: MensajeHidro[]): number | null {
    return ultimoBueno(mensajes, estacion.id) ?? (estacion.ult_dato_en ? Date.parse(estacion.ult_dato_en) : null);
}
