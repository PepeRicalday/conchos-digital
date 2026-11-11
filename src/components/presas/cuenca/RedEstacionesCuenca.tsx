import { Kpi } from '../../ui/base';
import { useMemo, useState } from 'react';
import type { useJcasCuenca } from '../../../hooks/useJcasCuenca';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { fechaCorta } from '../../../utils/analiticaPresas';
import type { LluviaAreal } from '../../../utils/jcasCuenca';
import { arealDe, diasCubiertos, esVentanaLarga, etiquetaVentana, mmPropio, valorObs, VENTANAS_OBS, type PuntoRedJcas, type VentanaObs } from '../../../utils/jcasModelo';
import MapaCuenca from './MapaCuenca';
import type { CapasCuenca } from '../../../hooks/useCapasCuenca';
import { DataTable } from '../../ui/base';

const horaLectura = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Chihuahua', hour: '2-digit', minute: '2-digit', hour12: false }) : 'S/D');
const fmtMm = (v: number | null) => (v == null ? 'S/D' : `${formatearNumero(v, 1)} mm`);

function estadoTexto(p: PuntoRedJcas): { glifo: string; texto: string; clase: string } {
    if (p.sospechosa) return { glifo: '✕', texto: 'Excluida (sospechosa)', clase: 'crit' };
    if (p.estado === 'sin-datos') return { glifo: '◇', texto: 'Sin datos', clase: 'sd' };
    if (p.estado === 'atrasada') return { glifo: '▲', texto: `Atrasada ${p.atrasoDias} d`, clase: 'warn' };
    if (p.sinPluviometro) return { glifo: '◆', texto: 'Sin pluviómetro', clase: 'sd' };
    return { glifo: '●', texto: 'Al día', clase: 'ok' };
}

/** Estado de una estación propia según su última fecha con lectura frente al último día completo de la red (S/D si no hay fecha). */
function estadoPropia(ultFecha: string | null, fin: string): { glifo: string; texto: string; clase: string } {
    if (!ultFecha) return { glifo: '◇', texto: 'Sin datos', clase: 'sd' };
    const dias = Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${ultFecha.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
    if (Number.isFinite(dias) && dias > 1) return { glifo: '▲', texto: `Atrasada ${dias} d`, clase: 'warn' };
    return { glifo: '●', texto: 'Al día', clase: 'ok' };
}

function KpiAreal({ etiqueta, a, cobertura }: { etiqueta: string; a: LluviaAreal; cobertura?: { con: number; de: number } | null }) {
    return (
        <Kpi densidad="compacta" etiqueta={`${etiqueta}`} valor={a.mm == null ? 'S/D' : formatearNumero(a.mm, 1)} unidad={a.mm != null ? " mm" : undefined} contexto={<>{a.mm == null
                    ? a.motivoSD
                    : `n = ${a.nEstaciones} estaciones · cobertura ${a.coberturaPct.toFixed(0)} % del área${a.min != null && a.max != null ? ` · rango ${fmtLluvia(a.min)}–${fmtLluvia(a.max)} mm` : ''} · provisional`}
                {cobertura && ` · historia diaria guardada: ${cobertura.con} de ${cobertura.de} días de la ventana`}</>} />
    );
}

/**
 * Red de estaciones JCAS/UACJ dentro de la cuenca del Conchos: mapa propio, lluvia areal (hoy, ayer, 7 y 30 días) y tabla por estación.
 * CONTEXTO de fuente TERCERA y provisional (portal público sin API): no sustituye las estaciones propias ni entra a KPIs del distrito.
 */
export default function RedEstacionesCuenca({ jcas, capas, ventana: ventanaProp, onVentana }: { jcas: ReturnType<typeof useJcasCuenca>; capas?: CapasCuenca; ventana?: VentanaObs; onVentana?: (v: VentanaObs) => void }) {
    const { red, loading, error, recargar } = jcas;
    // La ventana puede venir del panel (una sola para planos y red); sin él, es local.
    const [ventanaLocal, setVentanaLocal] = useState<VentanaObs>(30);
    const ventana = ventanaProp ?? ventanaLocal;
    const setVentana = onVentana ?? setVentanaLocal;
    const [sel, setSel] = useState<number | null>(null);

    const filas = useMemo(() => {
        const ps = red?.modelo?.puntos ?? [];
        const mm = (p: PuntoRedJcas) => valorObs(p, 'lluvia', ventana);
        return [...ps].sort((a, b) => (mm(b) ?? -1) - (mm(a) ?? -1) || a.nombre.localeCompare(b.nombre));
    }, [red, ventana]);

    if (loading) return <section className="an-card" id="cu-estaciones" role="status" aria-busy="true" aria-label="Cargando red de estaciones"><div className="an-skeleton an-skeleton--alta" /></section>;
    if (error || !red?.modelo || !red.contorno) {
        return (
            <section className="an-card" id="cu-estaciones" aria-label="Red de estaciones de la cuenca">
                <h4 className="an-h">Red de estaciones de la cuenca · JCAS</h4>
                <div className="an-vacio" role="status">
                    <strong>Sin estaciones JCAS por ahora (S/D)</strong>
                    <span>{error ?? 'Todavía no hay estaciones o contorno de la cuenca cargados.'}</span>
                    <button type="button" className="an-btn" onClick={recargar}>Reintentar</button>
                </div>
            </section>
        );
    }
    const m = red.modelo;
    const areal = arealDe(m, ventana);
    const larga = esVentanaLarga(ventana);
    type FilaRed = { j: (typeof filas)[number]; propia?: undefined } | { j?: undefined; propia: (typeof m.propias)[number] };
    const filasTabla: FilaRed[] = [...filas.map((j): FilaRed => ({ j })), ...m.propias.map((propia): FilaRed => ({ propia }))];
    const excluidas = m.puntos.filter((p) => p.sospechosa);
    const max30 = Math.max(0.0001, ...m.puntos.filter((p) => !p.sospechosa).map((p) => p.mm30 ?? 0), ...m.propias.map((p) => p.mm30 ?? 0));
    const barra = (v: number | null) => (v == null ? undefined : { ['--w' as string]: `${Math.max(0, Math.min(100, Math.round((v / max30) * 100)))}%` });

    return (
        <section className="an-card cu-red" id="cu-estaciones" aria-label="Red de estaciones de la cuenca">
            <div className="cu-red-cab">
                <div>
                    <h4 className="an-h">Red de estaciones de la cuenca · JCAS</h4>
                    <p className="an-nota">
                        {m.vigentes} de {m.total} estaciones JCAS/UACJ con dato de los últimos 3 días · días completos al {fechaCorta(m.fin)}{m.fechaHoy ? <> · <b>hoy {fechaCorta(m.fechaHoy)} (parcial, lectura de las {horaLectura(m.hoyEn)})</b></> : ' · hoy sin lectura (S/D)'} · fuente: portal público de JCAS (UACJ),
                        dato provisional; <b>contexto</b>, no sustituye las estaciones propias.
                    </p>
                </div>
                <div className="cu-ctl">
                    <span className="cu-ctl-etq" id="cu-red-ventana">Ventana</span>
                    <div className="an-seg" role="group" aria-labelledby="cu-red-ventana">
                        {VENTANAS_OBS.map(({ v, t }) => (
                            <button key={String(v)} type="button" className="an-seg-btn" aria-pressed={ventana === v} onClick={() => setVentana(v)}>{t}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="cu-red-kpis">
                <KpiAreal etiqueta={`Lluvia areal de la cuenca · ${typeof ventana === 'number' && ventana > 1 ? `${ventana} días` : etiquetaVentana(ventana)}`} a={areal} cobertura={diasCubiertos(m, ventana)} />
                <Kpi densidad="compacta" etiqueta="Estaciones con lluvia útil" valor={String(m.conLluvia)} unidad={` de ${m.total}`} contexto={<>Incluye las estaciones propias del distrito. Las de una misma ciudad pesan una vez; las sin pluviómetro o excluidas no entran al promedio.</>} />
            </div>

            {excluidas.length > 0 && (
                <p className="an-aviso" role="status">
                    <b>{excluidas.length === 1 ? 'Pluviómetro excluido' : 'Pluviómetros excluidos'}:</b> {excluidas.map((p) => `${p.nombre} (${p.motivo})`).join('; ')}. Es un criterio de SICA, no un dictamen: puede ser un sensor obstruido o una zona sin lluvia.
                </p>
            )}

            <div className="cu-cq"><div className="cu-red-cuerpo">
            <MapaCuenca contorno={red.contorno} puntos={m.puntos} seleccionada={sel} onSelect={setSel} ventana={ventana} propias={m.propias} capas={capas} />

            <DataTable
                propia
                className="cu-tabla" claseContenedor="cu-tabla-wrap cu-tabla-wrap--red" regionAria="Tabla de estaciones JCAS (desplazable)" captionOculto caption="Lluvia y temperatura por estación de la red JCAS y estaciones propias"
                clave={(r) => (r.propia ? 'p' : 'j') + (r.propia ?? r.j).id} filas={filasTabla}
                filaProps={(r) => r.j ? { className: r.j.id === sel ? 'cu-fila--sel' : undefined, onClick: () => setSel(r.j.id) } : undefined}
                columnas={[
                    {
                        id: 'est', titulo: 'Estación', encabezadoFila: true,
                        render: (r) => r.j ? (
                            <div className="cu-presa">
                                <span className="cu-nombre">{r.j.nombre}</span>
                                {r.j.zona === 'salida' && <span className="cu-tag">Salida</span>}
                                {r.j.grupo && <span className="cu-nota-fila">Misma ciudad que otras estaciones: pesa una vez en el promedio</span>}
                                {r.j.sospechosa && r.j.motivo && <span className="cu-nota-fila">{r.j.motivo}</span>}
                            </div>
                        ) : (
                            <div className="cu-presa"><span className="cu-nombre">{r.propia.nombre}</span><span className="cu-tag">Propia</span><span className="cu-nota-fila">{r.propia.tempUltima == null && r.propia.medias.temp30 == null ? 'Estación WeatherLink del distrito: solo lluvia (sin sensor de temperatura confiable)' : 'Estación WeatherLink del distrito'}</span></div>
                        ),
                    },
                    { id: 'hoy', titulo: 'Lluvia hoy (parcial)', className: 'cu-num', render: (r) => fmtMm(r.j ? r.j.hoy?.mm ?? null : r.propia.mmHoy) },
                    { id: 'ayer', titulo: 'Lluvia ayer', className: 'cu-num', render: (r) => fmtMm(r.j ? r.j.ayer.mm : r.propia.mm1) },
                    { id: 'd7', titulo: 'Lluvia 7 d', className: 'cu-num', render: (r) => fmtMm((r.j ?? r.propia).mm7) },
                    {
                        id: 'd30', titulo: 'Lluvia 30 d', className: 'cu-num cu-barra',
                        estilo: (r) => barra(r.j ? (r.j.sospechosa ? null : r.j.mm30) : r.propia.mm30),
                        render: (r) => fmtMm((r.j ?? r.propia).mm30),
                    },
                    ...(larga ? [{ id: 'larga', titulo: `Lluvia ${etiquetaVentana(ventana)}`, className: 'cu-num', render: (r: FilaRed) => fmtMm(r.j ? (r.j.sospechosa || r.j.sinPluviometro ? null : valorObs(r.j, 'lluvia', ventana)) : mmPropio(r.propia, ventana)) }] : []),
                    { id: 'temp', titulo: 'Temp. último día', className: 'cu-num', render: (r) => { const t = (r.j ?? r.propia).tempUltima; return t == null ? 'S/D' : `${formatearNumero(t, 1)} °C`; } },
                    {
                        id: 'estado', titulo: 'Estado · último día',
                        render: (r) => {
                            const e = r.j ? estadoTexto(r.j) : estadoPropia(r.propia.ultFecha, m.fin);
                            const uf = (r.j ?? r.propia).ultFecha;
                            return <><span className={`cu-estado cu-estado--${e.clase}`}><span aria-hidden="true">{e.glifo}</span> {e.texto}</span><span className="cu-nota-fila cu-fecha">{uf ? fechaCorta(uf) : 'S/D'}</span></>;
                        },
                    },
                ]}
            />
            </div></div>

            <details className="an-pie cu-notas">
                <summary className="cu-notas-sum">Cómo se calcula y qué límites tiene la red JCAS</summary>
                <ul>
                    <li><b>Fuente:</b> JCAS (Junta Central de Agua y Saneamiento de Chihuahua) con la UACJ publica sus estaciones en un portal abierto sin API ni términos de uso publicados. SICA lee solo las páginas públicas de cada estación, con pausas, y lo copia a tablas propias (última sincronización: {red.ultSyncEn ? new Date(red.ultSyncEn).toLocaleString('es-MX', { timeZone: 'America/Chihuahua', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'nunca'}). Si el portal cambia de formato, la lectura se detiene y se muestra S/D.</li>
                    <li><b>Contorno:</b> cuencas J–N de la región hidrológica RH24 (INEGI-CONAGUA, 28 subcuencas, {red.contorno.areaKm2 != null ? `≈ ${formatearNumero(red.contorno.areaKm2, 0)} km²` : 'área S/D'}). Ojinaga queda en el borde de salida.</li>
                    <li><b>Días completos y hoy:</b> los acumulados de ayer, 7 y 30 días usan solo días cerrados del reloj de cada estación. «Hoy» es el día en curso y es PARCIAL: lluvia acumulada y medias hasta la última lectura (cada 2 h aprox.); no se mezcla con los días completos ni con la verificación del pronóstico. Un acumulado con menos del 80 % de los días con dato es S/D.</li>
                    <li><b>Promedio areal:</b> interpolación por inverso de la distancia al cuadrado sobre una malla de 0.1°, limitada a 90 km de cada estación; con menos de 5 estaciones útiles o menos del 50 % del área cubierta, el resultado es S/D (nunca 0 mm).</li>
                    <li><b>Estaciones propias:</b> las {m.propias.length} estaciones WeatherLink dentro de la cuenca suman a la lluvia observada (el valor del día es la última lectura de su contador diario). Aportan también temperatura, humedad y viento (media de sus lecturas del día local, cada ~2 h) con las mismas reglas que JCAS: un sensor declarado no confiable (hoy, los de Riego San Rafael salvo la lluvia) es S/D y no entra a los planos.</li>
                    <li><b>Pluviómetros sospechosos:</b> 0 mm en 30 días mientras al menos dos vecinas a ≤ 90 km registran 20 mm o más. Se excluyen del promedio y se avisa.</li>
                    <li>Sin pluviómetro, el 0.0 que muestra el portal no significa «no llovió»: se trata como S/D. La serie JCAS es corta, así que no se dice qué es lo normal ni se calculan anomalías.</li>
                </ul>
            </details>
        </section>
    );
}
