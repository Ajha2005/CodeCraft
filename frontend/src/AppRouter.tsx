import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import ProblemsPage from './ProblemsPage';
import ScoringDashboard from './pages/ScoringDashboard';
import LoginPage from './auth/LoginPage';
import AuthCallback from './auth/AuthCallback';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { MapFullScreen } from './features/map/MapFullScreen';
import ChallengesPage from './features/contest/ChallengesPage';
import ContestRoomPage from './features/contest/ContestRoomPage';
import { Nav } from './components/Nav';
import { LevelUpOverlay } from './components/LevelUpOverlay';
import { PlayerStatsProvider } from './lib/PlayerStatsProvider';

function ProtectedLayout() {
  const { pathname } = useLocation();
  return (
    <ProtectedRoute>
      <PlayerStatsProvider>
        <Nav />
        {/* keyed by route so every page change replays the entrance */}
        <div key={pathname} className="page-enter flex min-h-0 flex-1 flex-col pb-[var(--tabbar-h)]">
          <Outlet />
        </div>
        <LevelUpOverlay />
      </PlayerStatsProvider>
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
            <Route path="/contests" element={<ChallengesPage />} />
            <Route path="/contest/:id" element={<ContestRoomPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}