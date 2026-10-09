import { aCadena, dec, type Dec } from '../num/decimal'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const MANUAL: FuenteNorma = { documento: 'Manual de Conservación 2026', seccion: '4.1' }
const CONT: FuenteNorma = { documento: 'references/pruebas-continuidad.md', seccion: 'INVENTARIO: T_I contra inventarios detallados' }

/** Los formatos capturan longitudes con 3 decimales: media unidad del último decimal. */
const PRECISION_KM = dec('0.0005')

// ---------------------------------------------------------------------------------------------
// Núcleo puro
// ---------------------------------------------------------------------------------------------

export interface ParteConciliacion {
  readonly etiqueta: string
  readonly valor: Dec
  /** Si la categoría o el tipo del registro no es de la enumeración del formato. */
  readonly clasificada: boolean
}

export type Conciliacion =
  | { readonly tipo: 'concilia'; readonly suma: Dec }
  | { readonly tipo: 'diferencia'; readonly suma: Dec; readonly diferencia: Dec }
  | { readonly tipo: 'concilia_con_no_clasificados'; readonly suma: Dec; readonly sumaClasificada: Dec; readonly noClasificadas: readonly string[]; readonly diferencia: Dec }

/** Δ = T_I − Σ(registros atómicos). Los registros fuera de enumeración no se absorben en silencio. */
export function conciliar(totalTarjeta: Dec, partes: readonly ParteConciliacion[], tolerancia: Dec = PRECISION_KM): Conciliacion {
  const suma = partes.reduce((a, p) => a.plus(p.valor), dec(0))
  const clasificadas = partes.filter((p) => p.clasificada).reduce((a, p) => a.plus(p.valor), dec(0))
  const dentro = (x: Dec): boolean => totalTarjeta.minus(x).abs().lessThanOrEqualTo(tolerancia)
  if (dentro(clasificadas)) return { tipo: 'concilia', suma: clasificadas }
  if (dentro(suma)) {
    return {
      tipo: 'concilia_con_no_clasificados', suma, sumaClasificada: clasificadas,
      noClasificadas: [...new Set(partes.filter((p) => !p.clasificada).map((p) => p.etiqueta))], diferencia: totalTarjeta.minus(clasificadas),
    }
  }
  return { tipo: 'diferencia', suma: clasificadas, diferencia: totalTarjeta.minus(clasificadas) }
}

const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export type CategoriaCanal = 'principales' | 'secundarios'
export type Revestimiento = 'concreto' | 'mamposteria' | 'sinRevestir' | 'entubado'

export function categoriaDeCanal(texto: string): CategoriaCanal | null {
  const t = normalizar(texto)
  if (t.startsWith('principal')) return 'principales'
  if (t.startsWith('secundario')) return 'secundarios'
  return null
}

export function revestimientoDeCanal(texto: string): Revestimiento | null {
  switch (normalizar(texto)) {
    case 'concreto': return 'concreto'
    case 'mamposteria': return 'mamposteria'
    case 'sin revestir': return 'sinRevestir'
    case 'tuberia': case 'entubado': return 'entubado'
    default: return null
  }
}

type TipoCamino = 'revestido' | 'terraceria' | 'pavimentado'

export function tipoDeCamino(texto: string): TipoCamino | null {
  switch (normalizar(texto)) {
    case 'revestido': return 'revestido'
    case 'terraceria': return 'terraceria'
    case 'pavimentado': return 'pavimentado'
    default: return null
  }
}

/** ¿La fórmula parte una celda en dos mitades fijas? (reparto que no sale del detalle) */
export function esMitadFija(formula: string): boolean {
  return /^\s*\+?\s*\$?[A-Z]{1,3}\$?\d+\s*\/\s*2(?:\.0+)?\s*$/i.test(formula)
}

// ---------------------------------------------------------------------------------------------
// INV-001
// ---------------------------------------------------------------------------------------------

export const reglaInv001: Regla = {
  meta: {
    id: 'INV-001', clase: 'INVENTARIO', titulo: 'T_I conciliada con los inventarios detallados',
    severidadBase: 'alta', fuentes: [MANUAL, CONT], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('INV-001', 'Requiere el libro y un perfil de formato')]
    const libro = ctx.libro
    const p = ctx.perfil
    const t = p.tarjetaInventario
    const ficha = p.fichaCanal
    const cam = p.fichaCamino
    if (![t.hoja, ficha.hoja, cam.hoja].every((h) => libro.hoja(h))) return [noEvaluable('INV-001', `Requiere las hojas ${t.hoja}, ${ficha.hoja} y ${cam.hoja}`)]

    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificados = 0
    let revisados = 0

    const tarjeta = (celda: string): Dec | null => { const n = libro.numero(t.hoja, celda); return n.ok ? n.valor : null }

    const comparar = (celda: string, etiqueta: string, partes: readonly ParteConciliacion[], unidad: string, refsDetalle: readonly string[]): void => {
      identificados++
      const total = tarjeta(celda)
      if (total === null) { pendientes.push(`${t.hoja}!${celda}: total de la tarjeta ausente o no numérico (${etiqueta})`); return }
      revisados++
      const c = conciliar(total, partes)
      const ref = `${t.hoja}!${celda}`
      const base = { reglaId: 'INV-001', fuentes: [MANUAL, CONT], origen: 'pacot' as const, referencias: [ref, ...refsDetalle.slice(0, 6)] }
      if (c.tipo === 'diferencia') {
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `INV-001:${ref}:diferencia`, titulo: `T_I no concilia con el detalle (${etiqueta})`, severidad: 'alta',
          detalle: `Tarjeta ${aCadena(total)} ${unidad}; suma de ${partes.length} registros ${aCadena(c.suma)} ${unidad}. Δ = ${aCadena(c.diferencia)} ${unidad}. Una diferencia no se resuelve sustituyendo uno por otro: acreditar cuál es el correcto.`,
          esperado: aCadena(total), observado: aCadena(c.suma), diferencia: aCadena(c.suma.minus(total)), estadoEvidencia: 'verificada_en_archivo',
          dimensiones: { aritmetica: 'abierta', referencias: 'abierta' },
        }))
      } else if (c.tipo === 'concilia_con_no_clasificados') {
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `INV-001:${ref}:categoria`, titulo: `T_I solo concilia contando valores fuera de enumeración (${etiqueta})`, severidad: 'media',
          detalle: `Con los valores de la enumeración suman ${aCadena(c.sumaClasificada)} ${unidad} y la tarjeta dice ${aCadena(total)}. La diferencia (${aCadena(c.diferencia)} ${unidad}) se recupera solo tratando ${c.noClasificadas.map((x) => `"${x}"`).join(', ')} como una categoría válida. La coincidencia semántica es una propuesta, no se aplica: normalizar la captura en su campo original.`,
          esperado: aCadena(total), observado: aCadena(c.sumaClasificada), diferencia: aCadena(c.sumaClasificada.minus(total)), estadoEvidencia: 'pendiente_de_evidencia',
          dimensiones: { aritmetica: 'verificada', referencias: 'abierta' },
        }))
      }
    }

    // --- Canales (IO1): categoría y revestimiento
    const porCategoria = new Map<CategoriaCanal, ParteConciliacion[]>()
    const porRev = new Map<string, ParteConciliacion[]>()
    const todas: ParteConciliacion[] = []
    const refsCanal: string[] = []
    for (let r = ficha.filas.desde; r <= ficha.filas.hasta; r++) {
      const nombre = libro.texto(ficha.hoja, `${ficha.colNombre}${r}`)
      if (nombre === null) continue
      const len = libro.numero(ficha.hoja, `${p.inventarioCanales.colLongitud}${r}`)
      if (!len.ok) { pendientes.push(`${ficha.hoja}!fila ${r}: longitud no numérica; el registro queda fuera de la suma`); continue }
      const cat = categoriaDeCanal(libro.texto(ficha.hoja, `${p.colCategoriaCanal}${r}`) ?? '')
      const revTxt = libro.texto(ficha.hoja, `${ficha.colRevestimiento}${r}`) ?? ''
      const rev = revestimientoDeCanal(revTxt)
      refsCanal.push(`${ficha.hoja}!${p.inventarioCanales.colLongitud}${r}`)
      todas.push({ etiqueta: textoDeCelda(revTxt, 30) || 'sin tipo', valor: len.valor, clasificada: cat !== null })
      if (cat === null) { pendientes.push(`${ficha.hoja}!${p.colCategoriaCanal}${r}: categoría de canal fuera de principal/secundario`); continue }
      porCategoria.set(cat, [...(porCategoria.get(cat) ?? []), { etiqueta: cat, valor: len.valor, clasificada: true }])
      const k = `${cat}|${rev ?? 'ninguno'}`
      porRev.set(k, [...(porRev.get(k) ?? []), { etiqueta: textoDeCelda(revTxt, 30) || 'sin tipo', valor: len.valor, clasificada: rev !== null }])
    }
    comparar(t.canalesTotal, 'longitud total de canales', todas, 'km', refsCanal)
    for (const cat of ['principales', 'secundarios'] as const) {
      const celdas = t[cat]
      comparar(celdas.total, `canales ${cat}`, porCategoria.get(cat) ?? [], 'km', refsCanal)
      for (const rev of ['concreto', 'mamposteria', 'sinRevestir', 'entubado'] as const) {
        // Los renglones con tipo fuera de enumeración acompañan a cada tipo: solo cuentan si con ellos la tarjeta concilia
        const partes = porRev.get(`${cat}|${rev}`) ?? []
        const sinClasificar = porRev.get(`${cat}|ninguno`) ?? []
        comparar(celdas[rev], `canales ${cat} ${rev}`, [...partes, ...sinClasificar], 'km', refsCanal)
      }
    }

    // --- Caminos (IO3): un renglón por margen y superficie
    const caminos = new Map<TipoCamino | 'ninguno', ParteConciliacion[]>()
    const todosCaminos: ParteConciliacion[] = []
    const refsCamino: string[] = []
    for (let r = cam.filas.desde; r <= cam.filas.hasta; r++) {
      if (libro.texto(cam.hoja, `${cam.colNombre}${r}`) === null) continue
      const len = libro.numero(cam.hoja, `${cam.colLongitud}${r}`)
      if (!len.ok) { pendientes.push(`${cam.hoja}!fila ${r}: longitud no numérica; el camino queda fuera de la suma`); continue }
      const txt = libro.texto(cam.hoja, `${cam.colRevestimiento}${r}`) ?? ''
      const tipo = tipoDeCamino(txt)
      refsCamino.push(`${cam.hoja}!${cam.colLongitud}${r}`)
      const parte = { etiqueta: textoDeCelda(txt, 30) || 'sin tipo', valor: len.valor, clasificada: tipo !== null }
      todosCaminos.push(parte)
      caminos.set(tipo ?? 'ninguno', [...(caminos.get(tipo ?? 'ninguno') ?? []), parte])
    }
    comparar(t.caminosTotal, 'longitud total de caminos', todosCaminos, 'km', refsCamino)
    comparar(t.caminosRevestidos, 'caminos revestidos', [...(caminos.get('revestido') ?? []), ...(caminos.get('ninguno') ?? [])], 'km', refsCamino)
    comparar(t.caminosTerracerias, 'caminos de terracería', [...(caminos.get('terraceria') ?? []), ...(caminos.get('ninguno') ?? [])], 'km', refsCamino)
    comparar(t.caminosPavimentados, 'caminos pavimentados', [...(caminos.get('pavimentado') ?? []), ...(caminos.get('ninguno') ?? [])], 'km', refsCamino)

    // Reparto fijo mitad/mitad: coincide hoy con el detalle, pero no lo sigue si el detalle cambia
    for (const celda of [t.caminosRevestidos, t.caminosTerracerias]) {
      const f = libro.formula(t.hoja, celda)
      if (f && esMitadFija(f.texto)) {
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'INV-001', id: `INV-001:${t.hoja}!${celda}:reparto_fijo`, titulo: 'Reparto fijo en mitades en lugar del detalle',
          detalle: `${t.hoja}!${celda} es "${f.texto.trim()}": reparte el total de caminos en dos mitades iguales. Concilia hoy con IO3 solo porque cada camino tiene un renglón revestido y otro de terracería de igual longitud; si el detalle cambia, la tarjeta no lo sigue. Enlazar con la suma del detalle por tipo.`,
          origen: 'pacot', severidad: 'informativa', referencias: [`${t.hoja}!${celda}`], fuentes: [CONT], observado: f.texto.trim(),
          dimensiones: { referencias: 'abierta' },
        }))
      }
    }

    // --- Estructuras: total de la tarjeta frente a registros del inventario longitudinal
    const e = p.inventarioEstructuras
    if (libro.hoja(e.hoja)) {
      let registros = 0
      for (let r = e.filas.desde; r <= e.filas.hasta; r++) if (libro.numero(e.hoja, `${e.colId}${r}`).ok) registros++
      identificados++
      const total = tarjeta(t.estructurasTotal)
      const ficha15 = libro.numero(ficha.hoja, p.celdaTotalEstructurasFicha)
      if (total === null) pendientes.push(`${t.hoja}!${t.estructurasTotal}: total de estructuras ausente`)
      else {
        revisados++
        if (!total.equals(registros)) {
          hallazgos.push(crearHallazgo(ctx, {
            reglaId: 'INV-001', id: `INV-001:${t.hoja}!${t.estructurasTotal}:estructuras`, titulo: 'Total de estructuras distinto de los registros del inventario longitudinal',
            detalle: `Tarjeta ${aCadena(total)} y ${registros} registros en ${e.hoja}${ficha15.ok ? `; la ficha I.O.-1 suma ${aCadena(ficha15.valor)}` : ''}. Un último número de inventario no es un conteo de obras (ver INV-002).`,
            origen: 'pacot', severidad: 'alta', referencias: [`${t.hoja}!${t.estructurasTotal}`, `${e.hoja}!${e.colId}${e.filas.desde}`], fuentes: [MANUAL],
            esperado: String(registros), observado: aCadena(total), diferencia: aCadena(total.minus(registros)), dimensiones: { aritmetica: 'abierta', referencias: 'abierta' },
          }))
        }
      }
    }
    pendientes.push('No se concilian estructuras por tipo (tomas, represas, sifones…): el catálogo de tipos de IO4 frente a las columnas de IO1 aún no tiene equivalencia declarada.')
    pendientes.push('No se concilia superficie dominada/regable ni usuarios: requieren padrón y plano (INV-004).')
    return [crearResultado({ reglaId: 'INV-001', hallazgos, revisados, identificados, unidad: 'totales de la tarjeta T_I', pendientes })]
  },
}
