import { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { fmt } from '../../utils/formato';
import { aFilasV2 } from '../../utils/informeNdviAnalisis';
import type { FilaNdviSerie } from '../../utils/ndviSerie';
import {
    CAUTELA_TITULAR, MESES_CORTOS, MODULOS_GRAFICA, aniosDeMeses, anioDe, mesesPromedioIncompleto, opcionGraficaPrincipal,
    seriesDeGrafica, titularAnio, ultimoIdxMedido,
} from '../../utils/ndviGrafica';
import { SelectorChips } from './SelectorChips';
import { LeyendaNdvi } from './LeyendaNdvi';
import './NdviGrafica.css';

interface Props {
    filas: FilaNdviSerie[];
    meses: string[];
    /** Mes que ya eligió el usuario en las tarjetas: fija el año con el que abre la gráfica. */
    mesReferencia: string;
}

type Vista = 'anio' | 'comparar';

export default function NdviGraficaPrincipal({ filas, meses, mesReferencia }: Props) {
    const anios = useMemo(() => aniosDeMeses(meses), [meses]);
    const ultimoMes = meses[meses.length - 1] ?? '';
    const [vista, setVista] = useState<Vista>('anio');
    const [anioElegido, setAnioElegido] = useState<number | null>(null);
    const [modulo, setModulo] = useState<number>(0);
    const anio = anioElegido != null && anios.includes(anioElegido) ? anioElegido : (mesReferencia ? anioDe(mesReferencia) : anios[anios.length - 1]);

    const caja = useRef<HTMLDivElement>(null);
    const [ancho, setAncho] = useState(1000);
    const [reducir, setReducir] = useState(false);
    useEffect(() => {
        setReducir(!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
        const el = caja.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Mismo clamp que .ndvi-gr-echarts en NdviGrafica.css (320px, 50vw, 460px): el alto sirve para separar las etiquetas finales.
    const altoPx = Math.min(460, Math.max(320, Math.round(window.innerWidth * 0.5)));
    const params = useMemo(() => ({ vista, anio, modulo, filas, aniosDisponibles: anios, ultimoMesSerie: ultimoMes, angosto: ancho < 560, reducirMovimiento: reducir, altoPx }),
        [vista, anio, modulo, filas, anios, ultimoMes, ancho, reducir, altoPx]);
    const opcion = useMemo(() => opcionGraficaPrincipal(params), [params]);
    const tabla = useMemo(() => seriesDeGrafica(params), [params]);
    const hasta = ultimoIdxMedido(anio, ultimoMes);

    const v2 = useMemo(() => aFilasV2(filas), [filas]);
    const titular = useMemo(() => (vista === 'anio' ? titularAnio(v2, MODULOS_GRAFICA, anio) : null), [v2, vista, anio]);
    const incompletos = useMemo(() => (vista === 'anio' ? mesesPromedioIncompleto(filas, anio, hasta) : []), [filas, vista, anio, hasta]);

    return (
        <section className="ndvi-chart-card glass ndvi-gr" aria-label="Evolución mensual del NDVI">
            <div className="ndvi-gr-cab">
                <h3 className="ndvi-gr-titulo">Evolución mensual del NDVI</h3>
                <p className="ndvi-nota">
                    {vista === 'anio'
                        ? `Los seis módulos en ${anio}, de enero a diciembre. Un mes sin lectura queda como hueco: no se une ni se cuenta como cero.`
                        : `${modulo === 0 ? 'El promedio SRL' : `El Módulo ${modulo}`} en cada año, uno sobre otro. ${anio} va destacado.`}
                </p>
            </div>
            <div className="ndvi-gr-controles">
                <SelectorChips etiqueta="Vista" valor={vista} onChange={setVista}
                    opciones={[{ valor: 'anio', texto: 'Un año' }, { valor: 'comparar', texto: 'Comparar años' }]} />
                <SelectorChips etiqueta="Año" valor={String(anio)} onChange={(v) => setAnioElegido(Number(v))}
                    opciones={anios.map((a) => ({ valor: String(a), texto: String(a) }))} />
                {vista === 'comparar' && (
                    <SelectorChips etiqueta="Qué seguir" valor={String(modulo)} onChange={(v) => setModulo(Number(v))}
                        opciones={[{ valor: '0', texto: 'Promedio SRL', title: 'Promedio simple de los módulos con dato' }, ...MODULOS_GRAFICA.map((m) => ({ valor: String(m), texto: `M${m}`, aria: `Módulo ${m}` }))]} />
                )}
            </div>

            {titular && (
                <p className="ndvi-gr-titular" aria-live="polite">
                    <strong>{titular.texto}.</strong> <span>{CAUTELA_TITULAR}</span>
                </p>
            )}

            <div className="ndvi-gr-lienzo" ref={caja}>
                <ReactECharts option={opcion} notMerge className="ndvi-gr-echarts" style={{ width: '100%' }} />
            </div>

            <LeyendaNdvi nota="Las franjas de color de fondo son las clases de vigor; la línea punteada ámbar marca el NDVI 0.30, desde donde se cuenta cobertura activa. La franja gris clara es la temporada marzo–septiembre. NDVI de la frontera del módulo (incluye caminos y suelo sin riego): sirve para comparar un año con otro, no como NDVI de parcela." />
            {incompletos.length > 0 && (
                <p className="ndvi-nota ndvi-gr-aviso">
                    Promedio SRL con módulos sin lectura: {incompletos.map((x) => `${x.mes} (${x.n} de ${x.total})`).join(', ')}.
                </p>
            )}
            {vista === 'anio' && hasta >= 0 && hasta < 11 && (
                <p className="ndvi-nota">Los meses después de {MESES_CORTOS[hasta].toLowerCase()} de {anio} todavía no se miden: no son S/D, solo no han ocurrido.</p>
            )}

            <details className="ndvi-gr-tabla">
                <summary>Ver los valores como tabla</summary>
                <div className="ndvi-gr-tabla-wrap" tabIndex={0} role="region" aria-label="Valores de NDVI por mes">
                    <table>
                        <caption>NDVI por mes — {vista === 'anio' ? anio : `${modulo === 0 ? 'promedio SRL' : `Módulo ${modulo}`}, por año`}</caption>
                        <thead><tr><th scope="col">Mes</th>{tabla.map((s) => <th scope="col" key={s.nombre}>{s.nombre}</th>)}</tr></thead>
                        <tbody>
                            {MESES_CORTOS.map((mes, i) => (
                                <tr key={mes}>
                                    <th scope="row">{mes}</th>
                                    {tabla.map((s) => {
                                        const v = s.valores[i];
                                        const futuro = vista === 'anio' && i > hasta;
                                        return <td key={s.nombre}>{v != null ? fmt(v, 3) : futuro ? <span className="ndvi-gr-sd">sin medir</span> : <span className="ndvi-gr-sd">S/D</span>}</td>;
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </section>
    );
}
