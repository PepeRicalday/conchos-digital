
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function checkData() {
  const { data, error } = await supabase
    .from('reportes_operacion')
    .select('fecha');
  
  if (error) {
     console.error('Error fetching dates:', error);
  } else {
     const counts = {};
     data.forEach(r => { counts[r.fecha] = (counts[r.fecha] || 0) + 1; });
     console.log('Reportes por fecha:', counts);
  }

  const chihuahuaDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Chihuahua' });
  console.log('Hoy en Chihuahua:', chihuahuaDate);
}

checkData();
