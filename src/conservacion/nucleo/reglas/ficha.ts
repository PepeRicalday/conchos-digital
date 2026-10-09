import { aCadena, dec, type Dec } from '../num/decimal'
import { parsearPK } from '../num/pk'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const A1: FuenteNorma = { documento: 'Anexo 1', seccion: '2.1 y 3.1 (I.O.-1, columnas 3 a 21)' }
const FISICA: FuenteNorma = { documento: 'references/auditoria-fisica.md', seccion: 'Coherencia hidráulica del inventario' }

// ---------------------------------------------------------------------------------------------
// Coordenadas (INV-005)
// ---------------------------------------------------------------------------------------------

export type Hemisferio = 'N' | 'S' | 'E' | 'O'

export type CoordenadaDMS =
  | {
    readonly ok: true
    readonly grados: number
    readonly minutos: number
    readonly segundos: Dec
    readonly hemisferio: Hemisferio
    /** Grados decimales con signo (S y O negativos). Aproximación para distancias: no sustituye la coordenada capturada. */
    readonly decimal: number
  }
  | { readonly ok: false }

/** g°m's.ss'' con hemisferio N/S/E/O/W. No corrige nada: solo lee. */
export function parsearDMS(texto: string): CoordenadaDMS {
  const m = /^\s*(\d{1,3})\s*°\s*(\d{1,3})\s*['′]\s*(\d{1,3}(?:\.\d+)?)\s*(?:"|''|″)\s*([NSEOW])\s*$/i.exec(texto)
  if (!m || m[1] === undefined || m[2] === undefined || m[3] === undefined || m[4] === undefined) return { ok: false }
  const h = m[4].toUpperCase()
  const hemisferio: Hemisferio = h === 'W' ? 'O' : (h as Hemisferio)
  const segundos = dec(m[3])
  const abs = Number(m[1]) + Number(m[2]) / 60 + segundos.toNumber() / 3600
  return { ok: true, grados: Number(m[1]), minutos: Number(m[2]), segundos, hemisferio, decimal: hemisferio === 'S' || hemisferio === 'O' ? -abs : abs }
}

export type ProblemaCoordenada = 'minutos_fuera' | 'segundos_fuera' | 'segundos_60' | 'hemisferio' | 'fuera_de_mexico'

/** Rango del territorio nacional (con margen); fuera de él la coordenada es casi seguro un error de captura. */
const LATITUD_MEXICO = { min: 14, max: 33 }
const LONGITUD_MEXICO = { min: -119, max: -86 }

export function validarCoordenada(c: Extract<CoordenadaDMS, { ok: true }>, eje: 'latitud' | 'longitud'): ProblemaCoordenada[] {
  const p: ProblemaCoordenada[] = []
  if (c.minutos >= 60) p.push('minutos_fuera')
  if (c.segundos.greaterThan(60)) p.push('segundos_fuera')
  else if (c.segundos.equals(60)) p.push('segundos_60')
  const hemisferioOk = eje === 'latitud' ? c.hemisferio === 'N' : c.hemisferio === 'O'
  if (!hemisferioOk) p.push('hemisferio')
  else {
    const r = eje === 'latitud' ? LATITUD_MEXICO : LONGITUD_MEXICO
    if (c.decimal < r.min || c.decimal > r.max) p.push('fuera_de_mexico')
  }
  return p
}

/** Distancia aproximada en metros (esfera). Sirve para comparar extremos que deben coincidir, no para medir. */
export function distanciaMetros(latA: number, lonA: number, latB: number, lonB: number): number {
  const R = 6371008.8
  const rad = Math.PI / 180
  const dLat = (latB - latA) * rad
  const dLon = (lonB - lonA) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(latA * rad) * Math.cos(latB * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Dos extremos que el PK declara como el mismo punto deben coincidir hasta la resolución de la captura (0.01'' ≈ 0.3 m). */
const TOLERANCIA_CONTINUIDAD_M = 2

const TEXTO_PROBLEMA: Readonly<Record<ProblemaCoordenada, string>> = {
  minutos_fuera: 'los minutos son 60 o más',
  segundos_fuera: 'los segundos superan 60',
  segundos_60: "los segundos valen exactamente 60'' (se normaliza a +1 minuto, sin sustituir la captura)",
  hemisferio: 'el hemisferio no corresponde al eje (la latitud lleva N y la longitud O en territorio mexicano)',
  fuera_de_mexico: 'cae fuera del territorio nacional',
}

export const reglaInv005: Regla = {
  meta: {
    id: 'INV-005', clase: 'INVENTARIO', titulo: 'Calidad de la georreferenciación del inventario',
    severidadBase: 'media', fuentes: [A1], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('INV-005', 'Requiere el libro y un perfil de formato')]
    const f = ctx.perfil.fichaCanal
    const libro = ctx.libro
    if (!libro.hoja(f.hoja)) return [noEvaluable('INV-005', `Requiere la hoja ${f.hoja}`)]
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificados = 0
    let revisados = 0

    interface Extremo { readonly lat: number; readonly lon: number }
    const extremos = new Map<number, { readonly inicial: Extremo | null; readonly final: Extremo | null }>()

    const leer = (col: string, fila: number, eje: 'latitud' | 'longitud'): Extremo['lat'] | null => {
      const ref = `${f.hoja}!${col}${fila}`
      const t = libro.texto(f.hoja, `${col}${fila}`)
      if (t === null || t.trim() === '') { pendientes.push(`${ref}: coordenada ausente; se registra como pendiente de levantamiento, no se completa`); return null }
      const c = parsearDMS(t)
      identificados++
      if (!c.ok) {
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'INV-005', id: `INV-005:${ref}:formato`, titulo: `Coordenada con formato ilegible (${eje})`, severidad: 'media', origen: 'pacot',
          detalle: `"${textoDeCelda(t, 40)}" no sigue g°m's.ss'' con hemisferio. Se conserva tal cual; no se reinterpreta.`, referencias: [ref], fuentes: [A1],
          observado: textoDeCelda(t, 40), dimensiones: { referencias: 'abierta' },
        }))
        return null
      }
      revisados++
      for (const p of validarCoordenada(c, eje)) {
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'INV-005', id: `INV-005:${ref}:${p}`, titulo: `Coordenada de ${eje} con valor dudoso`,
          severidad: p === 'segundos_60' ? 'informativa' : p === 'hemisferio' || p === 'fuera_de_mexico' ? 'alta' : 'media', origen: 'pacot',
          detalle: `"${textoDeCelda(t, 40)}": ${TEXTO_PROBLEMA[p]}. Acreditar con el levantamiento antes de corregir.`, referencias: [ref], fuentes: [A1],
          observado: textoDeCelda(t, 40), dimensiones: { referencias: 'abierta' }, estadoEvidencia: 'pendiente_de_evidencia',
        }))
      }
      return c.decimal
    }

    const pk = (col: string, fila: number): Dec | null => {
      const t = libro.texto(f.hoja, `${col}${fila}`)
      const r = t === null ? null : parsearPK(t)
      return r?.ok ? r.metros : null
    }

    const filas: Array<{ fila: number; obra: string; pkI: Dec | null; pkF: Dec | null }> = []
    for (let r = f.filas.desde; r <= f.filas.hasta; r++) {
      const nombre = libro.texto(f.hoja, `${f.colNombre}${r}`)
      if (nombre === null) continue
      const latI = leer(f.colLatInicial, r, 'latitud'); const lonI = leer(f.colLonInicial, r, 'longitud')
      const latF = leer(f.colLatFinal, r, 'latitud'); const lonF = leer(f.colLonFinal, r, 'longitud')
      extremos.set(r, {
        inicial: latI !== null && lonI !== null ? { lat: latI, lon: lonI } : null,
        final: latF !== null && lonF !== null ? { lat: latF, lon: lonF } : null,
      })
      filas.push({ fila: r, obra: textoDeCelda(nombre, 60), pkI: pk(f.colPkInicial, r), pkF: pk(f.colPkFinal, r) })
    }

    // Continuidad: el final de un tramo es el inicio del siguiente de la misma obra cuando el PK lo declara
    for (let i = 0; i + 1 < filas.length; i++) {
      const a = filas[i]; const b = filas[i + 1]
      if (!a || !b || a.obra !== b.obra || a.pkF === null || b.pkI === null || !a.pkF.equals(b.pkI)) continue
      const ea = extremos.get(a.fila)?.final; const eb = extremos.get(b.fila)?.inicial
      if (!ea || !eb) continue
      const d = distanciaMetros(ea.lat, ea.lon, eb.lat, eb.lon)
      if (d > TOLERANCIA_CONTINUIDAD_M) {
        hallazgos.push(crearHallazgo(ctx, {
          reglaId: 'INV-005', id: `INV-005:${f.hoja}!${f.colLonFinal}${a.fila}:discontinuidad`, titulo: `Los extremos de dos tramos contiguos no coinciden (${a.obra})`,
          detalle: `El PK final de la fila ${a.fila} y el inicial de la fila ${b.fila} son el mismo punto, pero sus coordenadas distan ${d.toFixed(1)} m (tolerancia ${TOLERANCIA_CONTINUIDAD_M} m).`,
          severidad: 'media', origen: 'pacot', fuentes: [A1], estadoEvidencia: 'pendiente_de_evidencia',
          referencias: [`${f.hoja}!${f.colLonFinal}${a.fila}`, `${f.hoja}!${f.colLatFinal}${a.fila}`, `${f.hoja}!${f.colLonInicial}${b.fila}`, `${f.hoja}!${f.colLatInicial}${b.fila}`],
          esperado: '0', observado: d.toFixed(1), dimensiones: { referencias: 'abierta' },
        }))
      }
    }
    pendientes.push('Solo se valida el formato, el rango y la continuidad de las coordenadas; su exactitud sobre el terreno requiere levantamiento con GPS o estación total.')
    return [crearResultado({ reglaId: 'INV-005', hallazgos, revisados, identificados, unidad: 'coordenadas de tramos de canal', pendientes })]
  },
}

// ---------------------------------------------------------------------------------------------
// Coherencia hidráulica (INV-006)
// ---------------------------------------------------------------------------------------------

export interface Coherencia {
  readonly areaCalculada: Dec
  readonly diferenciaArea: Dec
  readonly areaCoherente: boolean
  readonly gastoCalculado: Dec | null
  readonly diferenciaGasto: Dec | null
  readonly gastoCoherente: boolean | null
}

/** Las secciones se capturan con 1 a 2 decimales: se admite 1% (coherencia interna, no aforo). */
const TOLERANCIA_RELATIVA = dec('0.01')

const dentro = (observado: Dec, esperado: Dec): boolean =>
  observado.minus(esperado).abs().lessThanOrEqualTo(esperado.abs().times(TOLERANCIA_RELATIVA).plus('0.005'))

/** A = y(b + z·y) y Q = A·V para secciones trapeciales (z = 0 es rectangular). */
export function coherenciaHidraulica(e: { b: Dec; z: Dec; y: Dec; area: Dec; velocidad: Dec | null; gasto: Dec | null }): Coherencia {
  const areaCalculada = e.y.times(e.b.plus(e.z.times(e.y)))
  const gastoCalculado = e.velocidad === null ? null : e.area.times(e.velocidad)
  return {
    areaCalculada, diferenciaArea: e.area.minus(areaCalculada), areaCoherente: dentro(e.area, areaCalculada),
    gastoCalculado, diferenciaGasto: gastoCalculado === null || e.gasto === null ? null : e.gasto.minus(gastoCalculado),
    gastoCoherente: gastoCalculado === null || e.gasto === null ? null : dentro(e.gasto, gastoCalculado),
  }
}

export type FormaSeccion = 'trapezoidal' | 'rectangular' | 'circular' | 'otros'

const normalizarEnum = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

const SECCIONES: Readonly<Record<string, FormaSeccion>> = {
  trapezoidal: 'trapezoidal', rectangular: 'rectangular', circular: 'circular', otros: 'otros', otro: 'otros',
}
const REVESTIMIENTOS = new Set(['sin revestir', 'concreto', 'mamposteria', 'asfalto', 'tuberia', 'suelo-cemento', 'suelo cemento', 'otros', 'otro'])

export function formaDeSeccion(texto: string): FormaSeccion | null {
  return SECCIONES[normalizarEnum(texto)] ?? null
}

export const reglaInv006: Regla = {
  meta: {
    id: 'INV-006', clase: 'INVENTARIO', titulo: 'Coherencia hidráulica del inventario (A y Q)',
    severidadBase: 'media', fuentes: [FISICA, A1], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('INV-006', 'Requiere el libro y un perfil de formato')]
    const f = ctx.perfil.fichaCanal
    const libro = ctx.libro
    if (!libro.hoja(f.hoja)) return [noEvaluable('INV-006', `Requiere la hoja ${f.hoja}`)]
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificados = 0
    let revisados = 0
    const num = (col: string, r: number): Dec | null => { const n = libro.numero(f.hoja, `${col}${r}`); return n.ok ? n.valor : null }

    for (let r = f.filas.desde; r <= f.filas.hasta; r++) {
      const nombre = libro.texto(f.hoja, `${f.colNombre}${r}`)
      if (nombre === null) continue
      identificados++
      const seccionTxt = libro.texto(f.hoja, `${f.colSeccion}${r}`)
      const forma = seccionTxt === null ? null : formaDeSeccion(seccionTxt)
      const b = num(f.colPlantilla, r); const y = num(f.colTirante, r); const area = num(f.colArea, r)
      const z = num(f.colTalud, r); const v = num(f.colVelocidad, r); const q = num(f.colGasto, r)
      const ref = (col: string): string => `${f.hoja}!${col}${r}`
      if (forma === 'circular' || forma === 'otros') { pendientes.push(`${ref(f.colSeccion)}: sección ${forma}; A = y(b+zy) no aplica y no se evalúa`); continue }
      if (b === null || y === null || area === null || (forma === 'trapezoidal' && z === null)) {
        pendientes.push(`${f.hoja}!fila ${r}: faltan b, d, A o talud; la coherencia hidráulica no se evalúa y no se completa el dato`)
        continue
      }
      revisados++
      const talud = forma === 'rectangular' ? dec(0) : (z ?? dec(0))
      const c = coherenciaHidraulica({ b, z: talud, y, area, velocidad: v, gasto: q })
      const etiqueta = `${textoDeCelda(nombre, 40)} · ${textoDeCelda(libro.texto(f.hoja, `${f.colPkInicial}${r}`) ?? '', 14)}`
      const base = { reglaId: 'INV-006', origen: 'pacot' as const, fuentes: [FISICA], estadoEvidencia: 'verificada_en_archivo' as const, severidad: 'media' as const }
      if (!c.areaCoherente) {
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `INV-006:${ref(f.colArea)}:area`, titulo: `El área hidráulica no coincide con b, z y d (${etiqueta})`,
          detalle: `A = d(b + z·d) = ${aCadena(y.toDecimalPlaces(3))}·(${aCadena(b)} + ${aCadena(talud)}·${aCadena(y)}) = ${aCadena(c.areaCalculada.toDecimalPlaces(3))} m², capturada ${aCadena(area)} m² (tolerancia 1 % por redondeo de captura). Coherencia interna: no es un aforo ni acredita la fecha del levantamiento.`,
          referencias: [ref(f.colArea), ref(f.colPlantilla), ref(f.colTirante), ref(f.colTalud)], esperado: aCadena(c.areaCalculada.toDecimalPlaces(3)),
          observado: aCadena(area), diferencia: aCadena(c.diferenciaArea.toDecimalPlaces(3)), dimensiones: { aritmetica: 'abierta', dimensiones: 'abierta' },
        }))
      }
      if (c.gastoCoherente === false && c.gastoCalculado !== null && c.diferenciaGasto !== null && q !== null) {
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `INV-006:${ref(f.colGasto)}:gasto`, titulo: `El gasto no coincide con A·V (${etiqueta})`,
          detalle: `Q = A·V = ${aCadena(area)}·${aCadena(v ?? dec(0))} = ${aCadena(c.gastoCalculado.toDecimalPlaces(3))} m³/s, capturado ${aCadena(q)} m³/s.`,
          referencias: [ref(f.colGasto), ref(f.colArea), ref(f.colVelocidad)], esperado: aCadena(c.gastoCalculado.toDecimalPlaces(3)), observado: aCadena(q),
          diferencia: aCadena(c.diferenciaGasto.toDecimalPlaces(3)), dimensiones: { aritmetica: 'abierta', dimensiones: 'abierta' },
        }))
      }
    }
    pendientes.push('Coherencia interna de la ficha: no se verifica la procedencia del levantamiento ni la fecha de los datos hidráulicos.')
    return [crearResultado({ reglaId: 'INV-006', hallazgos, revisados, identificados, unidad: 'tramos con sección trapecial o rectangular', pendientes })]
  },
}

// ---------------------------------------------------------------------------------------------
// Dominio de los campos (INV-007)
// ---------------------------------------------------------------------------------------------

const PK_FORMATO = /^\s*K-\d+\+\d{3}\s*$/i

export const reglaInv007: Regla = {
  meta: {
    id: 'INV-007', clase: 'INVENTARIO', titulo: 'Dominio de los campos del inventario (Anexo 1)',
    severidadBase: 'media', fuentes: [A1], requiereLibro: true, casosOro: [],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('INV-007', 'Requiere el libro y un perfil de formato')]
    const f = ctx.perfil.fichaCanal
    const libro = ctx.libro
    if (!libro.hoja(f.hoja)) return [noEvaluable('INV-007', `Requiere la hoja ${f.hoja}`)]
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificados = 0
    let revisados = 0
    const grupos = new Map<string, { campo: string; valor: string; col: string; filas: number[] }>()
    const agrupar = (campo: string, col: string, valor: string, fila: number): void => {
      const k = `${col}|${normalizarEnum(valor)}`
      const g = grupos.get(k) ?? { campo, valor: textoDeCelda(valor, 40), col, filas: [] }
      g.filas.push(fila)
      grupos.set(k, g)
    }

    for (let r = f.filas.desde; r <= f.filas.hasta; r++) {
      if (libro.texto(f.hoja, `${f.colNombre}${r}`) === null) continue
      identificados++
      revisados++
      const sec = libro.texto(f.hoja, `${f.colSeccion}${r}`)
      if (sec === null || sec.trim() === '') pendientes.push(`${f.hoja}!${f.colSeccion}${r}: tipo de sección vacío`)
      else if (formaDeSeccion(sec) === null) agrupar('Tipo de sección', f.colSeccion, sec, r)
      const rev = libro.texto(f.hoja, `${f.colRevestimiento}${r}`)
      if (rev === null || rev.trim() === '') pendientes.push(`${f.hoja}!${f.colRevestimiento}${r}: tipo de revestimiento vacío`)
      else if (!REVESTIMIENTOS.has(normalizarEnum(rev))) agrupar('Tipo de revestimiento', f.colRevestimiento, rev, r)
      for (const col of [f.colPkInicial, f.colPkFinal]) {
        const pk = libro.texto(f.hoja, `${col}${r}`)
        if (pk !== null && pk.trim() !== '' && !PK_FORMATO.test(pk)) agrupar('Formato de PK (K-km+mmm)', col, pk, r)
      }
    }

    const ENUM: Readonly<Record<string, string>> = {
      'Tipo de sección': 'trapezoidal, rectangular, circular u otros',
      'Tipo de revestimiento': 'sin revestir, concreto, mampostería, asfalto, tubería, suelo-cemento u otros',
      'Formato de PK (K-km+mmm)': 'K-12+549',
    }
    for (const g of [...grupos.values()].sort((a, b) => a.col.localeCompare(b.col) || a.valor.localeCompare(b.valor))) {
      hallazgos.push(crearHallazgo(ctx, {
        reglaId: 'INV-007', id: `INV-007:${f.hoja}!${g.col}:${normalizarEnum(g.valor).replace(/\s+/g, '-')}`,
        titulo: `${g.campo}: "${g.valor}" fuera de la enumeración del formato (${g.filas.length} registro${g.filas.length === 1 ? '' : 's'})`,
        detalle: `El Anexo 1 admite: ${ENUM[g.campo] ?? 'valores de la enumeración del formato'}. Filas ${g.filas.slice(0, 8).join(', ')}${g.filas.length > 8 ? '…' : ''}. Normalizar la captura en el campo original; el valor se conserva tal cual en este informe.`,
        origen: 'pacot', severidad: 'informativa', referencias: g.filas.slice(0, 6).map((r) => `${f.hoja}!${g.col}${r}`), fuentes: [A1],
        observado: g.valor, dimensiones: { referencias: 'abierta' },
      }))
    }
    pendientes.push('La precisión de captura (decimales de Q, V, S, A) depende del formato de celda, que la extracción no conserva: no se evalúa.')
    pendientes.push('El Anexo exige levantar con estación total o GPS de precisión; el comprobador no puede acreditar el método.')
    return [crearResultado({ reglaId: 'INV-007', hallazgos, revisados, identificados, unidad: 'tramos de la ficha I.O.-1', pendientes })]
  },
}
