import { useState, useRef, useEffect } from 'react';
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { CampusMap } from './CampusMap';
import { LeaderboardPanel } from './LeaderboardPanel';
import { useTerritories } from './hooks/useTerritories';
import { useTerritoryCells } from './hooks/useTerritoryCells';
import campusMapSvg from '../../assets/campus-map.svg?raw';

const ENTER_CELL_DETAIL = 2.6;
const EXIT_CELL_DETAIL = 2.3;
const MIN_SCALE = 0.6;
const MAX_SCALE = 12;

export function MapFullScreen() {
  const { territories, loading: territoriesLoading } = useTerritories();
  const { cellsByTerritory, loading: cellsLoading } = useTerritoryCells();
  const [scale, setScale] = useState(1);
  const [showCellDetail, setShowCellDetail] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
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

  if (territoriesLoading || cellsLoading) {
    return <div className="w-full h-screen flex items-center justify-center text-gray-400">Loading map…</div>;
  }

  const zoomIn = () => transformRef.current?.zoomIn(0.5, 200, 'easeOut');
  const zoomOut = () => transformRef.current?.zoomOut(0.5, 200, 'easeOut');
  const resetView = () => transformRef.current?.resetTransform(300, 'easeOut');

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
          />
        </TransformComponent>
      </TransformWrapper>

      <h2
        className="absolute top-4 left-4 text-lg tracking-wide text-amber-500 pointer-events-none select-none"
        style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: 700 }}
      >
        TERRITORY CONTROL — THAPAR CAMPUS
      </h2>

      <button
        onClick={() => setShowLeaderboard((s) => !s)}
        className="absolute top-4 right-4 px-3 py-1.5 rounded text-sm border border-gray-600 text-gray-300 bg-black/40 backdrop-blur hover:bg-black/60 transition-colors"
      >
        {showLeaderboard ? 'Hide' : 'Show'} leaderboard
      </button>

      {showLeaderboard && (
        <div className="absolute top-16 right-4 w-72">
          <LeaderboardPanel />
        </div>
      )}

      <div className="absolute bottom-6 right-4 flex flex-col gap-1 bg-black/40 backdrop-blur border border-gray-700 rounded overflow-hidden">
        <button
          onClick={zoomIn}
          className="w-10 h-10 flex items-center justify-center text-gray-200 hover:bg-white/10 transition-colors border-b border-gray-700 text-lg"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          onClick={zoomOut}
          className="w-10 h-10 flex items-center justify-center text-gray-200 hover:bg-white/10 transition-colors border-b border-gray-700 text-lg"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 flex items-center justify-center text-gray-200 hover:bg-white/10 transition-colors text-xs"
          aria-label="Reset view"
        >
          ⤢
        </button>
      </div>
<div className="absolute top-16 left-4 text-xs text-lime-400 font-mono bg-black/60 p-2 rounded pointer-events-none">
  scale: {scale.toFixed(2)} | showCellDetail: {String(showCellDetail)}
</div>
      <div className="absolute bottom-6 left-4 text-xs text-gray-500 font-mono select-none pointer-events-none">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}