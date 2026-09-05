import { BrowserRouter, Routes, Route, Link, Outlet, useLocation } from 'react-router-dom';
import ProblemsPage from './ProblemsPage';
import ScoringDashboard from './pages/ScoringDashboard';
import LoginPage from './auth/LoginPage';
import AuthCallback from './auth/AuthCallback';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { MapFullScreen } from './features/map/MapFullScreen';
import { FlavorToggle } from './components/FlavorToggle';

const NAV_LINKS = [
  { to: '/', label: 'Problems' },
  { to: '/scoring', label: 'Scoring' },
  { to: '/map', label: 'Map' },
] as const;

function Nav() {
  const { pathname } = useLocation();

  return (
    <nav className="sticky top-0 z-30 h-16 shrink-0 flex items-center justify-between gap-6 px-6 md:px-10 bg-slate-950/85 backdrop-blur-xl border-b border-slate-800/80">
      <div className="flex items-center gap-8 md:gap-12">
        <span
          className="text-lg tracking-wide select-none shrink-0"
          style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
        >
          <span className="text-slate-100">Code</span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-300">
            Craft
          </span>
        </span>
        <div className="hidden sm:flex items-center gap-7 text-xs uppercase tracking-[0.15em] font-semibold">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.to;
            return (
              <Link
                key={link.to}
                to={link.to}
                className={`pb-1 border-b-2 transition-colors ${
                  active
                    ? 'text-cyan-400 border-cyan-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
      <FlavorToggle />
    </nav>
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