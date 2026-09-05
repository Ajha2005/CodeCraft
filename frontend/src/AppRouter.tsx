import { BrowserRouter, Routes, Route, Link, Outlet } from 'react-router-dom';
import ProblemsPage from './ProblemsPage';
import ScoringDashboard from './pages/ScoringDashboard';
import LoginPage from './auth/LoginPage';
import AuthCallback from './auth/AuthCallback';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { MapFullScreen } from './features/map/MapFullScreen';
import { FlavorToggle } from './components/FlavorToggle';

function Nav() {
  return (
    <div className="p-3 bg-slate-900 text-slate-300 flex gap-4 text-sm items-center justify-between">
      <div className="flex gap-4">
        <Link to="/" className="hover:text-white">Problems</Link>
        <Link to="/scoring" className="hover:text-white">Scoring Dashboard</Link>
        <Link to="/map" className="hover:text-white">Map</Link>
      </div>
      <FlavorToggle />
    </div>
  );
}

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <Nav />
      <Outlet />
    </ProtectedRoute>
  );
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<ProblemsPage />} />
            <Route path="/scoring" element={<ScoringDashboard />} />
            <Route path="/map" element={<MapFullScreen />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}