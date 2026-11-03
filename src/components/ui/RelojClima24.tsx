import { memo, type ReactNode } from 'react';
import type { PuntoHora24 } from '../../utils/dashboardExtra';
import { VIENTO_VENTANA_MS, PROB_LLUVIA_CUENTA_PCT } from '../../utils/dashboardExtra';
import type { VistaClima, UmbralesVistas } from '../../utils/climaVistas';
import { UMBRALES_RESPALDO } from '../../utils/climaVistas';

const W = 192, H = 64, SLOT = W / 24, BASE = 50;
const T_TOP = 6, T_ALTO = 30;
/** Alto del viewBox por vista: solo la combinada (ETₒ) usa la franja de viento bajo la base; las demás recortan ese hueco. */
const ALTO_BASE = BASE + 2, ALTO_TEMP = H - 4;
const horaLocal = (t: number) => new Date(t).toLocaleTimeString('es-MX', { hour: '2-digit', hour12: false, timeZone: 'America/Chihuahua' });
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

interface Props {
    horas: PuntoHora24[];
    ventanaLibre: number | null;
    /** Vista elegida en la tarjeta; 'eto' (por defecto) es la gráfica combinada original. */
    vista?: VistaClima;
    umbrales?: UmbralesVistas;
    /** Compatibilidad: umbral de aviso de helada / viento sueltos. */
    heladaC?: number;
    vientoAvisoMs?: number;
}

/** Marco común: SVG estirable + puntos HTML (un círculo dentro del SVG estirado saldría ovalado) + ejes + leyenda. */
function Marco({ aria, horas, children, puntos, leyenda, alto = H }: { aria: string; horas: PuntoHora24[]; children: ReactNode; puntos?: ReactNode; leyenda: ReactNode; alto?: number }) {
    const t0 = horas[0].t;
    const x = (t: number) => Math.min(W - SLOT, Math.max(0, Math.round((t - t0) / 3_600_000) * SLOT));
    const medianoche = horas.find((h) => new Date(h.t - 6 * 3_600_000).getUTCHours() === 0)?.t ?? null;
    return (
        <div className="kp-pron kp-rc" role="img" aria-label={aria}>
            <div className="kp-rc-graf">
                <svg viewBox={`0 0 ${W} ${alto}`} preserveAspectRatio="none" aria-hidden="true">
                    {children}
                    {medianoche != null && <line x1={x(medianoche)} x2={x(medianoche)} y1={0} y2={alto} className="kp-rc-medianoche" vectorEffect="non-scaling-stroke" />}
                </svg>
                {puntos}
            </div>
            <div className="kp-pron-ejes kp-rc-ejes" aria-hidden="true">
                <span>ahora</span>
                {medianoche != null && (() => { const pos = ((x(medianoche) + SLOT / 2) / W) * 100; return pos >= 24 && pos <= 76 ? <span className="kp-rc-eje-0h" style={{ left: `${pos}%` }}>0 h</span> : null; })()}
                <span>+24 h</span>
            </div>
            <div className="kp-rc-ley" aria-hidden="true">{leyenda}</div>
        </div>
    );
}

/**
 * Próximas 24 h por VISTA (botones de la tarjeta Clima agro):
 *  · eto    : gráfica combinada (barras de ETₒ con pico, línea de T, lluvia colgando, franja de viento).
 *  · temp   : banda mín–máx ENTRE ESTACIONES + línea promedio + líneas de aviso y crítico de helada.
 *  · lluvia : barras mm/h + línea de probabilidad (0–100 %) con la marca de 60 % ("cuenta").
 *  · viento : barras de viento sostenido en 3 tramos + marca de ráfaga por hora + línea de aviso.
 *  · hr     : banda mín–máx + línea promedio de humedad relativa (modelo, sin corregir) + marca de 90 %.
 * La línea punteada vertical es la medianoche. Cada vista dice su lectura en `aria-label` y en la leyenda visible.
 */
export const RelojClima24 = memo(function RelojClima24({ horas, ventanaLibre, vista = 'eto', umbrales, heladaC, vientoAvisoMs }: Props) {
    if (horas.length === 0) return <div className="kp-pron kp-pron-sd" role="img" aria-label="Próximas 24 horas: sin pronóstico">Pronóstico no disponible</div>;
    const u: UmbralesVistas = umbrales ?? {
        ...UMBRALES_RESPALDO,
        helada: { ...UMBRALES_RESPALDO.helada, aviso: heladaC ?? UMBRALES_RESPALDO.helada.aviso },
        viento: { ...UMBRALES_RESPALDO.viento, aviso: vientoAvisoMs ?? UMBRALES_RESPALDO.viento.aviso },
    };
    const t0 = horas[0].t;
    const x = (t: number) => Math.min(W - SLOT, Math.max(0, Math.round((t - t0) / 3_600_000) * SLOT));
    const cx = (t: number) => x(t) + SLOT / 2;
    const pctX = (t: number) => (cx(t) / W) * 100;
    const pctY = (y: number, alto = H) => (y / alto) * 100;

    // ── TEMPERATURA ──
    if (vista === 'temp') {
        const lo = horas.map((h) => h.tempMinC ?? h.tempC).filter(fin), hi = horas.map((h) => h.tempMaxC ?? h.tempC).filter(fin);
        if (!lo.length) return <div className="kp-pron kp-pron-sd" role="img" aria-label="Temperatura: sin pronóstico">Temperatura S/D</div>;
        const tMin = Math.min(...lo), tMax = Math.max(...hi);
        // La escala incluye el umbral de aviso cuando la mínima se le acerca (≤ 4 °C por encima)
        const yLo = tMin <= u.helada.aviso + 4 ? Math.min(tMin, u.helada.critico) - 1 : tMin - 1;
        const yHi = tMax + 1;
        const y = (v: number) => 4 + (1 - (v - yLo) / (yHi - yLo || 1)) * (H - 10);
        const conT = horas.filter((h) => fin(h.tempC));
        const banda = [...conT.map((h) => `${cx(h.t).toFixed(1)},${y(h.tempMaxC ?? h.tempC!).toFixed(1)}`), ...[...conT].reverse().map((h) => `${cx(h.t).toFixed(1)},${y(h.tempMinC ?? h.tempC!).toFixed(1)}`)].join(' ');
        const linea = conT.map((h) => `${cx(h.t).toFixed(1)},${y(h.tempC!).toFixed(1)}`).join(' ');
        const hMin = horas.find((h) => (h.tempMinC ?? h.tempC) === tMin), hMax = horas.find((h) => (h.tempMaxC ?? h.tempC) === tMax);
        const enEscala = (v: number) => v >= yLo && v <= yHi;
        return (
            <Marco horas={horas} alto={ALTO_TEMP} aria={`Temperatura próximas 24 horas: mínima ${tMin.toFixed(0)} grados${hMin ? ` a las ${horaLocal(hMin.t)}` : ''} (estación más fría), máxima ${tMax.toFixed(0)} grados${hMax ? ` a las ${horaLocal(hMax.t)}` : ''}; aviso de helada ${u.helada.aviso} grados, crítico ${u.helada.critico}.`}
                puntos={<>
                    {hMin && <i className="kp-rc-pt kp-rc-pt-min" style={{ left: `${pctX(hMin.t)}%`, top: `${pctY(y(tMin), ALTO_TEMP)}%` }} aria-hidden="true" />}
                    {hMax && hMax !== hMin && <i className="kp-rc-pt kp-rc-pt-max" style={{ left: `${pctX(hMax.t)}%`, top: `${pctY(y(tMax), ALTO_TEMP)}%` }} aria-hidden="true" />}
                </>}
                leyenda={<>
                    <span><i className="kp-rc-sw kp-rc-sw-temp" />T mín <b>{tMin.toFixed(0)}°</b>{hMin ? <small>{horaLocal(hMin.t)} h</small> : null} · máx <b>{tMax.toFixed(0)}°</b>{hMax ? <small>{horaLocal(hMax.t)} h</small> : null}</span>
                    <span><i className="kp-rc-sw kp-rc-sw-banda" />rango entre estaciones · línea = promedio</span>
                    {enEscala(u.helada.aviso) && <span className="kp-rc-ley-helada"><i className="kp-rc-sw kp-rc-sw-umbral-warn" />aviso helada {u.helada.aviso} °C</span>}
                    {enEscala(u.helada.critico) && <span className="kp-rc-ley-crit"><i className="kp-rc-sw kp-rc-sw-umbral-crit" />crítico {u.helada.critico} °C</span>}
                </>}>
                {enEscala(u.helada.aviso) && <rect x={0} width={W} y={y(u.helada.aviso)} height={Math.max(0, H - 6 - y(u.helada.aviso))} className="kp-rc-helada" />}
                <polygon points={banda} className="kp-rc-banda" />
                {enEscala(u.helada.aviso) && <line x1={0} x2={W} y1={y(u.helada.aviso)} y2={y(u.helada.aviso)} className="kp-rc-umbral-warn" vectorEffect="non-scaling-stroke" />}
                {enEscala(u.helada.critico) && <line x1={0} x2={W} y1={y(u.helada.critico)} y2={y(u.helada.critico)} className="kp-rc-umbral-crit" vectorEffect="non-scaling-stroke" />}
                <polyline points={linea} className="kp-rc-temp" fill="none" vectorEffect="non-scaling-stroke" />
            </Marco>
        );
    }

    // ── LLUVIA ──
    if (vista === 'lluvia') {
        const mmMax = Math.max(1, ...horas.map((h) => h.lluviaMm ?? 0));
        const yP = (p: number) => 4 + (1 - p / 100) * (BASE - 4);
        const prob = horas.filter((h) => fin(h.probPct)).map((h) => `${cx(h.t).toFixed(1)},${yP(h.probPct!).toFixed(1)}`).join(' ');
        const tot = horas.reduce((a, h) => a + (h.lluviaMm ?? 0), 0);
        const pMax = Math.max(0, ...horas.map((h) => h.probPct ?? 0));
        return (
            <Marco horas={horas} alto={ALTO_BASE} aria={`Lluvia próximas 24 horas: ${tot.toFixed(1)} milímetros previstos (promedio de estaciones por hora), probabilidad máxima ${pMax.toFixed(0)} por ciento; la lluvia cuenta para la demanda desde ${PROB_LLUVIA_CUENTA_PCT} por ciento.`}
                leyenda={<>
                    <span><i className="kp-rc-sw kp-rc-sw-lluvia" />mm/h <b>{tot.toFixed(1)} mm</b></span>
                    <span><i className="kp-rc-sw kp-rc-sw-prob" />probabilidad <b>máx. {pMax.toFixed(0)} %</b></span>
                    <span><i className="kp-rc-sw kp-rc-sw-umbral-info" />{PROB_LLUVIA_CUENTA_PCT} % (cuenta)</span>
                </>}>
                {horas.map((h, i) => fin(h.lluviaMm) && h.lluviaMm > 0 && <rect key={`l${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={BASE - (h.lluviaMm / mmMax) * (BASE - 6)} height={(h.lluviaMm / mmMax) * (BASE - 6)} className="kp-rc-lluvia" />)}
                <line x1={0} x2={W} y1={yP(PROB_LLUVIA_CUENTA_PCT)} y2={yP(PROB_LLUVIA_CUENTA_PCT)} className="kp-rc-umbral-info" vectorEffect="non-scaling-stroke" />
                {prob && <polyline points={prob} className="kp-rc-prob" fill="none" vectorEffect="non-scaling-stroke" />}
                <line x1={0} x2={W} y1={BASE} y2={BASE} className="kp-rc-base" vectorEffect="non-scaling-stroke" />
            </Marco>
        );
    }

    // ── VIENTO ──
    if (vista === 'viento') {
        const vals = horas.flatMap((h) => [h.vientoMs, h.rafagaMs]).filter(fin);
        if (!vals.length) return <div className="kp-pron kp-pron-sd" role="img" aria-label="Viento: sin pronóstico">Viento S/D</div>;
        const top = Math.max(u.viento.aviso + 2, ...vals) * 1.08;
        const y = (v: number) => BASE - (v / top) * (BASE - 4);
        const vMax = Math.max(0, ...horas.map((h) => h.vientoMs ?? 0)), rMax = Math.max(0, ...horas.map((h) => h.rafagaMs ?? 0));
        return (
            <Marco horas={horas} alto={ALTO_BASE} aria={`Viento próximas 24 horas: sostenido máximo ${vMax.toFixed(1)} metros por segundo, ráfaga máxima ${rMax ? rMax.toFixed(1) : 'sin dato'}; aviso de viento ${u.viento.aviso}, ráfaga ${u.rafaga.aviso}${ventanaLibre != null ? `; ${ventanaLibre} horas aptas para aspersión` : ''}.`}
                puntos={<>{horas.map((h, i) => fin(h.rafagaMs) && <i key={`r${i}`} className={`kp-rc-raf ${h.rafagaMs >= u.rafaga.aviso ? 'kp-rc-raf-warn' : ''}`} style={{ left: `${pctX(h.t)}%`, top: `${pctY(y(Math.min(h.rafagaMs, top)), ALTO_BASE)}%` }} aria-hidden="true" />)}</>}
                leyenda={<>
                    <span><i className="kp-rc-sw kp-rc-sw-v" />sostenido ≤{VIENTO_VENTANA_MS} · ≤{u.viento.aviso} · &gt;{u.viento.aviso} m/s</span>
                    <span><i className="kp-rc-sw kp-rc-sw-raf" />ráfaga {rMax ? <b>máx. {rMax.toFixed(1)}</b> : 'S/D'}</span>
                    <span><i className="kp-rc-sw kp-rc-sw-umbral-warn" />aviso {u.viento.aviso} m/s</span>
                </>}>
                {horas.map((h, i) => fin(h.vientoMs) && <rect key={`v${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={y(h.vientoMs)} height={BASE - y(h.vientoMs)}
                    className={h.vientoMs <= VIENTO_VENTANA_MS ? 'kp-rc-v-ok' : h.vientoMs <= u.viento.aviso ? 'kp-rc-v-warn' : 'kp-rc-v-crit'} />)}
                <line x1={0} x2={W} y1={y(u.viento.aviso)} y2={y(u.viento.aviso)} className="kp-rc-umbral-warn" vectorEffect="non-scaling-stroke" />
                <line x1={0} x2={W} y1={BASE} y2={BASE} className="kp-rc-base" vectorEffect="non-scaling-stroke" />
            </Marco>
        );
    }

    // ── HUMEDAD RELATIVA ──
    if (vista === 'hr') {
        const conH = horas.filter((h) => fin(h.humPct));
        if (!conH.length) return <div className="kp-pron kp-pron-sd" role="img" aria-label="Humedad: sin pronóstico">Humedad S/D</div>;
        const y = (p: number) => 4 + (1 - p / 100) * (BASE - 4);
        const banda = [...conH.map((h) => `${cx(h.t).toFixed(1)},${y(h.humMaxPct ?? h.humPct!).toFixed(1)}`), ...[...conH].reverse().map((h) => `${cx(h.t).toFixed(1)},${y(h.humMinPct ?? h.humPct!).toFixed(1)}`)].join(' ');
        const linea = conH.map((h) => `${cx(h.t).toFixed(1)},${y(h.humPct!).toFixed(1)}`).join(' ');
        const hmin = Math.min(...conH.map((h) => h.humMinPct ?? h.humPct!)), hmax = Math.max(...conH.map((h) => h.humMaxPct ?? h.humPct!));
        return (
            <Marco horas={horas} alto={ALTO_BASE} aria={`Humedad relativa próximas 24 horas (modelo, sin corregir): de ${hmin.toFixed(0)} a ${hmax.toFixed(0)} por ciento.`}
                leyenda={<>
                    <span><i className="kp-rc-sw kp-rc-sw-hr" />HR <b>{hmin.toFixed(0)}–{hmax.toFixed(0)} %</b></span>
                    <span><i className="kp-rc-sw kp-rc-sw-banda" />rango entre estaciones</span>
                    <span><i className="kp-rc-sw kp-rc-sw-umbral-info" />90 % (rocío)</span>
                </>}>
                <polygon points={banda} className="kp-rc-banda kp-rc-banda-hr" />
                <line x1={0} x2={W} y1={y(90)} y2={y(90)} className="kp-rc-umbral-info" vectorEffect="non-scaling-stroke" />
                <polyline points={linea} className="kp-rc-hr" fill="none" vectorEffect="non-scaling-stroke" />
                <line x1={0} x2={W} y1={BASE} y2={BASE} className="kp-rc-base" vectorEffect="non-scaling-stroke" />
            </Marco>
        );
    }

    // ── ETₒ (gráfica combinada original) ──
    const vAviso = u.viento.aviso;
    const etos = horas.map((h) => h.etoMm).filter(fin);
    const maxEto = Math.max(0.3, ...etos);
    const pico = horas.reduce<PuntoHora24 | null>((a, h) => (h.etoMm != null && (!a || h.etoMm > (a.etoMm ?? 0)) ? h : a), null);
    const conT = horas.filter((h) => h.tempC != null);
    const temps = conT.map((h) => h.tempC as number);
    const tMin = temps.length ? Math.min(...temps) : 0, tMax = temps.length ? Math.max(...temps) : 1;
    const hMin = conT.find((h) => h.tempC === tMin) ?? null, hMax = conT.find((h) => h.tempC === tMax) ?? null;
    const yT = (v: number) => T_TOP + (1 - (v - tMin) / (tMax - tMin || 1)) * T_ALTO;
    const linea = conT.map((h) => `${cx(h.t).toFixed(1)},${yT(h.tempC as number).toFixed(1)}`).join(' ');
    const vientos = horas.map((h) => h.vientoMs).filter(fin);
    const vMax = vientos.length ? Math.max(...vientos) : null;
    const lluviaTot = horas.reduce((a, h) => a + (h.lluviaMm ?? 0), 0);
    const heladaAviso = u.helada.aviso;
    const hayHelada = temps.length > 0 && tMin <= heladaAviso;
    const yHelada = hayHelada ? (heladaAviso >= tMax ? T_TOP : yT(heladaAviso)) : null;
    return (
        <Marco horas={horas} aria={`Próximas 24 horas (previsión): ETo ${etos.length ? etos.reduce((a, b) => a + b, 0).toFixed(1) : 'sin dato'} milímetros${pico?.etoMm != null ? `, pico ${pico.etoMm.toFixed(2)} milímetros por hora a las ${horaLocal(pico.t)}` : ''}, lluvia ${lluviaTot.toFixed(1)} milímetros, temperatura de ${tMin.toFixed(0)} a ${tMax.toFixed(0)} grados${hayHelada ? `, por debajo del aviso de helada de ${heladaAviso} grados` : ''}, viento máximo ${vMax == null ? 'sin dato' : `${vMax.toFixed(1)} metros por segundo`}${ventanaLibre != null ? `, ${ventanaLibre} horas con viento apto para aspersión` : ''}`}
            puntos={<>
                {hMin && <i className="kp-rc-pt kp-rc-pt-min" style={{ left: `${pctX(hMin.t)}%`, top: `${pctY(yT(tMin))}%` }} aria-hidden="true" />}
                {hMax && hMax !== hMin && <i className="kp-rc-pt kp-rc-pt-max" style={{ left: `${pctX(hMax.t)}%`, top: `${pctY(yT(tMax))}%` }} aria-hidden="true" />}
            </>}
            leyenda={<>
                <span><i className="kp-rc-sw kp-rc-sw-eto" />ETₒ{pico?.etoMm != null ? <b> pico {pico.etoMm.toFixed(2)} mm/h {horaLocal(pico.t)} h</b> : null}</span>
                {temps.length > 0 && <span><i className="kp-rc-sw kp-rc-sw-temp" />T <b>{tMin.toFixed(0)}°</b>{hMin ? <small>{horaLocal(hMin.t)} h</small> : null} – <b>{tMax.toFixed(0)}°</b>{hMax ? <small>{horaLocal(hMax.t)} h</small> : null}</span>}
                {hayHelada && <span className="kp-rc-ley-helada"><i className="kp-rc-sw kp-rc-sw-helada" />bajo {heladaAviso} °C (aviso helada)</span>}
                {vientos.length > 0 && <span><i className="kp-rc-sw kp-rc-sw-v" />Viento ≤{VIENTO_VENTANA_MS} · ≤{vAviso} · &gt;{vAviso} m/s</span>}
                {lluviaTot > 0 && <span><i className="kp-rc-sw kp-rc-sw-lluvia" />Lluvia <b>{lluviaTot.toFixed(1)} mm</b></span>}
            </>}>
            {yHelada != null && <rect x={0} width={W} y={yHelada} height={T_TOP + T_ALTO - yHelada + 1} className="kp-rc-helada" />}
            {horas.map((h, i) => h.etoMm != null && h.etoMm > 0 && <rect key={`e${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={BASE - (h.etoMm / maxEto) * 30} height={(h.etoMm / maxEto) * 30} className={h === pico ? 'kp-rc-eto kp-rc-eto-pico' : 'kp-rc-eto'} />)}
            {horas.map((h, i) => h.lluviaMm != null && h.lluviaMm > 0 && <rect key={`l${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={0} height={Math.min(h.lluviaMm, 2) / 2 * 22 + 2} className="kp-rc-lluvia" />)}
            {linea && <polyline points={linea} className="kp-rc-temp" fill="none" vectorEffect="non-scaling-stroke" />}
            <line x1={0} x2={W} y1={BASE} y2={BASE} className="kp-rc-base" vectorEffect="non-scaling-stroke" />
            {horas.map((h, i) => h.vientoMs != null && <rect key={`v${i}`} x={x(h.t) + 0.6} width={SLOT - 1.2} y={H - (2 + Math.min(h.vientoMs, 10) * 0.9)} height={2 + Math.min(h.vientoMs, 10) * 0.9}
                className={h.vientoMs <= VIENTO_VENTANA_MS ? 'kp-rc-v-ok' : h.vientoMs <= vAviso ? 'kp-rc-v-warn' : 'kp-rc-v-crit'} />)}
        </Marco>
    );
});
