import './logoSica.css';
import { MARCA_SICA, type VarianteMarcaSica } from './marcaSica.generado';

/** Rutas generadas por scripts/logo/generar-logo-sica.mjs (no editar los SVG a mano). */
export const LOGO_SICA_EMBLEMA = MARCA_SICA.emblema.ruta;
export const LOGO_SICA_SIMBOLO = MARCA_SICA.simbolo.ruta;

/** Por debajo de este alto el emblema pierde la escena: se usa el símbolo simplificado. */
const MIN_EMBLEMA_PX = 40;
/** Por debajo de este alto las leyendas de las versiones con texto miden < 7 px: se usa el emblema. */
const MIN_CON_TEXTO_PX = 120;
const CON_TEXTO: ReadonlySet<VarianteMarcaSica> = new Set(['vertical', 'horizontal', 'banda', 'sello', 'escudo']);

interface Props {
    /** Alto en px (en las versiones cuadradas, también el ancho). */
    tamano: number;
    /**
     * 'emblema' (por defecto) = recuadro sin texto. Las versiones con texto pasan solas al emblema por debajo de 120 px
     * de alto, y el emblema pasa al símbolo por debajo de 40 px.
     */
    variante?: VarianteMarcaSica;
    /** Texto alternativo; vacío = decorativo (cuando el nombre ya está escrito al lado). */
    etiqueta?: string;
    className?: string;
}

function resolverVariante(variante: VarianteMarcaSica, tamano: number): VarianteMarcaSica {
    if (CON_TEXTO.has(variante) && tamano < MIN_CON_TEXTO_PX) variante = 'emblema';
    if (variante === 'emblema' && tamano < MIN_EMBLEMA_PX) return 'simbolo';
    return variante;
}

/**
 * LogoSica — única forma de poner la marca SICA 005 en la interfaz.
 * Cada versión trae su propio filo blanco: no envolverla en círculos o fondos blancos, no recortarla con
 * border-radius, no bajarle la opacidad ni deformarla. Dejar al menos un 10 % del alto libre alrededor.
 */
export function LogoSica({ tamano, variante = 'emblema', etiqueta = 'SICA 005, Sistema Integral de Control del Agua', className }: Props) {
    const v = resolverVariante(variante, tamano);
    const { ruta, proporcion } = MARCA_SICA[v];
    return (
        <img
            src={ruta}
            alt={etiqueta}
            aria-hidden={etiqueta ? undefined : true}
            width={Math.round(tamano * proporcion)}
            height={tamano}
            decoding="async"
            draggable={false}
            className={['logo-sica-marca', className].filter(Boolean).join(' ')}
            style={{ aspectRatio: String(proporcion) }}
        />
    );
}
