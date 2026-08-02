import XLSX from 'xlsx';
import path from 'path';

const excelPath = 'c:/Users/peper/Downloads/Antigravity/SICA 005/conchos-digital/dist/datos/Canal Conchos.xlsx';

try {
  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  console.log('--- ESTRUCTURA DE EXCEL (PRIMERAS 5 FILAS) ---');
  console.log(JSON.stringify(data.slice(0, 5), null, 2));
} catch (err) {
  console.error('Error reading Excel:', err.message);
}
