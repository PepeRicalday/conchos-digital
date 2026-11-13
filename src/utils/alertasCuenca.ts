/**
 * alertasCuenca — alertas vivas de la Cuenca del Conchos para el Dashboard y el Centro de Alertas. Pura: no lee reloj ni red.
 * Cubre lo que las alertas del distrito no ven: presas de la cuenca fuera del distrito con almacenamiento crítico, lectura
 * repetida por la fuente, y fuentes de datos de la cuenca sin actualizar. Las estaciones GOES ya tienen su alerta (alertasVivas):
 * aquí se excluyen para no avisar dos veces. Un dato que no existe (S/D) no genera alerta de nivel: no se afirma nada sin lectura.
 */
import type { AlertaSistema } from './dashboardKpis';
import type { FuenteEvaluada } from './saludFuentes';
import { UMBRAL_CRITICO_PCT } from './presaNiveles';

export interface PresaCuencaAlerta {
  etiqueta: string;
  delDistrito: boolean;
  /** % del NAMO; null = S/D. */
  pct: number | null;
  sinActualizar: boolean;
  diasIgual: number | null;
  /** Fecha ISO del último dato de la presa. */
  fecha: string | null;
}

/** Cierre mensual cuyas fuentes discrepan (calidad DIFIERE): vaso, mes (AAAA-MM-01) y la mayor diferencia en Mm³. */
export interface CierreDifiere { cuerpo: string; mes: string; difMm3: number | null }

export interface EntradaAlertasCuenca {
  presas: PresaCuencaAlerta[];
  /** Fuentes ya evaluadas (saludFuentes.evaluarFuentes). null = aún no se sabe: no se afirma nada. */
  fuentes: FuenteEvaluada[] | null;
  /** Cierres con fuentes discrepantes. null = aún no se sabe. Solo los de los 2 últimos meses cuentan como accionables. */
  cierresDifieren?: CierreDifiere[] | null;
  /** Reloj (el módulo es puro). Obligatorio para evaluar `cierresDifieren`. */
  ahoraMs?: number;
}

const lista = (xs: string[]) => (xs.length <= 3 ? xs.join(', ') : `${xs.slice(0, 3).join(', ')} y ${xs.length - 3} más`);
const edad = (min: number | null) => (min == null ? 'sin dato' : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`);

export function construyeAlertasCuenca(e: EntradaAlertasCuenca): AlertaSistema[] {
  const out: AlertaSistema[] = [];

  // Presas de la cuenca fuera del distrito (las del distrito ya las cubre el aviso de «Almacenamiento Crítico» del Dashboard).
  const criticas = e.presas.filter((p) => !p.delDistrito && p.pct != null && p.pct < UMBRAL_CRITICO_PCT && !p.sinActualizar);
  if (criticas.length) {
    out.push({
      id: 'cuenca-presa-critica', type: 'warning', title: 'Presas de la cuenca con almacenamiento crítico',
      message: `${lista(criticas.map((p) => `${p.etiqueta} ${(p.pct as number).toFixed(1)} %`))} del NAMO (menos de ${UMBRAL_CRITICO_PCT} %). Afecta el escurrimiento hacia el distrito.`,
      timestamp: 'Ahora', fuente: 'vivo', categoria: 'cuenca',
    });
  }

  const repetidas = e.presas.filter((p) => p.sinActualizar);
  if (repetidas.length) {
    out.push({
      id: 'cuenca-lectura-repetida', type: 'warning', title: 'CONAGUA repite el último dato de una presa',
      message: `${lista(repetidas.map((p) => `${p.etiqueta}${p.diasIgual ? ` (${p.diasIgual} d igual)` : ''}`))}: el almacenamiento no cambia aunque hay aportación o extracción. Se muestra el último dato obtenido.`,
      timestamp: repetidas[0].fecha ?? 'Ahora', fuente: 'vivo', categoria: 'cuenca',
    });
  }

  // Fuentes de la cuenca (GOES excluidas: tienen alerta propia).
  const caidas = (e.fuentes ?? []).filter((f) => !f.clave.startsWith('goes:') && f.estado === 'sin_actualizar');
  if (caidas.length) {
    out.push({
      id: 'cuenca-fuente-sin-actualizar', type: 'warning', title: caidas.length === 1 ? 'Fuente de la cuenca sin actualizar' : 'Fuentes de la cuenca sin actualizar',
      message: `${caidas.map((f) => `${f.nombre} (${edad(f.edadMin)})`).join('; ')}. Lleva más de 3 veces su cadencia normal sin dato nuevo.`,
      timestamp: 'Ahora', fuente: 'vivo', categoria: 'cuenca',
    });
  }
  // Cierres recientes cuyas fuentes no coinciden: hay que cuadrar antes de usar la cifra en el balance.
  if (e.cierresDifieren && e.ahoraMs != null) {
    const d = new Date(e.ahoraMs);
    const limite = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
    const rec = e.cierresDifieren.filter((c) => c.mes >= limite).sort((a, b) => b.mes.localeCompare(a.mes) || (b.difMm3 ?? 0) - (a.difMm3 ?? 0));
    if (rec.length) {
      out.push({
        id: 'cuenca-cierres-difieren', type: 'info', title: 'Cierres de la cuenca con fuentes que difieren',
        message: `${lista(rec.map((c) => `${c.cuerpo} (${c.mes.slice(0, 7)}${c.difMm3 != null ? `, ${c.difMm3.toFixed(1)} Mm³` : ''})`))}: dos fuentes discrepan más de 0.5 Mm³ o 0.5 %. Revise el cuadre en Cuenca → Balance → Cierres mensuales.`,
        timestamp: rec[0].mes.slice(0, 7), fuente: 'vivo', categoria: 'cuenca',
      });
    }
  }
  return out;
}
