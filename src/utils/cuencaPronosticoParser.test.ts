import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRespuesta, urlPronostico, FormatoOpenMeteoError, MODELOS_CUENCA } from '../../supabase/functions/cuenca-pronostico-sync/parser';

const fx = (n: string) => JSON.parse(readFileSync(`supabase/functions/cuenca-pronostico-sync/fixtures/${n}`, 'utf8'));

describe('Open-Meteo · respuesta multipunto', () => {
  it('lee 2 puntos (arreglo) con 3 días y todas las variables', () => {
    const r = parseRespuesta(fx('ecmwf_2puntos.json'), 2);
    expect(r).toHaveLength(2);
    expect(r[0].dias).toHaveLength(3);
    expect(r[0].dias[0].fecha).toBe('2026-11-08');
    expect(r[0].elevacion).toBe(1382);
    expect(r[1].dias[0].precip_mm).toBe(31.4);
    expect(r[1].dias[0].temp_media_c).toBe(10.8);
    expect(r[1].dias[0].viento_medio_kmh).toBe(15.1);
    expect(r[1].dias[0].hum_media_pct).toBe(94);
    expect(r[1].dias[0].precip_prob_pct).toBe(100);
  });
  it('una sola coordenada devuelve un OBJETO y se lee igual', () => {
    const r = parseRespuesta(fx('icon_1punto.json'), 1);
    expect(r).toHaveLength(1);
    expect(r[0].dias[0].precip_mm).toBe(4.5);
  });
  it('un 0.0 medido es 0 (no S/D) y un valor ausente es null', () => {
    const r = parseRespuesta(fx('ecmwf_2puntos.json'), 2);
    expect(r[0].dias[2].precip_mm).toBe(0);
    const j = fx('ecmwf_2puntos.json');
    j[0].daily.precipitation_sum[1] = null;
    j[0].daily.wind_speed_10m_mean[1] = 'x';
    const r2 = parseRespuesta(j, 2);
    expect(r2[0].dias[1].precip_mm).toBeNull();
    expect(r2[0].dias[1].viento_medio_kmh).toBeNull();
  });
  it('lluvia o viento negativos son errores de dato: null', () => {
    const j = fx('ecmwf_2puntos.json');
    j[0].daily.precipitation_sum[0] = -3;
    j[0].daily.wind_speed_10m_mean[0] = -1;
    const r = parseRespuesta(j, 2);
    expect(r[0].dias[0].precip_mm).toBeNull();
    expect(r[0].dias[0].viento_medio_kmh).toBeNull();
  });
});

describe('Open-Meteo · dirección del viento (opcional)', () => {
  it('la URL la pide y la respuesta sin ese bloque da S/D sin fallar', () => {
    expect(urlPronostico([{ lat: 27.5, lon: -105.1 }], 'gfs_seamless')).toContain('wind_direction_10m_dominant');
    const r = parseRespuesta(fx('ecmwf_2puntos.json'), 2);
    expect(r[0].dias.every((x) => x.viento_dir_deg === null)).toBe(true);
  });
  it('lee la dirección cuando viene y descarta lo fuera de 0–360', () => {
    const j = JSON.parse(JSON.stringify(fx('icon_1punto.json')));
    const n = j.daily.time.length;
    j.daily.wind_direction_10m_dominant = Array.from({ length: n }, (_, i) => (i === 0 ? 225 : 999));
    const r = parseRespuesta(j, 1);
    expect(r[0].dias[0].viento_dir_deg).toBe(225);
    expect(r[0].dias.slice(1).every((x) => x.viento_dir_deg === null)).toBe(true);
  });
});

describe('Open-Meteo · formato inesperado → error explícito', () => {
  it('cantidad de puntos distinta de la pedida', () => {
    expect(() => parseRespuesta(fx('ecmwf_2puntos.json'), 3)).toThrow(FormatoOpenMeteoError);
  });
  it('respuesta de error de la API', () => {
    expect(() => parseRespuesta({ error: true, reason: 'Too many requests' }, 1)).toThrow(/Too many requests/);
  });
  it('falta una variable o longitudes distintas', () => {
    const j = fx('ecmwf_2puntos.json');
    delete j[1].daily.relative_humidity_2m_mean;
    expect(() => parseRespuesta(j, 2)).toThrow(/relative_humidity_2m_mean/);
    const k = fx('ecmwf_2puntos.json');
    k[0].daily.temperature_2m_mean = [1];
    expect(() => parseRespuesta(k, 2)).toThrow(FormatoOpenMeteoError);
  });
  it('fechas ilegibles', () => {
    const j = fx('icon_1punto.json');
    j.daily.time = ['ayer', 'hoy', 'mañana'];
    expect(() => parseRespuesta(j, 1)).toThrow(/daily\.time/);
  });
});

describe('Open-Meteo · URL', () => {
  it('lleva todas las coordenadas, el modelo, la zona horaria y el viento en km/h', () => {
    const u = urlPronostico([{ lat: 27.1, lon: -104.9 }, { lat: 28.64, lon: -106.078 }], 'gfs_seamless');
    expect(u).toContain('latitude=27.1000,28.6400');
    expect(u).toContain('longitude=-104.9000,-106.0780');
    expect(u).toContain('models=gfs_seamless');
    expect(u).toContain('wind_speed_unit=kmh');
    expect(u).toContain('America%2FChihuahua');
  });
  it('usa 3 modelos distintos (best_match coincide con GFS en la región)', () => {
    expect(new Set(MODELOS_CUENCA).size).toBe(3);
    expect(MODELOS_CUENCA).not.toContain('best_match');
  });
});
