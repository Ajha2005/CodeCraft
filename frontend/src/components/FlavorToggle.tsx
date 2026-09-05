import { useAuth } from '../auth/AuthContext';

export function FlavorToggle() {
  const { flavorTextEnabled, setFlavorTextEnabled } = useAuth();

  return (
    <button
      onClick={() => setFlavorTextEnabled(!flavorTextEnabled)}
      title="Toggle commander flavor text"
      className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
    >
      {flavorTextEnabled ? 'Flavor: On' : 'Flavor: Off'}
    </button>
  );
}
