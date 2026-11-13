import { memo, useCallback, useMemo, useState } from 'react';
import { Waves, Droplets, Layers } from 'lucide-react';
import { KpiTile } from './KpiTile';
import { Sparkline } from '../ui/Sparkline';
import { ColumnasEmbalse, type ColumnaEmbalse } from '../ui/ColumnasEmbalse';
import { SelectorChips } from '../ndvi/SelectorChips';
import { estadoPresas } from '../../utils/dashboardKpisEjecutivos';
import TanquesMini from './TanquesMini';
import type { ModeloKpis } from './PanelKpis';
import { useJcasCuenca } from '../../hooks/useJcasCuenca';

export type VistaPresas = 'distrito' | 'cuenca';
const CLAVE = 'sica.dashboard.presas.vista';

/** Vista recordada por equipo (solo una comodidad: si el navegador bloquea el almacenamiento, vale 'distrito'). */
function leerVista(): VistaPresas {
    try { return window.localStorage.getItem(CLAVE) === 'cuenca' ? 'cuenca' : 'distrito'; } catch { return 'distrito'; }
}

const f = (v: number | null | undefined, d = 1) => (v == null ? null : v.toFixed(d));

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
    const r = cuenca?.r ?? null;
    // Lluvia areal de la red (hoy parcial y ayer): solo se pide al abrir la vista Cuenca. Se cargan 30 días porque la detección de pluviómetros
    // sospechosos (0 mm continuo con vecinas lloviendo) necesita esa ventana; con menos, el Dashboard y Red y estaciones podrían divergir.
    const { red: redJcas } = useJcasCuenca(30 * 60_000, { activo: vista === 'cuenca', dias: 30 });
    const arealHoy = redJcas?.modelo?.arealHoy ?? null, arealAyer = redJcas?.modelo?.areal1 ?? null;

    const itemsCuenca: ColumnaEmbalse[] = useMemo(() => (r?.presas ?? []).map((p) => ({
        nombre: p.etiqueta, pct: p.pct, capacidadMm3: p.namoMm3 ?? 0, alerta: false, sinActualizar: p.sinActualizar,
    })), [r]);
    const namoCuenca = useMemo(() => (r?.presas ?? []).filter((p) => p.pct != null && p.namoMm3 != null).reduce((a, p) => a + (p.namoMm3 as number), 0), [r]);

    const selector = (
        <SelectorChips<VistaPresas> etiqueta="Presas a mostrar" etiquetaOculta clase="kp-vistas kp-vistas-presas" valor={vista} onChange={cambiar}
            opciones={[
                { valor: 'distrito', texto: 'Distrito', icono: <Waves size={16} aria-hidden="true" />, aria: 'Presas del distrito: Boquilla y Madero', title: 'Presas del distrito (Boquilla y Madero)' },
                { valor: 'cuenca', texto: 'Cuenca', icono: <Layers size={16} aria-hidden="true" />, aria: `Presas de la cuenca del Conchos: ${r ? `${r.total} presas` : 'sin lectura'}`, title: 'Las 7 presas de la cuenca del Conchos (CONAGUA vía USIBWC)' },
            ]} />
    );

    if (vista === 'cuenca') {
        const estado = estadoPresas(r?.pct);
        return (
            <KpiTile id="kp-presas" to="/presas?tab=analitica&vista=cuenca" enlaceTexto="Abrir Cuenca" titulo="Cuenca" icono={<Layers size={18} />} valor={f(r?.pct)} unidad="%" estado={estado}
                aria={`Presas de la cuenca del Conchos: almacenamiento ${f(r?.pct) ?? 'sin dato'} por ciento, ${estado.texto}. Abrir Cuenca en Presas, Analítica y forecasting`}
                acciones={selector}
                viz={<div className="kp-presas-viz kp-presas-viz-cuenca">
                    {r ? <ColumnasEmbalse items={itemsCuenca} /> : <div className="kp-banda kp-banda-sd" role="status">{cuenca?.cargado === false ? 'Cargando cuenca…' : 'Cuenca sin lectura'}</div>}
                </div>}
                contexto={r
                    ? <><b>{r.almacenadoMm3 != null ? `${r.almacenadoMm3.toFixed(0)} / ${namoCuenca.toFixed(0)} Mm³` : 'S/D'}</b>
                        {r.conDato < r.total ? ` (${r.conDato}/${r.total} presas)` : ` · ${r.total} presas`}
                        <span className="kp-sep"> · </span><span className="kp-nw" title="Promedio simple de 7 días de los pluviómetros de las presas (CONAGUA vía USIBWC). No es el promedio areal de la cuenca de la cifra siguiente.">presas 7 d <b>{r.lluvia.promedio7Mm != null ? `${r.lluvia.promedio7Mm.toFixed(1)} mm` : 'S/D'}</b></span>
                        <span className="kp-sep"> · </span><span className="kp-nw" title="Lluvia areal estimada de la cuenca (interpolación con las estaciones JCAS/UACJ y las propias WeatherLink); hoy es parcial (día en curso)">cuenca hoy <b>{arealHoy?.mm != null ? `${arealHoy.mm.toFixed(1)} mm` : 'S/D'}</b>{arealAyer?.mm != null ? <> · ayer <b>{arealAyer.mm.toFixed(1)} mm</b></> : null}</span>
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
