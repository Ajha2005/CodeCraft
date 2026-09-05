import { useEffect, useMemo, useRef, useState } from 'react';
import type { TerritoryDto } from '../../types/territory';
import type { TerritoryCellDto } from '../../lib/api';
import { computeStripeWidths, aggregateOwnership } from './utils/computeStripeWidths';


interface CampusMapProps {
  svgMarkup: string;
  territories: Record<string, TerritoryDto>;
  cellsByTerritory: Record<string, TerritoryCellDto[]>;
  showCellDetail: boolean;
  onTerritoryClick?: (territory: TerritoryDto) => void;
  onTerritoryHover?: (territory: TerritoryDto | null) => void;
}

const TIER_STROKE_WIDTH: Record<string, string> = {
  OUTPOST: '1',
  SETTLEMENT: '1.5',
  STRONGHOLD: '2',
  CITADEL: '2.5',
};

const BRASS = '#C9A227';
const STONE_FILL = '#2B323D';
const STONE_STROKE = '#4A5568';
const LABEL_UNCLAIMED_COLOR = '#CBD5E1';
const MIN_LABEL_WIDTH = 45;
const MIN_LABEL_HEIGHT = 24;
const CELL_SIZE = 18.5; // must match generate-grid.ts

function truncateToFit(name: string, boxWidth: number, fontSize: number): string {
  const approxCharWidth = fontSize * 0.58;
  const maxChars = Math.floor(boxWidth / approxCharWidth);
  if (name.length <= maxChars) return name;
  if (maxChars <= 1) return '';
  return name.slice(0, maxChars - 1).trimEnd() + '…';
}

export function CampusMap({
  svgMarkup,
  territories,
  cellsByTerritory,
  showCellDetail,
  onTerritoryClick,
  onTerritoryHover,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellLayerCount, setCellLayerCount] = useState(0);
  const innerHtml = useMemo(() => ({ __html: svgMarkup }), [svgMarkup]);

  useEffect(() => {
    console.log('[CampusMap] MOUNTED');
    return () => console.log('[CampusMap] UNMOUNTING');
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const svg = containerRef.current?.querySelector('svg');
      const count = svg?.querySelectorAll('[data-cell-layer]').length ?? 0;
      setCellLayerCount(count);
    }, 300);
    return () => clearInterval(interval);
  }, []);

 useEffect(() => {
  const container = containerRef.current;
  const svg = container?.querySelector('svg');
  if (!container || !svg) return;

  svg.querySelectorAll('[data-stripe-pattern]').forEach((el) => el.remove());

  const defs =
    svg.querySelector('defs') ??
    (() => {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.insertBefore(d, svg.firstChild);
      return d;
    })();

  for (const [svgPathId, territory] of Object.entries(territories)) {
    const pathEl = container.querySelector<SVGPathElement>(`#${CSS.escape(svgPathId)}`);
    if (!pathEl) continue;

    pathEl.style.stroke = STONE_STROKE;
    pathEl.style.strokeWidth = TIER_STROKE_WIDTH[territory.tier] ?? '1';
    pathEl.style.fillOpacity = '1';

    if (showCellDetail) {
      pathEl.style.fill = 'none';
      continue;
    }

    const cells = cellsByTerritory[territory.id] ?? [];
    const shares = aggregateOwnership(cells);

    if (shares.length === 0) {
      pathEl.style.fill = STONE_FILL;
    } else if (shares.length === 1) {
      pathEl.style.fill = shares[0].color;
    } else {
      const patternId = `stripe-${svgPathId}`;
      const stripes = computeStripeWidths(shares);

      const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
      pattern.setAttribute('id', patternId);
      pattern.setAttribute('data-stripe-pattern', svgPathId);
      pattern.setAttribute('patternUnits', 'objectBoundingBox');
      pattern.setAttribute('width', '1');
      pattern.setAttribute('height', '1');
      pattern.setAttribute('patternTransform', 'rotate(45)');

      for (const s of stripes) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', `${s.offset}%`);
        rect.setAttribute('y', '0');
        rect.setAttribute('width', `${s.pct}%`);
        rect.setAttribute('height', '100%');
        rect.setAttribute('fill', s.color);
        pattern.appendChild(rect);
      }

      defs.appendChild(pattern);
      pathEl.style.fill = `url(#${patternId})`;
    }
  }
}, [territories, showCellDetail, cellsByTerritory]);

  useEffect(() => {
    const container = containerRef.current;
    const svg = container?.querySelector('svg');
    if (!container || !svg) return;

    svg.querySelectorAll('[data-decoration]').forEach((el) => el.remove());

    if (!svg.querySelector('#contested-pulse-style')) {
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.setAttribute('id', 'contested-pulse-style');
      style.textContent = `
        @keyframes contested-pulse {
          0%, 100% { stroke-opacity: 0.35; }
          50% { stroke-opacity: 1; }
        }
        .contested-ring { animation: contested-pulse 1.6s ease-in-out infinite; }
      `;
      svg.insertBefore(style, svg.firstChild);
    }

    for (const [svgPathId, territory] of Object.entries(territories)) {
      const pathEl = container.querySelector<SVGPathElement>(`#${CSS.escape(svgPathId)}`);
      if (!pathEl) continue;

      const box = pathEl.getBBox();

      if (!showCellDetail) {
        const cells = cellsByTerritory[territory.id] ?? [];
        const shares = aggregateOwnership(cells);
        if (shares.length > 1) {
          const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          ring.setAttribute('data-decoration', `${svgPathId}-contested`);
          ring.setAttribute('class', 'contested-ring');
          ring.setAttribute('x', String(box.x - 1.5));
          ring.setAttribute('y', String(box.y - 1.5));
          ring.setAttribute('width', String(box.width + 3));
          ring.setAttribute('height', String(box.height + 3));
          ring.setAttribute('fill', 'none');
          ring.setAttribute('stroke', '#F97316');
          ring.setAttribute('stroke-width', '2');
          ring.setAttribute('pointer-events', 'none');
          svg.appendChild(ring);

          const counter = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          counter.setAttribute('data-decoration', `${svgPathId}-contested-count`);
          counter.setAttribute('x', String(box.x + box.width / 2));
          counter.setAttribute('y', String(box.y - 3));
          counter.setAttribute('text-anchor', 'middle');
          counter.setAttribute('pointer-events', 'none');
          counter.setAttribute('font-family', "'Rajdhani', sans-serif");
          counter.setAttribute('font-weight', '700');
          counter.setAttribute('font-size', '9');
          counter.setAttribute('fill', '#F97316');
          counter.textContent = `${shares.length} soldiers eyeing this territory`;
          svg.appendChild(counter);
        }
      }

      if (territory.tier === 'CITADEL') {
        const len = Math.min(box.width, box.height) * 0.18;
        const corners = [
          [box.x, box.y, 1, 1],
          [box.x + box.width, box.y, -1, 1],
          [box.x, box.y + box.height, 1, -1],
          [box.x + box.width, box.y + box.height, -1, -1],
        ] as const;

        const reticle = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        reticle.setAttribute('data-decoration', `${svgPathId}-reticle`);
        reticle.setAttribute('pointer-events', 'none');

        for (const [x, y, dx, dy] of corners) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          line.setAttribute('d', `M ${x} ${y + len * dy} L ${x} ${y} L ${x + len * dx} ${y}`);
          line.setAttribute('stroke', BRASS);
          line.setAttribute('stroke-width', '2');
          line.setAttribute('fill', 'none');
          reticle.appendChild(line);
        }
        svg.appendChild(reticle);
      }

      if (box.width >= MIN_LABEL_WIDTH && box.height >= MIN_LABEL_HEIGHT) {
        const fontSize = Math.min(14, Math.max(8, box.height * 0.16));
        const label = truncateToFit(territory.name, box.width - 6, fontSize);
        if (!label) continue;

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('data-decoration', `${svgPathId}-label`);
        text.setAttribute('x', String(box.x + box.width / 2));
        text.setAttribute('y', String(box.y + box.height / 2));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('pointer-events', 'none');
        text.setAttribute('font-family', "'Rajdhani', sans-serif");
        text.setAttribute('font-weight', '600');
        text.setAttribute('font-size', String(fontSize));
        text.setAttribute('fill', showCellDetail ? '#F1F5F9' : LABEL_UNCLAIMED_COLOR);
        text.setAttribute('stroke', '#0A0E14');
        text.setAttribute('stroke-width', '3');
        text.setAttribute('paint-order', 'stroke');
        text.textContent = label;
        svg.appendChild(text);
      }
    }
  }, [territories, showCellDetail, cellsByTerritory]);

  // Cell-level rendering — only when zoomed in enough.
  useEffect(() => {
    const container = containerRef.current;
    const svg = container?.querySelector('svg');
    if (!container || !svg) return;

    svg.querySelectorAll('[data-cell-layer]').forEach((el) => el.remove());
    svg.querySelectorAll('[data-cell-clip]').forEach((el) => el.remove());

    if (!showCellDetail) return;
    console.log('[cell effect] RUNNING at', new Date().toLocaleTimeString());

    for (const [svgPathId, territory] of Object.entries(territories)) {
      try {
        const pathEl = container.querySelector<SVGPathElement>(`#${CSS.escape(svgPathId)}`);
        const cells = cellsByTerritory[territory.id];
        if (!pathEl || !cells || cells.length === 0) continue;

        const box = pathEl.getBBox();
        const clipId = `clip-${svgPathId}`;

        const defs =
          svg.querySelector('defs') ??
          (() => {
            const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svg.insertBefore(d, svg.firstChild);
            return d;
          })();

        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', clipId);
        clipPath.setAttribute('data-cell-clip', svgPathId);
        const clipUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        clipUse.setAttribute('href', `#${svgPathId}`);
        clipPath.appendChild(clipUse);
        defs.appendChild(clipPath);

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-cell-layer', svgPathId);
        group.setAttribute('clip-path', `url(#${clipId})`);

        for (const cell of cells) {
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', String(box.x + cell.col * CELL_SIZE));
          rect.setAttribute('y', String(box.y + cell.row * CELL_SIZE));
          rect.setAttribute('width', String(CELL_SIZE));
          rect.setAttribute('height', String(CELL_SIZE));
          rect.setAttribute('fill', cell.ownerId ? cell.ownerColor : STONE_FILL);
          rect.setAttribute('fill-opacity', cell.ownerId ? '0.7' : '1');
          rect.setAttribute('stroke', '#1a1e26');
          rect.setAttribute('stroke-width', '0.5');
          group.appendChild(rect);
        }

        const firstDecoration = svg.querySelector('[data-decoration]');
        if (firstDecoration) {
          svg.insertBefore(group, firstDecoration);
        } else {
          svg.appendChild(group);
        }
      } catch (err) {
        console.error('[cell effect] ERROR on', svgPathId, err);
      }
    }
  }, [territories, cellsByTerritory, showCellDetail]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as SVGElement).closest('path');
      if (!target?.id) return;
      const territory = territories[target.id];
      if (territory && onTerritoryClick) onTerritoryClick(territory);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as SVGElement).closest('path');
      if (!target?.id) return;
      const territory = territories[target.id];
      if (territory && onTerritoryHover) onTerritoryHover(territory);
    };

    const handleMouseOut = () => {
      if (onTerritoryHover) onTerritoryHover(null);
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('mouseover', handleMouseOver);
    container.addEventListener('mouseout', handleMouseOut);

    return () => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('mouseover', handleMouseOver);
      container.removeEventListener('mouseout', handleMouseOut);
    };
  }, [territories, onTerritoryClick, onTerritoryHover]);

  return (
    <>
      <div className="absolute top-28 left-4 text-xs text-cyan-400 font-mono bg-black/60 p-2 rounded pointer-events-none z-50">
        cell layer groups in DOM: {cellLayerCount}
      </div>
      <div
        ref={containerRef}
        className="[&_svg]:w-full [&_svg]:h-auto [&_path]:transition-all [&_path]:duration-300 [&_path]:cursor-pointer"
        style={{
          background:
            'repeating-linear-gradient(135deg, #0A0E14, #0A0E14 12px, #10161F 12px, #10161F 24px)',
        }}
        dangerouslySetInnerHTML={innerHtml}
      />
    </>
  );
}