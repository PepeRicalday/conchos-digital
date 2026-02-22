// Formatters
export const formatVol = (num: number | null | undefined) => {
    return (num ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Map based on known IDs or names from the file list
export const getLogoPath = (moduleName: string | null | undefined, moduleId: string) => {
    const safeName = moduleName || '';
    const nameLower = safeName.toLowerCase();
    if (nameLower.includes('modulo 1') || moduleId === 'm1') return '/logos/Modulo 1.jpg';
    if (nameLower.includes('modulo 2') || moduleId === 'm2') return '/logos/modulo_2.jpg';
    if (nameLower.includes('modulo 3') || moduleId === 'm3') return '/logos/modulo_3.jpg';
    if (nameLower.includes('modulo 4') || moduleId === 'm4') return '/logos/modulo_4.jpg';
    if (nameLower.includes('modulo 5') || moduleId === 'm5') return '/logos/modulo_5.jpg';
    if (nameLower.includes('modulo 12') || moduleId === 'm12') return '/logos/modulo_12.jpg';
    return '/logos/srl_logo.jpg'; // Fallback
};

// Default Sections (Hardcoded from Business Rules "4 Zonas")
export const defaultSections = [
    { id: 'sec-1', nombre: 'Sección 1: La Boquilla - Km 25', color: '#3b82f6' },
    { id: 'sec-2', nombre: 'Sección 2: Km 25 - Km 50', color: '#10b981' },
    { id: 'sec-3', nombre: 'Sección 3: Km 50 - Km 75', color: '#f59e0b' },
    { id: 'sec-4', nombre: 'Sección 4: Km 75 - Fin (Km 104)', color: '#ef4444' }
];
