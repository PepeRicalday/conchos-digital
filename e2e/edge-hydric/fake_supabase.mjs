// Supabase simulado: cadena de métodos que se resuelve según globalThis.__db
const CONV = '3f2b1c9e-8d4a-4b6e-9a1f-0c2d3e4f5a6b';
class B {
  constructor(t, key) { this.t = t; this.key = key; this.op = 'select'; }
  select(_c, o) { if (o?.head) this.head = true; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  delete() { this.op = 'delete'; return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  eq(c, v) { (this.f ||= []).push([c, v]); return this; }
  gte() { return this; } gt() { return this; } lte() { return this; } in() { return this; } or() { return this; } is() { return this; } neq() { return this; }
  order() { return this; } limit() { return this; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  run() {
    const db = globalThis.__db, cfg = db.tables[this.t] ?? {};
    if (this.op === 'insert' || this.op === 'update' || this.op === 'delete') {
      const rol = this.payload?.role;
      // Fallos inyectables: por tabla, por cliente (anon = JWT del usuario, svc = service role) y opcionalmente por rol de la fila.
      const f = cfg.falla;
      if (this.op === 'insert' && f && f[this.key] && (!f.rol || f.rol === rol)) {
        db.log.push({ table: this.t, op: 'insert_fallido', cliente: this.key, payload: this.payload });
        return { data: null, error: { message: f.mensaje ?? 'fallo simulado', code: f.code ?? 'XX000' } };
      }
      db.log.push({ table: this.t, op: this.op, cliente: this.key, payload: this.payload });
      return this.one ? { data: { id: this.t === 'chat_conversations' ? CONV : 'new-id' }, error: null } : { data: null, error: null };
    }
    if (cfg.error) return { data: null, error: { message: cfg.error } };
    if (this.head) return { count: cfg.count ?? 0, error: null };
    if (this.one) { const o = typeof cfg.one === 'function' ? cfg.one(this.f) : cfg.one; return { data: o ?? null, error: null }; }
    const rows = typeof cfg.rows === 'function' ? cfg.rows(this.f ?? []) : cfg.rows;
    return { data: rows ?? [], error: null };
  }
}
export function createClient(_u, key, opts) {
  const k = key === 'svc' ? 'svc' : 'anon';
  return {
    auth: { getUser: async (token) => {
      const db = globalThis.__db;
      if (db.authCae) return { data: { user: null }, error: { message: 'auth caído', status: 503 } };
      const u = db.users[token]; return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: 'invalid JWT', status: 401 } };
    } },
    from: (t) => new B(t, k),
    rpc: async () => ({ data: [], error: null }),
    __key: key, __opts: opts,
  };
}
