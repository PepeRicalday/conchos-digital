/**
 * SICA NUCLEAR RESET — FORCED v2.0.0
 * Este script corre antes que cualquier otra cosa para garantizar la unificación.
 */
if (typeof window !== 'undefined') {
    const EPOCH_ID = 'sica_epoch_200_unified';
    if (localStorage.getItem('sica_active_epoch') !== EPOCH_ID) {
        console.log("NUCLEAR RESET: New Epoch Detected. Clearing everything...");
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('sica_active_epoch', EPOCH_ID);
        
        // Desregistrar SW y limpiar cachés
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => {
                for (let reg of regs) reg.unregister();
                window.location.reload();
            });
        } else {
            window.location.reload();
        }
    }
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/700.css'
import './index.css'
import App from './App.tsx'

// C-01: ErrorBoundary real vive en components/ErrorBoundary.tsx (usa react-error-boundary con UI premium)
// Se usa dentro de App.tsx — no duplicar aquí.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

