import { useEffect, useRef, useState } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { CampusMap } from './CampusMap';
import { LeaderboardPanel } from './LeaderboardPanel';
import { TerritoryLeaderboard } from './TerritoryLeaderboard';
import { useTerritories } from './hooks/useTerritories';
import { useTerritoryCells } from './hooks/useTerritoryCells';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../../auth/AuthContext';
import { EMPTY_ZONE_TAP } from '../../lib/flavorText';
import type { TerritoryDto } from '../../types/territory';
import campusMapSvg from '../../assets/campus-map.svg?raw';

const ENTER_CELL_DETAIL = 3.2;
const EXIT_CELL_DETAIL = 2.2;
const MIN_SCALE = 0.6;
const MAX_SCALE = 12;
const TICKER_TTL_MS = 8000;
const NAV_HINT_TTL_MS = 6000;

interface TickerEntry {
  id: string;
  text: string;
}

export function MapFullScreen() {
  const { territories, loading: territoriesLoading } = useTerritories();
  const { cellsByTerritory, loading: cellsLoading } = useTerritoryCells();
  const { flavorTextEnabled } = useAuth();
  const [scale, setScale] = useState(1);
  const [showCellDetail, setShowCellDetail] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [selectedTerritory, setSelectedTerritory] = useState<TerritoryDto | null>(null);
  const [emptyZoneNote, setEmptyZoneNote] = useState(false);
  const [ticker, setTicker] = useState<TickerEntry[]>([]);
  const [showNavHint, setShowNavHint] = useState(true);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const showCellDetailRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentScale = transformRef.current?.state?.scale;
      if (currentScale === undefined) return;

      setScale((prev) => (currentScale !== prev ? currentScale : prev));

      if (!showCellDetailRef.current && currentScale >= ENTER_CELL_DETAIL) {
        showCellDetailRef.current = true;
        setShowCellDetail(true);
      } else if (showCellDetailRef.current && currentScale <= EXIT_CELL_DETAIL) {
        showCellDetailRef.current = false;
        setShowCellDetail(false);
      }
    }, 100);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowNavHint(false), NAV_HINT_TTL_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!flavorTextEnabled) return;
    const socket = getSocket();

    const handleCellUpdate = (payload: { territoryId: string; ownerId: string | null }) => {
      const territory = Object.values(territories).find((t) => t.id === payload.territoryId);
      if (!territory || !payload.ownerId) return;

      const entry: TickerEntry = {
        id: `${payload.territoryId}-${Date.now()}`,
        text: `Zone captured: ${territory.name} has changed hands.`,
      };
      setTicker((prev) => [entry, ...prev].slice(0, 3));
      setTimeout(() => {
        setTicker((prev) => prev.filter((t) => t.id !== entry.id));
      }, TICKER_TTL_MS);
    };

    socket.on('cell:updated', handleCellUpdate);
    return () => {
      socket.off('cell:updated', handleCellUpdate);
    };
  }, [territories, flavorTextEnabled]);

  if (territoriesLoading || cellsLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center hud-grid-bg text-slate-400">
        Loading map…
      </div>
    );
  }

  const zoomIn = () => transformRef.current?.zoomIn(0.5, 200, 'easeOut');
  const zoomOut = () => transformRef.current?.zoomOut(0.5, 200, 'easeOut');
  const resetView = () => transformRef.current?.resetTransform(300, 'easeOut');

  function handleTerritoryClick(territory: TerritoryDto) {
    if (territory.ownerId) {
      setSelectedTerritory(territory);
      setEmptyZoneNote(false);
    } else {
      setSelectedTerritory(null);
      setEmptyZoneNote(true);
      setTimeout(() => setEmptyZoneNote(false), 4000);
    }
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0A0E14]">
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        wheel={{ step: 0.08 }}
        pinch={{ step: 5 }}
        doubleClick={{ mode: 'zoomIn', step: 0.7, animationTime: 200 }}
        panning={{ velocityDisabled: false, excluded: [] }}
        onPanningStart={() => setShowNavHint(false)}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%', cursor: 'grab' }}
          contentStyle={{ width: '100%', height: '100%' }}
        >
          <CampusMap
            svgMarkup={campusMapSvg}
            territories={territories}
            cellsByTerritory={cellsByTerritory}
            showCellDetail={showCellDetail}
            onTerritoryClick={handleTerritoryClick}
          />
        </TransformComponent>
      </TransformWrapper>

      <h2
        className="absolute top-4 left-4 text-lg tracking-wide text-cyan-400 pointer-events-none select-none drop-shadow-[0_0_12px_rgba(34,211,238,0.4)]"
        style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
      >
        TERRITORY CONTROL — THAPAR CAMPUS
      </h2>

      {flavorTextEnabled && ticker.length > 0 && (
        <div className="absolute top-14 left-4 flex flex-col gap-1 max-w-md">
          {ticker.map((t) => (
            <div
              key={t.id}
              className="text-xs text-cyan-200 bg-black/60 border border-cyan-700/40 rounded px-3 py-1.5 backdrop-blur animate-fade-in-up"
            >
              {t.text}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setShowLeaderboard((s) => !s)}
        className="absolute top-4 right-4 px-3 py-1.5 rounded-lg text-sm font-medium border border-cyan-600/40 text-cyan-300 bg-black/50 backdrop-blur hover:bg-cyan-950/40 hover:border-cyan-500/60 transition-colors"
      >
        🏆 {showLeaderboard ? 'Hide' : 'Show'} leaderboard
      </button>

      {showLeaderboard && (
        <div className="absolute top-16 right-4 w-72">
          <LeaderboardPanel />
        </div>
      )}

      {selectedTerritory && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-72">
          <TerritoryLeaderboard territory={selectedTerritory} />
          <button
            onClick={() => setSelectedTerritory(null)}
            className="mt-1.5 text-xs text-slate-400 hover:text-slate-200 underline block mx-auto"
          >
            Close
          </button>
        </div>
      )}

      {emptyZoneNote && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/70 border border-slate-700 text-sm text-gray-200 backdrop-blur animate-pop-in">
          {EMPTY_ZONE_TAP}
        </div>
      )}

      {showNavHint && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none px-4 py-2 rounded-full bg-black/60 border border-slate-700 backdrop-blur text-slate-300 text-sm flex items-center gap-2 animate-pop-in">
          <span>🖐️</span>
          <span>Drag to move around · scroll to zoom · double-click to dive in</span>
        </div>
      )}

      <div className="absolute bottom-6 right-4 flex flex-col gap-1 bg-black/50 backdrop-blur border border-cyan-600/30 rounded-lg overflow-hidden">
        <button
          onClick={zoomIn}
          className="w-10 h-10 flex items-center justify-center text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300 transition-colors border-b border-slate-700 text-lg"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={zoomOut}
          className="w-10 h-10 flex items-center justify-center text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300 transition-colors border-b border-slate-700 text-lg"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 flex items-center justify-center text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300 transition-colors text-xs"
          aria-label="Reset view"
        >
          ⤢
        </button>
      </div>
      <div className="absolute bottom-6 left-4 text-xs text-slate-500 font-mono select-none pointer-events-none">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
