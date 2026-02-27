// Formatters
export const formatVol = (num: number | null | undefined) => {
    return (num ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// A-07: Prefer logo_url from DB, fallback to local assets by short_code
export const getLogoPath = (_moduleName: string | null | undefined, shortCode: string, logoUrl?: string | null) => {
    // 1. DB logo_url takes priority (source of truth)
    if (logoUrl) return logoUrl;

    // 2. Local assets fallback by short code
    const codeLower = (shortCode || '').toLowerCase();
    const localLogos: Record<string, string> = {
        m1: '/logos/modulo_1.jpg',
        m2: '/logos/modulo_2.jpg',
        m3: '/logos/modulo_3.jpg',
        m4: '/logos/modulo_4.jpg',
        m5: '/logos/modulo_5.jpg',
        m12: '/logos/modulo_12.jpg',
    };

    return localLogos[codeLower] || '/logos/srl_logo.png';
};

// Default Sections (Hardcoded from Business Rules "4 Zonas")
export const defaultSections = [
    { id: 'sec-1', nombre: 'Sección 1: La Boquilla - Km 25', color: '#3b82f6' },
    { id: 'sec-2', nombre: 'Sección 2: Km 25 - Km 50', color: '#10b981' },
    { id: 'sec-3', nombre: 'Sección 3: Km 50 - Km 75', color: '#f59e0b' },
    { id: 'sec-4', nombre: 'Sección 4: Km 75 - Fin (Km 104)', color: '#ef4444' }
];
