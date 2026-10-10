import { useMemo } from 'react';
import type { ClaveFamilia } from './ubicacionModelo';
import { simboloClave } from './simbolos';

interface Props { clave: ClaveFamilia; tamano?: number; punteado?: boolean; titulo?: string }

/** Símbolo de una familia de estructuras (la forma la distingue, no el color). */
export function Simbolo({ clave, tamano = 18, punteado = false, titulo }: Props) {
    const html = useMemo(() => simboloClave(clave, { tamano, punteado, titulo, grosor: 2 }), [clave, tamano, punteado, titulo]);
    return <span className="cons-simbolo" style={{ width: tamano, height: tamano }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** El mismo símbolo dentro de un SVG, centrado en (x, y). */
export function SimboloG({ clave, x, y, tamano = 18, punteado = false }: { clave: ClaveFamilia; x: number; y: number; tamano?: number; punteado?: boolean }) {
    const html = useMemo(() => simboloClave(clave, { tamano, punteado, grosor: 2 }), [clave, tamano, punteado]);
    return <g transform={`translate(${x - tamano / 2} ${y - tamano / 2})`} dangerouslySetInnerHTML={{ __html: html }} />;
}
