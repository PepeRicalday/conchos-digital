import { memo, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { CanalKpiModelo, EscalaCanalKpi } from '../../utils/perfilCanal';
import { textoEdad } from '../../utils/hidroEstaciones';
import { DataTable } from './base';

interface Geo { W: number; H: number; x0: number; xw: number; top: number; base: number; r: number; flechas: boolean }
const GEO = {
    mini: { W: 72, H: 48, x0: 5, xw: 62, top: 6, base: 44, r: 2.4, flechas: false } as Geo,
    med: { W: 240, H: 64, x0: 8, xw: 224, top: 6, base: 58, r: 3.4, flechas: true } as Geo,
    full: { W: 260, H: 120, x0: 10, xw: 240, top: 10, base: 112, r: 4.4, flechas: true } as Geo,
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Escala vertical: 0 % (fondo) a 110 % del máximo operativo (arriba). */
const PCT_TOPE = 1.1;

/**
 * Nivel como fracción del máximo operativo. Antes se dibujaba la posición dentro de la banda mín–máx y todo lo que
 * quedaba por debajo del mínimo se recortaba al piso: en VACIADO las 14 escalas caían en una línea plana. Ahora
 * la altura es proporcional al nivel real (0 % = canal seco, 100 % = máximo operativo).
 * El arrastre de medianoche (no es medición) se dibuja solo como una marca horizontal con su nivel.
 */
function pctDe(e: EscalaCanalKpi): number | null {
    if (e.pctMax != null) return e.pctMax;
    if (e.nivelM == null && e.nivelArrastreM != null && e.rangoMax != null && e.rangoMax > 0) return e.nivelArrastreM / e.rangoMax;
    return null;
}

function textoEscala(e: EscalaCanalKpi): string {
    const km = Number.isInteger(e.km) ? String(e.km) : e.km.toFixed(1);
    if (e.origen === 'sin_dato') return `K-${km}: sin lectura`;
    if (e.origen === 'arrastre') return `K-${km}: solo arrastre de medianoche (no es medición)`;
    const pct = e.pctMax != null ? ` (${Math.round(e.pctMax * 100)} % del máx.)` : '';
    const d = e.deltaCm != null ? ` · ${e.deltaCm > 0 ? '+' : ''}${e.deltaCm} cm en ${e.deltaHoras} h` : '';
    return `K-${km}: ${e.nivelM!.toFixed(2)} m${pct}${d} · ${e.vigente ? 'medición vigente' : `medición ${textoEdad(e.edadMin)}`}${e.referencia ? ' · escala de referencia' : ''}`;
}

function Marca({ e, g, cx, cy }: { e: EscalaCanalKpi; g: Geo; cx: number; cy: number }) {
    const r = g.r;
    const titulo = <title>{textoEscala(e)}</title>;
    if (e.origen === 'sin_dato') return <path d={`M ${cx} ${g.base - r * 1.4} v ${r * 1.4}`} className="kp-pc-sd" data-estado="sd" data-km={e.km}>{titulo}</path>;
    if (e.origen === 'arrastre') return <path d={`M ${cx - r} ${cy} h ${r * 2}`} className="kp-pc-sd" data-estado="arrastre" data-km={e.km}>{titulo}</path>;
    if (e.referencia) return <polygon points={`${cx},${cy - r * 1.3} ${cx + r * 1.3},${cy} ${cx},${cy + r * 1.3} ${cx - r * 1.3},${cy}`} className={e.vigente ? 'kp-pc-ref' : 'kp-pc-ref kp-pc-ref-viejo'} data-estado={e.estado} data-km={e.km}>{titulo}</polygon>;
    if (!e.vigente) return <circle cx={cx} cy={cy} r={r} className="kp-pc-viejo" data-estado={e.estado} data-km={e.km}>{titulo}</circle>;
    if (e.estado === 'alto') return <polygon points={`${cx},${cy - r * 1.3} ${cx + r * 1.2},${cy + r} ${cx - r * 1.2},${cy + r}`} className="kp-pc-crit" data-estado="alto" data-km={e.km}>{titulo}</polygon>;
    if (e.estado === 'bajo') return <polygon points={`${cx},${cy + r * 1.3} ${cx + r * 1.2},${cy - r} ${cx - r * 1.2},${cy - r}`} className="kp-pc-crit" data-estado="bajo" data-km={e.km}>{titulo}</polygon>;
    if (e.estado === 'vaciado') return <circle cx={cx} cy={cy} r={r} className="kp-pc-vaciado" data-estado="vaciado" data-km={e.km}>{titulo}</circle>;
    return <circle cx={cx} cy={cy} r={r} className="kp-pc-ok" data-estado={e.estado} data-km={e.km}>{titulo}</circle>;
}

/**
 * Ancho del viewBox ajustado a la proporción real de la celda: el eje km ocupa todo el ancho (alineado con
 * K-0 · K-52 · K-104) sin estirar los marcadores. Solo geometría de dibujo, no cambia ningún dato.
 */
function useGeoAjustada(base: Geo): [RefObject<SVGSVGElement | null>, Geo] {
    const ref = useRef<SVGSVGElement>(null);
    const [W, setW] = useState(base.W);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(([en]) => {
            const { width, height } = en.contentRect;
            if (width <= 0 || height <= 0) return;
            const w = Math.round(clamp((base.H * width) / height, base.W * 0.6, base.W * 3));
            setW((prev) => (Math.abs(prev - w) > 2 ? w : prev));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [base]);
    return [ref, W === base.W ? base : { ...base, W, xw: W - 2 * base.x0 }];
}

function Perfil({ modelo, g: gBase, clase, idPatron }: { modelo: CanalKpiModelo; g: Geo; clase: string; idPatron: string }) {
    const [ref, g] = useGeoAjustada(gBase);
    const x = (km: number) => g.x0 + (clamp(km, 0, 104) / 104) * g.xw;
    const y = (p: number) => g.base - g.r - (clamp(p, 0, PCT_TOPE) / PCT_TOPE) * (g.base - g.r - g.top);
    const sinVigentes = modelo.conMedicion === 0;
    // Banda operativa típica (mediana de mín/máx de las escalas) como franja tenue de referencia.
    const fr = modelo.escalas
        .filter((e) => e.rangoMin != null && e.rangoMax != null && e.rangoMax > 0)
        .map((e) => (e.rangoMin as number) / (e.rangoMax as number))
        .sort((a, b) => a - b);
    const minTipico = fr.length ? fr[Math.floor(fr.length / 2)] : null;
    // Línea solo entre mediciones vigentes consecutivas de CONTROL (las referencias no se unen; los huecos tampoco).
    const trazos: string[] = [];
    let abierto = '';
    for (const e of modelo.escalas) {
        if (e.referencia) continue;
        const p = e.pctMax;
        if (e.vigente && p != null) abierto += `${abierto ? ' L' : 'M'} ${x(e.km).toFixed(1)} ${y(p).toFixed(1)}`;
        else if (abierto) { trazos.push(abierto); abierto = ''; }
    }
    if (abierto) trazos.push(abierto);
    return (
        <svg ref={ref} className={clase} viewBox={`0 0 ${g.W} ${g.H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
            <defs><pattern id={idPatron} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="kp-pc-hacha" /></pattern></defs>
            {sinVigentes && <rect x={g.x0 - 2} y={2} width={g.xw + 4} height={g.base - 2} rx={3} fill={`url(#${idPatron})`} opacity={0.55} />}
            {minTipico != null && <rect x={g.x0 - 2} y={y(1)} width={g.xw + 4} height={Math.max(1, y(minTipico) - y(1))} className={modelo.vaciado ? 'kp-pc-banda kp-pc-banda-off' : 'kp-pc-banda'} />}
            <line x1={g.x0 - 2} x2={g.x0 + g.xw + 2} y1={y(1)} y2={y(1)} className="kp-pc-max" />
            <line x1={g.x0 - 2} x2={g.x0 + g.xw + 2} y1={g.base} y2={g.base} className="kp-pc-base" />
            {trazos.map((d, i) => <path key={i} d={d} className="kp-pc-linea" fill="none" />)}
            {modelo.escalas.map((e) => { const p = pctDe(e); return <Marca key={e.id} e={e} g={g} cx={x(e.km)} cy={p == null ? g.base - g.r : y(p)} />; })}
            {g.flechas && modelo.escalas.map((e) => {
                if (!e.vigente || e.deltaCm == null || Math.abs(e.deltaCm) < 2 || e.pctMax == null) return null;
                const cx = x(e.km), cy = y(e.pctMax), r = g.r, baja = e.deltaCm < 0;
                const yb = baja ? cy + r * 1.9 : cy - r * 1.9;
                const pts = baja
                    ? `${cx - r * 0.8},${yb} ${cx + r * 0.8},${yb} ${cx},${yb + r * 1.1}`
                    : `${cx - r * 0.8},${yb} ${cx + r * 0.8},${yb} ${cx},${yb - r * 1.1}`;
                return <polygon key={`f${e.id}`} className={baja ? 'kp-pc-baja' : 'kp-pc-sube'} points={pts} />;
            })}
        </svg>
    );
}

/**
 * Mini-perfil del canal: las 14 escalas por km, con la ALTURA proporcional al nivel como % de su máximo operativo.
 * Forma + relleno + color dicen el estado (nunca solo el color): círculo lleno = vigente, hueco = > 4 h,
 * rombo = escala de referencia, marca horizontal = solo arrastre. Flechas = variación frente a la lectura de campo previa (≥ 2 cm, ventana 6 h – 7 d).
 * Tabla alternativa para lectores de pantalla.
 */
export const PerfilCanalMini = memo(function PerfilCanalMini({ modelo }: { modelo: CanalKpiModelo }) {
    const uid = useId().replace(/:/g, '');
    const resumen = `Perfil del canal: nivel de cada escala como porcentaje de su máximo operativo. ${modelo.conMedicionControl} de ${modelo.totalControl} escalas de control con medición vigente${modelo.ultimaMedicionMs != null ? '' : ', ninguna medición de campo reciente'}.${modelo.vaciado ? ` Canal en vaciado: ${modelo.descendiendo} en descenso.` : ''}`;
    return (
        <div className={modelo.vaciado ? 'kp-pc kp-pc-vac' : 'kp-pc'} role="group" aria-label={resumen}>
            <Perfil modelo={modelo} g={GEO.mini} clase="kp-pc-svg kp-pc-mini" idPatron={`${uid}m`} />
            <Perfil modelo={modelo} g={GEO.med} clase="kp-pc-svg kp-pc-med" idPatron={`${uid}d`} />
            <Perfil modelo={modelo} g={GEO.full} clase="kp-pc-svg kp-pc-full" idPatron={`${uid}f`} />
            <div className="kp-pron-ejes kp-pc-ejes" aria-hidden="true"><span>K-0</span><span>K-52</span><span>K-104</span></div>
            <div className="kp-pc-ley" aria-hidden="true">
                <span><i className="kp-pc-sw kp-pc-sw-ok" />vigente</span>
                <span><i className="kp-pc-sw kp-pc-sw-viejo" />&gt; 4 h</span>
                <span><i className="kp-pc-sw kp-pc-sw-ref" />referencia</span>
                <span><i className="kp-pc-sw kp-pc-sw-max" />100 % máx. operativo</span>
                <span className="kp-pc-ley-delta"><i className="kp-pc-sw kp-pc-sw-delta" />vs lectura previa</span>
            </div>
            <DataTable
                propia claseContenedor="kp-sr-tabla" caption="Escalas del canal: nivel de la última medición de campo"
                clave={(e) => String(e.id)} filas={modelo.escalas}
                columnas={[
                    { id: 'esc', titulo: 'Escala', encabezadoFila: true, render: (e) => e.nombre },
                    { id: 'km', titulo: 'Km', render: (e) => e.km },
                    { id: 'estado', titulo: 'Estado', render: (e) => `${e.origen === 'sin_dato' ? 'sin dato' : e.origen === 'arrastre' ? 'solo arrastre' : e.vigente ? 'vigente' : 'vieja'}${e.referencia ? ' (referencia)' : ''}` },
                    { id: 'nivel', titulo: 'Nivel', render: (e) => e.nivelM != null ? `${e.nivelM.toFixed(2)} m` : 'S/D' },
                    { id: 'pct', titulo: '% del máx.', render: (e) => e.pctMax != null ? `${Math.round(e.pctMax * 100)} %` : 'S/D' },
                    { id: 'delta', titulo: 'Δ vs lectura previa', render: (e) => e.deltaCm != null ? `${e.deltaCm > 0 ? '+' : ''}${e.deltaCm} cm (${e.deltaHoras} h)` : 'S/D' },
                    { id: 'edad', titulo: 'Edad', render: (e) => e.edadMin != null ? textoEdad(e.edadMin) : 'S/D' },
                ]}
            />
        </div>
    );
});
