import { normalizarUnidad } from '../num/unidades'
import type { CuadroPresupuesto } from '../libro/perfil'
import type { VistaLibro } from '../libro/vista'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const F_PRES: FuenteNorma = { documento: 'Anexo 3', seccion: '4.4 (PO-2: suma de obra, adquisiciones, indirectos, rehabilitación y suma de importes)' }
const F_VAL: FuenteNorma = { documento: 'references/validaciones.md', seccion: 'Presupuesto; Pruebas de programa que no cubre la conciliación del importe' }

// ---------------------------------------------------------------------------------------------
// Cálculo puro
// ---------------------------------------------------------------------------------------------

export interface TerminosFormula {
  /** Términos separados por + o − fuera de paréntesis. */
  readonly terminos: readonly string[]
  /** true si algún término contiene * o / fuera de paréntesis. */
  readonly hayProductoOCociente: boolean
}

/** Separa una fórmula en términos de nivel superior. `(a+b)/c` es un solo término con cociente. */
export function terminosDeFormula(texto: string): TerminosFormula {
  const t = texto.trim().replace(/^[+=]/, '')
  const terminos: string[] = []
  let actual = ''
  let profundidad = 0
  let producto = false
  for (const ch of t) {
    if (ch === '(') profundidad++
    if (ch === ')') profundidad--
    if (profundidad === 0 && (ch === '+' || ch === '-') && actual.trim() !== '') { terminos.push(actual.trim()); actual = ''; if (ch === '-') actual = '-'; continue }
    if (profundidad === 0 && (ch === '*' || ch === '/')) producto = true
    actual += ch
  }
  if (actual.trim() !== '') terminos.push(actual.trim())
  return { terminos, hayProductoOCociente: producto }
}

const RE_CELDA_SOLA = /^\+?-?\$?([A-Z]{1,3})\$?(\d+)$/

export type FormaTotal =
  | { readonly tipo: 'suma_vertical'; readonly columna: string; readonly filas: readonly number[] }
  | { readonly tipo: 'participacion' }
  | { readonly tipo: 'termino_no_aditivo'; readonly terminos: readonly string[] }
  | { readonly tipo: 'otra' }

/** Clasifica la fórmula de una fila de total: suma de celdas de una columna, participación o con términos no aditivos. */
export function clasificarFormulaTotal(texto: string): FormaTotal {
  const t = terminosDeFormula(texto)
  if (t.terminos.length === 1 && t.hayProductoOCociente && /^\(.*\)\s*\/\s*\$?[A-Z]{1,3}\$?\d+$/.test(t.terminos[0] ?? '')) return { tipo: 'participacion' }
  const celdas = t.terminos.map((x) => RE_CELDA_SOLA.exec(x))
  if (celdas.every((m) => m !== null)) {
    const cols = new Set(celdas.map((m) => m?.[1]))
    if (cols.size === 1) return { tipo: 'suma_vertical', columna: [...cols][0] ?? '', filas: celdas.map((m) => Number(m?.[2])) }
    return { tipo: 'otra' }
  }
  const noAditivos = t.terminos.filter((x) => /[*/]/.test(x.replace(/\([^)]*\)/g, '')))
  return noAditivos.length > 0 ? { tipo: 'termino_no_aditivo', terminos: noAditivos } : { tipo: 'otra' }
}

export interface ComparacionConjuntos {
  readonly omitidas: readonly number[]
  readonly sobrantes: readonly number[]
}

/** Qué filas elegibles no están en la suma y qué filas ajenas sí. Los términos repetidos los revisa TRV-004. */
export function compararConjuntos(referidas: readonly number[], elegibles: readonly number[]): ComparacionConjuntos {
  const r = new Set(referidas)
  const e = new Set(elegibles)
  return { omitidas: elegibles.filter((x) => !r.has(x)), sobrantes: [...r].filter((x) => !e.has(x)).sort((a, b) => a - b) }
}

// ---------------------------------------------------------------------------------------------
// DYP-013
// ---------------------------------------------------------------------------------------------

function filasDeImporte(vista: VistaLibro, c: CuadroPresupuesto): number[] {
  const filas: number[] = []
  for (let r = c.primeraFila; r < c.filaObra; r++) {
    const u = vista.texto(c.hoja, `${c.colUnidad}${r}`)
    if (u !== null && normalizarUnidad(u) === 'MXN') filas.push(r)
  }
  return filas
}

function etiquetaFila(vista: VistaLibro, hoja: string, fila: number): string {
  for (let r = fila; r >= fila - 3 && r > 0; r--) {
    const t = vista.texto(hoja, `A${r}`)
    if (t !== null && t.trim() !== '') return textoDeCelda(t, 40)
  }
  return `fila ${fila}`
}

const valorNoCero = (vista: VistaLibro, hoja: string, col: string, fila: number): boolean => {
  const n = vista.numero(hoja, `${col}${fila}`)
  return n.ok && !n.valor.isZero()
}

interface GrupoColumnas {
  readonly clave: string
  readonly columnas: string[]
  readonly detalle: ComparacionConjuntos
}

export const reglaDyp013: Regla = {
  meta: {
    id: 'DYP-013', clase: 'DIAGNÓSTICOS Y PROGRAMA', titulo: 'Presupuesto, subtotales y complementos',
    severidadBase: 'media', fuentes: [F_PRES, F_VAL], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('DYP-013', 'Requiere el libro y un perfil de formato con los cuadros de presupuesto')]
    const libro = ctx.libro
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificadas = 0
    let revisadas = 0

    for (const c of ctx.perfil.presupuestos) {
      const h = libro.hoja(c.hoja)
      if (!h) { pendientes.push(`${c.hoja}: la hoja no está en el libro`); continue }
      const importes = filasDeImporte(libro, c)
      const esperadoTotal = [c.filaObra, ...c.filasComplementos]
      const grupos = new Map<string, GrupoColumnas>()
      const participacion: string[] = []
      const porAgrupar = (fila: number, elegibles: readonly number[], tag: 'obra' | 'total'): void => {
        for (const [celda, f] of h.formulas) {
          const m = /^([A-Z]+)(\d+)$/.exec(celda)
          if (!m || Number(m[2]) !== fila || f.kind === 'desconocida') continue
          const col = m[1] ?? ''
          identificadas++
          const forma = clasificarFormulaTotal(f.texto)
          if (forma.tipo === 'participacion') { participacion.push(celda); revisadas++; continue }
          if (forma.tipo === 'termino_no_aditivo') {
            revisadas++
            // El impacto depende del numerador (lo que se suma), no del divisor: C105/C102*100 vale cero si C105 está vacía.
            const impacto = forma.terminos.some((t) => [...(t.split(/[*/]/)[0] ?? '').matchAll(/([A-Z]{1,3})(\d+)/g)].some((x) => valorNoCero(libro, c.hoja, x[1] ?? '', Number(x[2]))))
            hallazgos.push(crearHallazgo(ctx, {
              id: `DYP-013:${c.hoja}!${celda}:termino_no_aditivo`, reglaId: 'DYP-013',
              titulo: `Un término del total no es un importe: ${forma.terminos.join(', ')}`,
              detalle: 'Un porcentaje o un cociente sumado dentro de un total en pesos mezcla magnitudes y, por la precedencia de los operadores, no hace lo que el rótulo sugiere. Confirmar si el campo exige monto o porcentaje y conservar la semántica institucional.',
              origen: 'pacot', severidad: impacto ? 'alta' : 'media', referencias: [`${c.hoja}!${celda}`], fuentes: [F_VAL],
              observado: f.texto.trim(), limites: [impacto ? 'Con valores distintos de cero el total ya está alterado.' : 'Hoy el término referenciado está en blanco o en cero: fragilidad latente, no un efecto vigente.'],
              dimensiones: { aritmetica: 'abierta', dimensiones: 'abierta' },
            }))
            continue
          }
          if (forma.tipo !== 'suma_vertical' || forma.columna !== col) {
            if (forma.tipo === 'otra' && /^\s*(SUM\(|[A-Z]{1,3}\d+\s*[+-])/.test(f.texto) === false) pendientes.push(`${c.hoja}!${celda}: forma de fórmula no interpretada`)
            continue // suma horizontal (meses): la revisan DYP-004, DYP-012 y TRV-004
          }
          revisadas++
          const cmp = compararConjuntos(forma.filas, elegibles)
          if (cmp.omitidas.length === 0 && cmp.sobrantes.length === 0) continue
          const clave = `${tag}|${cmp.omitidas.join(',')}|${cmp.sobrantes.join(',')}`
          const g = grupos.get(clave) ?? { clave, columnas: [], detalle: cmp }
          g.columnas.push(col)
          grupos.set(clave, g)
        }
      }
      porAgrupar(c.filaObra, importes, 'obra')
      porAgrupar(c.filaTotal, esperadoTotal, 'total')

      for (const g of grupos.values()) {
        const tag = g.clave.startsWith('obra') ? 'obra' : 'total'
        const fila = tag === 'obra' ? c.filaObra : c.filaTotal
        const vigente = g.detalle.omitidas.some((r) => g.columnas.some((col) => valorNoCero(libro, c.hoja, col, r)))
        const nombres = g.detalle.omitidas.map((r) => `${r} (${etiquetaFila(libro, c.hoja, r)})`)
        const rotulo = tag === 'obra' ? 'La suma de obra' : 'El total'
        hallazgos.push(crearHallazgo(ctx, {
          id: `DYP-013:${c.hoja}!fila${fila}:${tag}:omite-${g.detalle.omitidas.join('_') || 'ninguna'}`, reglaId: 'DYP-013',
          titulo: g.detalle.omitidas.length > 0 ? `${rotulo} omite ${g.detalle.omitidas.length} fila(s) que debería sumar` : `${rotulo} incluye filas ajenas`,
          detalle: [
            g.detalle.omitidas.length > 0 ? `${rotulo} (fila ${fila}, ${g.columnas.length} columna(s): ${g.columnas.slice(0, 6).join(', ')}${g.columnas.length > 6 ? '…' : ''}) no incluye las filas ${nombres.slice(0, 8).join('; ')}${nombres.length > 8 ? '…' : ''}.` : '',
            g.detalle.sobrantes.length > 0 ? `Incluye filas que no son importes de obra: ${g.detalle.sobrantes.join(', ')}.` : '',
            vigente ? 'Hay importe en alguna fila omitida: impacto vigente.' : 'Las filas omitidas están en blanco o en cero: es una fragilidad latente que aparecería al capturar un importe, no un gasto omitido hoy.',
          ].filter(Boolean).join(' '),
          origen: 'pacot', severidad: vigente ? 'alta' : 'media',
          referencias: g.columnas.slice(0, 6).map((col) => `${c.hoja}!${col}${fila}`), fuentes: [F_PRES, F_VAL],
          esperado: tag === 'obra' ? `${importes.length} filas de importe` : `${esperadoTotal.length} renglones (obra y complementos)`,
          observado: `omite ${g.detalle.omitidas.length}`, dimensiones: { aritmetica: 'abierta', referencias: 'abierta' },
          limites: ['No se corrige el libro ni se inventa el criterio de a qué rubro pertenece cada fila; informar impacto vigente y latente por separado.'],
        }))
      }
      if (participacion.length > 0) {
        const n = participacion.length
        hallazgos.push(crearHallazgo(ctx, {
          id: `DYP-013:${c.hoja}!fila${c.filaTotal}:participacion`, reglaId: 'DYP-013',
          titulo: `${n} columna(s) del total contienen una participación, no un importe`,
          detalle: `En la fila ${c.filaTotal} (rotulada en pesos) estas celdas dividen entre el total anual (${participacion.slice(0, 6).join(', ')}${n > 6 ? '…' : ''}): su resultado es una fracción. Una fracción mensual puede representar participación, no dinero, aunque el rótulo vecino diga presupuesto; no se alteran los encabezados oficiales.`,
          origen: 'formato', severidad: 'informativa', referencias: participacion.slice(0, 6).map((x) => `${c.hoja}!${x}`), fuentes: [F_VAL],
          dimensiones: { dimensiones: 'abierta' }, estadoEvidencia: 'aclarada_por_usuario',
        }))
      }
    }
    return [crearResultado({ reglaId: 'DYP-013', hallazgos, revisados: revisadas, identificados: identificadas, unidad: 'fórmulas de obra y total', pendientes })]
  },
}

