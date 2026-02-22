import Dexie, { type Table } from 'dexie';

export interface RegistroOffline {
    id?: number;
    tipo: 'presa' | 'clima' | 'escala';
    datos: any;
    fecha_captura: string;
    sincronizado: boolean;
}

export class SicaLocalDB extends Dexie {
    registros!: Table<RegistroOffline, number>;

    constructor() {
        super('SicaLocalDB');
        this.version(1).stores({
            registros: '++id, tipo, fecha_captura, sincronizado'
        });
    }
}

export const db = new SicaLocalDB();
