import { dec } from '../nucleo/num/decimal'
import type { FichaCamino, FichaCanal, LibroDerivado, TipoRed, TramoDiagnostico } from '../derivacion/tipos'
import { PARAMETROS_VERIF } from './parametros'

export type FichaRed = FichaCanal | FichaCamino

export interface UnionTramo {
  readonly tramo: TramoDiagnostico
  /** null: el tramo no tiene ficha en el inventario. */
  readonly ficha: FichaRed | null
  /** 'inventario_pk': mismo número de inventario y mismos PK; 'inventario_km': mismo inventario y longitud pero PK distintos o ilegibles. */
  readonly por: 'inventario_pk' | 'inventario_km' | null
}

export interface Uniones {
  readonly uniones: readonly UnionTramo[]
  /** Fichas del inventario que ningún tramo del diagnóstico usa. */
  readonly fichasSinTramo: ReadonlyArray<{ readonly red: TipoRed; readonly ficha: FichaRed }>
}

const claveInv = (t: string): string => t.trim().toUpperCase().replace(/\.0+$/, '')

/** El bloque de tubería (IO1.a) no tiene hoja de fichas extraída: sus tramos no se emparejan. */
function fichasDeRed(libro: LibroDerivado, red: TipoRed): readonly FichaRed[] {
  if (red === 'distribucion') return libro.fichas.canales
  if (red === 'drenaje') return libro.fichas.drenes
  if (red === 'caminos') return libro.fichas.caminos
  return []
}

/**
 * Une cada tramo de DIAG-01 con su ficha de inventario por red + número de inventario + PK. El inventario no es único
 * (un canal se parte en varios tramos): lo que desambigua es el PK. Cada ficha se usa una sola vez.
 */
export function unirTramosConFichas(libro: LibroDerivado): Uniones {
  const disponibles = new Map<TipoRed, FichaRed[]>()
  for (const red of ['distribucion', 'drenaje', 'caminos'] as const) disponibles.set(red, [...fichasDeRed(libro, red)])

  const sacar = (red: TipoRed, buscar: (f: FichaRed) => boolean): FichaRed | null => {
    const lista = disponibles.get(red)
    if (!lista) return null
    const i = lista.findIndex(buscar)
    if (i < 0) return null
    return lista.splice(i, 1)[0] ?? null
  }

  const uniones: UnionTramo[] = []
  for (const tramo of libro.tramos) {
    const inv = claveInv(tramo.inventario)
    let ficha = sacar(tramo.red, (f) => claveInv(f.inventario) === inv && f.pkInicial === tramo.pkInicial && f.pkFinal === tramo.pkFinal)
    let por: UnionTramo['por'] = ficha ? 'inventario_pk' : null
    if (!ficha) {
      // Mismo inventario y misma longitud pero PK distintos o ilegibles: se empareja y la integridad reporta la diferencia de PK.
      const km = tramo.km.valor === null ? null : dec(tramo.km.valor)
      ficha = km === null ? null : sacar(tramo.red, (f) => claveInv(f.inventario) === inv && f.km.valor !== null
        && dec(f.km.valor).minus(km).abs().lessThanOrEqualTo(PARAMETROS_VERIF.tolKm.valor))
      if (ficha) por = 'inventario_km'
    }
    uniones.push({ tramo, ficha, por })
  }

  const fichasSinTramo = [...disponibles].flatMap(([red, lista]) => lista.map((ficha) => ({ red, ficha })))
  return { uniones, fichasSinTramo }
}
