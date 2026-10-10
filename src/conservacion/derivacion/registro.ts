import { dec } from '../nucleo/num/decimal'
import type { Dec } from '../nucleo/num/decimal'
import type { FichaPacot } from './admision'
import type { Cifra, LibroDerivado, NecesidadMedia } from './tipos'

/**
 * Registro de PacOT admitidos: una ranura para la SRL y una por módulo, por ciclo. Funciones puras e inmutables.
 * El registro es la regla: los acumulados se calculan solo con lo registrado y declaran lo que falta.
 */

/**
 * Módulos de la SRL Unidad Conchos que deben tener PacOT: MOD-001, 002, 003, 004, 005 y 012
 * (tabla `modulos`/`modulo_zonas`, confirmada en BD). El PacOT los encabeza con su número ("05. …").
 */
export const MODULOS_ESPERADOS: readonly number[] = [1, 2, 3, 4, 5, 12]

export interface PacotRegistrado {
  readonly clave: string
  readonly ficha: FichaPacot
  readonly libro: LibroDerivado
  readonly archivoNombre: string
  readonly version: number
  readonly registradoEn: string
}

export type Registro = ReadonlyMap<string, PacotRegistrado>

export const claveDe = (f: FichaPacot): string => `${f.ciclo}|${f.tipo === 'SRL' ? 'SRL' : `M${String(f.numeroModulo).padStart(2, '0')}`}`

/** 'reprocesado': mismo libro (SHA-256) leído con un extractor más nuevo; la versión del PacOT no sube. */
export type EstadoRegistro = 'nuevo' | 'sin_cambio' | 'nueva_version' | 'reprocesado'

export function registrar(
  reg: Registro,
  entrada: { ficha: FichaPacot; libro: LibroDerivado; archivoNombre: string },
  ahora: string,
): { registro: Registro; estado: EstadoRegistro; pacot: PacotRegistrado } {
  const clave = claveDe(entrada.ficha)
  const previo = reg.get(clave)
  if (previo && previo.libro.sha256 === entrada.libro.sha256) {
    if (previo.libro.extractorVersion === entrada.libro.extractorVersion) return { registro: reg, estado: 'sin_cambio', pacot: previo }
    const re: PacotRegistrado = { ...previo, ficha: entrada.ficha, libro: entrada.libro, archivoNombre: entrada.archivoNombre, registradoEn: ahora }
    return { registro: new Map(reg).set(clave, re), estado: 'reprocesado', pacot: re }
  }
  const pacot: PacotRegistrado = {
    clave, ficha: entrada.ficha, libro: entrada.libro, archivoNombre: entrada.archivoNombre,
    version: (previo?.version ?? 0) + 1, registradoEn: ahora,
  }
  const sig = new Map(reg)
  sig.set(clave, pacot)
  return { registro: sig, estado: previo ? 'nueva_version' : 'nuevo', pacot }
}

export interface EstadoCiclo {
  readonly ciclo: string
  readonly srl: PacotRegistrado | null
  readonly modulos: readonly PacotRegistrado[]
  readonly modulosFaltantes: readonly number[]
  readonly completo: boolean
}

export function estadoDelCiclo(reg: Registro, ciclo: string, esperados: readonly number[] = MODULOS_ESPERADOS): EstadoCiclo {
  const todos = [...reg.values()].filter((p) => p.ficha.ciclo === ciclo)
  const modulos = todos.filter((p) => p.ficha.tipo === 'MODULO').sort((a, b) => (a.ficha.numeroModulo ?? 0) - (b.ficha.numeroModulo ?? 0))
  const presentes = new Set(modulos.map((p) => p.ficha.numeroModulo))
  const modulosFaltantes = esperados.filter((n) => !presentes.has(n))
  const srl = todos.find((p) => p.ficha.tipo === 'SRL') ?? null
  return { ciclo, srl, modulos, modulosFaltantes, completo: srl !== null && modulosFaltantes.length === 0 }
}

/* ---------- Concentrado y conciliación ---------- */

export type Magnitud = 'cantidadTrabajo' | 'necesidadAnual' | 'importe'
export const MAGNITUDES: readonly Magnitud[] = ['cantidadTrabajo', 'necesidadAnual', 'importe']

export interface TolerCon { readonly absoluta: Dec; readonly descripcion: string }
/** Los libros redondean a centavo (importe) o milésima (cantidad); la tolerancia se declara, no se oculta. */
export const TOLERANCIA_CONCILIACION: TolerCon = { absoluta: dec('0.01'), descripcion: '±0.01 (redondeo de captura del libro)' }

/** 'no_aplica_srl': la SRL no tiene esa red en su inventario (p. ej. drenes); no se compara contra ella. */
export type EstadoConciliacion = 'coincide' | 'difiere' | 'sin_srl' | 'sin_modulos' | 'incompleto' | 'no_aplica_srl'

export interface FilaConcentrado {
  readonly bloque: string
  readonly concepto: string
  readonly magnitud: Magnitud
  /** Valor de cada módulo registrado (null = celda vacía; nunca cero). */
  readonly porModulo: ReadonlyArray<{ readonly numeroModulo: number; readonly valor: string | null; readonly ref: string | null }>
  /** Σ módulos; null si algún módulo registrado no trae el dato (acumulado incompleto). */
  readonly sumaModulos: string | null
  readonly srl: string | null
  readonly diferencia: string | null
  readonly estado: EstadoConciliacion
}

const claveConcepto = (n: NecesidadMedia): string => `${n.bloque}|${n.concepto.toLowerCase().replace(/\s+/g, ' ').trim()}`

const valorDe = (n: NecesidadMedia | undefined, m: Magnitud): Cifra | null => (n ? n[m] : null)

export function concentrar(estado: EstadoCiclo, tol: TolerCon = TOLERANCIA_CONCILIACION): FilaConcentrado[] {
  const claves = new Map<string, { bloque: string; concepto: string }>()
  const indexar = (l: LibroDerivado): Map<string, NecesidadMedia> => {
    const mapa = new Map<string, NecesidadMedia>()
    for (const n of l.necesidades) {
      const k = claveConcepto(n)
      if (!mapa.has(k)) mapa.set(k, n)
      if (!claves.has(k)) claves.set(k, { bloque: n.bloque, concepto: n.concepto })
    }
    return mapa
  }
  const idxSrl = estado.srl ? indexar(estado.srl.libro) : null
  const srlSinDrenes = estado.srl !== null && estado.srl.libro.inventarioKm.drenaje.valor !== null
    && Number(estado.srl.libro.inventarioKm.drenaje.valor) === 0
  const idxMod = estado.modulos.map((p) => ({ p, idx: indexar(p.libro) }))

  const filas: FilaConcentrado[] = []
  for (const [k, { bloque, concepto }] of claves) {
    for (const magnitud of MAGNITUDES) {
      const porModulo = idxMod.map(({ p, idx }) => {
        const c = valorDe(idx.get(k), magnitud)
        return { numeroModulo: p.ficha.numeroModulo ?? 0, valor: c?.valor ?? null, ref: c?.ref ?? null }
      })
      const completo = porModulo.length > 0 && porModulo.every((x) => x.valor !== null)
      const sumaModulos = completo ? porModulo.reduce((a, x) => a.plus(dec(x.valor ?? '0')), dec(0)) : null
      const srlCifra = idxSrl ? valorDe(idxSrl.get(k), magnitud) : null
      const srl = srlCifra?.valor ?? null
      let diferencia: Dec | null = null
      let est: EstadoConciliacion
      if (srlSinDrenes && /^RED DE DRENAJE/i.test(bloque)) est = 'no_aplica_srl'
      else if (porModulo.length === 0) est = 'sin_modulos'
      else if (!idxSrl || srl === null) est = 'sin_srl'
      else if (sumaModulos === null) est = 'incompleto'
      else {
        diferencia = sumaModulos.minus(dec(srl))
        est = diferencia.abs().lessThanOrEqualTo(tol.absoluta) ? 'coincide' : 'difiere'
      }
      filas.push({
        bloque, concepto, magnitud, porModulo,
        sumaModulos: sumaModulos?.toFixed() ?? null, srl,
        diferencia: diferencia?.toFixed() ?? null, estado: est,
      })
    }
  }
  return filas
}
