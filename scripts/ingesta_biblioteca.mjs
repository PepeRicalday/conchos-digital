#!/usr/bin/env node
/**
 * ingesta_biblioteca — carga los documentos locales (manuales, anexos, especificaciones, .docx) a la biblioteca de SICA.
 *
 *   node scripts/ingesta_biblioteca.mjs --dry-run            # inventario sin escribir nada (no pide claves)
 *   node scripts/ingesta_biblioteca.mjs                      # carga todo lo que aún no esté (por sha256)
 *   node scripts/ingesta_biblioteca.mjs --solo="Anexo 7"     # solo archivos cuyo nombre contenga el texto
 *   node scripts/ingesta_biblioteca.mjs --sin-vectores       # sin Voyage: solo búsqueda por palabras
 *
 * Claves (NUNCA en el repo): archivo `.env.biblioteca` en conchos-digital/ (ya ignorado por git) o variables de entorno:
 *   SUPABASE_SERVICE_ROLE_KEY=...   VOYAGE_API_KEY=...   [VOYAGE_MODEL=voyage-3.5]  [VITE_SUPABASE_URL=...]
 *
 * Reglas: las cifras que deciden salen de tablas o datos vivos; esto solo alimenta la biblioteca de TEXTO.
 * Planos .geojson y Excel PacOT NO se cargan aquí. Páginas sin texto (escaneadas) se cuentan y se marcan estado_ocr
 * (el OCR está pausado): el documento queda registrado y SICA lo reporta como "no legible", nunca como inexistente.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { fragmentar, paginasSinTexto, encabezadoContexto } from '../supabase/functions/_shared/fragmentar.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');                 // conchos-digital/
const RAIZ = resolve(APP, '..');                 // SICA 005/
const MAX_BUCKET = 30 * 1024 * 1024;
const LOTE_VOYAGE = 48;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const valor = (n) => (args.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=') || null;
const DRY = flag('dry-run');
const SIN_VECTORES = flag('sin-vectores');
const SOLO = valor('solo');

// ── Entorno ─────────────────────────────────────────────────────────────────────────────────────────────────────
function cargaEnv(ruta) {
    if (!existsSync(ruta)) return;
    for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
        const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}
cargaEnv(join(APP, '.env.biblioteca'));
cargaEnv(join(APP, '.env'));

// ── Catálogo: qué se carga y cómo se clasifica ──────────────────────────────────────────────────────────────────
const anioDe = (n) => Number(n.match(/\b(20\d{2})\b/)?.[1]) || null;      // solo si el nombre lo dice; nunca se inventa
const limpia = (n) => n.replace(extname(n), '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^\d{1,2}\s*[.\-]+\s*/, '').replace(/\s+/g, ' ').trim();

const FUENTES = [
    {
        dir: 'Conservacion/Manuales', exts: ['.pdf'],
        clasifica: (n) => {
            if (/MANUAL DE CONSERVACION 2026 ULTIMO/i.test(n)) return { tipo: 'norma', titulo: 'Manual de Conservación 2026', anio: 2026 };
            if (/LISTADO DE ANEXOS/i.test(n)) return { tipo: 'anexo', titulo: 'Manual de Conservación 2026 — Listado de anexos', anio: 2026 };
            if (/ANEXOS TECNICOS/i.test(n)) return { tipo: 'anexo', titulo: 'Anexos técnicos generales de conservación de distritos de riego', anio: anioDe(n) };
            if (/LIBRO BLANCO/i.test(n)) return { tipo: 'estudio', titulo: 'Libro Blanco de rehabilitación, modernización y equipamiento de distritos de riego', anio: anioDe(n) };
            return { tipo: 'estudio', titulo: limpia(n), anio: anioDe(n) };
        },
    },
    { dir: 'Conservacion/Anexos de Conservacion', exts: ['.pdf'], clasifica: (n) => ({ tipo: 'anexo', titulo: `Anexos de conservación — ${limpia(n)}`, anio: anioDe(n) }) },
    { dir: 'Conservacion/Espesificaciones', exts: ['.pdf'], clasifica: (n) => ({ tipo: 'especificacion', titulo: `Especificación de maquinaria — ${limpia(n)}`, anio: anioDe(n), equipo: limpia(n) }) },
    { dir: 'Manuales', exts: ['.docx'], clasifica: (n) => ({ tipo: 'manual_tecnico', titulo: limpia(n), anio: anioDe(n) }) },
];

function inventario() {
    const out = [];
    for (const f of FUENTES) {
        const dir = join(RAIZ, f.dir);
        if (!existsSync(dir)) { console.warn(`⚠ no existe ${f.dir}`); continue; }
        for (const nombre of readdirSync(dir).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
            const ruta = join(dir, nombre);
            if (!statSync(ruta).isFile() || !f.exts.includes(extname(nombre).toLowerCase())) continue;
            if (SOLO && !nombre.toLowerCase().includes(SOLO.toLowerCase())) continue;
            out.push({ ruta, rel: relative(RAIZ, ruta).replaceAll('\\', '/'), nombre, ext: extname(nombre).toLowerCase(), ...f.clasifica(nombre) });
        }
    }
    return out;
}

// ── Extracción ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Une los trozos de una página de PDF respetando saltos de línea y huecos entre palabras (evita "Parámetr os"). */
function unePagina(items) {
    let out = '';
    let prev = null;
    for (const it of items) {
        if (typeof it.str !== 'string') continue;
        const x = it.transform[4], y = it.transform[5], h = it.height || prev?.h || 10;
        if (prev) {
            if (Math.abs(y - prev.y) > h * 0.6) { if (!out.endsWith('\n')) out += '\n'; }
            else if (x - (prev.x + prev.w) > h * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
        }
        out += it.str;
        if (it.hasEOL && !out.endsWith('\n')) out += '\n';
        prev = { x, y, w: it.width, h };
    }
    return out;
}

async function extraePdf(buf) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
    const paginas = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        paginas.push({ pagina: i, texto: unePagina((await pg.getTextContent()).items) });
        pg.cleanup();
    }
    await doc.destroy();
    return paginas;
}

async function extraeDocx(buf) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return [{ pagina: 1, texto: value }];       // Word no tiene páginas fijas: las citas de .docx no llevan página
}

// ── Voyage ──────────────────────────────────────────────────────────────────────────────────────────────────────
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
async function vectores(textos, inputType = 'document') {
    const modelo = process.env.VOYAGE_MODEL || 'voyage-3.5';
    for (let intento = 0; intento < 8; intento++) {
        const res = await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: textos, model: modelo, input_type: inputType, output_dimension: 1024, truncation: true }),
        });
        if (res.status === 429 || res.status >= 500) { const e = 20 * (intento + 1); console.warn(`  Voyage ${res.status}; reintento en ${e}s`); await dorme(e * 1000); continue; }
        if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const j = await res.json();
        const v = j.data.map((d) => d.embedding);
        if (v.some((e) => e.length !== 1024)) throw new Error(`Voyage devolvió ${v[0]?.length} dimensiones, se esperaban 1024`);
        return v;
    }
    throw new Error('Voyage: demasiados reintentos');
}

// ── Proceso por archivo ─────────────────────────────────────────────────────────────────────────────────────────
const cabeza = (titulo, f, conPagina) => (conPagina ? encabezadoContexto(titulo, f) : `[${[titulo, f.seccion].filter(Boolean).join(' · ')}]`);

async function preparar(it) {
    const buf = readFileSync(it.ruta);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const esPdf = it.ext === '.pdf';
    const paginasTxt = esPdf ? await extraePdf(buf) : await extraeDocx(buf);
    const sinTexto = esPdf ? paginasSinTexto(paginasTxt) : [];
    const frags = fragmentar(paginasTxt);
    const ratio = esPdf && paginasTxt.length ? sinTexto.length / paginasTxt.length : 0;
    const estado_ocr = !esPdf || sinTexto.length === 0 ? 'no_requerido' : ratio < 0.5 ? 'parcial' : 'pendiente';
    return { ...it, buf, sha256, esPdf, paginas: paginasTxt.length, sinTexto, frags, estado_ocr, bytes: buf.length };
}

async function carga(sb, p) {
    // 1) Vectores primero: si Voyage falla no queda nada a medias en la base.
    let vecs = null;
    if (!SIN_VECTORES && p.frags.length) {
        vecs = [];
        for (let i = 0; i < p.frags.length; i += LOTE_VOYAGE) {
            const lote = p.frags.slice(i, i + LOTE_VOYAGE).map((f) => `${cabeza(p.titulo, f, p.esPdf)}\n${f.contenido}`);
            vecs.push(...(await vectores(lote)));
            process.stdout.write(`\r  vectores ${Math.min(i + LOTE_VOYAGE, p.frags.length)}/${p.frags.length}`);
        }
        process.stdout.write('\n');
    }
    // 2) Original al bucket solo si cabe (PDF ≤ 30 MB); si no, queda referencia local.
    const id = randomUUID();
    let url_storage = `local://${p.rel}`;
    if (p.esPdf && p.bytes <= MAX_BUCKET) {
        const ruta = `knowledge/${id}.pdf`;
        const { error } = await sb.storage.from('hydric-knowledge').upload(ruta, p.buf, { contentType: 'application/pdf' });
        if (error) console.warn(`  ⚠ no se subió el original (${error.message}); queda referencia local`); else url_storage = ruta;
    }
    // 3) Documento + fragmentos; si algo falla, se elimina el documento (los fragmentos caen en cascada).
    const sinChunks = p.frags.length === 0;
    const { error: e1 } = await sb.from('hydric_documents').insert({
        id, titulo: p.titulo, tipo_documento: 'manual', url_storage, created_by: null,
        estado_procesamiento: sinChunks ? 'sin_texto' : 'completado', chunks_generados: p.frags.length,
        metadata: { size: p.bytes, type: p.esPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', archivo: p.nombre },
        tipo: p.tipo, anio: p.anio ?? null, vigente: true, sha256: p.sha256, origen: 'local', ruta_local: p.rel,
        paginas: p.esPdf ? p.paginas : null, estado_ocr: p.estado_ocr, equipo: p.equipo ?? null,
    });
    if (e1) throw new Error(`documento: ${e1.message}`);
    try {
        for (let i = 0; i < p.frags.length; i += 100) {
            const filas = p.frags.slice(i, i + 100).map((f, j) => ({
                document_id: id, content: f.contenido,
                metadata: { source: p.titulo, tipo: p.tipo, orden: f.orden },
                pagina_ini: p.esPdf ? f.pagina_ini : null, pagina_fin: p.esPdf ? f.pagina_fin : null, seccion: f.seccion,
                embedding_v2: vecs ? `[${vecs[i + j].join(',')}]` : null,
            }));
            const { error } = await sb.from('hydric_document_chunks').insert(filas);
            if (error) throw new Error(`fragmentos: ${error.message}`);
        }
    } catch (err) {
        await sb.from('hydric_documents').delete().eq('id', id);
        if (url_storage.startsWith('knowledge/')) await sb.storage.from('hydric-knowledge').remove([url_storage]);
        throw err;
    }
}

// ── Principal ───────────────────────────────────────────────────────────────────────────────────────────────────
const MB = (b) => (b / 1048576).toFixed(1);
const lista = inventario();
console.log(`${DRY ? 'INVENTARIO (dry-run)' : 'INGESTA'} — ${lista.length} archivo(s) de ${RAIZ}\n`);

let sb = null;
let existentes = new Set();
if (!DRY) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY (y URL) en .env.biblioteca'); process.exit(1); }
    if (!SIN_VECTORES && !process.env.VOYAGE_API_KEY) { console.error('Falta VOYAGE_API_KEY en .env.biblioteca (o usa --sin-vectores)'); process.exit(1); }
    sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.from('hydric_documents').select('sha256').not('sha256', 'is', null);
    if (error) { console.error('No se pudo leer hydric_documents:', error.message); process.exit(1); }
    existentes = new Set(data.map((d) => d.sha256));
}

const resumen = { cargados: 0, omitidos: 0, errores: 0, fragmentos: 0, ocr: 0 };
const filas = [];
for (const it of lista) {
    try {
        const p = await preparar(it);
        const marca = `${p.tipo}${p.anio ? ' ' + p.anio : ''}`;
        filas.push({ archivo: it.nombre.slice(0, 44), tipo: marca, MB: MB(p.bytes), pags: p.esPdf ? p.paginas : '—', 'sin texto': p.sinTexto.length, ocr: p.estado_ocr, frags: p.frags.length });
        if (p.estado_ocr !== 'no_requerido') resumen.ocr++;
        if (DRY) continue;
        if (existentes.has(p.sha256)) { console.log(`= ya cargado: ${it.nombre}`); resumen.omitidos++; continue; }
        console.log(`+ ${it.nombre} (${p.frags.length} fragmentos, ${p.paginas} pág.)`);
        await carga(sb, p);
        existentes.add(p.sha256);
        resumen.cargados++; resumen.fragmentos += p.frags.length;
    } catch (err) {
        resumen.errores++;
        console.error(`✗ ${it.nombre}: ${err.message}`);
    }
}
console.table(filas);
const totFrag = filas.reduce((s, f) => s + f.frags, 0);
console.log(DRY
    ? `\nTotal: ${filas.length} archivos, ${totFrag} fragmentos; con páginas sin texto (OCR pendiente/parcial): ${resumen.ocr}. No se escribió nada.`
    : `\nListo: ${resumen.cargados} cargados (${resumen.fragmentos} fragmentos), ${resumen.omitidos} ya estaban, ${resumen.errores} con error.`);
process.exit(resumen.errores ? 1 : 0);
