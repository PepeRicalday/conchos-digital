import { normalizarUnidad, type Unidad } from '../num/unidades'
import type { FuenteUnidad, PerfilUnidadesHoja } from '../libro/perfil'
import type { VistaLibro } from '../libro/vista'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const F_UNIDADES: FuenteNorma = { documento: 'Anexo 3', seccion: 'Anexo 1 de PO-2 (conceptos concentrados y sus unidades); Manual 2026 §5.8' }

// ---------------------------------------------------------------------------------------------
// Referencias dentro de una fórmula
// ---------------------------------------------------------------------------------------------

export interface RefFormula {
  /** null = misma hoja que la fórmula. */
  readonly hoja: string | null
  readonly col: string
  readonly fila: number
  /** Si la referencia es un rango de más de una celda no se resuelve una unidad. */
  readonly esRango: boolean
}

const RE_LOCAL = /\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/g
const escapar = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Referencias de una fórmula, calificadas con hoja o locales. Los nombres de hoja se toman de las
 * hojas reales del libro: la extracción no entrecomilla los nombres con guion (SEG-3, PO-2) y un
 * guion se confundiría con el operador menos. Las referencias a libros externos se cuentan y se omiten.
 */
export function referenciasDeFormula(texto: string, hojasDelLibro: readonly string[]): { refs: RefFormula[]; externas: number } {
  const refs: RefFormula[] = []
  let externas = 0
  const nombres = [...hojasDelLibro].sort((a, b) => b.length - a.length).map(escapar)
  const hojaAlt = ['<<[^>]+>>', String.raw`\[\d+\][^!'\s,;()+*/^&=<>]+`, "'[^']+'", ...nombres].join('|')
  const celda = String.raw`\$?([A-Za-z]{1,3})\$?(\d+)`
  const reQual = new RegExp(`(?<![A-Za-z0-9_])(${hojaAlt})!${celda}(?::${celda})?`, 'g')
  const sinCalificadas = texto.replace(reQual, (_m, hoja: string, c1: string, f1: string, c2?: string, f2?: string) => {
    if (hoja.startsWith('<<') || hoja.startsWith('[')) { externas++; return ' ' }
    const nombre = hoja.startsWith("'") ? hoja.slice(1, -1) : hoja
    if (nombre.startsWith('[')) { externas++; return ' ' }
    refs.push({ hoja: nombre, col: c1.toUpperCase(), fila: Number(f1), esRango: c2 !== undefined && (c2.toUpperCase() !== c1.toUpperCase() || f2 !== f1) })
    return ' '
  })
  for (const m of sinCalificadas.matchAll(RE_LOCAL)) {
    const [, c1, f1, c2, f2] = m
    if (!c1 || !f1) continue
    refs.push({ hoja: null, col: c1.toUpperCase(), fila: Number(f1), esRango: c2 !== undefined && (c2.toUpperCase() !== c1.toUpperCase() || f2 !== f1) })
  }
  return { refs, externas }
}

/** Solo sumas y restas obligan a que las unidades coincidan: en productos y cocientes se combinan por diseño. */
export function esSumaOResta(texto: string): boolean {
  return !/[*/]/.test(texto)
}

// ---------------------------------------------------------------------------------------------
// Unidad de una celda según el perfil de la hoja
// ---------------------------------------------------------------------------------------------

export type ResolucionUnidad =
  | { readonly ok: true; readonly unidad: Unidad }
  | { readonly ok: false; readonly motivo: 'omitida' | 'hoja_sin_perfil' | 'sin_etiqueta' | 'etiqueta_desconocida'; readonly etiqueta?: string }

export function resolverUnidad(vista: VistaLibro, perfiles: readonly PerfilUnidadesHoja[], hoja: string, col: string, fila: number): ResolucionUnidad {
  const p = perfiles.find((x) => x.hoja === hoja)
  if (!p) return { ok: false, motivo: 'hoja_sin_perfil' }
  const fuente: FuenteUnidad = p.columnas[col] ?? p.porDefecto
  if (fuente === 'omitir') return { ok: false, motivo: 'omitida' }
  if ('fija' in fuente) {
    const u = normalizarUnidad(fuente.fija)
    return u ? { ok: true, unidad: u } : { ok: false, motivo: 'etiqueta_desconocida', etiqueta: fuente.fija }
  }
  const etiqueta = vista.texto(hoja, `${fuente.deColumna}${fila}`)
  if (etiqueta === null || etiqueta.trim() === '') return { ok: false, motivo: 'sin_etiqueta' }
  const u = normalizarUnidad(etiqueta)
  return u ? { ok: true, unidad: u } : { ok: false, motivo: 'etiqueta_desconocida', etiqueta }
}

// ---------------------------------------------------------------------------------------------
// DYP-007
// ---------------------------------------------------------------------------------------------

export const reglaDyp007: Regla = {
  meta: {
    id: 'DYP-007', clase: 'DIAGNÓSTICOS Y PROGRAMA', titulo: 'Unidades por concepto: paramétrica y de trabajo',
    severidadBase: 'alta', fuentes: [F_UNIDADES], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('DYP-007', 'Requiere el libro y un perfil de formato con la fuente de unidades')]
    const libro = ctx.libro
    const { hojas, hojasAEvaluar } = ctx.perfil.unidades
    const hallazgos: Hallazgo[] = []
    const sinUnidad = new Set<string>()
    let identificadas = 0
    let revisadas = 0
    let omitidasProducto = 0
    let sinResolver = 0
    let externas = 0

    for (const nombre of hojasAEvaluar) {
      const h = libro.hoja(nombre)
      if (!h) continue
      for (const [celda, f] of h.formulas) {
        if (f.kind === 'desconocida') continue
        const m = /^([A-Z]+)(\d+)$/.exec(celda)
        if (!m || !m[1] || !m[2]) continue
        const col = m[1], fila = Number(m[2])
        const destino = resolverUnidad(libro, hojas, nombre, col, fila)
        if (!destino.ok) continue // columnas que no llevan una cantidad: no son parte de la comprobación
        identificadas++
        if (!esSumaOResta(f.texto)) { omitidasProducto++; continue }
        const { refs, externas: ext } = referenciasDeFormula(f.texto, libro.hojas())
        externas += ext
        let evaluada = false
        for (const r of refs) {
          const hojaRef = r.hoja ?? nombre
          if (hojaRef === nombre && r.col === col && r.fila === fila) continue
          if (r.esRango) { sinResolver++; continue }
          const origen = resolverUnidad(libro, hojas, hojaRef, r.col, r.fila)
          if (!origen.ok) {
            if (origen.motivo !== 'omitida') { sinResolver++; sinUnidad.add(`${hojaRef}!${r.col}${r.fila}`) }
            continue
          }
          evaluada = true
          if (origen.unidad === destino.unidad) continue
          const celdaRef = libro.numero(hojaRef, `${r.col}${r.fila}`)
          const conImpacto = celdaRef.ok && !celdaRef.valor.isZero()
          const concepto = textoDeCelda(libro.texto(nombre, `A${fila}`) ?? libro.texto(nombre, `A${fila - 1}`) ?? libro.texto(nombre, `A${fila - 2}`))
          hallazgos.push(crearHallazgo(ctx, {
            id: `DYP-007:${nombre}!${celda}:${hojaRef}!${r.col}${r.fila}`, reglaId: 'DYP-007',
            titulo: `Se suma ${origen.unidad} dentro de una celda en ${destino.unidad}${concepto ? ` (${concepto})` : ''}`,
            detalle: conImpacto
              ? `La fórmula incluye ${hojaRef}!${r.col}${r.fila} (${origen.unidad}) y su resultado queda en ${destino.unidad}: impacto vigente, el valor referenciado no es cero. No se equipara 35 km con 35 m³ ni se resta km de m³ aunque el precio numérico coincida.`
              : `La fórmula incluye ${hojaRef}!${r.col}${r.fila} (${origen.unidad}) en una celda en ${destino.unidad}. Hoy el valor referenciado está en blanco o en cero: es una fragilidad latente, no un efecto vigente.`,
            origen: 'pacot', severidad: conImpacto ? 'alta' : 'media', referencias: [`${nombre}!${celda}`, `${hojaRef}!${r.col}${r.fila}`], fuentes: [F_UNIDADES],
            esperado: destino.unidad, observado: origen.unidad,
            ...(celdaRef.ok ? { diferencia: celdaRef.valor.toFixed() } : {}),
            dimensiones: { dimensiones: 'abierta', referencias: 'abierta', aritmetica: 'abierta' }, estadoEvidencia: 'verificada_en_archivo',
            limites: ['Precisar actividad, unidad del PU y generador antes de restar o trasladar; la corrección no se hace dentro del libro.'],
          }))
        }
        if (evaluada) revisadas++
      }
    }
    const pendientes: string[] = []
    if (omitidasProducto > 0) pendientes.push(`${omitidasProducto} fórmulas con producto o cociente: el análisis dimensional de operaciones combinadas queda pendiente`)
    if (sinResolver > 0) pendientes.push(`${sinResolver} referencias sin unidad resoluble (rango, hoja sin perfil o etiqueta de unidad ausente o desconocida)${sinUnidad.size ? `, p. ej. ${[...sinUnidad].slice(0, 3).join(', ')}` : ''}`)
    if (externas > 0) pendientes.push(`${externas} referencias a libros externos: sin unidad comprobable`)
    return [crearResultado({ reglaId: 'DYP-007', hallazgos, revisados: revisadas, identificados: identificadas, unidad: 'fórmulas de cantidad', pendientes })]
  },
}

