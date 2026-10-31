import { memo, useId } from 'react';
import type { CanalKpiModelo, EscalaCanalKpi } from '../../utils/perfilCanal';
import { textoEdad } from '../../utils/hidroEstaciones';

interface Geo { W: number; H: number; x0: number; xw: number; top: number; bot: number; base: number; r: number }
const GEO = {
    mini: { W: 72, H: 48, x0: 5, xw: 62, top: 15, bot: 28, base: 44, r: 2.4 } as Geo,
    med: { W: 240, H: 64, x0: 8, xw: 224, top: 18, bot: 40, base: 58, r: 3.6 } as Geo,
    full: { W: 260, H: 120, x0: 10, xw: 240, top: 38, bot: 80, base: 112, r: 4.8 } as Geo,
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Posición relativa del nivel dentro del rango operativo de su escala (el arrastre se dibuja con su propio nivel). */
function uDe(e: EscalaCanalKpi): number | null {
    if (e.u != null) return e.u;
    if (e.nivelArrastreM != null && e.rangoMin != null && e.rangoMax != null && e.rangoMax > e.rangoMin) return (e.nivelArrastreM - e.rangoMin) / (e.rangoMax - e.rangoMin);
    return null;
}

function textoEscala(e: EscalaCanalKpi): string {
    const km = Number.isInteger(e.km) ? String(e.km) : e.km.toFixed(1);
    if (e.origen === 'sin_dato') return `K-${km}: sin lectura`;
    if (e.origen === 'arrastre') return `K-${km}: solo arrastre (no es medición)`;
    return `K-${km}: ${e.nivelM!.toFixed(2)} m · ${e.vigente ? 'medición vigente' : `medición ${textoEdad(e.edadMin)}`}${e.referencia ? ' · referencia' : ''}`;
}

function Marca({ e, g, cx, cy }: { e: EscalaCanalKpi; g: Geo; cx: number; cy: number }) {
    const r = g.r;
    const titulo = <title>{textoEscala(e)}</title>;
    const comun = { 'data-estado': e.estado, 'data-km': e.km, className: '' as string };
    if (e.origen === 'sin_dato') return <path d={`M ${cx} ${g.base - r * 1.4} v ${r * 1.4}`} className="kp-pc-sd" data-estado="sd" data-km={e.km}>{titulo}</path>;
    if (!e.vigente) return <circle cx={cx} cy={cy} r={r} className="kp-pc-viejo" data-estado={e.estado} data-km={e.km}>{titulo}</circle>;
    if (e.referencia) return <polygon points={`${cx},${cy - r * 1.3} ${cx + r * 1.3},${cy} ${cx},${cy + r * 1.3} ${cx - r * 1.3},${cy}`} className="kp-pc-ref" {...{ 'data-estado': comun['data-estado'], 'data-km': comun['data-km'] }}>{titulo}</polygon>;
    if (e.estado === 'alto') return <polygon points={`${cx},${cy - r * 1.3} ${cx + r * 1.2},${cy + r} ${cx - r * 1.2},${cy + r}`} className="kp-pc-crit" data-estado="alto" data-km={e.km}>{titulo}</polygon>;
    if (e.estado === 'bajo') return <polygon points={`${cx},${cy + r * 1.3} ${cx + r * 1.2},${cy - r} ${cx - r * 1.2},${cy - r}`} className="kp-pc-crit" data-estado="bajo" data-km={e.km}>{titulo}</polygon>;
    if (e.estado === 'vaciado') return <circle cx={cx} cy={cy} r={r} className="kp-pc-vaciado" data-estado="vaciado" data-km={e.km}>{titulo}</circle>;
    return <circle cx={cx} cy={cy} r={r} className="kp-pc-ok" data-estado={e.estado} data-km={e.km}>{titulo}</circle>;
}

function Perfil({ modelo, g, clase, idPatron }: { modelo: CanalKpiModelo; g: Geo; clase: string; idPatron: string }) {
    const x = (km: number) => g.x0 + (clamp(km, 0, 104) / 104) * g.xw;
    const y = (u: number) => clamp(g.bot - u * (g.bot - g.top), 3, g.base - g.r - 1);
    const sinVigentes = modelo.conMedicion === 0;
    // Línea solo entre mediciones vigentes consecutivas (los huecos no se unen)
    const trazos: string[] = [];
    let abierto = '';
    for (const e of modelo.escalas) {
        const u = uDe(e);
        if (e.vigente && u != null) abierto += `${abierto ? ' L' : 'M'} ${x(e.km).toFixed(1)} ${y(u).toFixed(1)}`;
        else if (abierto) { trazos.push(abierto); abierto = ''; }
    }
    if (abierto) trazos.push(abierto);
    return (
        <svg className={clase} viewBox={`0 0 ${g.W} ${g.H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
            <defs><pattern id={idPatron} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="kp-pc-hacha" /></pattern></defs>
            {sinVigentes && <rect x={g.x0 - 2} y={2} width={g.xw + 4} height={g.base - 2} rx={3} fill={`url(#${idPatron})`} opacity={0.55} />}
            <rect x={g.x0 - 2} y={g.top} width={g.xw + 4} height={g.bot - g.top} className={modelo.vaciado ? 'kp-pc-banda kp-pc-banda-off' : 'kp-pc-banda'} />
            <line x1={g.x0 - 2} x2={g.x0 + g.xw + 2} y1={g.base} y2={g.base} className="kp-pc-base" />
            {trazos.map((d, i) => <path key={i} d={d} className="kp-pc-linea" fill="none" />)}
            {modelo.escalas.map((e) => { const u = uDe(e); return <Marca key={e.id} e={e} g={g} cx={x(e.km)} cy={u == null ? g.base - g.r : y(u)} />; })}
        </svg>
    );
}

/**
 * Mini-perfil del canal: las 14 escalas por km, cada una en su posición RELATIVA al rango operativo (la banda es siempre la misma
 * franja). Forma + relleno + color dicen el estado (nunca solo el color). Texto solo en HTML; tabla alternativa para lectores.
 */
export const PerfilCanalMini = memo(function PerfilCanalMini({ modelo }: { modelo: CanalKpiModelo }) {
    const uid = useId().replace(/:/g, '');
    const resumen = `Perfil del canal: ${modelo.conMedicion} de ${modelo.total} escalas con medición vigente${modelo.ultimaMedicionMs != null ? '' : ', ninguna medición de campo reciente'}.${modelo.vaciado ? ' Canal en vaciado: el rango operativo no aplica.' : ''} Posición relativa al rango operativo de cada escala.`;
    return (
        <div className="kp-pc" role="group" aria-label={resumen}>
            <Perfil modelo={modelo} g={GEO.mini} clase="kp-pc-svg kp-pc-mini" idPatron={`${uid}m`} />
            <Perfil modelo={modelo} g={GEO.med} clase="kp-pc-svg kp-pc-med" idPatron={`${uid}d`} />
            <Perfil modelo={modelo} g={GEO.full} clase="kp-pc-svg kp-pc-full" idPatron={`${uid}f`} />
            <div className="kp-pron-ejes kp-pc-ejes" aria-hidden="true"><span>K-0</span><span>K-52</span><span>K-104</span></div>
            <div className="kp-sr-tabla"><table>
                <caption>Escalas del canal: nivel de la última medición de campo</caption>
                <thead><tr><th scope="col">Escala</th><th scope="col">Km</th><th scope="col">Estado</th><th scope="col">Nivel</th><th scope="col">Edad</th></tr></thead>
                <tbody>
                    {modelo.escalas.map((e) => (
                        <tr key={e.id}><th scope="row">{e.nombre}</th><td>{e.km}</td><td>{e.origen === 'sin_dato' ? 'sin dato' : e.origen === 'arrastre' ? 'solo arrastre' : e.vigente ? 'vigente' : 'vieja'}{e.referencia ? ' (referencia)' : ''}</td>
                            <td>{e.nivelM != null ? `${e.nivelM.toFixed(2)} m` : 'S/D'}</td><td>{e.edadMin != null ? textoEdad(e.edadMin) : 'S/D'}</td></tr>
                    ))}
                </tbody>
            </table></div>
        </div>
    );
});
