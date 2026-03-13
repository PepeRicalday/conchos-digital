
const { createClient } = require('./node_modules/@supabase/supabase-js/dist/index.cjs');
const fs = require('fs');
const path = require('path');

function getEnv() {
  const content = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      env[key] = value;
    }
  });
  return env;
}

const env = getEnv();
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function check() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Chihuahua' });
  const { data: readings } = await supabase
      .from('lecturas_escalas')
      .select('escala_id, nivel_m, fecha, hora_lectura')
      .eq('fecha', today)
      .order('hora_lectura', { ascending: false });

  console.log('Readings for today:', readings);
}

check();
