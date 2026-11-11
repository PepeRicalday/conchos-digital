#!/usr/bin/env node
/**
 * sync_wiki — sube las notas de la bóveda de Obsidian (carpeta `wiki/`) a la tabla `wiki_paginas`, de donde las lee SICA
 * con la herramienta `leer_wiki`. La bóveda es la fuente; la base es una copia de lectura.
 *
 *   node scripts/sync_wiki.mjs --dry-run         # qué subiría/cambiaría, sin escribir
 *   node scripts/sync_wiki.mjs                   # sube lo nuevo o modificado (por sha256)
 *   node scripts/sync_wiki.mjs --prune           # además elimina de la base las notas que ya no existen en la bóveda
 *
 * Bóveda: variable WIKI_VAULT (default C:/Users/peper/Downloads/SICA 005/SICA 005). Claves en `.env.biblioteca`
 * (SUPABASE_SERVICE_ROLE_KEY; URL de VITE_SUPABASE_URL en `.env`). Nunca en el repo.
 *
 * Frontmatter reconocido: `tipo`, `fuentes` (lista), `verificado: true|false`. Una nota sin `verificado: true` se trata
 * como SIN verificar: SICA la presenta como apoyo y confirma en el documento original.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, basename, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = process.env.WIKI_VAULT || 'C:/Users/peper/Downloads/SICA 005/SICA 005';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PRUNE = args.includes('--prune');
const EXCLUIR = new Set(['index', 'log']);        // metadatos de la bóveda, no conocimiento

for (const ruta of [join(APP, '.env.biblioteca'), join(APP, '.env')]) {
    if (!existsSync(ruta)) continue;
    for (const l of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
}

function* archivosMd(dir) {
    for (const n of readdirSync(dir)) {
        const r = join(dir, n);
        if (statSync(r).isDirectory()) yield* archivosMd(r);
        else if (extname(n).toLowerCase() === '.md') yield r;
    }
}

/** Frontmatter mínimo: `clave: valor` y listas `[a, b]` o con guiones. Devuelve {meta, cuerpo}. */
export function parseNota(crudo) {
    const m = crudo.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { meta: {}, cuerpo: crudo };
    const meta = {};
    let clave = null;
    for (const linea of m[1].split(/\r?\n/)) {
        const kv = linea.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        const item = linea.match(/^\s*-\s+(.*)$/);
        if (kv) {
            clave = kv[1];
            const v = kv[2].trim();
            if (v === '') meta[clave] = [];
            else if (v.startsWith('[')) meta[clave] = v.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            else meta[clave] = v.replace(/^["']|["']$/g, '');
        } else if (item && clave && Array.isArray(meta[clave])) meta[clave].push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
    return { meta, cuerpo: m[2] };
}

export function extraeEnlaces(cuerpo) {
    const out = new Set();
    for (const m of cuerpo.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.add(m[1].trim().toLowerCase().replace(/\s+/g, '-'));
    return [...out];
}

export function resumenDe(cuerpo) {
    for (const bloque of cuerpo.split(/\n\s*\n/)) {
        const t = bloque.trim();
        if (!t || /^(#|>|\||-{3,}|\*{3,}|!\[|```)/.test(t)) continue;
        return t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').slice(0, 300);
    }
    return null;
}

export function notaDe(archivo, raiz) {
    const crudo = readFileSync(archivo, 'utf8');
    const { meta, cuerpo } = parseNota(crudo);
    const slug = basename(archivo, '.md').toLowerCase().replace(/\s+/g, '-');
    const h1 = cuerpo.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const carpeta = relative(raiz, dirname(archivo)).replaceAll('\\', '/') || 'raiz';
    return {
        slug, titulo: h1 || basename(archivo, '.md'), carpeta, tipo: typeof meta.tipo === 'string' ? meta.tipo : null,
        resumen: resumenDe(cuerpo.replace(/^#\s+.+$/m, '')), contenido: cuerpo.trim(),
        enlaces: extraeEnlaces(cuerpo).filter((e) => e !== slug),
        fuentes: Array.isArray(meta.fuentes) ? meta.fuentes : meta.fuentes ? [meta.fuentes] : [],
        verificado: String(meta.verificado ?? '').toLowerCase() === 'true',
        sha256: createHash('sha256').update(crudo).digest('hex'),
    };
}

// Solo corre como script (no al importarse desde pruebas).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const raizWiki = join(VAULT, 'wiki');
    if (!existsSync(raizWiki)) { console.error(`No existe ${raizWiki}. Define WIKI_VAULT.`); process.exit(1); }

    const notas = [];
    const vistos = new Map();
    for (const f of archivosMd(raizWiki)) {
        const n = notaDe(f, raizWiki);
        if (EXCLUIR.has(n.slug)) continue;
        if (n.contenido.length < 40) { console.warn(`- omitida (vacía): ${relative(raizWiki, f)}`); continue; }
        if (vistos.has(n.slug)) { console.warn(`⚠ slug repetido "${n.slug}": ${relative(raizWiki, f)} y ${vistos.get(n.slug)} — se conserva la primera`); continue; }
        vistos.set(n.slug, relative(raizWiki, f));
        notas.push(n);
    }
    const slugs = new Set(notas.map((n) => n.slug));
    const rotos = notas.flatMap((n) => n.enlaces.filter((e) => !slugs.has(e)).map((e) => `${n.slug} → [[${e}]]`));

    console.table(notas.map((n) => ({ slug: n.slug, carpeta: n.carpeta, chars: n.contenido.length, enlaces: n.enlaces.length, fuentes: n.fuentes.length, verificado: n.verificado })));
    console.log(`${notas.length} notas; ${notas.filter((n) => !n.verificado).length} sin verificar; ${rotos.length} enlaces a notas que no existen.`);
    if (rotos.length) console.log('Enlaces rotos (muestra):\n  ' + rotos.slice(0, 12).join('\n  '));
    if (DRY) { console.log('\n(dry-run: no se escribió nada)'); process.exit(0); }

    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY en .env.biblioteca'); process.exit(1); }
    const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: previas, error: e0 } = await sb.from('wiki_paginas').select('slug,sha256');
    if (e0) { console.error('No se pudo leer wiki_paginas:', e0.message); process.exit(1); }
    const sha = new Map(previas.map((p) => [p.slug, p.sha256]));

    let nuevas = 0, cambiadas = 0, iguales = 0;
    for (const n of notas) {
        if (sha.get(n.slug) === n.sha256) { iguales++; continue; }
        const { error } = await sb.from('wiki_paginas').upsert({ ...n, actualizado_en: new Date().toISOString() }, { onConflict: 'slug' });
        if (error) { console.error(`✗ ${n.slug}: ${error.message}`); process.exitCode = 1; continue; }
        sha.has(n.slug) ? cambiadas++ : nuevas++;
    }
    let borradas = 0;
    if (PRUNE) {
        const sobran = [...sha.keys()].filter((s) => !slugs.has(s));
        if (sobran.length) {
            const { error } = await sb.from('wiki_paginas').delete().in('slug', sobran);
            if (error) console.error('✗ prune:', error.message); else borradas = sobran.length;
        }
    }
    console.log(`Listo: ${nuevas} nuevas, ${cambiadas} actualizadas, ${iguales} sin cambios${PRUNE ? `, ${borradas} eliminadas` : ''}.`);
}
