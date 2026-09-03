import { BrowserRouter, Routes, Route, Link, Outlet } from 'react-router-dom';
import ProblemsPage from './ProblemsPage';
import ScoringDashboard from './pages/ScoringDashboard';
import LoginPage from './auth/LoginPage';
import AuthCallback from './auth/AuthCallback';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';

function Nav() {
  return (
    <div className="p-3 bg-slate-900 text-slate-300 flex gap-4 text-sm">
      <Link to="/" className="hover:text-white">Problems</Link>
      <Link to="/scoring" className="hover:text-white">Scoring Dashboard</Link>
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
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}