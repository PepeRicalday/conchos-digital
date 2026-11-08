// Sonda de solo lectura del portal USIBWC AQUARIUS (AQWP). No escribe en BD.
// Uso: node scripts/aqwp_probe.mjs
import { inflateRawSync } from 'node:zlib';

const BASE = 'https://waterdata.ibwc.gov/AQWebportal';
const UA = 'SICA005-probe/1.0 (monitoreo DR-005 Delicias)';
const H = { 'User-Agent': UA };

const PRESAS = {
  536: '08-LBQCH-CONAGUA', 537: '08-FIMCH-CONAGUA', 538: '08-CHUCH-CONAGUA',
  539: '08-ERECH-CONAGUA', 540: '08-PAGCH-CONAGUA', 541: '08-SGBCH-CONAGUA',
  526: '08-LLNCH-CONAGUA',
};

const num = (s) => {
  const t = String(s ?? '').trim();
  if (t === '' || /^s\/?d$/i.test(t)) return null; // S/D nunca 0
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ZIP de un solo archivo (entrada local, deflate-raw)
function unzipPrimero(buf) {
  if (buf.length < 40 || buf.readUInt32LE(0) !== 0x04034b50) return '';
  const nl = buf.readUInt16LE(26), el = buf.readUInt16LE(28), cs = buf.readUInt32LE(18);
  return inflateRawSync(buf.subarray(30 + nl + el, 30 + nl + el + cs)).toString('utf8');
}

async function exportCsv(title, rango = 'Days30') {
  const q = new URLSearchParams({
    DataSet: title, Calendar: 'CALENDARYEAR', Step: '1', ExportFormat: 'csv',
    TimeAligned: 'True', RoundData: 'False', IncludeGradeCodes: 'False',
    IncludeApprovalLevels: 'False', IncludeInterpolationTypes: 'False',
    Datum: 'Original', Timezone: '-6', DateRange: rango,
  });
  const t0 = Date.now();
  const r = await fetch(`${BASE}/Export/DataSet/Csv?${q}`, { headers: H });
  const buf = Buffer.from(await r.arrayBuffer());
  const filas = unzipPrimero(buf).split(/\r?\n/)
    .filter((l) => /^\d{4}-\d{2}-\d{2}/.test(l))
    .map((l) => {
      // El formato depende del idioma de la petición: es -> "ts;1,5"  |  en -> "ts,1.5"
      if (l.includes(';')) { const [ts, v] = l.split(';'); return { ts, valor: num(v) }; }
      const i = l.indexOf(','); // el timestamp no lleva comas
      return { ts: l.slice(0, i), valor: num(l.slice(i + 1).replace(',', '.')) };
    });
  return { status: r.status, ms: Date.now() - t0, filas };
}

function estancada(filas, minDias = 4) {
  const u = filas.slice(-minDias);
  return u.length === minDias && u.every((f) => f.valor !== null && f.valor === u[0].valor);
}

const out = {};

// 1) MexResScript
const t = await (await fetch(`${BASE}/Data/GetTable?id=MexResScript&arguments=&take=50&skip=0&page=1&pageSize=50`, { headers: H })).json();
const cab = t.Data[0];
const esperadas = ['Identifier', 'Location', 'Date', 'DeadStorage', 'ConservationStorage', 'VolumeStorage',
  'DeltaVolume', 'PercentConservation', 'DischargeInflow', 'DischargeRelease', 'DischargeSpill', 'DischargeTotal'];
out.columnas_ok = esperadas.every((c) => c in cab);
out.mexres = t.Data.slice(1).map((d) => ({
  id: d.Identifier, presa: d.Location, fecha: d.Date,
  almacenamiento_mm3: num(d.VolumeStorage), pct: num(d.PercentConservation),
  inflow: num(d.DischargeInflow), release: num(d.DischargeRelease),
}));

// 2) Export por presa: 30 días, estancamiento y latencia
out.presas = {};
for (const [idn, cod] of Object.entries(PRESAS)) {
  const r = await exportCsv(`Total Storage.CONAGUA-Daily-Storage@${cod}`, 'Days30');
  out.presas[cod] = { idn: Number(idn), status: r.status, ms: r.ms, filas: r.filas.length,
    ultima: r.filas.at(-1), estancada_4d: estancada(r.filas) };
  await new Promise((s) => setTimeout(s, 500));
}

// 3) Histórico completo de Boquilla (esperado ~3689 filas desde 2015-05-01)
const full = await exportCsv('Total Storage.CONAGUA-Daily-Storage@08-LBQCH-CONAGUA', 'EntirePeriodOfRecord');
out.boquilla_historico = { filas: full.filas.length, primera: full.filas[0], ultima: full.filas.at(-1), ms: full.ms };

console.log(JSON.stringify(out, null, 2));
