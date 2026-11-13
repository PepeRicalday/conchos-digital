/**
 * fichaCuerpo — ficha única de un cuerpo de agua: lo que se sabe hoy de él, con la fuente y la fecha de cada dato.
 * Pura. Lo que falta es null (S/D); nunca se completa con 0 ni con el dato de otro mes sin decirlo.
 */
import type { BalanceMensual, CierreMensual, CuerpoAgua } from './cuerposAgua';
import type { Anotacion } from './anotacionesCuenca';
import { ultimaCaptura } from './anotacionesCuenca';

export interface EscenaFicha { fecha: string; areaKm2: number | null; incertidumbreKm2: number | null; separacionDebil: boolean }
export interface DatosFicha {
  cuerpos: CuerpoAgua[];
  cierres: CierreMensual[];
  balances: BalanceMensual[];
  escenas: Map<string, EscenaFicha[]>;
  huellas: Map<string, { areaKm2: number }>;
}
export interface HoyFicha { almMm3: number | null; pct: number | null; fecha: string | null }

export interface FichaCuerpo {
  cuerpo: CuerpoAgua;
  aguasAbajo: string | null;
  /** Lectura del día de la telemetría (solo cuerpos con telemetría). */
  hoy: HoyFicha | null;
  ultimoCierre: { mes: string; almMm3: number; pct: number | null; calidad: CierreMensual['calidad']; fuente: string | null; fuentes: { fuente: string; almMm3: number }[]; vencido: boolean } | null;
  satelite: { escena: EscenaFicha; huellaKm2: number | null; /** espejo / huella máxima, en %. */ llenadoPct: number | null; escenas: number } | null;
  /** Último mes con balance completo (calidad OK). */
  balance: { mes: string; entradas: number | null; salida: number | null; evap: number | null; residuo: number | null } | null;
  captura: Anotacion | null;
  /** Meses con cierre con cifra y total de meses del registro. */
  cobertura: { conDato: number; total: number };
}

/** Meses (AAAA-MM-01) entre dos meses. */
const mesesEntre = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const NOMBRE_FUENTE: Record<string, string> = { srl: 'Reporte SRL/CILA', sina: 'SINA CONAGUA', aqwp: 'AQUARIUS (CONAGUA)' };

export function fichaCuerpo(d: DatosFicha, id: string, hoy: HoyFicha | undefined, anotaciones: Anotacion[]): FichaCuerpo | null {
  const cuerpo = d.cuerpos.find((c) => c.id === id);
  if (!cuerpo) return null;
  const mios = d.cierres.filter((c) => c.cuerpoId === id).sort((a, b) => a.mes.localeCompare(b.mes));
  const conDato = mios.filter((c) => c.almMm3 != null);
  const u = conDato[conDato.length - 1];
  const mesActual = d.cierres.reduce((m, c) => (c.almMm3 != null && c.mes > m ? c.mes : m), '');

  const escenas = (d.escenas.get(cuerpo.idSerie) ?? []).filter((e) => e.areaKm2 != null);
  const ult = escenas[escenas.length - 1];
  const huella = d.huellas.get(cuerpo.id)?.areaKm2 ?? null;

  const bal = d.balances.filter((b) => b.cuerpoId === id && b.calidad === 'OK').sort((a, b) => a.mes.localeCompare(b.mes)).pop();

  return {
    cuerpo,
    aguasAbajo: cuerpo.aguasAbajoId ? d.cuerpos.find((c) => c.id === cuerpo.aguasAbajoId)?.etiqueta ?? null : null,
    hoy: cuerpo.aqwpUbicacionId == null ? null : hoy ?? { almMm3: null, pct: null, fecha: null },
    ultimoCierre: u ? {
      mes: u.mes, almMm3: u.almMm3 as number, pct: u.pctNamo, calidad: u.calidad, fuente: u.fuenteAlm,
      fuentes: (Object.entries(u.detalle) as [string, { almacenamiento?: number | null } | undefined][])
        .flatMap(([k, v]) => (v && v.almacenamiento != null ? [{ fuente: NOMBRE_FUENTE[k] ?? k, almMm3: v.almacenamiento }] : [])),
      vencido: mesActual !== '' && mesesEntre(u.mes, mesActual) > 2,
    } : null,
    satelite: ult ? {
      escena: ult, huellaKm2: huella,
      llenadoPct: huella != null && huella > 0 && ult.areaKm2 != null ? Math.round((ult.areaKm2 / huella) * 1000) / 10 : null,
      escenas: escenas.length,
    } : null,
    balance: bal ? { mes: bal.mes, entradas: bal.entradas, salida: bal.salidaTotal, evap: bal.evap, residuo: bal.residuo } : null,
    captura: ultimaCaptura(anotaciones, id),
    cobertura: { conDato: conDato.length, total: mios.length },
  };
}
