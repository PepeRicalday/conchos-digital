import type { ComponentType, SVGProps } from 'react';
import { GLIFOS_SICA, type ClaveIconoSica } from './marcaSica.generado';

interface PropsIcono extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
    size?: number;
    strokeWidth?: number;
}

/**
 * Íconos de sección de la marca SICA 005 (escala hidrométrica, telemetría, compuertas, monitoreo, distribución y uso
 * agrícola). Misma firma y estilo que lucide-react (retícula 24, trazo 2, currentColor), para usarlos donde hoy va un
 * ícono lucide. Los trazos salen de scripts/logo/generar-logo-sica.mjs.
 */
function crearIcono(clave: ClaveIconoSica, nombre: string): ComponentType<PropsIcono> {
    const Icono = ({ size = 24, strokeWidth = 2, ...resto }: PropsIcono) => (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...resto}
        >
            {GLIFOS_SICA[clave].map((d) => <path key={d} d={d} />)}
        </svg>
    );
    Icono.displayName = nombre;
    return Icono;
}

export const IconoMedicion = crearIcono('medicion', 'IconoMedicion');
export const IconoTelemetria = crearIcono('telemetria', 'IconoTelemetria');
export const IconoCompuertas = crearIcono('compuertas', 'IconoCompuertas');
export const IconoMonitoreo = crearIcono('monitoreo', 'IconoMonitoreo');
export const IconoDistribucion = crearIcono('distribucion', 'IconoDistribucion');
export const IconoUsoAgricola = crearIcono('uso-agricola', 'IconoUsoAgricola');
