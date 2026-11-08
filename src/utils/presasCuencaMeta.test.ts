import { describe, it, expect } from 'vitest';
import { META_PRESAS, metaPresa, metaPresaPorUbicacion, etiquetaPresa } from './presasCuencaMeta';
import { ORDEN_PRESAS_CUENCA } from './aqwpCuenca';

describe('presasCuencaMeta', () => {
  it('existe una ficha por cada una de las 7 presas de la cuenca', () => {
    for (const id of ORDEN_PRESAS_CUENCA) expect(metaPresaPorUbicacion(id), `ubicación ${id}`).not.toBeNull();
    expect(Object.keys(META_PRESAS)).toHaveLength(7);
  });

  it('San Gabriel es de Durango (Ocampo, Río Florido, DR-103) y se rotula "San Gabriel, Dgo."', () => {
    const m = metaPresa('08-SGBCH-CONAGUA')!;
    expect(m.ubicacionId).toBe(541);
    expect(m.estado).toBe('Dgo.');
    expect(m.municipio).toBe('Ocampo');
    expect(m.rio).toBe('Florido');
    expect(m.dr).toBe('DR-103 Río Florido');
    expect(m.alimentaA).toBe('08-PAGCH-CONAGUA');
    expect(etiquetaPresa(541, 'San Gabriel')).toBe('San Gabriel, Dgo.');
  });

  it('Chihuahua y El Rejón NO tienen ficha verificada: todo en null, nada inventado', () => {
    for (const cod of ['08-CHUCH-CONAGUA', '08-ERECH-CONAGUA']) {
      const m = metaPresa(cod)!;
      expect(m.verificado).toBe(false);
      expect([m.estado, m.municipio, m.rio, m.dr, m.alimentaA, m.coordenadas, m.fuente, m.tambienLlamada]).toEqual(Array(8).fill(null));
    }
  });

  it('una ficha verificada siempre cita su fuente', () => {
    for (const m of Object.values(META_PRESAS)) if (m.verificado) expect(m.fuente, m.codigo).toBeTruthy();
  });

  it('la etiqueta lleva el estado solo si NO es Chihuahua; el resto usa el nombre limpio', () => {
    expect(etiquetaPresa(538, 'Chihuahua')).toBe('Chihuahua');
    expect(etiquetaPresa(999, 'Otra')).toBe('Otra');
    for (const m of Object.values(META_PRESAS)) {
      if (m.estado && m.estado !== 'Chih.') expect(m.etiqueta, m.codigo).toContain(m.estado);
      else expect(m.etiqueta, m.codigo).not.toContain(', ');
    }
    expect(etiquetaPresa(536, 'La Boquilla')).toBe('La Boquilla');
  });

  it('ids y códigos son coherentes entre sí', () => {
    for (const [cod, m] of Object.entries(META_PRESAS)) expect(m.codigo).toBe(cod);
    expect(new Set(Object.values(META_PRESAS).map((m) => m.ubicacionId)).size).toBe(7);
  });

  it('"alimenta a" apunta a una presa que existe', () => {
    for (const m of Object.values(META_PRESAS)) if (m.alimentaA) expect(META_PRESAS[m.alimentaA], m.codigo).toBeDefined();
  });
});
