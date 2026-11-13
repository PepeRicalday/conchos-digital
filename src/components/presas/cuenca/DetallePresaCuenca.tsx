import { formatearNumero } from '../../../utils/historicoPresas';
import { fechaCorta } from '../../../utils/analiticaPresas';
import type { PresaCuencaModelo } from '../../../utils/cuencaModelo';
import SemaforoBadge from './SemaforoBadge';
import { GLIFO_ESTADO } from '../../../utils/presaNiveles';

const fmt = (v: number | null, d = 1) => (v == null ? 'S/D' : formatearNumero(v, d));
const fmtFlujo = (v: number | null) => (v == null ? 'S/D' : formatearNumero(v, v !== 0 && Math.abs(v) < 1 ? 3 : 2));

function Dato({ etq, children, sub }: { etq: string; children: React.ReactNode; sub?: React.ReactNode }) {
    return (
        <div className="cu-dato">
            <dt>{etq}</dt>
            <dd>{children}</dd>
            {sub != null && <dd className="cu-dato-sub">{sub}</dd>}
        </div>
    );
}

/**
 * Ficha de la presa seleccionada: lo que antes estaba disperso en 8 columnas. Todo viene del mismo modelo que usa el informe,
 * así las cifras nunca divergen. Sin dato = "S/D"; la ficha (estado, río, DR) solo muestra lo que tiene fuente.
 */
export default function DetallePresaCuenca({ m, difCila }: { m: PresaCuencaModelo; difCila: number | null | undefined }) {
    const f = m.fila, meta = m.meta, u = m.util, p = m.posicion, t = m.tendencia;
    const ficha = [
        meta?.rio ? `Río ${meta.rio}` : null,
        meta?.municipio ? `${meta.municipio}${meta.estado ? `, ${meta.estado}` : ''}` : meta?.estado ?? null,
        meta?.dr ?? null,
        meta?.tambienLlamada ? `también "${meta.tambienLlamada}"` : null,
    ].filter(Boolean);

    return (
        <section className="an-card cu-detalle" aria-label={`Detalle de ${f.etiqueta}`}>
            <header className="cu-detalle-cab">
                <div>
                    <h4 className="an-h">{f.etiqueta}</h4>
                    <p className="an-nota">{ficha.length ? ficha.join(' · ') : 'Ficha sin verificar (estado, río y distrito de riego por confirmar con CONAGUA)'}</p>
                </div>
                <div className="cu-detalle-chips">
                    {f.delDistrito && <span className="cu-tag">Distrito</span>}
                    <span className="cu-chip-par"><span className="cu-chip-etq">Umbral 20/40 %</span>
                        <span className={`cu-estado cu-estado--${f.estado.clave}`}><span aria-hidden="true">{GLIFO_ESTADO[f.estado.clave]}</span> {f.estado.etiqueta}</span></span>
                    <span className="cu-chip-par"><span className="cu-chip-etq">Semáforo combinado</span>
                        <SemaforoBadge s={m.semaforo} /></span>
                </div>
            </header>

            {f.sinActualizar && (
                <p className="an-aviso" role="status">
                    <b>Sin actualizar</b>{f.igualDesde ? ` desde el ${fechaCorta(f.igualDesde)}` : ''}{f.diasIgual ? ` (${f.diasIgual} días)` : ''}: CONAGUA repite el último dato obtenido{f.almacenamientoMm3 != null ? ` (${formatearNumero(f.almacenamientoMm3, 3)} Mm³)` : ''} aunque reporta aportación y extracción. Se muestra ese último dato; no hay tendencia que calcular.
                </p>
            )}

            <dl className="cu-datos">
                <Dato etq="Almacenamiento" sub={f.namoMm3 != null ? `de ${formatearNumero(f.namoMm3, 1)} Mm³ (NAMO)` : 'NAMO S/D'}>{fmt(f.almacenamientoValido, 1)} <small>Mm³</small></Dato>
                <Dato etq="% del NAMO" sub={f.fecha ? `dato del ${fechaCorta(f.fecha)}` : undefined}>{f.pct == null ? 'S/D' : `${formatearNumero(f.pct, 1)} %`}</Dato>
                <Dato etq="Volumen útil" sub={u ? `${formatearNumero(u.pctUtil, 1)} % útil · muerto ${fmt(f.muertoMm3, 1)} Mm³${u.bajoMuerto ? ' · bajo el volumen muerto' : ''}` : 'falta el volumen muerto'}>{u ? formatearNumero(u.utilMm3, 1) : 'S/D'} <small>Mm³</small></Dato>
                <Dato etq="Posición histórica" sub={p ? p.nota : 'sin climatología cargada'}>
                    {p?.percentil != null ? <>Percentil {p.percentil}</> : p ? 'Pocos años' : 'S/D'}
                </Dato>
                <Dato etq="Mediana del día" sub={p?.minimo != null && p?.maximo != null ? `rango ${formatearNumero(p.minimo, 0)}–${formatearNumero(p.maximo, 0)} Mm³` : undefined}>
                    {p?.mediana != null ? <>{formatearNumero(p.mediana, 1)} <small>Mm³</small></> : 'S/D'}
                </Dato>
                <Dato etq="Frente a la mediana" sub={p?.anomaliaPct != null ? `${p.anomaliaPct > 0 ? '+' : p.anomaliaPct < 0 ? '−' : ''}${formatearNumero(Math.abs(p.anomaliaPct), 1)} %` : undefined}>
                    {p?.anomaliaMm3 != null ? <>{p.anomaliaMm3 > 0 ? '+' : p.anomaliaMm3 < 0 ? '−' : ''}{formatearNumero(Math.abs(p.anomaliaMm3), 1)} <small>Mm³</small></> : 'S/D'}
                </Dato>
                <Dato etq="Tendencia 30 d" sub={t ? `Theil-Sen · ${t.n} lecturas` : f.sinActualizar ? 'lectura sin actualizar' : 'pocas lecturas (se piden ≥ 5)'}>
                    {t ? <>{t.pendienteMm3Dia > 0 ? '▲ +' : t.pendienteMm3Dia < 0 ? '▼ −' : '= '}{formatearNumero(Math.abs(t.pendienteMm3Dia), 2)} <small>Mm³/día</small></> : 'S/D'}
                </Dato>
                <Dato etq="Peso en la cuenca" sub="del NAMO sumado de las 7 presas">{m.participacionNamo == null ? 'S/D' : `${formatearNumero(m.participacionNamo, 1)} %`}</Dato>
                <Dato etq="Aportación">{fmtFlujo(f.aportacionM3s)} <small>m³/s</small></Dato>
                <Dato etq="Extracción">{fmtFlujo(f.extraccionTotalM3s)} <small>m³/s</small></Dato>
                <Dato etq="Vertido">{fmtFlujo(f.vertidoM3s)} <small>m³/s</small></Dato>
                {f.delDistrito && <Dato etq="Contra CILA" sub="mismo día, almacenamiento">{difCila == null ? 'S/D' : `${difCila > 0 ? '+' : difCila < 0 ? '−' : ''}${formatearNumero(Math.abs(difCila), 2)} %`}</Dato>}
            </dl>

            {m.semaforo.motivos.length > 0 && <p className="an-nota">Por qué este nivel: {m.semaforo.motivos.join(' · ')}.</p>}
            {m.descartes.length > 0 && (
                <p className="an-nota">
                    Se excluyó de las estadísticas {m.descartes.length === 1 ? 'una lectura atípica' : `${m.descartes.length} lecturas atípicas`}: {m.descartes.map((d) => `${fechaCorta(d.fecha)} (${formatearNumero(d.valor, 1)} Mm³)`).join(', ')}. El dato original se conserva en la base.
                </p>
            )}
        </section>
    );
}
