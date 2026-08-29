import { useState } from 'react';
import { CampusMap } from './CampusMap';
import { LeaderboardPanel } from './LeaderboardPanel';
import { TerritoryLeaderboard } from './TerritoryLeaderboard';
import { useTerritories } from './hooks/useTerritories';
import type { TerritoryDto } from '../../types/territory';
import campusMapSvg from '../../assets/campus-map.svg?raw';

export function MapPage() {
  const { territories, loading } = useTerritories();
  const [selected, setSelected] = useState<TerritoryDto | null>(null);

  if (loading) return <div>Loading map...</div>;

  return (
    <div className="flex gap-4 p-4">
      <CampusMap
        svgMarkup={campusMapSvg}
        territories={territories}
        onTerritoryClick={setSelected}
      />
      <div className="flex flex-col gap-4">
        <LeaderboardPanel />
        <TerritoryLeaderboard territory={selected} />
      </div>
    </div>
  );
}
