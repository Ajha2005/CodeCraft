import { useEffect, useMemo, useRef } from 'react';
import type { TerritoryDto } from '../../types/territory';
import type { TerritoryCellDto } from '../../lib/api';
import { computeStripeWidths, aggregateOwnership } from './utils/computeStripeWidths';


interface CapturePing {
  svgPathId: string;
  nonce: number;
}

interface CampusMapProps {
  svgMarkup: string;
  territories: Record<string, TerritoryDto>;
  cellsByTerritory: Record<string, TerritoryCellDto[]>;
  showCellDetail: boolean;
  hoveredSvgPathId?: string | null;
  capturePing?: CapturePing | null;
  onTerritoryClick?: (territory: TerritoryDto) => void;
  onTerritoryHover?: (territory: TerritoryDto | null) => void;
}

const TIER_STROKE_WIDTH: Record<string, string> = {
  OUTPOST: '1',
  SETTLEMENT: '1.5',
  STRONGHOLD: '2',
  CITADEL: '2.5',
};

const ACCENT = '#22D3EE';
const STONE_FILL = '#2B323D';
const STONE_STROKE = '#4A5568';
const LABEL_UNCLAIMED_COLOR = '#CBD5E1';
const LABEL_CELL_DETAIL_COLOR = '#F1F5F9';
const MIN_LABEL_WIDTH = 45;
const MIN_LABEL_HEIGHT = 24;

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
  hoveredSvgPathId,
  capturePing,
  onTerritoryClick,
  onTerritoryHover,
}: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerHtml = useMemo(() => ({ __html: svgMarkup }), [svgMarkup]);

  // Territory fill (single/multi-owner color, or stone when unclaimed) —
  // this is the one thing that legitimately needs to change when
  // showCellDetail toggles, since cell-detail mode hands fill duty to the
  // per-cell rects below instead.
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

  // Labels, CITADEL reticles and contested-zone rings — built once per
  // territory/ownership change. Deliberately does NOT depend on
  // showCellDetail: rebuilding ~150 DOM nodes on every zoom-threshold
  // crossing is what caused labels and the contested-ring overlay to
  // flicker/vanish while zooming. The color-only response to
  // showCellDetail lives in the separate effect below instead.
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

        @keyframes capture-ping-ring {
          0% { r: 4; stroke-opacity: 1; stroke-width: 4; }
          100% { r: 90; stroke-opacity: 0; stroke-width: 0.5; }
        }
        @keyframes capture-ping-flash {
          0% { opacity: 0.9; }
          100% { opacity: 0; }
        }
        .capture-ping-ring { animation: capture-ping-ring 1.1s cubic-bezier(0.22, 0.61, 0.36, 1) forwards; }
        .capture-ping-flash { animation: capture-ping-flash 0.5s ease-out forwards; }

        .territory-hovered {
          filter: drop-shadow(0 0 6px rgba(34, 211, 238, 0.9)) drop-shadow(0 0 14px rgba(34, 211, 238, 0.5));
        }
      `;
      svg.insertBefore(style, svg.firstChild);
    }

    for (const [svgPathId, territory] of Object.entries(territories)) {
      const pathEl = container.querySelector<SVGPathElement>(`#${CSS.escape(svgPathId)}`);
      if (!pathEl) continue;

      const box = pathEl.getBBox();

      const cells = cellsByTerritory[territory.id] ?? [];
      const shares = aggregateOwnership(cells);
      if (shares.length > 1) {
        const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ring.setAttribute('data-decoration', `${svgPathId}-contested`);
        ring.setAttribute('data-cell-detail-hide', 'true');
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
        counter.setAttribute('data-cell-detail-hide', 'true');
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
          line.setAttribute('stroke', ACCENT);
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
        text.setAttribute('data-label', 'true');
        text.setAttribute('x', String(box.x + box.width / 2));
        text.setAttribute('y', String(box.y + box.height / 2));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'middle');
        text.setAttribute('pointer-events', 'none');
        text.setAttribute('font-family', "'Rajdhani', sans-serif");
        text.setAttribute('font-weight', '600');
        text.setAttribute('font-size', String(fontSize));
        text.setAttribute('fill', LABEL_UNCLAIMED_COLOR);
        text.setAttribute('stroke', '#0A0E14');
        text.setAttribute('stroke-width', '3');
        text.setAttribute('paint-order', 'stroke');
        text.textContent = label;
        svg.appendChild(text);
      }
    }
  }, [territories, cellsByTerritory]);

  // Cheap follow-up for showCellDetail: recolor existing labels and
  // hide/show the contested-ring overlay in place, without touching
  // the DOM structure built above.
  useEffect(() => {
    const container = containerRef.current;
    const svg = container?.querySelector('svg');
    if (!svg) return;

    svg.querySelectorAll<SVGTextElement>('[data-label="true"]').forEach((label) => {
      label.setAttribute('fill', showCellDetail ? LABEL_CELL_DETAIL_COLOR : LABEL_UNCLAIMED_COLOR);
    });
    svg.querySelectorAll<SVGElement>('[data-cell-detail-hide="true"]').forEach((el) => {
      el.style.display = showCellDetail ? 'none' : '';
    });
  }, [showCellDetail]);

  // Hover glow — a cheap class toggle, no DOM rebuild.
  useEffect(() => {
    const container = containerRef.current;
    const svg = container?.querySelector('svg');
    if (!svg) return;

    svg.querySelectorAll('.territory-hovered').forEach((el) => el.classList.remove('territory-hovered'));
    if (!hoveredSvgPathId) return;

    const pathEl = container?.querySelector(`#${CSS.escape(hoveredSvgPathId)}`);
    pathEl?.classList.add('territory-hovered');
  }, [hoveredSvgPathId]);

  // Capture ping — a brief radar-style ripple at the territory that just
  // changed hands, so a live capture reads as an event, not just a color
  // swap. `nonce` changes on every ping even for the same territory, which
  // is what re-triggers the effect for back-to-back captures.
  useEffect(() => {
    const container = containerRef.current;
    const svg = container?.querySelector('svg');
    if (!svg || !capturePing) return;

    const pathEl = container?.querySelector<SVGPathElement>(`#${CSS.escape(capturePing.svgPathId)}`);
    if (!pathEl) return;

    const box = pathEl.getBBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('pointer-events', 'none');

    const flash = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    flash.setAttribute('cx', String(cx));
    flash.setAttribute('cy', String(cy));
    flash.setAttribute('r', '14');
    flash.setAttribute('fill', ACCENT);
    flash.setAttribute('class', 'capture-ping-flash');
    group.appendChild(flash);

    for (const delay of [0, 0.18]) {
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', String(cx));
      ring.setAttribute('cy', String(cy));
      ring.setAttribute('r', '4');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', ACCENT);
      ring.setAttribute('class', 'capture-ping-ring');
      ring.style.animationDelay = `${delay}s`;
      group.appendChild(ring);
    }

    svg.appendChild(group);
    const timeout = setTimeout(() => group.remove(), 1400);
    return () => {
      clearTimeout(timeout);
      group.remove();
    };
  }, [capturePing]);

  // Cell-level rendering — only when zoomed in enough.
  useEffect(() => {
    const container = containerRef.current;
    const svg = container?.querySelector('svg');
    if (!container || !svg) return;

    svg.querySelectorAll('[data-cell-layer]').forEach((el) => el.remove());
    svg.querySelectorAll('[data-cell-clip]').forEach((el) => el.remove());

    if (!showCellDetail) return;

    for (const [svgPathId, territory] of Object.entries(territories)) {
      try {
        const pathEl = container.querySelector<SVGPathElement>(`#${CSS.escape(svgPathId)}`);
        const cells = cellsByTerritory[territory.id];
        if (!pathEl || !cells || cells.length === 0) continue;

        const box = pathEl.getBBox();
        const clipId = `clip-${svgPathId}`;

        // Cell width/height are derived from this territory's own bbox and
        // the max row/col it actually has cells for, rather than a shared
        // pixel constant kept in sync with generate-grid.ts by hand. That
        // constant drifting from whatever --size actually seeded the DB is
        // exactly what caused cells to cluster in the top-left corner of a
        // territory instead of covering its whole shape.
        const maxCol = cells.reduce((max, c) => Math.max(max, c.col), 0);
        const maxRow = cells.reduce((max, c) => Math.max(max, c.row), 0);
        const cellWidth = box.width / (maxCol + 1);
        const cellHeight = box.height / (maxRow + 1);

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
          rect.setAttribute('x', String(box.x + cell.col * cellWidth));
          rect.setAttribute('y', String(box.y + cell.row * cellHeight));
          rect.setAttribute('width', String(cellWidth));
          rect.setAttribute('height', String(cellHeight));
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
    <div
      ref={containerRef}
      className="[&_svg]:w-full [&_svg]:h-auto [&_path]:transition-all [&_path]:duration-300 [&_path]:cursor-pointer"
      style={{
        background:
          'repeating-linear-gradient(135deg, #0A0E14, #0A0E14 12px, #10161F 12px, #10161F 24px)',
      }}
      dangerouslySetInnerHTML={innerHtml}
    />
  );
}
