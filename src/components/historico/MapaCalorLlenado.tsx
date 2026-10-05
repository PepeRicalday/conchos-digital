import { useMemo } from 'react';
import {
    matrizMensual, formatearNumero, etiquetaMetrica, MESES_CORTO, MESES_LARGO,
    type MapaPresa, type Metrica, type TipoSerie,
} from '../../utils/historicoPresas';

/**
 * Matriz año × mes ("almanaque"): cada celda es el cierre del mes. Escala secuencial de un solo tono
 * (azul, claro = más), validada para superficie oscura. Un mes sin dato se rotula con rayado + "S/D";
 * un mes con datos parciales lleva una marca en la esquina. El color nunca es el único portador de
 * significado: cada celda muestra su cifra.
 */

// Rampa secuencial azul (pasos 700 → 100 de la paleta de referencia), de menor a mayor magnitud.
const RAMPA = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];

const hexARgb = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

function colorRampa(t: number): string {
    const x = Math.min(1, Math.max(0, t)) * (RAMPA.length - 1);
    const i = Math.min(RAMPA.length - 2, Math.floor(x));
    const f = x - i;
    const a = hexARgb(RAMPA[i]);
    const b = hexARgb(RAMPA[i + 1]);
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}

interface Props {
    mapa: MapaPresa | undefined;
    anios: number[];
    metrica: Metrica;
    serie: TipoSerie;
    mesSeleccionado: number;
    aniosSeleccionados: number[];
    onSeleccionar: (anio: number, mes: number) => void;
}

export default function MapaCalorLlenado({ mapa, anios, metrica, serie, mesSeleccionado, aniosSeleccionados, onSeleccionar }: Props) {
    const { nombre, unidad, decimales } = etiquetaMetrica(metrica);
    const matriz = useMemo(() => matrizMensual(mapa, anios, metrica, serie), [mapa, anios, metrica, serie]);

    const { min, max } = useMemo(() => {
        const vals: number[] = [];
        for (const fila of matriz.values()) for (const c of fila) if (c.valor != null) vals.push(c.valor);
        return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : { min: 0, max: 1 };
    }, [matriz]);

    const cifra = (v: number) => (metrica === 'elevacion' ? v.toFixed(0) : v.toLocaleString('es-MX', { maximumFractionDigits: 0 }));

    return (
        <div className="ah-mapa" role="group" aria-label={`Matriz anual de ${nombre.toLowerCase()} al cierre de cada mes`}>
            <div className="ah-mapa-scroll">
                <div className="ah-mapa-grid">
                    <span className="ah-mapa-corner" />
                    {MESES_CORTO.map((m, i) => (
                        <span key={m} className={`ah-mapa-mes${i + 1 === mesSeleccionado ? ' is-sel' : ''}`}>{m}</span>
                    ))}
                    {anios.map(a => {
                        const fila = matriz.get(a) ?? [];
                        const rango = aniosSeleccionados.includes(a);
                        return (
                            <div key={a} className="ah-mapa-fila" role="row">
                                <span className={`ah-mapa-anio${rango ? ' is-sel' : ''}`}>{a}</span>
                                {fila.map((c, i) => {
                                    const mes = i + 1;
                                    const sd = c.valor == null;
                                    const t = sd ? 0 : max === min ? 0.5 : (c.valor! - min) / (max - min);
                                    const claro = t > 0.52;
                                    const incompleto = !sd && c.dias < c.diasMes;
                                    const titulo = sd
                                        ? `${MESES_LARGO[i]} ${a}: sin datos (S/D)`
                                        : `${MESES_LARGO[i]} ${a}: ${formatearNumero(c.valor, decimales)} ${unidad} al ${c.fecha!.slice(8)}/${String(mes).padStart(2, '0')} · ${c.dias} de ${c.diasMes} días con dato`;
                                    return (
                                        <button
                                            key={mes}
                                            type="button"
                                            className={`ah-celda${sd ? ' is-sd' : ''}${incompleto ? ' is-parcial' : ''}${mes === mesSeleccionado ? ' is-mes' : ''}${mes === mesSeleccionado && rango ? ' is-foco' : ''}`}
                                            style={sd ? undefined : { background: colorRampa(t), color: claro ? '#04101f' : '#e8eef6' }}
                                            title={titulo}
                                            aria-label={titulo}
                                            onClick={() => onSeleccionar(a, mes)}
                                        >
                                            {sd ? 'S/D' : cifra(c.valor!)}
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="ah-mapa-leyenda">
                <span className="ah-leg-num">{formatearNumero(min, decimales)}</span>
                <span className="ah-leg-barra" style={{ background: `linear-gradient(90deg, ${RAMPA.join(',')})` }} aria-hidden="true" />
                <span className="ah-leg-num">{formatearNumero(max, decimales)} {unidad}</span>
                <span className="ah-leg-item"><i className="ah-leg-sd" aria-hidden="true" /> sin dato</span>
                <span className="ah-leg-item"><i className="ah-leg-parcial" aria-hidden="true" /> mes con datos parciales</span>
            </div>
        </div>
    );
}
