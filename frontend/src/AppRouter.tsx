import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import ProblemsPage from './App';
import ScoringDashboard from './pages/ScoringDashboard';

function Nav() {
  return (
    <div className="p-3 bg-slate-900 text-slate-300 flex gap-4 text-sm">
      <Link to="/" className="hover:text-white">Problems</Link>
      <Link to="/scoring" className="hover:text-white">Scoring Dashboard</Link>
    </div>
  );
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<ProblemsPage />} />
        <Route path="/scoring" element={<ScoringDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
