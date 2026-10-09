import { aCadena, dec, type Dec } from '../num/decimal'
import { estaInvertido, longitudKm, parsearPK } from '../num/pk'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const A1: FuenteNorma = { documento: 'Anexo 1', seccion: '3.1 (I.O.-1 columnas 3 a 9)' }
const A3: FuenteNorma = { documento: 'Anexo 3', seccion: 'DIAG-01 columnas 3 a 5' }
const MANUAL: FuenteNorma = { documento: 'Manual de Conservación 2026', seccion: '4.1 y 4.3.1' }

/** Los formatos capturan la longitud con 3 decimales (Anexo 1): media unidad del último decimal. */
const PRECISION_KM = dec('0.0005')

// ---------------------------------------------------------------------------------------------
// INV-003  PK y longitud efectiva
// ---------------------------------------------------------------------------------------------

export type DiagnosticoTramo =
  | { readonly tipo: 'concilia'; readonly calculada: Dec }
  | { readonly tipo: 'diferencia'; readonly calculada: Dec; readonly diferencia: Dec }
  | { readonly tipo: 'invertido'; readonly calculada: Dec }
  | { readonly tipo: 'pk_ilegible'; readonly cual: 'inicial' | 'final' }

/** Núcleo puro: L efectiva = |PK final − PK inicial|, con PK como distancia en metros. */
export function diagnosticarTramo(pkInicial: string, pkFinal: string, longitudCapturada: Dec): DiagnosticoTramo {
  const a = parsearPK(pkInicial)
  if (!a.ok) return { tipo: 'pk_ilegible', cual: 'inicial' }
  const b = parsearPK(pkFinal)
  if (!b.ok) return { tipo: 'pk_ilegible', cual: 'final' }
  const calculada = longitudKm(a.metros, b.metros)
  if (estaInvertido(a.metros, b.metros)) return { tipo: 'invertido', calculada }
  const diferencia = longitudCapturada.minus(calculada)
  return diferencia.abs().lessThanOrEqualTo(PRECISION_KM) ? { tipo: 'concilia', calculada } : { tipo: 'diferencia', calculada, diferencia }
}

export const reglaInv003: Regla = {
  meta: {
    id: 'INV-003', clase: 'INVENTARIO', titulo: 'PK, longitud efectiva y equivalencias de cadenamiento',
    severidadBase: 'alta', fuentes: [A1, A3], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('INV-003', 'Requiere el libro y un perfil de formato')]
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificados = 0
    let revisados = 0

    const revisar = (hoja: string, fila: number, colI: string, colF: string, colL: string): void => {
      const pi = ctx.libro?.texto(hoja, `${colI}${fila}`) ?? null
      const pf = ctx.libro?.texto(hoja, `${colF}${fila}`) ?? null
      const l = ctx.libro?.numero(hoja, `${colL}${fila}`)
      if (pi === null && pf === null && !l?.ok) return
      identificados++
      if (pi === null || pf === null || !l?.ok) {
        pendientes.push(`${hoja}!fila ${fila}: PK o longitud ausente o no numérica; no se sustituye por el registro vecino`)
        return
      }
      const d = diagnosticarTramo(pi, pf, l.valor)
      const refs = [`${hoja}!${colI}${fila}`, `${hoja}!${colF}${fila}`, `${hoja}!${colL}${fila}`]
      const nombre = textoDeCelda(ctx.libro?.texto(hoja, `B${fila}`) ?? null, 50)
      revisados++
      if (d.tipo === 'concilia') return
      if (d.tipo === 'pk_ilegible') {
        pendientes.push(`${hoja}!fila ${fila}: PK ${d.cual} no legible ("${textoDeCelda(d.cual === 'inicial' ? pi : pf)}"); requiere equivalencia explícita`)
        revisados--
        return
      }
      if (d.tipo === 'invertido') {
        hallazgos.push(crearHallazgo(ctx, {
          id: `INV-003:${hoja}!${colI}${fila}:invertido`, reglaId: 'INV-003', titulo: `Tramo con PK invertido (${nombre})`,
          detalle: 'El PK final es menor que el inicial. Corregir solo con ubicación acreditada.', origen: 'pacot', severidad: 'media',
          referencias: refs, fuentes: [A1], observado: `${pi.trim()} → ${pf.trim()}`, estadoEvidencia: 'pendiente_de_evidencia',
          dimensiones: { dimensiones: 'abierta', referencias: 'abierta' },
        }))
        return
      }
      hallazgos.push(crearHallazgo(ctx, {
        id: `INV-003:${hoja}!${colL}${fila}:longitud`, reglaId: 'INV-003', titulo: `Longitud efectiva distinta de la diferencia de PK (${nombre})`,
        detalle: 'No se corrige copiando otro dato: acreditar el PK final, la longitud efectiva o la igualdad de cadenamiento (con observación escrita).',
        origen: 'pacot', severidad: 'alta', referencias: refs, fuentes: [A1, A3],
        esperado: aCadena(d.calculada), observado: aCadena(l.valor), diferencia: aCadena(d.diferencia), estadoEvidencia: 'pendiente_de_evidencia',
        dimensiones: { dimensiones: 'abierta', condicion_fisica: 'pendiente' },
      }))
    }

    const c = ctx.perfil.inventarioCanales
    for (let r = c.filas.desde; r <= c.filas.hasta; r++) revisar(c.hoja, r, c.colPkInicial, c.colPkFinal, c.colLongitud)
    const k = ctx.perfil.inventarioCaminos
    for (const r of k.filas) revisar(k.hoja, r, k.colPkInicial, k.colPkFinal, k.colLongitud)
    return [crearResultado({ reglaId: 'INV-003', hallazgos, revisados, identificados, unidad: 'tramos de canales y caminos', pendientes })]
  },
}

// ---------------------------------------------------------------------------------------------
// INV-002  Número de inventario único
// ---------------------------------------------------------------------------------------------

export interface RegistroId {
  readonly fila: number
  readonly id: number
  readonly tipo: string
}

/** Núcleo puro: agrupa por número de inventario y devuelve los repetidos con sus tipos. */
export function repetidos(registros: readonly RegistroId[]): Array<{ id: number; filas: number[]; tipos: string[]; distintos: boolean }> {
  const grupos = new Map<number, RegistroId[]>()
  for (const r of registros) grupos.set(r.id, [...(grupos.get(r.id) ?? []), r])
  return [...grupos.entries()]
    .filter(([, g]) => g.length > 1)
    .map(([id, g]) => {
      const tipos = g.map((x) => x.tipo)
      return { id, filas: g.map((x) => x.fila), tipos, distintos: new Set(tipos.map((t) => t.trim().toUpperCase())).size > 1 }
    })
    .sort((a, b) => a.id - b.id)
}

export const reglaInv002: Regla = {
  meta: {
    id: 'INV-002', clase: 'INVENTARIO', titulo: 'Número de inventario invariable y único',
    severidadBase: 'alta', fuentes: [MANUAL, A3], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('INV-002', 'Requiere el libro y un perfil de formato')]
    const e = ctx.perfil.inventarioEstructuras
    const registros: RegistroId[] = []
    const pendientes: string[] = []
    for (let r = e.filas.desde; r <= e.filas.hasta; r++) {
      const id = ctx.libro.numero(e.hoja, `${e.colId}${r}`)
      if (!id.ok) {
        if (id.motivo !== 'vacia') pendientes.push(`${e.hoja}!${e.colId}${r}: identificador no numérico (${id.motivo})`)
        continue
      }
      registros.push({ fila: r, id: id.valor.toNumber(), tipo: textoDeCelda(ctx.libro.texto(e.hoja, `${e.colTipo}${r}`), 60) })
    }
    const dups = repetidos(registros)
    const hallazgos: Hallazgo[] = dups.map((d) => crearHallazgo(ctx, {
      id: `INV-002:${e.hoja}:id-${d.id}`, reglaId: 'INV-002',
      titulo: d.distintos ? `Número de inventario ${d.id} compartido por obras distintas` : `Número de inventario ${d.id} repetido`,
      detalle: `Filas ${d.filas.join(', ')}: ${d.tipos.map((t) => `"${t}"`).join(' y ')}. Un repetido no acredita que sea la misma obra; no se borran ni renumeran registros. Enlazar mientras se aclaran las claves por activo padre, tramo/PK y tipo.`,
      origen: 'pacot', severidad: d.distintos ? 'alta' : 'media', referencias: d.filas.map((f) => `${e.hoja}!${e.colId}${f}`), fuentes: [MANUAL],
      observado: `${d.filas.length} registros`, esperado: '1 registro por número', estadoEvidencia: 'aclarada_por_usuario',
      dimensiones: { referencias: 'abierta' }, limites: ['Un último número de inventario no es un conteo de obras.'],
    }))
    return [crearResultado({
      reglaId: 'INV-002', hallazgos, revisados: registros.length, identificados: registros.length, unidad: 'registros de estructuras', pendientes,
      calculos: [{ descripcion: 'Registros y números distintos', entradas: { registros: String(registros.length) }, salida: `${new Set(registros.map((x) => x.id)).size} distintos` }],
    })]
  },
}
