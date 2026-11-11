/**
 * fragmentar — corta el texto de un documento (por página) en fragmentos para la biblioteca de SICA.
 *
 * Módulo PURO y sin dependencias: lo usan la función `process-hydric-doc` (Deno) y el script local
 * `scripts/ingesta_biblioteca.mjs` (Node), para que ambos produzcan exactamente los mismos fragmentos.
 *
 * Reglas:
 *  - Conserva el número de página de inicio y fin de cada fragmento (para citar "p. 45").
 *  - Un título o numeral ("4.2.1 Desazolve", "ANEXO 3", "CAPÍTULO II") es un corte duro y se vuelve la `seccion`.
 *  - Fragmentos de ~maxChars con un solapamiento de `solape` caracteres, cortado en límite de palabra.
 *  - Un párrafo más largo que maxChars se parte por oraciones (y, en último caso, por palabras).
 */

export interface PaginaTexto { pagina: number; texto: string }

export interface Fragmento {
    orden: number;
    contenido: string;
    pagina_ini: number;
    pagina_fin: number;
    seccion: string | null;
}

export interface OpcionesFragmento {
    /** Tamaño objetivo del fragmento en caracteres. */
    maxChars?: number;
    /** Caracteres del final del fragmento anterior que se repiten al inicio del siguiente. */
    solape?: number;
    /** Un fragmento final más corto que esto se une al anterior en vez de quedar suelto. */
    minChars?: number;
}

const DEF = { maxChars: 1000, solape: 150, minChars: 120 };

/** Títulos: palabras clave de estructura o numerales "4", "4.2", "4.2.1." seguidos de texto que empieza en mayúscula. */
const RE_TITULO =
    /^(?:(?:CAP[IÍ]TULO|ANEXO|SECCI[OÓ]N|AP[EÉ]NDICE|T[IÍ]TULO|PARTE)\s+[0-9IVXLC]+[A-Z]?\b.*|\d{1,2}(?:\.\d{1,2}){0,4}\.?\s+[A-ZÁÉÍÓÚÑ][^\n]{2,})$/;
const MAX_TITULO = 110;

/** Limpia el texto crudo de una página: guiones de corte de línea, espacios repetidos, saltos de carro. */
export function limpiaPagina(texto: string): string {
    return texto
        .replace(/\r\n?/g, '\n')
        .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')       // "pala-\nbra" → "palabra"
        .replace(/[ \t ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function esTitulo(linea: string): boolean {
    const t = linea.trim();
    if (t.length < 3 || t.length > MAX_TITULO) return false;
    if (/[.;:,]$/.test(t) && !/^\d/.test(t)) return false;   // una oración que termina en punto no es título
    return RE_TITULO.test(t);
}

/** Páginas con (casi) nada de texto: candidatas a OCR. */
export function paginasSinTexto(paginas: PaginaTexto[], minChars = 40): number[] {
    return paginas.filter((p) => limpiaPagina(p.texto).replace(/\s/g, '').length < minChars).map((p) => p.pagina);
}

interface Unidad { texto: string; pagina: number; titulo: boolean }

/** Convierte las páginas en unidades (párrafos o títulos) que llevan su número de página. */
function unidades(paginas: PaginaTexto[]): Unidad[] {
    const out: Unidad[] = [];
    for (const p of paginas) {
        const limpio = limpiaPagina(p.texto);
        if (!limpio) continue;
        // Párrafos por línea en blanco; dentro de cada párrafo, las líneas que son títulos se separan.
        for (const parrafo of limpio.split(/\n\n+/)) {
            let acumulado: string[] = [];
            const suelta = () => {
                if (acumulado.length) out.push({ texto: acumulado.join(' '), pagina: p.pagina, titulo: false });
                acumulado = [];
            };
            for (const linea of parrafo.split('\n')) {
                if (esTitulo(linea)) { suelta(); out.push({ texto: linea.trim(), pagina: p.pagina, titulo: true }); }
                else if (linea.trim()) acumulado.push(linea.trim());
            }
            suelta();
        }
    }
    return out;
}

/** Parte un texto largo en piezas ≤ max: primero por oraciones, luego por palabras. */
function partir(texto: string, max: number): string[] {
    if (texto.length <= max) return [texto];
    const oraciones = texto.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [texto];
    const piezas: string[] = [];
    let actual = '';
    for (const o0 of oraciones) {
        const o = o0.trim();
        if (!o) continue;
        if (o.length > max) {
            if (actual) { piezas.push(actual); actual = ''; }
            let resto = '';
            for (const w of o.split(' ')) {
                if (resto && resto.length + 1 + w.length > max) { piezas.push(resto); resto = w; }
                else resto = resto ? `${resto} ${w}` : w;
            }
            if (resto) actual = resto;
            continue;
        }
        if (actual && actual.length + 1 + o.length > max) { piezas.push(actual); actual = o; }
        else actual = actual ? `${actual} ${o}` : o;
    }
    if (actual) piezas.push(actual);
    return piezas;
}

/** Cola del fragmento anterior para el solapamiento, empezando en límite de palabra. */
function cola(texto: string, n: number): string {
    if (n <= 0 || texto.length <= n) return n <= 0 ? '' : texto;
    const corte = texto.slice(texto.length - n);
    const esp = corte.indexOf(' ');
    return esp === -1 ? corte : corte.slice(esp + 1);
}

export function fragmentar(paginas: PaginaTexto[], opciones: OpcionesFragmento = {}): Fragmento[] {
    const { maxChars, solape, minChars } = { ...DEF, ...opciones };
    const out: Fragmento[] = [];
    let seccion: string | null = null;

    let partes: string[] = [];
    let largo = 0;
    let pIni = 0, pFin = 0;
    let secFrag: string | null = null;
    let soloSolape = true;          // el fragmento en curso solo tiene el solapamiento heredado (no se emite así)

    const emite = (conSolape: boolean) => {
        if (partes.length === 0 || soloSolape) { partes = []; largo = 0; soloSolape = true; return; }
        const contenido = partes.join(' ').trim();
        out.push({ orden: out.length, contenido, pagina_ini: pIni, pagina_fin: pFin, seccion: secFrag });
        const sigue = conSolape ? cola(contenido, solape) : '';
        partes = sigue ? [sigue] : [];
        largo = sigue.length;
        pIni = pFin;
        soloSolape = true;
    };
    const agrega = (texto: string, pagina: number) => {
        if (soloSolape) {
            // Primer contenido real del fragmento: fija su página de inicio y su sección.
            if (partes.length === 0) pIni = pagina;
            secFrag = seccion;
        }
        partes.push(texto);
        largo += texto.length + 1;
        pFin = pagina;
        soloSolape = false;
    };

    for (const u of unidades(paginas)) {
        if (u.titulo) {
            // Corte duro: lo anterior se cierra sin solapamiento (otra sección) y el título abre el siguiente.
            emite(false);
            seccion = u.texto;
            agrega(u.texto, u.pagina);
            continue;
        }
        for (const pieza of partir(u.texto, maxChars)) {
            if (!soloSolape && largo + pieza.length > maxChars) emite(true);
            agrega(pieza, u.pagina);
        }
    }
    emite(false);

    // Un último fragmento diminuto de la misma sección se une al anterior.
    if (out.length >= 2) {
        const ult = out[out.length - 1], pen = out[out.length - 2];
        if (ult.contenido.length < minChars && ult.seccion === pen.seccion) {
            pen.contenido = `${pen.contenido} ${ult.contenido}`;
            pen.pagina_fin = ult.pagina_fin;
            out.pop();
        }
    }
    return out;
}

/** Encabezado de contexto que se antepone al fragmento ANTES de calcular su vector (mejora la recuperación). */
export function encabezadoContexto(titulo: string, f: Pick<Fragmento, 'seccion' | 'pagina_ini' | 'pagina_fin'>): string {
    const pags = f.pagina_ini === f.pagina_fin ? `p. ${f.pagina_ini}` : `pp. ${f.pagina_ini}–${f.pagina_fin}`;
    return `[${[titulo, f.seccion, pags].filter(Boolean).join(' · ')}]`;
}

export function textoParaVector(titulo: string, f: Fragmento): string {
    return `${encabezadoContexto(titulo, f)}\n${f.contenido}`;
}
