// ETₒ de referencia diaria FAO-56 Penman-Monteith (ecuación 6 de FAO-56), módulo puro (sin Deno) y probado en vitest.
// NASA POWER no ofrece ETₒ como parámetro (pedir «ET0» devuelve HTTP 422), así que se calcula aquí con sus
// variables diarias: T2M_MAX, T2M_MIN, T2M, RH2M, WS2M (ya a 2 m) y ALLSKY_SFC_SW_DWN (radiación, MJ/m²/día).

export interface EntradaEto {
  tMax: number;      // °C
  tMin: number;      // °C
  tMedia: number;    // °C
  hrMedia: number;   // %
  u2: number;        // m/s a 2 m
  rsMj: number;      // radiación solar incidente, MJ/m²/día
  latitudDeg: number;
  elevacionM: number;
  /** Día del año 1-366. */
  diaAnio: number;
}

const e0 = (t: number) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3)); // presión de saturación, kPa

/** Radiación extraterrestre Ra (MJ/m²/día), FAO-56 eq. 21. */
export function radiacionExtraterrestre(latitudDeg: number, diaAnio: number): number {
  const phi = (latitudDeg * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * diaAnio) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * diaAnio) / 365 - 1.39);
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))));
  const Gsc = 0.082;
  return ((24 * 60) / Math.PI) * Gsc * dr * (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));
}

/** ETₒ diaria en mm/día; null si falta alguna entrada o es inverosímil. */
export function etoFao56Diario(x: Partial<EntradaEto>): number | null {
  const { tMax, tMin, tMedia, hrMedia, u2, rsMj, latitudDeg, elevacionM, diaAnio } = x;
  const v = [tMax, tMin, tMedia, hrMedia, u2, rsMj, latitudDeg, elevacionM, diaAnio];
  if (v.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  if (tMax! < tMin! || hrMedia! < 0 || hrMedia! > 100 || u2! < 0 || rsMj! < 0) return null;

  const z = elevacionM!;
  const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
  const gamma = 0.000665 * P;
  const es = (e0(tMax!) + e0(tMin!)) / 2;
  const ea = (hrMedia! / 100) * es;
  const delta = (4098 * e0(tMedia!)) / Math.pow(tMedia! + 237.3, 2);

  const Ra = radiacionExtraterrestre(latitudDeg!, diaAnio!);
  const Rso = (0.75 + 2e-5 * z) * Ra;
  const relRad = Rso > 0 ? Math.min(1, rsMj! / Rso) : 0.5;
  const sigma = 4.903e-9;
  const Rnl = sigma * ((Math.pow(tMax! + 273.16, 4) + Math.pow(tMin! + 273.16, 4)) / 2) * (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * relRad - 0.35);
  const Rn = 0.77 * rsMj! - Rnl;

  const num = 0.408 * delta * Rn + gamma * (900 / (tMedia! + 273)) * u2! * (es - ea);
  const den = delta + gamma * (1 + 0.34 * u2!);
  const eto = num / den;
  return Number.isFinite(eto) ? Math.max(0, +eto.toFixed(2)) : null;
}

export function diaDelAnioDeFecha(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(a, 0, 0)) / 86400000);
}

/** La elevación que reporta WeatherLink no es confiable (hasta ~10x); se acota a un rango plausible del distrito. */
export function elevacionPlausible(z: number | null | undefined, porDefecto = 1200): number {
  return typeof z === "number" && Number.isFinite(z) && z >= 300 && z <= 2500 ? z : porDefecto;
}
