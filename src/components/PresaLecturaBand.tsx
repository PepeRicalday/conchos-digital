import { usePresasCila } from '../hooks/usePresasCila';
import { elevacionEstimada, procedenciaNivel, calcularFrescura, type ProcedenciaNivel } from '../utils/presaMetrics';
import { estadoReporteCila, type EstadoCila } from '../../supabase/functions/presas-cila-sync/vigencia';
import type { PresaData } from '../hooks/usePresas';

/**
 * Banda de lectura de una presa: las cifras que importan en numerales grandes, con la
 * procedencia de cada una (CAMPO / CILA / ≈ ESTIMADA) y el sello de vigencia del reporte oficial.
 * Regla "S/D nunca cero": un dato ausente se rotula S/D; el 0 queda reservado a la medición de cero.
 */

const VIGENCIA_UI: Record<EstadoCila, { texto: string; tono: string }> = {
    ACTUALIZADO: { texto: 'Reporte CILA de hoy', tono: 'ok' },
    ESPERANDO: { texto: 'Esperando reporte (9–11 h)', tono: 'info' },
    RETRASADO: { texto: 'Reporte retrasado', tono: 'warn' },
    SIN_ACTUALIZACION: { texto: 'Sin actualización CILA', tono: 'crit' },
    SIN_DATO: { texto: 'Sin reporte CILA', tono: 'mute' },
};

const CHIP_UI: Record<ProcedenciaNivel, { texto: string; clase: string }> = {
    CAMPO: { texto: 'CAMPO', clase: 'is-campo' },
    CILA: { texto: 'CILA · CALCULADA', clase: 'is-cila' },
    ESTIMADA: { texto: '≈ ESTIMADA ±0.5 m', clase: 'is-est' },
};

const nf = (v: number, d = 2) => v.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

interface Props {
    presa: PresaData;
    /** Variación del nivel en m/día (null = sin referencia previa). */
    tendenciaMDia: number | null;
    estadoSistema: string;
    colorSistema: string;
}

export default function PresaLecturaBand({ presa, tendenciaMDia, estadoSistema, colorSistema }: Props) {
    const { lectura: cila } = usePresasCila(presa.id);
    const lect = presa.lectura;

    const alm = lect?.almacenamiento_mm3 ?? null;
    const pct = lect?.porcentaje_llenado ?? null;
    const elev = lect?.escala_msnm ?? null;
    const notas = lect?.notas ?? null;
    const estimada = elevacionEstimada(notas);
    const volumenDeCila = !!notas?.includes('Nivel: CILA-IBWC');
    const procElev = procedenciaNivel(notas, elev != null);
    const sinNivel = alm == null && pct == null;

    const vig = estadoReporteCila(cila?.fecha ?? null).estado;
    const vigUi = VIGENCIA_UI[vig];
    const frescura = calcularFrescura(cila?.fecha ?? null, 36);

    const extConocida = lect?.extraccion_conocida ?? false;
    const dif = cila?.almacenamiento_mm3 != null && alm != null && !volumenDeCila ? cila.almacenamiento_mm3 - alm : null;
    const tendDir = tendenciaMDia == null ? null : tendenciaMDia > 0.005 ? '▲' : tendenciaMDia < -0.005 ? '▼' : '■';
    const tendTono = tendenciaMDia == null ? 'mute' : tendenciaMDia > 0.005 ? 'sky' : tendenciaMDia < -0.005 ? 'warn' : 'mute';

    // Mismos umbrales que el estado del sistema en Presas.tsx (CRÍTICO <12 / ≥92, PRECAUCIÓN <22 / ≥80).
    const p = pct ?? 0;
    const tono = sinNivel ? 'mute' : (p >= 92 || p < 12) ? 'crit' : (p >= 80 || p < 22) ? 'warn' : 'ok';
    const marcas = [22, 80];

    return (
        <section className="pr-banda pr-reveal" style={{ ['--i' as string]: 0 }} aria-label={`Lectura de ${presa.nombre_corto}`}>
            <header className="pr-banda-head">
                <div>
                    <span className="pr-eyebrow">{presa.rio || 'Río Conchos'} · {presa.municipio || 'Chihuahua'}</span>
                    <h2 className="pr-nombre">{presa.nombre}</h2>
                </div>
                <div className="pr-banda-sellos">
                    <span className={`pr-sello pr-sello--${vigUi.tono}`} title={frescura?.texto ?? undefined}>
                        <i aria-hidden="true" />{vigUi.texto}
                    </span>
                    <span className="pr-sello pr-sello--estado" style={{ ['--c' as string]: colorSistema }}>{estadoSistema}</span>
                </div>
            </header>

            <div className="pr-tiles">
                <article className="pr-tile pr-reveal" style={{ ['--i' as string]: 1 }}>
                    <span className="pr-k">Almacenamiento</span>
                    <span className="pr-num">{alm == null ? 'S/D' : nf(alm, 2)}<small>Mm³</small></span>
                    <span className="pr-sub">de {nf(presa.capacidad_max_mm3, 1)} Mm³ al NAMO</span>
                    {alm != null && <span className={`pr-chip ${volumenDeCila ? 'is-cila' : 'is-campo'}`}>{volumenDeCila ? 'CILA' : 'CAMPO'}</span>}
                </article>

                <article className="pr-tile pr-reveal" style={{ ['--i' as string]: 2 }}>
                    <span className="pr-k">Llenado</span>
                    <span className={`pr-num pr-num--${tono}`}>{pct == null ? 'S/D' : nf(pct, 1)}<small>%</small></span>
                    <div className="pr-bar" role="img" aria-label={pct == null ? 'Sin dato de llenado' : `Llenado ${nf(pct, 1)} por ciento`}>
                        <div className={`pr-bar-fill pr-bar-fill--${tono}`} style={{ width: `${Math.min(pct ?? 0, 100)}%` }} />
                        {marcas.map(m => <b key={m} className="pr-bar-mark" style={{ left: `${m}%` }} />)}
                    </div>
                    <span className="pr-sub">
                        {cila?.pct_conservacion != null
                            ? `CILA ${nf(cila.pct_conservacion, 1)} % s/ conservación ${nf(cila.cap_conservacion_mm3 ?? 0, 1)} Mm³`
                            : 'base NAMO SICA'}
                    </span>
                </article>

                <article className="pr-tile pr-reveal" style={{ ['--i' as string]: 3 }}>
                    <span className="pr-k">Elevación</span>
                    <span className="pr-num">
                        {elev == null ? 'S/D' : `${estimada ? '≈' : ''}${estimada ? elev.toFixed(1) : nf(elev, 2)}`}<small>msnm</small>
                    </span>
                    <span className="pr-sub">
                        {tendDir && tendenciaMDia != null
                            ? <span className={`pr-tend pr-tend--${tendTono}`}>{tendDir} {tendenciaMDia >= 0 ? '+' : ''}{nf(tendenciaMDia, 3)} m/día</span>
                            : 'sin referencia previa'}
                    </span>
                    {procElev && <span className={`pr-chip ${CHIP_UI[procElev].clase}`}>{CHIP_UI[procElev].texto}</span>}
                </article>

                <article className="pr-tile pr-reveal" style={{ ['--i' as string]: 4 }}>
                    <span className="pr-k">Extracción</span>
                    <span className={`pr-num ${extConocida && (lect?.extraccion_total_m3s ?? 0) > 0 ? 'pr-num--sky' : ''}`}>
                        {extConocida && lect ? nf(lect.extraccion_total_m3s, 2) : 'S/D'}<small>m³/s</small>
                    </span>
                    <span className="pr-sub">SICA · movimientos y protocolo</span>
                </article>
            </div>

            <div className="pr-fuentes">
                <div className="pr-fuente">
                    <span className="pr-k">Campo (SICA)</span>
                    <span className="pr-fv">
                        {!volumenDeCila && alm != null ? `${nf(alm, 3)} Mm³` : 'sin medición de campo reciente'}
                    </span>
                    {!volumenDeCila && lect?.fecha && <span className="pr-sub">{lect.fecha}</span>}
                </div>
                <div className="pr-fuente">
                    <span className="pr-k">CILA / USIBWC</span>
                    <span className="pr-fv">{cila?.almacenamiento_mm3 != null ? `${nf(cila.almacenamiento_mm3, 3)} Mm³` : 'S/D'}</span>
                    {cila && <span className="pr-sub">reporte del {cila.fecha}</span>}
                </div>
                <div className="pr-fuente">
                    <span className="pr-k">Δ CILA − campo</span>
                    <span className="pr-fv">{dif == null ? 'S/D' : `${dif > 0 ? '+' : ''}${nf(dif, 3)} Mm³`}</span>
                    <span className="pr-sub">dato provisional sujeto a revisión</span>
                </div>
            </div>
        </section>
    );
}
