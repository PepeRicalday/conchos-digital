/** Estado visual único de la interfaz: un tono por significado (ver src/styles/tokens.css).
 *  Sustituye a TipoEstado (utils/dashboardKpisEjecutivos) y EstadoVisual (utils/eficienciaCanal), que quedan como alias. */
export type EstadoTipo = 'ok' | 'warn' | 'crit' | 'info' | 'sd';

export const ESTADO_ETIQUETA: Record<EstadoTipo, string> = {
    ok: 'Correcto', warn: 'Atención', crit: 'Crítico', info: 'Informativo', sd: 'Sin dato',
};
