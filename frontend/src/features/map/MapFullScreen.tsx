import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTerritories } from './hooks/useTerritories';
import { useTerritoryCells } from './hooks/useTerritoryCells';
import { useCollegeLeaderboard } from './hooks/useLeaderboard';
import { useAuth } from '../../auth/AuthContext';
import { usePlayerStats } from '../../lib/playerStatsContext';
import { useToasts } from '../../lib/useToasts';
import { getApiErrorMessage } from '../../lib/apiError';
import { sfx } from '../../lib/sfx';
import { ToastStack } from '../../components/ToastStack';
import { Icon } from '../../components/ui/Icon';
import { createChallenge } from '../contest/api';
import { MapEngine, type HoverInfo } from './world/engine';
import { getWorld, toMeters } from './world/campus';
import { TIER_META } from '../../lib/tiers';
import type { Zone } from './world/geometry';
import type { TerritoryCellDto } from '../../lib/api';
import { LeaderboardPanel } from './LeaderboardPanel';
import { LocationChip, ZoneSplash, type Splash } from './hud/LocationBanner';
import { Minimap } from './hud/Minimap';
import { ControlsDock } from './hud/ControlsDock';
import { QuickTravel } from './hud/QuickTravel';
import { LiveFeed, type FeedItem } from './hud/LiveFeed';
import { TravelBarLive, WaypointChip, ZonePanelLive } from './hud/LiveHud';
import { FirstRunHint, InspectHint } from './hud/ActionHints';
import { HelpOverlay } from './hud/HelpOverlay';
import { Joystick } from './hud/Joystick';
import { HoverTooltip } from './hud/HoverTooltip';
import { ChallengeModal } from './hud/ChallengeModal';
import { STATUS_LABEL, summarizeZone, type ZoneSummary } from './hud/zoneSummary';
import { useEngineSelector } from './hud/useEngineStats';

const FEED_TTL_MS = 6000;
const FEED_MAX = 2;
const SPLASH_MS = 2200;

const posKey = (uid: string) => `cc.map.pos.v1:${uid}`;
const exploredKey = (uid: string) => `cc.map.explored.v1:${uid}`;
const WELCOME_KEY = 'cc.map.welcomed.v1';
const INTRO_KEY = 'cc.map.intro.v1';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // progress is a convenience; losing it must never break the map
  }
}

function isTypingTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export function MapFullScreen() {
  const { territories, loading: territoriesLoading, error: territoriesError, retry: retryTerritories } = useTerritories();
  const { cellsByTerritory, loading: cellsLoading, error: cellsError, retry: retryCells } = useTerritoryCells();
  // Names for the live feed come from one snapshot; it only goes live (and
  // refetches on score changes) while the ranks panel is actually open.
  const [showBoard, setShowBoard] = useState(false);
  const { entries: boardEntries, loading: boardLoading } = useCollegeLeaderboard(50, showBoard);
  const { user, flavorTextEnabled } = useAuth();
  const { refresh: refreshStats } = usePlayerStats();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toasts, push, dismiss } = useToasts();

  const userId = user?.userId ?? null;
  const world = getWorld();
  const [engine] = useState(() => new MapEngine(world));
  const traveling = useEngineSelector(engine, (s) => s.traveling);
  const explored = useEngineSelector(engine, (s) => s.explored);
  // The corner widgets step back while you are on the move (see .hud-fade).
  const moving = useEngineSelector(engine, (s) => s.speed > 12);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextId = useRef(1);

  const [isTouch] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentZoneId, setCurrentZoneId] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [challenge, setChallenge] = useState<{ cell: TerritoryCellDto; zone: Zone } | null>(null);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [travelSnapshot, setTravelSnapshot] = useState<{ x: number; y: number; explored: Set<string> } | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [travelTarget, setTravelTarget] = useState<string | null>(null);
  const [splash, setSplash] = useState<Splash | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [welcome, setWelcome] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) === null;
    } catch {
      return false;
    }
  });

  const ready = !territoriesLoading && !cellsLoading && !territoriesError && !cellsError;
  const loadError = territoriesError ?? cellsError;

  // ---- derived per-zone summaries (names, tiers, ownership) --------------
  const summaries = useMemo(() => {
    const map = new Map<string, ZoneSummary>();
    for (const z of world.campus.zones) {
      const t = territories[z.id];
      map.set(z.id, summarizeZone(z.id, t, t ? (cellsByTerritory[t.id] ?? []) : [], userId));
    }
    return map;
  }, [world, territories, cellsByTerritory, userId]);

  const summaryList = useMemo(() => [...summaries.values()], [summaries]);

  const selected = selectedId ? (summaries.get(selectedId) ?? null) : null;
  const current = currentZoneId ? (summaries.get(currentZoneId) ?? null) : null;
  const hoverSummary = hover ? (summaries.get(hover.zoneId) ?? null) : null;

  const nameFor = useCallback((ownerId: string | null) => boardEntries.find((e) => e.userId === ownerId)?.name ?? null, [boardEntries]);

  const pushFeed = useCallback((item: Omit<FeedItem, 'id'>) => {
    const id = nextId.current++;
    setFeed((prev) => [{ ...item, id }, ...prev].slice(0, FEED_MAX));
    window.setTimeout(() => setFeed((prev) => prev.filter((f) => f.id !== id)), FEED_TTL_MS);
  }, []);

  const dismissWelcome = useCallback(() => {
    setWelcome(false);
    try {
      localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // ignore
    }
  }, []);

  // ---- engine lifecycle ---------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    engine.attach(canvas, host);
    return () => {
      if (userId) {
        writeJson(posKey(userId), engine.getPlayerPos());
        writeJson(exploredKey(userId), engine.getExplored());
      }
      engine.detach();
    };
  }, [engine, userId]);

  // Events from the engine. Wrapped in an Effect Event so they always see the
  // latest summaries / flags without re-subscribing the engine.
  // Walking into a zone just updates the location pill - a full-screen title on
  // every border you cross gets tiring fast. Only a first discovery earns one.
  const handleZoneChange = useEffectEvent((zone: Zone | null, traveling: boolean) => {
    setCurrentZoneId(zone?.id ?? null);
    if (zone && !traveling) sfx.play('zone');
  });

  const handleDiscover = useEffectEvent((zone: Zone, found: number, total: number) => {
    const summary = summaries.get(zone.id);
    if (!summary) return;
    sfx.play('discover');
    setSplash({ key: nextId.current++, summary, progress: { found, total } });
    if (userId) writeJson(exploredKey(userId), engine.getExplored());
  });

  const handleCapture = useEffectEvent((e: { zone: Zone; cell: TerritoryCellDto; byMe: boolean }) => {
    const summary = summaries.get(e.zone.id);
    // The feed only carries news that concerns you: your own captures, and
    // rivals moving on a zone you hold ground in or are standing in. Everything
    // else still flashes on the map, it just does not ask for your attention.
    if (!e.byMe && (summary?.mine ?? 0) === 0 && e.zone.id !== currentZoneId) return;
    const name = summary?.name ?? e.zone.id;
    const who = e.byMe ? 'You' : (e.cell.ownerUsername ?? nameFor(e.cell.ownerId) ?? 'A rival');
    sfx.play('capture');
    pushFeed({
      kind: e.byMe ? 'mine' : 'capture',
      color: e.cell.ownerColor,
      text: flavorTextEnabled ? (e.byMe ? `Flag planted in ${name}!` : `${who} took ground in ${name}.`) : `${who} captured a cell in ${name}.`,
    });
    if (e.byMe) void refreshStats();
  });

  const handleTravel = useEffectEvent((event: 'start' | 'arrive' | 'cancel', zone: Zone | null) => {
    if (event === 'start') {
      setTravelTarget(zone ? (summaries.get(zone.id)?.name ?? null) : null);
      setSelectedId(null);
      sfx.play('travel');
    } else if (event === 'arrive') {
      setTravelTarget(null);
      sfx.play('arrive');
      // Walking up to a zone should end with its details in front of you.
      if (zone) engine.selectZone(zone.id);
    } else {
      setTravelTarget(null);
    }
  });

  const handleHover = useEffectEvent((info: HoverInfo | null) => setHover(info));
  const handleSelect = useEffectEvent((id: string | null) => {
    setSelectedId(id);
    if (id) sfx.play('click');
  });
  const handleCellChallenge = useEffectEvent((cell: TerritoryCellDto, zone: Zone) => setChallenge({ cell, zone }));
  const handleMoved = useEffectEvent((pos: { x: number; y: number }) => {
    if (userId) writeJson(posKey(userId), pos);
    if (welcome) dismissWelcome();
  });
  const handleInteract = useEffectEvent(() => {
    if (!currentZoneId) return;
    engine.selectZone(selectedId === currentZoneId ? null : currentZoneId);
  });

  useEffect(() => {
    engine.setHandlers({
      onZoneChange: (z, _prev, traveling) => handleZoneChange(z, traveling),
      onDiscover: (z, f, t) => handleDiscover(z, f, t),
      onCapture: (e) => handleCapture(e),
      onTravel: (ev, z) => handleTravel(ev, z),
      onHover: (info) => handleHover(info),
      onSelect: (id) => handleSelect(id),
      onCellChallenge: (c, z) => handleCellChallenge(c, z),
      onPlayerMoved: (p) => handleMoved(p),
      onInteract: () => handleInteract(),
    });
  }, [engine]);

  // Feed the engine its player + world data once everything has loaded.
  useEffect(() => {
    if (!ready) return;
    let seenIntro = false;
    try {
      seenIntro = sessionStorage.getItem(INTRO_KEY) !== null;
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      // private mode etc.: just play the flyover
    }
    engine.setUser({
      userId,
      startPos: userId ? readJson<{ x: number; y: number }>(posKey(userId)) : null,
      explored: userId ? (readJson<string[]>(exploredKey(userId)) ?? []) : null,
      skipIntro: seenIntro,
    });
  }, [engine, ready, userId]);

  useEffect(() => {
    if (ready) engine.setData(territories, cellsByTerritory);
  }, [engine, ready, territories, cellsByTerritory]);

  // Pause walking while a dialog owns the keyboard.
  useEffect(() => {
    engine.setInputEnabled(!challenge && !showHelp);
  }, [engine, challenge, showHelp]);

  useEffect(() => {
    engine.setWaypoint(pinnedId);
  }, [engine, pinnedId]);

  // Deep link: /map?territory=<id> (used by the dashboard's "Show on map")
  // walks the commander to that zone once the world has loaded.
  const deepLink = searchParams.get('territory');
  useEffect(() => {
    if (!ready || !deepLink) return;
    const target = Object.values(territories).find((t) => t.id === deepLink);
    if (!target) return;
    const timer = window.setTimeout(() => {
      engine.travelToZone(target.svgPathId, { boost: true });
      setSearchParams({}, { replace: true });
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [engine, ready, deepLink, territories, setSearchParams]);

  useEffect(() => {
    if (!splash) return;
    const t = window.setTimeout(() => setSplash(null), SPLASH_MS);
    return () => window.clearTimeout(t);
  }, [splash]);

  useEffect(() => {
    if (!welcome) return;
    const t = window.setTimeout(() => setWelcome(false), 16000);
    return () => window.clearTimeout(t);
  }, [welcome]);

  // ---- actions ------------------------------------------------------------
  const openTravel = useCallback(() => {
    setTravelSnapshot((prev) => (prev ? null : { ...engine.getPlayerPos(), explored: new Set(engine.getExplored()) }));
    setShowBoard(false);
  }, [engine]);

  const distances = useMemo(() => {
    const out: Record<string, number> = {};
    if (!travelSnapshot) return out;
    for (const z of world.campus.zones) out[z.id] = toMeters(Math.hypot(z.anchor.x - travelSnapshot.x, z.anchor.y - travelSnapshot.y));
    return out;
  }, [travelSnapshot, world]);

  const travelToZone = useCallback(
    (id: string, boost = false) => {
      engine.travelToZone(id, { boost });
      setTravelSnapshot(null);
    },
    [engine],
  );

  const handleKey = useEffectEvent((e: KeyboardEvent) => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'l':
      case 'L':
        setShowBoard((v) => !v);
        setTravelSnapshot(null);
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        openTravel();
        break;
      case '?':
      case 'h':
      case 'H':
        setShowHelp((v) => !v);
        break;
      case 't':
      case 'T':
        if (selectedId) travelToZone(selectedId);
        break;
      case 'Escape':
        if (showHelp) setShowHelp(false);
        else if (travelSnapshot) setTravelSnapshot(null);
        else if (selectedId) engine.selectZone(null);
        else if (showBoard) setShowBoard(false);
        break;
      default:
    }
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKey(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function confirmChallenge(durationSeconds: number) {
    if (!challenge) return;
    setChallengeBusy(true);
    try {
      const contest = await createChallenge(challenge.cell.id, { durationSeconds });
      setChallenge(null);
      navigate(`/contest/${contest.id}`);
    } catch (err: unknown) {
      sfx.play('error');
      push(getApiErrorMessage(err, 'Could not send challenge'), 'warning');
    } finally {
      setChallengeBusy(false);
    }
  }

  const waypointSummary = pinnedId ? summaries.get(pinnedId) : null;
  const challengeSummary = challenge ? summaries.get(challenge.zone.id) : null;
  const hoverNote =
    hover?.cell && hoverSummary
      ? hover.challengeable
        ? `${hover.cell.ownerUsername ? `Held by ${hover.cell.ownerUsername}` : 'Rival cell'} · click to challenge`
        : hover.cell.ownerId
          ? 'Your cell'
          : 'Unclaimed cell'
      : null;
  const showZonePanel = !!selected && !traveling;
  const loadingLabel = flavorTextEnabled ? 'Surveying the campus…' : 'Loading map…';

  return (
    <div
      ref={hostRef}
      data-moving={moving ? 'true' : undefined}
      className="relative w-full overflow-hidden bg-[#03060b]"
      style={{ height: 'calc(100dvh - var(--nav-h) - var(--tabbar-h))' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block touch-none select-none outline-none"
        role="application"
        aria-label="Interactive campus map. Move with W A S D or the arrow keys, click a zone to inspect it."
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 52%, rgba(2,6,12,0.62) 100%)' }}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {current ? `You are at ${current.name}, ${TIER_META[current.tier].label}. ${STATUS_LABEL[current.status]}.` : 'You are on open ground.'}
      </p>

      {ready && (
        <>
          {/* top-center: where you are - one small pill */}
          <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center max-sm:justify-start max-sm:pl-3">
            <div className="pointer-events-auto">
              <LocationChip summary={current} />
            </div>
          </div>
          <ZoneSplash splash={splash} />

          {/* top-left: news that concerns you, briefly */}
          <div className="absolute left-3 top-3 z-10 max-sm:top-12">
            <LiveFeed items={feed} />
          </div>

          {/* top-right: three quiet buttons */}
          <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2 max-sm:top-[6.4rem]">
            <div className="hud-fade">
              <div className="hud-panel hud-panel-quiet flex items-center gap-0.5 p-1 animate-slide-in-right">
                <button
                  type="button"
                  onClick={() => {
                    setShowBoard((v) => !v);
                    setTravelSnapshot(null);
                  }}
                  aria-pressed={showBoard}
                  title="Ranks (L)"
                  className={`btn-ghost h-8 gap-1.5 rounded-lg !border-transparent px-2.5 text-xs font-bold uppercase tracking-wide ${showBoard ? '!border-amber-400/60 !text-amber-200' : ''}`}
                >
                  <Icon name="trophy" className="h-4 w-4" />
                  <span className="hidden sm:inline">Ranks</span>
                </button>
                <button
                  type="button"
                  onClick={openTravel}
                  aria-pressed={!!travelSnapshot}
                  title="Fast travel (F)"
                  className={`btn-ghost h-8 gap-1.5 rounded-lg !border-transparent px-2.5 text-xs font-bold uppercase tracking-wide ${travelSnapshot ? '!border-cyan-400/60 !text-cyan-200' : ''}`}
                >
                  <Icon name="compass" className="h-4 w-4" />
                  <span className="hidden sm:inline">Travel</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowHelp(true)}
                  aria-label="Controls help"
                  title="Controls (?)"
                  className="btn-ghost h-8 w-8 rounded-lg !border-transparent max-sm:hidden"
                >
                  <Icon name="help" className="h-4 w-4" />
                </button>
              </div>
            </div>
            {showBoard && <LeaderboardPanel entries={boardEntries} loading={boardLoading} onClose={() => setShowBoard(false)} />}
          </div>

          {/* minimap: bottom-left on desktop, top-right on phones */}
          <div className="hud-fade absolute bottom-3 left-3 z-10 max-sm:bottom-auto max-sm:left-auto max-sm:right-3 max-sm:top-3">
            <Minimap engine={engine} />
          </div>

          {/* bottom-center: the contextual stack - only what you are doing right now */}
          <div className={`pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-2 px-2 max-sm:bottom-2 ${isTouch && !selected ? 'max-sm:bottom-[8.75rem]' : ''}`}>
            {welcome && !selected && (
              <div className="pointer-events-auto max-sm:self-start">
                <FirstRunHint onDismiss={dismissWelcome} touch={isTouch} />
              </div>
            )}
            {showZonePanel && selected && (
              <div className="pointer-events-auto">
                <ZonePanelLive
                  engine={engine}
                  world={world}
                  summary={selected}
                  territory={territories[selected.id] ?? null}
                  here={currentZoneId === selected.id}
                  pinned={pinnedId === selected.id}
                  onTravel={() => travelToZone(selected.id)}
                  onDive={() => engine.focusZone(selected.id)}
                  onPin={() => setPinnedId((p) => (p === selected.id ? null : selected.id))}
                  onClose={() => engine.selectZone(null)}
                />
              </div>
            )}
            {traveling && (
              <div className="pointer-events-auto">
                <TravelBarLive engine={engine} target={travelTarget} />
              </div>
            )}
            {pinnedId && waypointSummary && !traveling && !showZonePanel && (
              <WaypointChip engine={engine} name={waypointSummary.name} onGo={() => travelToZone(pinnedId)} onClear={() => setPinnedId(null)} />
            )}
            {!isTouch && !!currentZoneId && !showZonePanel && !traveling && !welcome && <InspectHint />}
          </div>

          {/* bottom-right: camera controls */}
          <div className={`hud-fade absolute bottom-3 right-3 z-10 max-sm:bottom-2 max-sm:right-2 ${showZonePanel ? 'max-sm:hidden' : ''}`}>
            <ControlsDock engine={engine} />
          </div>

          {isTouch && !selected && !traveling && (
            <div className="absolute bottom-4 left-4 z-10">
              <Joystick engine={engine} />
            </div>
          )}

          {travelSnapshot && (
            <div className="absolute inset-y-3 left-3 z-20">
              <QuickTravel
                zones={summaryList}
                distances={distances}
                explored={travelSnapshot.explored}
                exploredCount={explored}
                pinnedId={pinnedId}
                onTravel={(id) => travelToZone(id, true)}
                onHover={(id) => engine.setHighlight(id)}
                onPin={(id) => setPinnedId((p) => (p === id ? null : id))}
                onClose={() => {
                  engine.setHighlight(null);
                  setTravelSnapshot(null);
                }}
              />
            </div>
          )}

          {hover && hoverSummary && !isTouch && <HoverTooltip key={hover.zoneId} summary={hoverSummary} x={hover.clientX} y={hover.clientY} cellNote={hoverNote} />}
        </>
      )}

      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

      {challenge && challengeSummary && (
        <ChallengeModal
          zoneName={challengeSummary.name}
          tier={challengeSummary.tier}
          cellLabel={`Cell R${challenge.cell.row + 1} · C${challenge.cell.col + 1}`}
          busy={challengeBusy}
          onConfirm={confirmChallenge}
          onCancel={() => setChallenge(null)}
        />
      )}

      {/* loading + error cover */}
      {!ready && (
        <div className="hud-grid-bg absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 text-slate-300">
          {loadError ? (
            <>
              <Icon name="skull" className="h-10 w-10 text-rose-400" />
              <p className="max-w-sm text-center text-sm text-rose-300">Couldn’t load the campus: {loadError}</p>
              <button
                type="button"
                className="btn-primary h-10 rounded-lg px-6 text-sm"
                onClick={() => {
                  retryTerritories();
                  retryCells();
                }}
              >
                Try again
              </button>
            </>
          ) : (
            <>
              <div className="relative h-16 w-16">
                <div className="hex absolute inset-0 bg-gradient-to-b from-cyan-400/80 to-teal-600/30 animate-spin-slow" />
                <div className="hex absolute inset-[3px] bg-slate-950" />
                <Icon name="compass" className="absolute inset-0 m-auto h-6 w-6 text-cyan-300 animate-pulse" />
              </div>
              <p className="font-display text-lg font-bold uppercase tracking-[0.3em] text-cyan-300">{loadingLabel}</p>
            </>
          )}
        </div>
      )}

      <ToastStack toasts={toasts} dismiss={dismiss} placement="top-center" />
    </div>
  );
}
