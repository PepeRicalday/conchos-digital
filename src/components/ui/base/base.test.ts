import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Boton, Insignia, Panel, Campo, Selector, Modal, Kpi, DataTable } from './index';
import { ESTADO_ETIQUETA, type EstadoTipo } from '../../../types/estado';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('componentes base de interfaz', () => {
    it('Boton: variante y tamaño por clase, type=button por defecto y objetivo táctil md', () => {
        const s = html(h(Boton, { variante: 'primario' }, 'Guardar'));
        expect(s).toContain('ui-btn ui-btn--primario ui-btn--md');
        expect(s).toContain('type="button"');
        expect(html(h(Boton, { tamano: 'sm' }, 'x'))).toContain('ui-btn--sm');
    });

    it('Boton: cargando bloquea el clic y avisa con aria-busy', () => {
        const s = html(h(Boton, { cargando: true }, 'Guardar'));
        expect(s).toContain('disabled');
        expect(s).toContain('aria-busy="true"');
    });

    it('Insignia: cada estado lleva icono (el color no es el único portador) y su tono', () => {
        const tipos: EstadoTipo[] = ['ok', 'warn', 'crit', 'info', 'sd'];
        for (const t of tipos) {
            const s = html(h(Insignia, { tipo: t, children: ESTADO_ETIQUETA[t] }));
            expect(s).toContain(`ui-badge--${t}`);
            expect(s).toContain('<svg');
            expect(s).toContain(ESTADO_ETIQUETA[t]);
        }
        expect(html(h(Insignia, { tipo: 'sd', sinIcono: true, children: 'S/D' }))).not.toContain('<svg');
    });

    it('Panel: encabezado solo si hay kicker, título o acciones; nivel elevado', () => {
        expect(html(h(Panel, null, 'x'))).not.toContain('ui-panel__cab');
        const s = html(h(Panel, { nivel: 'elevado', kicker: 'Presas', titulo: 'Madero' }, 'x'));
        expect(s).toContain('ui-panel--elevado');
        expect(s).toContain('Presas');
        expect(s).toContain('<h3');
    });

    it('Campo: etiqueta enlazada al control y error con role=alert que sustituye a la ayuda', () => {
        const s = html(h(Campo, { etiqueta: 'Caudal', ayuda: 'm³/s', error: 'Valor no válido', children: (a: Record<string, unknown>) => h('input', a) }));
        expect(s).toMatch(/<label[^>]*for="([^"]+)"/);
        expect(s).toContain('aria-invalid="true"');
        expect(s).toContain('role="alert"');
        expect(s).toContain('Valor no válido');
        expect(s).not.toContain('>m³/s<');
    });

    it('Selector: clase base y opciones', () => {
        const s = html(h(Selector, { defaultValue: 'a' }, h('option', { value: 'a' }, 'A')));
        expect(s).toContain('ui-select');
    });

    it('Modal cerrado no renderiza nada', () => {
        expect(html(h(Modal, { abierto: false, onCerrar: () => {}, titulo: 'x', children: 'c' }))).toBe('');
    });

    it('Kpi: S/D explícito (null o la cadena S/D), nunca 0, y estado con texto', () => {
        const sd = html(h(Kpi, { etiqueta: 'Eficiencia', valor: null }));
        expect(sd).toContain('ui-kpi__num--sd');
        expect(sd).toContain('S/D');
        expect(html(h(Kpi, { etiqueta: 'Eficiencia', valor: 'S/D' }))).toContain('ui-kpi__num--sd');
        const con = html(h(Kpi, { etiqueta: 'Caudal', valor: '12.5', unidad: 'm³/s', estado: { tipo: 'warn', texto: 'Atención' }, densidad: 'compacta' }));
        expect(con).toContain('ui-kpi--compacta');
        expect(con).toContain('12.5');
        expect(con).toContain('ui-badge--warn');
        expect(con).toContain('Atención');
    });

    it('Kpi: solo los estados warn y crit pintan el acento superior', () => {
        expect(html(h(Kpi, { etiqueta: 'a', valor: '1', estado: { tipo: 'crit', texto: 'x' } }))).toContain('--acc:var(--st-crit)');
        expect(html(h(Kpi, { etiqueta: 'a', valor: '1', estado: { tipo: 'ok', texto: 'x' } }))).not.toContain('--acc');
        expect(html(h(Kpi, { etiqueta: 'a', valor: '1', acento: 'var(--sc-s1)' }))).toContain('--acc:var(--sc-s1)');
    });

    it('DataTable: caption, th scope, cifras a la derecha y S/D en numéricas vacías', () => {
        type F = { n: string; q: number | null };
        const filas: F[] = [{ n: 'K-0', q: 1.5 }, { n: 'K-23', q: null }];
        const s = html(h(DataTable<F>, {
            filas, clave: (f: F) => f.n, caption: 'Escalas',
            columnas: [
                { id: 'n', titulo: 'Escala', encabezadoFila: true, render: (f: F) => f.n },
                { id: 'q', titulo: 'Gasto', numerica: true, render: (f: F) => f.q },
            ],
        }));
        expect(s).toContain('<caption>Escalas</caption>');
        expect(s).toContain('<th scope="row">K-0</th>');
        expect(s).toContain('ui-tabla__num');
        expect(s).toContain('>S/D<');
        expect(s.match(/S\/D/g)?.length).toBe(1);
    });

    it('DataTable: sin filas y con texto de vacío no dibuja la tabla', () => {
        const s = html(h(DataTable<{ a: string }>, { filas: [], clave: (f: { a: string }) => f.a, columnas: [], vacio: 'Sin datos del día.' }));
        expect(s).toContain('Sin datos del día.');
        expect(s).not.toContain('<table');
    });
});
