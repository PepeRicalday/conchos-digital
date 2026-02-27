import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Presas from './pages/Presas';
import Canales from './pages/Canales';
import Hidrometria from './pages/Hidrometria';
import ControlEscalas from './pages/ControlEscalas';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './context/AuthContext';
import { FechaProvider } from './context/FechaContext';
import Clima from './pages/Clima';
import OfficialDamReport from './components/OfficialDamReport';
import { Toaster } from 'sonner';
import ImportReport from './pages/ImportReport';
import GeoMonitor from './pages/GeoMonitor';
import Bitacora from './pages/Bitacora';
import Ciclos from './pages/Ciclos';
import Infraestructura from './pages/Infraestructura';
import Alertas from './pages/Alertas';
import InteligenciaHidrica from './pages/InteligenciaHidrica';
import { ErrorBoundary } from './components/ErrorBoundary';
import { VersionGuard } from './components/VersionGuard';
import { UpdateBanner } from './components/UpdateBanner';
import { useRegisterSW } from 'virtual:pwa-register/react';

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen" style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b1120',
        color: '#3b82f6'
      }}>
        <div className="loader">Cargando Sistema...</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
};

function App() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: any) {
      console.log('SW Registered: ' + r);
      r && setInterval(() => { r.update(); }, 5 * 60 * 1000); // A-02: Check every 5 min
    },
    onRegisterError(error: any) {
      console.log('SW registration error', error);
    },
  });

  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <VersionGuard>
            <FechaProvider>
              <Routes>
                {/* Ruta Pública */}
                <Route path="/login" element={<Login />} />

                {/* Rutas Protegidas */}
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/presas" element={<ProtectedRoute><Presas /></ProtectedRoute>} />
                <Route path="/canales" element={<ProtectedRoute><Canales /></ProtectedRoute>} />
                <Route path="/escalas" element={<ProtectedRoute><ControlEscalas /></ProtectedRoute>} />
                <Route path="/hidrometria" element={<ProtectedRoute><Hidrometria /></ProtectedRoute>} />
                <Route path="/clima" element={<ProtectedRoute><Clima /></ProtectedRoute>} />
                <Route path="/reporte-oficial" element={<ProtectedRoute><OfficialDamReport /></ProtectedRoute>} />
                <Route path="/importar" element={<ProtectedRoute><ImportReport /></ProtectedRoute>} />
                <Route path="/alertas" element={<ProtectedRoute><Alertas /></ProtectedRoute>} />
                <Route path="/geo-monitor" element={<ProtectedRoute><GeoMonitor /></ProtectedRoute>} />
                <Route path="/bitacora" element={<ProtectedRoute><Bitacora /></ProtectedRoute>} />
                <Route path="/ciclos" element={<ProtectedRoute><Ciclos /></ProtectedRoute>} />
                <Route path="/infraestructura" element={<ProtectedRoute><Infraestructura /></ProtectedRoute>} />
                <Route path="/inteligencia-hidrica" element={<ProtectedRoute><InteligenciaHidrica /></ProtectedRoute>} />

                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              {needRefresh && (
                <UpdateBanner
                  onUpdate={() => updateServiceWorker(true)}
                  onClose={() => setNeedRefresh(false)}
                />
              )}
              <Toaster position="top-right" theme="dark" />
            </FechaProvider>
          </VersionGuard>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
