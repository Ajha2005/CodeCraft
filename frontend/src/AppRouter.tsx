import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import ProblemsPage from './ProblemsPage';
import ScoringDashboard from './pages/ScoringDashboard';
import LoginPage from './auth/LoginPage';
import AuthCallback from './auth/AuthCallback';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { GuestGate } from './auth/GuestGate';
import { MapFullScreen } from './features/map/MapFullScreen';
import ChallengesPage from './features/contest/ChallengesPage';
import ContestRoomPage from './features/contest/ContestRoomPage';
import ProfilePage from './features/profile/ProfilePage';
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
            <Route
              path="/scoring"
              element={
                <GuestGate icon="chart" title="Your campaign report" body="Score, level, streak and the territory you hold are tracked per player. Sign in to start your own campaign.">
                  <ScoringDashboard />
                </GuestGate>
              }
            />
            <Route path="/map" element={<MapFullScreen />} />
            <Route
              path="/contests"
              element={
                <GuestGate icon="swords" title="Duels" body="Challenge another player for a cell of campus in a live 1v1, with a cell of your own on the line.">
                  <ChallengesPage />
                </GuestGate>
              }
            />
            <Route
              path="/contest/:id"
              element={
                <GuestGate icon="swords" title="Duels" body="A duel is a live 1v1 between two players.">
                  <ContestRoomPage />
                </GuestGate>
              }
            />
            <Route path="/profile/:username" element={<ProfilePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}