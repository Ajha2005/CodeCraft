import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { sfx } from '../lib/sfx';

// About CodeCraft. Everything on this page is a statement about the product
// that is true of the code in this repository today; numbers are only the ones
// the app itself defines (score weights, the daily cap, the tiers).
//
// It is laid out as a page you read top to bottom, in one column with a steady
// left edge: statements, a numbered path, plain lists. No tiles.

const MAKERS = [
  { name: 'Abhavya', color: '#a78bfa' },
  { name: 'Dev', color: '#2dd4bf' },
  { name: 'Udhalak', color: '#22d3ee' },
];

const DOES: { title: string; body: string }[] = [
  { title: 'Practise', body: 'A problem bank with an in-browser editor (Python and C++). Your code runs against hidden test cases in a sandbox and you get a verdict in seconds.' },
  { title: 'Follow a path', body: 'The Warpath is a DSA sheet in a fixed order: arrays, then recursion, trees and graphs. There is also an optional Daily Quest.' },
  { title: 'Claim ground', body: 'Every solve earns a score. Score earns cells on a map of the Thapar campus, painted in a colour that belongs only to you.' },
  { title: 'Duel', body: 'Want a rival’s cell? Challenge them to a timed 1v1. Both sides stake a cell. The faster correct solution takes it.' },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Solve', body: 'Submit a correct solution. Fewer retries and a faster solve score a little higher.' },
  { title: 'Score', body: 'Easy, Medium and Hard problems are worth 10, 25 and 50 base points.' },
  { title: 'Claim', body: 'Your score decides the tier of the cell you win: Outpost, Settlement, Stronghold or Citadel.' },
  { title: 'Defend', body: 'Cells never decay. They only change hands when someone accepts a duel.' },
];

const VALUES: { title: string; body: string }[] = [
  { title: 'Learning comes first.', body: 'The map is there to keep you coming back. The goal is that you get better at DSA.' },
  { title: 'Fair by design.', body: 'There is no random loss. A cell moves only through a duel both players agreed to, and every duel is timed on the server.' },
  { title: 'One campus, one cohort.', body: 'Sign-in is limited to @thapar.edu accounts, so the leaderboard is a real comparison between classmates.' },
  { title: 'Honest about progress.', body: 'We would rather tell you what is not done yet than promise it. See the status below.' },
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

function SectionHead({ children }: { children: string }) {
  return (
    <h2 className="font-display mb-5 flex items-center gap-4 text-sm font-bold uppercase tracking-[0.3em] text-cyan-300">
      {children}
      <span className="h-px flex-1 bg-slate-700/70" />
    </h2>
  );
}

export default function AboutPage() {
  return (
    <div className="hud-backdrop min-h-[calc(100dvh-var(--nav-h))] flex-1">
      <article className="relative z-10 mx-auto max-w-3xl px-5 pb-20 pt-10 text-left md:pt-16">
        {/* ------------------------------------------------------------ opening */}
        <header className="mb-14 animate-fade-in-up">
          <p className="hud-label text-cyan-300">About</p>
          <h1 className="font-display mt-2 text-6xl font-bold leading-none tracking-wide sm:text-7xl">
            <span className="text-slate-50">Code</span>
            <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-300 bg-clip-text text-transparent">Craft</span>
          </h1>
          <p className="mt-6 text-xl leading-relaxed text-slate-200 sm:text-2xl sm:leading-relaxed">
            A practice platform for data structures and algorithms, built for the students of Thapar Institute of Engineering &amp; Technology. Every problem you solve earns ground on a
            map of the campus that you can see, defend and fight for.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
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

        {/* ------------------------------------------------------------ why */}
        <section className="mb-14">
          <SectionHead>Why it exists</SectionHead>
          <p className="text-[1.05rem] leading-8 text-slate-300">
            Many students practise DSA in short bursts before placements and then stop. We wanted something that makes consistency visible: a place where today’s solve is still on
            the board tomorrow, and where a friend can take it back.
          </p>
          <blockquote className="mt-6 border-l-4 border-amber-400 pl-5">
            <p className="font-display text-2xl font-bold leading-snug tracking-wide text-slate-50">Help beginners learn DSA, and keep practising, by making it fun to come back.</p>
            <footer className="hud-label mt-2 !text-amber-300">Our mission</footer>
          </blockquote>
        </section>

        {/* ------------------------------------------------------------ what you can do */}
        <section className="mb-14">
          <SectionHead>What you can do here</SectionHead>
          <dl className="divide-y divide-slate-800/80 border-y border-slate-800/80">
            {DOES.map((d) => (
              <div key={d.title} className="flex flex-col gap-1 py-4 sm:flex-row sm:gap-8">
                <dt className="font-display w-40 shrink-0 text-xl font-bold uppercase tracking-wide text-slate-50">{d.title}</dt>
                <dd className="text-[0.95rem] leading-relaxed text-slate-400">{d.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ------------------------------------------------------------ the path */}
        <section className="mb-14">
          <SectionHead>From a solve to a cell</SectionHead>
          <ol className="relative ml-4 border-l-2 border-dashed border-slate-700">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative pb-7 pl-8 last:pb-0">
                <span className="font-display absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-amber-400 bg-slate-950 text-sm font-bold text-amber-300">
                  {i + 1}
                </span>
                <p className="font-display text-xl font-bold uppercase tracking-wide text-slate-50">{s.title}</p>
                <p className="mt-0.5 text-[0.95rem] leading-relaxed text-slate-400">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm leading-relaxed text-slate-500">
            To keep land-grabbing fair, up to 6 solves a day count towards score and territory. You can keep practising after that; it just will not add to the map.
          </p>
        </section>

        {/* ------------------------------------------------------------ values */}
        <section className="mb-14">
          <SectionHead>What we stand for</SectionHead>
          <ul className="space-y-4">
            {VALUES.map((v) => (
              <li key={v.title} className="text-[1.02rem] leading-8 text-slate-400">
                <strong className="font-semibold text-slate-100">{v.title}</strong> {v.body}
              </li>
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------------ status */}
        <section className="mb-14">
          <SectionHead>Where we are</SectionHead>
          <h3 className="font-display mb-2 flex items-center gap-2 text-lg font-bold uppercase tracking-wide text-emerald-300">
            <Icon name="check" className="h-4 w-4" strokeWidth={3} />
            Working today
          </h3>
          <ul className="mb-7 space-y-1.5">
            {WORKS.map((w) => (
              <li key={w} className="flex gap-3 text-[0.95rem] leading-relaxed text-slate-300">
                <span className="mt-2.5 h-px w-4 shrink-0 bg-emerald-400" />
                {w}
              </li>
            ))}
          </ul>
          <h3 className="font-display mb-2 flex items-center gap-2 text-lg font-bold uppercase tracking-wide text-amber-300">
            <Icon name="rocket" className="h-4 w-4" />
            Still to come
          </h3>
          <ul className="space-y-1.5">
            {NEXT.map((w) => (
              <li key={w} className="flex gap-3 text-[0.95rem] leading-relaxed text-slate-300">
                <span className="mt-2.5 h-px w-4 shrink-0 bg-amber-400" />
                {w}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm leading-relaxed text-slate-500">CodeCraft is young. We will share real numbers, like players and problems solved, once there are some worth sharing.</p>
        </section>

        {/* ------------------------------------------------------------ makers */}
        <section>
          <SectionHead>Built by</SectionHead>
          <p className="font-display text-4xl font-bold leading-tight tracking-wide text-slate-50 sm:text-5xl">
            {MAKERS.map((m, i) => (
              <span key={m.name}>
                <span className="underline decoration-[5px] underline-offset-[10px]" style={{ textDecorationColor: m.color }}>
                  {m.name}
                </span>
                {i < MAKERS.length - 2 ? <span className="text-slate-600">, </span> : i === MAKERS.length - 2 ? <span className="text-slate-600"> and </span> : null}
              </span>
            ))}
          </p>
          <p className="mt-4 max-w-xl text-[0.95rem] leading-relaxed text-slate-400">Made for the people they study with, to make DSA practice feel a little less like a chore.</p>
        </section>
      </article>
    </div>
  );
}
