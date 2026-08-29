import { useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { CampusMap } from './CampusMap';
import { LeaderboardPanel } from './LeaderboardPanel';
import { useTerritories } from './hooks/useTerritories';
import { useTerritoryCells } from './hooks/useTerritoryCells';
import campusMapSvg from '../../assets/campus-map.svg?raw';

const CELL_DETAIL_ZOOM_THRESHOLD = 2.5;

export function MapFullScreen() {
  const { territories, loading: territoriesLoading } = useTerritories();
  const { cellsByTerritory, loading: cellsLoading } = useTerritoryCells();
  const [scale, setScale] = useState(1);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  if (territoriesLoading || cellsLoading) {
    return <div className="w-full h-screen flex items-center justify-center text-gray-400">Loading map…</div>;
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0A0E14]">
      <TransformWrapper
        initialScale={1}
        minScale={0.5}
        maxScale={10}
        wheel={{ step: 0.15 }}
        centerOnInit={false}
        onTransform={(_, state) => {
          console.log('scale changed to:', state.scale);
          setScale(state.scale);
        }}
      >
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
          <CampusMap
            svgMarkup={campusMapSvg}
            territories={territories}
            cellsByTerritory={cellsByTerritory}
            showCellDetail={scale >= CELL_DETAIL_ZOOM_THRESHOLD}
          />
        </TransformComponent>
      </TransformWrapper>

      <h2
        className="absolute top-4 left-4 text-lg tracking-wide text-amber-500 pointer-events-none"
        style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
      >
        TERRITORY CONTROL — THAPAR CAMPUS
      </h2>

      <button
        onClick={() => setShowLeaderboard((s) => !s)}
        className="absolute top-4 right-4 px-3 py-1.5 rounded text-sm border border-gray-600 text-gray-300 bg-black/40 backdrop-blur"
      >
        {showLeaderboard ? 'Hide' : 'Show'} leaderboard
      </button>

      {showLeaderboard && (
        <div className="absolute top-16 right-4 w-72">
          <LeaderboardPanel />
        </div>
      )}
    </div>
  );
}