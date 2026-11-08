import { useMemo } from 'react';
import { useAqwpCuenca } from '../../../hooks/useAqwpCuenca';
import { formatearNumero } from '../../../utils/historicoPresas';
import { calcularFrescura } from '../../../utils/presaMetrics';
import {
    agregadoCuenca, aportacionTotal, filasPresas, UBICACION_OJINAGA, type FilaPresaCuenca,
} from '../../../utils/aqwpCuenca';
import { fechaCorta } from '../../../utils/analiticaPresas';
import GraficaLlenadoCuenca from './GraficaLlenadoCuenca';
import LluviaCuenca from './LluviaCuenca';
import './cuenca.css';

const GLIFO: Record<string, string> = { ok: '●', warn: '▲', crit: '■', sd: '◇' };

const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const fmtFlujo = (v: number | null) => (v == null ? 'S/D' : formatearNumero(v, v !== 0 && Math.abs(v) < 1 ? 3 : 2));

function fechaHoraLocal(iso: string | null): string {
    if (!iso) return 'nunca';
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
        ? d.toLocaleString('es-MX', { timeZone: 'America/Chihuahua', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'S/D';
}

function FilaTabla({ f, difCila }: { f: FilaPresaCuenca; difCila: number | null | undefined }) {
    return (
        <tr>
            <th scope="row" className="cu-presa">
                <span className="cu-nombre">{f.nombre}</span>
                {f.delDistrito && <span className="cu-tag">Distrito</span>}
                {f.estancado && f.almacenamientoMm3 != null && (
                    <span className="cu-nota-fila">Serie estancada: repite {formatearNumero(f.almacenamientoMm3, 3)} Mm³; se trata como S/D.</span>
                )}
                {f.delDistrito && difCila != null && (
                    <span className="cu-nota-fila">Diferencia contra CILA: {difCila > 0 ? '+' : difCila < 0 ? '−' : ''}{formatearNumero(Math.abs(difCila), 2)} %</span>
                )}
            </th>
            <td className="cu-num">{fmt(f.almacenamientoValido, 1)}</td>
            <td className="cu-num">{f.pct == null ? 'S/D' : `${formatearNumero(f.pct, 1)} %`}</td>
            <td>
                <span className={`cu-estado cu-estado--${f.estancado ? 'stale' : f.estado.clave}`}>
                    <span aria-hidden="true">{f.estancado ? '◆' : GLIFO[f.estado.clave]}</span> {f.estancado ? 'ESTANCADA' : f.estado.etiqueta}
                </span>
            </td>
            <td className="cu-num">{fmtFlujo(f.aportacionM3s)}</td>
            <td className="cu-num">{fmtFlujo(f.extraccionTotalM3s)}</td>
            <td className="cu-num">{fmtFlujo(f.vertidoM3s)}</td>
            <td className={`cu-fecha${f.frescura?.stale ? ' cu-fecha--vieja' : ''}`}>
                {f.fecha ? fechaCorta(f.fecha) : 'S/D'}
                {f.frescura?.stale && <span className="cu-nota-fila">Atrasada</span>}
            </td>
        </tr>
    );
}

/**
 * Vista "Cuenca del Conchos" (Presas → Analítica): las 7 presas CONAGUA de Chihuahua y el aforo de Ojinaga, del portal
 * USIBWC AQUARIUS. CONTEXTO de solo lectura: no sustituye la captura de campo ni CILA, ni entra a balance ni proyección.
 */
export default function PanelCuencaConchos() {
    const { datos, loading, error, recargar } = useAqwpCuenca();

    const calc = useMemo(() => {
        if (!datos) return null;
        const filas = filasPresas(datos.estados);
        const distrito = filas.filter(f => f.delDistrito);
        const ojinaga = datos.estados.find(e => e.ubicacionId === UBICACION_OJINAGA) ?? null;
        const fechas = filas.map(f => f.fecha).filter((x): x is string => !!x).sort();
        const ultimaFecha = fechas.length ? fechas[fechas.length - 1] : null;
        return {
            filas, ojinaga, ultimaFecha,
            cuenca: agregadoCuenca(filas),
            dist: agregadoCuenca(distrito),
            aport: aportacionTotal(filas),
            frescura: calcularFrescura(ultimaFecha, 48),
            cila: new Map(datos.cruceCila.map(c => [c.presaId, c.difPct])),
        };
    }, [datos]);

    if (loading) {
        return <div className="an-root" aria-busy="true" aria-label="Cargando cuenca del Conchos"><div className="an-skeleton" /><div className="an-skeleton an-skeleton--alta" /></div>;
    }
    if (error) {
        return (
            <div className="an-root"><div className="an-vacio" role="alert">
                <strong>No se pudo cargar la cuenca del Conchos.</strong>
                <span>{error}</span>
                <button type="button" className="an-btn" onClick={recargar}>Reintentar</button>
            </div></div>
        );
    }
    if (!datos || !calc || calc.filas.length === 0) {
        return <div className="an-root"><div className="an-vacio" role="status"><strong>Sin datos de la cuenca (S/D)</strong><span>Todavía no hay presas cargadas desde el portal USIBWC.</span></div></div>;
    }

    const { filas, ojinaga, cuenca, dist, aport, frescura } = calc;
    const estancadas = filas.filter(f => f.estancado);
    const boquilla = filas.find(f => f.ubicacionId === 536);
    const madero = filas.find(f => f.ubicacionId === 537);

    return (
        <div className="an-root pr-reveal">
            <header className="an-head">
                <div>
                    <h3 className="an-titulo">Cuenca del Conchos</h3>
                    <p className="an-sub">Presas CONAGUA de Chihuahua y aforo de Ojinaga · portal USIBWC (AQUARIUS) · datos provisionales</p>
                </div>
                <span className={`an-chip an-chip--${frescura == null ? 'sd' : frescura.stale ? 'warn' : 'ok'}`}>
                    <span aria-hidden="true">{frescura == null ? '◇' : frescura.stale ? '▲' : '●'}</span> {frescura ? frescura.texto : 'Sin lectura (S/D)'}
                </span>
            </header>

            <div className="an-kpis" role="list">
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Almacenamiento de la cuenca</span>
                    <span className="an-kpi-val">{fmt(cuenca.totalMm3, 1)}<small> Mm³</small></span>
                    <span className="an-kpi-sub">
                        {cuenca.porcentaje == null ? 'Sin lectura vigente' : `${formatearNumero(cuenca.porcentaje, 1)} % del NAMO`} · {cuenca.presasConDato} de {cuenca.presasTotal} presas con dato{cuenca.parcial ? ' (parcial)' : ''}
                    </span>
                </div>
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Presas del distrito</span>
                    <span className="an-kpi-val">{fmt(dist.totalMm3, 1)}<small> Mm³</small></span>
                    <span className="an-kpi-sub">
                        {dist.porcentaje == null ? 'Sin lectura vigente' : `${formatearNumero(dist.porcentaje, 1)} % del NAMO`} · Boquilla {boquilla?.pct == null ? 'S/D' : `${formatearNumero(boquilla.pct, 1)} %`} · Madero {madero?.pct == null ? 'S/D' : `${formatearNumero(madero.pct, 1)} %`}
                    </span>
                </div>
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Aportación a las presas</span>
                    <span className="an-kpi-val">{fmtFlujo(aport.total)}<small> m³/s</small></span>
                    <span className="an-kpi-sub">Suma del día · {aport.conDato} de {filas.length} presas con dato</span>
                </div>
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Salida de la cuenca · Ojinaga</span>
                    <span className="an-kpi-val">{fmtFlujo(ojinaga?.gastoM3s ?? null)}<small> m³/s</small></span>
                    <span className="an-kpi-sub">Aforo USIBWC 08373000{ojinaga?.fecha ? ` · ${fechaCorta(ojinaga.fecha)}` : ''}</span>
                </div>
            </div>

            {estancadas.length > 0 && (
                <p className="an-aviso" role="status">
                    <b>{estancadas.length === 1 ? 'Serie estancada' : 'Series estancadas'}:</b> {estancadas.map(f => f.nombre).join(', ')}. Su almacenamiento repite el mismo valor varios días aunque hay aportación o extracción; no se usa en los totales y se muestra como S/D hasta que vuelva a moverse.
                </p>
            )}

            <section className="an-card" aria-label="Estado de las presas de la cuenca">
                <h4 className="an-h">Presas de la cuenca</h4>
                <p className="an-nota">Porcentaje sobre el NAMO que publica CONAGUA; los umbrales de estado son referencia interna de SICA. Caudales del día en m³/s.</p>
                <div className="cu-tabla-wrap">
                    <table className="cu-tabla">
                        <thead>
                            <tr>
                                <th scope="col">Presa</th>
                                <th scope="col" className="cu-num">Almacenamiento (Mm³)</th>
                                <th scope="col" className="cu-num">% NAMO</th>
                                <th scope="col">Estado</th>
                                <th scope="col" className="cu-num">Aportación</th>
                                <th scope="col" className="cu-num">Extracción</th>
                                <th scope="col" className="cu-num">Vertido</th>
                                <th scope="col">Dato del</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filas.map(f => <FilaTabla key={f.ubicacionId} f={f} difCila={f.presaId ? calc.cila.get(f.presaId) : undefined} />)}
                        </tbody>
                    </table>
                </div>
            </section>

            <LluviaCuenca lluvia={datos.lluvia} />

            <section className="an-card" aria-label="Llenado de las presas, últimos 12 meses">
                <h4 className="an-h">Llenado de las presas · últimos 12 meses</h4>
                <p className="an-nota">Porcentaje del NAMO por presa. Las líneas se cortan donde no hay dato (S/D) y se dibujan punteadas donde el valor se repite varios días. Toque el nombre de una presa para ocultarla o mostrarla.</p>
                <GraficaLlenadoCuenca serie={datos.serie} presas={filas} />
            </section>

            <footer className="an-pie">
                <h4 className="an-h an-h--pie">Cómo se lee y qué límites tiene</h4>
                <ul>
                    <li><b>Fuente:</b> CONAGUA publica a diario y el portal de USIBWC lo reparte. SICA lo copia a tablas propias (última sincronización: {fechaHoraLocal(datos.ultSyncEn)}). Dato provisional sujeto a revisión; USIBWC no lo garantiza.</li>
                    <li><b>Solo contexto:</b> no sustituye la captura de campo ni el reporte CILA, y no entra al balance ni a la proyección. Para Boquilla y Madero se muestra la diferencia contra CILA; una alerta se abre si pasa de 2 %.</li>
                    <li><b>NAMO de CONAGUA:</b> el porcentaje usa el NAMO del portal, que puede diferir del que usa SICA en la pestaña Vaso operativo (Boquilla: 2,846.78 Mm³ en el portal), por eso los porcentajes pueden no coincidir exactamente.</li>
                    <li><b>Serie estancada:</b> mismo valor 4 días o más con aportación o extracción activas (≥ 0.05 m³/s). Es un criterio de SICA, no un dictamen: puede ser un embalse realmente quieto o un dato repetido por la fuente.</li>
                    <li><b>Ojinaga:</b> el gasto es el diario del aforo USIBWC 08373000; el sensor Sutron del mismo sitio reporta cifras muy distintas (ver Estaciones GOES).</li>
                    <li><b>Lluvia GOES:</b> el portal publica el acumulado del pluviómetro cada 10–15 minutos, con ruido y reinicios. SICA suma solo los incrementos positivos para obtener mm por día; un día con menos de 18 horas con muestra queda S/D. Validado contra las estaciones propias en los eventos de octubre y noviembre.</li>
                    <li><b>Nivel GOES de Luis L. León:</b> no se usa. La telemetría está congelada (1,025.43 msnm de mayo a septiembre y 1,018.78 msnm desde fines de septiembre) y su almacenamiento no coincide con el diario de CONAGUA. Babisas, Peguis y Boca del Río ya no transmiten en el portal.</li>
                    <li>Las fechas son el día del sello del portal, que usa UTC−6 fijo.</li>
                </ul>
            </footer>
        </div>
    );
}
