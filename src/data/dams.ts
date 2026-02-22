
export interface DamDesignParams {
    name: string; // NAME - Nivel de Aguas Máximas Extraordinarias
    namo: string; // NAMO - Nivel de Aguas Máximas Ordinarias
    inactivas: string; // Nivel de Inactivas
    lodos: string; // Nivel de Lodos
    nameVol: number;
    namoVol: number;
    inactivasVol: number;
    lodosVol: number;
}

export interface ValveStatus {
    id: string;
    name: string;
    aperture: number; // 0-100%
}

export interface DamData {
    id: string;
    name: string;
    shortName: string;
    river: string;
    municipality: string;
    coordinates: { lat: number; lng: number };
    damType: string;
    params: DamDesignParams;
    currentElevation: number;
    currentStorage: number;
    namoPercent: number;
    lastReading: string;
    trend: 'rising' | 'stable' | 'falling';
    extractionQ: number;
    valves: ValveStatus[];
    spillwayQ: number;
    destination: string;
    piezometers: 'normal' | 'alert';
    seepageFlow: number;
    galleryStatus: string;
    ammermanPhoto?: string;
    intakePhoto?: string;
    operatorName: string;
}

export const DAMS_DATA: DamData[] = [
    {
        id: 'plb',
        name: 'Presa La Boquilla',
        shortName: 'PLB',
        river: 'Río Conchos',
        municipality: 'San Francisco de Conchos, Chihuahua',
        coordinates: { lat: 27.5583, lng: -105.4317 },
        damType: 'Gravedad de Concreto',
        params: {
            name: '1320.00',
            namo: '1315.00',
            inactivas: '1280.00',
            lodos: '1265.00',
            nameVol: 3990,
            namoVol: 2903,
            inactivasVol: 850,
            lodosVol: 320
        },
        currentElevation: 1298.45,
        currentStorage: 1885.3,
        namoPercent: 64.9,
        lastReading: '07/Feb/2026 - 08:00 AM',
        trend: 'rising',
        extractionQ: 45.3,
        valves: [
            { id: 'v1', name: 'Válvula 1', aperture: 75 },
            { id: 'v2', name: 'Válvula 2', aperture: 60 }
        ],
        spillwayQ: 0,
        destination: 'Canal Principal Conchos',
        piezometers: 'normal',
        seepageFlow: 2.3,
        galleryStatus: 'Limpia',
        operatorName: 'Ing. Carlos Mendoza'
    },
    {
        id: 'pfm',
        name: 'Presa Francisco I. Madero',
        shortName: 'PFM',
        river: 'Río San Pedro',
        municipality: 'Rosales, Chihuahua',
        coordinates: { lat: 28.0167, lng: -105.5333 },
        damType: 'Enrocamiento con Cara de Concreto',
        params: {
            name: '1185.00',
            namo: '1180.00',
            inactivas: '1155.00',
            lodos: '1145.00',
            nameVol: 420,
            namoVol: 348,
            inactivasVol: 85,
            lodosVol: 35
        },
        currentElevation: 1168.20,
        currentStorage: 215.8,
        namoPercent: 62.0,
        lastReading: '07/Feb/2026 - 08:00 AM',
        trend: 'stable',
        extractionQ: 12.5,
        valves: [
            { id: 'v1', name: 'Válvula Principal', aperture: 45 }
        ],
        spillwayQ: 0,
        destination: 'Canal Lateral San Pedro',
        piezometers: 'normal',
        seepageFlow: 0.8,
        galleryStatus: 'Limpia',
        operatorName: 'Ing. Laura Vázquez'
    }
];
