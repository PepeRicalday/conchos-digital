import XLSX from 'xlsx';
import path from 'path';

const filePath = './public/datos/puntos_entrega_rows validado.xlsx';

async function read() {
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log('Total rows:', data.length);
        if (data.length > 0) {
            console.log('Headers:', Object.keys(data[0]));
            console.log('First 3 rows:', JSON.stringify(data.slice(0, 3), null, 2));
        }
    } catch (error) {
        console.error('Error reading excel:', error);
    }
}

read();
