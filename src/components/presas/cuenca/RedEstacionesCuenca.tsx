import { Kpi } from '../../ui/base';
import { Maximize2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { useJcasCuenca } from '../../../hooks/useJcasCuenca';
import type { useUnifrutCuenca } from '../../../hooks/useUnifrutCuenca';
import { formatearNumero } from '../../../utils/historicoPresas';
import { fmtLluvia } from '../../../utils/fmtLluvia';
import { fechaCorta } from '../../../utils/analiticaPresas';
import type { LluviaAreal } from '../../../utils/jcasCuenca';
import { arealDe, diasCubiertos, esVentanaLarga, etiquetaVentana, VENTANAS_OBS, type VentanaObs } from '../../../utils/jcasModelo';
import {
    construirEstacionesClima, fmtValorEstacion, FUENTES, infoVariable, ofreceVariable, ORDEN_ESTADO, reporta, resumenVisible, ROTULO_FUENTE, valorEstacion, VARIABLES_ESTACION,
    type EstacionClima, type FuenteEstacion, type VariableEstacion,
} from '../../../utils/estacionesClima';
import MapaCuenca from './MapaCuenca';
import type { CapasCuenca } from '../../../hooks/useCapasCuenca';
import { DataTable } from '../../ui/base';

const horaLectura = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Chihuahua', hour: '2-digit', minute: '2-digit', hour12: false }) : 'S/D');
const fechaHoraSync = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Chihuahua', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'nunca');

function estadoTexto(e: EstacionClima, variable: VariableEstacion): { glifo: string; texto: string; clase: string } {
    // La exclusión y la falta de pluviómetro solo afectan a la lluvia: la temperatura, la humedad y el viento de esa estación siguen valiendo
    if (variable === 'lluvia' && e.excluidaLluvia) return { glifo: '✕', texto: 'Excluida (sospechosa)', clase: 'crit' };
    if (e.estado === 'sin-datos') return { glifo: '◇', texto: 'Sin datos', clase: 'sd' };
    if (e.estado === 'fuera-servicio') return { glifo: '◇', texto: `Fuera de servicio · ${e.atrasoDias} d`, clase: 'sd' };
    if (e.estado === 'atrasada') return { glifo: '▲', texto: `Atrasada ${e.atrasoDias} d`, clase: 'warn' };
    if (variable === 'lluvia' && e.sinPluviometro) return { glifo: '◆', texto: 'Sin pluviómetro', clase: 'sd' };
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

type FiltroFuente = 'todas' | FuenteEstacion;

/**
 * Red de estaciones de la cuenca y su región: UNA sola sección con las tres redes (propias WeatherLink, JCAS/UACJ y Unifrut) y tres filtros:
 * qué estaciones ver (todas o una red), qué variable (lluvia, temperatura, T mínima, viento, humedad, horas frío) y qué ventana. El mapa y la tabla
 * obedecen a los mismos filtros. CONTEXTO provisional: no sustituye las estaciones propias ni entra a KPIs del distrito. Unifrut queda FUERA del
 * contorno de la cuenca: nunca entra a la lluvia areal ni a su promedio.
 */
export default function RedEstacionesCuenca({ jcas, unifrut, capas, ventana: ventanaProp, onVentana, onMapaCompleto }: {
    jcas: ReturnType<typeof useJcasCuenca>; unifrut?: ReturnType<typeof useUnifrutCuenca>; capas?: CapasCuenca; ventana?: VentanaObs; onVentana?: (v: VentanaObs) => void;
    /** Abre el mapa interactivo de pantalla completa (lo pasa el panel). */
    onMapaCompleto?: () => void;
}) {
    const { red, loading, error, recargar } = jcas;
    // La ventana puede venir del panel (una sola para planos y red); sin él, es local.
    const [ventanaLocal, setVentanaLocal] = useState<VentanaObs>(30);
    const ventana = ventanaProp ?? ventanaLocal;
    const setVentana = onVentana ?? setVentanaLocal;
    const [sel, setSel] = useState<number | null>(null);
    const [fuente, setFuente] = useState<FiltroFuente>('todas');
    const [variable, setVariable] = useState<VariableEstacion>('lluvia');
    const [verFuera, setVerFuera] = useState(false);
    const um = unifrut?.modelo ?? null;
    const info = infoVariable(variable);

    const modeloEst = useMemo(() => construirEstacionesClima(red?.modelo, um), [red, um]);
    const porFuente = useMemo(() => modeloEst.estaciones.filter((e) => fuente === 'todas' || e.fuente === fuente), [modeloEst, fuente]);
    const cuentas = useMemo(() => ({
        todas: modeloEst.estaciones.filter(reporta).length, propia: modeloEst.estaciones.filter((e) => e.fuente === 'propia' && reporta(e)).length,
        jcas: modeloEst.estaciones.filter((e) => e.fuente === 'jcas' && reporta(e)).length, unifrut: modeloEst.estaciones.filter((e) => e.fuente === 'unifrut' && reporta(e)).length,
    }), [modeloEst]);
    const apagadas = useMemo(() => porFuente.filter((e) => !reporta(e)), [porFuente]);
    const val = (e: EstacionClima, v: VentanaObs = ventana) => valorEstacion(e, variable, v, modeloEst.finUnifrut);
    const filas = useMemo(() => {
        const base = verFuera ? porFuente : porFuente.filter(reporta);
        return [...base].sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]
            || (valorEstacion(b, variable, ventana, modeloEst.finUnifrut) ?? -1e9) - (valorEstacion(a, variable, ventana, modeloEst.finUnifrut) ?? -1e9) || a.nombre.localeCompare(b.nombre));
    }, [porFuente, verFuera, variable, ventana, modeloEst.finUnifrut]);
    const visiblesConDato = useMemo(() => filas.filter(reporta), [filas]);
    const resumen = useMemo(() => resumenVisible(visiblesConDato.filter((e) => ofreceVariable(e, variable)), variable, ventana, modeloEst.finUnifrut), [visiblesConDato, variable, ventana, modeloEst.finUnifrut]);

    if (loading) return <section className="an-card" id="cu-estaciones" role="status" aria-busy="true" aria-label="Cargando red de estaciones"><div className="an-skeleton an-skeleton--alta" /></section>;
    if (error || !red?.modelo || !red.contorno) {
        return (
            <section className="an-card" id="cu-estaciones" aria-label="Red de estaciones de la cuenca">
                <h4 className="an-h">Red de estaciones de la cuenca</h4>
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
    const excluidas = m.puntos.filter((p) => p.sospechosa);
    const fuentes: FuenteEstacion[] = fuente === 'todas' ? ['propia', 'jcas', 'unifrut'] : [fuente];
    const sinHoyUnifrut = ventana === 'hoy' && fuentes.includes('unifrut');
    // Columnas de la variable: las horas frío son un acumulado de temporada (no dependen de la ventana)
    const columnasVentana: { id: string; v: VentanaObs; titulo: string }[] = variable === 'horasFrio'
        ? [{ id: 'frio', v: 30, titulo: 'Horas frío (desde 1-nov)' }]
        : [
            { id: 'hoy', v: 'hoy', titulo: `${info.etiqueta} hoy (parcial)` }, { id: 'ayer', v: 1, titulo: `${info.etiqueta} ayer` }, { id: 'd7', v: 7, titulo: `${info.etiqueta} 7 d` }, { id: 'd30', v: 30, titulo: `${info.etiqueta} 30 d` },
            ...(larga ? [{ id: 'larga', v: ventana, titulo: `${info.etiqueta} ${etiquetaVentana(ventana)}` }] : []),
        ];
    const maxBarra = Math.max(0.0001, ...visiblesConDato.map((e) => Math.max(0, val(e, 30) ?? 0)));
    const barra = (v: number | null) => (v == null || v <= 0 ? undefined : { ['--w' as string]: `${Math.max(0, Math.min(100, Math.round((v / maxBarra) * 100)))}%` });
    const tituloVentana = variable === 'horasFrio' ? 'acumuladas desde el 1-nov' : typeof ventana === 'number' && ventana > 1 ? `${ventana} días` : etiquetaVentana(ventana);
    const nFuente = (f: FiltroFuente) => (f === 'todas' ? cuentas.todas : cuentas[f]);

    return (
        <section className="an-card cu-red" id="cu-estaciones" aria-label="Red de estaciones de la cuenca">
            <div className="cu-red-cab">
                <div>
                    <h4 className="an-h">Red de estaciones de la cuenca</h4>
                    <p className="an-nota">
                        {cuentas.todas} estaciones con dato de los últimos 3 días: {cuentas.propia} propias, {cuentas.jcas} JCAS/UACJ y {cuentas.unifrut} Unifrut (regional, fuera de la cuenca) · días completos al {fechaCorta(m.fin)}{m.fechaHoy ? <> · <b>hoy {fechaCorta(m.fechaHoy)} (parcial, lectura de las {horaLectura(m.hoyEn)})</b></> : ' · hoy sin lectura (S/D)'} · fuentes: estaciones propias, portal público de JCAS (UACJ) y de Unifrut, dato provisional;
                        <b> contexto</b>, no sustituye las estaciones propias.
                    </p>
                </div>
                {onMapaCompleto && (
                    <button type="button" className="an-btn" onClick={onMapaCompleto} title="Mapa interactivo de clima a pantalla completa, con filtros por fuente, variable y periodo">
                        <Maximize2 size={14} aria-hidden="true" /> Mapa interactivo
                    </button>
                )}
            </div>

            <div className="cu-red-filtros">
                <div className="cu-ctl">
                    <span className="cu-ctl-etq" id="cu-red-fuente">Estaciones</span>
                    <div className="an-seg" role="group" aria-labelledby="cu-red-fuente">
                        <button type="button" className="an-seg-btn" aria-pressed={fuente === 'todas'} onClick={() => setFuente('todas')}>Todas ({nFuente('todas')})</button>
                        {FUENTES.map((f) => (
                            <button key={f.id} type="button" className="an-seg-btn" aria-pressed={fuente === f.id} title={f.ayuda} onClick={() => setFuente(f.id)}>{f.etiqueta} ({nFuente(f.id)})</button>
                        ))}
                    </div>
                </div>
                <div className="cu-ctl">
                    <span className="cu-ctl-etq" id="cu-red-variable">Variable</span>
                    <div className="an-seg" role="group" aria-labelledby="cu-red-variable">
                        {VARIABLES_ESTACION.map((v) => (
                            <button key={v.id} type="button" className="an-seg-btn" aria-pressed={variable === v.id} onClick={() => setVariable(v.id)}>{v.etiqueta}</button>
                        ))}
                    </div>
                </div>
                <div className="cu-ctl">
                    <span className="cu-ctl-etq" id="cu-red-ventana">Ventana</span>
                    <div className="an-seg" role="group" aria-labelledby="cu-red-ventana">
                        {VENTANAS_OBS.map(({ v, t }) => (
                            <button key={String(v)} type="button" className="an-seg-btn" aria-pressed={ventana === v} onClick={() => setVentana(v)} disabled={variable === 'horasFrio'} title={variable === 'horasFrio' ? 'Las horas frío son un acumulado de temporada: no dependen de la ventana' : undefined}>{t}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="cu-red-kpis">
                <KpiAreal etiqueta={`Lluvia areal de la cuenca · ${typeof ventana === 'number' && ventana > 1 ? `${ventana} días` : etiquetaVentana(ventana)}`} a={areal} cobertura={diasCubiertos(m, ventana)} />
                <Kpi densidad="compacta" etiqueta="Estaciones con lluvia útil" valor={String(m.conLluvia)} unidad={` de ${m.total}`} contexto={<>Incluye las estaciones propias del distrito. Las de una misma ciudad pesan una vez; las sin pluviómetro o excluidas no entran al promedio.</>} />
                <Kpi densidad="compacta" etiqueta={`${info.etiqueta} · ${fuente === 'todas' ? 'todas las redes' : ROTULO_FUENTE[fuente]} · ${tituloVentana}`}
                    valor={resumen.media == null ? 'S/D' : formatearNumero(resumen.media, variable === 'humedad' || variable === 'horasFrio' ? 0 : 1)} unidad={resumen.media != null ? ` ${info.unidad}` : undefined}
                    contexto={<>{resumen.media == null
                        ? (sinHoyUnifrut && resumen.conDato === 0 ? 'Unifrut solo publica días completos.' : `Se necesitan ≥ 2 estaciones con dato (hay ${resumen.conDato}).`)
                        : `media simple de ${resumen.conDato} de ${visiblesConDato.length} estaciones (${fmtValorEstacion(variable, resumen.min)}–${fmtValorEstacion(variable, resumen.max)}) · NO es el valor areal de la cuenca${fuentes.includes('unifrut') ? ' (incluye Unifrut, que está fuera)' : ''}`}</>} />
            </div>

            {sinHoyUnifrut && <p className="an-aviso" role="status">Unifrut solo publica días completos: para «hoy» sus estaciones no tienen lectura parcial (S/D). Elige «Ayer» o una ventana más larga.</p>}
            {variable === 'lluvia' && fuentes.includes('jcas') && excluidas.length > 0 && (
                <p className="an-aviso" role="status">
                    <b>{excluidas.length === 1 ? 'Pluviómetro excluido' : 'Pluviómetros excluidos'}:</b> {excluidas.map((p) => `${p.nombre} (${p.motivo})`).join('; ')}. Es un criterio de SICA, no un dictamen: puede ser un sensor obstruido o una zona sin lluvia.
                </p>
            )}
            {(variable === 'humedad' || variable === 'horasFrio') && fuentes.includes('unifrut') && (
                <p className="an-aviso" role="status">Unifrut no tiene {variable === 'humedad' ? 'humedad confiable' : 'horas frío'}: sus estaciones quedan en S/D en esta variable.</p>
            )}

            <div className="cu-cq"><div className="cu-red-cuerpo">
            <MapaCuenca contorno={red.contorno} puntos={m.puntos} seleccionada={sel} onSelect={setSel} ventana={ventana} propias={m.propias} capas={capas} regionales={um} variable={variable} fuentes={fuentes} />

            <DataTable
                propia
                className="cu-tabla" claseContenedor="cu-tabla-wrap cu-tabla-wrap--red" regionAria="Tabla de estaciones (desplazable)" captionOculto caption={`${info.etiqueta} por estación de la red (${fuente === 'todas' ? 'propias, JCAS y Unifrut' : ROTULO_FUENTE[fuente]})`}
                clave={(e: EstacionClima) => e.clave} filas={filas}
                filaProps={(e: EstacionClima) => e.fuente === 'jcas' ? { className: e.origen.id === sel ? 'cu-fila--sel' : undefined, onClick: () => setSel(e.origen.id) } : undefined}
                columnas={[
                    {
                        id: 'est', titulo: 'Estación', encabezadoFila: true,
                        render: (e: EstacionClima) => (
                            <div className="cu-presa">
                                <span className="cu-nombre">{e.nombre}</span>
                                <span className={`cu-tag${e.fuente === 'unifrut' ? ' cu-tag--aviso' : ''}`}>{ROTULO_FUENTE[e.fuente]}</span>
                                {e.fuente === 'jcas' && e.origen.zona === 'salida' && <span className="cu-tag">Salida</span>}
                                {e.nota && e.fuente !== 'jcas' && <span className="cu-nota-fila">{e.fuente === 'unifrut' && e.altitudM != null ? `${e.nota} · ${formatearNumero(e.altitudM, 0)} msnm` : e.nota}</span>}
                                {e.fuente === 'jcas' && e.origen.grupo && <span className="cu-nota-fila">Misma ciudad que otras estaciones: pesa una vez en el promedio</span>}
                                {variable === 'lluvia' && e.fuente === 'jcas' && e.origen.sospechosa && e.origen.motivo && <span className="cu-nota-fila">{e.origen.motivo}</span>}
                            </div>
                        ),
                    },
                    ...columnasVentana.map((c) => ({
                        id: c.id, titulo: c.titulo, className: `cu-num${c.id === 'd30' ? ' cu-barra' : ''}`,
                        ...(c.id === 'd30' ? { estilo: (e: EstacionClima) => barra(val(e, 30)) } : {}),
                        render: (e: EstacionClima) => fmtValorEstacion(variable, val(e, c.v)),
                    })),
                    {
                        id: 'estado', titulo: 'Estado · último día',
                        render: (e: EstacionClima) => {
                            const s = estadoTexto(e, variable);
                            return <><span className={`cu-estado cu-estado--${s.clase}`}><span aria-hidden="true">{s.glifo}</span> {s.texto}</span><span className="cu-nota-fila cu-fecha">{e.ultFecha ? fechaCorta(e.ultFecha) : 'S/D'}</span></>;
                        },
                    },
                ]}
            />
            </div></div>

            {apagadas.length > 0 && !verFuera && (
                <button type="button" className="an-btn" aria-expanded={false} onClick={() => setVerFuera(true)}>Mostrar las {apagadas.length} estaciones fuera de servicio o sin datos</button>
            )}
            {verFuera && apagadas.length > 0 && (
                <button type="button" className="an-btn" aria-expanded={true} onClick={() => setVerFuera(false)}>Ocultar las estaciones fuera de servicio o sin datos</button>
            )}

            <details className="an-pie cu-notas">
                <summary className="cu-notas-sum">Cómo se calcula y qué límites tienen las redes</summary>
                <ul>
                    <li><b>Fuentes:</b> estaciones propias (WeatherLink del distrito), JCAS (Junta Central de Agua y Saneamiento de Chihuahua con la UACJ; portal abierto sin API ni términos publicados) y la Red de Estaciones Meteorológicas de Unifrut A.C. (portal propio, lectura autorizada por Unifrut). SICA lee solo páginas públicas, con pausas, y lo copia a tablas propias (última sincronización JCAS: {fechaHoraSync(red.ultSyncEn)}; Unifrut: {fechaHoraSync(unifrut?.ultSyncEn)}). Si un portal cambia de formato, la lectura se detiene y se muestra S/D.</li>
                    <li><b>Contorno:</b> cuencas J–N de la región hidrológica RH24 (INEGI-CONAGUA, 28 subcuencas, {red.contorno.areaKm2 != null ? `≈ ${formatearNumero(red.contorno.areaKm2, 0)} km²` : 'área S/D'}). Ojinaga queda en el borde de salida. <b>Las 29 estaciones de Unifrut quedan fuera del contorno</b> (Cuauhtémoc, Namiquipa, Guerrero): son contexto regional y nunca entran a la lluvia areal ni a su promedio; las «colindantes» están a 25 km o menos del límite.</li>
                    <li><b>Filtros:</b> «Estaciones» elige una red o todas; «Variable» cambia la tabla y el mapa (lluvia, temperatura media, T mínima, viento, humedad, horas frío); «Ventana» el periodo. Los dos primeros KPIs no cambian de significado: la lluvia areal es siempre la de la cuenca (JCAS y propias) y el tercero es una <b>media simple</b> de lo que se ve, con al menos 2 estaciones con dato.</li>
                    <li><b>Días de JCAS (huso):</b> el «día» que publica el portal de JCAS es un día UTC (de 18:00 a 18:00 hora de Chihuahua), así que la lluvia de la tarde-noche caía en el día siguiente. Desde el 13-nov-2026 SICA lee las horas del portal y arma días LOCALES de Chihuahua (00:00 a 24:00): lluvia con al menos 22 de 24 horas con dato, medias con al menos 20. Los días anteriores siguen siendo los del portal (día UTC) y entre ambos queda una ventana de 6 h sin cubrir. «Hoy» se calcula con las horas completas desde la medianoche local.</li>
                    <li><b>Días completos y hoy:</b> los acumulados de ayer, 7 y 30 días usan solo días cerrados del reloj de cada estación. «Hoy» es el día en curso y es PARCIAL: lluvia acumulada y medias hasta la última lectura (cada 2 h aprox.). Unifrut no publica el día en curso (S/D). Un acumulado con menos del 80 % de los días con dato es S/D.</li>
                    <li><b>Promedio areal:</b> interpolación por inverso de la distancia al cuadrado sobre una malla de 0.1°, limitada a 90 km de cada estación; con menos de 5 estaciones útiles o menos del 50 % del área cubierta, el resultado es S/D (nunca 0 mm).</li>
                    <li><b>Estaciones propias:</b> las {m.propias.length} estaciones WeatherLink dentro de la cuenca suman a la lluvia observada y aportan temperatura, humedad y viento (media de sus lecturas del día local, cada ~2 h): un sensor declarado no confiable (hoy, los de Riego San Rafael salvo la lluvia) es S/D.</li>
                    <li><b>Unifrut:</b> lluvia se suma, la temperatura mínima es el extremo de la ventana, la temperatura y el viento son medias diarias. Sin humedad confiable ni horas frío. SICA descarta valores físicamente imposibles (humedad negativa, temperaturas de cientos de grados, rachas de más de 160 km/h) y anemómetros sin señal. Estado: «Al día» = dato de los últimos 3 días; «Atrasada» = 4 a 30 días; más de 30 días = fuera de servicio.</li>
                    <li><b>Pluviómetros sospechosos:</b> 0 mm en 30 días mientras al menos dos vecinas a ≤ 90 km registran 20 mm o más. Se excluyen del promedio y se avisa. Solo afecta a la lluvia: su temperatura, humedad y viento siguen valiendo.</li>
                    <li>Sin pluviómetro, el 0.0 que muestra el portal no significa «no llovió»: se trata como S/D. La serie JCAS es corta, así que no se dice qué es lo normal ni se calculan anomalías.</li>
                </ul>
            </details>
        </section>
    );
}
