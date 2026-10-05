import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';
import { fetchPublicProfile, type PublicProfile } from '../../lib/api';
import { levelFromScore } from '../../lib/progression';
import { AnimatedNumber } from '../../components/ui/AnimatedNumber';
import { Icon, type IconName } from '../../components/ui/Icon';
import { LevelBadge } from '../../components/ui/LevelBadge';
import { PlayerAvatar } from '../../components/ui/PlayerAvatar';

/** The outcome of one lookup. `profile: null` means nobody has that username. */
type Lookup = { key: string; profile: PublicProfile | null; error: boolean };

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">{children}</div>
    </div>
  );
}

function Stat({ label, accent, delay, children }: { label: string; accent: string; delay: number; children: ReactNode }) {
  return (
    <div className="hud-panel relative overflow-hidden p-4 animate-fade-in-up" style={{ animationDelay: `${delay}ms` }}>
      <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <p className="hud-label !text-[0.64rem]">{label}</p>
      <div className="mt-1.5 font-mono text-3xl font-bold tabular-nums text-slate-50">{children}</div>
    </div>
  );
}

function Notice({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="hud-panel hud-panel-quiet p-8 text-center animate-fade-in-up" role="status">
      <Icon name={icon} className="mx-auto h-10 w-10 text-slate-600" />
      <h1 className="font-display mt-3 text-2xl font-bold tracking-wide text-slate-50">{title}</h1>
      {children}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading profile…</span>
      <div className="hud-panel mb-4 flex animate-pulse items-center gap-5 p-5 md:p-7">
        <div className="h-[88px] w-[88px] shrink-0 rounded-full bg-slate-800" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="h-3 w-28 rounded bg-slate-800" />
          <div className="h-9 w-56 max-w-full rounded bg-slate-800" />
          <div className="h-3 w-36 rounded bg-slate-800" />
        </div>
      </div>
      <div className="grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="hud-panel h-[5.25rem]" />
        ))}
      </div>
    </div>
  );
}

/** A longer username gets a smaller heading, so the whole name always shows. */
function nameSize(username: string): string {
  if (username.length > 14) return 'text-2xl sm:text-4xl';
  if (username.length > 10) return 'text-3xl sm:text-5xl';
  return 'text-4xl sm:text-5xl';
}

function ProfileView({ profile, flavor }: { profile: PublicProfile; flavor: boolean }) {
  const { isMe, color } = profile;
  const level = levelFromScore(profile.totalScore);
  const joined = new Date(profile.joinedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <>
      <header className="hud-panel relative mb-4 overflow-hidden p-5 md:p-7 animate-fade-in-up">
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full blur-3xl" style={{ background: `${color}22` }} />
        <div className="relative grid items-center gap-5 text-center sm:grid-cols-[auto_1fr_auto] sm:text-left">
          <PlayerAvatar color={color} name={profile.username} size={88} className="mx-auto sm:mx-0" />
          <div className="min-w-0">
            <p className="hud-label text-cyan-300">{flavor ? 'Commander profile' : 'Player profile'}</p>
            <h1 className="font-display mt-1 flex min-w-0 items-center justify-center gap-3 sm:justify-start">
              <span className={`min-w-0 break-all font-bold leading-tight tracking-wide text-slate-50 ${nameSize(profile.username)}`}>{profile.username}</span>
              {isMe && (
                <span className="hud-label shrink-0 rounded-full border border-cyan-400/50 bg-cyan-400/10 px-2 py-0.5 !text-[0.62rem] !text-cyan-200">You</span>
              )}
            </h1>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-slate-400 sm:justify-start">
              <Icon name="clock" className="h-3.5 w-3.5" />
              Joined {joined}
            </p>
          </div>
          <LevelBadge level={level.level} size={72} className="mx-auto sm:mx-0" />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Score" accent="#34d399" delay={80}>
          <span className="text-emerald-300">
            <AnimatedNumber value={profile.totalScore} decimals={1} />
          </span>
        </Stat>
        <Stat label="Solved" accent="#a78bfa" delay={130}>
          <AnimatedNumber value={profile.problemsSolved} />
        </Stat>
        <Stat label="Cells held" accent="#22d3ee" delay={180}>
          <AnimatedNumber value={profile.cellsHeld} />
        </Stat>
        <Stat label="Zones held" accent="#fbbf24" delay={230}>
          <AnimatedNumber value={profile.territoriesHeld} />
        </Stat>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3 sm:justify-start">
        {isMe && (
          <Link to="/scoring" className="btn-ghost h-10 rounded-lg px-4 text-sm font-semibold">
            Your campaign report
          </Link>
        )}
        <Link to="/map" className="btn-ghost h-10 rounded-lg px-4 text-sm font-semibold">
          Back to the map
        </Link>
      </div>
    </>
  );
}

export default function ProfilePage() {
  const { username = '' } = useParams();
  const { flavorTextEnabled } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<Lookup | null>(null);

  // One lookup per username (and per retry). A result that belongs to an
  // earlier lookup is ignored, so switching profiles shows the loading state
  // instead of the previous player.
  const key = `${username}#${attempt}`;
  useEffect(() => {
    let cancelled = false;
    fetchPublicProfile(username)
      .then((profile) => {
        if (!cancelled) setLookup({ key, profile, error: false });
      })
      .catch(() => {
        if (!cancelled) setLookup({ key, profile: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [username, key]);

  const current = lookup && lookup.key === key ? lookup : null;

  if (!current) {
    return (
      <Shell>
        <ProfileSkeleton />
      </Shell>
    );
  }

  if (current.error) {
    return (
      <Shell>
        <Notice icon="bolt" title="Couldn’t load this profile">
          <p className="mt-2 text-sm text-slate-400">Something went wrong reaching the server.</p>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-primary mt-5 h-10 rounded-lg px-5 text-sm">
            <Icon name="rotate" className="h-4 w-4" />
            Try again
          </button>
        </Notice>
      </Shell>
    );
  }

  if (!current.profile) {
    return (
      <Shell>
        <Notice icon="user" title={flavorTextEnabled ? 'No commander by that name' : 'Player not found'}>
          <p className="mt-2 text-sm text-slate-400">
            Nobody goes by <span className="break-all font-semibold text-slate-200">{username}</span>. Check the spelling, or look for them in the Ranks on the map.
          </p>
          <Link to="/map" className="btn-primary mt-5 inline-flex h-10 rounded-lg px-5 text-sm">
            Back to the map
          </Link>
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell>
      <ProfileView profile={current.profile} flavor={flavorTextEnabled} />
    </Shell>
  );
}
