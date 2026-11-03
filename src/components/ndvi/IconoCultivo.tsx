import React from 'react';
import { infoCultivo, tintaSobre } from '../../utils/cultivos';

/** Variables CSS de identidad del cultivo: --cu (color en oscuro), --cu-l (claro) y la tinta legible encima de cada uno. Todo lo demás se pinta con var(--c). */
export function estiloCultivo(nombre: string | null | undefined): React.CSSProperties {
    const i = infoCultivo(nombre);
    return { '--cu': i.color, '--cu-l': i.colorClaro, '--cu-t': tintaSobre(i.color), '--cu-lt': tintaSobre(i.colorClaro) } as React.CSSProperties;
}

/** Ícono del cultivo: SVG propio, trazo uniforme, color heredado (currentColor). Decorativo: el nombre siempre va escrito al lado. */
export const IconoCultivo: React.FC<{ nombre: string; size?: number; className?: string }> = ({ nombre, size = 18, className }) => (
    <svg className={`vc-ico${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: infoCultivo(nombre).icono }} />
);

/**
 * Cultivo con su identidad: ficha de color con el ícono y el nombre escrito (el color nunca va solo).
 * `compacto` = solo el ícono en el color del cultivo (tablas y renglones apretados).
 */
export const NombreCultivo: React.FC<{ nombre: string; compacto?: boolean; size?: number; texto?: string }> = ({ nombre, compacto, size, texto }) => (
    <span className={`vc-cu vc-ncu${compacto ? ' compacto' : ''}`} style={estiloCultivo(nombre)}>
        <span className="vc-ncu-ico"><IconoCultivo nombre={nombre} size={size ?? (compacto ? 16 : 18)} /></span>
        <span className="vc-ncu-txt">{texto ?? infoCultivo(nombre).nombre}</span>
    </span>
);
