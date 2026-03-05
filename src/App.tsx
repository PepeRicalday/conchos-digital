import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FechaProvider } from './context/FechaContext';
import { Toaster } from 'sonner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VersionGuard } from './components/VersionGuard';

// ── Lazy-loaded pages (Code Splitting) ───────────────────────── //
// Each page is loaded on-demand, reducing initial bundle by ~60%.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Presas = lazy(() => import('./pages/Presas'));
const Canales = lazy(() => import('./pages/Canales'));
const Hidrometria = lazy(() => import('./pages/Hidrometria'));
const ControlEscalas = lazy(() => import('./pages/ControlEscalas'));
const Clima = lazy(() => import('./pages/Clima'));
const OfficialDamReport = lazy(() => import('./components/OfficialDamReport'));
const ImportReport = lazy(() => import('./pages/ImportReport'));
const GeoMonitor = lazy(() => import('./pages/GeoMonitor'));
const Bitacora = lazy(() => import('./pages/Bitacora'));
const Ciclos = lazy(() => import('./pages/Ciclos'));
const Infraestructura = lazy(() => import('./pages/Infraestructura'));
const Alertas = lazy(() => import('./pages/Alertas'));
const InteligenciaHidrica = lazy(() => import('./pages/InteligenciaHidrica'));
const BalanceHidraulico = lazy(() => import('./pages/BalanceHidraulico'));

// ── Premium Loading Fallback ─────────────────────────────────── //
const PageLoader = () => (
  <div style={{
    height: '100%',
    minHeight: '60vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1.5rem',
  }}>
    <div style={{
      width: '48px',
      height: '48px',
      border: '3px solid rgba(56, 189, 248, 0.15)',
      borderTopColor: '#38bdf8',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.35rem',
    }}>
      <span style={{
        fontSize: '0.8rem',
        fontWeight: 700,
        letterSpacing: '3px',
        textTransform: 'uppercase',
        color: '#38bdf8',
        fontFamily: 'var(--font-mono)',
      }}>SICA 005</span>
      <span style={{
        fontSize: '0.7rem',
        color: '#475569',
        letterSpacing: '1px',
      }}>Cargando módulo…</span>
    </div>
  </div>
);

// ── Page-Level Error Boundary Wrapper ────────────────────────── //
// Wraps each lazy page so a crash in one module doesn't collapse the entire app.
const SafePage = ({ children }: { children: ReactNode }) => (
  <ErrorBoundary>
    <Suspense fallback={<PageLoader />}>
      {children}
    </Suspense>
  </ErrorBoundary>
);

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen" style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#020617',
        gap: '1.5rem',
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          border: '3px solid rgba(56, 189, 248, 0.1)',
          borderTopColor: '#38bdf8',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.5rem',
        }}>
          <span style={{
            fontSize: '0.9rem',
            fontWeight: 800,
            letterSpacing: '4px',
            textTransform: 'uppercase',
            background: 'linear-gradient(to right, #38bdf8, #22d3ee)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontFamily: 'var(--font-mono)',
          }}>SICA 005</span>
          <span style={{
            fontSize: '0.75rem',
            color: '#475569',
            letterSpacing: '2px',
            textTransform: 'uppercase',
          }}>Iniciando sistema de control…</span>
          <div style={{
            width: '120px',
            height: '2px',
            background: 'rgba(56, 189, 248, 0.1)',
            borderRadius: '1px',
            overflow: 'hidden',
            marginTop: '0.5rem',
          }}>
            <div style={{
              width: '40%',
              height: '100%',
              background: 'linear-gradient(to right, #38bdf8, #22d3ee)',
              borderRadius: '1px',
              animation: 'loading-bar 1.5s ease-in-out infinite',
            }} />
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
};

function App() {
  // --- PWA SERVICE WORKER: Registro silencioso v3 ---
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(registration => {
      setInterval(() => {
        registration.update().catch(() => { });
      }, 10 * 60 * 1000);
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }

  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <VersionGuard>
            <FechaProvider>
              <Routes>
                {/* Ruta Pública */}
                <Route path="/login" element={<Login />} />

                {/* Rutas Protegidas — cada una con su propio Error Boundary */}
                <Route path="/" element={<ProtectedRoute><SafePage><Dashboard /></SafePage></ProtectedRoute>} />
                <Route path="/presas" element={<ProtectedRoute><SafePage><Presas /></SafePage></ProtectedRoute>} />
                <Route path="/canales" element={<ProtectedRoute><SafePage><Canales /></SafePage></ProtectedRoute>} />
                <Route path="/escalas" element={<ProtectedRoute><SafePage><ControlEscalas /></SafePage></ProtectedRoute>} />
                <Route path="/hidrometria" element={<ProtectedRoute><SafePage><Hidrometria /></SafePage></ProtectedRoute>} />
                <Route path="/clima" element={<ProtectedRoute><SafePage><Clima /></SafePage></ProtectedRoute>} />
                <Route path="/reporte-oficial" element={<ProtectedRoute><SafePage><OfficialDamReport /></SafePage></ProtectedRoute>} />
                <Route path="/importar" element={<ProtectedRoute><SafePage><ImportReport /></SafePage></ProtectedRoute>} />
                <Route path="/alertas" element={<ProtectedRoute><SafePage><Alertas /></SafePage></ProtectedRoute>} />
                <Route path="/geo-monitor" element={<ProtectedRoute><SafePage><GeoMonitor /></SafePage></ProtectedRoute>} />
                <Route path="/bitacora" element={<ProtectedRoute><SafePage><Bitacora /></SafePage></ProtectedRoute>} />
                <Route path="/ciclos" element={<ProtectedRoute><SafePage><Ciclos /></SafePage></ProtectedRoute>} />
                <Route path="/infraestructura" element={<ProtectedRoute><SafePage><Infraestructura /></SafePage></ProtectedRoute>} />
                <Route path="/inteligencia-hidrica" element={<ProtectedRoute><SafePage><InteligenciaHidrica /></SafePage></ProtectedRoute>} />
                <Route path="/balance" element={<ProtectedRoute><SafePage><BalanceHidraulico /></SafePage></ProtectedRoute>} />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              <Toaster position="top-right" theme="dark" />
            </FechaProvider>
          </VersionGuard>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
