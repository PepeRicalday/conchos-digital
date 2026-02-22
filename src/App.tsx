
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
import ImportReport from './pages/ImportReport';
import GeoMonitor from './pages/GeoMonitor';
import { ErrorBoundary } from './components/ErrorBoundary';

const Alertas = () => <div><h2>Centro de Alertas</h2></div>;

// Componente para proteger rutas
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
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
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
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

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </FechaProvider>
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
