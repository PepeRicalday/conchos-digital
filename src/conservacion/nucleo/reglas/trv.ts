import { parseA1, colAIndice } from '../num/a1'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const VAL: FuenteNorma = { documento: 'references/validaciones.md', seccion: 'Reglas: Fórmulas; Comprobación de cada cálculo' }
const TIPO_ERROR_BIFF = 'Un código de error BIFF no es una cantidad: #VALUE! no es "$15".'

// ---------------------------------------------------------------------------------------------
// TRV-001  Errores almacenados y fórmulas no interpretadas
// ---------------------------------------------------------------------------------------------

export const reglaTrv001: Regla = {
  meta: {
    id: 'TRV-001', clase: 'TRANSVERSAL', titulo: 'Confiabilidad de fórmula y caché',
    severidadBase: 'alta', fuentes: [VAL], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro) return [noEvaluable('TRV-001', 'Requiere el libro')]
    const hallazgos: Hallazgo[] = []
    let formulas = 0
    let interpretables = 0
    const externas: string[] = []
    const noInterpretadas: string[] = []
    const addin: string[] = []

    for (const nombre of ctx.libro.hojas()) {
      const h = ctx.libro.hoja(nombre)
      if (!h) continue
      for (const [ref, c] of h.celdas) {
        if (c.tipo !== 'error') continue
        hallazgos.push(crearHallazgo(ctx, {
          id: `TRV-001:${nombre}!${ref}:${c.etiqueta}`, reglaId: 'TRV-001', titulo: `Error almacenado ${c.etiqueta}`,
          detalle: `${TIPO_ERROR_BIFF} Examinar su fórmula y qué salidas dependen de ella.`, origen: 'pacot', severidad: 'alta',
          referencias: [`${nombre}!${ref}`], fuentes: [VAL], observado: c.etiqueta, dimensiones: { aritmetica: 'abierta', referencias: 'abierta' },
        }))
      }
      for (const [ref, f] of h.formulas) {
        formulas++
        const id = `${nombre}!${ref}`
        if (f.kind === 'desconocida') noInterpretadas.push(id)
        else if (f.texto.includes('<<external>>') || /\[\d+\][^!]*!/.test(f.texto)) externas.push(id)
        else if (/ADDIN\(/.test(f.texto)) addin.push(id)
        else interpretables++
      }
    }
    const pendientes: string[] = []
    if (noInterpretadas.length) pendientes.push(`${noInterpretadas.length} fórmulas matriciales o compartidas sin expresión operativa (${noInterpretadas.slice(0, 4).join(', ')}…): no se declara revisión matemática`)
    if (externas.length) pendientes.push(`${externas.length} fórmulas con referencia a libros externos ausentes: se conservan sus valores almacenados, sin actualizar vínculos`)
    if (addin.length) pendientes.push(`${addin.length} fórmulas ADDIN (forma binaria de IFERROR) cuyo operando no se recupera: no se declaran errores ni correctas`)
    return [crearResultado({
      reglaId: 'TRV-001', hallazgos, revisados: interpretables, identificados: formulas, unidad: 'fórmulas interpretables', pendientes,
      calculos: [{ descripcion: 'Fórmulas por tratamiento', entradas: { total: String(formulas) }, salida: `interpretables ${interpretables}; externas ${externas.length}; ADDIN ${addin.length}; no interpretadas ${noInterpretadas.length}` }],
    })]
  },
}

// ---------------------------------------------------------------------------------------------
// TRV-004  Integridad de referencias y sumas
// ---------------------------------------------------------------------------------------------

const RE_CALIFICADA = /(?:'[^']+'|\[\d+\][^!\s,;()+*/^&=<>]+|[A-Za-z0-9_.-]+)!\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?/g
const RE_REF = /\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/g

/** Referencias de la misma hoja (como rangos A1:B2 normalizados); descarta las calificadas con otra hoja. */
function refsMismaHoja(texto: string): Array<{ c1: number; f1: number; c2: number; f2: number }> {
  const sin = texto.replace(RE_CALIFICADA, ' ')
  const out: Array<{ c1: number; f1: number; c2: number; f2: number }> = []
  for (const m of sin.matchAll(RE_REF)) {
    const [, col1, fila1, col2, fila2] = m
    if (!col1 || !fila1) continue
    const c1 = colAIndice(col1), f1 = Number(fila1)
    const c2 = col2 ? colAIndice(col2) : c1, f2 = fila2 ? Number(fila2) : f1
    out.push({ c1: Math.min(c1, c2), f1: Math.min(f1, f2), c2: Math.max(c1, c2), f2: Math.max(f1, f2) })
  }
  return out
}

/** ¿La fórmula de `celda` se incluye a sí misma? (autorreferencia directa). */
export function esAutorreferencia(celda: string, texto: string): boolean {
  const p = parseA1(celda)
  if (!p) return false
  const c = colAIndice(p.col)
  return refsMismaHoja(texto).some((r) => c >= r.c1 && c <= r.c2 && p.fila >= r.f1 && p.fila <= r.f2)
}

/** Operandos de una suma de celdas simples (a+b+c); null si la fórmula tiene otra forma. */
export function operandosDeSuma(texto: string): string[] | null {
  const t = texto.trim().replace(/^\+/, '')
  if (t.includes('(') || t.includes('!') || t.includes(':')) return null
  const partes = t.split('+').map((x) => x.trim().replace(/\$/g, ''))
  if (partes.length < 2) return null
  return partes.every((x) => parseA1(x) !== null) ? partes : null
}

export const reglaTrv004: Regla = {
  meta: {
    id: 'TRV-004', clase: 'TRANSVERSAL', titulo: 'Integridad de referencias, rangos y sumas',
    severidadBase: 'alta', fuentes: [VAL], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('TRV-004', 'Requiere el libro y un perfil de formato')]
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificadas = 0
    let revisadas = 0

    // 1) Autorreferencias: en todas las hojas
    for (const nombre of ctx.libro.hojas()) {
      const h = ctx.libro.hoja(nombre)
      if (!h) continue
      for (const [ref, f] of h.formulas) {
        if (f.kind === 'desconocida') continue
        if (!esAutorreferencia(ref, f.texto)) continue
        hallazgos.push(crearHallazgo(ctx, {
          id: `TRV-004:${nombre}!${ref}:autorreferencia`, reglaId: 'TRV-004', titulo: 'Fórmula que se incluye a sí misma',
          detalle: 'Un cero almacenado no prueba que una autorreferencia se calcule bien; la marca NO APLICA limita el impacto actual, no elimina el defecto de plantilla.',
          origen: 'pacot', severidad: 'alta', referencias: [`${nombre}!${ref}`], fuentes: [VAL], observado: textoDeCelda(f.texto),
          dimensiones: { referencias: 'abierta', aritmetica: 'abierta' }, estadoEvidencia: 'verificada_en_archivo',
        }))
      }
    }

    // 2) Sumas de celdas simples en las hojas de programa: texto dentro de la suma y términos repetidos
    for (const nombre of ctx.perfil.hojasPrograma) {
      const h = ctx.libro.hoja(nombre)
      if (!h) continue
      for (const [ref, f] of h.formulas) {
        identificadas++
        if (f.kind === 'desconocida') { pendientes.push(`${nombre}!${ref}: fórmula no interpretada`); continue }
        const ops = operandosDeSuma(f.texto)
        if (ops === null) continue
        revisadas++
        const textos = ops.filter((o) => h.celdas.get(o)?.tipo === 'texto')
        if (textos.length > 0) {
          hallazgos.push(crearHallazgo(ctx, {
            id: `TRV-004:${nombre}!${ref}:suma_de_texto`, reglaId: 'TRV-004', titulo: 'Fórmula que suma una etiqueta o unidad de texto',
            detalle: `Suma ${textos.map((o) => `${o} ("${textoDeCelda(ctx.libro?.texto(nombre, o) ?? null, 30)}")`).join(' y ')}. Con las entradas actuales produce #VALUE! aunque el caché guarde un número. ${TIPO_ERROR_BIFF}`,
            origen: 'pacot', severidad: 'alta', referencias: [`${nombre}!${ref}`, ...textos.map((o) => `${nombre}!${o}`)], fuentes: [VAL],
            observado: textoDeCelda(f.texto), dimensiones: { referencias: 'abierta', aritmetica: 'abierta', dimensiones: 'abierta' },
          }))
        }
        const vistos = new Set<string>()
        const repetidos = new Set<string>()
        for (const o of ops) { if (vistos.has(o)) repetidos.add(o); vistos.add(o) }
        if (repetidos.size > 0) {
          hallazgos.push(crearHallazgo(ctx, {
            id: `TRV-004:${nombre}!${ref}:termino_repetido`, reglaId: 'TRV-004', titulo: 'Término repetido dentro de una suma',
            detalle: `Se repite ${[...repetidos].join(', ')}. Impacto vigente solo si el término tiene importe; si está en blanco o cero es fragilidad latente, no gasto duplicado.`,
            origen: 'pacot', severidad: 'media', referencias: [`${nombre}!${ref}`], fuentes: [VAL], observado: [...repetidos].join(', '),
            dimensiones: { referencias: 'abierta', aritmetica: 'abierta' },
          }))
        }
      }
    }
    return [crearResultado({
      reglaId: 'TRV-004', hallazgos, revisados: revisadas, identificados: identificadas, unidad: 'fórmulas de hojas de programa', pendientes,
    })]
  },
}
