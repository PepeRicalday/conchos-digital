// Genera el HTML del informe NDVI con datos de MUESTRA (valores reales de 2026-08/09 + meses previos aproximados) y los
// contornos reales de public/geo/modulos.geojson, sin navegador ni red. Solo para revisión visual.
//   npx vite-node e2e/informe-ndvi-genera.ts
import fs from 'fs';
import { fileURLToPath } from 'url';
import { construirDatosNdvi, type FilaNdviInforme } from '../src/utils/informeNdviDatos';
import { construirHtmlNdvi } from '../src/utils/informeNdviHtml';
import { contornosAAnillos, planoSvg } from '../src/utils/informeNdviSvg';
import { configPorDefecto, mesesDisponibles, type ConfigInformeNdvi } from '../src/utils/informeNdviConfig';

const aqui = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const OUT = aqui('./out/informe-ndvi/');
fs.mkdirSync(OUT, { recursive: true });

const MODULOS = [1, 2, 3, 4, 5, 12];
const SEP = [0.202, 0.4257, 0.5189, 0.3292, 0.343, 0.503];
const AGO = [0.3378, 0.3717, 0.4669, 0.2942, 0.325, 0.467];
const SUP = [5456.7, 6165.2, 6552.0, 9144.3, 11594.3, 2551.3];
const MESES = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
// Serie de muestra: forma de campana de ciclo agrícola entre marzo y septiembre.
const forma = [0.55, 0.7, 0.95, 1.1, 1.05, 1, 0.9];

const filas: FilaNdviInforme[] = [];
MODULOS.forEach((m, i) => {
    MESES.forEach((mes, k) => {
        const base = k === 5 ? AGO[i] : k === 6 ? SEP[i] : Math.min(0.75, SEP[i] * forma[k] * (0.9 + 0.05 * i));
        if (m === 12 && k === 0) return; // hueco histórico para ver S/D en la tabla
        filas.push({
            numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes, ndvi_medio: base, ndvi_desv: 0.07 + 0.01 * i,
            kc_estimado: 0.15 + 1.1 * base, delta_ndvi: k > 0 ? base - (k === 6 ? AGO[i] : base * 0.93) : null,
            superficie_ha: SUP[i], fraccion_cobertura_activa: 0.4 + 0.08 * i,
            ventana_desde: `${mes}-01`, ventana_hasta: k === 6 ? '2026-10-01' : `${mes}-28`, nubosidad_max_pct: 40,
        });
    });
});

const fc = JSON.parse(fs.readFileSync(aqui('../public/geo/modulos.geojson'), 'utf-8')) as GeoJSON.FeatureCollection;
const logo = (p: string) => `data:image/png;base64,${fs.readFileSync(aqui(`../public${p}`)).toString('base64')}`;

function escenario(nombre: string, conFalta: boolean, extra: Partial<ConfigInformeNdvi> = {}) {
    const f = conFalta ? filas.filter((x) => !(x.numero_modulo === 12 && x.mes === '2026-09')) : filas;
    const datos = construirDatosNdvi(f, {
        volumenPorModulo: new Map(MODULOS.map((m, i) => [m, 18 + i * 9])), volumenMesParcial: conFalta,
        contornosDisponibles: true, logoSrlOk: true, ahora: new Date(2026, 9, 7, 14, 5), emisor: 'Administrador SICA', version: '2.23.0',
    }, { ...configPorDefecto(mesesDisponibles(f)), ...extra });
    const html = construirHtmlNdvi(datos, { srl: logo('/logos/logo-srl.png'), sica: logo('/logos/SICA005.png') }, planoSvg(datos.modulos, contornosAAnillos(fc)));
    fs.writeFileSync(`${OUT}${nombre}.html`, html);
    console.log(nombre, `${(html.length / 1024).toFixed(0)} KB`);
}
escenario('informe', false);
escenario('informe_con_faltantes', true);
const vacio = { desde: '', hasta: '' };
escenario('tendencia', false, { modo: 'tendencia' });
escenario('cmp_periodos', false, { modo: 'comparativo' });
escenario('cmp_mes', false, { modo: 'comparativo', comparacion: { tipo: 'mesVsMes', a: { desde: '2026-08', hasta: '2026-08' }, b: { desde: '2026-09', hasta: '2026-09' }, moduloA: 1, moduloB: 2 } });
escenario('cmp_modulos', false, { modo: 'comparativo', comparacion: { tipo: 'modulos', a: vacio, b: vacio, moduloA: 1, moduloB: 12 } });
escenario('cmp_vs_srl', false, { modo: 'comparativo', comparacion: { tipo: 'vsSRL', a: vacio, b: vacio, moduloA: 1, moduloB: 2 } });
