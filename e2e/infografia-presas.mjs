// Infografía "Estado actual de las presas": pulsa el botón en /presas, captura la descarga y valida el PNG.
//   node e2e/infografia-presas.mjs [carpeta=infografia-presas]      (requiere dev server en :5173)
import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';

const carpeta = process.argv[2] || 'infografia-presas';
const OUT = fileURLToPath(new URL(`./out/${carpeta}/`, import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

const errs = [];
const fallos = [];
const verifica = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fallos.push(msg); };

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1600, height: 950 }, acceptDownloads: true });
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto('http://localhost:5173/presas', { waitUntil: 'networkidle' }).catch(() => {});
const boton = page.getByRole('button', { name: /infograf/i }).first();
await boton.waitFor({ timeout: 30000 });

const [descarga] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  boton.click(),
]);
const nombre = descarga.suggestedFilename();
const ruta = `${OUT}${nombre}`;
await descarga.saveAs(ruta);

verifica(/^estado-presas-conchos-\d{4}-\d{2}-\d{2}\.png$/.test(nombre), `nombre de archivo (${nombre})`);
const buf = fs.readFileSync(ruta);
const esPng = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
const ancho = buf.readUInt32BE(16), alto = buf.readUInt32BE(20);
verifica(esPng, 'es un PNG válido');
verifica(ancho === 3200, `ancho 3200 px (2x de 1600): ${ancho}`);
verifica(alto >= 1800 && alto <= 2800, `alto razonable: ${alto}`);
verifica(buf.length < 4_000_000, `peso < 4 MB: ${(buf.length / 1048576).toFixed(2)} MB`);
console.log('PNG:', ruta);

await page.waitForTimeout(500);
const aviso = await page.locator('.scada-action-aviso').count();
verifica(aviso === 0, 'sin aviso de error en la página');

await b.close();
const relevantes = errs.filter(e => !/favicon|ResizeObserver/i.test(e));
verifica(relevantes.length === 0, `sin errores de consola/JS (${relevantes.length})`);
if (relevantes.length) console.log(relevantes.slice(0, 5));
console.log(fallos.length ? `\n${fallos.length} FALLO(S)` : '\nTodo OK');
process.exit(fallos.length ? 1 : 0);
