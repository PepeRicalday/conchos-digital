// Escenarios del handler completo de hydric-chat con Supabase y Anthropic SIMULADOS. Ver README.md.
import http from 'node:http';
let lento = false; let respuestaVacia = false; const peticionesLlm = [];
const sse = async (res, evs) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const [t, d] of evs) { res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`); if (lento) await new Promise(r => setTimeout(r, 150)); } res.end(); };
const msg = () => ({ message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
  const body = JSON.parse(b); peticionesLlm.push(body);
  if (!JSON.stringify(body.messages).includes('tool_result')) sse(res, [['message_start', msg()], ['content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'consultar_presas', input: {} } }], ['content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }], ['content_block_stop', { index: 0 }], ['message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }], ['message_stop', {}]]);
  else if (respuestaVacia) sse(res, [['message_start', msg()], ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }], ['message_stop', {}]]);
  else sse(res, [['message_start', msg()], ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }], ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Boquilla ' } }], ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'al 25.66 %.' } }], ['content_block_stop', { index: 0 }], ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 12 } }], ['message_stop', {}]]);
}); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_API_KEY = 'k'; process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_ANON_KEY = 'anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
const { handler: obtenHandler } = await import('../out/edge-hydric-driver.mjs');
const handler = (...a) => obtenHandler()(...a);

const CONV = '3f2b1c9e-8d4a-4b6e-9a1f-0c2d3e4f5a6b';
const SRL = { id: 'u-srl' }, ACU = { id: 'u-acu' };
const base = () => ({
  users: { 'tok-srl': SRL, 'tok-acu': ACU },
  tables: {
    perfiles_usuario: { one: (f) => ({ rol: f?.[0]?.[1] === 'u-srl' ? 'SRL' : 'ACU' }) },
    chat_messages: { count: 0, rows: [{ role: 'user', content: '¿Cómo están las presas?' }] },
    chat_conversations: { one: { id: CONV } },
    lecturas_presas: { rows: [{ presa_id: 'P1', fecha: '2026-10-18', creado_en: new Date().toISOString(), almacenamiento_mm3: 730.357, porcentaje_llenado: 25.66, presas: { nombre: 'Boquilla', nombre_corto: 'Boquilla' } }] },
    sica_eventos_log: { one: { evento_tipo: 'VACIADO', fecha_inicio: '2026-09-29T18:00:00Z', notas: 'Cierre' } },
  }, log: [],
});
const post = (body, { token = 'tok-srl', origin = 'https://conchos-digital.vercel.app', signal, raw } = {}) => handler(new Request('http://f/hydric-chat', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), origin }, body: raw ?? JSON.stringify(body), signal }));
const leeSse = async (res) => { const t = await res.text(); return t.split('\n\n').map(x => x.replace(/^data: /, '')).filter(Boolean).map(x => JSON.parse(x)); };
let fallas = 0; const ok = (c, m) => { if (!c) fallas++; console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); };

globalThis.__db = base();
let r = await post({ message: 'hola' }, { token: null }); ok(r.status === 401, `sin token -> 401 (${r.status})`);
r = await post({ message: 'hola' }, { token: 'anon-key-jwt' }); ok(r.status === 401 && (await r.json()).code === 'no_autenticado', 'JWT que no es de usuario (anon key) -> 401');
r = await post({ message: 'hola' }, { token: 'tok-acu' }); ok(r.status === 403, `usuario ACU -> 403 (${r.status})`);
r = await post(null, { raw: '{no json' }); ok(r.status === 400, `JSON invalido -> 400 (${r.status})`);
r = await post({ message: 'x'.repeat(4001) }); ok(r.status === 413, `mensaje enorme -> 413 (${r.status})`);
r = await post({ message: 'hola', contexto: 'drop table' }); ok(r.status === 400, 'contexto invalido -> 400');
r = await post({ message: 'hola', conversation_id: 'no-uuid' }); ok(r.status === 400, 'conversation_id invalido -> 400');
globalThis.__db = base(); globalThis.__db.tables.hydric_uso = { count: 7 };
r = await post({ message: 'hola' }); ok(r.status === 429, `limite por minuto (7 incluida la actual) -> 429 (${r.status})`);
globalThis.__db = base(); globalThis.__db.tables.hydric_uso = { count: 7 }; globalThis.__db.tables.chat_messages.count = 0;
ok(globalThis.__db.log.every(l => l.table !== 'chat_messages'), 'el límite NO depende de chat_messages (borrar mensajes no lo reinicia)');
globalThis.__db = base(); globalThis.__db.tables.hydric_uso = { falla: { svc: true, mensaje: 'tabla caida' } };
r = await post({ message: 'hola' }); ok(r.status === 503 && (await r.json()).code === 'limite_no_disponible', 'si no se puede contar el uso, falla CERRADO (503)');
globalThis.__db = base(); globalThis.__db.authCae = true;
r = await post({ message: 'hola' }); ok(r.status === 503, `caída del servicio de Auth -> 503, no 'sesión expirada' (${r.status})`);
globalThis.__db = base(); globalThis.__db.tables.chat_conversations.error = 'db caida';
r = await post({ message: 'hola', conversation_id: CONV }); ok(r.status === 500, `error de BD al buscar la conversación -> 500, no 404 (${r.status})`);
globalThis.__db = base(); globalThis.__db.tables.chat_conversations.one = null;
r = await post({ message: 'hola', conversation_id: CONV }); ok(r.status === 404, `conversacion ajena/inexistente -> 404 (${r.status})`);
r = await handler(new Request('http://f', { method: 'OPTIONS', headers: { origin: 'https://conchos-digital.vercel.app' } })); ok(r.status === 204 && r.headers.get('access-control-allow-origin') === 'https://conchos-digital.vercel.app', 'CORS: origen propio permitido');
r = await handler(new Request('http://f', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } })); ok(!r.headers.get('access-control-allow-origin'), 'CORS: origen ajeno sin Access-Control-Allow-Origin');
r = await handler(new Request('http://f', { method: 'GET' })); ok(r.status === 405, 'GET -> 405');

// Camino feliz
globalThis.__db = base(); globalThis.__db.tables.chat_messages.rows = []; peticionesLlm.length = 0;
r = await post({ message: '¿Cómo están las presas?', conversation_id: CONV, client_msg_id: 'cm_12345678' });
ok(r.status === 200 && r.headers.get('content-type').includes('text/event-stream'), 'camino feliz -> 200 SSE');
const ev = await leeSse(r);
const tipos = ev.map(e => e.type || (e.delta ? 'delta' : e.error ? 'error' : '?'));
ok(tipos[0] === 'inicio' && tipos.includes('estado') && tipos.includes('tarjetas') && tipos.includes('done'), `secuencia SSE: ${tipos.join(',')}`);
const texto = ev.filter(e => e.delta).map(e => e.delta).join('');
ok(texto === 'Boquilla al 25.66 %.', `texto acumulado: "${texto}"`);
const done = ev.find(e => e.type === 'done');
ok(done?.done === true && done.proveedor === 'claude' && done.conversation_id === CONV, 'evento done (compatible con el cliente actual: done:true + conversation_id)');
const lg = globalThis.__db.log;
ok(!lg.find(l => l.table === 'chat_conversations' && l.op === 'insert'), 'conversation_id previo -> no crea conversacion nueva');
const insUser = lg.filter(l => l.table === 'chat_messages' && l.op === 'insert' && l.payload.role === 'user');
ok(insUser.length === 1 && insUser[0].payload.metadata?.client_msg_id === 'cm_12345678', 'guarda el mensaje del usuario con client_msg_id');
const insAsis = lg.find(l => l.table === 'chat_messages' && l.op === 'insert' && l.payload.role === 'assistant');
ok(insAsis?.payload.content === texto && insAsis.payload.metadata.proveedor === 'claude' && insAsis.payload.metadata.tarjetas?.[0]?.kind === 'presas', 'persiste la respuesta con metadata (proveedor, tarjetas)');
ok(lg.some(l => l.table === 'chat_conversations' && l.op === 'update'), 'actualiza updated_at de la conversacion');
const sys = peticionesLlm[0].system.map(s => s.text).join('\n');
ok(sys.includes('MODO OPERATIVO: VACIADO'), 'el prompt enviado a Claude declara el modo VACIADO');

// Conversación nueva
globalThis.__db = base(); globalThis.__db.tables.chat_messages.rows = [];
r = await post({ message: 'Genera una proyección del volumen disponible para este ciclo agrícola completo por favor' }); await leeSse(r);
const nueva = globalThis.__db.log.find(l => l.table === 'chat_conversations' && l.op === 'insert');
ok(nueva?.payload.user_id === 'u-srl' && nueva.payload.titulo.length <= 61, `conversacion nueva con user_id del JWT y titulo acotado ("${nueva?.payload.titulo}")`);

// Idempotencia
globalThis.__db = base();
r = await post({ message: 'reintento', conversation_id: CONV, client_msg_id: 'cm_repetido1' });
ok(r.status === 409 && (await r.json()).code === 'duplicado', `client_msg_id ya RESPONDIDO -> 409 sin llamar al motor (${r.status})`);

globalThis.__db = base(); peticionesLlm.length = 0;
globalThis.__db.tables.chat_messages.rows = (f) => f.some(([c, v]) => c === 'role' && v === 'assistant') ? [] : [{ id: 'x', created_at: '2026-10-18T10:00:00Z', role: 'user', content: 'reintento' }];
r = await post({ message: 'reintento', conversation_id: CONV, client_msg_id: 'cm_repetido2' }); const evR = await leeSse(r);
ok(r.status === 200 && evR.some(e => e.type === 'done'), 'client_msg_id guardado SIN respuesta -> se reintenta (200)');
ok(globalThis.__db.log.filter(l => l.table === 'chat_messages' && l.payload?.role === 'user').length === 0, '... y no duplica el mensaje del usuario');
globalThis.__db = base(); globalThis.__db.tables.chat_messages.rows = [];
globalThis.__db.tables.chat_messages.falla = { anon: true, rol: 'user', code: '23505', mensaje: 'duplicate key' };
r = await post({ message: 'carrera', conversation_id: CONV, client_msg_id: 'cm_carrera01' });
ok(r.status === 200, 'violación de unicidad (23505) por carrera -> se trata como ya guardado, no es error');

// Aborto a mitad del stream
lento = true; globalThis.__db = base();
r = await post({ message: '¿Cómo están las presas?' });
const rd = r.body.getReader(); let leidos = ''; let n = 0;
while (n < 40) { const { done: d, value } = await rd.read(); if (d) break; leidos += new TextDecoder().decode(value); n++; if (leidos.includes('"delta"')) { await rd.cancel(); break; } }
await new Promise(r => setTimeout(r, 1500));
const parcial = globalThis.__db.log.find(l => l.table === 'chat_messages' && l.payload?.role === 'assistant');
ok(!!parcial && parcial.payload.metadata.abortada === true && parcial.payload.content.length > 0, `cliente desconectado -> se persiste lo generado como parcial/abortada (${parcial ? JSON.stringify(parcial.payload.content) : 'nada'})`);
lento = false;

// Persistencia: si falla con el JWT del usuario se reintenta con service role; si fallan ambos, `persistido:false` en done
globalThis.__db = base(); globalThis.__db.tables.chat_messages.rows = [];
globalThis.__db.tables.chat_messages.falla = { anon: true, rol: 'assistant', mensaje: 'jwt vencido' };
r = await post({ message: 'persistencia 1' }); let e2 = await leeSse(r);
ok(e2.find(e => e.type === 'done')?.persistido === true && globalThis.__db.log.some(l => l.table === 'chat_messages' && l.cliente === 'svc' && l.payload?.role === 'assistant'), 'fallo al persistir con el JWT del usuario -> se reintenta con service role (persistido:true)');
globalThis.__db = base(); globalThis.__db.tables.chat_messages.rows = [];
globalThis.__db.tables.chat_messages.falla = { anon: true, svc: true, rol: 'assistant', mensaje: 'bd caida' };
r = await post({ message: 'persistencia 2' }); e2 = await leeSse(r);
ok(e2.find(e => e.type === 'done')?.persistido === false, 'si fallan AMBOS intentos, el done avisa persistido:false (la respuesta no se guardó)');
// Respuesta sin texto -> error explícito, no un 200 mudo
respuestaVacia = true; globalThis.__db = base(); globalThis.__db.tables.chat_messages.rows = [];
r = await post({ message: 'vacío' }); e2 = await leeSse(r);
ok(e2.some(e => e.error && e.code === 'sin_respuesta') && !e2.some(e => e.type === 'done'), 'respuesta sin texto -> error sin_respuesta (no done mudo)');
ok(!globalThis.__db.log.some(l => l.table === 'chat_messages' && l.payload?.role === 'assistant'), '... y no se persiste una respuesta vacía');
respuestaVacia = false;

console.log(fallas ? `\n${fallas} FALLA(S)` : '\nTODO OK'); srv.close(); process.exit(fallas ? 1 : 0);
