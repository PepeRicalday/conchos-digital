import { describe, it, expect } from 'vitest';
import { distanciaKm, idw, interpolaClimaEnPunto, estacionMasCercana, centroideAnillo, type EstacionMuestra } from './interpolacionClima';
import { clasificaCielo, CIELO_NO_DETERMINADO, evaluaCalidad, elevacionSolar, formateaEdad } from './cielo';
import { calculaIndices, entradasDesdeEstaciones, etoTotalDelDiaRed, type EntradasIndices } from './indicesAgro';
import { resumeDias, rosaDeVientos } from './estacionDetalle';

describe('interpolacionClima — IDW', () => {
    it('1° de latitud ≈ 111 km', () => {
        expect(distanciaKm(28, -105, 29, -105)).toBeCloseTo(111.19, 1);
    });

    it('en la estación misma devuelve el valor medido exacto (sin dividir entre 0)', () => {
        expect(idw({ lat: 28, lon: -105 }, [{ nombre: 'A', lat: 28, lon: -105, valor: 21.5 }, { nombre: 'B', lat: 29, lon: -105, valor: 30 }])).toBe(21.5);
    });

    it('equidistante → promedio; más cerca pesa más; sin muestras → null', () => {
        const eq = idw({ lat: 28.5, lon: -105 }, [{ nombre: 'A', lat: 28, lon: -105, valor: 10 }, { nombre: 'B', lat: 29, lon: -105, valor: 20 }])!;
        expect(eq).toBeCloseTo(15, 1);
        const cerca = idw({ lat: 28.1, lon: -105 }, [{ nombre: 'A', lat: 28, lon: -105, valor: 10 }, { nombre: 'B', lat: 29, lon: -105, valor: 20 }])!;
        expect(cerca).toBeLessThan(11);
        expect(idw({ lat: 28, lon: -105 }, [])).toBeNull();
    });

    const est = (nombre: string, lat: number, lon: number, dir: number | null, v: number | null): EstacionMuestra =>
        ({ nombre, lat, lon, tempC: 20, vientoMs: v, vientoDirDeg: dir, radSolarWm2: 500, lluviaDiaMm: null });

    it('viento: 350° y 10° dan ≈ 0° (norte), no 180° como un promedio ingenuo', () => {
        const r = interpolaClimaEnPunto({ lat: 28.5, lon: -105 }, [est('A', 28, -105, 350, 4), est('B', 29, -105, 10, 4)]);
        const d = r.vientoDirDeg!;
        expect(Math.min(d, 360 - d)).toBeLessThan(2);
        expect(r.vientoMs).toBeGreaterThan(3.9); // la magnitud casi se conserva (vectores casi alineados)
    });

    it('estaciones sin viento no aportan; sin ninguna → viento null; lluvia sin dato → null (no 0)', () => {
        const r = interpolaClimaEnPunto({ lat: 28.5, lon: -105 }, [est('A', 28, -105, null, null), est('B', 29, -105, null, null)]);
        expect(r.vientoMs).toBeNull();
        expect(r.vientoDirDeg).toBeNull();
        expect(r.lluviaDiaMm).toBeNull();
        expect(r.tempC).toBeCloseTo(20, 5);
    });

    it('estación más cercana y centroide', () => {
        const e = estacionMasCercana({ lat: 28.9, lon: -105 }, [{ lat: 28, lon: -105, n: 'A' }, { lat: 29, lon: -105, n: 'B' }])!;
        expect(e.estacion.n).toBe('B');
        expect(estacionMasCercana({ lat: 0, lon: 0 }, [])).toBeNull();
        expect(centroideAnillo([[0, 0], [2, 0], [2, 2], [0, 2]])).toEqual({ lat: 1, lon: 1 });
    });
});

describe('cielo — clasificación, calidad y sol', () => {
    it('sin cobertura → "no determinado" (nunca un icono de sol por defecto)', () => {
        expect(clasificaCielo(null)).toBe(CIELO_NO_DETERMINADO);
        expect(clasificaCielo(undefined)).toBe(CIELO_NO_DETERMINADO);
        expect(clasificaCielo(Number.NaN)).toBe(CIELO_NO_DETERMINADO);
    });

    it('cinco clases por cobertura, con saturación 0-100', () => {
        const etiquetas = [0, 20, 45, 75, 100].map(c => clasificaCielo(c).etiqueta);
        expect(new Set(etiquetas).size).toBe(5);
        expect(clasificaCielo(-30)).toBe(clasificaCielo(0));
        expect(clasificaCielo(250)).toBe(clasificaCielo(100));
    });

    const ahora = new Date('2026-10-05T18:00:00Z');
    const lectura = (minAtras: number, extra = {}) => ({ ts: new Date(ahora.getTime() - minAtras * 60000).toISOString(), temp_c: 25, hum_rel_pct: 40, ...extra });

    it('frescura (cadencia de 2 h, igual que saludRed): vigente ≤150, retrasada ≤360, vencida >360', () => {
        expect(evaluaCalidad(lectura(32), ahora).status).toBe('valid'); // antes salía "retrasada" a los 32 min
        expect(evaluaCalidad(lectura(150), ahora).status).toBe('valid');
        expect(evaluaCalidad(lectura(200), ahora).status).toBe('stale');
        expect(evaluaCalidad(lectura(400), ahora).status).toBe('expired');
        expect(evaluaCalidad(lectura(200), ahora).usableComoActual).toBe(true);
        expect(evaluaCalidad(lectura(400), ahora).usableComoActual).toBe(false);
    });

    it('sin lectura → vencida y "Sin dato"', () => {
        const q = evaluaCalidad(null, ahora);
        expect(q.status).toBe('expired');
        expect(q.flags).toContain('missing');
        expect(q.etiqueta).toBe('Sin dato');
    });

    it('un valor fuera de rango degrada una lectura fresca a sospechosa', () => {
        expect(evaluaCalidad(lectura(5, { hum_rel_pct: 140 }), ahora).status).toBe('suspect');
        expect(evaluaCalidad(lectura(5, { temp_c: 82 }), ahora).status).toBe('suspect');
        expect(evaluaCalidad(lectura(5, { viento_ms: -1 }), ahora).flags).toContain('out_of_range');
    });

    it('campos clave ausentes se marcan, no se rellenan con 0', () => {
        expect(evaluaCalidad(lectura(5, { temp_c: null }), ahora).flags).toContain('missing');
        expect(evaluaCalidad(lectura(5, { hum_rel_pct: null }), ahora).flags).toContain('missing');
    });

    it('elevación solar: ≈62° al mediodía solar del equinoccio a 28° N, negativa de noche', () => {
        const mediodia = elevacionSolar(new Date('2026-03-20T19:00:00Z'), 28, -105.5);
        expect(mediodia).toBeGreaterThan(59);
        expect(mediodia).toBeLessThan(65);
        expect(elevacionSolar(new Date('2026-03-21T07:00:00Z'), 28, -105.5)).toBeLessThan(0);
    });

    it('formateaEdad', () => {
        expect(formateaEdad(null)).toBe('s/d');
        expect(formateaEdad(15)).toBe('15 min');
        expect(formateaEdad(180)).toBe('3 h');
        expect(formateaEdad(3 * 1440)).toBe('3 d');
    });
});

describe('indicesAgro — índices del distrito', () => {
    const base: EntradasIndices = {
        etoDiario: 6, nubosidadPct: 20, probLluviaPct: 10, lluviaPrevMm: 0, lluviaObsMm: 0,
        hrPct: 45, vientoMaxMs: 2, estacionesOk: 6, estacionesTotal: 6,
    };

    it('devuelve ICA, IDR, IRO e IHE en ese orden con valores 0-100', () => {
        const r = calculaIndices(base);
        expect(r.map(i => i.clave)).toEqual(['ICA', 'IDR', 'IRO', 'IHE']);
        for (const i of r) { expect(i.valor).not.toBeNull(); expect(i.valor!).toBeGreaterThanOrEqual(0); expect(i.valor!).toBeLessThanOrEqual(100); }
        expect(r[1].valor).toBe(Math.round((6 / 9) * 100)); // IDR = 100 × ETₒ / 9
    });

    it('sin ETₒ el IDR es S/D y arrastra al ICA (no se calcula un compuesto con huecos)', () => {
        const r = calculaIndices({ ...base, etoDiario: null });
        expect(r[1].valor).toBeNull();
        expect(r[0].valor).toBeNull();
    });

    it('viento restrictivo (>5 m/s) impide un IRO "Bajo": piso de 20', () => {
        const iro = calculaIndices({ ...base, vientoMaxMs: 7.1, probLluviaPct: 0 })[2];
        expect(iro.valor!).toBeGreaterThanOrEqual(20);
        expect(iro.etiqueta).not.toBe('Bajo');
    });

    it('IDR satura en 100', () => {
        expect(calculaIndices({ ...base, etoDiario: 14 })[1].valor).toBe(100);
    });

    it('lluvia observada null (ninguna estación la reporta) no rompe el IHE', () => {
        const ihe = calculaIndices({ ...base, lluviaObsMm: null })[3];
        expect(ihe.valor).not.toBeNull();
    });

    it('entradasDesdeEstaciones: una estación sin dato de lluvia NO diluye el promedio con un 0', () => {
        const e = (lluvia: number | null) => ({
            lectura: { hum_rel_pct: 40, viento_ms: 3, lluvia_dia_mm: lluvia }, cielo: { coberturaPct: 20 },
            pronosticoSerie: [], calidad: { usableComoActual: true },
        }) as never;
        expect(entradasDesdeEstaciones([e(4), e(null)], null).lluviaObsMm).toBe(4);
        expect(entradasDesdeEstaciones([e(null), e(null)], null).lluviaObsMm).toBeNull();
        expect(entradasDesdeEstaciones([e(0), e(0)], null).lluviaObsMm).toBe(0); // un 0 medido sí es 0
    });

    it('etoTotalDelDiaRed: una estación con 0 mm legítimo cuenta; sin pronóstico del día → null', () => {
        const fila = (fecha: string, eto: number | null) => ({ fecha_local: fecha, eto_fc_mm: eto });
        const est = (filas: ReturnType<typeof fila>[]) => ({ pronosticoSerie: filas }) as never;
        expect(etoTotalDelDiaRed([est([fila('2026-10-05', 3), fila('2026-10-05', 3)]), est([fila('2026-10-05', 0)])], '2026-10-05')).toBe(3);
        expect(etoTotalDelDiaRed([est([fila('2026-10-06', 5)])], '2026-10-05')).toBeNull();
        expect(etoTotalDelDiaRed([], '2026-10-05')).toBeNull();
    });
});

describe('estacionDetalle — resumen diario y rosa de vientos', () => {
    const lec = (o: Record<string, unknown>) => ({
        estacion_id: 'e', station_id: 1, temp_c: 25, temp_max_c: null, temp_min_c: null, hum_rel_pct: 40, viento_ms: 3,
        viento_dir_deg: 0, viento_rafaga_ms: null, lluvia_dia_mm: null, eto_mm: null, et_dia_mm: null, gdd: null, ...o,
    }) as never;

    it('los acumulados del día usan el MÁXIMO, no la suma', () => {
        const dias = resumeDias([
            lec({ fecha: '2026-10-04', ts: '2026-10-04T16:00:00Z', eto_mm: 1, lluvia_dia_mm: 0 }),
            lec({ fecha: '2026-10-04', ts: '2026-10-04T20:00:00Z', eto_mm: 3, lluvia_dia_mm: 2 }),
            lec({ fecha: '2026-10-04', ts: '2026-10-05T00:30:00Z', eto_mm: 5, lluvia_dia_mm: 2 }),
        ]);
        expect(dias).toHaveLength(1);
        expect(dias[0].etoMm).toBe(5);
        expect(dias[0].lluviaMm).toBe(2);
        expect(dias[0].lecturas).toBe(3);
    });

    it('descarta el acumulado arrastrado del día anterior (reinicio tardío del contador)', () => {
        const dias = resumeDias([
            lec({ fecha: '2026-10-05', ts: '2026-10-05T06:00:00Z', eto_mm: 6.38 }), // 00:00 local: cierre del 04-oct archivado como 05
            lec({ fecha: '2026-10-05', ts: '2026-10-05T06:15:00Z', eto_mm: 0 }),
            lec({ fecha: '2026-10-05', ts: '2026-10-05T14:00:00Z', eto_mm: 2.1 }),
        ]);
        expect(dias[0].etoMm).toBe(2.1);
    });

    it('un dato ausente queda null, no 0', () => {
        const d = resumeDias([lec({ fecha: '2026-10-04', ts: '2026-10-04T16:00:00Z', hum_rel_pct: null, viento_ms: null })])[0];
        expect(d.humMediaPct).toBeNull();
        expect(d.vientoMediaMs).toBeNull();
        expect(d.lluviaMm).toBeNull();
    });

    it('rosa de vientos: 350° y 10° caen ambos en el sector N', () => {
        const rosa = rosaDeVientos([lec({ viento_dir_deg: 350, viento_ms: 2 }), lec({ viento_dir_deg: 10, viento_ms: 4 })]);
        const n = rosa.find(s => s.sector === 'N')!;
        expect(n.pct).toBe(100);
        expect(n.velMediaMs).toBe(3);
        expect(rosaDeVientos([lec({ viento_dir_deg: null })])).toEqual([]);
    });
});
