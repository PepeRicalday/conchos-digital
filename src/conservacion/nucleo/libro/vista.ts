import { dec } from '../num/decimal'
import type { Celda, Formula, Hoja, LecturaNumero, LibroNormalizado, RefCelda } from '../tipos/libro'

/** Acceso de solo lectura al libro. Nada se convierte en cero por comodidad. */
export class VistaLibro {
  readonly libro: LibroNormalizado

  constructor(libro: LibroNormalizado) {
    this.libro = libro
  }

  hojas(): readonly string[] {
    return [...this.libro.hojas.keys()]
  }

  hoja(nombre: string): Hoja | undefined {
    return this.libro.hojas.get(nombre)
  }

  celda(hoja: string, celda: string): Celda | undefined {
    return this.libro.hojas.get(hoja)?.celdas.get(celda)
  }

  formula(hoja: string, celda: string): Formula | undefined {
    return this.libro.hojas.get(hoja)?.formulas.get(celda)
  }

  numero(hoja: string, celda: string): LecturaNumero {
    const ref: RefCelda = { hoja, celda }
    const h = this.libro.hojas.get(hoja)
    if (!h) return { ok: false, motivo: 'sin_hoja', ref }
    const c = h.celdas.get(celda)
    if (!c) return { ok: false, motivo: 'vacia', ref }
    switch (c.tipo) {
      case 'numero': return { ok: true, valor: dec(c.valor), ref }
      case 'texto': return { ok: false, motivo: 'texto', ref }
      case 'error': return { ok: false, motivo: 'error', ref }
      case 'otro': return { ok: false, motivo: 'otro', ref }
    }
  }

  texto(hoja: string, celda: string): string | null {
    const c = this.celda(hoja, celda)
    return c?.tipo === 'texto' ? c.valor : null
  }
}

export const refTexto = (hoja: string, celda: string): string => `${hoja}!${celda}`
