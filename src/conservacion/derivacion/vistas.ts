import { dec } from '../nucleo/num/decimal'
import type { Dec } from '../nucleo/num/decimal'
import { TOLERANCIA_CONCILIACION } from './registro'
import type { Cifra, ConceptoTramo, LibroDerivado, NecesidadMedia, RenglonPrograma, TipoRed, TramoDiagnostico } from './tipos'

/** Funciones puras que arman lo que la pantalla muestra. Toda aritmética es Decimal; nada vacío se vuelve cero. */

export type EstadoVerificacion = 'coincide' | 'difiere' | 'no_evaluable'

export interface Verificacion {
  readonly descripcion: string
  readonly esperado: string | null
  readonly observado: string | null
  readonly diferencia: string | null
  readonly estado: EstadoVerificacion
}

export interface PasoCadena {
  readonly etiqueta: string
  /** Operación que el libro declara en esa celda, en palabras. */
  readonly operacion: string | null
  readonly cifra: Cifra
}

export interface CadenaConcepto {
  readonly necesidad: NecesidadMedia
  readonly pasos: readonly PasoCadena[]
  readonly verificaciones: readonly Verificacion[]
  /** Columna de DIAG-01 de la que sale la cantidad de trabajo, si se pudo ligar. */
  readonly diagnostico: ConceptoTramo | null
  readonly ligadoPor: 'formula' | 'nombre' | null
}

export const quitaAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

function comparar(descripcion: string, esperado: Dec | null, observado: Dec | null): Verificacion {
  if (esperado === null || observado === null) {
    return { descripcion, esperado: esperado?.toFixed() ?? null, observado: observado?.toFixed() ?? null, diferencia: null, estado: 'no_evaluable' }
  }
  const dif = observado.minus(esperado)
  return {
    descripcion, esperado: esperado.toFixed(), observado: observado.toFixed(), diferencia: dif.toFixed(),
    estado: dif.abs().lessThanOrEqualTo(TOLERANCIA_CONCILIACION.absoluta) ? 'coincide' : 'difiere',
  }
}
const D = (c: Cifra): Dec | null => (c.valor === null ? null : dec(c.valor))

/** Liga un concepto de 3DN con su columna de DIAG-01: por la fórmula (`DIAG-01!$I$15`) o, si no, por el nombre. */
export function ligarDiagnostico(libro: LibroDerivado, n: NecesidadMedia): { concepto: ConceptoTramo | null; por: 'formula' | 'nombre' | null } {
  if (n.enlaceDiagnostico) {
    const sufijo = `${n.enlaceDiagnostico.columna}${n.enlaceDiagnostico.fila}`
    const c = libro.totalesDiagnostico.find((t) => t.trabajo.ref.endsWith(`!${sufijo}`))
    if (c) return { concepto: c, por: 'formula' }
  }
  const nombre = quitaAcentos(n.concepto)
  const c = libro.totalesDiagnostico.find((t) => quitaAcentos(t.concepto) === nombre)
  return c ? { concepto: c, por: 'nombre' } : { concepto: null, por: null }
}

export function cadenaDeConcepto(libro: LibroDerivado, n: NecesidadMedia): CadenaConcepto {
  const lig = ligarDiagnostico(libro, n)
  const pasos: PasoCadena[] = [
    { etiqueta: `Cantidad paramétrica${n.unidadParametrica ? ` (${n.unidadParametrica})` : ''}`, operacion: null, cifra: n.cantidadParametrica },
    { etiqueta: `Cantidad total de trabajo${n.unidadTrabajo ? ` (${n.unidadTrabajo})` : ''}`, operacion: lig.concepto ? `total de «${lig.concepto.concepto}» en DIAG-01` : null, cifra: n.cantidadTrabajo },
    { etiqueta: `Frecuencia${n.etiquetaFrecuencia ? ` · rótulo del libro: ${n.etiquetaFrecuencia}` : ''}`, operacion: null, cifra: n.frecuencia },
    { etiqueta: 'Necesidad media anual', operacion: 'cantidad de trabajo × frecuencia', cifra: n.necesidadAnual },
    { etiqueta: 'Precio unitario ($)', operacion: null, cifra: n.pu },
    { etiqueta: 'Importe ($)', operacion: 'necesidad anual × precio unitario', cifra: n.importe },
  ]
  const e = D(n.cantidadTrabajo), f = D(n.frecuencia), h = D(n.necesidadAnual), pu = D(n.pu), j = D(n.importe)
  const verificaciones: Verificacion[] = [
    comparar('Necesidad anual = cantidad de trabajo × frecuencia', e && f ? e.times(f) : null, h),
    comparar('Importe = necesidad anual × precio unitario', h && pu ? h.times(pu) : null, j),
  ]
  if (lig.concepto) verificaciones.push(comparar('Cantidad de trabajo = total de DIAG-01', D(lig.concepto.trabajo), e))
  return { necesidad: n, pasos, verificaciones, diagnostico: lig.concepto, ligadoPor: lig.por }
}

/* ---------- Tramos ---------- */

export interface ObraAgrupada {
  readonly inventario: string
  readonly obra: string
  readonly kmTotal: string | null
  readonly tramos: readonly TramoDiagnostico[]
  /** Σ de cantidad de trabajo por concepto (null si algún tramo no trae el dato). */
  readonly sumaTrabajo: ReadonlyArray<{ readonly concepto: string; readonly suma: string | null }>
}
export interface RedAgrupada { readonly red: TipoRed; readonly obras: readonly ObraAgrupada[] }

export const ROTULO_RED: Readonly<Record<TipoRed, string>> = {
  distribucion: 'Red de distribución (canales)', tuberia: 'Red de distribución en tubería (sección circular)', drenaje: 'Red de drenaje (drenes)', caminos: 'Red de caminos', otro: 'Otras',
}

export function sumar(valores: ReadonlyArray<string | null>): string | null {
  if (valores.length === 0 || valores.some((v) => v === null)) return null
  return valores.reduce<Dec>((a, v) => a.plus(dec(v ?? '0')), dec(0)).toFixed()
}

export function agruparTramos(libro: LibroDerivado): RedAgrupada[] {
  const porRed = new Map<TipoRed, Map<string, TramoDiagnostico[]>>()
  for (const t of libro.tramos) {
    const obras: Map<string, TramoDiagnostico[]> = porRed.get(t.red) ?? new Map<string, TramoDiagnostico[]>()
    const clave = `${t.inventario}|${t.obra}`
    obras.set(clave, [...(obras.get(clave) ?? []), t])
    porRed.set(t.red, obras)
  }
  const orden: TipoRed[] = ['distribucion', 'tuberia', 'drenaje', 'caminos', 'otro']
  return orden.filter((r) => porRed.has(r)).map((red) => ({
    red,
    obras: [...(porRed.get(red) ?? new Map<string, TramoDiagnostico[]>()).values()].map((tramos): ObraAgrupada => ({
      inventario: tramos[0]?.inventario ?? '', obra: tramos[0]?.obra ?? '',
      kmTotal: sumar(tramos.map((t) => t.km.valor)), tramos,
      sumaTrabajo: libro.conceptosDiagnostico.map((concepto, i) => ({ concepto, suma: sumar(tramos.map((t) => t.conceptos[i]?.trabajo.valor ?? null)) })),
    })),
  }))
}

/**
 * Σ de tramos contra la fila de totales de DIAG-01. El total declara su rango (`SUM(E16:E76)`): se suman los
 * tramos de ESAS filas, no todos; si la fórmula no se puede leer, se suman todos y se dice.
 */
export function verificarTotalesDiagnostico(libro: LibroDerivado): Verificacion[] {
  return libro.conceptosDiagnostico.map((concepto, i) => {
    const total = libro.totalesDiagnostico[i]?.trabajo ?? null
    const m = total?.formula ? /SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)/i.exec(total.formula) : null
    const desde = m?.[1] !== undefined ? Number(m[1]) : null
    const hasta = m?.[2] !== undefined ? Number(m[2]) : null
    const dentro = libro.tramos.filter((t) => desde === null || hasta === null || (t.fila >= desde && t.fila <= hasta))
    const s = sumar(dentro.map((t) => t.conceptos[i]?.trabajo.valor ?? null))
    const alcance = desde !== null && hasta !== null ? `filas ${desde}–${hasta}` : 'todos los tramos'
    return comparar(`DIAG-01 · ${concepto}: Σ tramos (${alcance}) = fila de totales`, total ? D(total) : null, s === null ? null : dec(s))
  })
}

/* ---------- Programa ---------- */

export interface GrupoPrograma {
  readonly encabezado: string
  readonly red: TipoRed
  readonly renglones: readonly RenglonPrograma[]
  readonly cantidad: string | null
  readonly importe: string | null
  readonly unidad: string | null
}

export function agruparPrograma(libro: LibroDerivado): GrupoPrograma[] {
  const mapa = new Map<string, RenglonPrograma[]>()
  for (const r of libro.programa) {
    const k = `${r.red}|${r.encabezado}`
    mapa.set(k, [...(mapa.get(k) ?? []), r])
  }
  return [...mapa.values()].map((renglones) => {
    const unidades = new Set(renglones.map((r) => r.unidad))
    return {
      encabezado: renglones[0]?.encabezado ?? '', red: renglones[0]?.red ?? 'otro', renglones,
      // Σ de cantidades solo si todas están en la misma unidad: sumar ha con m³ no tiene sentido.
      cantidad: unidades.size === 1 ? sumar(renglones.map((r) => r.cantidad.valor)) : null,
      importe: sumar(renglones.map((r) => r.importe.valor)),
      unidad: unidades.size === 1 ? ([...unidades][0] ?? null) : null,
    }
  })
}
