import { dec } from '../nucleo/num/decimal'
import type { Dec } from '../nucleo/num/decimal'
import { coherenciaHidraulica } from '../nucleo/reglas/ficha'
import type { Cifra, FichaCanal, TipoRed } from '../derivacion/tipos'
import { quitaAcentos } from '../derivacion/vistas'
import { familia } from './criterio'
import { PARAMETROS_VERIF } from './parametros'
import type { EstadoVerif, ResultadoVerif } from './tipos'
import type { UnionTramo, Uniones } from './uniones'

/**
 * Nivel 3 · Razonabilidad física: comprueba si las cifras del diagnóstico son físicamente posibles y razonables dada la
 * sección y el gasto del propio inventario. No depende del criterio de cantidades del libro. Cada resultado declara su base:
 * `norma` (un umbral del Manual/Anexos) o `referencia_tecnica` (práctica general, no normativa).
 */

const D = (c: Cifra): Dec | null => (c.valor === null ? null : dec(c.valor))
const num = (c: Cifra): number | null => (c.valor === null ? null : Number(c.valor))
const cinco = (x: number): string => String(Number(x.toPrecision(5)))

function res(p: { id: string; estado: EstadoVerif; titulo: string; detalle: string; base: 'norma' | 'referencia_tecnica' } & Partial<ResultadoVerif>): ResultadoVerif {
  return { nivel: 3, red: null, concepto: null, tramoFila: null, refs: [], esperado: null, observado: null, diferencia: null, recalculo: [], ...p }
}

const esCanal = (u: UnionTramo): u is UnionTramo & { ficha: FichaCanal } => u.ficha !== null && 'plantilla' in u.ficha

type Banda = { min: number; max: number }
function bandaManning(revestimiento: string | null): { banda: Banda; tipo: string } | null {
  const t = quitaAcentos(revestimiento ?? '')
  const m = PARAMETROS_VERIF.manning
  if (/concreto|asfalto/.test(t)) return { banda: m.concreto, tipo: 'concreto' }
  if (/mamposter/.test(t)) return { banda: m.mamposteria, tipo: 'mampostería' }
  if (/sin\s*revest|tierra/.test(t)) return { banda: m.tierra, tipo: 'tierra' }
  return null
}

export function verificarFisica(libro: { conceptosDiagnostico: readonly string[] }, u: Uniones): ResultadoVerif[] {
  const out: ResultadoVerif[] = []
  const canales = u.uniones.filter(esCanal)
  const conteo = { hidro: 0, hidroMal: 0, manning: 0, manningMal: 0, manningSinDatos: 0, azolve: 0, sobre15: 0, sobreDiseno: 0, sobreTotal: 0, aco: 0 }

  for (const x of canales) {
    const f = x.ficha, t = x.tramo, red: TipoRed = t.red
    const nombre = `${t.inventario} · ${t.obra} (${t.pkInicial} → ${t.pkFinal})`

    /* FIS-01 · A = y(b + z·y) y Q = A·V (misma coherencia que INV-006) */
    const b = D(f.plantilla), y = D(f.tirante), A = D(f.area)
    const rect = /rectang/i.test(f.seccion ?? '')
    const z = rect ? dec(0) : D(f.talud)
    if (b && y && A && z && !/circular|otros?/i.test(f.seccion ?? '')) {
      conteo.hidro++
      const c = coherenciaHidraulica({ b, z, y, area: A, velocidad: D(f.velocidad), gasto: D(f.gasto) })
      if (!c.areaCoherente || c.gastoCoherente === false) {
        conteo.hidroMal++
        out.push(res({
          id: `FIS-01:${t.fila}`, base: 'referencia_tecnica', estado: 'no_cuadra', red, tramoFila: t.fila, refs: [f.area.ref, f.plantilla.ref, f.tirante.ref],
          titulo: 'La sección y el gasto de la ficha no son coherentes entre sí', detalle: `${nombre}: A = y·(b + z·y) y Q = A·V no reproducen lo capturado en el inventario.`,
          esperado: !c.areaCoherente ? c.areaCalculada.toSignificantDigits(8).toFixed() : (c.gastoCalculado?.toSignificantDigits(8).toFixed() ?? null),
          observado: !c.areaCoherente ? A.toFixed() : (f.gasto.valor),
          recalculo: [{ etiqueta: 'Área hidráulica', expresion: `${y.toFixed()} × (${b.toFixed()} + ${z.toFixed()} × ${y.toFixed()})`, valor: c.areaCalculada.toSignificantDigits(8).toFixed() }],
        }))
      }
    }

    /* FIS-02 · n de Manning implícito: n = A·R^(2/3)·S^(1/2) / Q */
    const bn = num(f.plantilla), dn = num(f.tirante), zn = rect ? 0 : num(f.talud), An = num(f.area), Q = num(f.gasto), S = num(f.pendiente)
    const banda = bandaManning(f.revestimiento)
    if (bn === null || dn === null || zn === null || An === null || Q === null || S === null || Q <= 0 || S <= 0 || An <= 0) { conteo.manningSinDatos++ } else if (banda) {
      conteo.manning++
      const P = bn + 2 * dn * Math.sqrt(1 + zn * zn)
      const R = An / P
      const n = (An * Math.pow(R, 2 / 3) * Math.sqrt(S)) / Q
      if (n < banda.banda.min || n > banda.banda.max) {
        conteo.manningMal++
        out.push(res({
          id: `FIS-02:${t.fila}`, base: 'referencia_tecnica', estado: 'atipico', red, tramoFila: t.fila, refs: [f.gasto.ref, f.pendiente.ref, f.area.ref],
          titulo: 'Rugosidad de Manning implícita fuera de lo usual',
          detalle: `${nombre}: con el gasto, la pendiente y la sección del inventario, n = ${cinco(n)}; para ${banda.tipo} lo usual es ${banda.banda.min}–${banda.banda.max}. Puede indicar un gasto o una pendiente mal capturados. Referencia técnica, no norma.`,
          esperado: `${banda.banda.min}–${banda.banda.max}`, observado: cinco(n),
          recalculo: [
            { etiqueta: 'Perímetro mojado (m)', expresion: `b + 2·d·√(1+z²) = ${cinco(bn)} + 2×${cinco(dn)}×√(1+${cinco(zn)}²)`, valor: cinco(P) },
            { etiqueta: 'Radio hidráulico (m)', expresion: `A ÷ P = ${cinco(An)} ÷ ${cinco(P)}`, valor: cinco(R) },
            { etiqueta: 'n implícito', expresion: `A·R^(2/3)·S^(1/2) ÷ Q = ${cinco(An)}×${cinco(R)}^(2/3)×${cinco(S)}^(1/2) ÷ ${cinco(Q)}`, valor: cinco(n) },
          ],
        }))
      }
    }

    /* FIS-03 / FIS-04 · lo que el diagnóstico programa contra lo que la sección permite */
    libro.conceptosDiagnostico.forEach((concepto, idx) => {
      const X = num(t.conceptos[idx]?.trabajo ?? { valor: null, ref: '', formula: null, origen: 'vacio' })
      const L = num(t.km)
      if (X === null || X <= 0 || L === null || L <= 0) return
      const fam = familia(concepto)
      if (fam === 'desazolve' && An !== null && An > 0) {
        conteo.azolve++
        const As = X / (1000 * L)
        const perdida = As / An
        const ref = t.conceptos[idx]!.trabajo.ref
        const pasos = [
          { etiqueta: 'Área de azolve implícita (m²)', expresion: `${cinco(X)} ÷ (1000 × ${cinco(L)})`, valor: cinco(As) },
          { etiqueta: 'Área hidráulica del inventario (m²)', expresion: `A = ${cinco(An)}`, valor: cinco(An) },
          { etiqueta: 'Pérdida de capacidad implícita', expresion: `${cinco(As)} ÷ ${cinco(An)}`, valor: `${cinco(perdida * 100)} %` },
        ]
        // Sección completa hasta el bordo: el azolve no puede ocupar más que eso (en drenes el libre bordo es grande).
        const lbn = num(f.libreBordo)
        const H = dn === null ? null : dn + (lbn ?? 0)
        const Atotal = bn !== null && zn !== null && H !== null ? (bn + zn * H) * H : null
        if (perdida > PARAMETROS_VERIF.perdidaCapacidad.valor) conteo.sobre15++
        if (perdida > 1) conteo.sobreDiseno++
        if (Atotal !== null && As > Atotal) {
          conteo.sobreTotal++
          out.push(res({ id: `FIS-03:${t.fila}:${concepto}`, base: 'referencia_tecnica', estado: 'no_cuadra', red, concepto, tramoFila: t.fila, refs: [ref, f.area.ref],
            titulo: 'El desazolve programado excede la sección completa del canal',
            detalle: `${nombre}: la cantidad de DIAG-01 equivale a retirar ${cinco(As)} m² por metro, más que la sección completa hasta el bordo (${cinco(Atotal)} m²).`,
            esperado: `≤ ${cinco(Atotal)} m²`, observado: `${cinco(As)} m²`, recalculo: pasos }))
        } else if (perdida > 1) {
          out.push(res({ id: `FIS-03:${t.fila}:${concepto}`, base: 'norma', estado: 'informativo', red, concepto, tramoFila: t.fila, refs: [ref, f.area.ref],
            titulo: 'El azolve programado supera la sección de diseño (tirante normal)',
            detalle: `${nombre}: el azolve implícito (${cinco(As)} m²) es ${cinco(perdida * 100)} % del área hidráulica de diseño (${cinco(An)} m²): ocupa más que todo el tirante normal. El Anexo Técnico General §2.2 acepta hasta 15 % de pérdida de capacidad.`,
            esperado: '≤ 15 %', observado: `${cinco(perdida * 100)} %`, recalculo: pasos }))
        }
      }
      if (fam === 'acuaticas' && bn !== null && dn !== null && zn !== null) {
        conteo.aco++
        const espejo = bn + 2 * zn * dn
        const maxHa = 0.1 * espejo * L
        if (X > maxHa * (1 + PARAMETROS_VERIF.tolCriterioRel) + 1e-9) {
          out.push(res({ id: `FIS-04:${t.fila}:${concepto}`, base: 'referencia_tecnica', estado: 'no_cuadra', red, concepto, tramoFila: t.fila, refs: [t.conceptos[idx]!.trabajo.ref, f.plantilla.ref],
            titulo: 'Plantas acuáticas en más superficie que el espejo de agua', detalle: `${nombre}: DIAG-01 programa ${cinco(X)} ha y el espejo de agua del tramo mide ${cinco(maxHa)} ha.`,
            esperado: `≤ ${cinco(maxHa)} ha`, observado: `${cinco(X)} ha`,
            recalculo: [{ etiqueta: 'Espejo de agua (ha)', expresion: `(b + 2·z·d) × L ÷ 10 = (${cinco(bn)} + 2×${cinco(zn)}×${cinco(dn)}) × ${cinco(L)} ÷ 10`, valor: cinco(maxHa) }] }))
        }
      }
    })
  }

  const resumen = (id: string, titulo: string, base: 'norma' | 'referencia_tecnica', rev: number, mal: number, nota: string): void => {
    if (rev === 0 && mal === 0) return
    out.push(res({ id: `${id}:resumen`, base, estado: mal === 0 ? 'cuadra' : 'informativo', titulo, detalle: `${rev} tramos revisados · ${mal} fuera de lo esperado (se listan aparte). ${nota}` }))
  }
  resumen('FIS-01', 'Coherencia de la sección y el gasto de la ficha', 'referencia_tecnica', conteo.hidro, conteo.hidroMal, 'A = y(b+z·y); Q = A·V (igual que INV-006).')
  resumen('FIS-02', 'Rugosidad de Manning implícita', 'referencia_tecnica', conteo.manning, conteo.manningMal,
    `${conteo.manningSinDatos > 0 ? `${conteo.manningSinDatos} tramos sin gasto, pendiente o sección completos no se evaluaron. ` : ''}${PARAMETROS_VERIF.manning.fuente}`)
  if (conteo.azolve > 0) {
    out.push(res({ id: 'FIS-03:resumen', base: 'norma', estado: conteo.sobreTotal > 0 ? 'informativo' : 'cuadra', titulo: 'Desazolve contra la capacidad de la sección',
      detalle: `${conteo.azolve} tramos revisados. Pérdida de capacidad implícita: ${conteo.sobre15} superan el 15 % que acepta el Anexo Técnico General §2.2 (no se listan uno por uno), ${conteo.sobreDiseno} superan el área hidráulica de diseño y ${conteo.sobreTotal} superan la sección completa hasta el bordo (esos se listan aparte).` }))
  }
  if (conteo.aco > 0) resumen('FIS-04', 'Plantas acuáticas contra el espejo de agua', 'referencia_tecnica', conteo.aco, out.filter((r) => r.id.startsWith('FIS-04:')).length, 'Espejo = (b + 2·z·d) × L.')
  return out
}
