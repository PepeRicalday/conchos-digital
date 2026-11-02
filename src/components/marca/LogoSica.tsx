import './logoSica.css';

/** Rutas del sello vectorial (generado por scripts/logo/generar-logo-sica.mjs; no editar a mano). */
export const LOGO_SICA_SELLO = '/logos/sica/sica005-sello.svg';
export const LOGO_SICA_SIMBOLO = '/logos/sica/sica005-simbolo.svg';

/** Por debajo de este diámetro el texto del anillo no se lee: se usa el símbolo (río + hoja). */
const MIN_SELLO_PX = 40;

interface Props {
    /** Diámetro en px. */
    tamano: number;
    /** 'sello' (por defecto) cambia solo a 'simbolo' si el tamaño es menor de 40 px. */
    variante?: 'sello' | 'simbolo';
    /** Texto alternativo; vacío = decorativo (cuando el nombre ya está escrito al lado). */
    etiqueta?: string;
    className?: string;
}

/**
 * LogoSica — única forma de poner el sello SICA-005 en la interfaz.
 * El sello ya trae su disco blanco y su contorno: no envolverlo en círculos blancos, no recortarlo con
 * border-radius, no bajarle la opacidad ni deformarlo. Dejar al menos un 10 % del diámetro libre alrededor.
 */
export function LogoSica({ tamano, variante = 'sello', etiqueta = 'SICA-005, Distrito de Riego 005', className }: Props) {
    const simbolo = variante === 'simbolo' || tamano < MIN_SELLO_PX;
    return (
        <img
            src={simbolo ? LOGO_SICA_SIMBOLO : LOGO_SICA_SELLO}
            alt={etiqueta}
            aria-hidden={etiqueta ? undefined : true}
            width={tamano}
            height={tamano}
            decoding="async"
            draggable={false}
            className={['logo-sica-marca', className].filter(Boolean).join(' ')}
        />
    );
}
