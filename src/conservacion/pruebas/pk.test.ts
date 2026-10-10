import { describe, expect, it } from 'vitest'
import { limpiarPK } from '../nucleo/num/pk'

describe('limpiarPK · cadenamientos sucios reales de IO4/IO1', () => {
  it(' K-0+000 → 0+000 (0 m)', () => {
    expect(limpiarPK(' K-0+000')).toMatchObject({ pk: '0+000', metros: 0, estado: 'completo', margen: null, nota: null })
  })
  it('K-98+951 → 98 951 m (98 × 1000 + 951)', () => {
    expect(limpiarPK('K-98+951')).toMatchObject({ pk: '98+951', metros: 98951 })
  })
  it('« K-44+ (AUTOPISTA)» → PK parcial: solo el kilómetro 44, sin metros ni PK', () => {
    expect(limpiarPK(' K-44+ (AUTOPISTA)')).toMatchObject({ pk: null, metros: null, kmParcial: 44, estado: 'parcial' })
  })
  it('«TK-39+940-I (CANO) BOMBEO» → 39+940, margen izquierdo, nota «(CANO) BOMBEO»', () => {
    expect(limpiarPK('TK-39+940-I (CANO) BOMBEO')).toMatchObject({ pk: '39+940', metros: 39940, margen: 'I', nota: '(CANO) BOMBEO', estado: 'completo' })
  })
  it('«K-1+370 (LK-72+600, M-3)» toma el primer PK (1+370); el paréntesis es nota, no margen', () => {
    expect(limpiarPK('K-1+370 (LK-72+600, M-3)')).toMatchObject({ pk: '1+370', metros: 1370, margen: null, nota: '(LK-72+600, M-3)' })
  })
  it('« K-79-025» → sin PK (el «-» no es «+»): no se adivina que sea 79+025', () => {
    expect(limpiarPK(' K-79-025')).toMatchObject({ pk: null, metros: null, estado: 'ilegible' })
  })
  it('espacio tras el guion y prefijos de captura: « K- 23+765», «.K-39+405-I», «T K-57+152», «E K-48+800»', () => {
    expect(limpiarPK(' K- 23+765')).toMatchObject({ pk: '23+765', metros: 23765 })
    expect(limpiarPK('.K-39+405-I')).toMatchObject({ pk: '39+405', margen: 'I' })
    expect(limpiarPK('T K-57+152')).toMatchObject({ pk: '57+152' })
    expect(limpiarPK('E K-48+800')).toMatchObject({ pk: '48+800' })
  })
  it('margen en texto: « K-69+210 M.D.» → D; « K-50+500 M.I. (LOS PINOS)» → I; « K-55+360  (MOD-12)» no tiene margen', () => {
    expect(limpiarPK(' K-69+210 M.D.')).toMatchObject({ pk: '69+210', margen: 'D' })
    expect(limpiarPK(' K-50+500 M.I. (LOS PINOS)')).toMatchObject({ pk: '50+500', margen: 'I' })
    expect(limpiarPK(' K-55+360  (MOD-12)')).toMatchObject({ pk: '55+360', margen: null })
  })
  it('sufijo «-1» (« K-38+004-1   (SALCIDO) BOMBEO») no es margen: se conserva en la nota', () => {
    const r = limpiarPK(' K-38+004-1   (SALCIDO) BOMBEO')
    expect(r).toMatchObject({ pk: '38+004', margen: null })
    expect(r.nota).toContain('SALCIDO')
  })
  it('«K-2+286 (INICIA LK-73+900, M-4)» → 2+286', () => {
    expect(limpiarPK('K-2+286 (INICIA LK-73+900, M-4)')).toMatchObject({ pk: '2+286', metros: 2286 })
  })
  it('metros ≥ 1000 → ilegible (K-5+1500 no existe)', () => {
    expect(limpiarPK('K-5+1500')).toMatchObject({ pk: null, estado: 'ilegible' })
  })
  it('vacío o sin forma de PK → ilegible con motivo, nunca 0', () => {
    for (const t of [null, undefined, '', '   ', 'AUTOPISTA', 'sin dato']) {
      const r = limpiarPK(t)
      expect(r.pk, String(t)).toBeNull()
      expect(r.metros).toBeNull()
      expect(r.motivo).not.toBeNull()
    }
  })
  it('un PK numérico no es un cadenamiento (3520 no es 3+520): ilegible', () => {
    expect(limpiarPK(3520).pk).toBeNull()
  })
})
