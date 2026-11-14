import { memo, useCallback, useMemo, useState } from 'react';
import { Waves, Droplets, Layers, Scale } from 'lucide-react';
import { KpiTile } from './KpiTile';
import { Sparkline } from '../ui/Sparkline';
import { BarraSegmentada } from '../ui/BarraSegmentada';
import { useTratadoCiclo } from '../../hooks/useTratadoCiclo';
import { avanceCiclo, fmtAf } from '../../utils/tratadoCiclo';
import { hoyLocalISO } from '../../utils/hoyLocal';
import { ColumnasEmbalse, type ColumnaEmbalse } from '../ui/ColumnasEmbalse';
import { SelectorChips } from '../ndvi/SelectorChips';
import { estadoPresas } from '../../utils/dashboardKpisEjecutivos';
import TanquesMini from './TanquesMini';
import type { ModeloKpis } from './PanelKpis';
import { useJcasCuenca } from '../../hooks/useJcasCuenca';
import { useUnifrutCuenca } from '../../hooks/useUnifrutCuenca';
import { construirEstacionesClima, resumenPorRed, ROTULO_RED, type FuenteEstacion } from '../../utils/estacionesClima';

export type VistaPresas = 'distrito' | 'cuenca' | 'tratado';
const CLAVE = 'sica.dashboard.presas.vista';

/** Vista recordada por equipo (solo una comodidad: si el navegador bloquea el almacenamiento, vale 'distrito'). */
function leerVista(): VistaPresas {
    try { const v = window.localStorage.getItem(CLAVE); return v === 'cuenca' || v === 'tratado' ? v : 'distrito'; } catch { return 'distrito'; }
}

const f = (v: number | null | undefined, d = 1) => (v == null ? null : v.toFixed(d));
/** Las tres redes con la forma del mapa (la forma, no solo el color, las distingue): ■ Distrito · ● JCAS · ⬢ Unifrut. */
const REDES: FuenteEstacion[] = ['propia', 'jcas', 'unifrut'];
const GLIFO_RED: Record<FuenteEstacion, string> = { propia: '■', jcas: '●', unifrut: '⬢' };

/**
 * Tarjeta Presas con dos vistas en la misma celda: Distrito (Boquilla y Madero, con su serie de 7 días) y Cuenca (las 7 presas
 * CONAGUA del portal USIBWC). El selector es un radiogroup dentro de la tarjeta, que por eso no es un enlace (ver KpiTile.acciones).
 * Cuenca es contexto de solo lectura: S/D explícito, "sin actualizar" visible y nunca se mezcla con las cifras del distrito.
 */
export const TarjetaPresas = memo(function TarjetaPresas({ m }: { m: ModeloKpis }) {
    const [vista, setVista] = useState<VistaPresas>(leerVista);
    const cambiar = useCallback((v: VistaPresas) => {
        setVista(v);
        try { window.localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento: la vista no se recuerda */ }
    }, []);

    const { presas, cuenca } = m;
    // Tratado de 1944: solo se pide al elegir esta vista (caché compartida con la pestaña Cuenca).
    const tratado = useTratadoCiclo(vista === 'tratado');
    const avTratado = useMemo(() => (tratado.datos ? avanceCiclo(tratado.datos.ciclo, tratado.datos.cortes) : null), [tratado.datos]);
    const r = cuenca?.r ?? null;
    // Lluvia areal de la red (hoy parcial y ayer): solo se pide al abrir la vista Cuenca. Se cargan 30 días porque la detección de pluviómetros
    // sospechosos (0 mm continuo con vecinas lloviendo) necesita esa ventana; con menos, el Dashboard y Red y estaciones podrían divergir.
    const { red: redJcas } = useJcasCuenca(30 * 60_000, { activo: vista === 'cuenca', dias: 30 });
    const arealHoy = redJcas?.modelo?.arealHoy ?? null, arealAyer = redJcas?.modelo?.areal1 ?? null;
    // Las tres redes de estaciones, IDENTIFICADAS: Distrito (propias WeatherLink), JCAS y Unifrut (regional, FUERA de la cuenca). Carga ligera de Unifrut
    // (10 días) y solo en la vista Cuenca. Lluvia de AYER (día completo: Unifrut no publica el día en curso) como media simple por red; NUNCA es la lluvia
    // areal de la cuenca («cuenca hoy»), que sigue siendo solo de JCAS y las del Distrito.
    const { modelo: modUnifrut } = useUnifrutCuenca(60 * 60_000, { activo: vista === 'cuenca', dias: 10 });
    const redesAyer = useMemo(() => (redJcas?.modelo ? resumenPorRed(construirEstacionesClima(redJcas.modelo, modUnifrut), 'lluvia', 1) : null), [redJcas, modUnifrut]);

    const itemsCuenca: ColumnaEmbalse[] = useMemo(() => (r?.presas ?? []).map((p) => ({
        nombre: p.etiqueta, pct: p.pct, capacidadMm3: p.namoMm3 ?? 0, alerta: false, sinActualizar: p.sinActualizar,
    })), [r]);
    const namoCuenca = useMemo(() => (r?.presas ?? []).filter((p) => p.pct != null && p.namoMm3 != null).reduce((a, p) => a + (p.namoMm3 as number), 0), [r]);

    const selector = (
        <SelectorChips<VistaPresas> etiqueta="Presas a mostrar" etiquetaOculta clase="kp-vistas kp-vistas-presas" valor={vista} onChange={cambiar}
            opciones={[
                { valor: 'distrito', texto: 'Distrito', icono: <Waves size={16} aria-hidden="true" />, aria: 'Presas del distrito: Boquilla y Madero', title: 'Presas del distrito (Boquilla y Madero)' },
                { valor: 'cuenca', texto: 'Cuenca', icono: <Layers size={16} aria-hidden="true" />, aria: `Presas de la cuenca del Conchos: ${r ? `${r.total} presas` : 'sin lectura'}`, title: 'Las 7 presas de la cuenca del Conchos (CONAGUA vía USIBWC)' },
                { valor: 'tratado', texto: 'Tratado', icono: <Scale size={16} aria-hidden="true" />, aria: 'Avance del Tratado de 1944 en el ciclo 2025-2030', title: 'Avance de las entregas a EUA del Tratado de 1944 (IBWC)' },
            ]} />
    );

    if (vista === 'tratado') {
        const a = avTratado, ciclo = tratado.datos?.ciclo;
        const estado = !a || a.estado === 'sd' ? { tipo: 'sd' as const, texto: 'Sin corte oficial' }
            : a.estado === 'atrasado' ? { tipo: 'warn' as const, texto: 'Por debajo de la meta' } : { tipo: 'ok' as const, texto: a.estado === 'adelante' ? 'Por delante de la meta' : 'En la meta lineal' };
        const meta = a?.metaLinealAf != null && ciclo ? (a.metaLinealAf / ciclo.compromisoAf) * 100 : null;
        return (
            <KpiTile id="kp-presas" to="/presas?tab=analitica&vista=cuenca" enlaceTexto="Abrir Tratado en Cuenca" titulo="Tratado 1944" icono={<Scale size={18} />} valor={f(a?.pctCompromiso)} unidad="%" estado={estado}
                aria={`Tratado de 1944, ciclo 2025-2030: ${f(a?.pctCompromiso) ?? 'sin dato'} por ciento del compromiso entregado, ${estado.texto}. Abrir el avance del Tratado en Cuenca`}
                acciones={selector}
                viz={<div className="kp-presas-viz-col"><BarraSegmentada pct={a?.pctCompromiso ?? null} marcaPct={meta} etiqueta="Compromiso del ciclo entregado; la marca es la meta lineal" /></div>}
                contexto={a && a.acumuladoAf != null && ciclo
                    ? <><b>{fmtAf(a.acumuladoAf)} / {fmtAf(ciclo.compromisoAf)} AF</b> · {(a.acumuladoMm3 ?? 0).toFixed(0)} Mm³
                        <span className="kp-sep"> · </span><span className="kp-nw">{a.difLinealAf != null ? `${a.difLinealAf >= 0 ? '+' : '−'}${fmtAf(Math.abs(a.difLinealAf))} AF vs meta lineal` : 'S/D'}</span>
                        {a.deudaRemanenteAf != null && <><span className="kp-sep"> · </span><span className="kp-nw">deuda previa {fmtAf(a.deudaRemanenteAf)} AF</span></>}</>
                    : <>{tratado.error ? 'No se pudo leer el avance del Tratado' : tratado.cargando ? 'Cargando avance del Tratado…' : 'Sin corte oficial del IBWC (S/D)'}</>}
                fresco={a?.corte ? `Corte IBWC ${a.corte.fecha} · dato provisional` : 'Sin lectura (S/D)'} stale={a?.corte ? (Date.parse(hoyLocalISO()) - Date.parse(a.corte.fecha)) / 86_400_000 > 10 : false} />
        );
    }

    if (vista === 'cuenca') {
        const estado = estadoPresas(r?.pct);
        return (
            <KpiTile id="kp-presas" to="/presas?tab=analitica&vista=cuenca" enlaceTexto="Abrir Cuenca" titulo="Cuenca" icono={<Layers size={18} />} valor={f(r?.pct)} unidad="%" estado={estado}
                aria={`Presas de la cuenca del Conchos: almacenamiento ${f(r?.pct) ?? 'sin dato'} por ciento, ${estado.texto}. Abrir Cuenca en Presas, Analítica y forecasting`}
                acciones={selector}
                viz={<div className="kp-presas-viz-col">
                    <div className="kp-presas-viz kp-presas-viz-cuenca">
                        {r ? <ColumnasEmbalse items={itemsCuenca} /> : <div className="kp-banda kp-banda-sd" role="status">{cuenca?.cargado === false ? 'Cargando cuenca…' : 'Cuenca sin lectura'}</div>}
                    </div>
                    {redesAyer && (
                        <div className="kp-redes" role="group" aria-label="Lluvia de ayer por red de estaciones"
                            title={REDES.map((f) => `${ROTULO_RED[f]}: ${redesAyer[f].alDia} estaciones al día${redesAyer[f].media != null ? `, media simple de ${redesAyer[f].conDato} con lluvia de ayer` : ', sin media de ayer (S/D)'}`).join(' · ') + '. Media simple por red, NO es la lluvia areal de la cuenca. Unifrut está fuera de la cuenca (contexto regional).'}>
                            <span className="kp-redes-t">lluvia ayer</span>
                            {REDES.map((f) => <span key={f} className={`kp-red kp-red--${f}`}><span aria-hidden="true">{GLIFO_RED[f]}</span> {ROTULO_RED[f]} <b>{redesAyer[f].media != null ? `${redesAyer[f].media!.toFixed(1)} mm` : 'S/D'}</b><span className="kp-red-n"> ({redesAyer[f].alDia})</span></span>)}
                        </div>
                    )}
                </div>}
                contexto={r
                    ? <><b>{r.almacenadoMm3 != null ? `${r.almacenadoMm3.toFixed(0)} / ${namoCuenca.toFixed(0)} Mm³` : 'S/D'}</b>
                        {r.conDato < r.total ? ` (${r.conDato}/${r.total} presas)` : ` · ${r.total} presas`}
                        <span className="kp-sep"> · </span><span className="kp-nw" title="Promedio simple de 7 días de los pluviómetros de las presas (CONAGUA vía USIBWC). No es el promedio areal de la cuenca de la cifra siguiente.">presas 7 d <b>{r.lluvia.promedio7Mm != null ? `${r.lluvia.promedio7Mm.toFixed(1)} mm` : 'S/D'}</b></span>
                        <span className="kp-sep"> · </span><span className="kp-nw" title="Lluvia areal estimada de la cuenca (interpolación con las estaciones JCAS/UACJ y las del Distrito, WeatherLink; Unifrut NO entra); hoy es parcial (día en curso)">cuenca hoy <b>{arealHoy?.mm != null ? `${arealHoy.mm.toFixed(1)} mm` : 'S/D'}</b>{arealAyer?.mm != null ? <> · ayer <b>{arealAyer.mm.toFixed(1)} mm</b></> : null} <em className="kp-red-de">(JCAS + Distrito)</em></span>
                        {redesAyer ? <span className="kp-unif-ctx"><span className="kp-sep"> · </span><span className="kp-nw kp-red kp-red--unifrut" title={`Unifrut A.C. (regional, FUERA de la cuenca): media simple de ${redesAyer.unifrut.conDato} de sus ${redesAyer.unifrut.alDia} estaciones al día con lluvia de ayer. NO es la lluvia de la cuenca; Unifrut solo publica días completos.`}><span aria-hidden="true">{GLIFO_RED.unifrut}</span> Unifrut ayer <b>{redesAyer.unifrut.media != null ? `${redesAyer.unifrut.media.toFixed(1)} mm` : 'S/D'}</b></span></span> : null}
                        {r.sinActualizar > 0 ? <span className="kp-nw"> · {r.sinActualizar} sin actualizar (trama)</span> : null}</>
                    : <>Contexto CONAGUA vía USIBWC: sin lectura</>}
                fresco={r?.frescura ? `${r.frescura.texto} · dato provisional` : 'Sin lectura (S/D)'} stale={!!r?.frescura?.stale} />
        );
    }

    return (
        <KpiTile id="kp-presas" to="/presas" enlaceTexto="Abrir Presas" titulo="Presas" icono={<Droplets size={18} />} valor={f(presas.pct)} unidad="%" estado={presas.estado}
            aria={`Presas del distrito: almacenamiento ${f(presas.pct) ?? 'sin dato'} por ciento, ${presas.estado.texto}. Abrir Presas`}
            acciones={selector}
            viz={<div className="kp-presas-viz"><ColumnasEmbalse items={presas.items} /><div className="kp-presas-spark"><Sparkline valores={presas.serie} etiqueta="Almacenamiento total, últimos 7 días" unidad="Mm³" color="var(--sc-s1)" alto={44} area /><small>7 días</small></div></div>}
            contexto={<><b>{presas.almacenadoMm3 != null ? `${presas.almacenadoMm3.toFixed(0)} / ${presas.capacidadMm3.toFixed(0)} Mm³` : 'Sin lectura'}</b> · {presas.tendencia.texto}
                {r ? <span className="kp-cuenca-l"><TanquesMini presas={r.presas} /> Cuenca: <b>{r.almacenadoMm3 != null ? `${r.almacenadoMm3.toFixed(0)} Mm³` : 'S/D'}</b>{r.pct != null ? ` · ${r.pct.toFixed(0)} %` : ''}</span> : null}</>}
            fresco={presas.frescura} stale={presas.stale} />
    );
});
