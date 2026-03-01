const XLSX = require('xlsx');
const path = require('path');

const filePath = 'C:/Users/Atom/Downloads/BD_Conjunta_Presas_Enero_Febrero_2026.xlsx';

try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log('--- HEADERS ---');
    console.log(Object.keys(data[0] || {}));
    console.log('--- FIRST 3 ROWS ---');
    console.log(JSON.stringify(data.slice(0, 3), null, 2));
} catch (err) {
    console.error('Error reading file:', err.message);
}
