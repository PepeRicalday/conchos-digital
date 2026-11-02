/**
 * marcaInforme — tokens de marca compartidos por los informes (sin dependencias, para evitar ciclos entre
 * informeBase y membreteDual). Fuente de los colores: scripts/logo/generar-logo-sica.mjs (const C).
 */
import { escSvg } from './informeHistoricoSvg';

/** Colores de marca SICA 005 en los informes. El marrón de SRL queda solo en su logo. */
export const MARCA = { navy: '#0B3170', agua: '#0A7FDB', aguaClaro: '#3FB2F3', hoja: '#2E9A1E', rojo: '#E0242A', cielo: '#CBEAF9' } as const;
/** Pila tipográfica de títulos y cifras héroe; el cuerpo y las tablas usan Segoe UI. */
export const FUENTE_MARCA = '"Montserrat","Segoe UI",Arial,sans-serif';
/** El escudo de SRL está rotulado en serif: su nombre en texto usa la misma familia para que lockup y logo se lean como uno. */
export const FUENTE_SRL = '"Georgia","Times New Roman",serif';

/** Escape de texto dinámico para HTML/atributos. */
export const esc = escSvg;
