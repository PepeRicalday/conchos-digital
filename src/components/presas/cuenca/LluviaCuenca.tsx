import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import {
    COLOR_LLUVIA, LLUVIA_FUERTE_MM, type FilaGrafica, type FilaLluvia, type ResumenLluvia, type TotalLluvia,
} from '../../../utils/aqwpCuenca';

const fmtMm = (v: number | null) => (v == null ? 'S/D' : formatearNumero(v, v !== 0 && v < 10 ? 1 : 0));
/** "7-nov" para el encabezado de columna. */
const diaMes = (iso: string) => fechaCorta(iso).split('-').slice(0, 2).join('-');

function Total({ t }: { t: TotalLluvia }) {
    return (
        <td className="cu-num">
            {t.mm == null ? 'S/D' : `${formatearNumero(t.mm, 1)} mm`}
            {t.mm != null && t.conDato < t.ventana && <span className="cu-nota-fila">{t.conDato} de {t.ventana} días con dato</span>}
        </td>
    );
}

function Fila({ f, fechas }: { f: FilaLluvia; fechas: string[] }) {
    return (
        <tr>
            <th scope="row" className="cu-presa"><span className="cu-nombre" style={{ borderLeft: `4px solid ${COLOR_LLUVIA[f.ubicacionId]}`, paddingLeft: 8 }}>{f.nombre}</span></th>
            {f.dias.map((v, i) => (
                <td key={fechas[i]} className={`cu-num${v != null && v >= LLUVIA_FUERTE_MM ? ' cu-lluvia-fuerte' : ''}`}>{fmtMm(v)}</td>
            ))}
            <Total t={f.total7} />
            <Total t={f.total30} />
        </tr>
    );
}

function Tip({ active, payload, filas }: { active?: boolean; payload?: { payload: FilaGrafica }[]; filas: FilaLluvia[] }) {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
        <div className="an-tip">
            <b>{fechaCorta(p.fecha)}</b>
            {filas.map(f => {
                const v = p[String(f.ubicacionId)];
                return <span key={f.ubicacionId} style={{ color: COLOR_LLUVIA[f.ubicacionId] }}>{f.nombre}: <b>{typeof v === 'number' ? `${formatearNumero(v, 1)} mm` : 'S/D'}</b></span>;
            })}
        </div>
    );
}

/**
 * Lluvia diaria (mm) de los pluviómetros GOES de CONAGUA en la cuenca. Es el acumulado del pluviómetro convertido a mm
 * por día por SICA. 0 mm = día seco medido; S/D = día sin cobertura suficiente. No sustituye las estaciones propias.
 */
export default function LluviaCuenca({ lluvia }: { lluvia: ResumenLluvia }) {
    if (lluvia.filas.length === 0 || lluvia.hasta == null) {
        return (
            <section className="an-card" aria-label="Lluvia en la cuenca">
                <h4 className="an-h">Lluvia en la cuenca · pluviómetros GOES</h4>
                <div className="an-vacio" role="status"><strong>Sin lluvia reciente (S/D)</strong><span>Todavía no hay lluvia diaria cargada de los pluviómetros GOES del portal.</span></div>
            </section>
        );
    }
    const alguna = lluvia.serie30.some(f => lluvia.filas.some(p => typeof f[String(p.ubicacionId)] === 'number' && (f[String(p.ubicacionId)] as number) > 0));
    return (
        <section className="an-card" aria-label="Lluvia en la cuenca">
            <h4 className="an-h">Lluvia en la cuenca · pluviómetros GOES</h4>
            <p className="an-nota">Milímetros por día hasta el {fechaCorta(lluvia.hasta)}. Los días de {LLUVIA_FUERTE_MM} mm o más van resaltados. «0» es un día seco medido; «S/D», un día sin datos suficientes.</p>

            <div className="cu-tabla-wrap">
                <table className="cu-tabla">
                    <thead>
                        <tr>
                            <th scope="col">Pluviómetro</th>
                            {lluvia.fechas.map(f => <th key={f} scope="col" className="cu-num">{diaMes(f)}</th>)}
                            <th scope="col" className="cu-num">7 días</th>
                            <th scope="col" className="cu-num">30 días</th>
                        </tr>
                    </thead>
                    <tbody>{lluvia.filas.map(f => <Fila key={f.ubicacionId} f={f} fechas={lluvia.fechas} />)}</tbody>
                </table>
            </div>

            <h5 className="an-h cu-subh">Últimos 30 días</h5>
            {alguna ? (
                <div className="an-chart cu-chart-lluvia" role="img" aria-label="Lluvia diaria de los pluviómetros de la cuenca en los últimos 30 días">
                    <ResponsiveContainer initialDimension={{ width: 1, height: 1 }} width="100%" height="100%">
                        <BarChart data={lluvia.serie30} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--pr-line)" />
                            <XAxis dataKey="fecha" interval={6} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--pr-t3)' }}
                                tickFormatter={(f: string) => diaMes(f)} />
                            <YAxis axisLine={false} tickLine={false} width={56} tick={{ fontSize: 12, fill: 'var(--pr-t3)' }}
                                tickFormatter={v => `${v} mm`} />
                            <Tooltip content={<Tip filas={lluvia.filas} />} isAnimationActive={false} cursor={{ fill: 'var(--pr-surface-2)' }} />
                            {lluvia.filas.map(f => <Bar key={f.ubicacionId} dataKey={String(f.ubicacionId)} fill={COLOR_LLUVIA[f.ubicacionId]} isAnimationActive={false} />)}
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            ) : <p className="an-aviso">Sin lluvia registrada en los últimos 30 días.</p>}
            <ul className="an-leyenda" aria-label="Pluviómetros">
                {lluvia.filas.map(f => (
                    <li key={f.ubicacionId}><svg width="14" height="14" aria-hidden="true"><rect width="14" height="14" rx="2" fill={COLOR_LLUVIA[f.ubicacionId]} /></svg> {f.nombre}</li>
                ))}
            </ul>
        </section>
    );
}
