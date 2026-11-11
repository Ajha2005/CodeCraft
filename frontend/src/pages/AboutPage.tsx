import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/ui/Icon';
import { sfx } from '../lib/sfx';

// About CodeCraft. Everything on this page is a statement about the product
// that is true of the code in this repository today; numbers are only the ones
// the app itself defines (score weights, the daily cap, the tiers).

const REPO_URL = 'https://github.com/Ajha2005/CodeCraft';
const DOCS_URL = 'https://ajha2005.github.io/CodeCraft/';

const MAKERS: { name: string; initials: string; color: string; link?: { label: string; href: string } }[] = [
  { name: 'Udhlu', initials: 'U', color: '#22d3ee' },
  { name: 'Ajha', initials: 'A', color: '#a78bfa', link: { label: 'github.com/Ajha2005', href: 'https://github.com/Ajha2005' } },
];

const DOES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'code', title: 'Practise', body: 'A problem bank with an in-browser editor (Python and C++). Your code runs against hidden test cases in a sandbox and you get a verdict in seconds.' },
  { icon: 'route', title: 'Follow a path', body: 'The Warpath is a DSA sheet in a fixed order: arrays, then recursion, trees and graphs. There is also an optional Daily Quest.' },
  { icon: 'map', title: 'Claim ground', body: 'Every solve earns a score. Score earns cells on a map of the Thapar campus, painted in a colour that belongs only to you.' },
  { icon: 'swords', title: 'Duel', body: 'Want a rival’s cell? Challenge them to a timed 1v1. Both sides stake a cell. The faster correct solution takes it.' },
];

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Solve', body: 'Submit a correct solution. Fewer retries and a faster solve score a little higher.' },
  { n: '2', title: 'Score', body: 'Easy, Medium and Hard problems are worth 10, 25 and 50 base points.' },
  { n: '3', title: 'Claim', body: 'Your score decides the tier of the cell you win: Outpost, Settlement, Stronghold or Citadel.' },
  { n: '4', title: 'Defend', body: 'Cells never decay. They only change hands when someone accepts a duel.' },
];

const VALUES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'book', title: 'Learning comes first', body: 'The map is there to keep you coming back. The goal is that you get better at DSA.' },
  { icon: 'shield', title: 'Fair by design', body: 'There is no random loss. A cell moves only through a duel both players agreed to, and every duel is timed on the server.' },
  { icon: 'flag', title: 'One campus, one cohort', body: 'Sign-in is limited to @thapar.edu accounts, so the leaderboard is a real comparison between classmates.' },
  { icon: 'eye', title: 'Honest about progress', body: 'We would rather tell you what is not done yet than promise it. See the status below.' },
];

const WORKS = [
  'Sign-in with a @thapar.edu account (email or Google), plus a no-account demo',
  '100 practice problems, a code editor, and sandboxed judging',
  'Scoring, levels, streaks, achievements and a live leaderboard',
  'A navigable campus map with cells, zones and real-time updates',
  'Real-time 1v1 duels with server-side timers',
  'The Warpath sheet and the Daily Quest',
];

const NEXT = [
  'A fuller anti-cheating system. Today the editor blocks pasting; the review and flagging pipeline is designed but not built yet.',
  'More problems, and more of them on trees and graphs.',
  'Better ways for new users to find the right next problem.',
];

export default function AboutPage() {
  return (
    <div className="hud-grid-bg min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 text-left md:px-8 md:py-10">
        {/* ------------------------------------------------------------ hero */}
        <header className="hud-panel mb-6 overflow-hidden p-6 md:p-9 animate-fade-in-up">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
          <p className="hud-label text-cyan-300">About</p>
          <h1 className="font-display mt-1 text-5xl font-bold leading-none tracking-wide sm:text-6xl">
            <span className="text-slate-50">Code</span>
            <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">Craft</span>
          </h1>
          <p className="font-display mt-3 text-xl font-semibold uppercase tracking-[0.2em] text-slate-300 sm:text-2xl">Practise DSA. Claim your territory.</p>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300">
            CodeCraft is a practice platform for data structures and algorithms, built for the students of Thapar Institute of Engineering &amp; Technology. Every problem you solve earns
            ground on a map of the campus that you can see, defend and fight for.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link to="/sheet" onClick={() => sfx.play('click')} className="btn-primary h-11 rounded-lg px-5 text-sm">
              <Icon name="route" className="h-4 w-4" />
              Start the Warpath
            </Link>
            <Link to="/map" onClick={() => sfx.play('click')} className="btn-ghost h-11 rounded-lg px-5 text-sm font-semibold">
              <Icon name="map" className="h-4 w-4" />
              See the map
            </Link>
          </div>
        </header>

        {/* ------------------------------------------------------ the why */}
        <section className="mb-6 grid gap-4 md:grid-cols-5">
          <div className="hud-panel hud-panel-quiet p-5 md:col-span-3 animate-fade-in-up">
            <p className="hud-label text-cyan-300">Why it exists</p>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-slate-300">
              Many students practise DSA in short bursts before placements and then stop. We wanted something that makes consistency visible: a place where today’s solve is still
              on the board tomorrow, and where a friend can take it back.
            </p>
          </div>
          <div className="hud-panel hud-panel-quiet p-5 md:col-span-2 animate-fade-in-up">
            <p className="hud-label text-amber-300">Our mission</p>
            <p className="font-display mt-2 text-xl font-bold leading-snug tracking-wide text-slate-50">Help beginners learn DSA, and keep practising, by making it fun to come back.</p>
          </div>
        </section>

        {/* ------------------------------------------------------ what it does */}
        <section className="mb-6">
          <h2 className="font-display mb-3 text-lg font-bold uppercase tracking-[0.16em] text-slate-100">What you can do here</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {DOES.map((d, i) => (
              <div key={d.title} className="hud-panel hud-panel-quiet flex gap-3.5 p-4 animate-fade-in-up" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/40 bg-cyan-400/10 text-cyan-300">
                  <Icon name={d.icon} className="h-5 w-5" />
                </span>
                <span>
                  <span className="font-display block text-lg font-bold uppercase tracking-wide text-slate-50">{d.title}</span>
                  <span className="mt-0.5 block text-[0.85rem] leading-relaxed text-slate-400">{d.body}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ how it works */}
        <section className="mb-6">
          <h2 className="font-display mb-3 text-lg font-bold uppercase tracking-[0.16em] text-slate-100">From a solve to a cell</h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="hud-panel hud-panel-quiet p-4 animate-fade-in-up">
                <span className="font-display flex h-8 w-8 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/10 text-base font-bold text-amber-300">{s.n}</span>
                <p className="font-display mt-2.5 text-lg font-bold uppercase tracking-wide text-slate-50">{s.title}</p>
                <p className="mt-0.5 text-[0.82rem] leading-relaxed text-slate-400">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 text-xs text-slate-500">To keep land-grabbing fair, up to 6 solves a day count towards score and territory. You can keep practising after that; it just will not add to the map.</p>
        </section>

        {/* ------------------------------------------------------ values */}
        <section className="mb-6">
          <h2 className="font-display mb-3 text-lg font-bold uppercase tracking-[0.16em] text-slate-100">What we stand for</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {VALUES.map((v) => (
              <div key={v.title} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <Icon name={v.icon} className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" />
                <span>
                  <span className="block text-sm font-bold text-slate-100">{v.title}</span>
                  <span className="mt-0.5 block text-[0.82rem] leading-relaxed text-slate-400">{v.body}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ status */}
        <section className="mb-6 grid gap-4 md:grid-cols-2">
          <div className="hud-panel hud-panel-quiet p-5">
            <p className="hud-label flex items-center gap-1.5 text-emerald-300">
              <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />
              Working today
            </p>
            <ul className="mt-2.5 grid gap-1.5">
              {WORKS.map((w) => (
                <li key={w} className="flex gap-2 text-[0.85rem] leading-snug text-slate-300">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  {w}
                </li>
              ))}
            </ul>
          </div>
          <div className="hud-panel hud-panel-quiet p-5">
            <p className="hud-label flex items-center gap-1.5 text-amber-300">
              <Icon name="rocket" className="h-3.5 w-3.5" />
              Still to come
            </p>
            <ul className="mt-2.5 grid gap-1.5">
              {NEXT.map((w) => (
                <li key={w} className="flex gap-2 text-[0.85rem] leading-snug text-slate-300">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  {w}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">CodeCraft is young. We will share real numbers, like players and problems solved, once there are some worth sharing.</p>
          </div>
        </section>

        {/* ------------------------------------------------------ makers */}
        <section className="mb-6">
          <h2 className="font-display mb-3 text-lg font-bold uppercase tracking-[0.16em] text-slate-100">Built by</h2>
          <div className="hud-panel hud-panel-quiet p-5">
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              {MAKERS.map((m) => (
                <div key={m.name} className="flex items-center gap-3.5">
                  <div className="relative h-14 w-14 shrink-0" style={{ filter: `drop-shadow(0 0 10px ${m.color}77)` }}>
                    <div className="hex absolute inset-0" style={{ background: `linear-gradient(160deg, ${m.color}, ${m.color}55)` }} />
                    <div className="hex absolute inset-[2px] flex items-center justify-center bg-slate-950">
                      <span className="font-display text-2xl font-bold" style={{ color: m.color }}>
                        {m.initials}
                      </span>
                    </div>
                  </div>
                  <div className="leading-tight">
                    <p className="font-display text-2xl font-bold tracking-wide text-slate-50">{m.name}</p>
                    {m.link && (
                      <a href={m.link.href} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1.5 text-[0.82rem] font-semibold text-cyan-300 hover:underline">
                        <Icon name="github" className="h-3.5 w-3.5" />
                        {m.link.label}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[0.85rem] leading-relaxed text-slate-400">
              Two students who wanted DSA practice to feel less like a chore, building it for the people they study with.
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="btn-ghost h-10 rounded-lg px-4 text-xs font-bold uppercase tracking-wide">
                <Icon name="github" className="h-4 w-4" />
                Source code
              </a>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="btn-ghost h-10 rounded-lg px-4 text-xs font-bold uppercase tracking-wide">
                <Icon name="book" className="h-4 w-4" />
                Design docs
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
