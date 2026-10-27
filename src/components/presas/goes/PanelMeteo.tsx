import {
    ORDEN_ESTACIONES, STALE_GOES_MIN, colorEstacion, estadoEnlace, fmt, horaLocal, puntoCardinal, radiacionConfiable, tieneMeteo,
    type EstacionHidro, type MensajeHidro, type PuntoHidro,
} from '../../../utils/hidroEstaciones';
import type { SeriesPorEstacion } from '../../../hooks/useHidroEstaciones';
import Spark from './Spark';
import { instanteEnlace } from './enlaceGoes';

interface Props {
    estaciones: EstacionHidro[];
    mensajes: MensajeHidro[];
    clima: SeriesPorEstacion | null;
    cargando: boolean;
    error: string | null;
    ahora: number;
}

/** Lectura vigente: la última, si no tiene más de 90 min (el viento de Madero falta ~1/3 del tiempo: hueco = S/D). */
const MAX_EDAD_MIN = 90;
function vigente(s: PuntoHidro[] | undefined, ahora: number): PuntoHidro | null {
    const p = s?.length ? s[s.length - 1] : null;
    return p && ahora && (ahora - p.t) / 60000 <= MAX_EDAD_MIN ? p : null;
}

/** Rosa de 16 sectores con la frecuencia de la dirección del viento en las últimas 24 h y aguja con la dirección vigente. */
function Rosa({ dirs, actual }: { dirs: PuntoHidro[]; actual: number | null }) {
    const cont = new Array(16).fill(0) as number[];
    for (const d of dirs) cont[Math.round((((d.v % 360) + 360) % 360) / 22.5) % 16]++;
    const max = Math.max(1, ...cont);
    const C = 50;
    const R = 38;
    const petalo = (i: number, f: number) => {
        const r = 8 + (R - 8) * f;
        const a0 = ((i * 22.5 - 9) * Math.PI) / 180;
        const a1 = ((i * 22.5 + 9) * Math.PI) / 180;
        const p = (a: number, rr: number) => `${(C + rr * Math.sin(a)).toFixed(1)},${(C - rr * Math.cos(a)).toFixed(1)}`;
        return `M${p(a0, 8)} L${p(a0, r)} A${r},${r} 0 0 1 ${p(a1, r)} L${p(a1, 8)} Z`;
    };
    return (
        <svg className="goes-rosa" viewBox="0 0 100 100" role="img" aria-label={actual == null ? 'Rosa de vientos, dirección actual S/D' : `Rosa de vientos, dirección actual del ${puntoCardinal(actual)}`}>
            <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(148,163,184,.22)" strokeDasharray="2 3" />
            {cont.map((c, i) => c > 0 && <path key={i} d={petalo(i, c / max)} fill="rgba(56,189,248,.38)" stroke="rgba(56,189,248,.8)" strokeWidth="0.6" />)}
            {actual != null && <line x1={C} y1={C} x2={C + (R + 4) * Math.sin((actual * Math.PI) / 180)} y2={C - (R + 4) * Math.cos((actual * Math.PI) / 180)} stroke="#e8eef6" strokeWidth="2.2" strokeLinecap="round" />}
            <circle cx={C} cy={C} r="2.6" fill="#e8eef6" />
            {['N', 'E', 'S', 'O'].map((l, i) => <text key={l} x={C + 46 * Math.sin((i * Math.PI) / 2)} y={C - 46 * Math.cos((i * Math.PI) / 2) + 3.5} textAnchor="middle" fontSize="9" fill="#8396ad">{l}</text>)}
        </svg>
    );
}

export default function PanelMeteo({ estaciones, mensajes, clima, cargando, error, ahora }: Props) {
    if (error) return <div className="goes-vacio" role="alert"><strong>No se pudo cargar la meteorología.</strong><span>{error}</span></div>;
    if (cargando || !clima) return <div className="goes-skeleton goes-skeleton--alta" aria-busy="true" />;

    const lista = ORDEN_ESTACIONES.filter(tieneMeteo).map(id => estaciones.find(e => e.id === id)).filter((e): e is EstacionHidro => !!e);
    const desde = ahora - 24 * 3600000;

    return (
        <div className="goes-meteo">
            {lista.map(e => {
                const s = clima[e.id] ?? {};
                const enlace = estadoEnlace(instanteEnlace(e, mensajes), ahora);
                const apagada = enlace.clave === 'sin_transmision' || enlace.clave === 'sd';
                const get = (v: keyof typeof s) => (apagada ? null : vigente(s[v], ahora));
                const t = get('temp_c');
                const hr = get('hr_pct');
                const pr = get('presion_hpa');
                const vi = get('viento_ms');
                const di = get('viento_dir_deg');
                const rad = radiacionConfiable(e.id) ? get('rad_wm2') : null;
                const color = colorEstacion(e.id);
                const dirs24 = (s.viento_dir_deg ?? []).filter(p => p.t >= desde);
                return (
                    <section key={e.id} className="goes-meteo-est" style={{ ['--acc' as string]: color }} aria-label={`Meteorología de ${e.nombre}`}>
                        <header>
                            <h4>{e.nombre}</h4>
                            <span className="goes-dcp">{apagada ? `Sin transmisión · último ${horaLocal(instanteEnlace(e, mensajes))}` : `Lectura de las ${horaLocal(t?.t ?? vi?.t ?? null)}`}</span>
                        </header>
                        <div className="goes-meteo-cuerpo">
                            <Rosa dirs={apagada ? [] : dirs24} actual={di ? di.v : null} />
                            <dl className="goes-meteo-datos">
                                <div><dt>Temperatura</dt><dd>{t ? fmt(t.v, 0) : 'S/D'}<small>°C</small></dd></div>
                                <div><dt>Humedad relativa</dt><dd>{hr ? fmt(hr.v, 0) : 'S/D'}<small>%</small></dd></div>
                                <div><dt>Viento</dt><dd>{vi ? fmt(vi.v, 1) : 'S/D'}<small>m/s</small></dd><dd className="goes-meteo-sub">{di ? `del ${puntoCardinal(di.v)} · ${fmt(di.v, 0)}°` : 'Dirección S/D'}</dd></div>
                                <div><dt>Presión</dt><dd>{pr ? fmt(pr.v, 1) : 'S/D'}<small>hPa</small></dd></div>
                                {radiacionConfiable(e.id)
                                    ? <div><dt>Radiación</dt><dd>{rad ? fmt(rad.v, 0) : 'S/D'}<small>W/m²</small></dd></div>
                                    : <div><dt>Radiación</dt><dd className="goes-meteo-sub">No se muestra: el canal de esta estación no es confiable.</dd></div>}
                            </dl>
                        </div>
                        <div className="goes-meteo-sparks">
                            <div><span className="goes-k">Temperatura 24 h</span><Spark serie={apagada ? [] : s.temp_c ?? []} color={color} desdeMs={desde} hastaMs={ahora || desde + 1} etiqueta={`Temperatura de ${e.nombre}`} huecoMs={STALE_GOES_MIN * 60000 / 2} /></div>
                            <div><span className="goes-k">Viento 24 h</span><Spark serie={apagada ? [] : s.viento_ms ?? []} color={color} desdeMs={desde} hastaMs={ahora || desde + 1} etiqueta={`Viento de ${e.nombre}`} huecoMs={STALE_GOES_MIN * 60000 / 2} /></div>
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
