
import XLSX from 'xlsx';
import fs from 'fs';

const EXCEL_PATH = 'c:/Users/peper/Downloads/Antigravity/SICA 005/conchos-digital/documentos/Canal Conchos.xlsx';

function analyzeExcel() {
    if (!fs.existsSync(EXCEL_PATH)) {
        console.error("Archivo no encontrado");
        return;
    }

    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log("=== Análisis de Excel ===");
    console.log("Nombre de Hoja:", sheetName);
    console.log("Número de registros:", data.length);
    if (data.length > 0) {
        console.log("Columnas detectadas:", Object.keys(data[0]));
        console.log("Primer registro:", JSON.stringify(data[0], null, 2));
    }
}

analyzeExcel();
