// Genera el HTML del informe técnico integrado de NDVI con datos de MUESTRA (valores reales de 2026-08/09, años previos aproximados) y los
// contornos reales de public/geo/modulos.geojson, sin navegador ni red. Solo para revisión visual.
//   npx vite-node e2e/informe-ndvi-genera.ts
import fs from 'fs';
import { fileURLToPath } from 'url';
import { construirDatosNdvi, type FilaNdviInforme } from '../src/utils/informeNdviDatos';
import { construirHtmlNdvi } from '../src/utils/informeNdviHtml';
import { contornosAAnillos, planoSvg } from '../src/utils/informeNdviSvg';
import { configPorDefecto, mesesDisponibles, type ConfigInformeNdvi } from '../src/utils/informeNdviConfig';
import { armarContextoPlano } from '../src/utils/contextoPlanoNdvi';

import { imagenesHtml, reducirAPresupuesto, bytesADataUriPng } from '../src/utils/informeNdviRasterImagen';
import type { ResultadoRaster } from '../src/utils/informeNdviRaster';
import { bboxDe, rasterOkDe, rasterSinteticoRgba, pngRgba } from './_raster_sintetico';

/** Imágenes de MUESTRA: pasa por la misma reducción + PNG indexado que el informe real. 'parcial' = M3 sin sesión y M12 sin datos; 'caida' = CDSE caído en todos. */
async function imagenesSinteticas(datos: ReturnType<typeof construirDatosNdvi>, contornos: ReturnType<typeof contornosAAnillos>, modo: 'ok' | 'parcial' | 'caida'): Promise<string> {
    const mes = datos.mesReferencia as string;
    const res: Record<number, ResultadoRaster> = {};
    const pesos: string[] = [];
    for (const m of datos.modulos) {
        if ((modo === 'parcial' && m.numero === 3) || modo === 'caida') { res[m.numero] = { ok: false, motivo: modo === 'caida' ? 'cdse-caido' : 'sin-sesion', detalle: 'simulado', mes, modulo: m.numero }; continue; }
        if (modo === 'parcial' && m.numero === 12) { res[m.numero] = { ok: false, motivo: 'sin-datos', detalle: 'simulado', mes, modulo: m.numero }; continue; }
        const bbox = bboxDe(contornos[m.numero]);
        const img = rasterSinteticoRgba(bbox, m.ndvi ?? 0.3, m.numero);
        const { imagen: reducida, bytes } = await reducirAPresupuesto(img);
        pesos.push(`M${m.numero}: origen ${img.ancho}x${img.alto} PNG RGBA ${(pngRgba(img).length / 1024).toFixed(0)} KB -> ${reducida.ancho}x${reducida.alto} indexado ${(bytes.length / 1024).toFixed(1)} KB`);
        res[m.numero] = rasterOkDe(m.numero, mes, bbox, bytesADataUriPng(bytes), reducida.ancho, reducida.alto, 4 + (m.numero % 5), 0.8 + (m.numero % 4) * 0.05);
    }
    if (pesos.length) console.log('  ' + pesos.join(' | '));
    return imagenesHtml(datos.modulos, contornos, res, mes);
}

const aqui = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const OUT = aqui('./out/informe-ndvi/');
fs.mkdirSync(OUT, { recursive: true });

const MODULOS = [1, 2, 3, 4, 5, 12];
const SEP = [0.202, 0.4257, 0.5189, 0.3292, 0.343, 0.503];
const AGO = [0.3378, 0.3717, 0.4669, 0.2942, 0.325, 0.467];
const SUP = [5456.7, 6165.2, 6552.0, 9144.3, 11594.3, 2551.3];
const MESES = ['03', '04', '05', '06', '07', '08', '09'];
const ANIOS = [2021, 2022, 2023, 2024, 2025, 2026];
// Serie de muestra: forma de campana de ciclo agrícola entre marzo y septiembre; 2026 más bajo que los años previos.
const forma = [0.55, 0.7, 0.95, 1.1, 1.05, 1, 0.9];

const filas: FilaNdviInforme[] = [];
MODULOS.forEach((m, i) => {
    for (const a of ANIOS) {
        MESES.forEach((mm, k) => {
            if (m === 12 && a === 2026 && k === 0) return; // hueco histórico para ver S/D
            const previo = Math.min(0.75, SEP[i] * forma[k] * (0.9 + 0.05 * i) * (a === 2026 ? 1 : 1.12 + 0.01 * (a - 2021)));
            const base = a === 2026 && k === 5 ? AGO[i] : a === 2026 && k === 6 ? SEP[i] : previo;
            filas.push({
                numero_modulo: m, nombre_modulo: `Módulo ${m}`, mes: `${a}-${mm}`, ndvi_medio: base, ndvi_desv: 0.07 + 0.03 * i,
                kc_estimado: 0.15 + 1.1 * base, delta_ndvi: null, superficie_ha: SUP[i], fraccion_cobertura_activa: 0.4 + 0.08 * i,
                ventana_desde: `${a}-${mm}-01`, ventana_hasta: mm === '09' ? `${a}-10-01` : `${a}-${mm}-28`, nubosidad_max_pct: 40, n_escenas: 6, pct_pixeles_validos: 0.9,
            });
        });
    }
});

const fc = JSON.parse(fs.readFileSync(aqui('../public/geo/modulos.geojson'), 'utf-8')) as GeoJSON.FeatureCollection;
const relieve = `data:image/jpeg;base64,${fs.readFileSync(aqui('../public/dem-distrito-hillshade/hillshade_srl_plano.jpg')).toString('base64')}`;
const contexto = armarContextoPlano(JSON.parse(fs.readFileSync(aqui('../public/geo/plano_ndvi_contexto.json'), 'utf-8')), relieve);
const logo = (p: string, tipo: string) => `data:${tipo};base64,${fs.readFileSync(aqui(`../public${p}`)).toString('base64')}`;

async function escenario(nombre: string, conFalta: boolean, extra: Partial<ConfigInformeNdvi> = {}, imagenes?: 'ok' | 'parcial' | 'caida') {
    const f = conFalta ? filas.filter((x) => !(x.numero_modulo === 12 && x.mes === '2026-09')) : filas;
    const datos = construirDatosNdvi(f, {
        volumenPorModulo: new Map(MODULOS.map((m, i) => [m, 18 + i * 9])), volumenMesParcial: conFalta,
        contornosDisponibles: true, logoSrlOk: true, ahora: new Date(2026, 9, 7, 14, 5), emisor: 'Administrador SICA', version: '2.23.0',
    }, { ...configPorDefecto(mesesDisponibles(f)), ...extra });
    const contornos = contornosAAnillos(fc);
    const sinRelieve = nombre.includes('sin_relieve');
    const html = construirHtmlNdvi(datos, { srl: logo('/logos/logo-srl-informe.jpg', 'image/jpeg'), sica: logo('/logos/SICA005-informe.png', 'image/png') },
        planoSvg(datos.modulos, contornos, 470, 700, sinRelieve ? null : contexto), { contornos, conContexto: !sinRelieve, ...(imagenes ? { imagenes: await imagenesSinteticas(datos, contornos, imagenes) } : {}) });
    fs.writeFileSync(`${OUT}${nombre}.html`, html);
    console.log(nombre, `${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB`, datos.folio);
}
await escenario('integrado', false);
await escenario('integrado_con_faltantes', true);
await escenario('solo_resumen', false, { secciones: ['resumen'] });
await escenario('ponderado_indicadores', false, { basePromedio: 'ponderado', indicadores: ['kc', 'icv', 'ihr', 'iehp'] });
await escenario('comp_modulos', false, { compModulos: { tipo: 'modulos', moduloA: 1, moduloB: 12 } });
await escenario('comp_vs_srl', false, { compModulos: { tipo: 'vsSRL', moduloA: 1, moduloB: 2 } });
await escenario('sin_relieve', false);
await escenario('mes_unico', false, { preset: 'mesRef', desde: '2026-09', hasta: '2026-09' });

await escenario('con_imagen', false, { imagenSatelital: true }, 'ok');
await escenario('imagen_parcial', false, { imagenSatelital: true }, 'parcial');
await escenario('imagen_caida', false, { imagenSatelital: true }, 'caida');
