import { useMemo } from 'react';
import { simplificarDP } from '../../../conservacion/geo/trazo';
import { proyectar } from '../../../utils/infografiaPerfilSvg';
import { contornoDeTramo, cuerdaDeTramo, ejeConTrazo, ejeGeoDeVista, etiquetaPk, polilineaEje, type EjeVista, type ModeloCanal, type TramoVista } from './ubicacionModelo';

type Punto = readonly [number, number];

/** Simplifica una polilínea [lat, lon] a `tolM` metros (Douglas-Peucker) y la devuelve [lat, lon]. */
const simplifica = (pts: readonly Punto[], tolM: number): Punto[] =>
    pts.length < 3 ? [...pts] : simplificarDP(pts.map((p) => [p[1], p[0]] as const), tolM).map((p) => [p[1], p[0]] as const);

const TOL_M = 60;
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

interface Props {
    /** Modelo ya construido con el trazo real (o sin él: entonces el contorno es la cuerda y se rotula así). */
    modelo: ModeloCanal;
    eje: EjeVista;
    tramo: TramoVista;
    ancho?: number;
    alto?: number;
}

/**
 * El contorno del canal en miniatura con el tramo elegido: lo recorrido desde K-0+000 hasta el tramo se TRAZA (la única animación de la
 * ficha, solo al abrir un tramo; anulada con reduced-motion) y el tramo queda marcado en violeta. Sin trazo real (el auxiliar) el tramo
 * va como cuerda punteada y el dibujo lo dice: nunca se inventa un contorno.
 */
export function ContornoRecorrido({ modelo, eje, tramo, ancho = 168, alto = 104 }: Props) {
    const dibujo = useMemo(() => {
        const geo = ejeGeoDeVista(modelo, eje);
        const real = ejeConTrazo(geo) && geo?.trazo !== undefined;
        const completo: Punto[] = real && geo?.trazo ? simplifica(geo.trazo.puntos.map((p) => [p[1], p[0]] as const), TOL_M) : polilineaEje(geo);
        const c = contornoDeTramo(geo, tramo.mIni, tramo.mFin);
        const seg: Punto[] = c.calidad !== 'cuerda' && c.linea.length > 1 ? simplifica(c.linea, TOL_M / 3) : cuerdaDeTramo(geo, tramo.mIni, tramo.mFin);
        const antes: Punto[] = real && tramo.mIni > 0 ? simplifica(contornoDeTramo(geo, 0, tramo.mIni).linea, TOL_M) : [];
        // Un eje sin trazo propio (el auxiliar) se ve sobre el canal principal, de fondo y sin animar, para situarlo.
        const principal = modelo.geo?.principal ?? null;
        const contexto: Punto[] = !real && principal !== null && principal !== geo && ejeConTrazo(principal) && principal.trazo !== undefined ? simplifica(principal.trazo.puntos.map((p) => [p[1], p[0]] as const), TOL_M) : [];
        const todos = [...contexto, ...completo, ...seg];
        if (todos.length < 2 || seg.length < 2) return null;
        let lat0 = Infinity, lat1 = -Infinity, lon0 = Infinity, lon1 = -Infinity;
        for (const [la, lo] of todos) { lat0 = Math.min(lat0, la); lat1 = Math.max(lat1, la); lon0 = Math.min(lon0, lo); lon1 = Math.max(lon1, lo); }
        const pr = proyectar({ lat0, lat1, lon0, lon1 }, ancho, alto, 8);
        const d = (pts: readonly Punto[]): string => pts.map((p, i) => { const [x, y] = pr([p[0], p[1]]); return `${i === 0 ? 'M' : 'L'}${f1(x)} ${f1(y)}`; }).join('');
        const fin = pr([seg[seg.length - 1]![0], seg[seg.length - 1]![1]]);
        return { real: real && c.calidad !== 'cuerda', contexto: contexto.length > 1 ? d(contexto) : null, completo: d(completo), antes: antes.length > 1 ? d(antes) : null, seg: d(seg), fin };
    }, [modelo, eje, tramo.mIni, tramo.mFin, ancho, alto]);

    if (dibujo === null) return null;
    const rotulo = `${etiquetaPk(tramo.pkInicial)} → ${etiquetaPk(tramo.pkFinal)}`;
    return (
        <figure className="cf-contorno" data-estado={tramo.estado}>
            <svg viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} role="img"
                aria-label={dibujo.real ? `Contorno del canal con el tramo ${rotulo} marcado` : `Cuerda entre vértices del inventario con el tramo ${rotulo} marcado: sin contorno real`}>
                {dibujo.contexto !== null && <path className="cf-canal cf-canal-fondo" d={dibujo.contexto} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
                <path className="cf-canal" d={dibujo.completo} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {dibujo.antes !== null && <path className="cf-traza" d={dibujo.antes} pathLength={1} fill="none" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
                <path className="cf-tramo-halo" d={dibujo.seg} fill="none" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
                <path className={`cf-tramo${dibujo.real ? '' : ' cf-tramo-cuerda'}`} d={dibujo.seg} pathLength={1} fill="none" strokeWidth="5" strokeLinecap={dibujo.real ? 'round' : 'butt'} strokeLinejoin="round" />
                <circle className="cf-fin" cx={dibujo.fin[0]} cy={dibujo.fin[1]} r="5" strokeWidth="2.5" />
            </svg>
            <figcaption>{dibujo.real ? 'Contorno real del canal' : 'Sin contorno real: cuerda entre vértices'}</figcaption>
        </figure>
    );
}
