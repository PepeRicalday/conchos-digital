import { useMemo } from 'react';
import { SelectorChips } from './SelectorChips';
import { MESES_CORTOS, MESES_LARGOS, anioDe } from '../../utils/ndviGrafica';

interface Props {
    /** Texto del grupo ("Mes de las tarjetas"); año y mes se anuncian como "<etiqueta>: año" y "<etiqueta>: mes". */
    etiqueta: string;
    /** 'AAAA-MM' elegido. */
    valor: string;
    /** Meses 'AAAA-MM' disponibles (solo esos se ofrecen). */
    meses: string[];
    onChange: (mes: string) => void;
}

/** Selector de mes en dos pasos (año y mes del año) en lugar de 66 chips seguidos. Al cambiar de año conserva el mismo mes si existe,
 *  y si no, el disponible más cercano de ese año. */
export function SelectorMes({ etiqueta, valor, meses, onChange }: Props) {
    const anios = useMemo(() => [...new Set(meses.map(anioDe))].sort((a, b) => a - b), [meses]);
    const anio = valor ? anioDe(valor) : anios[anios.length - 1];
    const delAnio = useMemo(() => meses.filter((m) => anioDe(m) === anio), [meses, anio]);

    const cambiarAnio = (a: number) => {
        const candidatos = meses.filter((m) => anioDe(m) === a);
        if (!candidatos.length) return;
        const mm = valor.slice(5, 7);
        const mismo = candidatos.find((m) => m.slice(5, 7) === mm);
        const cercano = [...candidatos].sort((x, y) => Math.abs(Number(x.slice(5, 7)) - Number(mm)) - Math.abs(Number(y.slice(5, 7)) - Number(mm)))[0];
        onChange(mismo ?? cercano);
    };

    return (
        <div className="ndvi-selector-mes">
            <SelectorChips etiqueta={`${etiqueta}: año`} valor={String(anio)} onChange={(v) => cambiarAnio(Number(v))}
                opciones={anios.map((a) => ({ valor: String(a), texto: String(a) }))} />
            <SelectorChips etiqueta={`${etiqueta}: mes`} valor={valor} onChange={onChange}
                opciones={delAnio.map((m) => {
                    const i = Number(m.slice(5, 7)) - 1;
                    return { valor: m, texto: MESES_CORTOS[i], aria: `${MESES_LARGOS[i]} ${anio}` };
                })} />
        </div>
    );
}
