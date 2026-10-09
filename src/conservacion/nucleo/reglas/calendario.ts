import { aCadena, dec, type Dec } from '../num/decimal'
import type { FuenteNorma, Hallazgo, Regla, Resultado } from '../tipos/regla'
import { crearHallazgo, crearResultado, noEvaluable, textoDeCelda } from './util'

const A3: FuenteNorma = { documento: 'Anexo 3', seccion: '4.2 y 4.3' }
const MANUAL: FuenteNorma = { documento: 'Manual de Conservación 2026', seccion: '8.2' }
const A5: FuenteNorma = { documento: 'Anexo 5', seccion: '3.2 (UM-1)' }

/** Los formatos capturan cantidades con 2 decimales: media unidad del último decimal. */
const PRECISION = dec('0.005')

// ---------------------------------------------------------------------------------------------
// Núcleo puro: reparto mensual
// ---------------------------------------------------------------------------------------------

export interface DiagnosticoReparto {
  /** Índices (0 = primer mes del ciclo) de los meses con valor distinto de cero. */
  readonly activos: readonly number[]
  readonly suma: Dec
  /** Diferencia total declarada − suma de meses; null si no hay total. */
  readonly diferenciaTotal: Dec | null
  readonly uniforme: boolean
  readonly contiguo: boolean
  readonly minimo: Dec | null
  readonly maximo: Dec | null
}

/** Reparto uniforme (Manual §8.2; Anexo 3 §4.3): cantidad mensual = cantidad del periodo / meses del periodo. */
export function analizarReparto(meses: ReadonlyArray<Dec | null>, total: Dec | null, tolerancia: Dec = PRECISION): DiagnosticoReparto {
  const activos: number[] = []
  let suma = dec(0)
  let minimo: Dec | null = null
  let maximo: Dec | null = null
  meses.forEach((v, i) => {
    if (v === null) return
    suma = suma.plus(v)
    if (v.isZero()) return
    activos.push(i)
    minimo = minimo === null || v.lessThan(minimo) ? v : minimo
    maximo = maximo === null || v.greaterThan(maximo) ? v : maximo
  })
  const primero = activos[0]
  const ultimo = activos[activos.length - 1]
  return {
    activos, suma,
    diferenciaTotal: total === null ? null : total.minus(suma),
    uniforme: minimo === null || maximo === null || (maximo as Dec).minus(minimo).lessThanOrEqualTo(tolerancia),
    contiguo: primero === undefined || ultimo === undefined || ultimo - primero + 1 === activos.length,
    minimo, maximo,
  }
}

const listaMeses = (nombres: readonly string[], idx: readonly number[]): string => idx.map((i) => nombres[i] ?? `mes ${i + 1}`).join(', ')

// ---------------------------------------------------------------------------------------------
// DYP-010  Duración y reparto mensual (PO-2, PO-2C, UM-1)
// ---------------------------------------------------------------------------------------------

export const reglaDyp010: Regla = {
  meta: {
    id: 'DYP-010', clase: 'DIAGNÓSTICOS Y PROGRAMA', titulo: 'Duración y reparto mensual del programa',
    severidadBase: 'media', fuentes: [A3, MANUAL, A5], requiereLibro: true, casosOro: ['TC-11'],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('DYP-010', 'Requiere el libro y un perfil de formato')]
    const libro = ctx.libro
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []
    let identificados = 0
    let revisados = 0

    // --- PO-2 / PO-2C: cantidad por mes frente al total
    const cal = ctx.perfil.calendarioMensual
    const nombresPo = cal.meses.map((m) => m.nombre)
    for (const hoja of cal.hojas) {
      if (!libro.hoja(hoja)) { pendientes.push(`${hoja}: la hoja no está en el libro`); continue }
      let concepto = ''
      for (let r = cal.filas.desde; r <= cal.filas.hasta; r++) {
        const c = libro.texto(hoja, `${cal.colConcepto}${r}`)
        if (c !== null && c.trim() !== '') concepto = textoDeCelda(c, 60)
        const unidad = textoDeCelda(libro.texto(hoja, `${cal.colUnidad}${r}`) ?? '', 12)
        if (unidad === '') continue
        const tot = libro.numero(hoja, `${cal.colTotal}${r}`)
        const porMes = cal.meses.map((m): Dec | null => {
          let acum: Dec | null = null
          for (const col of m.columnas) {
            const n = libro.numero(hoja, `${col}${r}`)
            if (n.ok) acum = (acum ?? dec(0)).plus(n.valor)
            else if (n.motivo !== 'vacia' && !/^NO APLICA/i.test(libro.texto(hoja, `${col}${r}`)?.trim() ?? '')) pendientes.push(`${hoja}!${col}${r}: valor mensual ilegible (${n.motivo}); la fila no se evalúa`)
          }
          return acum
        })
        const total = tot.ok ? tot.valor : null
        if (total === null && porMes.every((v) => v === null)) continue
        if (total !== null && total.isZero() && porMes.every((v) => v === null || v.isZero())) continue
        identificados++
        if (total === null) { pendientes.push(`${hoja}!${cal.colTotal}${r}: hay meses capturados pero el total no es numérico`); continue }
        revisados++
        const d = analizarReparto(porMes, total)
        const refTotal = `${hoja}!${cal.colTotal}${r}`
        const base = { reglaId: 'DYP-010', fuentes: [A3, MANUAL], origen: 'pacot' as const, estadoEvidencia: 'verificada_en_archivo' as const }
        const etiqueta = `${concepto} [${unidad}]`
        if (d.activos.length === 0) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-010:${refTotal}:sin_calendario`, titulo: `Cantidad anual sin calendario mensual (${etiqueta})`, severidad: 'media',
            detalle: 'El total es distinto de cero pero ningún mes lo recibe. Programar los meses de ejecución o declarar que no se ejecuta en el ciclo.',
            referencias: [refTotal], esperado: aCadena(total), observado: '0', dimensiones: { aritmetica: 'abierta', referencias: 'abierta' },
          }))
          continue
        }
        const refMeses = cal.meses.filter((_m, i) => d.activos.includes(i)).map((m) => `${hoja}!${m.columnas[0]}${r}`)
        if (d.diferenciaTotal !== null && d.diferenciaTotal.abs().greaterThan(PRECISION)) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-010:${refTotal}:suma_meses`, titulo: `Los meses no suman el total (${etiqueta})`,
            detalle: `La suma de ${d.activos.length} meses (${listaMeses(nombresPo, d.activos)}) es ${aCadena(d.suma)} y el total capturado es ${aCadena(total)}. Una conciliación anual no acredita el calendario.`,
            severidad: unidad === '$' ? 'alta' : 'media', referencias: [refTotal, ...refMeses], esperado: aCadena(total), observado: aCadena(d.suma),
            diferencia: aCadena(d.diferenciaTotal.negated()), dimensiones: { aritmetica: 'abierta', referencias: 'abierta' },
          }))
        }
        if (!d.uniforme && d.minimo !== null && d.maximo !== null) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-010:${refTotal}:no_uniforme`, titulo: `Reparto mensual no uniforme (${etiqueta})`,
            detalle: `El Manual §8.2 reparte la cantidad en partes iguales entre los meses del periodo; aquí los meses activos van de ${aCadena(d.minimo)} a ${aCadena(d.maximo)}. Si la desigualdad es deliberada, sustentarla.`,
            severidad: 'media', referencias: [refTotal, ...refMeses], dimensiones: { aritmetica: 'abierta', referencias: 'verificada' },
          }))
        }
        if (!d.contiguo) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-010:${refTotal}:discontinuo`, titulo: `Meses de ejecución no contiguos (${etiqueta})`,
            detalle: `Meses con programa: ${listaMeses(nombresPo, d.activos)}. Hay meses intermedios sin cantidad; confirmar si es una interrupción prevista.`,
            severidad: 'informativa', referencias: [refTotal, ...refMeses], dimensiones: { aritmetica: 'verificada', referencias: 'abierta' },
          }))
        }
      }
    }

    // --- UM-1: horas por mes frente a horas efectivas
    const um = ctx.perfil.programaMaquinaria
    if (libro.hoja(um.hoja)) {
      const nombresUm = um.meses.map((m) => m.nombre)
      const eo = ctx.parametros.eo.valor
      const divideEo = ctx.parametros.dondeEo.valor === 'divide_horas' && eo !== null
      for (let r = um.filas.desde; r <= um.filas.hasta; r++) {
        const hrs = libro.numero(um.hoja, `${um.colHoras}${r}`)
        const cant = libro.numero(um.hoja, `${um.colCantidad}${r}`)
        const rend = libro.numero(um.hoja, `${um.colRendimiento}${r}`)
        const tipo = textoDeCelda(libro.texto(um.hoja, `${um.colTipo}${r}`) ?? '', 40)
        if (!hrs.ok && !cant.ok) continue
        const porMes = um.meses.map((m): Dec | null => {
          const n = libro.numero(um.hoja, `${m.columna}${r}`)
          return n.ok ? n.valor : null
        })
        const refHoras = `${um.hoja}!${um.colHoras}${r}`
        const etiqueta = `${textoDeCelda(libro.texto(um.hoja, `${um.colConcepto}${r}`) ?? '', 40)} · ${tipo}`.replace(/^ · /, '')
        const base = { reglaId: 'DYP-010', fuentes: [A5, A3], origen: 'pacot' as const, estadoEvidencia: 'verificada_en_archivo' as const }
        identificados++
        if (!hrs.ok) { pendientes.push(`${refHoras}: horas efectivas no numéricas; la fila no se evalúa`); continue }
        revisados++
        // T = Ct / (Ne·R) con Ne = 1: el libro no declara cuántas máquinas trabajan en paralelo
        if (cant.ok && rend.ok && rend.valor.greaterThan(0)) {
          const esperadas = divideEo && eo !== null ? cant.valor.dividedBy(rend.valor.times(eo)) : cant.valor.dividedBy(rend.valor)
          const dif = hrs.valor.minus(esperadas)
          if (dif.abs().greaterThan(PRECISION)) {
            hallazgos.push(crearHallazgo(ctx, {
              ...base, id: `DYP-010:${refHoras}:horas`, titulo: `Horas efectivas distintas de cantidad/rendimiento (${etiqueta})`, severidad: 'media',
              detalle: 'T = Ct/R (con Ne = 1: el libro no declara máquinas en paralelo). Documentar la causa de la diferencia.',
              referencias: [refHoras, `${um.hoja}!${um.colCantidad}${r}`, `${um.hoja}!${um.colRendimiento}${r}`], esperado: aCadena(esperadas),
              observado: aCadena(hrs.valor), diferencia: aCadena(dif), dimensiones: { aritmetica: 'abierta' },
            }))
          }
        }
        if (hrs.valor.isZero() && porMes.every((v) => v === null || v.isZero())) continue
        const d = analizarReparto(porMes, hrs.valor)
        const refMeses = um.meses.filter((_m, i) => d.activos.includes(i)).map((m) => `${um.hoja}!${m.columna}${r}`)
        if (d.diferenciaTotal !== null && d.diferenciaTotal.abs().greaterThan(PRECISION)) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-010:${refHoras}:suma_meses`, titulo: `Las horas mensuales no suman las horas efectivas (${etiqueta})`, severidad: 'media',
            detalle: `Suma mensual ${aCadena(d.suma)} h frente a ${aCadena(hrs.valor)} h efectivas.`,
            referencias: [refHoras, ...refMeses], esperado: aCadena(hrs.valor), observado: aCadena(d.suma), diferencia: aCadena(d.diferenciaTotal.negated()),
            dimensiones: { aritmetica: 'abierta' },
          }))
        }
        if (!d.uniforme && d.minimo !== null && d.maximo !== null) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-010:${refHoras}:no_uniforme`, titulo: `Horas mensuales no uniformes (${etiqueta})`, severidad: 'media',
            detalle: `Meses activos entre ${aCadena(d.minimo)} y ${aCadena(d.maximo)} h.`, referencias: [refHoras, ...refMeses],
            dimensiones: { aritmetica: 'abierta' },
          }))
        }
        if (!d.contiguo) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `DYP-010:${refHoras}:discontinuo`, titulo: `Meses de uso no contiguos (${etiqueta})`, severidad: 'informativa',
            detalle: `Meses con horas: ${listaMeses(nombresUm, d.activos)}.`, referencias: [refHoras, ...refMeses], dimensiones: { aritmetica: 'verificada' },
          }))
        }
      }
    } else {
      pendientes.push(`${um.hoja}: la hoja no está en el libro; no se revisa el programa de maquinaria`)
    }

    pendientes.push('La duración en meses no se deriva de las horas: el libro no declara el número de máquinas en paralelo (Ne). Factibilidad mensual: ver MAQ-012.')
    return [crearResultado({
      reglaId: 'DYP-010', hallazgos, revisados, identificados, unidad: 'filas con programa mensual', pendientes,
    })]
  },
}

// ---------------------------------------------------------------------------------------------
// MAQ-012  Capacidad mensual de la maquinaria
// ---------------------------------------------------------------------------------------------

export interface CapacidadMensual {
  /** Horas por mes que excedan la capacidad. */
  readonly excesos: ReadonlyArray<{ readonly mes: number; readonly horas: Dec; readonly capacidad: Dec }>
  readonly pico: Dec
}

/** Σ horas del tipo en el mes ≤ máquinas elegibles × horas por mes. */
export function verificarCapacidad(horasPorMes: readonly Dec[], maquinas: Dec, horasMes: Dec): CapacidadMensual {
  const capacidad = maquinas.times(horasMes)
  const excesos: Array<{ mes: number; horas: Dec; capacidad: Dec }> = []
  let pico = dec(0)
  horasPorMes.forEach((h, mes) => {
    if (h.greaterThan(pico)) pico = h
    if (h.greaterThan(capacidad.plus(PRECISION))) excesos.push({ mes, horas: h, capacidad })
  })
  return { excesos, pico }
}

const normalizarTipo = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

export const reglaMaq012: Regla = {
  meta: {
    id: 'MAQ-012', clase: 'UTILIZACIÓN DE MAQUINARIA', titulo: 'Capacidad mensual y concentración del programa de maquinaria',
    severidadBase: 'alta', fuentes: [A5, A3], requiereLibro: true, casosOro: ['TC-11'],
  },
  evaluar(ctx): Resultado[] {
    if (!ctx.libro || !ctx.perfil) return [noEvaluable('MAQ-012', 'Requiere el libro y un perfil de formato')]
    const libro = ctx.libro
    const um = ctx.perfil.programaMaquinaria
    const bm = ctx.perfil.tablaMaquinaria
    if (!libro.hoja(um.hoja) || !libro.hoja(bm.hoja)) return [noEvaluable('MAQ-012', `Requiere las hojas ${um.hoja} y ${bm.hoja}`)]
    const horasMes = ctx.parametros.horasMes.valor
    const htMes = ctx.parametros.ht.valor.dividedBy(12)
    const hallazgos: Hallazgo[] = []
    const pendientes: string[] = []

    // Parque por tipo de la tabla de necesidades: existentes y elegibles (buenas + regulares)
    const parque = new Map<string, { nombre: string; fila: number; existentes: Dec; elegibles: Dec }>()
    for (let r = bm.filas.desde; r <= bm.filas.hasta; r++) {
      const nombre = libro.texto(bm.hoja, `${bm.colTipo}${r}`)
      if (nombre === null || nombre.trim() === '') continue
      const ex = libro.numero(bm.hoja, `${bm.colExistentes}${r}`)
      const br = libro.numero(bm.hoja, `${bm.colBuenoRegular}${r}`)
      parque.set(normalizarTipo(nombre), {
        nombre: textoDeCelda(nombre, 50), fila: r, existentes: ex.ok ? ex.valor : dec(0), elegibles: br.ok ? br.valor : dec(0),
      })
    }

    // Horas por tipo de balance y mes
    const horas = new Map<string, Dec[]>()
    const filasDe = new Map<string, number[]>()
    const totalMes: Dec[] = um.meses.map(() => dec(0))
    let identificados = 0
    for (let r = um.filas.desde; r <= um.filas.hasta; r++) {
      const tipoUm = libro.texto(um.hoja, `${um.colTipo}${r}`)
      if (tipoUm === null || tipoUm.trim() === '') continue
      const mensual = um.meses.map((m) => libro.numero(um.hoja, `${m.columna}${r}`))
      const conHoras = mensual.some((n) => n.ok && !n.valor.isZero())
      if (!conHoras) continue
      identificados++
      mensual.forEach((n, i) => { if (n.ok) totalMes[i] = (totalMes[i] ?? dec(0)).plus(n.valor) })
      const clave = normalizarTipo(tipoUm)
      const destino = um.equivalenciasTipo[clave]
      if (destino === undefined) { pendientes.push(`${um.hoja}!${um.colTipo}${r}: el tipo "${textoDeCelda(tipoUm, 40)}" no tiene equivalencia declarada en el balance; sus horas no se comparan con el parque`); continue }
      const acum = horas.get(destino) ?? um.meses.map(() => dec(0))
      mensual.forEach((n, i) => { if (n.ok) acum[i] = (acum[i] ?? dec(0)).plus(n.valor) })
      horas.set(destino, acum)
      filasDe.set(destino, [...(filasDe.get(destino) ?? []), r])
    }

    let revisados = 0
    for (const [destino, porMes] of [...horas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const p = parque.get(destino)
      const refsUm = (filasDe.get(destino) ?? []).map((r) => `${um.hoja}!${um.colTipo}${r}`)
      if (!p) { pendientes.push(`${destino}: el tipo no está en la tabla de necesidades ${bm.hoja}; capacidad no verificable`); continue }
      revisados++
      const nombresMeses = um.meses.map((m) => m.nombre)
      const refParque = `${bm.hoja}!${bm.colBuenoRegular}${p.fila}`
      const base = { reglaId: 'MAQ-012', fuentes: [A5, A3], origen: 'pacot' as const, estadoEvidencia: 'pendiente_de_evidencia' as const, parametros: ['PAR-01', 'PAR-07'] as const }
      const cap = verificarCapacidad(porMes, p.elegibles, horasMes)
      if (cap.excesos.length > 0) {
        const peor0 = cap.excesos.reduce((a, b) => (b.horas.minus(b.capacidad).greaterThan(a.horas.minus(a.capacidad)) ? b : a))
        const peor = { ...peor0, horas: peor0.horas.toDecimalPlaces(2) }
        hallazgos.push(crearHallazgo(ctx, {
          ...base, id: `MAQ-012:${p.nombre}:capacidad`, titulo: `Horas mensuales superan la capacidad del parque elegible (${p.nombre})`,
          detalle: `${p.elegibles.toFixed()} máquina(s) en buen estado o regular × ${aCadena(horasMes)} h/mes = ${aCadena(peor.capacidad)} h; el programa pide hasta ${aCadena(peor.horas)} h en ${nombresMeses[peor.mes] ?? '?'} (${cap.excesos.length} mes(es) excedidos: ${listaMeses(nombresMeses, cap.excesos.map((e) => e.mes))}). Solo el parque en buen estado o regular cuenta como capacidad (criterio del usuario, 2026-10-09); de las ${p.existentes.toFixed()} existentes, el resto está en mal estado o de baja.`,
          severidad: 'alta', referencias: [refParque, ...refsUm],
          esperado: aCadena(peor.capacidad), observado: aCadena(peor.horas), diferencia: aCadena(peor.horas.minus(peor.capacidad)),
          dimensiones: { viabilidad: 'abierta', aritmetica: 'verificada', condicion_fisica: 'pendiente' },
        }))
      } else {
        const sens = verificarCapacidad(porMes, p.elegibles, htMes)
        if (sens.excesos.length > 0) {
          hallazgos.push(crearHallazgo(ctx, {
            ...base, id: `MAQ-012:${p.nombre}:sensibilidad_ht`, titulo: `Cabe con ${aCadena(horasMes)} h/mes pero no con Ht/12 (${p.nombre})`,
            detalle: `El pico es ${aCadena(cap.pico)} h/mes. Con la base anual (Ht ${ctx.parametros.ht.valor.toFixed()} h ÷ 12 = ${aCadena(htMes.toDecimalPlaces(2))} h/mes) la capacidad de ${p.elegibles.toFixed()} máquina(s) elegible(s) es ${aCadena(sens.excesos[0]?.capacidad.toDecimalPlaces(2) ?? dec(0))} h/mes. Las dos bases del Anexo 3 y del Manual no son coherentes entre sí (PAR-07 frente a PAR-01).`,
            severidad: 'informativa', origen: 'norma', referencias: [refParque, ...refsUm],
            dimensiones: { viabilidad: 'abierta', aritmetica: 'verificada' },
          }))
        }
      }
    }

    // Concentración: meses con horas frente a los doce del ciclo
    const activos = totalMes.map((h, i) => (h.greaterThan(0) ? i : -1)).filter((i) => i >= 0)
    if (activos.length > 0 && activos.length < totalMes.length) {
      const total = totalMes.reduce((a, b) => a.plus(b), dec(0))
      hallazgos.push(crearHallazgo(ctx, {
        reglaId: 'MAQ-012', id: `MAQ-012:${um.hoja}:concentracion`, titulo: `Todo el programa de maquinaria cae en ${activos.length} de ${totalMes.length} meses`,
        detalle: `Meses con horas: ${listaMeses(um.meses.map((m) => m.nombre), activos)} (${aCadena(total.toDecimalPlaces(2))} h en total). La concentración no es un error por sí misma, pero exige sustentar la ventana (canal sin agua, temporada de lluvias) y que ninguna máquina supere su capacidad en esos meses.`,
        origen: 'pacot', severidad: 'informativa', referencias: [`${um.hoja}!${um.colHoras}${um.filas.desde}:${um.colHoras}${um.filas.hasta}`],
        fuentes: [A5, A3], estadoEvidencia: 'pendiente_de_evidencia', parametros: ['PAR-07'],
        dimensiones: { viabilidad: 'abierta', aritmetica: 'verificada' },
      }))
    }

    pendientes.push('Solo hay meses: la compatibilidad diaria, la disponibilidad por fecha y los operadores no se pueden verificar con este libro.')
    pendientes.push('Capacidad elegible = máquinas en buen estado o regular (las malas y de baja no cuentan). Equivalencias UM-1 → balance confirmadas por el usuario.')
    return [crearResultado({
      reglaId: 'MAQ-012', hallazgos, revisados, identificados, unidad: 'filas de UM-1 con horas', pendientes,
    })]
  },
}
