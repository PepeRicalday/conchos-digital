import { Kpi, DataTable } from '../../ui/base';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import type { RedJcas } from '../../../hooks/useJcasCuenca';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { construirMensual, type FilaMensualJcas, type MesCuenca } from '../../../utils/jcasMensual';

const num = (x: unknown) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x));
const W = 720, H = 220, PAD = { l: 38, r: 10, t: 14, b: 30 };

/** Barras de lluvia areal por mes. Un mes S/D se dibuja como casilla con trama y rótulo «S/D»: nunca como barra de 0. */
function Barras({ meses }: { meses: MesCuenca[] }) {
    const max = Math.max(10, ...meses.map((m) => m.lluvia.mm ?? 0));
    const tope = Math.ceil(max / 20) * 20;
    const paso = (W - PAD.l - PAD.r) / meses.length, ancho = Math.min(40, paso * 0.66);
    const y = (v: number) => PAD.t + (1 - v / tope) * (H - PAD.t - PAD.b);
    const resumen = meses.map((m) => `${m.etiqueta}: ${m.lluvia.mm == null ? 'S/D' : `${fmtLluvia(m.lluvia.mm)} mm`}`).join('; ');
    return (
        <svg className="cu-mes-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Lluvia areal de la cuenca por mes. ${resumen}`}>
            <defs><pattern id="cu-mes-sd" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="none" /><line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.5" opacity="0.45" /></pattern></defs>
            {[0, 0.5, 1].map((f) => (
                <g key={f}>
                    <line x1={PAD.l} x2={W - PAD.r} y1={y(tope * f)} y2={y(tope * f)} className="cu-mes-rejilla" />
                    <text x={PAD.l - 6} y={y(tope * f) + 4} textAnchor="end" className="cu-mes-eje">{Math.round(tope * f)}</text>
                </g>
            ))}
            <text x={4} y={10} className="cu-mes-eje">mm</text>
            {meses.map((m, i) => {
                const cx = PAD.l + paso * i + paso / 2, v = m.lluvia.mm;
                return (
                    <g key={m.mes}>
                        {v == null
                            ? <><rect x={cx - ancho / 2} y={y(tope * 0.18)} width={ancho} height={y(0) - y(tope * 0.18)} fill="url(#cu-mes-sd)" className="cu-mes-sd" /><text x={cx} y={y(tope * 0.18) - 4} textAnchor="middle" className="cu-mes-val">S/D</text></>
                            : <><rect x={cx - ancho / 2} y={y(v)} width={ancho} height={Math.max(1.5, y(0) - y(v))} rx="3" className="cu-mes-barra" /><text x={cx} y={y(v) - 4} textAnchor="middle" className="cu-mes-val">{fmtLluvia(v)}</text></>}
                        <text x={cx} y={H - 10} textAnchor="middle" className="cu-mes-eje">{m.etiqueta}</text>
                    </g>
                );
            })}
        </svg>
    );
}

/**
 * Resumen mes a mes de la cuenca con los totales mensuales de JCAS (la única historia de varios meses disponible: lo diario guardado es corto).
 * Contexto provisional de fuente tercera. No se habla de «normal» ni de anomalía: la serie es de un solo año.
 */
export default function MensualCuenca({ jcas }: { jcas: { red: RedJcas | null; loading: boolean } }) {
    const [filas, setFilas] = useState<FilaMensualJcas[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        let vivo = true;
        (async () => {
            const { data, error: e } = await supabase.from('jcas_lecturas_mensuales').select('estacion_id, mes, lluvia_mm, temp_c, hum_pct, viento_kmh').order('mes').limit(5000);
            if (!vivo) return;
            if (e) { setError(e.message); return; }
            setFilas((data ?? []).map((r) => ({ estacion_id: Number(r.estacion_id), mes: String(r.mes), lluvia_mm: num(r.lluvia_mm), temp_c: num(r.temp_c), hum_pct: num(r.hum_pct), viento_kmh: num(r.viento_kmh) })));
        })();
        return () => { vivo = false; };
    }, []);

    const meses = useMemo(() => {
        const m = jcas.red?.modelo, c = jcas.red?.contorno;
        if (!filas || !m || !c) return null;
        const est = m.puntos.map((p) => ({ id: p.id, nombre: p.nombre, lat: p.lat, lon: p.lon, grupo: p.grupo, sinPluviometro: p.sinPluviometro }));
        return construirMensual(est, filas, c.poligonos).slice(-12);
    }, [filas, jcas.red]);

    if (error || (!jcas.loading && !jcas.red?.modelo)) {
        return (
            <section className="an-card" id="cu-mensual" aria-label="Resumen mes a mes de la cuenca">
                <h4 className="an-h">Mes a mes · JCAS/UACJ</h4>
                <div className="an-vacio" role="status"><strong>Sin resumen mensual por ahora (S/D)</strong><span>{error ?? 'Todavía no hay estaciones JCAS cargadas.'}</span></div>
            </section>
        );
    }
    if (!meses) return <section className="an-card" id="cu-mensual" role="status" aria-busy="true" aria-label="Cargando resumen mes a mes"><div className="an-skeleton" /></section>;

    const conDato = meses.filter((m) => m.lluvia.mm != null);
    const total = conDato.reduce((a, m) => a + (m.lluvia.mm as number), 0);
    const mayor = conDato.length ? conDato.reduce((a, b) => ((b.lluvia.mm as number) > (a.lluvia.mm as number) ? b : a)) : null;
    const completo = conDato.length === meses.length;

    return (
        <section className="an-card" id="cu-mensual" aria-label="Resumen mes a mes de la cuenca">
            <div className="cu-red-cab">
                <div>
                    <h4 className="an-h">Mes a mes · lluvia y clima de la cuenca</h4>
                    <p className="an-nota">
                        Totales mensuales de las estaciones JCAS/UACJ (últimos {meses.length} meses completos): lluvia areal de la cuenca, una estación por ciudad, sin los pluviómetros excluidos.
                        Dato provisional de fuente tercera; no hay «normal» ni anomalía porque la serie es de un solo año.
                    </p>
                </div>
            </div>
            <div className="cu-red-kpis">
                <Kpi densidad="compacta" etiqueta={`${completo ? `Acumulado de ${meses.length} meses` : `Acumulado de ${conDato.length} de ${meses.length} meses con dato`}`} valor={conDato.length ? fmtLluvia(total) : 'S/D'} unidad={conDato.length > 0 ? " mm" : undefined} contexto={completo ? 'suma de los totales mensuales de la cuenca' : 'solo suma los meses con dato (no es el total del periodo): los S/D no se rellenan con 0'} />
                <Kpi densidad="compacta" etiqueta="Mes más lluvioso" valor={mayor ? mayor.etiqueta : 'S/D'} contexto={mayor ? `${fmtLluvia(mayor.lluvia.mm)} mm de lluvia areal · n = ${mayor.lluvia.nEstaciones} estaciones` : 'sin meses con dato'} />
            </div>
            <Barras meses={meses} />
            <DataTable
                regionAria="Tabla mes a mes (desplazable)" clave={(m) => m.mes} filas={[...meses].reverse()}
                columnas={[
                    { id: 'mes', titulo: 'Mes', encabezadoFila: true, render: (m) => m.etiqueta },
                    { id: 'lluvia', titulo: 'Lluvia areal (mm)', numerica: true, render: (m) => m.lluvia.mm == null ? <span title={m.lluvia.motivoSD ?? undefined}>S/D</span> : fmtLluvia(m.lluvia.mm) },
                    { id: 'est', titulo: 'Estaciones', numerica: true, render: (m) => m.lluvia.mm == null ? '—' : String(m.lluvia.nEstaciones) },
                    { id: 'temp', titulo: 'Temp. media (°C)', numerica: true, render: (m) => m.temp == null ? 'S/D' : formatearNumero(m.temp, 1) },
                    { id: 'hum', titulo: 'Humedad (%)', numerica: true, render: (m) => m.hum == null ? 'S/D' : formatearNumero(m.hum, 0) },
                    { id: 'vto', titulo: 'Viento (km/h)', numerica: true, render: (m) => m.viento == null ? 'S/D' : formatearNumero(m.viento, 1) },
                ]}
            />
        </section>
    );
}
