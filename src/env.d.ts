/// <reference types="vite/client" />

// Build-time constants injected by Vite (vite.config.ts → define)
declare const __APP_VERSION__: string;
declare const __BUILD_HASH__: string;
declare const __BUILD_DATE__: string;

// PWA virtual module (vite-plugin-pwa)
declare module 'virtual:pwa-register/react' {
    import type { Dispatch, SetStateAction } from 'react';
    export function useRegisterSW(options?: RegisterSWOptions): {
        needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
        offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
        updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
    };
    interface RegisterSWOptions {
        immediate?: boolean;
        onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
        onRegisterError?: (error: any) => void;
        onNeedRefresh?: () => void;
        onOfflineReady?: () => void;
    }
}
