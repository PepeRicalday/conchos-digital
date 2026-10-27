import { useMemo } from 'react';
import {
    GASTO_UMBRAL_CENSURA_M3S, STALE_GOES_MIN, TITULO_GRUPO, textoBajoUmbral, VENTANAS, agregarSerie, ceroSospechoso, colorEstacion, estadoEnlace, fechaHoraLocal, fmt, fmtDelta,
    grupoDeEstacion, horaLocal, saludEnlace, textoEdad, ultimoBueno, ultimoPunto,
    type EstacionHidro, type MensajeHidro, type PuntoHidro, type Tendencia, type VentanaHidro,
} from '../../../utils/hidroEstaciones';
import { COBERTURA_MIN_CONFIABLE, enVentana, type EstadisticaEstacion, type ResumenEstacion } from '../../../utils/hidroEstadistica';
import type { SeriesEstacion } from '../../../hooks/useHidroEstaciones';
import Spark from './Spark';
import { GLIFO_ENLACE, instanteEnlace } from './enlaceGoes';

interface Props {
    estacion: EstacionHidro;
    /** Últimas 24 h: cifra vigente y marca de cero sospechoso. */
    series: SeriesEstacion | undefined;
    /** Serie de la ventana global (para el trazo); si aún carga, se usa la de 24 h. */
    serieVentana?: SeriesEstacion | null;
    /** Estadística de la ventana global; null mientras carga. */
    estadistica: EstadisticaEstacion | null;
    ventana: VentanaHidro;
    mensajes: MensajeHidro[];
    ahora: number;
    /** Presa abierta en la pantalla: la ficha se resalta. */
    destacada?: boolean;
}

/** Rótulo de la base real de una variación: «24 h» salvo que la lectura base quede lejos de lo pedido. */
const rotuloHoras = (t: Tendencia | null | undefined, nominalH: number): string => {
    if (!t || Math.abs(t.horas - nominalH) <= Math.max(1, nominalH * 0.04)) return nominalH === 24 ? '24 h' : '7 d';
    return t.horas < 48 ? `${fmt(t.horas, 0)} h` : `${fmt(t.horas / 24, 1)} d`;
};

const FLECHA = { sube: '▲', baja: '▼', estable: '►' } as const;

/** Variación con flecha; el color nunca es el único indicio (flecha + signo). */
function Var({ t, dec, cargando }: { t: Tendencia | null | undefined; dec: number; cargando: boolean }) {
    if (cargando) return <span className="goes-var goes-var--sd">…</span>;
    if (!t) return <span className="goes-var goes-var--sd">S/D</span>;
    return (
        <span className={`goes-var goes-var--${t.dir}`}>
            <span aria-hidden="true">{FLECHA[t.dir]}</span> {t.dir === 'estable' ? 'estable' : fmtDelta(t.delta, dec)}
        </span>
    );
}

function Cifra({ r, campo, dec, cargando }: { r: ResumenEstacion | null | undefined; campo: 'min' | 'media' | 'max'; dec: number; cargando: boolean }) {
    return <td>{cargando ? '…' : r ? fmt(r[campo], dec) : 'S/D'}</td>;
}

/**
 * Último registro conocido de la serie (de las últimas 24 h), sea o no reciente: con la estación sin transmisión se muestra
 * ese valor rotulado con su antigüedad («Último dato … hace X»), nunca 0 ni S/D. `obsoleto` avisa que ya no es una lectura actual.
 */
function ultimoConocido(serie: PuntoHidro[] | undefined, ahora: number): { p: PuntoHidro; obsoleto: boolean } | null {
    const p = serie ? ultimoPunto(serie) : null;
    if (!p || !ahora) return null;
    return { p, obsoleto: (ahora - p.t) / 60000 > STALE_GOES_MIN };
}

export default function TarjetaEstacion({ estacion, series, serieVentana, estadistica, ventana, mensajes, ahora, destacada }: Props) {
    const ultBueno = ultimoBueno(mensajes, estacion.id);
    const ultDato = estacion.ult_dato_en ? Date.parse(estacion.ult_dato_en) : null;
    const enlace = estadoEnlace(instanteEnlace(estacion, mensajes), ahora);
    const salud = saludEnlace(mensajes, estacion.id, ahora - 24 * 3600000);
    const apagada = enlace.clave === 'sin_transmision' || enlace.clave === 'sd';
    const cargando = estadistica == null;

    const sNivel = series?.nivel_m ?? [];
    const sGasto = series?.gasto_m3s ?? [];
    const uNivel = ultimoConocido(sNivel, ahora);
    const uGasto = ultimoConocido(sGasto, ahora);
    const pNivel = uNivel?.p ?? null;
    const pGasto = uGasto?.p ?? null;
    const pVel = ultimoConocido(series?.velocidad_ms, ahora)?.p ?? null;
    const obsoleto = apagada || !!uNivel?.obsoleto || !!uGasto?.obsoleto;
    const cero = pGasto != null && ceroSospechoso(estacion.id, pGasto.v, pNivel?.v ?? null);

    const { horas, pasoMin } = VENTANAS[ventana];
    const hastaMs = ahora || 1;
    const desdeMs = hastaMs - horas * 3600000;
    const trazo = useMemo(() => {
        const fuente = serieVentana ?? series;
        const una = (v: 'nivel_m' | 'gasto_m3s') => {
            const s = enVentana(fuente?.[v], desdeMs, hastaMs);
            return ventana === '24h' ? s : agregarSerie(s, pasoMin);
        };
        return { nivel: una('nivel_m'), gasto: una('gasto_m3s') };
    }, [serieVentana, series, desdeMs, hastaMs, ventana, pasoMin]);
    const huecoMs = Math.max(50, pasoMin * 3) * 60000;

    const color = colorEstacion(estacion.id);
    const grupo = grupoDeEstacion(estacion);
    const tieneUbicacion = estacion.latitud != null && estacion.longitud != null;
    const ultTxt = ultDato ?? ultBueno;
    const cob = estadistica?.cobertura ?? null;
    const cobBaja = cob != null && !cob.confiable;

    return (
        <article className={`goes-ficha${destacada ? ' is-destacada' : ''}${apagada ? ' is-apagada' : ''}`} style={{ ['--acc' as string]: color }} aria-label={`Estación ${estacion.nombre}`}>
            <header className="goes-ficha-cab">
                <div className="goes-ficha-fila">
                    <span className={`goes-origen goes-origen--${grupo === 'rio' ? 'rio' : 'presa'}`}>{TITULO_GRUPO[grupo]}</span>
                    <span className={`goes-sello goes-sello--${enlace.clave}`}><span aria-hidden="true">{GLIFO_ENLACE[enlace.clave]}</span> {enlace.etiqueta}</span>
                </div>
                <h4>{estacion.nombre}</h4>
                <span className="goes-dcp">DCP {estacion.id}</span>
            </header>

            <div className="goes-medidas">
                <section className="goes-medida" aria-label="Nivel">
                    <span className="goes-k" title="Nivel del sensor en la estación (referencia propia): no es cota msnm ni porcentaje de llenado">Nivel <small>m</small></span>
                    <span className={`goes-num${pNivel ? (obsoleto ? ' is-obsoleto' : '') : ' is-sd'}`}>{pNivel ? fmt(pNivel.v, 2) : 'S/D'}</span>
                    <Spark serie={trazo.nivel} color={color} desdeMs={desdeMs} hastaMs={hastaMs} huecoMs={huecoMs}
                        etiqueta={`Nivel de ${estacion.nombre}`} ventanaTxt={VENTANAS[ventana].etiqueta} />
                </section>
                <section className="goes-medida" aria-label="Gasto">
                    <span className="goes-k">Gasto <small>m³/s</small></span>
                    <span className={`goes-num${pGasto ? (obsoleto ? ' is-obsoleto' : '') : ' is-sd'}`}>{pGasto ? (cero ? textoBajoUmbral(estacion.id) : fmt(pGasto.v, 2)) : 'S/D'}</span>
                    <Spark serie={trazo.gasto} color={color} desdeMs={desdeMs} hastaMs={hastaMs} huecoMs={huecoMs}
                        etiqueta={`Gasto de ${estacion.nombre}`} ventanaTxt={VENTANAS[ventana].etiqueta} />
                </section>
                {cero && (
                    <span className="goes-marca" title={`La estación reporta 0, pero su sensor no mide valores entre 0 y ~${GASTO_UMBRAL_CENSURA_M3S[estacion.id]} m³/s: es «por debajo del umbral», no caudal nulo. Causa sin confirmar.`}>
                        <span aria-hidden="true">◇</span> bajo umbral del sensor (reporta 0)<span className="goes-sr">: el sensor no mide por debajo de {GASTO_UMBRAL_CENSURA_M3S[estacion.id]} metros cúbicos por segundo; no es caudal nulo.</span>
                    </span>
                )}
            </div>
            <table className="goes-mini tap-compact">
                <caption className="goes-mini-cap">{apagada ? <>Últimas {VENTANAS[ventana].etiqueta} hasta el último dato ({ultTxt ? fechaHoraLocal(ultTxt) : 'S/D'})</> : <>Últimas {VENTANAS[ventana].etiqueta}</>}</caption>
                <thead><tr><th scope="col"><span className="goes-sr">Variable</span></th><th scope="col">mín</th><th scope="col">prom</th><th scope="col">máx</th></tr></thead>
                <tbody>
                    <tr><th scope="row">Nivel</th>{(['min', 'media', 'max'] as const).map(c => <Cifra key={c} r={estadistica?.nivel} campo={c} dec={2} cargando={cargando} />)}</tr>
                    <tr><th scope="row">Gasto</th>{(['min', 'media', 'max'] as const).map(c => (
                        c === 'media' && estadistica?.censurado
                            // Con lecturas bajo el umbral, el prom de solo las positivas sobreestima: se da el rango.
                            ? <td key={c} title="Rango: ceros bajo el umbral como 0 y como el umbral del sensor">{fmt(estadistica.censurado.mediaInf, 1)} – {fmt(estadistica.censurado.mediaSup, 1)}</td>
                            : <Cifra key={c} r={estadistica?.gasto} campo={c} dec={1} cargando={cargando} />
                    ))}</tr>
                </tbody>
            </table>
            <table className="goes-mini goes-mini--var tap-compact">
                <caption className="goes-mini-cap">Variación</caption>
                <thead><tr><th scope="col"><span className="goes-sr">Variable</span></th><th scope="col">{rotuloHoras(estadistica?.variacionNivel.h24 ?? estadistica?.variacionGasto.h24, 24)}</th><th scope="col">{rotuloHoras(estadistica?.variacionNivel.d7 ?? estadistica?.variacionGasto.d7, 168)}</th></tr></thead>
                <tbody>
                    <tr><th scope="row">Nivel <small>m</small></th>
                        <td><Var t={estadistica?.variacionNivel.h24} dec={2} cargando={cargando} /></td><td><Var t={estadistica?.variacionNivel.d7} dec={2} cargando={cargando} /></td></tr>
                    <tr><th scope="row">Gasto <small>m³/s</small></th>
                        <td><Var t={estadistica?.variacionGasto.h24} dec={1} cargando={cargando} /></td><td><Var t={estadistica?.variacionGasto.d7} dec={1} cargando={cargando} /></td></tr>
                </tbody>
            </table>

            <div className="goes-ficha-chips">
                {obsoleto && <p className="goes-extra goes-extra--sd">Último registro conocido{ultTxt ? <> ({fechaHoraLocal(ultTxt)}, {textoEdad(enlace.edadMin)})</> : ''}: no es una lectura actual.</p>}
                <span className={`goes-cob${cobBaja ? ' is-baja' : ''}`} title={cob ? `${cob.recibidas} de ${cob.esperadas} lecturas esperadas` : undefined}>
                    {cargando ? 'Cobertura …' : cob ? <>Cobertura <b>{fmt(cob.pct, 0)} %</b>{cobBaja && <> <span aria-hidden="true">▲</span> menos de {COBERTURA_MIN_CONFIABLE} %: pocas lecturas</>}</> : 'Cobertura S/D'}
                </span>
                {estadistica && estadistica.excluidas > 0 && (
                    <span className={`goes-cob${estadistica.gastoRepresentativo ? '' : ' is-baja'}`}>
                        {estadistica.censurado
                            ? <>Gasto medio <b>{fmt(estadistica.censurado.mediaInf, 1)} – {fmt(estadistica.censurado.mediaSup, 1)}</b> m³/s ({estadistica.excluidas} de {estadistica.gastoRecibidas} lecturas bajo umbral)</>
                            : <>Gasto sin ceros sospechosos ({estadistica.gastoRecibidas - estadistica.excluidas} de {estadistica.gastoRecibidas} lecturas)</>}
                        {!estadistica.gastoRepresentativo && <> <span aria-hidden="true">▲</span> <b>poco representativa</b></>}
                    </span>
                )}
                {!tieneUbicacion && <span className="goes-chip-sutil" title="La estación no tiene coordenadas registradas; no se dibuja en mapa">Ubicación pendiente</span>}
            </div>

            <footer className="goes-ficha-pie">
                <span title="Hora de Chihuahua">
                    {apagada
                        ? <>Último dato: <b>{ultTxt ? fechaHoraLocal(ultTxt) : 'S/D'}</b>{enlace.edadMin != null ? ` (${textoEdad(enlace.edadMin)})` : ''}</>
                        : <>Mensaje de las <b>{horaLocal(ultDato ?? ultBueno)}</b> · {textoEdad(enlace.edadMin)}</>}
                </span>
                {pVel && <span>Velocidad <b>{fmt(pVel.v, 2)} m/s</b></span>}
                <span>Señal <b>{salud.senalDbm == null ? 'S/D' : `${fmt(salud.senalDbm, 0)} dBm`}</b></span>
                {tieneUbicacion && <span className="goes-ubic">{`${fmt(estacion.latitud, 4)}° N, ${fmt(Math.abs(estacion.longitud as number), 4)}° O`}</span>}
            </footer>
        </article>
    );
}
