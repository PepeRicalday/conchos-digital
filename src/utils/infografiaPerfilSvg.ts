/**
 * infografiaPerfilSvg — el perfil del canal y el mini-mapa de la infografía de «Comprobación por tramo», como cadenas SVG con colores
 * hex (sin variables CSS, sin JS, sin teselas). Usa la MISMA geometría que la pantalla (`calcularPerfil` de geo/perfilSvg) y el mismo
 * modelo (`ubicacionModelo`), de modo que cuenta los mismos tramos y las mismas obras. Todo texto va escapado y mide al menos 12 px.
 */
import { calcularPerfil } from '../conservacion/geo/perfilSvg';
import type { EjeCanal } from '../conservacion/geo/kmALatLng';
import { simplificarDP } from '../conservacion/geo/trazo';
import {
    CLAVES_FAMILIA, agruparEnCarril, avisosContornoTramo, contornoDeTramo, cuerdaDeTramo, ejeConTrazo, ejeGeoDeVista, etiquetaPk, insigniaContorno, obrasEnTramo, polilineaEje, rotuloFamilia,
    type ClaveFamilia, type EjeVista, type InsigniaContorno, type ModeloCanal, type ObraVista, type TramoVista,
} from '../components/conservacion/derivacion/ubicacionModelo';
import { simboloClave } from '../components/conservacion/derivacion/simbolos';

const esc = (s: unknown): string =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString();

export const COLORES_ESTADO = {
    atipico: { relleno: '#FCEBC4', borde: '#D9920B', tinta: '#7A4A00' },
    cuadra: { relleno: '#DDF3E6', borde: '#1B8A5A', tinta: '#0B5A3A' },
    no_evaluable: { relleno: '#E6E9EC', borde: '#6B7785', tinta: '#3F4852' },
} as const;
const TINTA = '#1B2733', TINTA_SUAVE = '#4A5663', LINEA = '#C9BFA0', VIOLETA = '#6D3FC0';
const FUENTE = "font-family=\"'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif\"";

const simboloAnidado = (clave: ClaveFamilia, x: number, y: number, lado: number, punteado = false): string =>
    `<g transform="translate(${f1(x - lado / 2)} ${f1(y - lado / 2)})">${simboloClave(clave, { tamano: lado, grosor: 2, punteado })}</g>`;

/* ───────────────────────── perfil lineal ───────────────────────── */

const MARGEN_IZQ = 40, MARGEN_DER = 14, BANDA_H = 34, CARRIL_H = 25, LADO = 17, SEPARACION = 20

export interface OpcionesPerfil { readonly ancho: number; readonly fila?: number | null; readonly id: string }

/** Perfil de UN eje (todo su recorrido): bandas por estado con borde, trama y glifo, eje de cadenamiento y un carril por familia. */
export function perfilEjeSvg(eje: EjeVista, modelo: ModeloCanal, o: OpcionesPerfil): string {
    const total = eje.totalKm
    const carriles = CLAVES_FAMILIA.filter((c) => eje.obras.some((x) => x.clave === c))
    const perfil = calcularPerfil({
        ancho: o.ancho, ventana: [0, total], margenIzq: MARGEN_IZQ, margenDer: MARGEN_DER, ticksObjetivo: Math.max(3, Math.floor((o.ancho - MARGEN_IZQ - MARGEN_DER) / 110)),
        tramos: eje.tramos.map((t) => ({ id: String(t.fila), kmIni: t.kmIni, kmFin: t.kmFin })),
        estructuras: eje.obras.map((x) => ({ id: x.id, km: x.km ?? 0, familia: x.familia })),
    })
    if (!perfil.valido) return ''
    const anclaKm = eje.ramal === 'principal' && modelo.anclaPk !== null ? Number(modelo.anclaPk.split('+')[0]) + Number(modelo.anclaPk.split('+')[1]) / 1000 : null
    const yB = anclaKm !== null ? 24 : 8
    const yEje = yB + BANDA_H + 6
    const yCar = yEje + 32
    const alto = yCar + carriles.length * CARRIL_H + 6
    const porFila = new Map(eje.tramos.map((t) => [String(t.fila), t]))
    const porId = new Map(eje.obras.map((x) => [x.id, x]))
    const p: string[] = []
    p.push(`<defs><pattern id="${o.id}-t" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${COLORES_ESTADO.atipico.borde}" stroke-width="2" opacity="0.55"/></pattern></defs>`)
    p.push(`<rect x="${f1(perfil.x0)}" y="${yB}" width="${f1(perfil.x1 - perfil.x0)}" height="${BANDA_H}" rx="4" fill="#F1ECDB"/>`)
    for (const tk of perfil.ticks) p.push(`<line x1="${f1(tk.x)}" x2="${f1(tk.x)}" y1="${yB}" y2="${yEje}" stroke="${LINEA}" stroke-width="1" opacity="0.6"/>`)
    for (const g of perfil.tramos) {
        const t = porFila.get(g.id)
        if (!t) continue
        const c = COLORES_ESTADO[t.estado]
        const w = Math.max(g.ancho - 1, 2)
        const x = g.x0 + 0.5
        const dash = t.estado === 'no_evaluable' ? ' stroke-dasharray="4 3"' : ''
        const marcado = o.fila === t.fila
        p.push(`<g data-tramo="${t.fila}"><rect x="${f1(x)}" y="${yB}" width="${f1(w)}" height="${BANDA_H}" rx="3" fill="${c.relleno}"/>`
            + (t.estado === 'atipico' ? `<rect x="${f1(x)}" y="${yB}" width="${f1(w)}" height="${BANDA_H}" rx="3" fill="url(#${o.id}-t)"/>` : '')
            + `<rect x="${f1(x)}" y="${yB}" width="${f1(w)}" height="${BANDA_H}" rx="3" fill="none" stroke="${c.borde}" stroke-width="${t.estado === 'atipico' ? 2 : 1.5}"${dash}/>`
            + (t.estado === 'atipico' && w >= 12 ? `<text x="${f1(x + w / 2)}" y="${yB + 23}" text-anchor="middle" font-size="16" font-weight="900" fill="${c.tinta}" ${FUENTE}>!</text>` : '')
            + (marcado ? `<rect x="${f1(x - 2)}" y="${yB - 2}" width="${f1(w + 4)}" height="${BANDA_H + 4}" rx="5" fill="none" stroke="${VIOLETA}" stroke-width="3.5"/>` : '')
            + '</g>')
    }
    p.push(`<line x1="${f1(perfil.x0)}" x2="${f1(perfil.x1)}" y1="${yEje}" y2="${yEje}" stroke="${TINTA}" stroke-width="1.5"/>`)
    for (const tk of perfil.ticks) {
        const ancla = tk.x < perfil.x0 + 34 ? 'start' : tk.x > perfil.x1 - 34 ? 'end' : 'middle'
        p.push(`<line x1="${f1(tk.x)}" x2="${f1(tk.x)}" y1="${yEje}" y2="${yEje + 6}" stroke="${TINTA}" stroke-width="1.5"/>`
            + `<text x="${f1(tk.x)}" y="${yEje + 21}" text-anchor="${ancla}" font-size="12" fill="${TINTA_SUAVE}" ${FUENTE}>${esc(tk.etiqueta)}</text>`)
    }
    if (anclaKm !== null && modelo.anclaPk !== null) {
        const xa = perfil.xDeKm(anclaKm)
        const fin = xa > perfil.x1 - 230
        p.push(`<line x1="${f1(xa)}" x2="${f1(xa)}" y1="6" y2="${yEje}" stroke="${VIOLETA}" stroke-width="1.5" stroke-dasharray="3 3"/>`
            + `<text x="${f1(fin ? xa - 5 : xa + 5)}" y="17" text-anchor="${fin ? 'end' : 'start'}" font-size="12" fill="${VIOLETA}" ${FUENTE}>Aquí nace el ramal auxiliar · ${esc(etiquetaPk(modelo.anclaPk))}</text>`)
    }
    carriles.forEach((c, i) => {
        const y = yCar + i * CARRIL_H + CARRIL_H / 2
        p.push(`<line x1="${f1(perfil.x0)}" x2="${f1(perfil.x1)}" y1="${f1(y)}" y2="${f1(y)}" stroke="${LINEA}" stroke-width="1" opacity="0.7"/>${simboloAnidado(c, MARGEN_IZQ / 2 - 6, y, LADO)}`)
    })
    const grupos = agruparEnCarril(perfil.estructuras.map((s) => {
        const clave: ClaveFamilia = porId.get(s.id)?.clave ?? 'ninguna'
        return { id: s.id, x: s.x, carril: carriles.indexOf(clave), clave }
    }).filter((s) => s.carril >= 0), SEPARACION)
    for (const g of grupos) {
        const y = yCar + g.carril * CARRIL_H + CARRIL_H / 2
        const unica = g.ids.length === 1
        const est = unica && porId.get(g.ids[0] ?? '')?.estado === 'estimada'
        p.push(`<g data-obras="${g.ids.length}">${simboloAnidado(g.clave, g.x, y, LADO, est)}`
            + (unica ? '' : `<rect x="${f1(g.x + 4)}" y="${f1(y - 16)}" width="${g.ids.length > 9 ? 25 : 18}" height="16" rx="8" fill="${TINTA}"/>`
                + `<text x="${f1(g.x + 4 + (g.ids.length > 9 ? 12.5 : 9))}" y="${f1(y - 4)}" text-anchor="middle" font-size="12" font-weight="700" fill="#FFFFFF" ${FUENTE}>${g.ids.length}</text>`)
            + '</g>')
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.ancho} ${alto}" width="${o.ancho}" height="${alto}" style="display:block;width:100%;height:auto" role="img" aria-label="${esc(`Perfil de ${eje.titulo}`)}">${p.join('')}</svg>`
}

/** Claves de familia con obras en los ejes del modelo y su conteo (la leyenda de la infografía). */
export function leyendaFamiliasHtml(modelo: ModeloCanal, conteo?: Readonly<Record<ClaveFamilia, number>>): string {
    const c = conteo ?? modelo.conteoCanal
    const items = CLAVES_FAMILIA.filter((k) => c[k] > 0).map((k) =>
        `<li><span class="sim">${simboloClave(k, { tamano: 20, grosor: 2 })}</span><span class="fn">${esc(rotuloFamilia(k))}</span><b>${c[k]}</b></li>`)
    return items.length === 0 ? '' : `<ul class="fam">${items.join('')}</ul>`
}

/** Todos los perfiles del modelo (principal y ramales), cada uno con su título y su cuenta, listos para el HTML de la infografía. */
export function perfilesHtml(modelo: ModeloCanal, o: { ancho: number; fila?: number | null; prefijo: string }): string {
    const bloques = modelo.ejes.map((eje, i) => {
        const svg = perfilEjeSvg(eje, modelo, { ancho: o.ancho, fila: o.fila ?? null, id: `${o.prefijo}${i}` })
        if (svg === '') return ''
        const nObras = eje.obras.length
        const sub = [`${eje.tramos.length} ${eje.tramos.length === 1 ? 'tramo' : 'tramos'}`,
            eje.conEstructuras ? `${nObras} ${nObras === 1 ? 'obra' : 'obras'} del inventario` : '',
            eje.nacePk !== null ? `cadenamiento propio; nace en ${etiquetaPk(eje.nacePk)} del canal principal` : ''].filter((x) => x !== '').join(' · ')
        const sin = eje.fueraDeTramos.length + eje.sinPK.length
        return `<div class="pf-eje" data-eje="${i}" data-n-tramos="${eje.tramos.length}" data-n-obras="${nObras}" data-n-sin-lugar="${sin}"><div class="pf-cab"><b>${esc(eje.titulo)}</b><span>${esc(sub)}</span></div>${svg}`
            + (sin > 0 ? `<div class="pf-nota">${sin} ${sin === 1 ? 'obra queda' : 'obras quedan'} sin lugar en el perfil (${eje.fueraDeTramos.length} fuera de los tramos, ${eje.sinPK.length} sin cadenamiento); se listan en la app.</div>` : '')
            + '</div>'
    })
    return bloques.join('')
}

/* ───────────────────────── mini-mapa estático ───────────────────────── */

type PuntoLL = readonly [number, number]
interface Caja { lat0: number; lat1: number; lon0: number; lon1: number }

function cajaDe(puntos: readonly PuntoLL[]): Caja | null {
    if (puntos.length === 0) return null
    let lat0 = Infinity, lat1 = -Infinity, lon0 = Infinity, lon1 = -Infinity
    for (const [la, lo] of puntos) { lat0 = Math.min(lat0, la); lat1 = Math.max(lat1, la); lon0 = Math.min(lon0, lo); lon1 = Math.max(lon1, lo) }
    return { lat0, lat1, lon0, lon1 }
}

/**
 * Proyección equirrectangular con corrección cos(lat): x ∝ (lon − lon0)·cos(latMedia), y ∝ (lat1 − lat). Escala común a los dos ejes (no
 * deforma), norte arriba, centrada en el recuadro. Sin teselas: el dibujo es el trazo real del canal y los vértices del inventario.
 */
export function proyectar(caja: Caja, ancho: number, alto: number, pad: number): (p: PuntoLL) => [number, number] {
    const cosL = Math.cos(((caja.lat0 + caja.lat1) / 2) * Math.PI / 180)
    const dx = Math.max((caja.lon1 - caja.lon0) * cosL, 1e-9), dy = Math.max(caja.lat1 - caja.lat0, 1e-9)
    const s = Math.min((ancho - 2 * pad) / dx, (alto - 2 * pad) / dy)
    const ox = (ancho - dx * s) / 2, oy = (alto - dy * s) / 2
    return ([la, lo]) => [ox + (lo - caja.lon0) * cosL * s, oy + (caja.lat1 - la) * s]
}

const camino = (pts: readonly PuntoLL[], pr: (p: PuntoLL) => [number, number]): string => pts.map((p, i) => { const [x, y] = pr(p); return `${i === 0 ? 'M' : 'L'}${f1(x)} ${f1(y)}` }).join('')

function ejeGeo(modelo: ModeloCanal, eje: EjeVista): EjeCanal | null { return ejeGeoDeVista(modelo, eje) }

/** Alto reservado abajo del mapa para el pie de dos líneas (honestidad: qué es el dibujo). */
const PIE = 34
/** Tolerancias de simplificación (m): el canal completo a 50 m (~145 puntos), un tramo a 10 m. */
const TOL_CANAL_M = 50, TOL_TRAMO_M = 10

const aLatLon = (pts: ReadonlyArray<readonly [number, number]>): Array<[number, number]> => pts.map((p) => [p[1], p[0]] as [number, number])
/** Simplifica una polilínea [lat, lon] (Douglas-Peucker en metros). */
const simplificaLL = (pts: readonly PuntoLL[], tolM: number): Array<[number, number]> => aLatLon(simplificarDP(pts.map((p) => [p[1], p[0]] as const), tolM))

/** El trazo del eje simplificado, [lat, lon]; null si el eje no tiene contorno real. */
function trazoSimplificado(eje: EjeCanal | null, tolM: number): Array<[number, number]> | null {
    return eje !== null && ejeConTrazo(eje) && eje.trazo !== undefined ? aLatLon(simplificarDP(eje.trazo.puntos, tolM)) : null
}

function pieMapa(w: number, h: number, l1: string, l2: string): string {
    return `<text x="${f1(w / 2)}" y="${h - 20}" text-anchor="middle" font-size="12" fill="${TINTA_SUAVE}" ${FUENTE}>${esc(l1)}</text>`
        + `<text x="${f1(w / 2)}" y="${h - 6}" text-anchor="middle" font-size="12" fill="${TINTA_SUAVE}" ${FUENTE}>${esc(l2)}</text>`
}

/**
 * Mini-mapa del canal completo: el trazo real del canal (DP 50 m, ≈145 puntos, incrustado como <path>: el PNG no tiene red) con cada tramo
 * en el color de su estado y, si se pide, un tramo destacado. Los ejes sin trazo (el auxiliar) van como cuerda entre vértices.
 */
export function miniMapaCanalSvg(modelo: ModeloCanal, o: { ancho: number; alto: number; fila?: number | null }): string {
    const lineas = modelo.ejes.map((e) => {
        const g = ejeGeo(modelo, e)
        return { eje: e, geo: g, pts: trazoSimplificado(g, TOL_CANAL_M) ?? polilineaEje(g) }
    }).filter((x) => x.pts.length > 1)
    const caja = cajaDe(lineas.flatMap((x) => x.pts))
    if (caja === null) return ''
    const pr = proyectar(caja, o.ancho, o.alto - PIE, 14)
    const p: string[] = []
    // Un eje con trazo se dibuja una sola vez aunque varios ejes del modelo caigan sobre él.
    const vistos = new Set<EjeCanal>()
    for (const { geo, pts } of lineas) {
        if (geo !== null) { if (vistos.has(geo)) continue; vistos.add(geo) }
        p.push(`<path d="${camino(pts, pr)}" fill="none" stroke="#B9AE8C" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${geo !== null && !ejeConTrazo(geo) ? ' stroke-dasharray="2 4"' : ''}/>`)
    }
    // Los tramos se agrupan por estado (un <path> por estado, con un subtrazado por tramo): mantiene el SVG pequeño.
    let marcado = ''
    const porEstado: Record<'atipico' | 'cuadra' | 'no_evaluable', { d: string; n: number }> = { atipico: { d: '', n: 0 }, cuadra: { d: '', n: 0 }, no_evaluable: { d: '', n: 0 } }
    for (const { eje, geo } of lineas) {
        for (const t of eje.tramos) {
            const c = contornoDeTramo(geo, t.mIni, t.mFin)
            const seg = c.linea.length >= 2 ? simplificaLL(c.linea, TOL_CANAL_M) : []
            if (seg.length < 2) continue
            if (o.fila === t.fila) { const d = camino(seg, pr); marcado = `<path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${VIOLETA}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`; continue }
            porEstado[t.estado].d += camino(seg, pr)
            porEstado[t.estado].n++
        }
    }
    for (const est of ['cuadra', 'no_evaluable', 'atipico'] as const) {
        const g = porEstado[est]
        if (g.n > 0) p.push(`<path data-estado="${est}" data-n-tramos="${g.n}" d="${g.d}" fill="none" stroke="${COLORES_ESTADO[est].borde}" stroke-width="${est === 'atipico' ? 4 : 2.5}" stroke-linejoin="round"/>`)
    }
    p.push(marcado)
    const nx = o.ancho - 20
    p.push(`<g ${FUENTE} fill="${TINTA_SUAVE}" font-size="12" text-anchor="middle"><path d="M${nx} 20 L${nx - 5} 32 L${nx} 29 L${nx + 5} 32 Z" fill="${TINTA}"/><text x="${nx}" y="46">N</text></g>`)
    const real = modelo.trazo !== null
    p.push(pieMapa(o.ancho, o.alto, real ? 'Contorno real del canal (trazo), simplificado' : 'Cuerda entre vértices del inventario (IO1)', 'ilustrativo · sin imagen de fondo'))
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.ancho} ${o.alto}" width="${o.ancho}" height="${o.alto}" style="display:block;width:100%;height:auto;background:#F7F2E2;border:1px solid #E3DAC0;border-radius:10px" role="img" aria-label="Mini-mapa del canal">${p.join('')}</svg>`
}

export interface ResumenMapaTramo {
    readonly svg: string
    readonly nObras: number
    readonly nEstimadas: number
    readonly nSinUbicar: number
    /** 'real' = el tramo sigue el contorno real; 'cuerda' = recta entre vértices, rotulada «sin contorno real». */
    readonly contorno: 'real' | 'cuerda'
    readonly insignia: InsigniaContorno
    readonly avisos: readonly string[]
}

/** Puntos del trazo (ya simplificado) que caen en la caja o junto a ella, en tramos contiguos (subtrazados `M…L…`). */
function recorteTrazo(pts: readonly PuntoLL[], caja: Caja): PuntoLL[][] {
    const dentro = pts.map((p) => p[0] >= caja.lat0 && p[0] <= caja.lat1 && p[1] >= caja.lon0 && p[1] <= caja.lon1)
    const out: PuntoLL[][] = []
    let cur: PuntoLL[] = []
    pts.forEach((p, i) => {
        const cerca = dentro[i] === true || dentro[i - 1] === true || dentro[i + 1] === true
        if (cerca) cur.push(p)
        else if (cur.length > 0) { out.push(cur); cur = [] }
    })
    if (cur.length > 0) out.push(cur)
    return out.filter((s) => s.length > 1)
}

/**
 * Mini-mapa del tramo: el contorno real del tramo (subtrazo del trazo) —o, sin él, la cuerda punteada rotulada «sin contorno real»—,
 * el canal alrededor como referencia (trazo a 10 m), sus extremos y sus obras con el símbolo de su familia. SVG ≤ 10 KB, sin JS ni fuentes web.
 */
export function miniMapaTramoSvg(modelo: ModeloCanal, eje: EjeVista, t: TramoVista, o: { ancho: number; alto: number }): ResumenMapaTramo | null {
    const geo = ejeGeo(modelo, eje)
    const contorno = contornoDeTramo(geo, t.mIni, t.mFin)
    const insignia = insigniaContorno(contorno, eje.ramal)
    const real = insignia.tipo === 'real'
    const seg = real ? contorno.linea : cuerdaDeTramo(geo, t.mIni, t.mFin)
    if (seg.length < 2) return null
    const obras: ObraVista[] = obrasEnTramo(eje, t)
    const conCoord = obras.filter((x) => x.lat !== null && x.lon !== null)
    const caja0 = cajaDe([...seg, ...conCoord.map((x) => [x.lat as number, x.lon as number] as const)])
    if (caja0 === null) return null
    // Margen del 35 % y una extensión mínima (~1.2 km) para que un tramo corto no llene el recuadro.
    const mLat = Math.max((caja0.lat1 - caja0.lat0) * 0.35, 0.0055), mLon = Math.max((caja0.lon1 - caja0.lon0) * 0.35, 0.0055)
    const caja = { lat0: caja0.lat0 - mLat, lat1: caja0.lat1 + mLat, lon0: caja0.lon0 - mLon, lon1: caja0.lon1 + mLon }
    const pr = proyectar(caja, o.ancho, o.alto - PIE, 18)
    const ctxTrazo = trazoSimplificado(geo, TOL_TRAMO_M)
    const contexto = ctxTrazo !== null ? recorteTrazo(ctxTrazo, caja) : [polilineaEje(geo)]
    const dSeg = camino(seg, pr)
    const p: string[] = []
    p.push(`<defs><clipPath id="mt-rec"><rect x="0" y="0" width="${o.ancho}" height="${o.alto - PIE}"/></clipPath></defs><g clip-path="url(#mt-rec)">`)
    for (const c of contexto) if (c.length > 1) p.push(`<path d="${camino(c, pr)}" fill="none" stroke="#B9AE8C" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`)
    const punteo = real ? '' : ' stroke-dasharray="10 8"'
    p.push(`<path d="${dSeg}" fill="none" stroke="#FFFFFF" stroke-width="13" stroke-linecap="${real ? 'round' : 'butt'}" stroke-linejoin="round"/>`)
    p.push(`<path d="${dSeg}" fill="none" stroke="${VIOLETA}" stroke-width="7" stroke-linecap="${real ? 'round' : 'butt'}" stroke-linejoin="round"${punteo}/>`)
    for (const [i, pt] of [seg[0], seg[seg.length - 1]].entries()) {
        if (!pt) continue
        const [x, y] = pr(pt)
        p.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="7" fill="#FFFFFF" stroke="${VIOLETA}" stroke-width="3"/><text x="${f1(x + (i === 0 ? 16 : 0))}" y="${f1(i === 0 ? y + 4 : y - 12)}" text-anchor="${i === 0 ? 'start' : 'middle'}" font-size="12" font-weight="700" fill="${TINTA}" ${FUENTE}>${i === 0 ? 'Inicio' : 'Fin'}</text>`)
    }
    for (const ob of conCoord) {
        const [x, y] = pr([ob.lat as number, ob.lon as number])
        p.push(`<g data-obra="${esc(ob.id)}">${simboloAnidado(ob.clave, x, y, 22, ob.estado === 'estimada')}</g>`)
    }
    p.push('</g>')
    const nEst = obras.filter((x) => x.estado === 'estimada').length
    p.push(pieMapa(o.ancho, o.alto, real ? 'Contorno real del tramo (trazo) · ilustrativo' : 'Cuerda entre vértices del inventario: sin contorno real', nEst > 0 ? 'símbolo punteado = posición estimada' : 'posición declarada en el inventario · sin imagen de fondo'))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.ancho} ${o.alto}" width="${o.ancho}" height="${o.alto}" style="display:block;width:100%;height:auto;background:#F7F2E2;border:1px solid #E3DAC0;border-radius:10px" role="img" aria-label="Mini-mapa del tramo ${esc(`${etiquetaPk(t.pkInicial)} a ${etiquetaPk(t.pkFinal)}`)}">${p.join('')}</svg>`
    return {
        svg, nObras: obras.length, nEstimadas: nEst, nSinUbicar: obras.filter((x) => x.estado === 'sin_ubicar').length,
        contorno: real ? 'real' : 'cuerda', insignia, avisos: avisosContornoTramo(contorno, t, eje, modelo),
    }
}
